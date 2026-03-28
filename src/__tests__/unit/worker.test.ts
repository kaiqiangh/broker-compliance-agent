import { describe, it, expect } from 'vitest';

// Worker job processor logic tests (no DB required)

describe('Job processor — retry logic', () => {
  it('calculates backoff delay based on attempt count', () => {
    const RETRY_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

    function getRetryTime(attempt: number): Date {
      const delay = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
      return new Date(Date.now() + delay);
    }

    const retry1 = getRetryTime(1);
    const retry2 = getRetryTime(2);
    const retry3 = getRetryTime(3);

    // Each retry should be later than the previous
    expect(retry2.getTime()).toBeGreaterThan(retry1.getTime());
    expect(retry3.getTime()).toBeGreaterThan(retry2.getTime());

    // Exponential backoff: retry2 ~2x retry1 delay, retry3 ~4x
    const delay1 = retry1.getTime() - Date.now();
    const delay2 = retry2.getTime() - Date.now();
    const delay3 = retry3.getTime() - Date.now();

    expect(delay1).toBeGreaterThanOrEqual(RETRY_BACKOFF_MS - 100);
    expect(delay1).toBeLessThanOrEqual(RETRY_BACKOFF_MS + 100);
    expect(delay2).toBeGreaterThanOrEqual(RETRY_BACKOFF_MS * 2 - 100);
    expect(delay3).toBeGreaterThanOrEqual(RETRY_BACKOFF_MS * 4 - 100);
  });

  it('max attempts limits retries', () => {
    const MAX_ATTEMPTS = 3;

    function shouldRetry(attempts: number, maxAttempts: number): boolean {
      return attempts < maxAttempts;
    }

    expect(shouldRetry(1, MAX_ATTEMPTS)).toBe(true);
    expect(shouldRetry(2, MAX_ATTEMPTS)).toBe(true);
    expect(shouldRetry(3, MAX_ATTEMPTS)).toBe(false);
    expect(shouldRetry(4, MAX_ATTEMPTS)).toBe(false);
  });
});

describe('Notification scheduler — day matching', () => {
  function daysUntil(target: Date, from: Date = new Date()): number {
    return Math.ceil((target.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }

  it('calculates days until expiry correctly', () => {
    const now = new Date();
    const in40Days = new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000);
    const in20Days = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    expect(daysUntil(in40Days, now)).toBe(40);
    expect(daysUntil(in20Days, now)).toBe(20);
    expect(daysUntil(in7Days, now)).toBe(7);
    expect(daysUntil(yesterday, now)).toBe(-1);
  });

  it('matches reminder type to day threshold', () => {
    const configs = [
      { type: '40_day', minDays: 21, maxDays: 40 },
      { type: '20_day', minDays: 8, maxDays: 20 },
      { type: '7_day', minDays: 2, maxDays: 7 },
      { type: '1_day', minDays: 1, maxDays: 1 },
    ];

    function matchReminder(daysUntilDue: number) {
      if (daysUntilDue <= 0) return 'overdue';
      for (const config of configs) {
        if (daysUntilDue >= config.minDays && daysUntilDue <= config.maxDays) return config.type;
      }
      return null;
    }

    expect(matchReminder(40)).toBe('40_day');
    expect(matchReminder(35)).toBe('40_day');
    expect(matchReminder(21)).toBe('40_day');
    expect(matchReminder(20)).toBe('20_day');
    expect(matchReminder(15)).toBe('20_day');
    expect(matchReminder(8)).toBe('20_day');
    expect(matchReminder(7)).toBe('7_day');
    expect(matchReminder(3)).toBe('7_day');
    expect(matchReminder(2)).toBe('7_day');
    expect(matchReminder(1)).toBe('1_day');
    expect(matchReminder(0)).toBe('overdue');
    expect(matchReminder(-5)).toBe('overdue');
    expect(matchReminder(50)).toBeNull();
  });
});

describe('Email template data', () => {
  it('builds email context from renewal data', () => {
    const renewal = {
      clientName: 'Seán Ó Briain',
      policyNumber: 'POL-2024-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      expiryDate: new Date('2025-03-15'),
      premium: 1245,
      checklistProgress: '3/8',
      daysUntilDue: 20,
    };

    const emailContext = {
      subject: `Renewal action required: ${renewal.clientName} — ${renewal.policyNumber}`,
      body: `Policy ${renewal.policyNumber} (${renewal.policyType}, ${renewal.insurerName}) for ${renewal.clientName} expires in ${renewal.daysUntilDue} days. Checklist: ${renewal.checklistProgress}. Premium: €${renewal.premium}.`,
    };

    expect(emailContext.subject).toContain('Seán Ó Briain');
    expect(emailContext.subject).toContain('POL-2024-001');
    expect(emailContext.body).toContain('20 days');
    expect(emailContext.body).toContain('3/8');
    expect(emailContext.body).toContain('€1245');
  });
});
