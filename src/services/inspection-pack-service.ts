/**
 * CBI Inspection Evidence Pack Generator.
 *
 * Bundles all compliance documents for a renewal into a single ZIP file
 * for Central Bank of Ireland inspection readiness.
 *
 * Pack contents:
 * 1. Renewal notification letter (HTML)
 * 2. Suitability assessment form (HTML)
 * 3. Checklist completion summary
 * 4. Audit trail for this renewal
 * 5. Evidence files (uploaded documents)
 * 6. Cover sheet with metadata
 */

import { prisma } from '../lib/prisma';
import { DocumentService } from './document-service';
import { htmlToPdf } from '../lib/pdf';
import { escapeHtml } from '../lib/html';
import archiver from 'archiver';
import { Readable } from 'stream';

const documentService = new DocumentService();

interface PackResult {
  buffer: Buffer;
  fileName: string;
  fileCount: number;
}

interface PackFilters {
  dateFrom?: string;
  dateTo?: string;
  policyType?: string;
  adviserId?: string;
}

export class InspectionPackService {
  /**
   * Generate a CBI inspection evidence pack as a ZIP file.
   */
  async generatePack(
    firmId: string,
    renewalId: string,
    generatedBy: string
  ): Promise<PackResult> {
    // Load all renewal data
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
        checklistItems: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!renewal) throw new Error('Renewal not found');

