export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';

const UpdateConfigSchema = z.object({
  executionMode: z.enum(['suggestion', 'auto_execute']).optional(),
  confidenceThreshold: z.number().min(0.5).max(0.99).optional(),
  processAttachments: z.boolean().optional(),
  emailFolderFilter: z.array(z.string()).optional(),
  notifyOnAction: z.enum(['all', 'pending', 'errors']).optional(),
  notifyChannel: z.enum(['email', 'dashboard', 'both']).optional(),
  notifyDigestMode: z.enum(['realtime', 'daily']).optional(),
}).strict();

export const GET = withAuth('agent:view_own', async (user, _request) => {
  const rl = await checkRateLimit(`api:config:get:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  const config = await prisma.emailIngressConfig.findUnique({
    where: { firmId: user.firmId },
  });

  if (!config) {
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({
    data: {
      forwardingAddress: config.forwardingAddress,
      provider: config.provider,
      executionMode: config.executionMode,
      confidenceThreshold: Number(config.confidenceThreshold),
      processAttachments: config.processAttachments,
      insurerDomains: config.insurerDomains,
      status: config.status,
      lastPolledAt: config.lastPolledAt,
      createdAt: config.createdAt,
      // Notification preferences
      notifyOnAction: config.notifyOnAction,
      notifyChannel: config.notifyChannel,
      notifyDigestMode: config.notifyDigestMode,
      // Connection health
      health: {
        status: config.status,
        lastPolledAt: config.lastPolledAt,
        lastError: config.lastError,
        errorCount: config.errorCount,
        isHealthy: config.status === 'active' && config.errorCount < 5,
      },
    },
  });
});

export const PUT = withAuth('agent:configure', async (user, request) => {
  const rl = await checkRateLimit(`api:config:put:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
  }

  let body: z.infer<typeof UpdateConfigSchema>;
  try {
    const raw = await request.json();
    body = UpdateConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: err.issues[0].message } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } },
      { status: 400 }
    );
  }

  // Generate forwarding address if not exists
  const forwardingAddress = `agent-${user.firmId}@ingest.${process.env.INGEST_DOMAIN || 'yourproduct.com'}`;

  const config = await prisma.emailIngressConfig.upsert({
    where: { firmId: user.firmId },
    update: {
      ...(body.executionMode !== undefined && { executionMode: body.executionMode }),
      ...(body.confidenceThreshold !== undefined && { confidenceThreshold: body.confidenceThreshold }),
      ...(body.processAttachments !== undefined && { processAttachments: body.processAttachments }),
      ...(body.emailFolderFilter !== undefined && { emailFolderFilter: body.emailFolderFilter }),
      ...(body.notifyOnAction !== undefined && { notifyOnAction: body.notifyOnAction }),
      ...(body.notifyChannel !== undefined && { notifyChannel: body.notifyChannel }),
      ...(body.notifyDigestMode !== undefined && { notifyDigestMode: body.notifyDigestMode }),
    },
    create: {
      firmId: user.firmId,
      forwardingAddress,
      executionMode: body.executionMode || 'suggestion',
      confidenceThreshold: body.confidenceThreshold || 0.95,
      processAttachments: body.processAttachments ?? true,
      status: 'active',
    },
  });

  return NextResponse.json({
    data: {
      forwardingAddress: config.forwardingAddress,
      executionMode: config.executionMode,
      confidenceThreshold: Number(config.confidenceThreshold),
      processAttachments: config.processAttachments,
      status: config.status,
    },
  });
});
