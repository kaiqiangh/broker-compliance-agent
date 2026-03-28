'use client';

import { useState } from 'react';

export default function ImportPage() {
  const [step, setStep] = useState<'upload' | 'mapping' | 'validation' | 'complete'>('upload');
  const [fileName, setFileName] = useState('');
  const [detectedFormat, setDetectedFormat] = useState('');
  const [confidence, setConfidence] = useState(0);

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

      {/* Step Content */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors">
            <div className="text-gray-400 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-700 mb-2">Drop your CSV file here</p>
            <p className="text-sm text-gray-500 mb-4">or click to browse</p>
            <p className="text-xs text-gray-400">Supported: Applied Epic, Acturis, Generic CSV · Max 10MB</p>
            <input
              type="file"
              accept=".csv,.tsv"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setFileName(file.name);
                  // Simulate format detection
                  setDetectedFormat('Applied Epic TAM');
                  setConfidence(95);
                  setStep('mapping');
                }
              }}
            />
          </div>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="text-sm font-medium text-blue-900 mb-2">Supported BMS formats</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• <strong>Applied Epic (TAM)</strong> — PolicyRef, ClientName, InceptionDate headers</li>
              <li>• <strong>Acturis</strong> — PolicyNo, InsuredName, EffectiveDate headers</li>
              <li>• <strong>Generic CSV</strong> — Interactive field mapping for custom formats</li>
            </ul>
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div className="mb-6 p-4 bg-green-50 rounded-lg flex items-center gap-3">
            <span className="text-green-600 text-lg">✓</span>
            <div>
              <p className="font-medium text-green-900">Format detected: {detectedFormat} ({confidence}% confidence)</p>
              <p className="text-sm text-green-700">File: {fileName}</p>
            </div>
          </div>

          <h2 className="text-lg font-semibold mb-4">Field Mapping</h2>
          <p className="text-sm text-gray-500 mb-6">
            We auto-detected your format. Review the mapping below and adjust if needed.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {[
              { csv: 'PolicyRef', platform: 'Policy Number *' },
              { csv: 'ClientName', platform: 'Client Name *' },
              { csv: 'ClientAddress', platform: 'Client Address' },
              { csv: 'PolicyType', platform: 'Policy Type *' },
              { csv: 'InsurerName', platform: 'Insurer Name *' },
              { csv: 'InceptionDate', platform: 'Inception Date *' },
              { csv: 'ExpiryDate', platform: 'Expiry Date *' },
              { csv: 'Premium', platform: 'Premium *' },
            ].map(({ csv, platform }) => (
              <div key={csv} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">{csv}</p>
                  <p className="text-xs text-gray-400">CSV column</p>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-700">{platform}</p>
                  <p className="text-xs text-gray-400">Platform field</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-4">
            <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
            <button onClick={() => setStep('validation')} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Validate Data →
            </button>
          </div>
        </div>
      )}

      {step === 'validation' && (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <h2 className="text-lg font-semibold mb-4">Validation Results</h2>
          <div className="mb-6 flex gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">5</p>
              <p className="text-sm text-gray-500">Valid rows</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-orange-600">0</p>
              <p className="text-sm text-gray-500">Warnings</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-red-600">0</p>
              <p className="text-sm text-gray-500">Errors</p>
            </div>
          </div>

          <h3 className="text-sm font-medium text-gray-700 mb-3">Preview (first 5 rows)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Client</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Policy #</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Type</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Insurer</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Expiry</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Premium</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  { client: 'Seán Ó Briain', policy: 'POL-2024-001', type: 'Motor', insurer: 'Aviva', expiry: '14/03/2025', premium: '€1,245.00' },
                  { client: 'Áine Murphy', policy: 'POL-2024-002', type: 'Home', insurer: 'Zurich', expiry: '31/05/2025', premium: '€890.00' },
                  { client: 'Patrick Kelly', policy: 'POL-2024-003', type: 'Motor', insurer: 'Allianz', expiry: '21/09/2025', premium: '€1,580.00' },
                  { client: 'Máire Ní Chonaill', policy: 'POL-2024-004', type: 'Commercial', insurer: 'FBD', expiry: '31/12/2024', premium: '€4,200.00' },
                  { client: 'Cormac Brennan', policy: 'POL-2024-005', type: 'Motor', insurer: 'Liberty', expiry: '09/07/2025', premium: '€980.00' },
                ].map((row, i) => (
                  <tr key={i}>
                    <td className="py-2 px-3">{row.client}</td>
                    <td className="py-2 px-3 font-mono text-xs">{row.policy}</td>
                    <td className="py-2 px-3">{row.type}</td>
                    <td className="py-2 px-3">{row.insurer}</td>
                    <td className="py-2 px-3">{row.expiry}</td>
                    <td className="py-2 px-3">{row.premium}</td>
                    <td className="py-2 px-3"><span className="text-green-600">✓ Valid</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex gap-4">
            <button onClick={() => setStep('mapping')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </button>
            <button onClick={() => setStep('complete')} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Import 5 policies →
            </button>
          </div>
        </div>
      )}

      {step === 'complete' && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Import Complete</h2>
          <p className="text-gray-500 mb-6">5 policies imported successfully from {fileName}</p>

          <div className="grid grid-cols-3 gap-4 max-w-md mx-auto mb-8">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">5</p>
              <p className="text-xs text-gray-500">Imported</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-400">0</p>
              <p className="text-xs text-gray-500">Skipped</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-400">0</p>
              <p className="text-xs text-gray-500">Errors</p>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <a href="/dashboard" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Go to Dashboard
            </a>
            <button onClick={() => setStep('upload')} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
