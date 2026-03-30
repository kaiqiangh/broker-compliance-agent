import { prisma, runWithFirmContext } from '@/lib/prisma';
import { classifyEmail } from '@/lib/agent/classifier';
import { extractData } from '@/lib/agent/extractor';
import { desensitizePII, resensitize } from '@/lib/agent/pii';
import { matchRecords } from '@/lib/agent/matcher';
import { generateAction } from '@/lib/agent/action-generator';
import { auditLog } from '@/lib/audit';

export interface ProcessingResult {
  emailId: string;
  classification: any;
  action: any;
  autoExecuted: boolean;
}

export async function processEmail(emailId: string): Promise<ProcessingResult> {
  // Fetch email
  const email = await prisma.incomingEmail.findUnique({
    where: { id: emailId },
  });

  if (!email) throw new Error('Email not found');

  // Idempotency: skip if already processed
  if (email.status === 'processed') {
    return {
      emailId,
      classification: null,
      action: null,
      autoExecuted: false,
    };
  }

  const firmId = email.firmId;

  return runWithFirmContext(firmId, async () => {
    try {
      // Set status to processing
      await prisma.incomingEmail.update({
        where: { id: emailId },
        data: { status: 'processing' },
      });

      const startTime = Date.now();

      // Step 1: Classify
      const classification = await classifyEmail({
        subject: email.subject,
        from: email.fromAddress,
        bodyText: email.bodyText || '',
      });

      // Update email with classification
      await prisma.incomingEmail.update({
        where: { id: emailId },
        data: {
          isInsurance: classification.isInsurance,
          category: classification.category,
          priority: classification.priority,
          classificationConfidence: classification.confidence,
        },
      });

      await auditLog(firmId, 'agent.email_classified', 'incoming_email', emailId, {
        category: classification.category,
        confidence: classification.confidence,
      });

      // Step 2: If not insurance, stop here
      if (!classification.isInsurance) {
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { status: 'not_insurance', processedAt: new Date() },
        });

        return { emailId, classification, action: null, autoExecuted: false };
      }

      // Step 3: Desensitize PII
      const bodyText = (email.bodyText || '') + '\n' + (email.bodyHtml || '');
      const { desensitized, tokens } = desensitizePII(bodyText);

      // Step 4: Extract data
      const extraction = await extractData(desensitized, classification.category, {
        subject: email.subject,
        from: email.fromAddress,
        bodyText: desensitized,
      });

      // Step 5: Resensitize
      const resensitized = resensitize(extraction, tokens);

      // Step 6: Match to existing records
      const matching = await matchRecords(firmId, resensitized);

      // Step 7: Get existing policy data if matched
      let existingPolicy = null;
      if (matching.policy) {
        const rawPolicy = await prisma.policy.findFirst({
          where: { id: matching.policy.id },
        });
        if (rawPolicy) {
          existingPolicy = {
            ...rawPolicy,
            premium: Number(rawPolicy.premium),
          };
        }
      }

      // Step 8: Generate action
      const actionData = generateAction({
        firmId,
        emailSubject: email.subject,
        emailFrom: email.fromAddress,
        classification,
        extraction: resensitized,
        matching,
        existingPolicy,
      });

      // Step 9: Check execution mode
      const config = await prisma.emailIngressConfig.findUnique({
        where: { firmId },
      });

      let status = 'pending';
      let mode = 'suggestion';
      let autoExecuted = false;

      if (
        config?.executionMode === 'auto_execute' &&
        actionData.confidence >= Number(config.confidenceThreshold || 0.95)
      ) {
        status = 'executed';
        mode = 'auto';
        autoExecuted = true;
      }

      // Step 10: Create action record
      const action = await prisma.agentAction.create({
        data: {
          firmId,
          emailId,
          actionType: actionData.type,
          entityType: actionData.target.entityType,
          entityId: actionData.target.entityId,
          matchConfidence: actionData.target.matchConfidence,
          changes: actionData.changes,
          confidence: actionData.confidence,
          reasoning: actionData.reasoning,
          status,
          mode,
          ...(status === 'executed' && { executedAt: new Date() }),
        },
      });

      // Audit event
      const auditAction = autoExecuted ? 'agent.action_auto_executed' : 'agent.action_created';
      await auditLog(firmId, auditAction, 'agent_action', action.id, {
        emailSubject: email.subject,
        actionType: actionData.type,
        confidence: actionData.confidence,
        extractedFields: Object.keys(resensitized),
      });

      // Mark email as processed
      const processingTimeMs = Date.now() - startTime;
      await prisma.incomingEmail.update({
        where: { id: emailId },
        data: { status: 'processed', processedAt: new Date() },
      });

      await auditLog(firmId, 'agent.email_processed', 'incoming_email', emailId, {
        category: classification.category,
        processingTimeMs,
      });

      return {
        emailId,
        classification,
        action: { id: action.id, type: actionData.type, status, mode },
        autoExecuted,
      };
    } catch (error) {
      // Mark email as error
      await prisma.incomingEmail.update({
        where: { id: emailId },
        data: {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  });
}
