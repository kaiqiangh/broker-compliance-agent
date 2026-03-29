export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GDPR data export — Art 20 right to data portability
export const GET = withAuth('export_audit', async (user, request) => {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'clientId required' } }, { status: 400 });
  }

  // Verify client belongs to firm
  const client = await prisma.client.findFirst({
    where: { id: clientId, firmId: user.firmId },
  });

  if (!client) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Client not found' } }, { status: 404 });
  }

  // Collect all data
  const [policies, renewals, checklistItems, auditEvents] = await Promise.all([
    prisma.policy.findMany({ where: { clientId, firmId: user.firmId } }),
    prisma.renewal.findMany({
      where: { firmId: user.firmId, policy: { clientId } },
      include: { checklistItems: true },
    }),
    prisma.checklistItem.findMany({
      where: { firmId: user.firmId, renewal: { policy: { clientId } } },
    }),
    prisma.auditEvent.findMany({
      where: {
        firmId: user.firmId,
        metadata: { path: ['clientName'], string_contains: client.name },
      },
      take: 1000,
    }),
  ]);

  const exportData = {
    exportDate: new Date().toISOString(),
    firmId: user.firmId,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: client.address,
      createdAt: client.createdAt,
    },
    policies: policies.map(p => ({
      policyNumber: p.policyNumber,
      policyType: p.policyType,
      insurerName: p.insurerName,
      inceptionDate: p.inceptionDate,
      expiryDate: p.expiryDate,
      premium: p.premium,
      ncb: p.ncb,
      status: p.policyStatus,
    })),
    renewals: renewals.map(r => ({
      dueDate: r.dueDate,
      status: r.status,
      checklistItems: r.checklistItems.map(ci => ({
        type: ci.itemType,
        status: ci.status,
        completedAt: ci.completedAt,
      })),
    })),
    auditTrail: auditEvents.map(e => ({
      action: e.action,
      timestamp: e.timestamp,
      entityType: e.entityType,
    })),
  };

  return NextResponse.json(exportData, {
    headers: {
      'Content-Disposition': `attachment; filename="gdpr-export-${clientId}.json"`,
    },
  });
});

// GDPR erasure — Art 17 right to erasure
export const DELETE = withAuth('admin', async (user, request) => {
  const body = await request.json();
  const { clientId, reason } = body;

  if (!clientId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'clientId required' } }, { status: 400 });
  }

  // Verify client belongs to firm
  const client = await prisma.client.findFirst({
    where: { id: clientId, firmId: user.firmId },
  });

  if (!client) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Client not found' } }, { status: 404 });
  }

  // Enqueue erasure job — the worker handles the actual anonymization
  await prisma.scheduledJob.create({
    data: {
      jobType: 'gdpr_erasure',
      payload: {
        firmId: user.firmId,
        clientId,
        clientName: client.name,
        clientEmail: client.email,
        reason: reason || 'GDPR Art 17 erasure request',
        actorId: user.id,
      },
      scheduledFor: new Date(),
      status: 'pending',
    },
  });

  return NextResponse.json({
    data: {
      clientId,
      status: 'erasure_queued',
      message: 'GDPR erasure job queued. Client PII will be anonymized shortly.',
    },
  });
});
