/**
 * Email service using Resend API.
 * Falls back to console logging if RESEND_API_KEY is not configured.
 */

import { escapeHtml } from '../lib/html';

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export class EmailService {
  private apiKey: string | undefined;
  private fromAddress: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY;
    this.fromAddress = process.env.EMAIL_FROM || 'noreply@brokercompliance.ie';
  }

  async send(options: EmailOptions): Promise<{ success: boolean; messageId?: string }> {
    const to = Array.isArray(options.to) ? options.to : [options.to];

    // Development mode: log to console
    if (!this.apiKey || this.apiKey.startsWith('re_placeholder')) {
      console.log(`[Email] TO: ${to.join(', ')} | SUBJECT: ${options.subject}`);
      return { success: true, messageId: 'dev-mode' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from || this.fromAddress,
          to,
          subject: options.subject,
          html: options.html,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[Email] Send failed: ${error}`);
        return { success: false };
      }

      const data = await response.json();
      return { success: true, messageId: data.id };
    } catch (err) {
      console.error('[Email] Send error:', err);
      return { success: false };
    }
  }

  async sendReminder(
    to: string,
    recipientName: string,
    reminderType: string,
    data: {
      clientName: string;
      policyNumber: string;
      policyType: string;
      insurerName: string;
      expiryDate: Date;
      premium: number;
      checklistProgress: string;
      daysUntilDue: number;
      renewalUrl: string;
      firmName: string;
    }
  ) {
    const subject = this.getSubject(reminderType, data);
    const html = this.buildReminderHtml(recipientName, reminderType, data);

    return this.send({ to, subject, html });
  }

  async sendDigest(
    to: string[],
    firmName: string,
    reminderType: string,
    renewals: Array<{
      clientName: string;
      policyNumber: string;
      dueDate: Date;
      daysUntilDue: number;
    }>
  ) {
    const subject = `${firmName}: ${renewals.length} renewals ${reminderType.replace('_', ' ')} reminder`;
    const html = this.buildDigestHtml(firmName, renewals);

    return this.send({ to, subject, html });
  }

  private getSubject(reminderType: string, data: { clientName: string; policyNumber: string }): string {
    const prefixes: Record<string, string> = {
      '40_day': 'Upcoming renewal',
      '20_day': 'Renewal action required',
      '7_day': 'URGENT: renewal in 7 days',
      '1_day': 'URGENT: renewal expires tomorrow',
      'overdue': 'OVERDUE: renewal past deadline',
    };
    return `${prefixes[reminderType] || 'Renewal reminder'}: ${escapeHtml(data.clientName)} — ${escapeHtml(data.policyNumber)}`;
  }

  private buildReminderHtml(recipientName: string, reminderType: string, data: {
    clientName: string;
    policyNumber: string;
    policyType: string;
    insurerName: string;
    expiryDate: Date;
    premium: number;
    checklistProgress: string;
    daysUntilDue: number;
    renewalUrl: string;
    firmName: string;
  }): string {
    const expiryFormatted = new Date(data.expiryDate).toLocaleDateString('en-IE');
    const urgencyColor = reminderType === 'overdue' ? '#dc2626' :
                         reminderType === '1_day' ? '#dc2626' :
                         reminderType === '7_day' ? '#ea580c' : '#2563eb';

    return `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: ${urgencyColor};">${this.getSubject(reminderType, data)}</h2>
  <p>Hi ${escapeHtml(recipientName)},</p>
  <p>A renewal requires your attention:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Client</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(data.clientName)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Policy</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(data.policyNumber)} (${escapeHtml(data.policyType)})</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Insurer</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(data.insurerName)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Expiry</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(expiryFormatted)} (${data.daysUntilDue} days)</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Premium</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">€${data.premium.toFixed(2)}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Checklist</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb;">${data.checklistProgress}</td></tr>
  </table>
  <p><a href="${data.renewalUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">View Renewal</a></p>
  <p style="color: #6b7280; font-size: 12px;">This is an automated message from ${escapeHtml(data.firmName)} via BrokerComply.</p>
</body>
</html>`;
  }

  async sendInviteEmail(
    to: string,
    recipientName: string,
    data: {
      loginUrl: string;
      tempPassword: string;
      firmName: string;
      invitedByName: string;
    }
  ) {
    const subject = `You've been invited to ${data.firmName} on BrokerComply`;
    const html = this.buildInviteHtml(recipientName, data);
    return this.send({ to, subject, html });
  }

  private buildInviteHtml(recipientName: string, data: {
    loginUrl: string;
    tempPassword: string;
    firmName: string;
    invitedByName: string;
  }): string {
    return `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">You've been invited to BrokerComply</h2>
  <p>Hi ${escapeHtml(recipientName)},</p>
  <p>${escapeHtml(data.invitedByName)} has invited you to join <strong>${escapeHtml(data.firmName)}</strong> on BrokerComply.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Temporary Password</strong></td><td style="padding: 8px; border: 1px solid #e5e7eb; font-family: monospace;">${escapeHtml(data.tempPassword)}</td></tr>
  </table>
  <p><a href="${escapeHtml(data.loginUrl)}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Sign in to BrokerComply</a></p>
  <p><strong>Important:</strong> After your first login, please change your password in your account settings.</p>
  <p style="color: #6b7280; font-size: 12px;">This is an automated message from BrokerComply.</p>
</body>
</html>`;
  }

  private buildDigestHtml(firmName: string, renewals: Array<{
    clientName: string;
    policyNumber: string;
    dueDate: Date;
    daysUntilDue: number;
  }>): string {
    const rows = renewals.map(r => `
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(r.clientName)}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(r.policyNumber)}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(new Date(r.dueDate).toLocaleDateString('en-IE'))}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${r.daysUntilDue} days</td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2>${escapeHtml(firmName)}: ${renewals.length} upcoming renewals</h2>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Client</th>
        <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Policy</th>
        <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Due Date</th>
        <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Days</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p><a href="${process.env.APP_URL || 'http://localhost:3000'}/dashboard" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">View Dashboard</a></p>
</body>
</html>`;
  }
}
