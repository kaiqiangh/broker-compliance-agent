import { describe, it, expect } from 'vitest';
import { calculateRenewalStatus } from '../../lib/dates';
import { computeDedupHash } from '../../lib/dedup';
import { parseCSV } from '../../lib/csv-parser';
import { parseIrishDate } from '../../lib/dates';

describe('Regression: empty checklist should not be compliant', () => {
  const future = new Date();
  future.setDate(future.getDate() + 30);

  it('returns pending for empty checklist (0/0)', () => {
    // Bug: 0 >= 0 was true → returned compliant
    expect(calculateRenewalStatus(future, 0, 0)).toBe('pending');
  });

  it('returns overdue for empty checklist past due', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    expect(calculateRenewalStatus(past, 0, 0)).toBe('overdue');
  });
});

describe('Regression: NCB = 0 should be preserved', () => {
  it('preserves NCB=0 from CSV', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium,NCB
POL-001,New Driver,Motor,Aviva,15/03/2024,14/03/2025,€2500.00,0`;
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].ncb).toBe(0);
  });

  it('preserves empty NCB as undefined', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium,NCB
POL-001,Test,Motor,Aviva,15/03/2024,14/03/2025,€1000.00,`;
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].ncb).toBeUndefined();
  });
});

describe('Regression: invalid dates should not be silently accepted', () => {
  it('rejects Feb 30', () => {
    expect(parseIrishDate('30/02/2024')).toBeNull();
  });

  it('rejects day 32', () => {
    expect(parseIrishDate('32/01/2024')).toBeNull();
  });

  it('rejects day 0', () => {
    expect(parseIrishDate('00/05/2024')).toBeNull();
  });

  it('rejects month 0', () => {
    expect(parseIrishDate('15/00/2024')).toBeNull();
  });

  it('accepts valid Feb 29 in leap year', () => {
    const d = parseIrishDate('29/02/2024');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(29);
    expect(d!.getMonth()).toBe(1);
  });

  it('rejects Feb 29 in non-leap year', () => {
    expect(parseIrishDate('29/02/2023')).toBeNull();
  });
});

describe('Regression: invalid CSV dates should produce empty string, not raw input', () => {
  it('invalid date becomes empty string in inceptionDate', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium
POL-001,Test,Motor,Aviva,not-a-date,14/03/2025,1000`;
    const result = parseCSV(Buffer.from(csv));
    // invalid inception → empty string → validation catches it
    expect(result.policies).toHaveLength(0);
    expect(result.errors.some(e => e.field === 'inceptionDate')).toBe(true);
  });
});

describe('Regression: dedup hash separator collision', () => {
  it('produces different hashes despite separator collision', () => {
    // These two inputs would collide if separator was "||"
    // With \x00 separator, they should be different
    const hash1 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL||A',  // contains "||"
      policyType: 'B',
      insurerName: 'X',
      inceptionDate: '2024-01-01',
    });
    const hash2 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL',
      policyType: 'A||B',  // contains "||"
      insurerName: 'X',
      inceptionDate: '2024-01-01',
    });
    // With old || separator these could collide
    // With \x00 separator they should always be different
    expect(hash1).not.toBe(hash2);
  });
});
