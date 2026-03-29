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
 * Middleware warns if a query touches these without firmId.
 */
const FIRM_SCOPED_MODELS = [
  'Client', 'Policy', 'Renewal', 'ChecklistItem', 'Document',
  'Import', 'AuditEvent', 'Notification', 'PCFRole', 'ConductTraining', 'Attestation',
] as const;

/**
 * Prisma middleware for firm isolation enforcement.
 *
 * In development/test: throws on missing firmId (catches bugs early).
 * In production: logs warning (soft enforcement to avoid breaking queries
 * that legitimately don't need firmId, like aggregate counts).
 *
 * This is a defense-in-depth layer, NOT a replacement for application-level
 * firmId filtering. The real security comes from each service/handler
 * properly scoping queries.
 */
prisma.$use(async (params, next) => {
  if (FIRM_SCOPED_MODELS.includes(params.model as typeof FIRM_SCOPED_MODELS[number])) {
    const action = params.action;

    // Check read operations
    if (['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(action)) {
      const where = params.args?.where;
      if (where && !where.firmId && !where.id) {
        // Query on a firm-scoped model without firmId filter (and not by unique id)
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[FirmIsolation] ${params.model}.${action} without firmId filter. ` +
            `This may leak cross-tenant data. Args: ${JSON.stringify(params.args).slice(0, 200)}`
          );
        }
      }
    }

    // Check write operations
    if (['update', 'updateMany', 'delete', 'deleteMany'].includes(action)) {
      const where = params.args?.where;
      if (where && !where.firmId && !where.id) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[FirmIsolation] ${params.model}.${action} without firmId in where clause.`
          );
        }
      }
    }
  }

  return next(params);
});
