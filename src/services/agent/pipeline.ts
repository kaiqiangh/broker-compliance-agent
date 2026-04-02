import { prisma, runWithFirmContext } from '@/lib/prisma';
import { classifyEmail } from '@/lib/agent/classifier';
import { extractData } from '@/lib/agent/extractor';
import { desensitizePII, resensitize, type DesensitizeResult, type PIIToken } from '@/lib/agent/pii';
import { matchRecords } from '@/lib/agent/matcher';
import { generateAction } from '@/lib/agent/action-generator';
import { executeAction } from '@/lib/agent/action-executor';
import { auditLog } from '@/lib/audit';
import { publishAgentEvent } from '@/app/api/agent/events/route';
import { sendUrgentNotification, sendAutoExecuteNotification } from '@/services/agent/notifications';

function buildAttachmentText(attachments: { extractedText: string | null; filename: string }[]): string {
  return attachments
    .filter(a => a.extractedText)
    .map(a => `\n--- ${a.filename} ---\n${a.extractedText}`)
    .join('\n');
}

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
    const startTime = Date.now();

    try {
      // Determine start step (resume from where we left off)
      const startStep = email.pipelineStep || 'classify';
      let classification: any;
      let extraction: any;
      let resensitized: any;
      let matching: any;
      type AttachmentContext = { extractedText: string | null; filename: string };

      // Stored data from classify step (desensitize result + attachments), or null for resume
      let attachmentPromise: Promise<
        | { desensitizeResult: DesensitizeResult; attachments: AttachmentContext[] }
        | AttachmentContext[]
      > | null = null;

      // ── Step 1: Classify ──
      if (startStep === 'classify') {
        // Set status to processing
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { status: 'processing', pipelineStep: 'classify', processingStartedAt: new Date() },
        });

        // Parallel: desensitize bodyText + fetch attachments (both independent)
        const [desensitizeResult, attachments] = await Promise.all([
          Promise.resolve(desensitizePII(email.bodyText || '')),
          prisma.emailAttachment.findMany({
            where: { emailId },
            select: { extractedText: true, filename: true },
          }),
        ]);

        // Classify with desensitized body (ADR-013: no raw PII to LLM)
        const classifyResult = await classifyEmail({
          subject: email.subject,
          from: email.fromAddress,
          bodyText: desensitizeResult.desensitized,
        });

        classification = classifyResult;
        // Store desensitize result + attachments for extract step (reuse tokens)
        attachmentPromise = Promise.resolve({ desensitizeResult, attachments });

        // Update email with classification
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: {
            isInsurance: classification.isInsurance,
            category: classification.category,
            priority: classification.priority,
            classificationConfidence: classification.confidence,
            pipelineStep: 'desensitize',
          },
        });

        await auditLog(firmId, 'agent.email_classified', 'incoming_email', emailId, {
          category: classification.category,
          confidence: classification.confidence,
        });

        // If not insurance, stop here
        if (!classification.isInsurance) {
          await prisma.incomingEmail.update({
            where: { id: emailId },
            data: { status: 'not_insurance', processedAt: new Date(), pipelineStep: null },
          });

          return { emailId, classification, action: null, autoExecuted: false };
        }
      }

      // If resuming past classify, re-fetch classification from DB
      if (!classification && startStep !== 'classify') {
        classification = {
          isInsurance: email.isInsurance,
          category: email.category,
          priority: email.priority,
          confidence: Number(email.classificationConfidence || 0.9),
        };
      }

      // ── Step 2-5: Desensitize, Extract, Resensitize ──
      if (startStep === 'classify' || startStep === 'desensitize') {
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { pipelineStep: 'desensitize' },
        });

        // Reuse desensitize result from classify step, or run fresh (resume path)
        let tokens: PIIToken[];
        let desensitized: string;

        const stored = await attachmentPromise;
        if (stored && 'desensitizeResult' in stored) {
          // Classify step already desensitized bodyText — reuse tokens, only desensitize attachments
          const attachmentText = buildAttachmentText(stored.attachments);
          const attResult = desensitizePII(attachmentText);
          tokens = [...stored.desensitizeResult.tokens, ...attResult.tokens];
          desensitized = stored.desensitizeResult.desensitized + attResult.desensitized;
        } else {
          // Resume path: no stored result, desensitize everything fresh
          const bodyText = email.bodyText || '';
          const attachments = stored || await prisma.emailAttachment.findMany({
            where: { emailId },
            select: { extractedText: true, filename: true },
          });
          const attachmentText = buildAttachmentText(attachments);
          const result = desensitizePII(bodyText + attachmentText);
          tokens = result.tokens;
          desensitized = result.desensitized;
        }

        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { pipelineStep: 'extract' },
        });

        // Build thread context (last 3 emails in thread, each truncated to 200 chars, total capped at 1000)
        let threadContext: string | undefined;
        if (email.threadId) {
          const threadEmails = await prisma.incomingEmail.findMany({
            where: { threadId: email.threadId, id: { not: emailId } },
            orderBy: { receivedAt: 'desc' },
            take: 3,
            select: { fromAddress: true, bodyText: true },
          });
          if (threadEmails.length > 0) {
            let total = 0;
            const parts: string[] = [];
            for (const te of threadEmails) {
              const rawSnippet = (te.bodyText || '').slice(0, 200);
              const desensitizedSnippet = desensitizePII(rawSnippet).desensitized;
              const part = `From: ${desensitizePII(te.fromAddress || '').desensitized}\n${desensitizedSnippet}`;
              if (total + part.length > 1000) break;
              parts.push(part);
              total += part.length;
            }
            if (parts.length > 0) {
              threadContext = parts.join('\n---\n');
            }
          }
        }

        // Extract data
        extraction = await extractData(desensitized, classification.category, {
          subject: email.subject,
          from: email.fromAddress,
          bodyText: desensitized,
        }, firmId, threadContext);

        // Resensitize
        resensitized = resensitize(extraction, tokens);

        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { pipelineStep: 'match' },
        });
      }

      // If resuming at 'match' or later without resensitized data, reset to desensitize
      // (tokens from desensitize are lost, can't skip re-running LLM steps)
      if (!resensitized && (startStep === 'match' || startStep === 'action')) {
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { pipelineStep: 'desensitize', status: 'pending_processing' },
        });
        return { emailId, classification, action: null, autoExecuted: false };
      }

      // ── Step 6: Match to existing records ──
      if (startStep === 'classify' || startStep === 'desensitize' || startStep === 'match') {
        matching = await matchRecords(firmId, resensitized, classification.confidence);

        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: { pipelineStep: 'action' },
        });
      }

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

      // Step 8.5: Email threading - merge into existing action if same thread (with transaction)
      if (email.threadId && actionData.type !== 'flag_for_review') {
        const existingThreadAction = await prisma.agentAction.findFirst({
          where: {
            firmId,
            email: { threadId: email.threadId },
            status: 'pending',
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingThreadAction) {
          // TRANSACTION: atomically update both action and email
          await prisma.$transaction([
            prisma.agentAction.update({
              where: { id: existingThreadAction.id },
              data: {
                changes: {
                  ...(existingThreadAction.changes as Record<string, any>),
                  ...(Object.keys(actionData.changes).length > 0 ? actionData.changes : {}),
                },
                reasoning: (existingThreadAction.reasoning || '') + `\n\n[Updated: ${email.subject}]`,
              },
            }),
            prisma.incomingEmail.update({
              where: { id: emailId },
              data: { status: 'processed', processedAt: new Date(), pipelineStep: null },
            }),
          ]);

          return {
            emailId,
            classification,
            action: { id: existingThreadAction.id, type: actionData.type, status: 'pending', mode: 'suggestion' },
            autoExecuted: false,
          };
        }
      }

      // Step 9: Check execution mode (skip no_action and flag_for_review from auto-execute)
      const config = await prisma.emailIngressConfig.findUnique({
        where: { firmId },
      });

      const shouldAutoExecute =
        config?.executionMode === 'auto_execute' &&
        actionData.confidence >= Number(config.confidenceThreshold || 0.95) &&
        actionData.type !== 'no_action' &&
        actionData.type !== 'flag_for_review';

      let status = 'pending';
      const mode = shouldAutoExecute ? 'auto' : 'suggestion';
      let autoExecuted = false;

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
          status: 'pending',
          mode,
        },
      });

      if (shouldAutoExecute) {
        try {
          const executionResult = await executeAction({
            id: action.id,
            actionType: action.actionType,
            entityType: action.entityType,
            entityId: action.entityId,
            firmId,
            changes: action.changes as Record<string, { old: any; new: any }>,
          });

          await prisma.agentAction.update({
            where: { id: action.id },
            data: {
              status: 'executed',
              executedAt: new Date(),
              entityType: executionResult.entityType ?? action.entityType,
              entityId: executionResult.entityId ?? action.entityId,
            },
          });

          status = 'executed';
          autoExecuted = true;
        } catch (error) {
          // BUG-04 FIX: auto-execute failed → set mode to 'suggestion' so user reviews manually
          // Prevents infinite auto-retry loop (e.g., policy not found, LLM hallucination)
          await prisma.agentAction.update({
            where: { id: action.id },
            data: {
              status: 'pending',
              mode: 'suggestion',
            },
          });

          await auditLog(firmId, 'agent.action_auto_execute_failed', 'agent_action', action.id, {
            emailSubject: email.subject,
            actionType: actionData.type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Audit event
      const auditAction = autoExecuted ? 'agent.action_auto_executed' : 'agent.action_created';
      await auditLog(firmId, auditAction, 'agent_action', action.id, {
        emailSubject: email.subject,
        actionType: actionData.type,
        confidence: actionData.confidence,
        extractedFields: Object.keys(resensitized),
      });

      // SSE: notify frontend
      publishAgentEvent(firmId, {
        type: autoExecuted ? 'action_executed' : 'action_created',
        data: {
          id: action.id,
          actionType: actionData.type,
          confidence: actionData.confidence,
          emailSubject: email.subject,
        },
      });

      // Auto-execute notification (fire-and-forget)
      if (autoExecuted) {
        sendAutoExecuteNotification(firmId, action.id).catch((err) =>
          console.error(`[Pipeline] Auto-execute notification failed for action ${action.id}:`, err)
        );
      }

      // Urgent notification (fire-and-forget, don't block pipeline)
      sendUrgentNotification(firmId, action.id).catch((err) =>
        console.error(`[Pipeline] Urgent notification failed for action ${action.id}:`, err)
      );

      // Mark email as processed
      const processingTimeMs = Date.now() - startTime;
      await prisma.incomingEmail.update({
        where: { id: emailId },
        data: { status: 'processed', processedAt: new Date(), pipelineStep: null },
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
      // If we had made progress (pipelineStep is set beyond classify), allow retry from last step
      // Otherwise mark as error
      const emailState = await prisma.incomingEmail.findUnique({
        where: { id: emailId },
        select: { pipelineStep: true },
      });

      if (emailState?.pipelineStep && emailState.pipelineStep !== 'classify') {
        // Had progress — reset to pending so worker retries
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: {
            status: 'pending_processing',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            // Keep pipelineStep so we resume from last successful step
          },
        });
      } else {
        // No progress — permanent error
        await prisma.incomingEmail.update({
          where: { id: emailId },
          data: {
            status: 'error',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            pipelineStep: null,
          },
        });
      }

      throw error;
    }
  });
}
