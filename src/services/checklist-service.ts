import { prisma } from '../lib/prisma';
import { transitionChecklistItem, type ChecklistStatus, ITEMS_REQUIRING_SIGN_OFF } from '../lib/checklist-state';
import { calculateRenewalStatus } from '../lib/dates';
import type { ChecklistItemType } from '../lib/checklist-state';

export class ChecklistService {
  async completeItem(
    firmId: string,
    itemId: string,
    completedBy: string,
    evidence?: { url?: string; notes?: string }
  ) {
    const item = await prisma.checklistItem.findFirst({
      where: { id: itemId, firmId },
    });

    if (!item) throw new Error('Checklist item not found');

    const requiresSignOff = (ITEMS_REQUIRING_SIGN_OFF as readonly string[]).includes(item.itemType);
    const targetStatus: ChecklistStatus = requiresSignOff ? 'pending_review' : 'completed';

    const transition = transitionChecklistItem(
      item.status as ChecklistStatus,
      targetStatus
    );

    if (!transition.success) {
      throw new Error('error' in transition ? transition.error : 'Invalid transition');
    }

    const updated = await prisma.checklistItem.update({
      where: { id: itemId, status: item.status }, // optimistic lock: only update if status hasn't changed
      data: {
        status: targetStatus,
        completedBy,
        completedAt: new Date(),
        evidenceUrl: evidence?.url ?? null,
        notes: evidence?.notes ?? null,
      },
    });

    await this.updateRenewalStatus(firmId, item.renewalId);

    await prisma.auditEvent.create({
      data: {
        firmId,
        actorId: completedBy,
        action: 'checklist.item_completed',
        entityType: 'checklist_item',
        entityId: itemId,
        metadata: { itemType: item.itemType, requiresSignOff, targetStatus },
      },
    });

    return updated;
  }

  async approveItem(
    firmId: string,
    itemId: string,
    approvedBy: string,
    comment?: string
  ) {
    const item = await prisma.checklistItem.findFirst({
      where: { id: itemId, firmId },
    });

    if (!item) throw new Error('Checklist item not found');

    // CPC segregation of duties: cannot approve your own completed item
    if (item.completedBy === approvedBy) {
      throw new Error('Cannot approve your own checklist item. Segregation of duties required.');
    }

    const transition = transitionChecklistItem(
      item.status as ChecklistStatus,
      'approved'
    );

    if (!transition.success) {
      throw new Error('error' in transition ? transition.error : 'Invalid transition');
    }

    const updated = await prisma.checklistItem.update({
      where: { id: itemId, status: item.status }, // optimistic lock
      data: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
        notes: comment
          ? [item.notes, `[Approved by ${approvedBy}]: ${comment}`].filter(Boolean).join('\n')
          : item.notes,
      },
    });

    await this.updateRenewalStatus(firmId, item.renewalId);

    await prisma.auditEvent.create({
      data: {
        firmId,
        actorId: approvedBy,
        action: 'checklist.item_approved',
        entityType: 'checklist_item',
        entityId: itemId,
        metadata: { itemType: item.itemType, comment },
      },
    });

    return updated;
  }

  async rejectItem(
    firmId: string,
    itemId: string,
    rejectedBy: string,
    reason: string
  ) {
    const item = await prisma.checklistItem.findFirst({
      where: { id: itemId, firmId },
    });

    if (!item) throw new Error('Checklist item not found');

    const transition = transitionChecklistItem(
      item.status as ChecklistStatus,
      'rejected'
    );

    if (!transition.success) {
      throw new Error('error' in transition ? transition.error : 'Invalid transition');
    }

    const updated = await prisma.checklistItem.update({
      where: { id: itemId, status: item.status }, // optimistic lock
      data: {
        status: 'rejected',
        rejectionReason: reason,
      },
    });

    await this.updateRenewalStatus(firmId, item.renewalId);

    await prisma.auditEvent.create({
      data: {
        firmId,
        actorId: rejectedBy,
        action: 'checklist.item_rejected',
        entityType: 'checklist_item',
        entityId: itemId,
        metadata: { itemType: item.itemType, reason },
      },
    });

    return updated;
  }

  async getRenewalChecklist(firmId: string, renewalId: string) {
    const renewal = await prisma.renewal.findFirst({
      where: { id: renewalId, firmId },
      include: { checklistItems: { orderBy: { createdAt: 'asc' as const } }, policy: { include: { client: true } } },
    });

    if (!renewal) throw new Error('Renewal not found');

    const items = renewal.checklistItems;
    const signOffTypes = ITEMS_REQUIRING_SIGN_OFF as readonly string[];

    const completedCount = items.filter(
      i => i.status === 'approved' || (i.status === 'completed' && !signOffTypes.includes(i.itemType))
    ).length;

    return {
      items,
      completedCount,
      totalCount: items.length,
      completionRate: items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0,
      dueDate: renewal.dueDate,
      clientName: renewal.policy.client.name,
      policyNumber: renewal.policy.policyNumber,
    };
  }

  private async updateRenewalStatus(firmId: string, renewalId: string) {
    const renewal = await prisma.renewal.findFirst({
      where: { id: renewalId, firmId },
      include: { checklistItems: true },
    });

    if (!renewal) return;

    const completedCount = renewal.checklistItems.filter(
      i => i.status === 'approved' || i.status === 'completed'
    ).length;
    const totalCount = renewal.checklistItems.length;

    const newStatus = calculateRenewalStatus(
      renewal.dueDate,
      completedCount,
      totalCount
    );

    if (newStatus !== renewal.status) {
      const oldStatus = renewal.status;
      await prisma.renewal.update({
        where: { id: renewalId },
        data: { status: newStatus },
      });

      // Log renewal status change audit event
      await prisma.auditEvent.create({
        data: {
          firmId,
          action: 'renewal.status_changed',
          entityType: 'renewal',
          entityId: renewalId,
          metadata: { oldStatus, newStatus },
        },
      });
    }
  }
}
