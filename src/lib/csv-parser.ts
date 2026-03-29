import { parse as csvParse } from 'csv-parse/sync';
import { parseIrishDate, formatISODate } from './dates';
import { parsePremium, parseCommission, normalizePolicyNumber } from './dedup';

export interface ParsedPolicy {
  policyNumber: string;
  clientName: string;
  clientAddress: string;
  policyType: string;
  insurerName: string;
  inceptionDate: string; // ISO format
  expiryDate: string;    // ISO format
  premium: number;
  commission?: number;
  ncb?: number;
  vehicleReg?: string;
  coverType?: string;
  status?: string;
  claimsCount?: number;
}

export interface ParseResult {
  format: string;
  confidence: number;
  headers: string[];
  policies: ParsedPolicy[];
  errors: Array<{ row: number; field: string; error: string; rawValue: string }>;
}

/**
 * Detect BMS format from CSV headers
 */
export function detectFormat(headers: string[]): { format: string; confidence: number } {
  const h = headers.map(x => x.toLowerCase().trim());

  // Applied Epic: PolicyRef + ClientName + InceptionDate
  if (h.includes('policyref') && h.includes('clientname') && h.includes('inceptiondate')) {
    return { format: 'applied_epic', confidence: 0.95 };
  }

  // Acturis: PolicyNo + InsuredName + EffectiveDate
  if (h.includes('policyno') && h.includes('insuredname') && h.includes('effectivedate')) {
    return { format: 'acturis', confidence: 0.95 };
  }

  // Generic: fuzzy match on common column names
  const nameMatches = h.filter(x =>
    x.includes('customer') || x.includes('client') || x.includes('name') || x.includes('insured')
  );
  const policyMatches = h.filter(x =>
    x.includes('policy') || x.includes('ref') || x.includes('number')
  );
  const dateMatches = h.filter(x =>
    x.includes('start') || x.includes('inception') || x.includes('effective') || x.includes('from')
  );

  if (nameMatches.length > 0 && policyMatches.length > 0 && dateMatches.length > 0) {
    const confidence = Math.min(0.75, 0.4 + (nameMatches.length + policyMatches.length + dateMatches.length) * 0.05);
    return { format: 'generic_csv', confidence };
  }

  return { format: 'unknown', confidence: 0 };
}

/**
 * Parse CSV buffer into policies based on detected format.
 * Supports CSV (comma), TSV (tab), and semicolon delimiters.
 */
export function parseCSV(buffer: Buffer, overrideFormat?: string, delimiter?: string): ParseResult {
  const raw = buffer.toString('utf-8');

  // Auto-detect delimiter if not specified
  let detectedDelimiter = delimiter;
  if (!detectedDelimiter) {
    const firstLine = raw.split('\n')[0] || '';
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    if (tabCount > 0 && tabCount >= semiCount) detectedDelimiter = '\t';
    else if (semiCount > 2) detectedDelimiter = ';';
    else detectedDelimiter = ',';
  }

  const records = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    delimiter: detectedDelimiter,
  });

  if (records.length === 0) {
    return { format: 'unknown', confidence: 0, headers: [], policies: [], errors: [] };
  }

  const headers = Object.keys(records[0]);
  const detection = overrideFormat
    ? { format: overrideFormat, confidence: 1.0 }
    : detectFormat(headers);

  const policies: ParsedPolicy[] = [];
  const errors: ParseResult['errors'] = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2; // 1-indexed, skip header

    try {
      const parsed = mapRowToPolicy(row, detection.format);
      if (parsed) {
        // Validate
        const rowErrors = validatePolicy(parsed, rowNum);
        if (rowErrors.length > 0) {
          errors.push(...rowErrors);
        } else {
          policies.push(parsed);
        }
      }
    } catch (err) {
      errors.push({
        row: rowNum,
        field: '*',
        error: `Parse error: ${(err as Error).message}`,
        rawValue: JSON.stringify(row),
      });
    }
  }

  return {
    format: detection.format,
    confidence: detection.confidence,
    headers,
    policies,
    errors,
  };
}

/**
 * Sanitize a CSV cell to prevent formula injection.
 * Prefixes cells starting with dangerous characters with a single quote.
 */
function sanitizeCell(value: string): string {
  if (!value) return value;
  const first = value.trim()[0];
  if ('=+-@|!\t\r'.includes(first)) return "'" + value;
  return value;
}

