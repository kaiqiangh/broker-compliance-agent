import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    incomingEmail: {
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    firm: {
      findMany: vi.fn(),
    },
    agentAction: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    agentMetricsDaily: {
      upsert: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../services/agent/pipeline', () => ({
  processEmail: vi.fn(),
}));

vi.mock('../../services/agent/notifications', () => ({
  sendDailyDigest: vi.fn().mockResolvedValue(undefined),
  checkAccuracyTrend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/email/oauth/poller', () => ({
  pollConnectedMailboxes: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../lib/email/imap/poller', () => ({
  pollIMAPConnections: vi.fn().mockResolvedValue(0),
}));

import { prisma } from '../../lib/prisma';
import { checkAccuracyTrend, sendDailyDigest } from '../../services/agent/notifications';
import {
  aggregateDailyMetrics,
  createAgentMaintenanceState,
  runAgentMaintenanceTick,
} from '../../worker/agent-runtime';

describe('agent-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs accuracy trend checks after daily metrics aggregation', async () => {
    (prisma.firm.findMany as any).mockResolvedValue([{ id: 'firm-1' }]);
    (prisma.incomingEmail.count as any).mockResolvedValue(1);
    (prisma.agentAction.count as any).mockResolvedValue(1);
    (prisma.agentAction.findMany as any).mockResolvedValue([
      { confidence: 0.9 },
      { confidence: 0.8 },
    ]);
    (prisma.agentMetricsDaily.upsert as any).mockResolvedValue({});

    await aggregateDailyMetrics();

    expect(prisma.agentMetricsDaily.upsert).toHaveBeenCalled();
    expect(checkAccuracyTrend).toHaveBeenCalledWith('firm-1');
    expect(sendDailyDigest).toHaveBeenCalledWith('firm-1');
  });

  it('polls mailboxes every 60s and aggregates metrics once per day', async () => {
    const deps = {
      detectStaleEmails: vi.fn().mockResolvedValue(2),
      processPendingEmails: vi.fn().mockResolvedValue(3),
      pollConnectedMailboxes: vi.fn().mockResolvedValue(4),
      pollIMAPConnections: vi.fn().mockResolvedValue(5),
      hasAggregatedMetricsForDate: vi.fn().mockResolvedValue(false),
      aggregateDailyMetrics: vi.fn().mockResolvedValue(undefined),
    };

    const firstTickTime = new Date('2026-04-01T09:00:00.000Z');
    const state = createAgentMaintenanceState(firstTickTime);

    const firstTick = await runAgentMaintenanceTick(state, firstTickTime, deps);

    expect(firstTick).toEqual({
      requeuedEmails: 2,
      processedEmails: 3,
      polledEmails: 9,
      aggregatedMetrics: true,
    });
    expect(deps.aggregateDailyMetrics).toHaveBeenCalledTimes(1);

    const secondTick = await runAgentMaintenanceTick(
      state,
      new Date('2026-04-01T09:00:30.000Z'),
      deps
    );

    expect(secondTick.polledEmails).toBe(0);
    expect(secondTick.aggregatedMetrics).toBe(false);
    expect(deps.pollConnectedMailboxes).toHaveBeenCalledTimes(1);
    expect(deps.pollIMAPConnections).toHaveBeenCalledTimes(1);
    expect(deps.aggregateDailyMetrics).toHaveBeenCalledTimes(1);
    expect(deps.hasAggregatedMetricsForDate).toHaveBeenCalledTimes(1);
  });
});
