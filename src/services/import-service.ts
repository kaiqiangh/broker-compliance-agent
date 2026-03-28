import { prisma } from './prisma';
import { parseCSV } from './csv-parser';
import { computeDedupHash, normalizePolicyNumber } from './dedup';

export interface ImportResult {
  importId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errorRows: number;
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
        const existing = await prisma.policy.findFirst({
          where: { firmId, dedupHash },
        });

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
                lastImportId: importRecord.id,
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
        const byNumber = await prisma.policy.findFirst({
          where: { firmId, policyNumberNormalized: normalizedNumber },
        });

        if (byNumber) {
          await prisma.policy.update({
            where: { id: byNumber.id },
            data: {
              dedupHash,
              dedupConfidence: 0.95,
              premium: policy.premium,
              lastImportId: importRecord.id,
            },
          });
          importedCount++;
          continue;
        }

        // New policy — find or create client
        let client = await prisma.client.findFirst({
          where: { firmId, name: { equals: policy.clientName, mode: 'insensitive' } },
        });

        if (!client) {
          client = await prisma.client.create({
            data: {
              firmId,
              name: policy.clientName,
              address: policy.clientAddress || null,
            },
          });
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
      format: parsed.format,
      confidence: parsed.confidence,
      errors: parsed.errors,
    };
  }
}
