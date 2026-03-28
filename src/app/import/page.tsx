'use client';

import { useState, useRef } from 'react';

interface PreviewResult {
  format: string;
  confidence: number;
  headers: string[];
  rowCount: number;
  errorCount: number;
  errors: Array<{ row: number; field: string; error: string }>;
  preview: Array<Record<string, unknown>>;
}

export default function ImportPage() {
  const [step, setStep] = useState<'upload' | 'mapping' | 'validation' | 'complete'>('upload');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState<{
    imported: number; skipped: number; errors: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Import failed');
        return;
      }

      setPreview(data);
      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmImport() {
    if (!preview) return;
    setLoading(true);

    try {
      // Re-upload the file to actually import (server already parsed during preview)
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setError('File not found. Please re-upload.');
        setStep('upload');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('confirm', 'true');

      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Import failed');
        return;
      }

      setImportResult({
        imported: data.rowCount || preview.rowCount,
        skipped: 0,
        errors: data.errorCount || preview.errorCount,
      });
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Import Data</h1>
        <p className="text-gray-500 mt-1">Upload your BMS export (CSV) to import policy data</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center mb-8">
        {['Upload', 'Map Fields', 'Validate', 'Complete'].map((label, i) => {
          const stepIdx = ['upload', 'mapping', 'validation', 'complete'].indexOf(step);
          const isActive = i === stepIdx;
          const isDone = i < stepIdx;
          return (
            <div key={label} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`ml-2 text-sm ${isActive ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
                {label}
              </span>
              {i < 3 && <div className={`w-16 h-0.5 mx-4 ${isDone ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors relative cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            {loading ? (
              <div className="text-gray-500">Analyzing file...</div>
            ) : (
              <>
                <div className="text-gray-400 mb-4">
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-700 mb-2">Drop your CSV file here</p>
                <p className="text-sm text-gray-500 mb-4">or click to browse</p>
                <p className="text-xs text-gray-400">Supported: Applied Epic, Acturis, Generic CSV · Max 2MB</p>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        </div>
      )}

      {/* Step 2: Mapping + Validation */}
      {(step === 'mapping' || step === 'validation') && preview && (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div className="mb-6 p-4 bg-green-50 rounded-lg flex items-center gap-3">
            <span className="text-green-600 text-lg">✓</span>
            <div>
              <p className="font-medium text-green-900">
                Format: {preview.format} ({Math.round(preview.confidence * 100)}% confidence)
              </p>
              <p className="text-sm text-green-700">
                {preview.rowCount} valid rows, {preview.errorCount} errors · File: {fileName}
              </p>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Errors ({preview.errorCount})</h3>
              <div className="bg-red-50 rounded-lg p-4 max-h-40 overflow-y-auto">
                {preview.errors.slice(0, 10).map((e, i) => (
                  <div key={i} className="text-sm text-red-700">
                    Row {e.row}: {e.field} — {e.error}
                  </div>
                ))}
                {preview.errors.length > 10 && (
                  <div className="text-sm text-red-500 mt-2">...and {preview.errors.length - 10} more</div>
                )}
              </div>
            </div>
          )}

          <h3 className="text-sm font-medium text-gray-700 mb-3">Preview</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  {preview.headers.slice(0, 8).map(h => (
                    <th key={h} className="text-left py-2 px-3 font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.preview.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {preview.headers.slice(0, 8).map(h => (
                      <td key={h} className="py-2 px-3 truncate max-w-32">{String(row[h] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex gap-4">
            <button
              onClick={() => { setStep('upload'); setPreview(null); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('validation')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Validate →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Validation confirmation */}
      {step === 'validation' && preview && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 mt-6">
          <h2 className="text-lg font-semibold mb-4">Confirm Import</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{preview.rowCount}</p>
              <p className="text-sm text-gray-500">Will import</p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <p className="text-2xl font-bold text-orange-600">{preview.errorCount}</p>
              <p className="text-sm text-gray-500">Will skip (errors)</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-600">{preview.rowCount + preview.errorCount}</p>
              <p className="text-sm text-gray-500">Total rows</p>
            </div>
          </div>
          <button
            onClick={handleConfirmImport}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Importing...' : `Import ${preview.rowCount} policies`}
          </button>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && importResult && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Import Complete</h2>
          <p className="text-gray-500 mb-6">{importResult.imported} policies imported from {fileName}</p>
          <div className="flex gap-4 justify-center">
            <a href="/dashboard" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Go to Dashboard
            </a>
            <button
              onClick={() => { setStep('upload'); setPreview(null); setImportResult(null); }}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
