import { describe, expect, it } from 'vitest';
import { buildWorksheetProject, saveArticleDraft } from '../projectService';
import type { Project, WorksheetData } from '../../types';

const worksheet = {
  title: 'A generated worksheet',
  articleSnippet: 'snippet',
  summary: { paragraph: '', blanks: [] },
  multipleChoice: [],
  syntaxDeconstruction: [],
  writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
  keys: { summary: [], mc: {}, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
} as WorksheetData;

function savedArticle(overrides: Partial<Project> = {}): Project {
  const now = Date.now();
  return {
    id: 'art_1',
    kind: 'article',
    title: 'First article',
    articleText: 'Article one text',
    difficulty: 'B2',
    createdAt: now,
    updatedAt: now,
    worksheets: [],
    ...overrides,
  };
}

describe('saveArticleDraft', () => {
  it('creates a new article when there is no current project', () => {
    const { project, created } = saveArticleDraft(null, 'Article one text', 'First article', 'B2');
    expect(created).toBe(true);
    expect(project.kind).toBe('article');
    expect(project.articleText).toBe('Article one text');
    expect(project.worksheets).toEqual([]);
  });

  it('creates a new article when the pasted text differs from the loaded article', () => {
    const current = savedArticle();
    const { project, created } = saveArticleDraft(current, 'Article two text', 'Second article', 'B2');
    expect(created).toBe(true);
    expect(project.id).not.toBe('art_1');
    expect(current.articleText).toBe('Article one text');
  });

  it('updates the same article when the text is unchanged', () => {
    const current = savedArticle();
    const { project, created } = saveArticleDraft(current, 'Article one text', 'First article', 'C1');
    expect(created).toBe(false);
    expect(project.id).toBe('art_1');
    expect(project.difficulty).toBe('C1');
  });
});

describe('buildWorksheetProject', () => {
  it('creates a separate worksheet project from a saved article', () => {
    const article = savedArticle();
    const project = buildWorksheetProject(article, worksheet, 'Generated test', 'B2');
    expect(project.kind).toBe('worksheet');
    expect(project.id).not.toBe(article.id);
    expect(project.articleText).toBe(article.articleText);
    expect(project.worksheets).toHaveLength(1);
    expect(article.kind).toBe('article');
    expect(article.worksheets).toHaveLength(0);
  });

  it('works when generating without a saved article', () => {
    const project = buildWorksheetProject(null, worksheet, 'Generated test', 'A2');
    expect(project.kind).toBe('worksheet');
    expect(project.articleText).toBe('');
    expect(project.worksheets).toHaveLength(1);
  });

  it('stores the live article text when regenerating from a worksheet project', () => {
    const project = buildWorksheetProject(null, worksheet, 'Generated test', 'B2', undefined, 'Live article text');
    expect(project.articleText).toBe('Live article text');
  });
});
