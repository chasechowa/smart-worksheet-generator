import React, { useState } from 'react';
import type { ValidationResult } from '../types';

interface ValidationPanelProps {
  result: ValidationResult | null;
  onRetry: () => void;
  onForceUse: () => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({ result, onRetry, onForceUse }) => {
  const [showWarnings, setShowWarnings] = useState(false);
  if (!result) return null;

  const errors = result.issues.filter(i => i.severity === 'error');
  const warnings = result.issues.filter(i => i.severity === 'warning');

  if (result.valid && warnings.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded p-3 text-green-700 text-xs font-bold flex items-center gap-2">
        <span>OK</span> Worksheet validated successfully
      </div>
    );
  }

  return (
    <div className={`rounded border p-3 text-xs ${errors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
      <div className="font-bold mb-2 flex items-center justify-between gap-2">
        <span>
          {errors.length > 0
            ? `Validation failed: ${errors.length} error(s)`
            : `${warnings.length} warning(s) hidden`}
        </span>
        {warnings.length > 0 && (
          <button
            type="button"
            onClick={() => setShowWarnings(v => !v)}
            className="px-2 py-1 rounded bg-white/70 border border-yellow-200 text-yellow-800 hover:bg-white"
          >
            {showWarnings ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mb-2">
          <div className="font-bold text-red-700 mb-1">Errors:</div>
          <ul className="list-disc list-inside space-y-1 text-red-700">
            {errors.map((e, i) => (
              <li key={i}>
                [{e.section}] {e.message}
                {e.suggestion && <span className="block text-red-600 ml-4">{'->'} {e.suggestion}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && showWarnings && (
        <div className="mb-2 max-h-56 overflow-y-auto pr-1">
          <div className="font-bold text-yellow-700 mb-1">Warnings:</div>
          <ul className="list-disc list-inside space-y-1 text-yellow-700">
            {warnings.map((w, i) => (
              <li key={i}>
                [{w.section}] {w.message}
                {w.suggestion && <span className="block text-yellow-600 ml-4">{'->'} {w.suggestion}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex gap-2 mt-3">
          <button onClick={onRetry} className="flex-1 py-2 rounded font-bold bg-blue-600 text-white hover:bg-blue-700 text-xs">
            Regenerate
          </button>
          <button onClick={onForceUse} className="flex-1 py-2 rounded font-bold bg-gray-600 text-white hover:bg-gray-700 text-xs">
            Force Use
          </button>
        </div>
      )}
    </div>
  );
};
