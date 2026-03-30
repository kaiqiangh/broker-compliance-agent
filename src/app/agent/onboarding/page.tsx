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
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const sendTestEmail = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/config/test-email', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      if (data.success) setStep('ready');
    } catch {
      setTestResult({ success: false, error: 'Check failed' });
    } finally {
      setLoading(false);
    }
  };

  const complete = () => {
    localStorage.setItem('agent_onboarding_complete', 'true');
    router.push('/agent');
  };

  // Step indicators
  const steps = ['connect', 'test', 'ready'] as const;
  const stepLabels = ['Connect Email', 'Forward Test', "You're Ready"];

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold mb-2">Set Up Your AI Agent</h1>
      <p className="text-gray-600 mb-8">Forward your insurer emails. We handle the rest.</p>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 ${
              step === s ? 'border-blue-600 bg-blue-600 text-white' :
              steps.indexOf(step) > i ? 'border-green-500 bg-green-500 text-white' :
              'border-gray-300 text-gray-400'
            }`}>
              {steps.indexOf(step) > i ? '✓' : i + 1}
            </div>
            <span className="text-sm hidden sm:inline">{stepLabels[i]}</span>
            {i < 2 && <div className="w-8 h-px bg-gray-300" />}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 'connect' && (
        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Get Your Forwarding Address</h2>
          <p className="text-sm text-gray-600 mb-4">
            Each firm gets a unique email address. Forward insurer emails to this address and our agent will process them automatically.
          </p>

          {forwardingAddress ? (
            <div className="bg-gray-50 rounded p-4 mb-4">
              <p className="text-sm text-gray-500 mb-1">Your agent address:</p>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono text-blue-600 break-all">{forwardingAddress}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(forwardingAddress)}
                  className="shrink-0 text-xs px-2 py-1 border rounded hover:bg-gray-100"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : (
            <button onClick={generateAddress} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Generating...' : 'Generate Forwarding Address'}
            </button>
          )}

          {forwardingAddress && (
            <>
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded text-sm">
                <p className="font-medium text-amber-800 mb-2">Setup Instructions:</p>
                <ol className="list-decimal ml-4 text-amber-700 space-y-1">
                  <li>Open your email (Gmail / Outlook)</li>
                  <li>Create a filter/rule for emails from your insurers</li>
                  <li>Set action: Forward to <code className="bg-amber-100 px-1">{forwardingAddress}</code></li>
                </ol>
              </div>
              <button onClick={() => setStep('test')}
                className="mt-4 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800">
                Continue →
              </button>
            </>
          )}

          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-gray-500 mb-2">Or connect directly:</p>
            <div className="flex gap-3">
              <a href="/api/agent/oauth/gmail/authorize" className="text-sm text-blue-600 hover:underline">Connect Gmail →</a>
              <a href="/api/agent/oauth/outlook/authorize" className="text-sm text-blue-600 hover:underline">Connect Outlook →</a>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step === 'test' && (
        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Forward a Test Email</h2>
          <p className="text-sm text-gray-600 mb-4">
            Forward one of your insurer emails to your agent address. Then check if the agent processed it.
          </p>

          <button onClick={sendTestEmail} disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Checking...' : 'Check for Processed Email'}
          </button>

          {testResult && (
            <div className={`mt-4 p-4 rounded ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border`}>
              {testResult.success ? (
                <div>
                  <p className="font-medium text-green-800">✅ Email processed!</p>
                  <p className="text-sm text-green-700 mt-1">
                    Extracted: {testResult.actionType || 'classified'} — {testResult.subject}
                  </p>
                </div>
              ) : (
                <p className="text-red-700 text-sm">{testResult.error || 'No email found. Forward one first.'}</p>
              )}
            </div>
          )}

          <button onClick={() => setStep('ready')} className="mt-4 text-sm text-gray-500 hover:text-gray-700">
            Skip →
          </button>
        </div>
      )}

      {/* Step 3 */}
      {step === 'ready' && (
        <div className="border rounded-lg p-6 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-lg font-semibold mb-2">Your Agent is Ready!</h2>
          <p className="text-sm text-gray-600 mb-6">
            Forward insurer emails and the agent will extract policy data and suggest updates.
          </p>
          <div className="bg-blue-50 rounded p-4 mb-6 text-left text-sm">
            <p className="font-medium text-blue-800 mb-2">What the agent does:</p>
            <ul className="text-blue-700 space-y-1">
              <li>📧 Reads incoming insurer emails</li>
              <li>🔍 Extracts policy numbers, premiums, dates</li>
              <li>🔗 Matches to existing records</li>
              <li>✏️ Suggests database updates for review</li>
            </ul>
          </div>
          <button onClick={complete} className="px-6 py-2 bg-gray-900 text-white rounded hover:bg-gray-800">
            Go to Dashboard →
          </button>
        </div>
      )}

      <div className="mt-8 text-center">
        <button onClick={complete} className="text-sm text-gray-400 hover:text-gray-600">
          Skip onboarding
        </button>
      </div>
    </div>
  );
}
