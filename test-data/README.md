# Test Data

Sample CSV files for testing the BMS import feature.

## Files

| File | Format | Rows | Purpose |
|------|--------|------|---------|
| `applied-epic-export.csv` | Applied Epic (TAM) | 8 | Standard export, all policy types |
| `acturis-export.csv` | Acturis | 6 | ISO dates, split address fields |
| `generic-export.csv` | Generic CSV | 5 | Fuzzy header matching |
| `edge-cases.csv` | Applied Epic | 10 | Duplicates, XSS, CSV injection, bad dates, missing fields |

## Usage

1. Open http://localhost:3000/import
2. Drag & drop or click to upload any CSV
3. Preview the detected format and mapped fields
4. Click "Import" to confirm

## Edge Cases to Test

- **POL-DUP-001** (×2): Exact duplicate — should skip or update
- **POL-SPACES**: Leading/trailing whitespace in fields
- **POL-CASE**: Lowercase policy ref — tests normalization
- **POL-MISSING**: Empty client name — should show validation error
- **POL-FUTURE**: Inception date in 2030 — should be rejected (future date)
- **POL-BADDATE**: Invalid date strings — should show parse error
- **POL-NEGATIVE**: Negative premium — should show validation error
- **POL-SCRIPT**: XSS in client name — should be escaped
- **POL-FORMULA**: CSV injection in client name — should be sanitized
