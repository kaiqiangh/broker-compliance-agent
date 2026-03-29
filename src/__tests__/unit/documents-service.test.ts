import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, mockLog } = vi.hoisted(() => {
  const mockLog = vi.fn();
  const mockPrisma = {
    renewal: { findFirst: vi.fn() },
    document: { create: vi.fn() },
  };
  return { mockPrisma, mockLog };
});

vi.mock('../../lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../../services/audit-service', () => ({
  AuditService: vi.fn().mockImplementation(() => ({ log: mockLog })),
}));

import { DocumentService } from '../../services/document-service';

describe('DocumentService', () => {
  let svc: DocumentService;

  const baseRenewalData = {
    clientName: 'Seán Ó Briain',
    clientAddress: '14 Main Street, Dublin 4',
    policyNumber: 'POL-2024-001',
    policyType: 'Motor',
    insurerName: 'Aviva',
    expiryDate: '2025-03-14',
    currentPremium: 1200,
    previousPremium: 1100,
    ncb: 5,
    firmName: "O'Brien Insurance Brokers",
    firmAddress: '10 Grafton Street, Dublin 2',
    adviserName: 'David Murphy',
    commissionRate: 12.5,
    cpcVersion: '2012' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new DocumentService();
  });

  // ── generateRenewalLetter ─────────────────────────────────────────────

  describe('generateRenewalLetter', () => {
    it('returns HTML containing client name, policy number, premium, insurer, firm name', () => {
      const html = svc.generateRenewalLetter(baseRenewalData);

      expect(html).toContain('Seán Ó Briain');
      expect(html).toContain('POL-2024-001');
      expect(html).toContain('€1200.00');
      expect(html).toContain('Aviva');
      expect(html).toContain("O&#x27;Brien Insurance Brokers");
    });

    it('shows "Why has my premium changed?" notice when current > previous', () => {
      const html = svc.generateRenewalLetter({
        ...baseRenewalData,
        currentPremium: 1500,
        previousPremium: 1100,
      });

      expect(html).toContain('Why has my premium changed?');
    });

    it('does not show increase notice when current <= previous', () => {
      const html = svc.generateRenewalLetter({
        ...baseRenewalData,
        currentPremium: 1000,
        previousPremium: 1100,
      });

      expect(html).not.toContain('Why has my premium changed?');
    });

    it('shows NCB row when ncb is not null', () => {
      const html = svc.generateRenewalLetter({ ...baseRenewalData, ncb: 5 });

      expect(html).toContain('No Claims Bonus');
      expect(html).toContain('5 years');
    });

    it('does not show NCB row when ncb is null', () => {
      const html = svc.generateRenewalLetter({ ...baseRenewalData, ncb: null });

      expect(html).not.toContain('No Claims Bonus');
    });

    it('escapes HTML in client name to prevent XSS', () => {
      const html = svc.generateRenewalLetter({
        ...baseRenewalData,
        clientName: '<script>alert(1)</script>',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  // ── generateSuitabilityAssessment ─────────────────────────────────────

  describe('generateSuitabilityAssessment', () => {
    it('returns HTML with correct fields', () => {
      const html = svc.generateSuitabilityAssessment({
        clientName: 'John Murphy',
        policyNumber: 'POL-2024-002',
        policyType: 'Property',
        insurerName: 'Zurich',
        currentPremium: 2500,
        previousPremium: 2300,
        firmName: 'Test Brokers Ltd',
        adviserName: 'Jane Doe',
        expiryDate: '2025-06-01',
      });

      expect(html).toContain('Suitability Assessment Form');
      expect(html).toContain('John Murphy');
      expect(html).toContain('POL-2024-002');
      expect(html).toContain('Property');
      expect(html).toContain('Zurich');
      expect(html).toContain('€2500.00');
      expect(html).toContain('€2300.00');
      expect(html).toContain('Test Brokers Ltd');
      expect(html).toContain('Jane Doe');
    });
  });

  // ── generateCommissionDisclosure ──────────────────────────────────────

  describe('generateCommissionDisclosure', () => {
    it('returns HTML with commission amount calculated correctly', () => {
      const html = svc.generateCommissionDisclosure({
        clientName: 'Alice Byrne',
        policyNumber: 'POL-2024-003',
        policyType: 'Motor',
        insurerName: 'AXA',
        premium: 1600,
        commissionRate: 12.5,
        commissionAmount: 200,
        firmName: 'Brokers Ireland',
        adviserName: 'Bob Smith',
      });

      expect(html).toContain('Commission Disclosure Statement');
      expect(html).toContain('Alice Byrne');
      expect(html).toContain('€1600.00');
      expect(html).toContain('12.50%');
      expect(html).toContain('€200.00');
    });

    it('calculates commissionAmount = premium × rate / 100', () => {
      const premium = 2000;
      const rate = 15;
      const expected = (premium * rate) / 100;
      expect(expected).toBe(300);

      const html = svc.generateCommissionDisclosure({
        clientName: 'Test',
        policyNumber: 'POL',
        policyType: 'Health',
        insurerName: 'Laya',
        premium,
        commissionRate: rate,
        commissionAmount: expected,
        firmName: 'Test Firm',
        adviserName: 'Adviser',
      });

      expect(html).toContain('€300.00');
    });
  });

  // ── generate (orchestrator) ───────────────────────────────────────────

  describe('generate', () => {
    const mockRenewal = {
      id: 'renewal-1',
      firmId: 'firm-1',
      newPremium: 1300,
      policy: {
        policyNumber: 'POL-2024-001',
        policyType: 'Motor',
        insurerName: 'Aviva',
        premium: 1100,
        commissionRate: 12.5,
        ncb: 3,
        expiryDate: new Date('2025-03-14'),
        client: { name: 'Seán Ó Briain', address: '14 Main Street, Dublin 4' },
        firm: { name: "O'Brien Insurance Brokers" },
        adviser: { name: 'David Murphy' },
      },
      firm: { name: "O'Brien Insurance Brokers" },
    };

    it('throws on unknown document type', async () => {
      mockPrisma.renewal.findFirst.mockResolvedValue(mockRenewal);

      await expect(
        svc.generate('firm-1', 'renewal-1', 'unknown_type', 'user-1')
      ).rejects.toThrow('Unknown document type: unknown_type');
    });

    it('stores document record via prisma.document.create', async () => {
      mockPrisma.renewal.findFirst.mockResolvedValue(mockRenewal);
      mockPrisma.document.create.mockResolvedValue({ id: 'doc-123' });

      const result = await svc.generate('firm-1', 'renewal-1', 'renewal_notification', 'user-1');

      expect(mockPrisma.renewal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'renewal-1', firmId: 'firm-1' },
        })
      );

      expect(mockPrisma.document.create).toHaveBeenCalledWith({
        data: {
          firmId: 'firm-1',
          renewalId: 'renewal-1',
          documentType: 'renewal_notification',
          fileUrl: expect.stringContaining('renewal_notification'),
          generatedBy: 'user-1',
          status: 'completed',
        },
      });

      expect(result.id).toBe('doc-123');
      expect(result.html).toContain('Seán Ó Briain');

      // Audit log was called
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          firmId: 'firm-1',
          actorId: 'user-1',
          action: 'document.generated',
          entityType: 'document',
          entityId: 'doc-123',
        })
      );
    });

    it('generates suitability_assessment document', async () => {
      mockPrisma.renewal.findFirst.mockResolvedValue(mockRenewal);
      mockPrisma.document.create.mockResolvedValue({ id: 'doc-456' });

      const result = await svc.generate('firm-1', 'renewal-1', 'suitability_assessment', 'user-1');

      expect(result.html).toContain('Suitability Assessment Form');
      expect(mockPrisma.document.create).toHaveBeenCalled();
    });

    it('generates commission_disclosure document', async () => {
      mockPrisma.renewal.findFirst.mockResolvedValue(mockRenewal);
      mockPrisma.document.create.mockResolvedValue({ id: 'doc-789' });

      const result = await svc.generate('firm-1', 'renewal-1', 'commission_disclosure', 'user-1');

      expect(result.html).toContain('Commission Disclosure Statement');
      expect(mockPrisma.document.create).toHaveBeenCalled();
    });
  });
});