function mapRowToPolicy(row: Record<string, string>, format: string): ParsedPolicy | null {
  switch (format) {
    case 'applied_epic':
      return {
        policyNumber: sanitizeCell(row['PolicyRef'] || ''),
        clientName: sanitizeCell(row['ClientName'] || ''),
        clientAddress: sanitizeCell(row['ClientAddress'] || ''),
        policyType: normalizePolicyType(row['PolicyType'] || ''),
        insurerName: sanitizeCell(row['InsurerName'] || ''),
        inceptionDate: formatDate(row['InceptionDate'], 'DD/MM/YYYY'),
        expiryDate: formatDate(row['ExpiryDate'], 'DD/MM/YYYY'),
        premium: parsePremium(row['Premium'] || '0'),
        commission: parseCommission(row['Commission'] || ''),
        ncb: row['NCB'] !== undefined && row['NCB'] !== '' ? parseInt(row['NCB'], 10) || 0 : undefined,
        vehicleReg: sanitizeCell(row['VehicleReg'] || ''),
        coverType: sanitizeCell(row['CoverType'] || ''),
      };

    case 'acturis': {
      const addressParts = [
        row['AddressLine1'],
        row['AddressLine2'],
        row['City'],
        row['Postcode'],
      ].filter(Boolean);
      return {
        policyNumber: sanitizeCell(row['PolicyNo'] || ''),
        clientName: sanitizeCell(row['InsuredName'] || ''),
        clientAddress: sanitizeCell(addressParts.join(', ')),
        policyType: normalizePolicyType(row['Class'] || ''),
        insurerName: sanitizeCell(row['Insurer'] || ''),
        inceptionDate: formatDate(row['EffectiveDate'], 'YYYY-MM-DD'),
        expiryDate: formatDate(row['ExpirationDate'], 'YYYY-MM-DD'),
        premium: parseFloat(row['GrossPremium'] || '0') || 0,
        commission: parseFloat(row['CommissionRate'] || '') || undefined,
        status: sanitizeCell(row['Status'] || ''),
        claimsCount: row['Claims'] ? parseInt(row['Claims'], 10) : undefined,
      };
    }

    case 'generic_csv': {
      // Best-effort mapping using fuzzy header matching
      const getValue = (...candidates: string[]) => {
        for (const c of candidates) {
          const key = Object.keys(row).find(k =>
            k.toLowerCase().includes(c.toLowerCase())
          );
          if (key && row[key]) return row[key];
        }
        return '';
      };

      const premiumStr = getValue('premium', 'cost', 'price', 'annual');
      return {
        policyNumber: sanitizeCell(getValue('policy #', 'policy no', 'ref', 'number')),
        clientName: sanitizeCell(getValue('customer name', 'client', 'name', 'insured')),
        clientAddress: sanitizeCell(getValue('address', 'addr')),
        policyType: normalizePolicyType(getValue('type', 'category', 'class', 'product')),
        insurerName: sanitizeCell(getValue('company', 'insurer', 'provider')),
        inceptionDate: formatDate(getValue('start date', 'from', 'effective', 'begin'), 'DD/MM/YYYY'),
        expiryDate: formatDate(getValue('end date', 'to', 'expires', 'renewal date'), 'DD/MM/YYYY'),
        premium: parsePremium(premiumStr),
      };
    }

    default:
      return null;
  }
}

function formatDate(raw: string, _expectedFormat: string): string {
  if (!raw || raw.trim() === '') return '';
  const parsed = parseIrishDate(raw);
  if (!parsed) return ''; // return empty on parse failure, not raw string
  return formatISODate(parsed);
}

function normalizePolicyType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('motor') || lower.includes('car')) return 'motor';
  if (lower.includes('home') || lower.includes('house')) return 'home';
  if (lower.includes('commercial') || lower.includes('business') || lower.includes('shop')) return 'commercial';
  if (lower.includes('life')) return 'life';
  if (lower.includes('health')) return 'health';
  return lower || 'unknown';
}

function validatePolicy(policy: ParsedPolicy, row: number): ParseResult['errors'] {
  const errors: ParseResult['errors'] = [];

  if (!policy.policyNumber) {
    errors.push({ row, field: 'policyNumber', error: 'Required field missing', rawValue: '' });
  }
  if (!policy.clientName) {
    errors.push({ row, field: 'clientName', error: 'Required field missing', rawValue: '' });
  }
  if (!policy.inceptionDate) {
    errors.push({ row, field: 'inceptionDate', error: 'Invalid or missing date', rawValue: '' });
  }
  if (!policy.expiryDate) {
    errors.push({ row, field: 'expiryDate', error: 'Invalid or missing date', rawValue: '' });
  }
  if (policy.premium <= 0) {
    errors.push({ row, field: 'premium', error: 'Premium must be positive', rawValue: String(policy.premium) });
  }
  if (policy.inceptionDate) {
    const inception = new Date(policy.inceptionDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (inception > today) {
      errors.push({ row, field: 'inceptionDate', error: 'Inception date cannot be in the future', rawValue: policy.inceptionDate });
    }
  }
  if (policy.inceptionDate && policy.expiryDate) {
    const inc = new Date(policy.inceptionDate);
    const exp = new Date(policy.expiryDate);
    if (exp <= inc) {
      errors.push({ row, field: 'expiryDate', error: 'Expiry must be after inception', rawValue: policy.expiryDate });
    }
  }

  return errors;
}
