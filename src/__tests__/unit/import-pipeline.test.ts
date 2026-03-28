import { describe, it, expect } from 'vitest';
import { parseCSV } from '../../lib/csv-parser';

describe('Import pipeline — CSV parsing (no DB)', () => {
  it('parses Applied Epic end-to-end', () => {
    const csv = `PolicyRef,ClientName,ClientAddress,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium,Commission,NCB,VehicleReg,CoverType
POL-2024-001,Seán Ó Briain,14 Main Street Dublin 4,Motor,Aviva,15/03/2024,14/03/2025,€1245.00,12.5%,5,241-D-12345,Comprehensive`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.format).toBe('applied_epic');
    expect(result.policies).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.policies[0].clientName).toBe('Seán Ó Briain');
    expect(result.policies[0].premium).toBe(1245);
  });

  it('parses Acturis end-to-end', () => {
    const csv = `PolicyNo,InsuredName,AddressLine1,AddressLine2,City,Postcode,Class,Insurer,EffectiveDate,ExpirationDate,GrossPremium,CommissionRate,Status,Claims
POL-A001,Áine Murphy,22 Patrick's Road,,Cork,T12 AB34,Home,Zurich,2024-06-01,2025-05-31,890.00,15.0,Active,1`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.format).toBe('acturis');
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0].policyType).toBe('home');
    expect(result.policies[0].claimsCount).toBe(1);
  });

  it('parses generic CSV end-to-end', () => {
    const csv = `Customer Name,Policy #,Type,Company,Start Date,End Date,Annual Premium
Patrick Kelly,POL-2024-003,Car Insurance,Allianz,22/09/2024,21/09/2025,€1580.00`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.format).toBe('generic_csv');
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0].policyType).toBe('motor');
  });

  it('reports validation errors', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium
,,Motor,Aviva,15/03/2024,14/03/2025,1000`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.field === 'policyNumber')).toBe(true);
    expect(result.errors.some(e => e.field === 'clientName')).toBe(true);
  });

  it('handles empty CSV', () => {
    const result = parseCSV(Buffer.from(''));
    expect(result.policies).toHaveLength(0);
    expect(result.format).toBe('unknown');
  });

  it('handles BOM-prefixed CSV', () => {
    const csv = '\uFEFFPolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium\nPOL-001,Test,Motor,Aviva,15/03/2024,14/03/2025,1000';
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies).toHaveLength(1);
  });

  it('handles Acturis consecutive empty fields', () => {
    const csv = `PolicyNo,InsuredName,AddressLine1,AddressLine2,City,Postcode,Class,Insurer,EffectiveDate,ExpirationDate,GrossPremium,CommissionRate,Status,Claims
POL-A004,Máire Ní Chonaill,,,,,Commercial,FBD,2024-01-01,2024-12-31,4200.00,17.5,Cancelled,0`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0].clientAddress).toBe('');
    expect(result.policies[0].premium).toBe(4200);
    expect(result.policies[0].status).toBe('Cancelled');
  });

  it('handles mixed date formats', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium
POL-001,Test,Motor,Aviva,2024-03-15,2025-03-14,1000`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].inceptionDate).toBe('2024-03-15');
  });

  it('normalizes policy types from descriptive names', () => {
    const csv = `Customer Name,Policy #,Type,Company,Start Date,End Date,Annual Premium
Test,POL-001,House Insurance,Aviva,15/03/2024,14/03/2025,€1000`;

    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].policyType).toBe('home');
  });
});
