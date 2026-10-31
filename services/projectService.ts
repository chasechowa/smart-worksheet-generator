import type { Difficulty, Project, ProjectSnapshot, WorksheetData } from '../types';
import { createProject } from './storageService';

/**
 * Save-as-article semantics:
 * - same text as the loaded article → update that entry (difficulty/title/snapshot);
 * - new text → create a NEW article entry, so a user can keep 20+ source texts.
 * The loaded project is never mutated in the "new text" branch.
 */
export function saveArticleDraft(
  current: Project | null,
  articleText: string,
  title: string,
  difficulty: Difficulty,
  snapshot?: ProjectSnapshot,
): { project: Project; created: boolean } {
  const text = articleText;
  const canUpdate = Boolean(current && current.kind === 'article' && current.articleText === text);

  if (canUpdate && current) {
    return {
      project: {
        ...current,
        kind: 'article',
        title: current.title || title || 'Saved Article',
        articleText: text,
        difficulty,
        worksheets: [],
        snapshot,
        updatedAt: Date.now(),
      },
      created: false,
    };
  }

  const base = createProject(title || 'Saved Article', text, difficulty);
  return {
    project: { ...base, kind: 'article', worksheets: [], snapshot },
    created: true,
  };
}

/**
 * A generated worksheet is its own project. Generating from a saved article must
 * never convert or overwrite that article, so repeated generations can all be kept.
 */
export function buildWorksheetProject(
  source: Project | null,
  worksheet: WorksheetData,
  title: string,
  difficulty: Difficulty,
  snapshot?: ProjectSnapshot,
  articleText?: string,
): Project {
  const base = createProject(
    title || source?.title || 'Untitled Worksheet',
    articleText ?? source?.articleText ?? '',
    difficulty,
  );
  return {
    ...base,
    kind: 'worksheet',
    worksheets: [worksheet],
    snapshot,
  };
}
