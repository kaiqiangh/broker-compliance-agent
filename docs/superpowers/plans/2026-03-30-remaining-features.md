# Remaining Features Implementation Plan — AI Agent v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all remaining PRD features: OCR via markitdown, onboarding wizard, test email verification, notifications preferences, accuracy trend chart, email threading UI, insurer domain management, and connection health display.

**Architecture:** Use `markitdown` (Python CLI) as a subprocess for document/attachment text extraction. Frontend features in the existing Next.js app. All tasks are independent.

**Tech Stack:** Next.js 16, React, TypeScript, markitdown (Python CLI via child_process), Tailwind CSS

---

## File Map

### OCR / Attachment Extraction
- Modify: `src/lib/email/attachment-extractor.ts` (recreate — was deleted)
- Create: `src/lib/email/markitdown.ts` — markitdown CLI wrapper
- Test: `src/__tests__/unit/attachment-extractor.test.ts`

### Onboarding Wizard
- Create: `src/app/agent/onboarding/page.tsx` — 3-step wizard
- Modify: `src/app/agent/page.tsx` — redirect to onboarding if first visit
- Modify: `src/app/agent/layout.tsx` — navigation

### Test Email
- Modify: `src/app/api/agent/config/forwarding-address/route.ts` — add send test endpoint
- Create: `src/app/api/agent/config/test-email/route.ts` — send test email + verify receipt

### Notifications Preferences
- Modify: `src/app/api/agent/config/route.ts` — add notification fields
- Modify: `src/app/agent/config/page.tsx` — notifications tab
- Modify: `prisma/schema.prisma` — add notification fields to EmailIngressConfig

### Accuracy Trend Chart
- Modify: `src/app/agent/metrics/page.tsx` — add trend chart
- Modify: `src/app/api/agent/metrics/route.ts` — return historical data

### Email Threading UI
- Modify: `src/app/agent/page.tsx` — thread history in action cards
- Modify: `src/app/api/agent/actions/[id]/route.ts` — include thread emails

### Insurer Domain Management
- Modify: `src/app/agent/config/page.tsx` — domain list management
- Modify: `src/app/api/agent/config/insurer-domains/route.ts` — add/remove domains

### Connection Health
- Modify: `src/app/agent/config/page.tsx` — health indicator
- Modify: `src/app/api/agent/config/route.ts` — return health data

---

## Task 1: OCR via markitdown (Attachment Text Extraction)

### 1.1 Install markitdown

```bash
pip install 'markitdown[all]'
# Verify
markitdown --help
```

For the project, document in README that markitdown must be available in PATH.

### 1.2 Create markitdown wrapper

Create `src/lib/email/markitdown.ts`:

```typescript
import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * Convert a file buffer to text using markitdown CLI.
 * Supports: PDF, DOCX, XLSX, PPTX, Images (OCR), HTML, CSV, JSON, XML, ZIP.
 */
export async function convertToText(
  buffer: Buffer,
  contentType: string
): Promise<string> {
  // Determine file extension from content type
  const ext = getExtension(contentType);
  if (!ext) return '';

  // Write to temp file (markitdown CLI needs a file path)
  const tmpPath = join(tmpdir(), `markitdown-${randomUUID()}.${ext}`);
  
  try {
    await writeFile(tmpPath, buffer);
    
    const result = await new Promise<string>((resolve, reject) => {
      execFile(
        'markitdown',
        [tmpPath],
        { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }, // 30s timeout, 5MB max
        (error, stdout, stderr) => {
          if (error) {
            // markitdown returns non-zero for unsupported formats
            if (stderr?.includes('not supported') || stderr?.includes('No converter')) {
              resolve(''); // Graceful — return empty
            } else {
              reject(new Error(`markitdown failed: ${stderr || error.message}`));
            }
          } else {
            resolve(stdout);
          }
        }
      );
    });
    
    return result.trim();
  } catch (err) {
    console.error(`[markitdown] Conversion failed for ${contentType}:`, err);
    return ''; // Graceful degradation
  } finally {
    // Cleanup temp file
    await unlink(tmpPath).catch(() => {});
  }
}

function getExtension(contentType: string): string | null {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt',
    'text/html': 'html',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/tiff': 'tiff',
  };
  return map[contentType] || null;
}

/**
 * Check if markitdown is available.
 */
export async function isMarkitdownAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('markitdown', ['--version'], { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}
```

