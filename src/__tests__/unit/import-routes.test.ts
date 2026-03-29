import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImportService } from '../../services/import-service';

// Mock prisma
vi.mock('../../lib/prisma', () => {
  const txMock = {
    policy: {
      create: vi.fn(),
      update: vi.fn(),
    },
    client: {
      create: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      import: {
        create: vi.fn(),
        update: vi.fn(),
      },
      policy: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      client: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      auditEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
      _tx: txMock,
    },
  };
});

// Mock csv-parser
vi.mock('../../lib/csv-parser', () => ({
  parseCSV: vi.fn(),
}));

// Mock dedup
vi.mock('../../lib/dedup', () => ({
  computeDedupHash: vi.fn((c: Record<string, string>) => `hash-${c.policyNumber}`),
  normalizePolicyNumber: vi.fn((n: string) => n.replace(/[^A-Z0-9]/gi, '').toUpperCase()),
  fuzzyMatchPolicy: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { parseCSV } from '../../lib/csv-parser';
import { computeDedupHash, normalizePolicyNumber, fuzzyMatchPolicy } from '../../lib/dedup';

const mockParseCSV = vi.mocked(parseCSV);
const mockFuzzyMatchPolicy = vi.mocked(fuzzyMatchPolicy);

const firmId = 'firm-1';
const importedBy = 'user-1';
const fileName = 'upload.csv';

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    policyNumber: 'POL-2024-001',
    clientName: 'Acme Ltd',
    clientAddress: '123 Main St',
    policyType: 'motor',
    insurerName: 'Aviva',
    inceptionDate: '2024-01-01',
    expiryDate: '2025-01-01',
    premium: 1200,
    commission: 10,
    ncb: undefined,
    status: 'active',
    ...overrides,
  };
}

function mockParseResult(policies: ReturnType<typeof makePolicy>[], errors: unknown[] = []) {
  mockParseCSV.mockReturnValue({
    format: 'generic_csv',
    confidence: 0.8,
    headers: [],
    policies: policies as any,
    errors: errors as any,
  });
}

function existingPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'existing-pol-1',
    firmId,
    policyNumber: 'POL-2024-001',
    policyNumberNormalized: 'POL2024001',
    policyType: 'motor',
    insurerName: 'Aviva',
    inceptionDate: new Date('2024-01-01'),
    expiryDate: new Date('2025-01-01'),
    premium: 1200,
    dedupHash: 'hash-POL-2024-001',
    dedupConfidence: 1.0,
    ...overrides,
  };
}

function existingClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    firmId,
    name: 'Acme Ltd',
    address: '123 Main St',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing policies or clients
  vi.mocked(prisma.policy.findMany).mockResolvedValue([]);
  vi.mocked(prisma.client.findMany).mockResolvedValue([]);
  vi.mocked(prisma.import.create).mockResolvedValue({ id: 'import-1' } as any);
  vi.mocked(prisma.import.update).mockResolvedValue({} as any);
  vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any);
  vi.mocked((prisma as any)._tx.policy.create).mockResolvedValue({} as any);
  vi.mocked((prisma as any)._tx.policy.update).mockResolvedValue({} as any);
  vi.mocked((prisma as any)._tx.client.create).mockResolvedValue(existingClient() as any);
  vi.mocked((prisma as any)._tx.auditEvent.create).mockResolvedValue({} as any);
  mockFuzzyMatchPolicy.mockReturnValue({ matched: false, similarity: 0, confidence: 0, matchTier: 'none' });
});

const service = new ImportService();

