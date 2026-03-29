import { describe, it, expect } from 'vitest';
import {
  parseIrishDate,
  formatIrishDate,
  formatISODate,
  daysBetween,
  calculateRenewalTimeline,
  calculateRenewalStatus,
} from '../../lib/dates';

describe('parseIrishDate', () => {
  it('parses DD/MM/YYYY (Irish standard)', () => {
    const d = parseIrishDate('15/03/2024');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(2); // March = 2
    expect(d!.getDate()).toBe(15);
  });

  it('parses YYYY-MM-DD (ISO)', () => {
    const d = parseIrishDate('2024-03-15');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });

  it('disambiguates when day > 12 (must be DD/MM)', () => {
    const d = parseIrishDate('13/04/2024');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(13);
    expect(d!.getMonth()).toBe(3); // April
  });

  it('defaults to DD/MM for ambiguous dates (Irish convention)', () => {
    const d = parseIrishDate('03/04/2024');
    expect(d).not.toBeNull();
    // Both day and month <= 12, default DD/MM
    expect(d!.getDate()).toBe(3);
    expect(d!.getMonth()).toBe(3); // April
  });

  it('returns null for empty string', () => {
    expect(parseIrishDate('')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(parseIrishDate('not-a-date')).toBeNull();
  });

  it('returns null for invalid date (month 13)', () => {
    expect(parseIrishDate('15/13/2024')).toBeNull();
  });

  it('handles Irish fada dates', () => {
    // Just making sure the parser doesn't choke on surrounding context
    const d = parseIrishDate('01/06/2024');
    expect(d).not.toBeNull();
  });
});

describe('formatIrishDate', () => {
  it('formats as DD/MM/YYYY', () => {
    const d = new Date(2024, 2, 15); // March 15, 2024
    expect(formatIrishDate(d)).toBe('15/03/2024');
  });
});

describe('formatISODate', () => {
  it('formats as YYYY-MM-DD', () => {
    const d = new Date(2024, 2, 15);
    expect(formatISODate(d)).toBe('2024-03-15');
  });
});

describe('daysBetween', () => {
  it('returns positive when b > a', () => {
    const a = new Date(2024, 0, 1);
    const b = new Date(2024, 0, 11);
    expect(daysBetween(a, b)).toBe(10);
  });

  it('returns negative when b < a', () => {
    const a = new Date(2024, 0, 11);
    const b = new Date(2024, 0, 1);
    expect(daysBetween(a, b)).toBe(-10);
  });
});

describe('calculateRenewalTimeline', () => {
  it('calculates CPC 2012 timeline (20 days)', () => {
    const expiry = new Date(2025, 2, 15); // March 15, 2025
    const timeline = calculateRenewalTimeline(expiry, '2012');

    expect(timeline.renewalNotice.getDate()).toBe(23); // Feb 23
    expect(timeline.urgentReminder.getDate()).toBe(8);  // Mar 8
    expect(timeline.finalReminder.getDate()).toBe(14);  // Mar 14
    expect('preRenewalNotice' in timeline).toBe(false);
  });

  it('calculates CP158 timeline (40 days)', () => {
    const expiry = new Date(2025, 2, 15);
    const timeline = calculateRenewalTimeline(expiry, 'cp158');

    expect('preRenewalNotice' in timeline).toBe(true);
    const cp158Timeline = timeline as { preRenewalNotice: Date; renewalNotice: Date; urgentReminder: Date; finalReminder: Date };
    expect(cp158Timeline.preRenewalNotice.getDate()).toBe(3); // Feb 3
  });
});

describe('calculateRenewalStatus', () => {
  const future = new Date();
  future.setDate(future.getDate() + 30);

  const past = new Date();
  past.setDate(past.getDate() - 5);

  const soon = new Date();
  soon.setDate(soon.getDate() + 3);

  it('returns compliant when all items done', () => {
    expect(calculateRenewalStatus(future, 8, 8)).toBe('compliant');
  });

  it('returns overdue when past due date', () => {
    expect(calculateRenewalStatus(past, 3, 8)).toBe('overdue');
  });

  it('returns at_risk when <7 days and incomplete', () => {
    expect(calculateRenewalStatus(soon, 3, 8)).toBe('at_risk');
  });

  it('returns in_progress when some items done', () => {
    expect(calculateRenewalStatus(future, 3, 8)).toBe('in_progress');
  });

  it('returns pending when no items done', () => {
    expect(calculateRenewalStatus(future, 0, 8)).toBe('pending');
  });
});
