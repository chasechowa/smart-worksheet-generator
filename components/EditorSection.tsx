
import React from 'react';

interface EditorSectionProps {
  title: string;
  onDelete?: () => void;
  children: React.ReactNode;
}

export const EditorSection: React.FC<EditorSectionProps> = ({ title, onDelete, children }) => {
  return (
    <div className="bg-white border rounded-lg shadow-sm mb-6 overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
        <h3 className="font-bold text-gray-700 uppercase tracking-wider text-sm">{title}</h3>
        {onDelete && (
          <button 
            onClick={onDelete}
            className="text-red-500 hover:text-red-700 transition-colors"
            title="Delete Section"
          >
            <i className="fas fa-trash-alt"></i>
          </button>
        )}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
};
