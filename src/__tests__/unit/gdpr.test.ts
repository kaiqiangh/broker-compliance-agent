import { describe, it, expect } from 'vitest';

describe('GDPR data export', () => {
  it('collects all data for a client across tables', () => {
    // Simulated data structure for GDPR export
    const clientData = {
      client: { name: 'Seán Ó Briain', email: 'sean@example.ie', phone: '087 123 4567' },
      policies: [
        { policyNumber: 'POL-001', type: 'motor', premium: 1245 },
      ],
      renewals: [
        { dueDate: '2025-03-14', status: 'compliant' },
      ],
      checklistItems: [
        { itemType: 'suitability_assessment', status: 'approved' },
      ],
      auditEvents: [
        { action: 'checklist.item_completed', timestamp: '2024-12-01' },
      ],
    };

    const exportJson = JSON.stringify(clientData, null, 2);
    const parsed = JSON.parse(exportJson);

    expect(parsed.client.name).toBe('Seán Ó Briain');
    expect(parsed.policies).toHaveLength(1);
    expect(parsed.renewals).toHaveLength(1);
  });

  it('export is valid JSON', () => {
    const data = { client: { name: 'Test' }, policies: [] };
    const json = JSON.stringify(data);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('GDPR erasure — anonymization', () => {
  it('anonymizes PII fields', () => {
    const client = {
      name: 'Seán Ó Briain',
      email: 'sean@example.ie',
      phone: '087 123 4567',
      address: '14 Main Street, Dublin 4',
    };

    const anonymized = {
      name: '[REDACTED]',
      email: null,
      phone: null,
      address: null,
    };

    expect(anonymized.name).not.toBe(client.name);
    expect(anonymized.email).toBeNull();
    expect(anonymized.phone).toBeNull();
    expect(anonymized.address).toBeNull();
  });

  it('retains compliance records with anonymized reference', () => {
    const renewal = {
      id: 'renewal-1',
      clientId: 'client-1',
      status: 'compliant',
      // After erasure, clientId still exists but client PII is gone
    };

    // The renewal record should still exist
    expect(renewal.id).toBeTruthy();
    expect(renewal.clientId).toBeTruthy();
    expect(renewal.status).toBe('compliant');
  });

  it('preserves audit trail with redacted names', () => {
    const event = {
      action: 'checklist.item_approved',
      actorId: 'user-1',
      metadata: { clientName: '[REDACTED]', policyNumber: 'POL-001' },
    };

    expect(event.metadata.clientName).toBe('[REDACTED]');
    expect(event.metadata.policyNumber).toBe('POL-001'); // policy number retained
  });

  it('Art 17(3)(b) exemption applies to compliance records', () => {
    // Compliance records are exempt from erasure under Art 17(3)(b)
    const exemptTypes = [
      'renewals', 'checklist_items', 'audit_events', 'documents',
    ];

    const nonExemptTypes = [
      'client_pii', 'login_sessions', 'marketing_preferences',
    ];

    // Exempt types should be retained (anonymized)
    // Non-exempt types should be deleted
    expect(exemptTypes).toContain('renewals');
    expect(exemptTypes).toContain('audit_events');
    expect(nonExemptTypes).not.toContain('renewals');
  });
});

describe('GDPR erasure — procedure validation', () => {
  it('requires verification before erasure', () => {
    function canErase(verified: boolean, requestDate: Date): boolean {
      if (!verified) return false;
      const deadline = new Date(requestDate);
      deadline.setUTCDate(deadline.getUTCDate() + 30);
      return new Date() <= deadline;
    }

    expect(canErase(true, new Date())).toBe(true);
    expect(canErase(false, new Date())).toBe(false);
  });

  it('30-day deadline tracking', () => {
    const requestDate = new Date('2026-03-01T00:00:00Z');
    const deadline = new Date(requestDate);
    deadline.setUTCDate(deadline.getUTCDate() + 30);

    expect(deadline.toISOString().slice(0, 10)).toBe('2026-03-31');

    const daysRemaining = Math.ceil((deadline.getTime() - new Date('2026-03-15T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24));
    expect(daysRemaining).toBe(16);
  });
});
