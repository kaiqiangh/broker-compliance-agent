export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { ChecklistService } from '@/services/checklist-service';
import { z } from 'zod';

const checklistService = new ChecklistService();

/**
 * Handle checklist action with optimistic locking support.
 * If another user modified the item concurrently, returns 409 Conflict.
 */
async function handleAction(
  action: () => Promise<unknown>
): Promise<Response> {
  try {
    const result = await action();
    return NextResponse.json({ data: result });
  } catch (err) {
    // Prisma P2025: Record not found — likely optimistic lock failure
    if ((err as any).code === 'P2025') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: 'This item was modified by another user. Please refresh and try again.' } },
        { status: 409 }
      );
    }
    throw err;
  }
}

const CompleteSchema = z.object({
  evidenceUrl: z.string().url().optional(),
  notes: z.string().max(5000).optional(),
});

const ApproveSchema = z.object({
  comment: z.string().max(2000).optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});

// PUT /api/checklist/[id] — complete, approve, or reject
// Permission is checked per-action: complete_items for complete, sign_off for approve/reject
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;
  let body: { action?: string; [key: string]: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, { status: 400 });
  }

  const { action } = body;

  if (!action || typeof action !== 'string') {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Missing or invalid action field' } }, { status: 400 });
  }

  // Route to the correct permission based on action
  if (action === 'complete') {
    return withAuth('complete_items', async (user) => {
      const { evidenceUrl, notes } = CompleteSchema.parse(body);
      return handleAction(() => checklistService.completeItem(
        user.firmId,
        itemId,
        user.id,
        { url: evidenceUrl, notes }
      ));
    })(request);
  }

  if (action === 'approve') {
    return withAuth('sign_off', async (user) => {
      const { comment } = ApproveSchema.parse(body);
      return handleAction(() => checklistService.approveItem(
        user.firmId,
        itemId,
        user.id,
        comment
      ));
    })(request);
  }

  if (action === 'reject') {
    return withAuth('sign_off', async (user) => {
      const { reason } = RejectSchema.parse(body);
      return handleAction(() => checklistService.rejectItem(
        user.firmId,
        itemId,
        user.id,
        reason
      ));
    })(request);
  }

  return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid action' } }, { status: 400 });
}
