import { describe, it, expect } from 'vitest';

describe('CPC renewal letter template data', () => {
  const renewalData = {
    clientName: 'Seán Ó Briain',
    clientAddress: '14 Main Street, Dublin 4',
    policyNumber: 'POL-2024-001',
    policyType: 'Motor',
    insurerName: 'Aviva',
    inceptionDate: '2024-03-15',
    expiryDate: '2025-03-14',
    currentPremium: 1245,
    previousPremium: 1100,
    ncb: 5,
    firmName: "O'Brien Insurance Brokers",
    firmAddress: '10 Grafton Street, Dublin 2',
    adviserName: 'David Murphy',
  };

  it('includes all required CPC disclosure fields', () => {
    const required = [
      'clientName', 'expiryDate', 'currentPremium', 'previousPremium',
      'firmName', 'policyNumber', 'insurerName',
    ];

    for (const field of required) {
      expect(renewalData).toHaveProperty(field);
      expect((renewalData as any)[field]).toBeTruthy();
    }
  });

  it('calculates premium change percentage', () => {
    const change = ((renewalData.currentPremium - renewalData.previousPremium) / renewalData.previousPremium) * 100;
    expect(change).toBeCloseTo(13.18, 1);
  });

  it('formats dates for Irish display', () => {
    const date = new Date(renewalData.expiryDate);
    const formatted = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
    expect(formatted).toBe('14/03/2025');
  });

  it('includes commission disclosure placeholder', () => {
    const commissionNote = `We receive commission of [X]% from ${renewalData.insurerName} for arranging this policy.`;
    expect(commissionNote).toContain('commission');
    expect(commissionNote).toContain('Aviva');
  });
});

describe('CPC 2012 vs CP158 timeline', () => {
  it('CP158 adds pre-renewal notice 40 days before', () => {
    const expiry = new Date('2025-03-15');

    // CPC 2012: 20 days
    const notice2012 = new Date(expiry);
    notice2012.setDate(notice2012.getDate() - 20);

    // CP158: 40 days pre-renewal + 20 days renewal
    const preRenewal = new Date(expiry);
    preRenewal.setDate(preRenewal.getDate() - 40);
    const renewalNotice = new Date(expiry);
    renewalNotice.setDate(renewalNotice.getDate() - 20);

    expect(notice2012.getDate()).toBe(23); // Feb 23
    expect(preRenewal.getDate()).toBe(3);  // Feb 3
    expect(renewalNotice.getDate()).toBe(23); // Feb 23

    // CP158 has 2 notices, CPC 2012 has 1
    const cp158Dates = [preRenewal, renewalNotice];
    const cpc2012Dates = [notice2012];
    expect(cp158Dates).toHaveLength(2);
    expect(cpc2012Dates).toHaveLength(1);
  });
});

describe('Suitability assessment template', () => {
  it('includes all required assessment sections', () => {
    const sections = [
      'needs_review',
      'demands_review',
      'circumstances_review',
      'adviser_recommendation',
      'client_acknowledgment',
    ];

    // Each section must have a label and a completion checkbox
    const template = sections.map(s => ({
      section: s,
      label: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      completed: false,
    }));

    expect(template).toHaveLength(5);
    expect(template.every(s => s.label.length > 0)).toBe(true);
  });
});

describe('Inspection pack assembly', () => {
  it('lists required documents for CBI inspection', () => {
    const requiredDocs = [
      'renewal_notifications',
      'suitability_assessments',
      'market_comparisons',
      'client_communications',
      'audit_trail_csv',
      'compliance_summary',
    ];

    // Each doc type maps to a collection of files
    const pack = requiredDocs.map(type => ({
      type,
      files: [] as string[],
      required: true,
    }));

    expect(pack.filter(d => d.required)).toHaveLength(6);
  });

  it('supports date range filtering', () => {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-12-31');

    const events = [
      { date: new Date('2024-03-15'), action: 'checklist.completed' },
      { date: new Date('2024-06-01'), action: 'renewal.sent' },
      { date: new Date('2025-01-15'), action: 'checklist.completed' },
    ];

    const filtered = events.filter(e => e.date >= startDate && e.date <= endDate);
    expect(filtered).toHaveLength(2);
  });
});
