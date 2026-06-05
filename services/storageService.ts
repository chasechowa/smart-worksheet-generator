import type { Project, ProjectMeta } from '../types';

function getAPI() {
  const api = (window as any).electronAPI;
  if (!api) throw new Error('Electron API not available');
  return api;
}

export async function getProjects(): Promise<ProjectMeta[]> {
  return getAPI().fsList();
}

export async function getProject(id: string): Promise<Project> {
  return getAPI().fsRead(id);
}

export async function saveProject(project: Project): Promise<void> {
  const updated = { ...project, updatedAt: Date.now() };
  await getAPI().fsWrite(updated);
}

export async function deleteProject(id: string): Promise<void> {
  await getAPI().fsDelete(id);
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
