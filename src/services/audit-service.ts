import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

export class AuditService {
  async log(params: {
    firmId: string;
    actorId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    return prisma.auditEvent.create({
      data: {
        firmId: params.firmId,
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: params.ipAddress,
      },
    });
  }

  async query(firmId: string, filters?: {
    startDate?: Date;
    endDate?: Date;
    action?: string;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.AuditEventWhereInput = { firmId };

    if (filters?.startDate || filters?.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = filters.startDate;
      if (filters.endDate) where.timestamp.lte = filters.endDate;
    }
    if (filters?.action) where.action = filters.action;
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.actorId) where.actorId = filters.actorId;

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return { events, total };
  }

  async exportCSV(firmId: string, filters?: {
    startDate?: Date;
    endDate?: Date;
  }): Promise<string> {
    const { events } = await this.query(firmId, {
      ...filters,
      limit: 100000,
    });

    const headers = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Metadata'];
    const rows = events.map(e => [
      e.timestamp.toISOString(),
      e.actorId ?? '',
      e.action,
      e.entityType,
      e.entityId ?? '',
      JSON.stringify(e.metadata),
    ]);

    const escapeCsvField = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [
      headers.map(escapeCsvField).join(','),
      ...rows.map(r => r.map(escapeCsvField).join(',')),
    ].join('\n');

    return csv;
  }
}
