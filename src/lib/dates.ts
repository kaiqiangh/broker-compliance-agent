import { format, parse, differenceInDays, subDays, isValid } from 'date-fns';

/**
 * Detect and parse date formats common in Irish BMS exports.
 * Priority: DD/MM/YYYY (Irish standard) > YYYY-MM-DD (ISO) > MM/DD/YYYY (rare)
 */
export function parseIrishDate(raw: string): Date | null {
  if (!raw || raw.trim() === '') return null;
  const trimmed = raw.trim();

  // Try YYYY-MM-DD first (ISO, unambiguous)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = parse(trimmed, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : null;
  }

  // Try DD/MM/YYYY (Irish standard)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split('/').map(Number);
    // Validate ranges
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
    // Construct and verify (catches invalid combos like Feb 30)
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }

  // Try DD-MMM-YYYY (e.g., 15-Mar-2024)
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(trimmed)) {
    const d = parse(trimmed, 'dd-MMM-yyyy', new Date());
    return isValid(d) ? d : null;
  }

  return null;
}

/**
 * Format a date as DD/MM/YYYY (Irish display format)
 */
export function formatIrishDate(date: Date): string {
  return format(date, 'dd/MM/yyyy');
}

/**
 * Format a date as YYYY-MM-DD (ISO for storage)
 */
export function formatISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Calculate days between two dates
 */
export function daysBetween(a: Date, b: Date): number {
  return differenceInDays(b, a);
}

/**
 * Calculate renewal timeline dates from policy expiry
 */
export function calculateRenewalTimeline(expiryDate: Date, cpcVersion: '2012' | 'cp158' = '2012') {
  const base = {
    renewalNotice: subDays(expiryDate, 20),
    urgentReminder: subDays(expiryDate, 7),
    finalReminder: subDays(expiryDate, 1),
  };

  if (cpcVersion === 'cp158') {
    return {
      preRenewalNotice: subDays(expiryDate, 40),
      ...base,
    };
  }

  return base;
}

/**
 * Determine renewal status based on days until expiry and checklist completion
 */
export function calculateRenewalStatus(
  dueDate: Date,
  completedCount: number,
  totalCount: number
): 'pending' | 'in_progress' | 'at_risk' | 'compliant' | 'overdue' {
  const daysUntil = daysBetween(new Date(), dueDate);

  // Empty checklist is not compliant — it's pending
  if (totalCount === 0) {
    return daysUntil < 0 ? 'overdue' : 'pending';
  }

  if (completedCount >= totalCount) return 'compliant';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 7 && completedCount < totalCount) return 'at_risk';
  if (completedCount > 0) return 'in_progress';
  return 'pending';
}
