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

  // Art 17(3)(b): compliance records are exempt from erasure.
  // We anonymize PII but retain compliance evidence.

  const erasureTimestamp = new Date();

  // 1. Anonymize client PII
  await prisma.client.update({
    where: { id: clientId },
    data: {
      name: '[REDACTED]',
      email: null,
      phone: null,
      address: null,
    },
  });

  // 2. Anonymize audit event metadata containing client PII
  await prisma.$executeRaw`
    UPDATE audit_events
    SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(metadata, '{clientName}', '"[REDACTED]"'),
        '{email}', '"[REDACTED]"'
      ),
      '{policyNumber}', '"[REDACTED]"'
    )
    WHERE firm_id = ${user.firmId}
    AND (
      metadata->>'clientName' = ${client.name}
      OR metadata->>'email' = ${client.email || ''}
    )
  `;

  // 3. Anonymize IP addresses in audit events for this client's policies
  const clientPolicies = await prisma.policy.findMany({
    where: { clientId, firmId: user.firmId },
    select: { id: true },
  });
  const policyIds = clientPolicies.map(p => p.id);

  if (policyIds.length > 0) {
    await prisma.$executeRaw`
      UPDATE audit_events
      SET ip_address = '0.0.0.0'
      WHERE firm_id = ${user.firmId}
      AND entity_id = ANY(${policyIds})
      AND ip_address IS NOT NULL
    `;
  }

  // 4. Redact PII from checklist items (free-text fields that may contain client references)
  const clientRenewals = await prisma.renewal.findMany({
    where: { firmId: user.firmId, policy: { clientId } },
    select: { id: true },
  });
  const renewalIds = clientRenewals.map(r => r.id);

  if (renewalIds.length > 0) {
    await prisma.checklistItem.updateMany({
      where: {
        firmId: user.firmId,
        renewalId: { in: renewalIds },
        OR: [
          { notes: { not: null } },
          { rejectionReason: { not: null } },
          { evidenceUrl: { not: null } },
        ],
      },
      data: {
        notes: '[REDACTED — GDPR erasure]',
        rejectionReason: '[REDACTED — GDPR erasure]',
        evidenceUrl: '[REDACTED — GDPR erasure]',
      },
    });
  }

  // 5. Audit the erasure itself
  await prisma.auditEvent.create({
    data: {
      firmId: user.firmId,
      actorId: user.id,
      action: 'gdpr.erasure_completed',
      entityType: 'client',
      entityId: clientId,
      metadata: {
        originalName: client.name,
        reason: reason || 'GDPR Art 17 erasure request',
        complianceRecordsRetained: true,
        legalBasis: 'Art 17(3)(b) — compliance with legal obligation (CPC)',
      },
    },
  });

  return NextResponse.json({
    data: {
      clientId,
      status: 'anonymized',
      complianceRecordsRetained: true,
      message: 'Client PII anonymized. Compliance records retained under Art 17(3)(b).',
    },
  });
});
