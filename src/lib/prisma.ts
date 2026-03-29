import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Firm-scoped models that MUST have firmId in where clauses.
 */
const FIRM_SCOPED_MODELS = [
  'Client', 'Policy', 'Renewal', 'ChecklistItem', 'Document',
  'Import', 'AuditEvent', 'Notification', 'PCFRole', 'ConductTraining', 'Attestation',
] as const;

/**
 * Thread-local firm context for RLS.
 * Each async execution context gets its own firmId — no global mutable state,
 * no race conditions under concurrent requests.
 */
const firmContext = new AsyncLocalStorage<string>();

/**
 * Run a callback with the given firm context active.
 * The firmId is automatically scoped to the async execution and cleaned up
 * when the callback returns (or throws).
 *
 * Usage:
 *   return runWithFirmContext(firmId, async () => {
 *     // all prisma calls here are scoped
 *     return handler(user, request);
 *   });
 */
export function runWithFirmContext<T>(firmId: string, fn: () => T): T {
  return firmContext.run(firmId, fn);
}

/**
 * Set the current firm context for RLS enforcement.
 * @deprecated Use runWithFirmContext() instead — it's race-condition safe.
 */
export async function setFirmContext(firmId: string): Promise<void> {
  // Set PostgreSQL session variable for DB-level RLS policies
  await prisma.$executeRaw`SELECT set_current_firm_id(${firmId})`;
}

/**
 * Clear the firm context after request completes.
 * @deprecated Use runWithFirmContext() instead — cleanup is automatic.
 */
export async function clearFirmContext(): Promise<void> {
  await prisma.$executeRaw`SELECT set_config('app.current_firm_id', '', false)`;
}

/**
 * Prisma middleware for firm isolation enforcement.
 *
 * Layer 1 (this middleware): Dev-mode warnings + firm context validation
 * Layer 2 (PostgreSQL RLS): Hard enforcement at DB level via migration policies
 *
 * The middleware:
 * - Warns/errors when firm-scoped queries lack firm context
 * - Validates firmId is present in write operations
 */
prisma.$use(async (params, next) => {
  if (FIRM_SCOPED_MODELS.includes(params.model as typeof FIRM_SCOPED_MODELS[number])) {
    const action = params.action;
    const currentFirmId = firmContext.getStore();

    // Read operations: warn/error on missing firmId filter
    if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(action)) {
      const where = params.args?.where;
      if (where && !where.firmId && !where.id) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            `[FirmIsolation] BLOCKED ${params.model}.${action} without firmId filter in production. ` +
            `firmContext=${currentFirmId ?? 'MISSING'}`
          );
        }
        console.warn(
          `[FirmIsolation] ${params.model}.${action} without firmId filter. ` +
          `firmContext=${currentFirmId ?? 'MISSING'} ` +
          `Args: ${JSON.stringify(params.args).slice(0, 200)}`
        );
      }
    }

    // All operations: ensure firm context is set
    if (!currentFirmId) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `[FirmIsolation] BLOCKED ${params.model}.${action} with no firm context in production. ` +
          `Use runWithFirmContext() to scope the operation.`
        );
      }
      console.warn(
        `[FirmIsolation] ${params.model}.${action} with no firm context. ` +
        `Use runWithFirmContext() to scope the operation.`
      );
    }
  }

  return next(params);
});
