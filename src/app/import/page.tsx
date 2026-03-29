'use client';


import { apiFetch } from '@/lib/api-client';
import { useState, useRef, useEffect } from 'react';

interface PreviewResult {
  format: string;
  confidence: number;
  headers: string[];
  rowCount: number;
  errorCount: number;
  needsReviewRows?: number;
  errors: Array<{ row: number; field: string; error: string }>;
  preview: Array<Record<string, unknown>>;
}

interface TargetField {
  label: string;
  required: boolean;
  examples: string[];
}

interface MappingAnalysis {
  headers: string[];
  targetFields: Record<string, TargetField>;
  suggestedMappings: Record<string, string | null>;
  savedMapping: Record<string, string | null> | null;
  autoDetectedFormat: string;
  autoDetectedConfidence: number;
}

export default function ImportPage() {
  const [step, setStep] = useState<'upload' | 'mapping' | 'validation' | 'complete'>('upload');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState<{
    imported: number; skipped: number; errors: number; needsReview: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mapping state
  const [mappingAnalysis, setMappingAnalysis] = useState<MappingAnalysis | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [mappingSaving, setMappingSaving] = useState(false);

  async function handleFile(file: File) {
    setFileName(file.name);
    setLoading(true);
    setError('');

    try {
      // Analyze file for mapping
      const analysisForm = new FormData();
      analysisForm.append('file', file);

      const [previewRes, mappingRes] = await Promise.all([
        fetch('/api/import', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', file); return fd; })() }),
        fetch('/api/import/mapping', { method: 'POST', body: analysisForm }),
      ]);

      const previewData = await previewRes.json();
      const mappingData = await mappingRes.json();

      if (!previewRes.ok) {
        setError(previewData.error?.message || previewData.error || 'Import failed');
        return;
      }

      setPreview(previewData);
      setMappingAnalysis(mappingData);

      // Determine initial mapping: saved > suggested > empty
      const initialMapping: Record<string, string> = {};
      const source = mappingData.savedMapping || mappingData.suggestedMappings || {};
      for (const [key, val] of Object.entries(source)) {
        if (val) initialMapping[key] = val as string;
      }
      setColumnMapping(initialMapping);

      // If format is well-detected, skip manual mapping
      if (mappingData.autoDetectedFormat !== 'unknown' && mappingData.autoDetectedConfidence >= 0.75) {
        setStep('mapping');
      } else {
        setStep('mapping');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveMapping() {
    if (!mappingAnalysis) return;
    setMappingSaving(true);
    try {
      const res = await apiFetch('/api/import/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: columnMapping }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message || 'Failed to save mapping');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setMappingSaving(false);
    }
  }

  async function handleConfirmImport() {
    if (!preview) return;
    setLoading(true);

    try {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setError('File not found. Please re-upload.');
        setStep('upload');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('confirm', 'true');

      const res = await apiFetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || data.error || 'Import failed');
        return;
      }

      setImportResult({
        imported: data.rowCount || 0,
        skipped: data.skippedRows || 0,
        errors: data.errorCount || 0,
        needsReview: data.needsReviewRows || 0,
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

      {/* Step 2: Mapping */}
      {step === 'mapping' && preview && mappingAnalysis && (
        <div className="space-y-6">
          {/* Format Detection Summary */}
          <div className={`rounded-lg p-4 flex items-center gap-3 ${
            mappingAnalysis.autoDetectedFormat !== 'unknown'
              ? 'bg-green-50' : 'bg-amber-50'
          }`}>
            <span className={`text-lg ${mappingAnalysis.autoDetectedFormat !== 'unknown' ? 'text-green-600' : 'text-amber-600'}`}>
              {mappingAnalysis.autoDetectedFormat !== 'unknown' ? '✓' : '⚠'}
            </span>
            <div>
              <p className={`font-medium ${
                mappingAnalysis.autoDetectedFormat !== 'unknown' ? 'text-green-900' : 'text-amber-900'
              }`}>
                {mappingAnalysis.autoDetectedFormat !== 'unknown'
                  ? `Format detected: ${mappingAnalysis.autoDetectedFormat} (${Math.round(mappingAnalysis.autoDetectedConfidence * 100)}% confidence)`
                  : 'Format not recognised — please map columns manually'
                }
              </p>
              <p className={`text-sm ${
                mappingAnalysis.autoDetectedFormat !== 'unknown' ? 'text-green-700' : 'text-amber-700'
              }`}>
                {preview.rowCount} valid rows, {preview.errorCount} errors · File: {fileName}
              </p>
            </div>
          </div>

          {/* Interactive Column Mapping */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-700">Column Mapping</h3>
              <button
                onClick={handleSaveMapping}
                disabled={mappingSaving}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                {mappingSaving ? 'Saving...' : 'Save Mapping'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(mappingAnalysis.targetFields).map(([fieldKey, fieldConfig]) => (
                <div key={fieldKey} className="flex items-center gap-3">
                  <label className="w-36 text-sm text-gray-600 flex-shrink-0">
                    {fieldConfig.label}
                    {fieldConfig.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    value={columnMapping[fieldKey] || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setColumnMapping(prev => {
                        const next = { ...prev };
                        if (val) {
                          next[fieldKey] = val;
                        } else {
                          delete next[fieldKey];
                        }
                        return next;
                      });
                    }}
                    className={`flex-1 text-sm border rounded px-2 py-1.5 ${
                      fieldConfig.required && !columnMapping[fieldKey]
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-300'
                    }`}
                  >
                    <option value="">— not mapped —</option>
                    {mappingAnalysis.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400 mt-3">
              CSV columns detected: {mappingAnalysis.headers.join(', ')}
            </p>
          </div>

          {/* Errors */}
          {preview.errors.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
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

          {/* Preview Table */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Preview (first {Math.min(preview.preview.length, 20)} rows)</h3>
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
          </div>

          {/* Navigation */}
          <div className="flex gap-4">
            <button
              onClick={() => { setStep('upload'); setPreview(null); setMappingAnalysis(null); }}
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
        <div className="bg-white rounded-lg border border-gray-200 p-8">
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
          <p className="text-gray-500 mb-4">{importResult.imported} policies imported from {fileName}</p>
          <div className="flex gap-4 justify-center mb-6">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-lg font-bold text-green-600">{importResult.imported}</p>
              <p className="text-xs text-gray-500">Imported</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-lg font-bold text-gray-600">{importResult.skipped}</p>
              <p className="text-xs text-gray-500">Skipped</p>
            </div>
            {importResult.needsReview > 0 && (
              <div className="text-center p-3 bg-amber-50 rounded-lg">
                <p className="text-lg font-bold text-amber-600">{importResult.needsReview}</p>
                <p className="text-xs text-gray-500">Needs Review</p>
              </div>
            )}
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-lg font-bold text-red-600">{importResult.errors}</p>
              <p className="text-xs text-gray-500">Errors</p>
            </div>
          </div>
          <div className="flex gap-4 justify-center">
            <a href="/dashboard" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Go to Dashboard
            </a>
            <button
              onClick={() => { setStep('upload'); setPreview(null); setImportResult(null); setMappingAnalysis(null); }}
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
