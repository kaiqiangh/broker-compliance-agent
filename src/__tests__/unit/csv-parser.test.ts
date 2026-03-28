import { describe, it, expect } from 'vitest';
import { parseCSV, detectFormat } from '../../lib/csv-parser';

describe('detectFormat', () => {
  it('detects Applied Epic from headers', () => {
    const result = detectFormat(['PolicyRef', 'ClientName', 'ClientAddress', 'InceptionDate', 'ExpiryDate']);
    expect(result.format).toBe('applied_epic');
    expect(result.confidence).toBe(0.95);
  });

  it('detects Acturis from headers', () => {
    const result = detectFormat(['PolicyNo', 'InsuredName', 'EffectiveDate', 'ExpirationDate']);
    expect(result.format).toBe('acturis');
    expect(result.confidence).toBe(0.95);
  });

  it('detects generic CSV from fuzzy headers', () => {
    const result = detectFormat(['Customer Name', 'Policy #', 'Type', 'Start Date', 'End Date']);
    expect(result.format).toBe('generic_csv');
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it('returns unknown for unrecognized headers', () => {
    const result = detectFormat(['Column1', 'Column2', 'Column3']);
    expect(result.format).toBe('unknown');
    expect(result.confidence).toBe(0);
  });
});

describe('parseCSV — Applied Epic', () => {
  const csv = `PolicyRef,ClientName,ClientAddress,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium,Commission,NCB,VehicleReg,CoverType
POL-2024-001,Seán Ó Briain,14 Main Street Dublin 4,Motor,Aviva,15/03/2024,14/03/2025,€1245.00,12.5%,5,241-D-12345,Comprehensive
POL-2024-002,Áine Murphy,22 Patrick's Road Cork,Home,Zurich,01/06/2024,31/05/2025,€890.00,15.0%,,,`;

  it('parses all rows', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('detects Applied Epic format', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.format).toBe('applied_epic');
    expect(result.confidence).toBe(0.95);
  });

  it('parses policy number', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].policyNumber).toBe('POL-2024-001');
  });

  it('handles Irish fadas in names', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].clientName).toBe('Seán Ó Briain');
    expect(result.policies[1].clientName).toBe('Áine Murphy');
  });

  it('parses premium with EUR symbol', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].premium).toBe(1245.00);
    expect(result.policies[1].premium).toBe(890.00);
  });

  it('converts DD/MM/YYYY dates to ISO', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].inceptionDate).toBe('2024-03-15');
    expect(result.policies[0].expiryDate).toBe('2025-03-14');
  });

  it('normalizes policy type', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].policyType).toBe('motor');
    expect(result.policies[1].policyType).toBe('home');
  });

  it('parses NCB for motor policies', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].ncb).toBe(5);
    expect(result.policies[1].ncb).toBeUndefined();
  });

  it('handles empty address', () => {
    const csvWithEmpty = csv + '\nPOL-2024-004,Máire Ní Chonaill,,Commercial,FBD,01/01/2024,31/12/2024,€4200.00,17.5%,,,';
    const result = parseCSV(Buffer.from(csvWithEmpty));
    expect(result.policies[2].clientAddress).toBe('');
    expect(result.policies[2].premium).toBe(4200);
  });
});

describe('parseCSV — Acturis', () => {
  const csv = `PolicyNo,InsuredName,AddressLine1,AddressLine2,City,Postcode,Class,Insurer,EffectiveDate,ExpirationDate,GrossPremium,CommissionRate,Status,Claims
POL-A001,Seán Ó Briain,14 Main Street,,Dublin,D04 Y1A2,Motor,Aviva,2024-03-15,2025-03-14,1245.00,12.5,Active,0
POL-A004,Máire Ní Chonaill,,,,,Commercial,FBD,2024-01-01,2024-12-31,4200.00,17.5,Cancelled,0`;

  it('parses all rows', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('detects Acturis format', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.format).toBe('acturis');
  });

  it('concatenates split address fields', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].clientAddress).toBe('14 Main Street, Dublin, D04 Y1A2');
  });

  it('handles empty address fields (consecutive commas)', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[1].clientAddress).toBe('');
    expect(result.policies[1].premium).toBe(4200);
    expect(result.policies[1].status).toBe('Cancelled');
  });

  it('parses ISO dates correctly', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].inceptionDate).toBe('2024-03-15');
    expect(result.policies[0].expiryDate).toBe('2025-03-14');
  });

  it('parses claims count', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].claimsCount).toBe(0);
  });
});

describe('parseCSV — Generic', () => {
  const csv = `Customer Name,Policy #,Type,Company,Start Date,End Date,Annual Premium,Notes
Seán Ó Briain,POL-2024-001,Car Insurance,Aviva,15/03/2024,14/03/2025,"€1,245.00",5 years NCB
Áine Murphy,POL-2024-002,House Insurance,Zurich,01/06/2024,31/05/2025,"€890.00",`;

  it('detects generic format', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.format).toBe('generic_csv');
  });

  it('maps fuzzy column names', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies).toHaveLength(2);
    expect(result.policies[0].clientName).toBe('Seán Ó Briain');
    expect(result.policies[0].policyNumber).toBe('POL-2024-001');
  });

  it('parses quoted premium with comma', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].premium).toBe(1245.00);
  });

  it('normalizes policy type from descriptive names', () => {
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies[0].policyType).toBe('motor');
    expect(result.policies[1].policyType).toBe('home');
  });
});

describe('parseCSV — validation errors', () => {
  it('reports missing required fields', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium
,,Motor,Aviva,15/03/2024,14/03/2025,1000`;
    const result = parseCSV(Buffer.from(csv));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.field === 'policyNumber')).toBe(true);
    expect(result.errors.some(e => e.field === 'clientName')).toBe(true);
  });

  it('reports invalid premium', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium
POL-001,Test Client,Motor,Aviva,15/03/2024,14/03/2025,-100`;
    const result = parseCSV(Buffer.from(csv));
    expect(result.errors.some(e => e.field === 'premium')).toBe(true);
  });

  it('reports expiry before inception', () => {
    const csv = `PolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium
POL-001,Test Client,Motor,Aviva,15/03/2025,14/03/2024,1000`;
    const result = parseCSV(Buffer.from(csv));
    expect(result.errors.some(e => e.field === 'expiryDate')).toBe(true);
  });
});

describe('parseCSV — BOM handling', () => {
  it('handles UTF-8 BOM', () => {
    const csv = '\uFEFFPolicyRef,ClientName,PolicyType,InsurerName,InceptionDate,ExpiryDate,Premium\nPOL-001,Test,Motor,Aviva,15/03/2024,14/03/2025,1000';
    const result = parseCSV(Buffer.from(csv));
    expect(result.policies).toHaveLength(1);
  });
});