### 1.3 Recreate attachment extractor

Create `src/lib/email/attachment-extractor.ts`:

```typescript
import { convertToText } from './markitdown';

export interface ExtractedAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  extractedText: string;
}

/**
 * Extract text from an email attachment.
 * Uses markitdown for PDF, DOCX, XLSX, PPTX, images (OCR), HTML, etc.
 * Falls back to empty string for unsupported formats.
 */
export async function extractAttachmentText(
  filename: string,
  contentType: string,
  buffer: Buffer
): Promise<string> {
  // Skip very small files (likely icons, signatures)
  if (buffer.length < 100) return '';
  
  // Skip very large files (>10MB)
  if (buffer.length > 10 * 1024 * 1024) {
    console.warn(`[attachment-extractor] Skipping large file: ${filename} (${buffer.length} bytes)`);
    return '';
  }

  try {
    const text = await convertToText(buffer, contentType);
    
    if (text && text.length > 0) {
      console.log(`[attachment-extractor] Extracted ${text.length} chars from ${filename}`);
    }
    
    return text;
  } catch (err) {
    console.error(`[attachment-extractor] Failed to extract ${filename}:`, err);
    return '';
  }
}
```

### 1.4 Integrate into ingest pipeline

In `src/app/api/agent/ingest/route.ts`, after parsing the email:

```typescript
import { extractAttachmentText } from '@/lib/email/attachment-extractor';

// After parsing email, before storing:
const attachments = parsed.attachments || [];
for (const att of attachments) {
  const extractedText = await extractAttachmentText(
    att.filename || 'unknown',
    att.contentType || 'application/octet-stream',
    att.content
  );
  
  // Store attachment record
  await prisma.emailAttachment.create({
    data: {
      emailId: email.id,
      firmId,
      filename: att.filename || 'unknown',
      contentType: att.contentType,
      sizeBytes: att.size,
      extractedText: extractedText || null,
    },
  });
}
```

### 1.5 Tests

```typescript
// src/__tests__/unit/attachment-extractor.test.ts
describe('Attachment extraction', () => {
  it('returns empty for unsupported formats', async () => {
    const text = await extractAttachmentText('file.bin', 'application/octet-stream', Buffer.from('test'));
    expect(text).toBe('');
  });

  it('returns empty for very small files', async () => {
    const text = await extractAttachmentText('file.pdf', 'application/pdf', Buffer.from('x'));
    expect(text).toBe('');
  });

  it('returns empty for very large files', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024);
    const text = await extractAttachmentText('big.pdf', 'application/pdf', big);
    expect(text).toBe('');
  });
});
```

### 1.6 Commit

```bash
git add src/lib/email/markitdown.ts src/lib/email/attachment-extractor.ts src/app/api/agent/ingest/route.ts src/__tests__/unit/attachment-extractor.test.ts
git commit -m "feat: attachment text extraction via markitdown (PDF, DOCX, images OCR, HTML, etc.)"
```

---

## Task 2: Onboarding Wizard

### 2.1 Create onboarding page

