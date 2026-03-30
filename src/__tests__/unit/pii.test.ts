import { describe, it, expect } from 'vitest';
import { desensitizePII, resensitize } from '../../lib/agent/pii';

describe('desensitizePII', () => {
  it('replaces email addresses with tokens', () => {
    const text = 'Contact the client at john.doe@example.com for details.';
    const { desensitized, tokens } = desensitizePII(text);
    expect(desensitized).not.toContain('john.doe@example.com');
    expect(desensitized).toContain('{EMAIL_1}');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].original).toBe('john.doe@example.com');
    expect(tokens[0].type).toBe('email');
  });

  it('replaces multiple email addresses', () => {
    const text = 'CC: broker@firm.ie and client@gmail.com';
    const { desensitized, tokens } = desensitizePII(text);
    expect(tokens.filter(t => t.type === 'email')).toHaveLength(2);
  });

  it('replaces Irish phone numbers', () => {
    const text = 'Call us at 0851234567 or +353851234567';
    const { desensitized, tokens } = desensitizePII(text);
    expect(tokens.filter(t => t.type === 'phone').length).toBeGreaterThan(0);
    expect(desensitized).not.toContain('0851234567');
  });

  it('replaces policy numbers', () => {
    const text = 'Policy POL-2024-001 is due for renewal.';
    const { desensitized, tokens } = desensitizePII(text);
    const policyTokens = tokens.filter(t => t.type === 'policy_number');
    expect(policyTokens.length).toBeGreaterThan(0);
    expect(policyTokens[0].original).toBe('POL-2024-001');
  });

  it('replaces PPS numbers', () => {
    const text = 'PPS: 1234567T for verification.';
    const { desensitized, tokens } = desensitizePII(text);
    const ppsTokens = tokens.filter(t => t.type === 'pps');
    expect(ppsTokens.length).toBeGreaterThan(0);
    expect(ppsTokens[0].original).toBe('1234567T');
  });

  it('replaces date of birth near DOB keyword', () => {
    const text = 'Date of birth: 15/03/1985 for the client.';
    const { desensitized, tokens } = desensitizePII(text);
    const dobTokens = tokens.filter(t => t.type === 'dob');
    expect(dobTokens.length).toBeGreaterThan(0);
    expect(dobTokens[0].original).toBe('15/03/1985');
  });

  it('does not replace non-PII text', () => {
    const text = 'The premium is €1,350.00 and expires on 15/03/2027.';
    const { desensitized, tokens } = desensitizePII(text);
    expect(desensitized).toContain('€1,350.00');
    expect(desensitized).toContain('15/03/2027');
    // Dates not near DOB keyword should NOT be replaced
    expect(tokens.filter(t => t.type === 'dob')).toHaveLength(0);
  });

  it('handles text with no PII', () => {
    const text = 'This is a general insurance update.';
    const { desensitized, tokens } = desensitizePII(text);
    expect(desensitized).toBe(text);
    expect(tokens).toHaveLength(0);
  });

  it('handles empty text', () => {
    const { desensitized, tokens } = desensitizePII('');
    expect(desensitized).toBe('');
    expect(tokens).toHaveLength(0);
  });

  it('assigns unique token numbers', () => {
    const text = 'Email a@test.com b@test.com c@test.com';
    const { tokens } = desensitizePII(text);
    const tokenNumbers = tokens.map(t => t.token.match(/\d+/)?.[0]);
    const uniqueNumbers = new Set(tokenNumbers);
    expect(uniqueNumbers.size).toBe(tokens.length);
  });

  it('handles mixed PII in realistic email', () => {
    const text = `Dear Broker,

Policy POL-2024-001 for client Seán Ó Briain (DOB: 15/03/1985) is due for renewal.
Contact: john@example.com or 0851234567.
PPS: 1234567T
New premium: €1,350.00
New expiry: 15/03/2027

Regards,
Aviva Ireland`;

    const { desensitized, tokens } = desensitizePII(text);
    // PII should be replaced
    expect(desensitized).not.toContain('john@example.com');
    expect(desensitized).not.toContain('1234567T');
    expect(desensitized).not.toContain('POL-2024-001');
    // Non-PII should be preserved
    expect(desensitized).toContain('€1,350.00');
    expect(desensitized).toContain('Seán Ó Briain'); // Name detection is hard, might not replace
    expect(desensitized).toContain('15/03/2027'); // Expiry date not near DOB
  });
});

describe('resensitize', () => {
  it('restores PII from tokens in extracted data', () => {
    const tokens = [
      { token: '{EMAIL_1}', original: 'john@example.com', type: 'email' },
      { token: '{POLICY_1}', original: 'POL-2024-001', type: 'policy_number' },
    ];

    const extracted = {
      clientEmail: '{EMAIL_1}',
      policyNumber: '{POLICY_1}',
      premium: 1350,
    };

    const restored = resensitize(extracted, tokens);
    expect(restored.clientEmail).toBe('john@example.com');
    expect(restored.policyNumber).toBe('POL-2024-001');
    expect(restored.premium).toBe(1350);
  });

  it('handles nested objects', () => {
    const tokens = [
      { token: '{EMAIL_1}', original: 'test@test.com', type: 'email' },
    ];

    const extracted = {
      client: { email: '{EMAIL_1}', name: 'John' },
    };

    const restored = resensitize(extracted, tokens);
    expect(restored.client.email).toBe('test@test.com');
  });

  it('leaves unknown tokens unchanged', () => {
    const tokens: any[] = [];
    const extracted = { data: '{UNKNOWN_1}' };
    const restored = resensitize(extracted, tokens);
    expect(restored.data).toBe('{UNKNOWN_1}');
  });

  it('handles data with no tokens', () => {
    const tokens: any[] = [];
    const extracted = { premium: 1350, expiry: '2027-03-15' };
    const restored = resensitize(extracted, tokens);
    expect(restored).toEqual(extracted);
  });
});
