import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { ChecklistService } from '@/services/checklist-service';
import { z } from 'zod';

const checklistService = new ChecklistService();

const CompleteSchema = z.object({
  evidenceUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

const ApproveSchema = z.object({
  comment: z.string().optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1),
});

// PUT /api/checklist/[id] — complete, approve, or reject
// Permission is checked per-action: complete_items for complete, sign_off for approve/reject
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  let body: { action?: string; [key: string]: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action } = body;

  if (!action || typeof action !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid action field' }, { status: 400 });
  }

  // Route to the correct permission based on action
  if (action === 'complete') {
    return withAuth('complete_items', async (user) => {
      const { evidenceUrl, notes } = CompleteSchema.parse(body);
      const result = await checklistService.completeItem(
        user.firmId,
        params.id,
        user.id,
        { url: evidenceUrl, notes }
      );
      return NextResponse.json({ data: result });
    })(request);
  }

  if (action === 'approve') {
    return withAuth('sign_off', async (user) => {
      const { comment } = ApproveSchema.parse(body);
      const result = await checklistService.approveItem(
        user.firmId,
        params.id,
        user.id,
        comment
      );
      return NextResponse.json({ data: result });
    })(request);
  }

  if (action === 'reject') {
    return withAuth('sign_off', async (user) => {
      const { reason } = RejectSchema.parse(body);
      const result = await checklistService.rejectItem(
        user.firmId,
        params.id,
        user.id,
        reason
      );
      return NextResponse.json({ data: result });
    })(request);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
