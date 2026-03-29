import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from '../../services/email-service';

describe('EmailService', () => {
  let service: EmailService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const baseReminderData = {
    clientName: 'Acme Corp',
    policyNumber: 'POL-2024-001',
    policyType: 'Professional Indemnity',
    insurerName: 'Allianz Ireland',
    expiryDate: new Date('2026-04-15'),
    premium: 2500.5,
    checklistProgress: '4/6 items',
    daysUntilDue: 7,
    renewalUrl: 'https://app.example.com/renewal/123',
    firmName: 'BrokerCo Ltd',
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // 1. send — dev mode without API key
  it('send — dev mode without API key: logs to console, returns success', async () => {
    delete process.env.RESEND_API_KEY;
    service = new EmailService();

    const result = await service.send({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'dev-mode' });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Test'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 2. send — with API key: mocks fetch to Resend API, verifies correct request body
  it('send — with API key: calls Resend API with correct body', async () => {
    process.env.RESEND_API_KEY = 're_real_key_123';
    service = new EmailService();

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg-abc' }),
    });

    const result = await service.send({
      to: ['a@x.com', 'b@x.com'],
      subject: 'Hello',
      html: '<b>world</b>',
      from: 'custom@example.com',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer re_real_key_123');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.from).toBe('custom@example.com');
    expect(body.to).toEqual(['a@x.com', 'b@x.com']);
    expect(body.subject).toBe('Hello');
    expect(body.html).toBe('<b>world</b>');

    expect(result).toEqual({ success: true, messageId: 'msg-abc' });
  });

  // 3. send — API failure: fetch returns non-200, returns success: false
  it('send — API failure: returns success: false on non-200', async () => {
    process.env.RESEND_API_KEY = 're_real_key_123';
    service = new EmailService();

    fetchMock.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Invalid API key'),
    });

    const result = await service.send({
      to: 'user@example.com',
      subject: 'Fail',
      html: '<p>Oops</p>',
    });

    expect(result).toEqual({ success: false });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Send failed'));
  });

  // 4. send — network error: fetch throws, returns success: false
  it('send — network error: returns success: false when fetch throws', async () => {
    process.env.RESEND_API_KEY = 're_real_key_123';
    service = new EmailService();

    fetchMock.mockRejectedValue(new Error('Network down'));

    const result = await service.send({
      to: 'user@example.com',
      subject: 'Error',
      html: '<p>Test</p>',
    });

    expect(result).toEqual({ success: false });
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Email] Send error:', expect.any(Error));
  });

  // 5. sendReminder — builds correct subject
  it('sendReminder — overdue prefix is "OVERDUE:", 7-day is "URGENT:"', async () => {
    service = new EmailService();

    // We can spy on the private method by capturing what send() receives
    const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({ success: true, messageId: 'x' });

    await service.sendReminder('broker@example.com', 'John', 'overdue', baseReminderData);
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('OVERDUE:'),
    }));

    sendSpy.mockClear();

    await service.sendReminder('broker@example.com', 'John', '7_day', baseReminderData);
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('URGENT:'),
    }));
  });

  // 6. sendReminder — HTML contains policy details
  it('sendReminder — HTML contains client name, policy number, and premium', async () => {
    service = new EmailService();

    const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({ success: true, messageId: 'x' });

    await service.sendReminder('broker@example.com', 'John', '20_day', baseReminderData);

    const html: string = sendSpy.mock.calls[0][0].html;
    expect(html).toContain('Acme Corp');
    expect(html).toContain('POL-2024-001');
    expect(html).toContain('€2500.50');
    expect(html).toContain('Professional Indemnity');
    expect(html).toContain('Allianz Ireland');
  });

  // 7. sendInviteEmail — contains temp password and firm name
  it('sendInviteEmail — HTML contains temp password and firm name', async () => {
    service = new EmailService();

    const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({ success: true, messageId: 'x' });

    await service.sendInviteEmail('newuser@example.com', 'Jane', {
      loginUrl: 'https://app.example.com/login',
      tempPassword: 'Temp$ecure!42',
      firmName: 'BrokerCo Ltd',
      invitedByName: 'Alice',
    });

    const html: string = sendSpy.mock.calls[0][0].html;
    expect(html).toContain('Temp$ecure!42');
    expect(html).toContain('BrokerCo Ltd');

    // Subject should also mention the firm
    const subject: string = sendSpy.mock.calls[0][0].subject;
    expect(subject).toContain('BrokerCo Ltd');
  });

  // 8. buildReminderHtml — XSS escaping: client name with script tag is escaped
  it('buildReminderHtml — XSS escaping: script tag in client name is escaped', async () => {
    service = new EmailService();

    const sendSpy = vi.spyOn(service, 'send').mockResolvedValue({ success: true, messageId: 'x' });

    const maliciousData = {
      ...baseReminderData,
      clientName: '<script>alert("xss")</script>',
    };

    await service.sendReminder('broker@example.com', 'John', '20_day', maliciousData);

    const html: string = sendSpy.mock.calls[0][0].html;
    // The script tag must be escaped, not rendered raw
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });
});
