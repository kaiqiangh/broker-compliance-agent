import { prisma } from '../lib/prisma';
import { AuditService } from './audit-service';

const auditService = new AuditService();

interface RenewalLetterData {
  clientName: string;
  clientAddress: string;
  policyNumber: string;
  policyType: string;
  insurerName: string;
  expiryDate: string;
  currentPremium: number;
  previousPremium: number;
  ncb: number | null;
  firmName: string;
  firmAddress: string;
  adviserName: string;
  commissionRate: number;
  cpcVersion: '2012' | 'cp158';
}

export class DocumentService {
  /**
   * Generate a CPC renewal notification letter (HTML).
   * Returns HTML string — can be rendered as PDF later with Puppeteer.
   */
  generateRenewalLetter(data: RenewalLetterData): string {
    const premiumChange = data.previousPremium > 0
      ? (((data.currentPremium - data.previousPremium) / data.previousPremium) * 100).toFixed(1)
      : '0';
    const premiumDirection = data.currentPremium >= data.previousPremium ? 'increased' : 'decreased';

    const expiryFormatted = new Date(data.expiryDate).toLocaleDateString('en-IE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    const today = new Date().toLocaleDateString('en-IE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Times New Roman', serif; max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #1a1a1a; }
    .header { margin-bottom: 30px; }
    .firm-name { font-size: 18px; font-weight: bold; }
    .date { margin-top: 20px; }
    .subject { font-weight: bold; margin: 20px 0; }
    .premium-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .premium-table td { padding: 8px 12px; border: 1px solid #ccc; }
    .premium-table .label { background: #f5f5f5; font-weight: bold; width: 40%; }
    .notice { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; margin: 16px 0; }
    .commission { font-size: 12px; color: #666; margin-top: 20px; }
    .signature { margin-top: 40px; }
    .footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="firm-name">${data.firmName}</div>
    <div>${data.firmAddress}</div>
  </div>

  <div class="date">${today}</div>

  <div style="margin-top: 20px;">
    ${data.clientName}<br>
    ${data.clientAddress}
  </div>

  <div class="subject">Re: Renewal of your ${data.policyType} Insurance — Policy ${data.policyNumber}</div>

  <p>Dear ${data.clientName.split(' ')[0]},</p>

  <p>Your ${data.policyType.toLowerCase()} insurance policy with <strong>${data.insurerName}</strong> (Policy No: ${data.policyNumber}) is due for renewal on <strong>${expiryFormatted}</strong>.</p>

  <table class="premium-table">
    <tr><td class="label">Previous Premium</td><td>€${data.previousPremium.toFixed(2)}</td></tr>
    <tr><td class="label">Renewal Premium</td><td>€${data.currentPremium.toFixed(2)}</td></tr>
    <tr><td class="label">Change</td><td>${premiumDirection} by ${premiumChange}%</td></tr>
    ${data.ncb !== null ? `<tr><td class="label">No Claims Bonus</td><td>${data.ncb} years</td></tr>` : ''}
  </table>

  ${data.currentPremium > data.previousPremium ? `
  <div class="notice">
    <strong>Why has my premium changed?</strong><br>
    Insurance premiums can change due to various factors including claims experience, market conditions, inflation, and changes to your risk profile. Please contact us if you would like to discuss your renewal or explore alternative options.
  </div>
  ` : ''}

  <p>We have reviewed your policy and believe it continues to meet your insurance needs. If your circumstances have changed since your last renewal, or if you would like to discuss your cover, please contact us before the renewal date.</p>

  <p>If you are happy to proceed with the renewal, no action is required — your policy will automatically renew on ${expiryFormatted}.</p>

  <p>If you wish to make any changes or do not wish to renew, please contact us before ${expiryFormatted}.</p>

  <div class="commission">
    <strong>Commission Disclosure:</strong> We receive commission of approximately ${data.commissionRate}% from ${data.insurerName} for arranging and administering this policy. This commission is included in the premium quoted above.
  </div>

  <div class="signature">
    <p>Yours sincerely,</p>
    <p><strong>${data.adviserName}</strong><br>${data.firmName}</p>
  </div>

  <div class="footer">
    ${data.firmName} is regulated by the Central Bank of Ireland.<br>
    This letter constitutes a renewal notification under the Consumer Protection Code ${data.cpcVersion === 'cp158' ? '(as revised by CP158)' : '2012'}.
  </div>
</body>
</html>`;
  }

  /**
   * Generate and store a document.
   */
  async generate(
    firmId: string,
    renewalId: string,
    documentType: string,
    generatedBy: string
  ): Promise<{ id: string; html: string }> {
    // Load renewal data
    const renewal = await prisma.renewal.findFirst({
      where: { id: renewalId, firmId },
      include: {
        policy: {
          include: {
            client: true,
            firm: true,
            adviser: true,
          },
        },
        firm: true,
      },
    });

    if (!renewal) throw new Error('Renewal not found');

    let html = '';

    if (documentType === 'renewal_notification') {
      html = this.generateRenewalLetter({
        clientName: renewal.policy.client.name,
        clientAddress: renewal.policy.client.address || '',
        policyNumber: renewal.policy.policyNumber,
        policyType: renewal.policy.policyType,
        insurerName: renewal.policy.insurerName,
        expiryDate: renewal.policy.expiryDate.toISOString(),
        currentPremium: Number(renewal.newPremium || renewal.policy.premium),
        previousPremium: Number(renewal.policy.premium),
        ncb: renewal.policy.ncb,
        firmName: renewal.firm.name,
        firmAddress: '',
        adviserName: renewal.policy.adviser?.name || 'Adviser',
        commissionRate: renewal.policy.commissionRate ? Number(renewal.policy.commissionRate) : 12.5,
        cpcVersion: '2012',
      });
    }

    // Store document record
    const document = await prisma.document.create({
      data: {
        firmId,
        renewalId,
        documentType,
        fileUrl: `documents/${firmId}/${renewalId}/${documentType}.html`,
        generatedBy,
        status: 'completed',
      },
    });

    // Audit
    await auditService.log({
      firmId,
      actorId: generatedBy,
      action: 'document.generated',
      entityType: 'document',
      entityId: document.id,
      metadata: { documentType, renewalId },
    });

    return { id: document.id, html };
  }
}
