import React, { useState, useEffect } from 'react';
import type { Project, ProjectMeta } from '../types';
import { getProjects, deleteProject, exportProject, importProject, getProject } from '../services/storageService';

interface ProjectPanelProps {
  currentProject: Project | null;
  onLoadProject: (project: Project) => void;
  onSaveCurrent: () => void;
}

export const ProjectPanel: React.FC<ProjectPanelProps> = ({ currentProject, onLoadProject, onSaveCurrent }) => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [showImport, setShowImport] = useState(false);

  const refresh = async () => {
    const list = await getProjects();
    setProjects(list);
  };

  useEffect(() => { refresh(); }, [currentProject?.id, currentProject?.updatedAt]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    await deleteProject(id);
    refresh();
  };

  const handleExport = () => {
    if (!currentProject) return;
    const blob = new Blob([exportProject(currentProject)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    a.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = importProject(text);
      onLoadProject(project);
      setShowImport(false);
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    }
  };

  const handleLoad = async (id: string) => {
    const proj = await getProject(id);
    onLoadProject(proj);
  };

  return (
    <div className="border-t pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase text-gray-400">Projects</label>
        <div className="flex gap-1">
          {currentProject && (
            <button onClick={onSaveCurrent} title="Save" className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded text-[10px]">
              <i className="fas fa-save"></i>
            </button>
          )}
          <button onClick={handleExport} disabled={!currentProject} title="Export" className="w-6 h-6 flex items-center justify-center bg-green-600 text-white rounded text-[10px] disabled:opacity-30">
            <i className="fas fa-download"></i>
          </button>
          <button onClick={() => setShowImport(!showImport)} title="Import" className="w-6 h-6 flex items-center justify-center bg-gray-600 text-white rounded text-[10px]">
            <i className="fas fa-upload"></i>
          </button>
        </div>
      </div>

      {showImport && (
        <input type="file" accept=".json" onChange={handleImport} className="text-xs w-full" />
      )}

      <div className="space-y-1 max-h-40 overflow-y-auto">
        {projects.length === 0 && (
          <div className="text-xs text-gray-400 italic">No saved projects</div>
        )}
        {projects.map(p => (
          <div
            key={p.id}
            className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer ${currentProject?.id === p.id ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-gray-100 hover:bg-gray-50'}`}
          >
            <div onClick={() => handleLoad(p.id)} className="flex-1 min-w-0">
              <div className="font-bold truncate">{p.title}</div>
              <div className="text-gray-400">{p.difficulty} · {p.worksheetCount} worksheet(s)</div>
            </div>
            <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600 ml-2">
              <i className="fas fa-trash-alt"></i>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
