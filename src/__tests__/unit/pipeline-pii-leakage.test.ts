import { describe, it, expect, vi } from 'vitest';

/**
 * SEC-02 verification: Ensure thread context PII is desensitized
 * before being sent to the LLM. This test verifies that the pipeline
 * does NOT send raw PII from thread context to the extractor.
 */
describe('pipeline PII leakage prevention', () => {
  it('desensitizes PII in thread context snippets', async () => {
    // Import the desensitize function directly
    const { desensitizePII } = await import('@/lib/agent/pii');

    // Simulate a raw thread email snippet with PII
    const rawSnippet = 'Dear John Smith, your policy POL-12345 renewal is due. Contact: john.smith@example.ie or 0871234567. PPS: 1234567T. Address: 42 Grafton Street, Dublin 2 D02 XW84';

    const result = desensitizePII(rawSnippet);

    // Verify PII is tokenized
    expect(result.desensitized).not.toContain('john.smith@example.ie');
    expect(result.desensitized).not.toContain('0871234567');
    expect(result.desensitized).not.toContain('1234567T');
    expect(result.desensitized).toContain('{EMAIL_');
    expect(result.desensitized).toContain('{PHONE_');
    expect(result.desensitized).toContain('{PPS_');

    // Verify Eircode detection
    expect(result.desensitized).toContain('{EIRCODE_');

    // Verify tokens can be re-sensitized
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it('desensitizes email addresses in thread context', async () => {
    const { desensitizePII } = await import('@/lib/agent/pii');

    const raw = 'From: aviva-renewals@aviva.ie\nHi team, please see the renewal for policy ABC-001. Premium €950 → €1,050.';
    const result = desensitizePII(raw);

    // Email from aviva.ie should be desensitized
    expect(result.desensitized).toContain('{EMAIL_');
    expect(result.desensitized).not.toContain('aviva-renewals@aviva.ie');
  });

  it('desensitizes PPS numbers with spaces', async () => {
    const { desensitizePII } = await import('@/lib/agent/pii');

    // PPS with space (common Irish format)
    const raw = 'PPS number is 1234567 AB for client John';
    const result = desensitizePII(raw);

    expect(result.desensitized).toContain('{PPS_');
    expect(result.desensitized).not.toContain('1234567 AB');
  });

  it('desensitizes Eircodes', async () => {
    const { desensitizePII } = await import('@/lib/agent/pii');

    const raw = 'Client address: 42 Grafton Street, Dublin 2 D02 XW84';
    const result = desensitizePII(raw);

    expect(result.desensitized).toContain('{EIRCODE_');
    expect(result.desensitized).not.toContain('D02 XW84');
  });

  it('does NOT falsely tokenize non-Eircode patterns', async () => {
    const { desensitizePII } = await import('@/lib/agent/pii');

    // Purely numeric suffix (not a valid Eircode)
    const raw = 'Reference number: A12 3456';
    const result = desensitizePII(raw);

    // Should NOT be tokenized as Eircode (all-digits suffix)
    expect(result.desensitized).not.toContain('{EIRCODE_');
  });

  it('resensitizes tokens back to original values', async () => {
    const { desensitizePII, resensitize } = await import('@/lib/agent/pii');

    const raw = 'Contact john@example.ie or 0871234567 about policy ABC-12345';
    const desensitized = desensitizePII(raw);

    // Find the actual token values for this input
    const emailToken = desensitized.tokens.find(t => t.type === 'email')?.token;
    const phoneToken = desensitized.tokens.find(t => t.type === 'phone')?.token;

    // Simulate LLM returning data with tokens
    const llmResponse = {
      clientEmail: emailToken,
      clientPhone: phoneToken,
    };

    const resensitized = resensitize(llmResponse, desensitized.tokens);

    // Tokens should be replaced with originals
    expect(resensitized.clientEmail).toBe('john@example.ie');
    expect(resensitized.clientPhone).toBe('0871234567');
  });

  it('handles PII in salutation names', async () => {
    const { desensitizePII } = await import('@/lib/agent/pii');

    const raw = 'Dear Sarah O\'Brien, your motor renewal for policy XYZ-7890 is due on 15/04/2027.';
    const result = desensitizePII(raw);

    expect(result.desensitized).toContain('{CLIENT_NAME_');
    expect(result.desensitized).not.toContain("O'Brien");
  });
});
