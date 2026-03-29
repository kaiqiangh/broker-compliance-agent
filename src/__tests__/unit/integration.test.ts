/**
 * Integration tests for the import → renewals → checklist flow.
 * Tests the full pipeline without mocking DB (uses in-memory patterns).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCSV } from '../../lib/csv-parser';
import { calculateRenewalStatus, daysBetween, parseIrishDate } from '../../lib/dates';
import { computeDedupHash, normalizePolicyNumber } from '../../lib/dedup';
import { escapeHtml } from '../../lib/html';
import {
  canTransition,
  transitionChecklistItem,
  CHECKLIST_DEFINITIONS,
  ITEMS_REQUIRING_SIGN_OFF,
} from '../../lib/checklist-state';
import type { ChecklistStatus } from '../../lib/checklist-state';

describe('Full CPC compliance pipeline', () => {
  // ─── CSV Import → Parse ────────────────────────────────

  describe('CSV Import Pipeline', () => {
    const appliedEpicCsv = Buffer.from(
      'PolicyRef,ClientName,ClientAddress,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium,Commission,NCB\n' +
      'POL-001,John Murphy,123 Main St Dublin,motor,Allianz,15/03/2024,15/03/2025,1250.00,12.5,5\n' +
      'POL-002,Mary OBrien,456 Oak Ave Cork,home,Zurich,01/06/2024,01/06/2025,890.00,15.0,0\n' +
      'POL-003,Patricia Kelly,N/A,commercial,AXA,22/09/2024,22/09/2025,2100.00,10.0,0\n'
    );

    it('parses Applied Epic format correctly', () => {
      const result = parseCSV(appliedEpicCsv);
      expect(result.format).toBe('applied_epic');
      expect(result.policies).toHaveLength(3);
      expect(result.policies[0].policyNumber).toBe('POL-001');
      expect(result.policies[0].clientName).toBe('John Murphy');
      expect(result.policies[0].premium).toBe(1250);
      expect(result.policies[0].ncb).toBe(5);
    });

    it('handles missing optional fields gracefully', () => {
      const result = parseCSV(appliedEpicCsv);
      const policy3 = result.policies[2];
      expect(policy3.ncb).toBe(0); // NCB=0 is preserved, not dropped
      expect(policy3.commission).toBe(10);
      // Address "N/A" is accepted (non-empty string)
      expect(policy3.clientAddress).toBe('N/A');
    });

    it('validates required fields and reports errors', () => {
      const badCsv = Buffer.from(
        'PolicyRef,ClientName,InceptionDate,ExpiryDate,Premium\n' +
        ',John Murphy,15/03/2024,15/03/2025,1250.00\n' +
        'POL-002,,01/06/2024,01/06/2025,890.00\n'
      );
      const result = parseCSV(badCsv);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.field === 'policyNumber')).toBe(true);
      expect(result.errors.some(e => e.field === 'clientName')).toBe(true);
    });

    it('generates deterministic dedup hashes', () => {
      const hash1 = computeDedupHash({
        firmId: 'firm-1',
        policyNumber: 'POL-001',
        policyType: 'motor',
        insurerName: 'Allianz',
        inceptionDate: '2024-03-15',
      });
      const hash2 = computeDedupHash({
        firmId: 'firm-1',
        policyNumber: 'POL-001',
        policyType: 'motor',
        insurerName: 'Allianz',
        inceptionDate: '2024-03-15',
      });
      expect(hash1).toBe(hash2);
    });

    it('different firms get different hashes', () => {
      const hash1 = computeDedupHash({
        firmId: 'firm-1',
        policyNumber: 'POL-001',
        policyType: 'motor',
        insurerName: 'Allianz',
        inceptionDate: '2024-03-15',
      });
      const hash2 = computeDedupHash({
        firmId: 'firm-2',
        policyNumber: 'POL-001',
        policyType: 'motor',
        insurerName: 'Allianz',
        inceptionDate: '2024-03-15',
      });
      expect(hash1).not.toBe(hash2);
    });

    it('normalizes policy numbers consistently', () => {
      expect(normalizePolicyNumber('POL-001')).toBe(normalizePolicyNumber('pol-001'));
      expect(normalizePolicyNumber('POL-001')).toBe(normalizePolicyNumber('POL 001'));
      expect(normalizePolicyNumber('POL-001')).toBe(normalizePolicyNumber('pol001'));
    });
  });

  // ─── Date Processing ──────────────────────────────────

  describe('Date Processing', () => {
    it('parses Irish date format (DD/MM/YYYY)', () => {
      const date = parseIrishDate('15/03/2024');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2); // March = 2
      expect(date!.getDate()).toBe(15);
    });

    it('parses ISO date format (YYYY-MM-DD)', () => {
      const date = parseIrishDate('2024-03-15');
      expect(date).not.toBeNull();
      expect(date!.getFullYear()).toBe(2024);
      expect(date!.getMonth()).toBe(2);
      expect(date!.getDate()).toBe(15);
    });

    it('rejects invalid dates (Feb 30)', () => {
      expect(parseIrishDate('30/02/2024')).toBeNull();
    });

    it('rejects invalid dates (day 32)', () => {
      expect(parseIrishDate('32/01/2024')).toBeNull();
    });

    it('accepts leap year Feb 29', () => {
      expect(parseIrishDate('29/02/2024')).not.toBeNull();
    });

    it('rejects non-leap year Feb 29', () => {
      expect(parseIrishDate('29/02/2023')).toBeNull();
    });

    it('calculates calendar days correctly', () => {
      const a = new Date(2024, 2, 15); // March 15
      const b = new Date(2024, 2, 20); // March 20
      expect(daysBetween(a, b)).toBe(5);
    });

    it('handles same-day comparison', () => {
      const a = new Date(2024, 2, 15, 10, 30);
      const b = new Date(2024, 2, 15, 22, 45);
      expect(daysBetween(a, b)).toBe(0);
    });
  });

  // ─── Renewal Status Calculation ───────────────────────

  describe('Renewal Status', () => {
    it('empty checklist is pending, not compliant', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      expect(calculateRenewalStatus(futureDate, 0, 0)).toBe('pending');
    });

    it('empty checklist past due is overdue', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      expect(calculateRenewalStatus(pastDate, 0, 0)).toBe('overdue');
    });

    it('all items completed = compliant', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      expect(calculateRenewalStatus(futureDate, 8, 8)).toBe('compliant');
    });

    it('partial completion + > 7 days = in_progress', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      expect(calculateRenewalStatus(futureDate, 3, 8)).toBe('in_progress');
    });

    it('partial completion + <= 7 days = at_risk', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      expect(calculateRenewalStatus(futureDate, 3, 8)).toBe('at_risk');
    });

    it('past due = overdue regardless of completion', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      expect(calculateRenewalStatus(pastDate, 5, 8)).toBe('overdue');
    });

    it('no completion + future = pending', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      expect(calculateRenewalStatus(futureDate, 0, 8)).toBe('pending');
    });
  });

  // ─── Checklist State Machine ──────────────────────────

  describe('Checklist State Machine', () => {
    it('follows complete path: pending → in_progress → completed', () => {
      expect(canTransition('pending', 'in_progress')).toBe(true);
      expect(canTransition('in_progress', 'completed')).toBe(true);
    });

    it('follows sign-off path: completed → pending_review → approved', () => {
      expect(canTransition('completed', 'pending_review')).toBe(true);
      expect(canTransition('pending_review', 'approved')).toBe(true);
    });

    it('follows rejection path: pending_review → rejected → in_progress', () => {
      expect(canTransition('pending_review', 'rejected')).toBe(true);
      expect(canTransition('rejected', 'in_progress')).toBe(true);
    });

    it('rejects invalid transitions', () => {
      expect(canTransition('pending', 'completed')).toBe(false);
      expect(canTransition('pending', 'approved')).toBe(false);
      expect(canTransition('approved', 'pending')).toBe(false);
      expect(canTransition('approved', 'in_progress')).toBe(false);
    });

    it('approved is terminal', () => {
      expect(canTransition('approved', 'pending')).toBe(false);
      expect(canTransition('approved', 'in_progress')).toBe(false);
      expect(canTransition('approved', 'completed')).toBe(false);
      expect(canTransition('approved', 'rejected')).toBe(false);
    });

    it('transitionChecklistItem returns success/error correctly', () => {
      const valid = transitionChecklistItem('pending', 'in_progress');
      expect(valid.success).toBe(true);

      const invalid = transitionChecklistItem('pending', 'approved');
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error).toContain('Invalid transition');
      }
    });

    it('all 8 checklist items are defined', () => {
      expect(CHECKLIST_DEFINITIONS).toHaveLength(8);
      const types = CHECKLIST_DEFINITIONS.map(d => d.type);
      expect(types).toContain('renewal_notification');
      expect(types).toContain('suitability_assessment');
      expect(types).toContain('final_sign_off');
    });

    it('sign-off items are correctly identified', () => {
      expect(ITEMS_REQUIRING_SIGN_OFF).toContain('suitability_assessment');
      expect(ITEMS_REQUIRING_SIGN_OFF).toContain('final_sign_off');
      expect(ITEMS_REQUIRING_SIGN_OFF).not.toContain('renewal_notification');
      expect(ITEMS_REQUIRING_SIGN_OFF).not.toContain('premium_disclosure');
    });
  });

  // ─── HTML Escaping (XSS Prevention) ──────────────────

  describe('HTML Escaping', () => {
    it('escapes script tags', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('escapes ampersands', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("it's")).toBe("it&#x27;s");
    });

    it('escapes backticks', () => {
      expect(escapeHtml('`template`')).toBe('&#x60;template&#x60;');
    });

    it('handles null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('handles numbers', () => {
      expect(escapeHtml(42)).toBe('42');
      expect(escapeHtml(0)).toBe('0');
    });

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  // ─── End-to-End Flow ──────────────────────────────────

  describe('E2E: Import → Status → Checklist → Compliant', () => {
    it('simulates full renewal lifecycle', () => {
      // 1. Parse CSV
      const csv = Buffer.from(
        'PolicyRef,ClientName,InceptionDate,ExpiryDate,Premium\n' +
        'POL-100,Test Client,15/03/2024,15/03/2025,1000.00\n'
      );
      const parsed = parseCSV(csv);
      expect(parsed.policies).toHaveLength(1);

      // 2. Calculate initial status (no checklist items = pending)
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1); // 1 year in the future
      let status = calculateRenewalStatus(expiryDate, 0, 0);
      expect(status).toBe('pending');

      // 3. Checklist items materialized (8 items)
      const totalItems = CHECKLIST_DEFINITIONS.length;
      status = calculateRenewalStatus(expiryDate, 0, totalItems);
      expect(status).toBe('pending');

      // 4. Complete non-sign-off items (6 items)
      let completed = 0;
      for (const item of CHECKLIST_DEFINITIONS) {
        if (!ITEMS_REQUIRING_SIGN_OFF.includes(item.type)) {
          // Simulate: pending → in_progress → completed
          expect(canTransition('pending', 'in_progress')).toBe(true);
          completed++;
        }
      }
      status = calculateRenewalStatus(expiryDate, completed, totalItems);
      expect(status).toBe('in_progress');

      // 5. Complete sign-off items (2 items → pending_review)
      for (const item of CHECKLIST_DEFINITIONS) {
        if (ITEMS_REQUIRING_SIGN_OFF.includes(item.type)) {
          expect(canTransition('in_progress', 'completed')).toBe(true);
          completed++;
        }
      }

      // 6. Approve all items → compliant
      status = calculateRenewalStatus(expiryDate, totalItems, totalItems);
      expect(status).toBe('compliant');
    });
  });
});
