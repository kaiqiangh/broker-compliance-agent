export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { AuditService } from '@/services/audit-service';

const auditService = new AuditService();

export const GET = withAuth('export_audit', async (user, request) => {
  const url = new URL(request.url);

  // CSV export mode
  if (url.searchParams.get('format') === 'csv') {
    const csv = await auditService.exportCSV(user.firmId, {
      startDate: url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined,
      endDate: url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined,
    });

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-trail-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // JSON query mode — page/pageSize pagination
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '50', 10) || 50, 1), 500);

  const filters = {
    startDate: url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined,
    endDate: url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined,
    action: url.searchParams.get('action') || undefined,
    entityType: url.searchParams.get('entity') || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const result = await auditService.query(user.firmId, filters);
  return NextResponse.json({
    data: result.events,
    meta: { total: result.total, page, pageSize, totalPages: Math.ceil(result.total / pageSize) },
  });
});
