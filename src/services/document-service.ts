import { prisma } from '../lib/prisma';
import { AuditService } from './audit-service';
import { escapeHtml } from '../lib/html';

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
    <div class="firm-name">${escapeHtml(data.firmName)}</div>
    <div>${escapeHtml(data.firmAddress)}</div>
  </div>

  <div class="date">${escapeHtml(today)}</div>

  <div style="margin-top: 20px;">
    ${escapeHtml(data.clientName)}<br>
    ${escapeHtml(data.clientAddress)}
  </div>

  <div class="subject">Re: Renewal of your ${escapeHtml(data.policyType)} Insurance — Policy ${escapeHtml(data.policyNumber)}</div>

  <p>Dear ${escapeHtml(data.clientName.split(' ')[0])},</p>

  <p>Your ${escapeHtml(data.policyType.toLowerCase())} insurance policy with <strong>${escapeHtml(data.insurerName)}</strong> (Policy No: ${escapeHtml(data.policyNumber)}) is due for renewal on <strong>${escapeHtml(expiryFormatted)}</strong>.</p>

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

  <p>If you are happy to proceed with the renewal, no action is required — your policy will automatically renew on ${escapeHtml(expiryFormatted)}.</p>

  <p>If you wish to make any changes or do not wish to renew, please contact us before ${escapeHtml(expiryFormatted)}.</p>

  <div class="commission">
    <strong>Commission Disclosure:</strong> We receive commission of approximately ${data.commissionRate}% from ${escapeHtml(data.insurerName)} for arranging and administering this policy. This commission is included in the premium quoted above.
  </div>

  <div class="signature">
    <p>Yours sincerely,</p>
    <p><strong>${escapeHtml(data.adviserName)}</strong><br>${escapeHtml(data.firmName)}</p>
  </div>

  <div class="footer">
    ${escapeHtml(data.firmName)} is regulated by the Central Bank of Ireland.<br>
    This letter constitutes a renewal notification under the Consumer Protection Code ${data.cpcVersion === 'cp158' ? '(as revised by CP158)' : '2012'}.
  </div>
