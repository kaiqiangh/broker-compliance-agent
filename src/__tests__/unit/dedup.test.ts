import { describe, it, expect } from 'vitest';
import {
  normalizePolicyNumber,
  normalizeInsurerName,
  computeDedupHash,
  parsePremium,
  formatPremium,
  parseCommission,
} from '../../lib/dedup';

describe('normalizePolicyNumber', () => {
  it('removes hyphens', () => {
    expect(normalizePolicyNumber('POL-2024-001')).toBe('POL2024001');
  });

  it('removes spaces', () => {
    expect(normalizePolicyNumber('POL 2024 001')).toBe('POL2024001');
  });

  it('removes dots', () => {
    expect(normalizePolicyNumber('pol.2024.001')).toBe('POL2024001');
  });

  it('uppercases', () => {
    expect(normalizePolicyNumber('pol-2024-001')).toBe('POL2024001');
  });

  it('trims whitespace', () => {
    expect(normalizePolicyNumber('  POL-2024-001  ')).toBe('POL2024001');
  });

  it('handles mixed separators', () => {
    expect(normalizePolicyNumber('POL/2024.001-A')).toBe('POL2024001A');
  });

  it('handles empty string', () => {
    expect(normalizePolicyNumber('')).toBe('');
  });

  it('normalizes equivalent formats to same value', () => {
    const variants = ['POL-2024-001', 'POL 2024 001', 'pol.2024.001', 'POL2024001'];
    const normalized = variants.map(normalizePolicyNumber);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('POL2024001');
  });
});

describe('normalizeInsurerName', () => {
  it('uppercases and strips special chars', () => {
    expect(normalizeInsurerName('Aviva')).toBe('AVIVA');
    expect(normalizeInsurerName('Zurich Insurance')).toBe('ZURICHINSURANCE');
  });

  it('handles Irish insurers', () => {
    expect(normalizeInsurerName('FBD')).toBe('FBD');
    expect(normalizeInsurerName('Liberty Seguros')).toBe('LIBERTYSEGUROS');
  });
});

describe('computeDedupHash', () => {
  it('produces consistent hashes for same inputs', () => {
    const hash1 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL-2024-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    const hash2 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL-2024-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    expect(hash1).toBe(hash2);
  });

  it('normalizes policy numbers before hashing', () => {
    const hash1 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL-2024-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    const hash2 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'pol.2024.001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inception dates (renewal vs duplicate)', () => {
    const hash1 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    const hash2 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2025-03-15',
    });
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different firms', () => {
    const hash1 = computeDedupHash({
      firmId: 'firm-1',
      policyNumber: 'POL-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    const hash2 = computeDedupHash({
      firmId: 'firm-2',
      policyNumber: 'POL-001',
      policyType: 'motor',
      insurerName: 'Aviva',
      inceptionDate: '2024-03-15',
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe('parsePremium', () => {
  it('parses EUR with symbol and comma', () => {
    expect(parsePremium('€1,245.00')).toBe(1245.00);
  });

  it('parses EUR with symbol only', () => {
    expect(parsePremium('€1245.00')).toBe(1245.00);
  });

  it('parses plain number', () => {
    expect(parsePremium('1245.00')).toBe(1245.00);
  });

  it('handles GBP symbol', () => {
    expect(parsePremium('£1,245.00')).toBe(1245.00);
  });

  it('handles empty string', () => {
    expect(parsePremium('')).toBe(0);
  });

  it('handles invalid input', () => {
    expect(parsePremium('abc')).toBe(0);
  });
});

describe('formatPremium', () => {
  it('formats with EUR symbol and comma separator', () => {
    expect(formatPremium(1245)).toBe('€1,245.00');
  });

  it('formats small amounts', () => {
    expect(formatPremium(890)).toBe('€890.00');
  });

  it('formats large amounts', () => {
    expect(formatPremium(4200)).toBe('€4,200.00');
  });
});

describe('parseCommission', () => {
  it('parses percentage with symbol', () => {
    expect(parseCommission('12.5%')).toBe(12.5);
  });

  it('parses percentage without symbol', () => {
    expect(parseCommission('12.5')).toBe(12.5);
  });

  it('handles empty string', () => {
    expect(parseCommission('')).toBe(0);
  });
});
