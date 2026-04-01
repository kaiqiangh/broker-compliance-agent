export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  // Formula injection protection
  if ('=+-@|!\t\r'.includes(str.trim()[0])) return "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const GET = withAuth('agent:view_own', async (user, request) => {
  const rl = await checkRateLimit(`api:actions:export:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  if (format && format !== 'csv') {
    return NextResponse.json({ error: 'Only format=csv is supported' }, { status: 400 });
  }
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: any = { firmId: user.firmId };

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  // Role-based filtering
  const isRestricted = user.role === 'adviser' || user.role === 'read_only';
  if (isRestricted) {
    where.OR = [{ confirmedBy: user.id }, { status: 'pending' }];
  }

  const actions = await prisma.agentAction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      email: {
        select: { subject: true, fromAddress: true, receivedAt: true },
      },
    },
  });

  const headers = [
    'ID',
    'Action Type',
    'Entity Type',
    'Entity ID',
    'Confidence',
    'Match Confidence',
    'Status',
    'Reasoning',
    'Changes',
    'Email Subject',
    'Email From',
    'Email Received At',
    'Created At',
    'Confirmed At',
    'Executed At',
    'Is Reversed',
  ];

  const rows = actions.map((a) => [
    escapeCSV(a.id),
    escapeCSV(a.actionType),
    escapeCSV(a.entityType),
    escapeCSV(a.entityId),
    escapeCSV(Number(a.confidence)),
    escapeCSV(a.matchConfidence ? Number(a.matchConfidence) : null),
    escapeCSV(a.status),
    escapeCSV(a.reasoning),
    escapeCSV(JSON.stringify(a.changes)),
    escapeCSV(a.email?.subject),
    escapeCSV(a.email?.fromAddress),
    escapeCSV(a.email?.receivedAt?.toISOString()),
    escapeCSV(a.createdAt.toISOString()),
    escapeCSV(a.confirmedAt?.toISOString()),
    escapeCSV(a.executedAt?.toISOString()),
    escapeCSV(a.isReversed),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

  const filename = `actions${from ? `_${from}` : ''}${to ? `_${to}` : ''}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
