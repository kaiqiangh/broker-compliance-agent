export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { ChecklistService } from '@/services/checklist-service';

const checklistService = new ChecklistService();

export const GET = withAuth('view_all', async (user, request) => {
  // Extract renewal ID from URL: /api/renewals/{id}/checklist
  const url = new URL(request.url);
  const segments = url.pathname.split('/');
  const renewalId = segments[segments.indexOf('renewals') + 1];

  if (!renewalId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Missing renewal ID' } }, { status: 400 });
  }

  const checklist = await checklistService.getRenewalChecklist(user.firmId, renewalId);
  return NextResponse.json({ data: checklist });
});
