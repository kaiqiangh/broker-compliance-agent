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

// Complete a checklist item (adviser action)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { withAuth: authed } = await import('@/lib/auth');

  return authed('complete_items', async (user) => {
    const body = await request.json();
    const { action } = body;

    if (action === 'complete') {
      const { evidenceUrl, notes } = CompleteSchema.parse(body);
      const result = await checklistService.completeItem(
        user.firmId,
        params.id,
        user.id,
        { url: evidenceUrl, notes }
      );
      return NextResponse.json({ data: result });
    }

    if (action === 'approve') {
      const { comment } = ApproveSchema.parse(body);
      const result = await checklistService.approveItem(
        user.firmId,
        params.id,
        user.id,
        comment
      );
      return NextResponse.json({ data: result });
    }

    if (action === 'reject') {
      const { reason } = RejectSchema.parse(body);
      const result = await checklistService.rejectItem(
        user.firmId,
        params.id,
        user.id,
        reason
      );
      return NextResponse.json({ data: result });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  })(request);
}
