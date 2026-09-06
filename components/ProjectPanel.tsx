import React, { useState, useEffect } from 'react';
import type { Project, ProjectMeta } from '../types';
import { getProjects, deleteProject, exportProject, importProject, getProject } from '../services/storageService';

interface ProjectPanelProps {
  currentProject: Project | null;
  onLoadProject: (project: Project) => void;
  onSaveCurrent: () => Promise<void>;
}

export const ProjectPanel: React.FC<ProjectPanelProps> = ({ currentProject, onLoadProject, onSaveCurrent }) => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const list = await getProjects();
    setProjects(list);
  };

  useEffect(() => { refresh(); }, [currentProject?.id, currentProject?.updatedAt]);

  const articleItems = projects.filter(item => item.kind === 'article');
  const worksheetItems = projects.filter(item => item.kind !== 'article');

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this item?')) return;
    await deleteProject(id);
    await refresh();
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
      await refresh();
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    }
  };

  const handleLoad = async (id: string) => {
    const proj = await getProject(id);
    onLoadProject(proj);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveCurrent();
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const renderItem = (item: ProjectMeta) => (
    <div
      key={item.id}
      className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer ${currentProject?.id === item.id ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-gray-100 hover:bg-gray-50'}`}
    >
      <div onClick={() => handleLoad(item.id)} className="flex-1 min-w-0">
        <div className="font-bold truncate">{item.title}</div>
        <div className="text-gray-400">
          {item.kind === 'article' ? 'Text only' : 'Worksheet'} · {item.difficulty}
        </div>
      </div>
      <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-600 ml-2">
        <i className="fas fa-trash-alt"></i>
      </button>
    </div>
  );

  return (
    <div className="border-t pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase text-gray-400">Saved</label>
        <div className="flex gap-1">
          <button
            onClick={handleSave}
            disabled={saving}
            title="Save current worksheet"
            className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded text-[10px] disabled:opacity-50"
          >
            <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
          </button>
          <button onClick={handleExport} disabled={!currentProject} title="Export selected item" className="w-6 h-6 flex items-center justify-center bg-green-600 text-white rounded text-[10px] disabled:opacity-30">
            <i className="fas fa-download"></i>
          </button>
          <button onClick={() => setShowImport(!showImport)} title="Import item" className="w-6 h-6 flex items-center justify-center bg-gray-600 text-white rounded text-[10px]">
            <i className="fas fa-upload"></i>
          </button>
        </div>
      </div>

      {showImport && (
        <input type="file" accept=".json" onChange={handleImport} className="text-xs w-full" />
      )}

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-gray-400">Articles</label>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {articleItems.length === 0 && (
            <div className="text-xs text-gray-400 italic">No saved articles</div>
          )}
          {articleItems.map(renderItem)}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-gray-400">Projects</label>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {worksheetItems.length === 0 && (
            <div className="text-xs text-gray-400 italic">No saved worksheets</div>
          )}
          {worksheetItems.map(renderItem)}
        </div>
      </div>
    </div>
  );
};