</body>
</html>`;
  }

  /**
   * Generate a CPC Suitability Assessment Form (HTML).
   * This is the primary compliance document CBI inspects.
   */
  generateSuitabilityAssessment(data: {
    clientName: string;
    policyNumber: string;
    policyType: string;
    insurerName: string;
    currentPremium: number;
    previousPremium: number;
    firmName: string;
    adviserName: string;
    expiryDate: string;
  }): string {
    const expiryFormatted = new Date(data.expiryDate).toLocaleDateString('en-IE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const today = new Date().toLocaleDateString('en-IE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const premiumChange = data.previousPremium > 0
      ? (((data.currentPremium - data.previousPremium) / data.previousPremium) * 100).toFixed(1)
      : '0';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Times New Roman', serif; max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #1a1a1a; }
    h1 { font-size: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; }
    h2 { font-size: 16px; margin-top: 24px; }
    .field { margin: 12px 0; }
    .label { font-weight: bold; display: inline-block; min-width: 200px; }
    .value { display: inline-block; }
    .checkbox-group { margin: 8px 0 8px 20px; }
    .checkbox { margin-right: 8px; }
    .section { border: 1px solid #ccc; padding: 16px; margin: 16px 0; }
    .declaration { margin-top: 30px; border-top: 2px solid #1a1a1a; padding-top: 16px; }
    .sign-line { margin-top: 40px; border-bottom: 1px solid #333; width: 300px; display: inline-block; }
    .footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
  </style>
</head>
<body>
  <h1>Suitability Assessment Form</h1>
  <p style="font-size: 13px; color: #666;">Consumer Protection Code 2012 — Section 14.2</p>

  <h2>1. Client & Policy Details</h2>
  <div class="section">
    <div class="field"><span class="label">Client Name:</span> <span class="value">${escapeHtml(data.clientName)}</span></div>
    <div class="field"><span class="label">Policy Number:</span> <span class="value">${escapeHtml(data.policyNumber)}</span></div>
    <div class="field"><span class="label">Policy Type:</span> <span class="value">${escapeHtml(data.policyType)}</span></div>
    <div class="field"><span class="label">Insurer:</span> <span class="value">${escapeHtml(data.insurerName)}</span></div>
    <div class="field"><span class="label">Renewal Date:</span> <span class="value">${escapeHtml(expiryFormatted)}</span></div>
  </div>

  <h2>2. Needs Analysis</h2>
  <div class="section">
    <p><strong>Has the client's circumstances changed since inception?</strong></p>
    <div class="checkbox-group">
      <span class="checkbox">☐ No changes</span>
      <span class="checkbox">☐ Change in risk profile</span>
      <span class="checkbox">☐ Change in coverage requirements</span>
      <span class="checkbox">☐ Change in claims history</span>
      <span class="checkbox">☐ Other (specify below)</span>
    </div>
    <p style="margin-top: 12px;"><strong>Details of any changes:</strong></p>
    <div style="border: 1px solid #ccc; min-height: 60px; padding: 8px; margin-top: 4px;"></div>
  </div>

  <h2>3. Market Analysis</h2>
  <div class="section">
    <div class="field"><span class="label">Previous Premium:</span> <span class="value">€${data.previousPremium.toFixed(2)}</span></div>
    <div class="field"><span class="label">Renewal Premium:</span> <span class="value">€${data.currentPremium.toFixed(2)}</span></div>
    <div class="field"><span class="label">Change:</span> <span class="value">${premiumChange}%</span></div>
    <p style="margin-top: 12px;"><strong>Number of markets reviewed:</strong></p>
    <div class="checkbox-group">
      <span class="checkbox">☐ 1 (existing insurer renewal)</span>
      <span class="checkbox">☐ 2-3 markets</span>
      <span class="checkbox">☐ 4+ markets</span>
      <span class="checkbox">☐ Fair analysis of market conducted</span>
    </div>
  </div>

  <h2>4. Recommendation</h2>
  <div class="section">
    <p><strong>Basis for recommendation:</strong></p>
    <div class="checkbox-group">
      <span class="checkbox">☐ Best price for equivalent cover</span>
      <span class="checkbox">☐ Best cover for client's needs</span>
      <span class="checkbox">☐ Existing relationship / claims handling</span>
      <span class="checkbox">☐ Client preference</span>
      <span class="checkbox">☐ No alternative available</span>
    </div>
    <p style="margin-top: 12px;"><strong>Additional rationale:</strong></p>
    <div style="border: 1px solid #ccc; min-height: 60px; padding: 8px; margin-top: 4px;"></div>
  </div>

  <h2>5. Premium & Commission Disclosure</h2>
  <div class="section">
    <div class="field"><span class="label">Premium Disclosed to Client:</span> <span class="value">☐ Yes</span></div>
    <div class="field"><span class="label">Commission Nature/Basis Disclosed:</span> <span class="value">☐ Yes</span></div>
  </div>

  <div class="declaration">
    <p><strong>Declaration:</strong></p>
    <p>I confirm that this suitability assessment has been carried out in accordance with the Consumer Protection Code 2012. The recommendation above is based on a fair analysis of the market and is suitable for the client's identified needs.</p>
    <br>
    <p>
      <span class="label">Adviser:</span> ${escapeHtml(data.adviserName)}<br>
      <span class="label">Firm:</span> ${escapeHtml(data.firmName)}<br>
      <span class="label">Date:</span> ${escapeHtml(today)}
    </p>
    <br><br>
    <p>Signature: <span class="sign-line">&nbsp;</span></p>
  </div>

  <div class="footer">
    ${escapeHtml(data.firmName)} is regulated by the Central Bank of Ireland.<br>
    This form is retained as evidence of compliance with CPC 2012 Section 14.2 (suitability requirements).
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
    } else if (documentType === 'suitability_assessment') {
      html = this.generateSuitabilityAssessment({
        clientName: renewal.policy.client.name,
        policyNumber: renewal.policy.policyNumber,
        policyType: renewal.policy.policyType,
        insurerName: renewal.policy.insurerName,
        currentPremium: Number(renewal.newPremium || renewal.policy.premium),
        previousPremium: Number(renewal.policy.premium),
        firmName: renewal.firm.name,
        adviserName: renewal.policy.adviser?.name || 'Adviser',
        expiryDate: renewal.policy.expiryDate.toISOString(),
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
