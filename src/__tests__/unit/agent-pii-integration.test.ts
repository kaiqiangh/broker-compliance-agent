import { describe, it, expect } from 'vitest';
import { desensitizePII, resensitize, PIIToken } from '../../lib/agent/pii';

/**
 * PII Integration Tests
 *
 * Verifies end-to-end PII desensitization:
 * 1. Real PII is removed before data reaches the LLM
 * 2. PII is correctly restored after LLM processing
 * 3. Zero leakage — desensitized text contains no original PII values
 */

describe('PII integration: round-trip', () => {
  it('desensitize → resensitize restores all PII in text', () => {
    const original =
      'Contact john@example.com or 0851234567 about policy POL-2024-001. PPS: 1234567T';
    const { desensitized, tokens } = desensitizePII(original);
    const restored = resensitize(desensitized, tokens);
    expect(restored).toBe(original);
  });

  it('round-trip with mixed PII types (email, phone, policy, IBAN)', () => {
    const original =
      'Contact a@b.ie or +353851234567 re policy POL-99999, IBAN IE29AIBK93115212345678';
    const { desensitized, tokens } = desensitizePII(original);
    // Verify token count covers all types
    const types = new Set(tokens.map((t) => t.type));
    expect(types).toContain('email');
    expect(types).toContain('phone');
    expect(types).toContain('policy_number');
    expect(types).toContain('iban');
    // Round-trip
    expect(resensitize(desensitized, tokens)).toBe(original);
  });

  it('round-trip with nested object containing PII', () => {
    const original = 'Send to john@test.ie re policy POL-12345';
    const { desensitized, tokens } = desensitizePII(original);
    const llmOutput = {
      summary: desensitized,
      details: [desensitized],
      nested: { note: desensitized },
    };
    const restored = resensitize(llmOutput, tokens);
    expect(restored.summary).toBe(original);
    expect(restored.details[0]).toBe(original);
    expect(restored.nested.note).toBe(original);
  });

  it('round-trip preserves non-PII content exactly', () => {
    const original =
      'Premium is €1,350.00 and expires 15/03/2027. Email john@test.com for details.';
    const { desensitized, tokens } = desensitizePII(original);
    const restored = resensitize(desensitized, tokens);
    expect(restored).toBe(original);
    // Non-PII parts preserved in desensitized form too
    expect(desensitized).toContain('€1,350.00');
    expect(desensitized).toContain('15/03/2027');
  });
});

describe('PII integration: zero leakage', () => {
  it('desensitized text contains no original email', () => {
    const email = 'sean.obrien@company.ie';
    const { desensitized } = desensitizePII(`Contact ${email} now.`);
    expect(desensitized).not.toContain(email);
    expect(desensitized).not.toContain('sean.obrien');
    expect(desensitized).not.toContain('company.ie');
  });

  it('desensitized text contains no original phone', () => {
    const phone = '0851234567';
    const { desensitized } = desensitizePII(`Call ${phone} today.`);
    expect(desensitized).not.toContain(phone);
    expect(desensitized).not.toContain('085');
  });

  it('desensitized text contains no original policy number', () => {
    const policy = 'POL-2024-999';
    const { desensitized } = desensitizePII(`Policy ${policy} renewed.`);
    expect(desensitized).not.toContain(policy);
    expect(desensitized).not.toContain('POL-2024');
  });

  it('desensitized text contains no PPS number', () => {
    const pps = '9876543W';
    const { desensitized } = desensitizePII(`PPS: ${pps} for records.`);
    expect(desensitized).not.toContain(pps);
  });

  it('realistic email: no PII leaks', () => {
    const text = `Dear John Murphy,

Policy POL-2024-001 is due for renewal.
Contact: john@example.com or 0851234567.
PPS: 1234567T
IBAN: IE29AIBK93115212345678
Vehicle: 231-D-12345

Kind regards,
Sarah Kelly`;

    const { desensitized, tokens } = desensitizePII(text);

    // Every original PII value must be absent from desensitized text
    const piiValues = [
      'john@example.com',
      '0851234567',
      'POL-2024-001',
      '1234567T',
      'IE29AIBK93115212345678',
      '231-D-12345',
      'John Murphy',
      'Sarah Kelly',
    ];
    for (const val of piiValues) {
      expect(desensitized).not.toContain(val);
    }

    // Tokens cover ≥5 distinct PII types
    const types = new Set(tokens.map((t) => t.type));
    expect(types.size).toBeGreaterThanOrEqual(5);

    // Resensitize restores tokenized PII values (name regex may alter formatting)
    const restored = resensitize(desensitized, tokens);
    for (const t of tokens) {
      expect(restored).toContain(t.original);
    }
  });
});

