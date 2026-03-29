export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { ChecklistService } from '@/services/checklist-service';

const checklistService = new ChecklistService();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: renewalId } = await params;
  return withAuth('complete_items', async (user) => {
    if (!renewalId) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Missing renewal ID' } }, { status: 400 });
    }

    const checklist = await checklistService.getRenewalChecklist(user.firmId, renewalId);
    return NextResponse.json({ data: checklist });
  })(request);
}