describe('ImportService.import', () => {
  // ── Test 1 ─────────────────────────────────────────────
  it('creates an Import record with correct data', async () => {
    const policy = makePolicy();
    mockParseResult([policy]);

    await service.import(firmId, Buffer.from('csv'), importedBy, fileName);

    expect(prisma.import.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmId,
        sourceFormat: 'generic_csv',
        fileName,
        totalRows: 1,
        importedRows: 0,
        skippedRows: 0,
        errorRows: 0,
        importedBy,
      }),
    });
  });

  // ── Test 2 ─────────────────────────────────────────────
  it('creates client + policy for new unmatched entry', async () => {
    const policy = makePolicy();
    mockParseResult([policy]);

    await service.import(firmId, Buffer.from('csv'), importedBy);

    // Should create client inside transaction
    expect((prisma as any)._tx.client.create).toHaveBeenCalledWith({
      data: {
        firmId,
        name: policy.clientName,
        address: policy.clientAddress,
      },
    });

    // Should create policy inside transaction
    expect((prisma as any)._tx.policy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmId,
        policyNumber: policy.policyNumber,
        policyNumberNormalized: 'POL2024001',
        policyType: policy.policyType,
        insurerName: policy.insurerName,
        premium: policy.premium,
        dedupHash: 'hash-POL-2024-001',
        dedupConfidence: 1.0,
        importId: 'import-1',
      }),
    });
  });

  // ── Test 3 ─────────────────────────────────────────────
  it('updates policy on exact hash match with changes', async () => {
    const policy = makePolicy({ premium: 1500, expiryDate: '2025-02-01' });
    mockParseResult([policy]);

    vi.mocked(prisma.policy.findMany).mockResolvedValue([
      existingPolicy({ premium: 1200, expiryDate: new Date('2025-01-01') }),
    ] as any);

    const result = await service.import(firmId, Buffer.from('csv'), importedBy);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect((prisma as any)._tx.policy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-pol-1' },
        data: expect.objectContaining({
          premium: 1500,
          expiryDate: new Date('2025-02-01'),
          importId: 'import-1',
        }),
      })
    );
    expect(result.importedRows).toBe(1);
    expect(result.skippedRows).toBe(0);
  });

  // ── Test 4 ─────────────────────────────────────────────
  it('skips on exact hash match with no changes (skippedCount++)', async () => {
    const policy = makePolicy(); // same premium + expiry as existing
    mockParseResult([policy]);

    vi.mocked(prisma.policy.findMany).mockResolvedValue([
      existingPolicy({ premium: 1200, expiryDate: new Date('2025-01-01') }),
    ] as any);

    const result = await service.import(firmId, Buffer.from('csv'), importedBy);

    expect(result.skippedRows).toBe(1);
    expect(result.importedRows).toBe(0);
    // No update call outside of the import.update at the end
    const updateCalls = vi.mocked((prisma as any)._tx.policy.update).mock.calls;
    expect(updateCalls.length).toBe(0);
  });

  // ── Test 5 ─────────────────────────────────────────────
  it('updates policy on normalized match with new hash', async () => {
    // Incoming policy number is different but normalizes to same value
    const policy = makePolicy({ policyNumber: 'POL/2024/001' }); // normalized: POL2024001
    mockParseResult([policy]);

    // No exact hash match (different hash), but normalized match exists
    vi.mocked(prisma.policy.findMany).mockResolvedValue([
      existingPolicy({ dedupHash: 'hash-POL-2024-001', policyNumber: 'POL-2024-001' }),
    ] as any);

    const result = await service.import(firmId, Buffer.from('csv'), importedBy);

    expect((prisma as any)._tx.policy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-pol-1' },
        data: expect.objectContaining({
          dedupHash: 'hash-POL/2024/001',
          dedupConfidence: 0.95,
          premium: policy.premium,
          importId: 'import-1',
        }),
      })
    );
    expect(result.importedRows).toBe(1);
  });

  // ── Test 6 ─────────────────────────────────────────────
  it('marks policy as needs_review on fuzzy match', async () => {
    const policy = makePolicy({ policyNumber: 'POL-2024-002' });
    mockParseResult([policy]);

    const existing = existingPolicy({
      policyNumber: 'POL-2024-001',
      policyNumberNormalized: 'POL2024001',
      dedupHash: 'hash-other',
      policyType: 'motor',
      insurerName: 'Aviva',
    });
    vi.mocked(prisma.policy.findMany).mockResolvedValue([existing] as any);

    mockFuzzyMatchPolicy.mockReturnValue({
      matched: true,
      similarity: 0.92,
      confidence: 0.79,
      matchTier: 'fuzzy',
    });

    const result = await service.import(firmId, Buffer.from('csv'), importedBy);

    expect((prisma as any)._tx.policy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: expect.objectContaining({
          dedupConfidence: 0.79,
          policyStatus: 'needs_review',
          importId: 'import-1',
        }),
      })
    );
    expect(result.needsReviewRows).toBe(1);
    expect(result.importedRows).toBe(0);
  });

  // ── Test 7 ─────────────────────────────────────────────
  it('logs a policy.import audit event at the end', async () => {
    const policies = [makePolicy(), makePolicy({ policyNumber: 'POL-2024-002', clientName: 'Beta Inc' })];
    mockParseResult(policies);

    await service.import(firmId, Buffer.from('csv'), importedBy, 'data.csv');

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        firmId,
        actorId: importedBy,
        action: 'policy.import',
        entityType: 'import',
        entityId: 'import-1',
        metadata: expect.objectContaining({
          fileName: 'data.csv',
          format: 'generic_csv',
          totalRows: 2,
          imported: 2,
          skipped: 0,
          errors: 0,
        }),
      },
    });
  });

  // ── Test 8 ─────────────────────────────────────────────
  it('reuses existing client by name across multiple policies', async () => {
    const policies = [
      makePolicy({ policyNumber: 'POL-A', clientName: 'Acme Ltd' }),
      makePolicy({ policyNumber: 'POL-B', clientName: 'Acme Ltd' }),
    ];
    mockParseResult(policies);

    // Pre-existing client found via findMany
    vi.mocked(prisma.client.findMany).mockResolvedValue([existingClient()] as any);

    await service.import(firmId, Buffer.from('csv'), importedBy);

    // Client should NOT be created — it was found by name
    expect((prisma as any)._tx.client.create).not.toHaveBeenCalled();

    // Both policies should be created with the same clientId
    const policyCreateCalls = vi.mocked((prisma as any)._tx.policy.create).mock.calls;
    expect(policyCreateCalls.length).toBe(2);
    expect(policyCreateCalls[0][0].data.clientId).toBe('client-1');
    expect(policyCreateCalls[1][0].data.clientId).toBe('client-1');
  });

  // ── Test 9 ─────────────────────────────────────────────
  it('rolls back client creation if policy create fails (orphan prevention)', async () => {
    const policy = makePolicy();
    mockParseResult([policy]);

    // Simulate transaction failure — the $transaction callback throws
    const err = new Error('DB constraint violation');
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(err);

    const result = await service.import(firmId, Buffer.from('csv'), importedBy);

    // The error should be caught and added to the errors array
    expect(result.errorRows).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.error.includes('DB constraint violation'))).toBe(true);
    expect(result.importedRows).toBe(0);
  });
});
