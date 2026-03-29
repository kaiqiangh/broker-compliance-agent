import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Prisma schema onDelete cascade rules', () => {
  let schema: string;

  beforeAll(() => {
    schema = readFileSync(
      resolve(__dirname, '../../../prisma/schema.prisma'),
      'utf-8'
    );
  });

  describe('Firm relations cascade', () => {
    it('Firm → User: onDelete Cascade', () => {
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/);
      expect(userBlock).toBeTruthy();
      expect(userBlock![0]).toMatch(/firm\s+Firm\s+@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Client: onDelete Cascade', () => {
      const clientBlock = schema.match(/model Client \{[\s\S]*?\n\}/);
      expect(clientBlock).toBeTruthy();
      expect(clientBlock![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Policy: onDelete Cascade', () => {
      const policyBlock = schema.match(/model Policy \{[\s\S]*?\n\}/);
      expect(policyBlock).toBeTruthy();
      expect(policyBlock![0]).toMatch(/firm\s+Firm\s+@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Renewal: onDelete Cascade', () => {
      const renewalBlock = schema.match(/model Renewal \{[\s\S]*?\n\}/);
      expect(renewalBlock).toBeTruthy();
      expect(renewalBlock![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → ChecklistItem: onDelete Cascade', () => {
      const block = schema.match(/model ChecklistItem \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Document: onDelete Cascade', () => {
      const block = schema.match(/model Document \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Import: onDelete Cascade', () => {
      const block = schema.match(/model Import \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → AuditEvent: onDelete Cascade', () => {
      const block = schema.match(/model AuditEvent \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Notification: onDelete Cascade', () => {
      const block = schema.match(/model Notification \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → PCFRole: onDelete Cascade', () => {
      const block = schema.match(/model PCFRole \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → ConductTraining: onDelete Cascade', () => {
      const block = schema.match(/model ConductTraining \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });

    it('Firm → Attestation: onDelete Cascade', () => {
      const block = schema.match(/model Attestation \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/@relation\(fields:\s*\[firmId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    });
  });

  describe('Client → Policy cascades on delete', () => {
    it('Client policies are deleted when client is deleted', () => {
      const policyBlock = schema.match(/model Policy \{[\s\S]*?\n\}/);
      expect(policyBlock).toBeTruthy();
      expect(policyBlock![0]).toMatch(
        /client\s+Client\s+@relation\(fields:\s*\[clientId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
      );
    });
  });

  describe('Policy → Renewal cascades on delete', () => {
    it('Renewals are deleted when policy is deleted', () => {
      const renewalBlock = schema.match(/model Renewal \{[\s\S]*?\n\}/);
      expect(renewalBlock).toBeTruthy();
      expect(renewalBlock![0]).toMatch(
        /policy\s+Policy\s+@relation\(fields:\s*\[policyId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
      );
    });
  });

  describe('Renewal → ChecklistItem cascades on delete', () => {
    it('ChecklistItems are deleted when renewal is deleted', () => {
      const block = schema.match(/model ChecklistItem \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(
        /renewal\s+Renewal\s+@relation\(fields:\s*\[renewalId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/
      );
    });
  });

  describe('Optional relations use SetNull', () => {
    it('Renewal → Document: onDelete SetNull (optional FK)', () => {
      const block = schema.match(/model Document \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(
        /renewal\s+Renewal\?\s+@relation\(fields:\s*\[renewalId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/
      );
    });

    it('Renewal → Notification: onDelete SetNull (optional FK)', () => {
      const block = schema.match(/model Notification \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(
        /renewal\s+Renewal\?\s+@relation\(fields:\s*\[renewalId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/
      );
    });

    it('User → Policy (adviser): onDelete SetNull (optional FK)', () => {
      const block = schema.match(/model Policy \{[\s\S]*?\n\}/);
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(
        /adviser\s+User\?\s+@relation\("PolicyAdviser",\s*fields:\s*\[adviserId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/
      );
    });
  });

  describe('No relation without onDelete directive', () => {
    it('every @relation with fields+references has onDelete', () => {
      // Find all @relation directives that have "fields:" and "references:" but no "onDelete:"
      const relationRegex = /@relation\([^)]*fields:[^)]*references:[^)]*\)/g;
      const matches = schema.match(relationRegex) || [];
      for (const match of matches) {
        expect(match).toContain('onDelete:');
      }
    });
  });
});
