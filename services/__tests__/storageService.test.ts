import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getProjects, getProject, saveProject, deleteProject } from '../storageService';
import type { Project } from '../../types';

describe('storageService', () => {
  beforeEach(() => {
    (globalThis as any).window = {
      electronAPI: {
        fsList: vi.fn().mockResolvedValue([
          { id: 'p1', title: 'Test Project', difficulty: 'B2', createdAt: 1, updatedAt: 2, worksheetCount: 1 },
        ]),
        fsRead: vi.fn().mockResolvedValue({ id: 'p1', title: 'Test Project', articleText: 'text', difficulty: 'B2', createdAt: 1, updatedAt: 2, worksheets: [] }),
        fsWrite: vi.fn().mockResolvedValue({ success: true }),
        fsDelete: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  it('lists projects', async () => {
    const projects = await getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].title).toBe('Test Project');
  });

  it('reads a project', async () => {
    const project = await getProject('p1');
    expect(project.id).toBe('p1');
  });

  it('saves a project', async () => {
    const project: Project = {
      id: 'p2',
      title: 'New',
      articleText: 'article',
      difficulty: 'B2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      worksheets: [],
    };
    await saveProject(project);
    expect((globalThis as any).window.electronAPI.fsWrite).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }));
  });

  it('deletes a project', async () => {
    await deleteProject('p1');
    expect((globalThis as any).window.electronAPI.fsDelete).toHaveBeenCalledWith('p1');
  });
});
