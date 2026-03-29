/**
 * CPC Rules Service (ADR-004)
 * Manages checklist definitions stored in the database, with fallback to defaults.
 */

import { prisma } from '../lib/prisma';
import { CHECKLIST_DEFINITIONS, type ChecklistItemDef, type ChecklistItemType } from '../lib/checklist-state';

// ─── Types ──────────────────────────────────────────────────

export interface CreateRuleInput {
  ruleType: string;
  ruleId: string;
  label: string;
  description: string;
  requiresSignOff?: boolean;
  evidenceRequired?: boolean;
  policyTypes?: string[];
  sortOrder?: number;
}

export interface UpdateRuleInput {
  label?: string;
  description?: string;
  requiresSignOff?: boolean;
  evidenceRequired?: boolean;
  policyTypes?: string[];
  isActive?: boolean;
  sortOrder?: number;
}

export interface CpcRuleRecord {
  id: string;
  firmId: string;
  ruleType: string;
  ruleId: string;
  label: string;
  description: string;
  requiresSignOff: boolean;
  evidenceRequired: boolean;
  policyTypes: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service ────────────────────────────────────────────────

export class CpcRulesService {
  /**
   * Get all active rules for a firm, ordered by sortOrder.
   */
  async getRules(firmId: string): Promise<CpcRuleRecord[]> {
    const rules = await prisma.cpcRule.findMany({
      where: { firmId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rules;
  }

  /**
   * Get rules formatted as ChecklistItemDef[] for renewal generation.
   * Falls back to hardcoded defaults if no DB rules exist.
   */
  async getChecklistDefinitions(firmId: string): Promise<ChecklistItemDef[]> {
    const rules = await this.getRules(firmId);

    if (rules.length === 0) {
      // Seed defaults and return them
      await this.seedDefaults(firmId);
      return CHECKLIST_DEFINITIONS;
    }

    return rules.map((rule) => ({
      type: rule.ruleId as ChecklistItemType,
      label: rule.label,
      description: rule.description,
      requiresSignOff: rule.requiresSignOff,
      evidenceRequired: rule.evidenceRequired,
    }));
  }

  /**
   * Create a new rule for a firm.
   */
  async createRule(firmId: string, data: CreateRuleInput): Promise<CpcRuleRecord> {
    const rule = await prisma.cpcRule.create({
      data: {
        firmId,
        ruleType: data.ruleType,
        ruleId: data.ruleId,
        label: data.label,
        description: data.description,
        requiresSignOff: data.requiresSignOff ?? false,
        evidenceRequired: data.evidenceRequired ?? false,
        policyTypes: data.policyTypes ?? ['all'],
        sortOrder: data.sortOrder ?? 0,
      },
    });
    return rule;
  }

  /**
   * Update an existing rule (identified by ruleId within a firm).
   */
  async updateRule(firmId: string, ruleId: string, data: UpdateRuleInput): Promise<CpcRuleRecord> {
    const rule = await prisma.cpcRule.update({
      where: {
        firmId_ruleId: { firmId, ruleId },
      },
      data: {
        ...(data.label !== undefined && { label: data.label }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.requiresSignOff !== undefined && { requiresSignOff: data.requiresSignOff }),
        ...(data.evidenceRequired !== undefined && { evidenceRequired: data.evidenceRequired }),
        ...(data.policyTypes !== undefined && { policyTypes: data.policyTypes }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
    return rule;
  }

  /**
   * Soft-delete a rule (set isActive=false).
   */
  async deleteRule(firmId: string, ruleId: string): Promise<void> {
    await prisma.cpcRule.update({
      where: {
        firmId_ruleId: { firmId, ruleId },
      },
      data: { isActive: false },
    });
  }

  /**
   * Seed the 8 default CPC rules from hardcoded definitions.
   * Skips if rules already exist for this firm.
   */
  async seedDefaults(firmId: string): Promise<void> {
    const existing = await prisma.cpcRule.count({ where: { firmId } });
    if (existing > 0) return;

    await prisma.cpcRule.createMany({
      data: CHECKLIST_DEFINITIONS.map((def, index) => ({
        firmId,
        ruleType: 'checklist_item',
        ruleId: def.type,
        label: def.label,
        description: def.description,
        requiresSignOff: def.requiresSignOff,
        evidenceRequired: def.evidenceRequired,
        policyTypes: ['all'],
        isActive: true,
        sortOrder: index,
      })),
    });
  }
}

export const cpcRulesService = new CpcRulesService();
