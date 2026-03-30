export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const checks: Record<string, { status: string; message?: string }> = {};

  // Check DB connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = { status: 'ok' };
  } catch {
    checks.db = { status: 'error', message: 'Database unreachable' };
  }

  // Check for stuck emails (processing > 5 min)
  try {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
    const staleCount = await prisma.incomingEmail.count({
      where: {
        status: 'processing',
        createdAt: { lt: staleThreshold }, // Use createdAt as proxy for updatedAt
      },
    });
    checks.emailProcessing = staleCount > 0
      ? { status: 'error', message: `${staleCount} emails stuck in processing` }
      : { status: 'ok' };
  } catch {
    checks.emailProcessing = { status: 'error', message: 'Could not check' };
  }

  // Check email connections
  try {
    const disconnected = await prisma.emailIngressConfig.count({
      where: {
        status: 'active',
        lastPolledAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
    });
    checks.emailConnections = disconnected > 0
      ? { status: 'warning', message: `${disconnected} connections may be disconnected` }
      : { status: 'ok' };
  } catch {
    checks.emailConnections = { status: 'error', message: 'Could not check' };
  }

  // Check pending queue depth
  try {
    const pending = await prisma.agentAction.count({ where: { status: 'pending' } });
    checks.queueDepth = pending > 100
      ? { status: 'warning', message: `Queue depth: ${pending}` }
      : { status: 'ok' };
  } catch {
    checks.queueDepth = { status: 'error', message: 'Could not check' };
  }

  const healthy = Object.values(checks).every(c => c.status === 'ok');

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
