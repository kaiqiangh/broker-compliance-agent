import { prisma } from '../lib/prisma';
import { parseCSV } from '../lib/csv-parser';
import { computeDedupHash, normalizePolicyNumber, fuzzyMatchPolicy, type FuzzyMatchResult } from '../lib/dedup';

export interface ImportResult {
  importId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errorRows: number;
  needsReviewRows: number;
  format: string;
  confidence: number;
  errors: Array<{ row: number; field: string; error: string }>;
}

export class ImportService {
  async preview(buffer: Buffer, overrideFormat?: string) {
    return parseCSV(buffer, overrideFormat);
  }

  async import(
    firmId: string,
    buffer: Buffer,
    importedBy: string,
    fileName: string = 'upload.csv',
    overrideFormat?: string
  ): Promise<ImportResult> {
    const parsed = parseCSV(buffer, overrideFormat);

    const importRecord = await prisma.import.create({
      data: {
        firmId,
        sourceFormat: parsed.format,
        fileName,
        totalRows: parsed.policies.length + parsed.errors.length,
        importedRows: 0,
        skippedRows: 0,
        errorRows: parsed.errors.length,
        importedBy,
      },
    });

    let importedCount = 0;
    let skippedCount = 0;
    let needsReviewCount = 0;

    const existingPolicies = await prisma.policy.findMany({
      where: { firmId },
    });

    // Build lookup maps
    const byHash = new Map(existingPolicies.map(p => [p.dedupHash, p]));
    const byNormalized = new Map(
      existingPolicies
        .filter(p => p.policyNumberNormalized)
        .map(p => [p.policyNumberNormalized!, p])
    );

    // Build a pre-filtered index for Tier 3 fuzzy match: key = "policyType|insurerName" (lowercased)
    const byTypeAndInsurer = new Map<string, typeof existingPolicies>();
    for (const p of existingPolicies) {
      if (!p.policyNumberNormalized) continue;
      const key = `${p.policyType}|${p.insurerName.toLowerCase()}`;
      const arr = byTypeAndInsurer.get(key);
      if (arr) {
        arr.push(p);
      } else {
        byTypeAndInsurer.set(key, [p]);
      }
    }

    // Pre-fetch existing clients
    const clientNames = [...new Set(parsed.policies.map(p => p.clientName))];
    const existingClients = await prisma.client.findMany({
      where: {
        firmId,
        name: { in: clientNames, mode: 'insensitive' },
      },
    });
    const clientByName = new Map(existingClients.map(c => [c.name.toLowerCase(), c]));

    for (const policy of parsed.policies) {
      try {
        const dedupHash = computeDedupHash({
          firmId,
          policyNumber: policy.policyNumber,
          policyType: policy.policyType,
          insurerName: policy.insurerName,
          inceptionDate: policy.inceptionDate,
        });

        // Tier 1: exact hash match
        const existing = byHash.get(dedupHash);

        if (existing) {
          const hasChanges =
            Number(existing.premium) !== policy.premium ||
            existing.expiryDate.toISOString().slice(0, 10) !== policy.expiryDate;

          if (hasChanges) {
            await prisma.policy.update({
              where: { id: existing.id },
              data: {
                premium: policy.premium,
                expiryDate: new Date(policy.expiryDate),
                policyStatus: policy.status || 'active',
                importId: importRecord.id,
              },
            });
            importedCount++;
          } else {
            skippedCount++;
          }
          continue;
        }

        // Tier 2: normalized policy number match
        const normalizedNumber = normalizePolicyNumber(policy.policyNumber);
        const byNumber = byNormalized.get(normalizedNumber);

        if (byNumber) {
          await prisma.policy.update({
            where: { id: byNumber.id },
            data: {
              dedupHash,
              dedupConfidence: 0.95,
              premium: policy.premium,
              importId: importRecord.id,
            },
          });
          importedCount++;
          continue;
        }

        // Tier 3: fuzzy match — same insurer + same type + similar policy number
        let fuzzyHit: { policy: typeof existingPolicies[number]; result: FuzzyMatchResult } | null = null;
        const fuzzyCandidates = byTypeAndInsurer.get(
          `${policy.policyType}|${policy.insurerName.toLowerCase()}`
        ) || [];
        for (const existingPolicy of fuzzyCandidates) {
          const fm = fuzzyMatchPolicy(normalizedNumber, existingPolicy.policyNumberNormalized!);
          if (fm.matched) {
            if (!fuzzyHit || fm.confidence > fuzzyHit.result.confidence) {
              fuzzyHit = { policy: existingPolicy, result: fm };
            }
          }
        }

        if (fuzzyHit) {
          // Fuzzy match found — mark for review, don't auto-update
          await prisma.policy.update({
            where: { id: fuzzyHit.policy.id },
            data: {
              dedupConfidence: fuzzyHit.result.confidence,
              importId: importRecord.id,
              policyStatus: 'needs_review',
            },
          });
          needsReviewCount++;
          continue;
        }

        // New policy — find or create client
        let client = clientByName.get(policy.clientName.toLowerCase());

        if (!client) {
          client = await prisma.client.create({
            data: {
              firmId,
              name: policy.clientName,
              address: policy.clientAddress || null,
            },
          });
          clientByName.set(policy.clientName.toLowerCase(), client);
        }

        await prisma.policy.create({
          data: {
            firmId,
            clientId: client.id,
            policyNumber: policy.policyNumber,
            policyNumberNormalized: normalizedNumber,
            policyType: policy.policyType,
            insurerName: policy.insurerName,
            inceptionDate: new Date(policy.inceptionDate),
            expiryDate: new Date(policy.expiryDate),
            premium: policy.premium,
            commissionRate: policy.commission ?? null,
            ncb: policy.ncb ?? null,
            policyStatus: policy.status || 'active',
            dedupHash,
            dedupConfidence: 1.0,
            importId: importRecord.id,
          },
        });
        importedCount++;
      } catch (err) {
        const rowIdx = parsed.policies.indexOf(policy) + 2;
        parsed.errors.push({
          row: rowIdx,
          field: '*',
          error: `Import error: ${(err as Error).message}`,
          rawValue: '',
        });
      }
    }

    await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        importedRows: importedCount,
        skippedRows: skippedCount,
        errorRows: parsed.errors.length,
      },
    });

    await prisma.auditEvent.create({
      data: {
        firmId,
        actorId: importedBy,
        action: 'policy.import',
        entityType: 'import',
        entityId: importRecord.id,
        metadata: {
          fileName,
          format: parsed.format,
          totalRows: parsed.policies.length,
          imported: importedCount,
          skipped: skippedCount,
          needsReview: needsReviewCount,
          errors: parsed.errors.length,
        },
      },
    });

    return {
      importId: importRecord.id,
      totalRows: parsed.policies.length + parsed.errors.length,
      importedRows: importedCount,
      skippedRows: skippedCount,
      errorRows: parsed.errors.length,
      needsReviewRows: needsReviewCount,
      format: parsed.format,
      confidence: parsed.confidence,
      errors: parsed.errors,
    };
  }
}
