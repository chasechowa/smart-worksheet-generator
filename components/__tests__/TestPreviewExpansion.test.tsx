import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TestPreview from '../TestPreview';
import type { AppSettings, WorksheetData } from '../../types';

const data: WorksheetData = {
  title: 'Expansion smoke',
  articleSnippet: 'text',
  summary: { paragraph: '', blanks: [] },
  multipleChoice: [],
  syntaxDeconstruction: [],
  writingWorkshop: {
    expansion: [
      {
        id: 'e1',
        fact: 'IKEA rents some of its products in parts of Europe.',
        conjunctions: ['because', 'so that', 'although'],
        continuations: [
          { connector: 'because', continuation: 'customers want to avoid owning furniture' },
          { connector: 'so that', continuation: 'fewer pieces end up in landfills' },
          { connector: 'although', continuation: 'renting furniture may seem unusual' },
        ],
        sampleAnswer: 'Because customers want to avoid owning furniture, IKEA rents products so that fewer pieces end up in landfills, although renting may seem unusual.',
      },
    ],
    keywords: [],
    qaChain: [],
    criticalThinking: '',
  },
  keys: { summary: [], mc: {}, syntaxDeconstruction: [], expansion: ['old combined answer'], qa: [], critical: '' },
};

const settings = { difficulty: 'B2', watermarkText: '', teacherName: '' } as AppSettings;

function render(): string {
  return renderToStaticMarkup(
    <TestPreview
      data={data}
      settings={settings}
      visibleSections={new Set(['writing', 'writing_expansion', 'keys'])}
      sectionOrder={['writing']}
      viewMode="editor"
    />,
  );
}

describe('Sentence Expansion model answers', () => {
  it('shows one separate model answer per connector', () => {
    const html = render();
    expect(html).toContain('customers want to avoid owning furniture');
    expect(html).toContain('fewer pieces end up in landfills');
    expect(html).toContain('renting furniture may seem unusual');
  });

  it('does not print the old combined sampleAnswer when continuations exist', () => {
    const html = render();
    expect(html).not.toContain('old combined answer');
    expect(html).not.toContain('Although renting may seem unusual');
  });
});
