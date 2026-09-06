import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProjects,
  getProject,
  saveProject,
  deleteProject,
  createProject,
  importProject,
} from '../storageService';
import type { Project } from '../../types';

// vitest runs in a 'node' environment — provide an in-memory localStorage
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  } as Storage;
}

const baseProject: Project = {
  id: 'p1',
  title: 'Test Project',
  articleText: 'text',
  difficulty: 'B2',
  createdAt: 1,
  updatedAt: 2,
  worksheets: [],
};

beforeEach(() => {
  (globalThis as any).localStorage = createLocalStorageMock();
  (globalThis as any).window = {};
});

describe('storageService (web / localStorage)', () => {
  it('saves a project and reads it back', async () => {
    await saveProject(baseProject);
    const loaded = await getProject('p1');
    expect(loaded.id).toBe('p1');
    expect(loaded.kind).toBe('article');
    expect(loaded.articleText).toBe('text');
  });

  it('lists projects sorted by updatedAt (descending)', async () => {
    (globalThis as any).localStorage.setItem('worksheet_projects', JSON.stringify({
      a: { ...baseProject, id: 'a', title: 'A', createdAt: 1, updatedAt: 1 },
      b: { ...baseProject, id: 'b', title: 'B', createdAt: 1, updatedAt: 3 },
    }));
    const list = await getProjects();
    expect(list.map(p => p.id)).toEqual(['b', 'a']);
  });

  it('throws when reading a missing project', async () => {
    await expect(getProject('missing')).rejects.toThrow('Project missing not found');
  });

  it('deletes a project', async () => {
    await saveProject(baseProject);
    await deleteProject('p1');
    await expect(getProject('p1')).rejects.toThrow();
  });

  it('normalizes an explicit worksheet project', async () => {
    await saveProject({ ...baseProject, kind: 'worksheet', worksheets: [{ id: 'w1' } as any] });
    const loaded = await getProject('p1');
    expect(loaded.kind).toBe('worksheet');
  });

  it('splits legacy multi-worksheet projects on load', async () => {
    (globalThis as any).localStorage.setItem('worksheet_projects', JSON.stringify({
      legacy: {
        ...baseProject,
        id: 'legacy',
        worksheets: [
          { _meta: { generatedAt: 1 } },
          { _meta: { generatedAt: 2 } },
        ],
      },
    }));
    const list = await getProjects();
    expect(list.map(p => p.id).sort()).toEqual([
      'legacy_article',
      'legacy_worksheet_1',
      'legacy_worksheet_2',
    ]);
  });

  it('creates a project with kind=article', () => {
    const project = createProject('Title', 'article', 'B2');
    expect(project.kind).toBe('article');
    expect(project.worksheets).toEqual([]);
  });

  it('imports and normalizes a project', () => {
    const project = importProject(JSON.stringify({
      id: 'imp', title: 'Imp', articleText: '', difficulty: 'B2', createdAt: 1, updatedAt: 1, worksheets: [],
    }));
    expect(project.id).toBe('imp');
    expect(project.kind).toBe('article');
  });
});
