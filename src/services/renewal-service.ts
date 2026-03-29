import { prisma } from '../lib/prisma';
import { calculateRenewalStatus, daysBetween } from '../lib/dates';
import { CHECKLIST_DEFINITIONS } from '../lib/checklist-state';

export class RenewalService {
  /**
   * Generate renewals for policies expiring within the next 90 days
   */
  async generateRenewals(firmId: string): Promise<number> {
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    // Find policies that need renewals (expiring soon, no existing renewal)
    const policies = await prisma.policy.findMany({
      where: {
        firmId,
        policyStatus: 'active',
        expiryDate: { lte: ninetyDaysFromNow },
        renewals: { none: {} }, // no existing renewal
      },
    });

    let created = 0;

    for (const policy of policies) {
      // Create renewal
      const renewal = await prisma.renewal.create({
        data: {
          firmId,
          policyId: policy.id,
          dueDate: policy.expiryDate,
          status: 'pending',
        },
      });

      // Materialize checklist items
      for (const itemDef of CHECKLIST_DEFINITIONS) {
        await prisma.checklistItem.create({
          data: {
            firmId,
            renewalId: renewal.id,
            itemType: itemDef.type,
            status: 'pending',
            assignedTo: policy.adviserId || null,
          },
        });
      }

      created++;
    }

    // Log audit event
    if (created > 0) {
      await prisma.auditEvent.create({
        data: {
          firmId,
          action: 'renewal.batch_generate',
          entityType: 'renewal',
          metadata: { count: created },
        },
      });
    }

    return created;
  }

  /**
   * Get renewal timeline for dashboard
   */
  async getTimeline(firmId: string, options?: {
    status?: string;
    policyType?: string;
    daysAhead?: number;
  }) {
    const daysAhead = options?.daysAhead || 90;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const renewals = await prisma.renewal.findMany({
      where: {
        firmId,
        dueDate: { lte: futureDate },
        ...(options?.status ? { status: options.status } : {}),
        ...(options?.policyType ? { policy: { policyType: options.policyType } } : {}),
      },
      include: {
        policy: {
          include: { client: true },
        },
        checklistItems: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    return renewals.map(renewal => {
      const completedCount = renewal.checklistItems.filter(
        i => i.status === 'approved'
      ).length;
      const totalCount = renewal.checklistItems.length;
      const calculatedStatus = calculateRenewalStatus(
        renewal.dueDate,
        completedCount,
        totalCount
      );

      return {
        id: renewal.id,
        clientName: renewal.policy.client.name,
        policyNumber: renewal.policy.policyNumber,
        policyType: renewal.policy.policyType,
        insurerName: renewal.policy.insurerName,
        dueDate: renewal.dueDate,
        premium: renewal.policy.premium,
        newPremium: renewal.newPremium,
        status: calculatedStatus,
        checklistProgress: `${completedCount}/${totalCount}`,
        completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
        daysUntilDue: daysBetween(new Date(), renewal.dueDate),
      };
    });
  }

  /**
   * Get dashboard summary stats
   */
  async getDashboardStats(firmId: string) {
    const renewals = await this.getTimeline(firmId);

    // Current quarter filter for compliance score
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0, 23, 59, 59, 999);

    const quarterlyRenewals = renewals.filter(r => {
      const due = new Date(r.dueDate);
      return due >= quarterStart && due <= quarterEnd;
    });

    const byStatus = {
      pending: 0,
      in_progress: 0,
      at_risk: 0,
      compliant: 0,
      overdue: 0,
    };

    for (const r of renewals) {
      byStatus[r.status as keyof typeof byStatus]++;
    }

    const total = renewals.length;
    const quarterlyTotal = quarterlyRenewals.length;
    const quarterlyCompliant = quarterlyRenewals.filter(r => r.status === 'compliant').length;
    const complianceRate = quarterlyTotal > 0
      ? Math.round((quarterlyCompliant / quarterlyTotal) * 100)
      : (total > 0 ? Math.round((byStatus.compliant / total) * 100) : 100);

    const upcomingDeadlines = renewals
      .filter(r => r.daysUntilDue <= 30 && r.daysUntilDue >= 0)
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
      .slice(0, 10);

    const overdueItems = renewals
      .filter(r => r.status === 'overdue')
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    return {
      totalRenewals: total,
      byStatus,
      complianceRate,
      compliancePeriod: 'quarter',
      upcomingDeadlines,
      overdueItems,
    };
  }
}