describe('PII integration: PII types coverage', () => {
  it('email: desensitized and restored correctly', () => {
    const text = 'Email: user.name+tag@domain.co.uk';
    const { desensitized, tokens } = desensitizePII(text);
    const emailTokens = tokens.filter((t) => t.type === 'email');
    expect(emailTokens.length).toBe(1);
    expect(desensitized).toContain('{EMAIL_');
    expect(desensitized).not.toContain('user.name+tag@domain.co.uk');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('phone (Irish 085 format): desensitized and restored', () => {
    const text = 'Phone: 0851234567';
    const { desensitized, tokens } = desensitizePII(text);
    const phoneTokens = tokens.filter((t) => t.type === 'phone');
    expect(phoneTokens.length).toBe(1);
    expect(desensitized).toContain('{PHONE_');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('phone (Irish +353 format): desensitized and restored', () => {
    const text = 'Phone: +353851234567';
    const { desensitized, tokens } = desensitizePII(text);
    const phoneTokens = tokens.filter((t) => t.type === 'phone');
    expect(phoneTokens.length).toBe(1);
    expect(desensitized).not.toContain('+353851234567');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('policy number: desensitized and restored', () => {
    const text = 'Ref: POL-2024-001';
    const { desensitized, tokens } = desensitizePII(text);
    const policyTokens = tokens.filter((t) => t.type === 'policy_number');
    expect(policyTokens.length).toBe(1);
    expect(policyTokens[0].original).toBe('POL-2024-001');
    expect(desensitized).toContain('{POLICY_');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('PPS number: desensitized and restored', () => {
    const text = 'PPS: 1234567T';
    const { desensitized, tokens } = desensitizePII(text);
    const ppsTokens = tokens.filter((t) => t.type === 'pps');
    expect(ppsTokens.length).toBe(1);
    expect(desensitized).toContain('{PPS_');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('VRN: desensitized and restored', () => {
    const text = 'Reg: 231-D-12345';
    const { desensitized, tokens } = desensitizePII(text);
    const vrnTokens = tokens.filter((t) => t.type === 'vrn');
    expect(vrnTokens.length).toBe(1);
    expect(desensitized).toContain('{VRN_');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('IBAN: desensitized and restored', () => {
    const text = 'IBAN: IE29AIBK93115212345678';
    const { desensitized, tokens } = desensitizePII(text);
    const ibanTokens = tokens.filter((t) => t.type === 'iban');
    expect(ibanTokens.length).toBe(1);
    expect(desensitized).toContain('{IBAN_');
    expect(resensitize(desensitized, tokens)).toBe(text);
  });
});

describe('PII integration: edge cases', () => {
  it('nested object: PII in string fields restored recursively', () => {
    const input = 'email john@test.ie re POL-11111';
    const { desensitized, tokens } = desensitizePII(input);
    const obj = {
      field1: desensitized,
      nested: { deep: desensitized },
      arr: [desensitized, { inner: desensitized }],
    };
    const restored = resensitize(obj, tokens);
    expect(restored.field1).toBe(input);
    expect(restored.nested.deep).toBe(input);
    expect(restored.arr[0]).toBe(input);
    expect(restored.arr[1].inner).toBe(input);
  });

  it('no PII in text: desensitize is identity, resensitize is identity', () => {
    const text = 'This policy renewal is standard. No issues found.';
    const { desensitized, tokens } = desensitizePII(text);
    expect(desensitized).toBe(text);
    expect(tokens).toHaveLength(0);
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('unicode characters preserved through round-trip', () => {
    const text = 'Seán Ó Briain — contact sean@example.ie about POL-55555';
    const { desensitized, tokens } = desensitizePII(text);
    // Unicode non-PII parts remain
    expect(desensitized).toContain('—');
    expect(desensitized).toContain('Ó');
    // Round-trip restores original
    expect(resensitize(desensitized, tokens)).toBe(text);
  });

  it('empty string: no error, identity round-trip', () => {
    const { desensitized, tokens } = desensitizePII('');
    expect(desensitized).toBe('');
    expect(tokens).toHaveLength(0);
    expect(resensitize(desensitized, tokens)).toBe('');
  });

  it('resensitize handles null and undefined data', () => {
    const tokens: PIIToken[] = [];
    expect(resensitize(null, tokens)).toBeNull();
    expect(resensitize(undefined, tokens)).toBeUndefined();
  });

  it('resensitize handles numeric and boolean data unchanged', () => {
    const tokens: PIIToken[] = [];
    expect(resensitize(42, tokens)).toBe(42);
    expect(resensitize(true, tokens)).toBe(true);
  });
});

describe('PII integration: token format', () => {
  it('all tokens match {TYPE_N} pattern', () => {
    const text = 'Email a@b.com, phone 0851234567, policy POL-12345, PPS 1234567T';
    const { tokens } = desensitizePII(text);
    for (const t of tokens) {
      expect(t.token).toMatch(/^\{[A-Z_]+\d+\}$/);
    }
  });

  it('token numbers are sequential within a single call', () => {
    const text = 'a@b.com c@d.com 0851234567 POL-11111';
    const { tokens } = desensitizePII(text);
    const numbers = tokens.map((t) => parseInt(t.token.match(/\d+/)![0], 10));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
    }
  });

  it('each token has required fields: token, original, type', () => {
    const text = 'Contact john@test.com about POL-99999';
    const { tokens } = desensitizePII(text);
    for (const t of tokens) {
      expect(t).toHaveProperty('token');
      expect(t).toHaveProperty('original');
      expect(t).toHaveProperty('type');
      expect(typeof t.token).toBe('string');
      expect(typeof t.original).toBe('string');
      expect(typeof t.type).toBe('string');
    }
  });
});