Create `src/app/agent/onboarding/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'connect' | 'test' | 'ready';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('connect');
  const [forwardingAddress, setForwardingAddress] = useState<string>('');
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Step 1: Get forwarding address
  const generateAddress = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setForwardingAddress(data.data?.forwardingAddress || '');
    } catch (err) {
      console.error('Failed to generate address:', err);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Send test email
  const sendTestEmail = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/config/test-email', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        setStep('ready');
      }
    } catch (err) {
      setTestResult({ success: false, error: 'Failed to send test' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold mb-2">Set Up Your AI Agent</h1>
      <p className="text-gray-600 mb-8">Forward your insurer emails. We handle the rest.</p>

      {/* Step indicators */}
      <div className="flex items-center gap-4 mb-8">
        {['connect', 'test', 'ready'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === s ? 'bg-blue-600 text-white' :
              ['connect', 'test', 'ready'].indexOf(step) > i ? 'bg-green-500 text-white' :
              'bg-gray-200 text-gray-600'
            }`}>
              {['connect', 'test', 'ready'].indexOf(step) > i ? '✓' : i + 1}
            </div>
            <span className="text-sm">{s === 'connect' ? 'Connect Email' : s === 'test' ? 'Forward Test' : "You're Ready"}</span>
            {i < 2 && <div className="w-12 h-0.5 bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Connect */}
      {step === 'connect' && (
        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Step 1: Get Your Forwarding Address</h2>
          <p className="text-sm text-gray-600 mb-4">
            Each firm gets a unique email address. Forward insurer emails to this address and our agent will process them automatically.
          </p>

          {forwardingAddress ? (
            <div className="bg-gray-50 rounded p-4 mb-4">
              <p className="text-sm text-gray-500 mb-1">Your agent address:</p>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono text-blue-600">{forwardingAddress}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(forwardingAddress)}
                  className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={generateAddress}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Forwarding Address'}
            </button>
          )}

          {forwardingAddress && (
            <>
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded text-sm">
                <p className="font-medium text-amber-800 mb-2">Setup Instructions:</p>
                <ol className="list-decimal ml-4 text-amber-700 space-y-1">
                  <li>Open your email (Gmail / Outlook)</li>
                  <li>Create a new filter/rule for emails from your insurers</li>
                  <li>Set action: "Forward to" your agent address above</li>
                  <li>Or manually forward individual emails</li>
                </ol>
              </div>
              <button
                onClick={() => setStep('test')}
                className="mt-4 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800"
              >
                Continue →
              </button>
            </>
          )}

          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-gray-500 mb-2">Or connect directly:</p>
            <div className="flex gap-2">
              <a href="/api/agent/oauth/gmail/authorize" className="text-sm text-blue-600 hover:underline">
                Connect Gmail →
              </a>
              <span className="text-gray-300">|</span>
              <a href="/api/agent/oauth/outlook/authorize" className="text-sm text-blue-600 hover:underline">
                Connect Outlook →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Test */}
      {step === 'test' && (
        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Step 2: Forward a Test Email</h2>
          <p className="text-sm text-gray-600 mb-4">
            Forward one of your insurer emails (renewal notice, policy confirmation) to your agent address.
            Then click the button below to check if it was processed.
          </p>

          <button
            onClick={sendTestEmail}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Check for Processed Email'}
          </button>

          {testResult && (
            <div className={`mt-4 p-4 rounded ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {testResult.success ? (
                <div>
                  <p className="font-medium text-green-800">✅ Email processed successfully!</p>
                  <p className="text-sm text-green-700 mt-1">
                    Extracted: {testResult.actionType} for {testResult.policyNumber || 'N/A'}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-medium text-red-800">No email processed yet.</p>
                  <p className="text-sm text-red-700 mt-1">
                    {testResult.error || 'Forward an insurer email to your agent address first, then try again.'}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setStep('ready')}
            className="mt-4 text-sm text-gray-500 hover:text-gray-700"
          >
            Skip this step →
          </button>
        </div>
      )}

      {/* Step 3: Ready */}
      {step === 'ready' && (
        <div className="border rounded-lg p-6 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-lg font-semibold mb-2">Your Agent is Ready!</h2>
          <p className="text-sm text-gray-600 mb-6">
            Forward insurer emails to <code className="bg-gray-100 px-1 rounded">{forwardingAddress}</code> and
            the agent will extract policy data and suggest updates automatically.
          </p>

          <div className="bg-blue-50 rounded p-4 mb-6 text-left">
            <p className="font-medium text-blue-800 mb-2">What the agent does:</p>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>📧 Reads incoming insurer emails</li>
              <li>🔍 Extracts policy numbers, premiums, dates</li>
              <li>🔗 Matches to existing records</li>
              <li>✏️ Suggests database updates for your review</li>
              <li>📊 Tracks accuracy and time saved</li>
            </ul>
          </div>

          <button
            onClick={() => {
              // Mark onboarding as complete
              localStorage.setItem('agent_onboarding_complete', 'true');
              router.push('/agent');
            }}
            className="px-6 py-2 bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            Go to Dashboard →
          </button>
        </div>
      )}

      {/* Skip onboarding */}
      <div className="mt-8 text-center">
        <button
          onClick={() => {
            localStorage.setItem('agent_onboarding_complete', 'true');
            router.push('/agent');
          }}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Skip onboarding — I know what I'm doing
        </button>
      </div>
    </div>
  );
}
```

### 2.2 Add redirect logic to agent page

In `src/app/agent/page.tsx`, at the top of the component:

```tsx
useEffect(() => {
  // Redirect to onboarding if first visit and no config exists
  const checkOnboarding = async () => {
    const skipOnboarding = localStorage.getItem('agent_onboarding_complete');
    if (skipOnboarding) return;

    try {
      const res = await fetch('/api/agent/config');
      const data = await res.json();
      if (!data.data) {
        // No config exists — redirect to onboarding
        router.push('/agent/onboarding');
      }
    } catch {}
  };
  checkOnboarding();
}, []);
```

### 2.3 Commit

```bash
git add src/app/agent/onboarding/page.tsx src/app/agent/page.tsx
git commit -m "feat: 3-step onboarding wizard (connect email → test → ready)"
```

---

## Task 3: Test Email Verification

### 3.1 Create test email endpoint

Create `src/app/api/agent/config/test-email/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const POST = withAuth('agent:configure', async (user, _request) => {
  // Check if any email was received in the last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  
  const recentEmail = await prisma.incomingEmail.findFirst({
    where: {
      firmId: user.firmId,
      createdAt: { gte: tenMinutesAgo },
      status: { in: ['processed', 'pending_processing', 'processing'] },
    },
    include: {
      actions: {
        select: { actionType: true, entityId: true, confidence: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!recentEmail) {
    return NextResponse.json({
      success: false,
      error: 'No email received in the last 10 minutes. Forward an insurer email to your agent address first.',
    });
  }

  const action = recentEmail.actions[0];
  
  return NextResponse.json({
    success: true,
    emailId: recentEmail.id,
    subject: recentEmail.subject,
    category: recentEmail.category,
    isInsurance: recentEmail.isInsurance,
    actionType: action?.actionType,
    confidence: action?.confidence ? Number(action.confidence) : null,
  });
});
```

### 2.2 Commit

```bash
git add src/app/api/agent/config/test-email/route.ts
git commit -m "feat: test email verification endpoint for onboarding"
```

---

## Task 4: Notifications Preferences

### 4.1 Add fields to schema

Add to `EmailIngressConfig` in `prisma/schema.prisma`:

```prisma
model EmailIngressConfig {
  // ... existing ...
  notifyOnAction       String    @default("pending") @map("notify_on_action") @db.VarChar(20) // all, pending, errors
  notifyChannel        String    @default("dashboard") @map("notify_channel") @db.VarChar(20) // email, dashboard, both
  notifyDigestMode     String    @default("realtime") @map("notify_digest_mode") @db.VarChar(20) // realtime, daily
}
```

### 4.2 Update config API

Add the new fields to the GET response and PUT validation in `src/app/api/agent/config/route.ts`.

### 4.3 Add Notifications tab to config page

In `src/app/agent/config/page.tsx`, add a third tab:

```tsx
{/* Notifications Tab */}
<div className="border rounded-lg p-4">
  <h3 className="text-lg font-semibold mb-4">Notifications</h3>
  
  <div className="space-y-4">
    <div>
      <label className="text-sm font-medium">When to notify</label>
      <select value={config.notifyOnAction} onChange={...} className="mt-1 block w-full border rounded p-2">
        <option value="all">All actions</option>
        <option value="pending">Only pending (need review)</option>
        <option value="errors">Only errors</option>
      </select>
    </div>
    
    <div>
      <label className="text-sm font-medium">Notification channel</label>
      <select value={config.notifyChannel} onChange={...} className="mt-1 block w-full border rounded p-2">
        <option value="dashboard">Dashboard only</option>
        <option value="email">Email</option>
        <option value="both">Both</option>
      </select>
    </div>
    
    <div>
      <label className="text-sm font-medium">Email digest</label>
      <select value={config.notifyDigestMode} onChange={...} className="mt-1 block w-full border rounded p-2">
        <option value="realtime">Real-time</option>
        <option value="daily">Daily summary</option>
      </select>
    </div>
  </div>
</div>
```

### 4.4 Migration + commit

```bash
npx prisma migrate dev --name add-notification-preferences
git add prisma/ src/app/api/agent/config/route.ts src/app/agent/config/page.tsx
git commit -m "feat: notification preferences (channel, frequency, digest mode)"
```

---

## Task 5: Accuracy Trend Chart

### 5.1 Update metrics API

In `src/app/api/agent/metrics/route.ts`, ensure the daily data includes a `date` + `accuracy` per day:

```typescript
// The daily array should return:
// [{ date: '2026-03-30', accuracy: 85, strictAccuracy: 72, emailsProcessed: 12, actionsCreated: 8 }, ...]
```

### 5.2 Add chart to metrics page

In `src/app/agent/metrics/page.tsx`, add a simple SVG line chart:

```tsx
// Simple trend chart using pure SVG (no chart library needed)
<div className="border rounded-lg p-4">
  <h3 className="text-sm font-medium mb-4">Accuracy Trend (30 days)</h3>
  <svg viewBox="0 0 300 100" className="w-full h-32">
    {/* Grid lines */}
    {[0, 25, 50, 75, 100].map(y => (
      <line key={y} x1="30" y1={100 - y} x2="290" y2={100 - y} stroke="#e5e7eb" strokeWidth="0.5" />
    ))}
    {/* Accuracy line */}
    <polyline
      fill="none"
      stroke="#3b82f6"
      strokeWidth="2"
      points={daily.map((d, i) => `${30 + (i * 260 / daily.length)},${100 - d.accuracy}`).join(' ')}
    />
    {/* Strict accuracy line */}
    <polyline
      fill="none"
      stroke="#10b981"
      strokeWidth="2"
      strokeDasharray="4"
      points={daily.map((d, i) => `${30 + (i * 260 / daily.length)},${100 - d.strictAccuracy}`).join(' ')}
    />
  </svg>
  <div className="flex gap-4 mt-2 text-xs text-gray-500">
    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500" /> Useful rate</span>
    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 border-dashed" /> Perfect rate</span>
  </div>
</div>
```

### 5.3 Commit

```bash
git add src/app/agent/metrics/page.tsx src/app/api/agent/metrics/route.ts
git commit -m "feat: accuracy trend chart on metrics dashboard"
```

---

## Task 6: Email Threading UI

### 6.1 Update actions API to include thread emails

In `src/app/api/agent/actions/[id]/route.ts`, include thread history:

```typescript
const action = await prisma.agentAction.findUnique({
  where: { id: actionId, firmId: user.firmId },
  include: {
    email: true,
  },
});

// Fetch thread history
let threadEmails: any[] = [];
if (action?.email?.threadId) {
  threadEmails = await prisma.incomingEmail.findMany({
    where: {
      firmId: user.firmId,
      threadId: action.email.threadId,
    },
    select: {
      id: true,
      subject: true,
      fromAddress: true,
      receivedAt: true,
      status: true,
    },
    orderBy: { receivedAt: 'asc' },
  });
}
```

### 6.2 Add thread view to action detail

In the action card or a detail modal:

```tsx
{threadEmails.length > 1 && (
  <div className="mt-3 border-t pt-3">
    <p className="text-xs font-medium text-gray-500 mb-2">Thread ({threadEmails.length} emails)</p>
    <div className="space-y-1">
      {threadEmails.map((email, i) => (
        <div key={email.id} className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">{i + 1}.</span>
          <span className="truncate">{email.subject}</span>
          <span className="text-gray-400">from {email.fromAddress}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

### 6.3 Commit

```bash
git add src/app/api/agent/actions/[id]/route.ts src/app/agent/page.tsx
git commit -m "feat: email thread history display in action detail"
```

---

## Task 7: Insurer Domain Management

### 7.1 Verify existing API

The route at `src/app/api/agent/config/insurer-domains/route.ts` should already exist. Read it to check if GET/POST/DELETE work.

### 7.2 Add UI to config page

Add a domain management section:

```tsx
<div className="border rounded-lg p-4">
  <h3 className="text-lg font-semibold mb-2">Insurer Domains</h3>
  <p className="text-sm text-gray-600 mb-4">
    Emails from these domains are classified as insurance-related with high confidence.
  </p>
  
  <div className="flex flex-wrap gap-2 mb-4">
    {domains.map(domain => (
      <span key={domain} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm">
        {domain}
        <button onClick={() => removeDomain(domain)} className="text-gray-400 hover:text-red-500">×</button>
      </span>
    ))}
  </div>
  
  <div className="flex gap-2">
    <input
      type="text"
      value={newDomain}
      onChange={(e) => setNewDomain(e.target.value)}
      placeholder="e.g., newinsurer.ie"
      className="flex-1 border rounded px-3 py-2 text-sm"
    />
    <button onClick={addDomain} className="px-4 py-2 bg-gray-900 text-white rounded text-sm">
      Add
    </button>
  </div>
</div>
```

### 7.3 Commit

```bash
git add src/app/agent/config/page.tsx
git commit -m "feat: insurer domain management UI (add/remove custom domains)"
```

---

## Task 8: Connection Health Display

### 8.1 Update config API

In `src/app/api/agent/config/route.ts`, include health data:

```typescript
return NextResponse.json({
  data: {
    // ... existing fields ...
    // Health indicators
    health: {
      status: config.status,
      lastPolledAt: config.lastPolledAt,
      lastError: config.lastError,
      errorCount: config.errorCount,
      // Derived
      isHealthy: config.status === 'active' && config.errorCount < 5,
      timeSinceLastPoll: config.lastPolledAt
        ? Date.now() - config.lastPolledAt.getTime()
        : null,
    },
  },
});
```

### 8.2 Add health indicator to config page

```tsx
<div className="flex items-center gap-2">
  <span className={`w-3 h-3 rounded-full ${
    config.health?.isHealthy ? 'bg-green-500' :
    config.health?.status === 'error' ? 'bg-red-500' :
    'bg-yellow-500'
  }`} />
  <span className="text-sm font-medium">
    {config.health?.isHealthy ? 'Connected' :
     config.health?.status === 'error' ? 'Error' :
     'Warning'}
  </span>
  {config.health?.lastError && (
    <span className="text-xs text-red-600">{config.health.lastError}</span>
  )}
  {config.health?.timeSinceLastPoll && (
    <span className="text-xs text-gray-400">
      Last poll: {Math.round(config.health.timeSinceLastPoll / 60000)}m ago
    </span>
  )}
</div>
```

### 8.3 Commit

```bash
git add src/app/api/agent/config/route.ts src/app/agent/config/page.tsx
git commit -m "feat: connection health indicator (status, last poll, error details)"
```

---

## Summary

| Task | Feature | Workload | Files |
|------|---------|----------|-------|
| 1 | OCR via markitdown | Medium | 3 files |
| 2 | Onboarding wizard | Medium | 2 files |
| 3 | Test email verification | Small | 1 file |
| 4 | Notifications preferences | Medium | 3 files + migration |
| 5 | Accuracy trend chart | Small | 2 files |
| 6 | Email threading UI | Small | 2 files |
| 7 | Insurer domain management | Small | 1 file |
| 8 | Connection health display | Small | 2 files |

**Total:** 8 tasks, ~1-2 days estimated. All independent, can be parallelized.

## Prerequisites

- `pip install 'markitdown[all]'` for Task 1 (OCR)
- PostgreSQL running for Tasks 4 (schema migration)

## Execution Options

**1. Subagent-Driven (recommended)** — Dispatch subagent per task.

**2. Inline Execution** — Execute all in this session.

Which approach?
