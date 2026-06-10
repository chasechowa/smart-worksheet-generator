import type { Project, ProjectMeta } from '../types';

const STORAGE_KEY = 'worksheet_projects';

// ---------------------------------------------------------------------------
// localStorage fallback (web browser — no Electron)
// ---------------------------------------------------------------------------

function isElectron(): boolean {
  return !!(window as any).electronAPI;
}

function loadFromLocalStorage(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Project>;
  } catch {
    return {};
  }
}

function saveToLocalStorage(projects: Record<string, Project>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch { /* quota exceeded — silently fail */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<ProjectMeta[]> {
  if (isElectron()) {
    return (window as any).electronAPI.fsList();
  }
  // Browser: read from localStorage
  const all = loadFromLocalStorage();
  return Object.values(all)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(p => ({
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      worksheetCount: p.worksheets.length,
    }));
}

export async function getProject(id: string): Promise<Project> {
  if (isElectron()) {
    return (window as any).electronAPI.fsRead(id);
  }
  const all = loadFromLocalStorage();
  const project = all[id];
  if (!project) throw new Error(`Project ${id} not found`);
  return project;
}

export async function saveProject(project: Project): Promise<void> {
  const updated = { ...project, updatedAt: Date.now() };
  if (isElectron()) {
    await (window as any).electronAPI.fsWrite(updated);
    return;
  }
  const all = loadFromLocalStorage();
  all[updated.id] = updated;
  saveToLocalStorage(all);
}

export async function deleteProject(id: string): Promise<void> {
  if (isElectron()) {
    await (window as any).electronAPI.fsDelete(id);
    return;
  }
  const all = loadFromLocalStorage();
  delete all[id];
  saveToLocalStorage(all);
}

export function exportProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function importProject(json: string): Project {
  const data = JSON.parse(json);
  if (!data.id || !data.title || !Array.isArray(data.worksheets)) {
    throw new Error('Invalid project file format');
  }
  return data as Project;
}

export function createProject(title: string, articleText: string, difficulty: string): Project {
  const now = Date.now();
  return {
    id: `proj_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    articleText,
    difficulty: difficulty as any,
    createdAt: now,
    updatedAt: now,
    worksheets: [],
  };
}
