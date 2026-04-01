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
  const rl = await checkRateLimit(`api:emails:export:${user.id}`, 5, 60_000);
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
    where.receivedAt = {};
    if (from) where.receivedAt.gte = new Date(from);
    if (to) where.receivedAt.lte = new Date(to);
  }

  // Role-based filtering: advisers/read_only only see emails they've acted on
  const isRestricted = user.role === 'adviser' || user.role === 'read_only';
  if (isRestricted) {
    where.actions = { some: { confirmedBy: user.id } };
  }

  const emails = await prisma.incomingEmail.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      messageId: true,
      fromAddress: true,
      subject: true,
      receivedAt: true,
      isInsurance: true,
      category: true,
      priority: true,
      status: true,
      processedAt: true,
      threadId: true,
      createdAt: true,
      _count: {
        select: { actions: true, attachments: true },
      },
    },
  });

  const headers = [
    'ID',
    'Message ID',
    'From',
    'Subject',
    'Received At',
    'Is Insurance',
    'Category',
    'Priority',
    'Status',
    'Processed At',
    'Thread ID',
    'Actions Count',
    'Attachments Count',
    'Created At',
  ];

  const rows = emails.map((e) => [
    escapeCSV(e.id),
    escapeCSV(e.messageId),
    escapeCSV(e.fromAddress),
    escapeCSV(e.subject),
    escapeCSV(e.receivedAt.toISOString()),
    escapeCSV(e.isInsurance),
    escapeCSV(e.category),
    escapeCSV(e.priority),
    escapeCSV(e.status),
    escapeCSV(e.processedAt?.toISOString()),
    escapeCSV(e.threadId),
    escapeCSV(e._count.actions),
    escapeCSV(e._count.attachments),
    escapeCSV(e.createdAt.toISOString()),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

  const filename = `emails${from ? `_${from}` : ''}${to ? `_${to}` : ''}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
