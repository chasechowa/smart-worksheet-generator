import type { Project, ProjectMeta } from '../types';

const STORAGE_KEY = 'worksheet_projects';

function normalizeStoredProject(project: Project): Project {
  const worksheets = Array.isArray(project.worksheets) ? project.worksheets : [];
  return {
    ...project,
    kind: project.kind || (worksheets.length > 0 ? 'worksheet' : 'article'),
    worksheets,
  };
}

function splitLegacyProject(project: Project): Project[] {
  const normalized = normalizeStoredProject(project);
  if (project.kind || normalized.worksheets.length === 0) return [normalized];

  const articleProject: Project = {
    ...normalized,
    id: `${normalized.id}_article`,
    kind: 'article',
    worksheets: [],
  };

  const worksheetProjects = normalized.worksheets.map((worksheet, index) => ({
    ...normalized,
    id: `${normalized.id}_worksheet_${worksheet._meta?.generatedAt || index}`,
    kind: 'worksheet' as const,
    title: worksheet.title || `${normalized.title} ${index + 1}`,
    worksheets: [worksheet],
    updatedAt: worksheet._meta?.generatedAt || normalized.updatedAt,
  }));

  return [articleProject, ...worksheetProjects];
}

function migrateProjects(projects: Record<string, Project>): Record<string, Project> {
  const migrated: Record<string, Project> = {};
  let changed = false;

  Object.values(projects).forEach(project => {
    const split = splitLegacyProject(project);
    if (split.length > 1 || split[0].kind !== project.kind) changed = true;
    split.forEach(item => {
      migrated[item.id] = item;
    });
  });

  if (changed) {
    try {
      saveToLocalStorage(migrated);
    } catch {
      // Return migrated records for the current session even if persistence is blocked.
    }
  }

  return migrated;
}

function loadFromLocalStorage(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return migrateProjects(JSON.parse(raw) as Record<string, Project>);
  } catch {
    return {};
  }
}

function saveToLocalStorage(projects: Record<string, Project>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (err: any) {
    throw new Error(err?.message ? `Local save failed: ${err.message}` : 'Local save failed.');
  }
}

export async function getProjects(): Promise<ProjectMeta[]> {
  const all = loadFromLocalStorage();
  return Object.values(all)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(p => ({
      id: p.id,
      kind: p.kind || (p.worksheets.length > 0 ? 'worksheet' : 'article'),
      title: p.title,
      difficulty: p.difficulty,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      worksheetCount: p.worksheets.length,
    }));
}

export async function getProject(id: string): Promise<Project> {
  const all = loadFromLocalStorage();
  const project = all[id];
  if (!project) throw new Error(`Project ${id} not found`);
  return normalizeStoredProject(project);
}

export async function saveProject(project: Project): Promise<Project> {
  const updated = { ...project, updatedAt: Date.now() };

  const all = loadFromLocalStorage();
  all[updated.id] = updated;
  saveToLocalStorage(all);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
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
  return normalizeStoredProject(data as Project);
}

export function createProject(title: string, articleText: string, difficulty: string): Project {
  const now = Date.now();
  return {
    id: `proj_${now}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'article',
    title,
    articleText,
    difficulty: difficulty as any,
    createdAt: now,
    updatedAt: now,
    worksheets: [],
  };
}
