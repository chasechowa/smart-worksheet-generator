import React from 'react';
import type { Difficulty } from '../types';

interface InputSectionProps {
  article: string;
  onArticleChange: (text: string) => void;
  difficulty: Difficulty;
  onDifficultyChange: (d: Difficulty) => void;
  onGenerate: () => void;
  loading: boolean;
  error: string | null;
}

export const InputSection: React.FC<InputSectionProps> = ({
  article,
  onArticleChange,
  difficulty,
  onDifficultyChange,
  onGenerate,
  loading,
  error,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Article Text</label>
        <textarea
          value={article}
          onChange={e => onArticleChange(e.target.value)}
          className="w-full h-32 border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          placeholder="Paste article content here..."
        />
      </div>

      <div>
        <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Level</label>
        <select
          value={difficulty}
          onChange={e => onDifficultyChange(e.target.value as Difficulty)}
          className="w-full border rounded p-2 text-sm"
        >
          <option value="A2">A2 (Elementary)</option>
          <option value="B1">B1 (Intermediate)</option>
          <option value="B2">B2 (Upper-Intermediate)</option>
          <option value="C1">C1 (Advanced)</option>
        </select>
      </div>

      <button
        onClick={onGenerate}
        disabled={loading || !article.trim()}
        className={`w-full py-3 rounded font-bold text-white shadow transition-all ${loading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
      >
        {loading ? 'Generating...' : 'Generate Worksheet'}
      </button>

      {error && (
        <div className="text-red-600 text-xs bg-red-50 p-2 rounded border border-red-200">
          {error}
        </div>
      )}
    </div>
  );
};