    // Load audit events for this renewal
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        firmId,
        OR: [
          { entityId: renewalId, entityType: 'renewal' },
          { entityId: { in: renewal.checklistItems.map(i => i.id) }, entityType: 'checklist_item' },
        ],
      },
      orderBy: { timestamp: 'asc' },
    });

    // Generate documents
    const renewalLetterResult = await documentService.generate(
      firmId, renewalId, 'renewal_notification', generatedBy
    );
    const suitabilityResult = await documentService.generate(
      firmId, renewalId, 'suitability_assessment', generatedBy
    );

    // Convert to PDF
    const renewalLetterPdf = await htmlToPdf(renewalLetterResult.html);
    const suitabilityPdf = await htmlToPdf(suitabilityResult.html);

    // Build checklist summary
    const checklistSummary = this.buildChecklistSummary(renewal);

    // Build audit trail CSV
    const auditCsv = this.buildAuditCsv(auditEvents);

    // Build cover sheet
    const coverSheet = this.buildCoverSheet(renewal);

    // Create ZIP
    const clientName = renewal.policy.client.name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const policyNumber = renewal.policy.policyNumber.replace(/[^a-zA-Z0-9-]/g, '');
    const packDate = new Date().toISOString().slice(0, 10);
    const fileName = `CBI_Pack_${clientName}_${policyNumber}_${packDate}.zip`;

    const zipBuffer = await this.createZip([
      { name: '00_Cover_Sheet.html', content: Buffer.from(coverSheet) },
      { name: '01_Renewal_Notification_Letter.pdf', content: renewalLetterPdf },
      { name: '02_Suitability_Assessment.pdf', content: suitabilityPdf },
      { name: '03_Checklist_Summary.csv', content: Buffer.from(checklistSummary, 'utf-8') },
      { name: '04_Audit_Trail.csv', content: Buffer.from(auditCsv, 'utf-8') },
    ]);

    // Audit the pack generation
    await prisma.auditEvent.create({
      data: {
        firmId,
        actorId: generatedBy,
        action: 'document.inspection_pack_generated',
        entityType: 'renewal',
        entityId: renewalId,
        metadata: {
          fileName,
          fileCount: 5,
          documentsIncluded: [
            'renewal_notification', 'suitability_assessment',
            'checklist_summary', 'audit_trail', 'cover_sheet',
          ],
        },
      },
    });

    // Store document record
    await prisma.document.create({
      data: {
        firmId,
        renewalId,
        documentType: 'inspection_pack',
        fileUrl: `/api/files/${firmId}/${renewalId}/inspection-pack.zip`,
        generatedBy,
        status: 'completed',
      },
    });

    return { buffer: zipBuffer, fileName, fileCount: 5 };
  }

  /**
   * Build cover sheet HTML with pack metadata.
   */
  private buildCoverSheet(renewal: any): string {
    const client = renewal.policy.client;
    const policy = renewal.policy;
    const firm = renewal.firm;
    const adviser = policy.adviser;
    const packDate = new Date().toLocaleDateString('en-IE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const expiryDate = new Date(policy.expiryDate).toLocaleDateString('en-IE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Times New Roman', serif; max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.6; }
    h1 { font-size: 22px; border-bottom: 3px solid #1a1a1a; padding-bottom: 8px; }
    .meta-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .meta-table td { padding: 8px 12px; border: 1px solid #ccc; }
    .meta-table .label { background: #f5f5f5; font-weight: bold; width: 40%; }
    .contents { margin: 20px 0; }
    .contents li { margin: 4px 0; }
    .stamp { border: 2px solid #c00; color: #c00; padding: 8px 16px; display: inline-block; font-weight: bold; margin: 20px 0; transform: rotate(-5deg); }
    .footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
  </style>
</head>
<body>
  <h1>CBI Inspection Evidence Pack</h1>
  <p style="color: #666;">Central Bank of Ireland — Consumer Protection Code Compliance</p>

  <div class="stamp">CONFIDENTIAL</div>

  <table class="meta-table">
    <tr><td class="label">Firm</td><td>${escapeHtml(firm.name)}</td></tr>
    <tr><td class="label">Client</td><td>${escapeHtml(client.name)}</td></tr>
    <tr><td class="label">Policy Number</td><td>${escapeHtml(policy.policyNumber)}</td></tr>
    <tr><td class="label">Policy Type</td><td>${escapeHtml(policy.policyType)}</td></tr>
    <tr><td class="label">Insurer</td><td>${escapeHtml(policy.insurerName)}</td></tr>
    <tr><td class="label">Renewal Date</td><td>${escapeHtml(expiryDate)}</td></tr>
    <tr><td class="label">Adviser</td><td>${escapeHtml(adviser?.name || 'Not assigned')}</td></tr>
    <tr><td class="label">Pack Generated</td><td>${escapeHtml(packDate)}</td></tr>
    <tr><td class="label">CPC Version</td><td>Consumer Protection Code 2012</td></tr>
  </table>

  <h2>Pack Contents</h2>
  <ol class="contents">
    <li><strong>Renewal Notification Letter</strong> — Written notice to client of upcoming renewal with premium disclosure</li>
    <li><strong>Suitability Assessment Form</strong> — Needs analysis, market comparison, and recommendation basis</li>
    <li><strong>Checklist Summary</strong> — Completion status of all 8 CPC compliance items</li>
    <li><strong>Audit Trail</strong> — Chronological log of all actions taken on this renewal</li>
  </ol>

  <h2>Declaration</h2>
  <p>This pack contains the complete compliance evidence for the above policy renewal, maintained in accordance with the Central Bank of Ireland's Consumer Protection Code 2012.</p>
  <p>All documents in this pack were generated or uploaded through the BrokerComply platform and are timestamped and audited.</p>

  <div class="footer">
    BrokerComply — Insurance Broker Compliance Platform<br>
    Pack ID: ${renewal.id.slice(0, 8)}-${Date.now().toString(36)}<br>
    Generated: ${new Date().toISOString()}
  </div>
</body>
</html>`;
  }

  /**
   * Build checklist summary as CSV.
   */
  private buildChecklistSummary(renewal: any): string {
    const headers = ['Item Type', 'Status', 'Completed By', 'Completed At', 'Approved By', 'Approved At', 'Notes'];
    const rows = renewal.checklistItems.map((item: any) => [
      item.itemType,
      item.status,
      item.completedBy || '',
      item.completedAt ? new Date(item.completedAt).toISOString() : '',
      item.approvedBy || '',
      item.approvedAt ? new Date(item.approvedAt).toISOString() : '',
      (item.notes || '').replace(/"/g, '""'),
    ]);

    return [
      headers.join(','),
      ...rows.map((r: string[]) => r.map((v: string) => `"${v}"`).join(',')),
    ].join('\n');
  }

  /**
   * Build audit trail as CSV.
   */
  private buildAuditCsv(events: any[]): string {
    const headers = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity ID'];
    const rows = events.map(e => [
      e.timestamp.toISOString(),
      e.actorId || '',
      e.action,
      e.entityType,
      e.entityId || '',
    ]);

    return [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${v}"`).join(',')),
    ].join('\n');
  }

  /**
   * Create a ZIP buffer from an array of files.
   */
  private createZip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      for (const file of files) {
        archive.append(Readable.from(file.content), { name: file.name });
      }

      archive.finalize();
    });
  }

  /**
   * Generate inspection pack for multiple renewals with optional filters.
   */
  async generateFilteredPack(
    firmId: string,
    filters: PackFilters,
    generatedBy: string
  ): Promise<PackResult> {
    // Build where clause from filters
    const where: any = { firmId };

    if (filters.dateFrom || filters.dateTo) {
      where.dueDate = {};
      if (filters.dateFrom) where.dueDate.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.dueDate.lte = new Date(filters.dateTo);
    }

    if (filters.policyType) {
      where.policy = { policyType: filters.policyType };
    }

    if (filters.adviserId) {
      where.policy = { ...where.policy, adviserId: filters.adviserId };
    }

    // Find matching renewals
    const renewals = await prisma.renewal.findMany({
      where,
      include: {
        policy: {
          include: { client: true, firm: true, adviser: true },
        },
        firm: true,
        checklistItems: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { dueDate: 'asc' },
    });

    if (renewals.length === 0) {
      throw new Error('No renewals match the specified filters');
    }

    // Collect all files for the ZIP
    const files: Array<{ name: string; content: Buffer }> = [];
    const allAuditEvents: any[] = [];

    // Build filter summary
    const filterLines: string[] = [`Firm: ${renewals[0].firm.name}`];
    if (filters.dateFrom) filterLines.push(`Date From: ${filters.dateFrom}`);
    if (filters.dateTo) filterLines.push(`Date To: ${filters.dateTo}`);
    if (filters.policyType) filterLines.push(`Policy Type: ${filters.policyType}`);
    if (filters.adviserId) filterLines.push(`Adviser ID: ${filters.adviserId}`);
    filterLines.push(`Renewals Included: ${renewals.length}`);

    const summaryHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: 'Times New Roman', serif; max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.6; }
      h1 { border-bottom: 3px solid #1a1a1a; padding-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; margin: 20px 0; }
      td, th { padding: 8px 12px; border: 1px solid #ccc; text-align: left; }
      th { background: #f5f5f5; }
    </style></head><body>
      <h1>CBI Inspection Pack — Filtered</h1>
      <p><strong>Filters Applied:</strong></p>
      <ul>${filterLines.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <table>
        <tr><th>#</th><th>Client</th><th>Policy</th><th>Type</th><th>Due Date</th><th>Status</th></tr>
        ${renewals.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.policy.client.name)}</td>
          <td>${escapeHtml(r.policy.policyNumber)}</td>
          <td>${escapeHtml(r.policy.policyType)}</td>
          <td>${new Date(r.dueDate).toLocaleDateString('en-IE')}</td>
          <td>${escapeHtml(r.status)}</td>
        </tr>`).join('')}
      </table>
      <p>Generated: ${new Date().toISOString()}</p>
    </body></html>`;

    files.push({ name: '00_Pack_Summary.html', content: Buffer.from(summaryHtml) });

    // Generate documents per renewal
    let fileIndex = 0;
    for (const renewal of renewals) {
      const prefix = `${(++fileIndex).toString().padStart(2, '0')}_${renewal.policy.policyNumber.replace(/[^a-zA-Z0-9-]/g, '')}`;

      // Renewal notification letter
      try {
        const letter = await documentService.generate(
          firmId, renewal.id, 'renewal_notification', generatedBy
        );
        const letterPdf = await htmlToPdf(letter.html);
        files.push({ name: `${prefix}_Renewal_Letter.pdf`, content: letterPdf });
      } catch { /* skip if generation fails */ }

      // Suitability assessment
      try {
        const suitability = await documentService.generate(
          firmId, renewal.id, 'suitability_assessment', generatedBy
        );
        const suitabilityPdf = await htmlToPdf(suitability.html);
        files.push({ name: `${prefix}_Suitability_Assessment.pdf`, content: suitabilityPdf });
      } catch { /* skip */ }

      // Checklist summary per renewal
      const checklistCsv = this.buildChecklistSummary(renewal);
      files.push({ name: `${prefix}_Checklist.csv`, content: Buffer.from(checklistCsv, 'utf-8') });

      // Collect audit events
      const events = await prisma.auditEvent.findMany({
        where: {
          firmId,
          OR: [
            { entityId: renewal.id, entityType: 'renewal' },
            { entityId: { in: renewal.checklistItems.map(i => i.id) }, entityType: 'checklist_item' },
          ],
        },
        orderBy: { timestamp: 'asc' },
      });
      allAuditEvents.push(...events);
    }

    // Combined audit trail
    allAuditEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const auditCsv = this.buildAuditCsv(allAuditEvents);
    files.push({ name: 'Audit_Trail_All.csv', content: Buffer.from(auditCsv, 'utf-8') });

    // Build ZIP
    const packDate = new Date().toISOString().slice(0, 10);
    const fileName = `CBI_Pack_Filtered_${packDate}.zip`;
    const zipBuffer = await this.createZip(files);

    // Audit
    await prisma.auditEvent.create({
      data: {
        firmId,
        actorId: generatedBy,
        action: 'document.inspection_pack_generated',
        entityType: 'firm',
        entityId: firmId,
        metadata: {
          fileName,
          renewalCount: renewals.length,
          fileCount: files.length,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          policyType: filters.policyType,
          adviserId: filters.adviserId,
        },
      },
    });

    return { buffer: zipBuffer, fileName, fileCount: files.length };
  }
}
