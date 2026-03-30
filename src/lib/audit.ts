import { AuditService } from '../services/audit-service';

const auditService = new AuditService();

export async function auditLog(
  firmId: string,
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
  actorId?: string
) {
  return auditService.log({
    firmId,
    action,
    entityType,
    entityId,
    metadata,
    actorId,
  });
}
