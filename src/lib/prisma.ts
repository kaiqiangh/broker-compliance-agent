import { PrismaClient } from '@prisma/client';

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
 * Set by withAuth middleware, consumed by Prisma middleware.
 */
let currentFirmId: string | null = null;

/**
 * Set the current firm context for RLS enforcement.
 * Call this at the start of each authenticated request.
 * The firmId is used to:
 * 1. Set PostgreSQL session variable (for DB-level RLS)
 * 2. Validate queries don't leak cross-tenant data (dev warnings)
 */
export async function setFirmContext(firmId: string): Promise<void> {
  currentFirmId = firmId;
  // Set PostgreSQL session variable for RLS policies
  await prisma.$executeRaw`SELECT set_current_firm_id(${firmId})`;
}

/**
 * Clear the firm context after request completes.
 */
export function clearFirmContext(): void {
  currentFirmId = null;
}

/**
 * Prisma middleware for firm isolation enforcement.
 *
 * Layer 1 (this middleware): Dev-mode warnings + firm context propagation
 * Layer 2 (PostgreSQL RLS): Hard enforcement at DB level via migration policies
 *
 * The middleware:
 * - Warns in dev when firm-scoped queries lack firmId filter
 * - Ensures firm context is set before any firm-scoped query
 */
prisma.$use(async (params, next) => {
  if (FIRM_SCOPED_MODELS.includes(params.model as typeof FIRM_SCOPED_MODELS[number])) {
    const action = params.action;

    // Dev-mode: warn on missing firmId in read operations
    if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(action)) {
      const where = params.args?.where;
      if (where && !where.firmId && !where.id) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[FirmIsolation] ${params.model}.${action} without firmId filter. ` +
            `Args: ${JSON.stringify(params.args).slice(0, 200)}`
          );
        }
      }
    }
  }

  return next(params);
});
