import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TestPreview from '../TestPreview';
import type { AppSettings, MCQuestion, WorksheetData } from '../../types';

const questions: MCQuestion[] = [
  {
    id: 'q1',
    type: 'Main Idea',
    cognitiveLevel: 'synthesis',
    scope: 'whole-text',
    skillTarget: 'central argument',
    question: 'What is the central claim?',
    options: ['Alpha claim', 'Beta claim', 'Gamma claim', 'Delta claim'],
    answer: 'A',
    explanation: 'Because the article says so.',
  },
  {
    id: 'q2',
    type: 'Literal Comprehension',
    cognitiveLevel: 'retrieval',
    scope: 'single-paragraph',
    skillTarget: 'stated fact',
    question: 'Which fact is stated?',
    options: ['One fact', 'Two fact', 'Three fact', 'Four fact'],
    answer: 'B',
    explanation: 'Stated in paragraph two.',
  },
];

const data: WorksheetData = {
  title: 'Smoke',
  articleSnippet: 'text',
  summary: { paragraph: '', blanks: [] },
  multipleChoice: questions,
  syntaxDeconstruction: [],
  writingWorkshop: { expansion: [], keywords: [], qaChain: [], criticalThinking: '' },
  keys: { summary: [], mc: { q1: 'A', q2: 'B' }, syntaxDeconstruction: [], expansion: [], qa: [], critical: '' },
};

const settings = { difficulty: 'B2', watermarkText: '', teacherName: '' } as AppSettings;

function render(viewMode: 'editor' | 'print-std'): string {
  return renderToStaticMarkup(
    <TestPreview
      data={data}
      settings={settings}
      visibleSections={new Set(['mc'])}
      sectionOrder={['mc']}
      viewMode={viewMode}
      onRegenerateQuestion={() => {}}
      regeneratingQuestionId={null}
    />,
  );
}

describe('TestPreview regenerate controls', () => {
  it('renders one regenerate button per question in editor view', () => {
    const html = render('editor');
    expect(html).toContain('aria-label="Regenerate question 1"');
    expect(html).toContain('aria-label="Regenerate question 2"');
  });

  it('keeps the buttons out of print/export markup', () => {
    expect(render('print-std')).not.toContain('Regenerate question');
  });
});
