import React, { useRef, useEffect, useMemo } from 'react';
import type { WorksheetData, AppSettings } from '../types';
import { splitInsertionParagraph } from '../validators/sentenceInsertionValidator';

type ViewMode = 'editor' | 'print-std' | 'print-compact' | 'interactive' | 'pdf';

const INTERACTIVE_SCRIPT = `
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.mcq-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const isCorrect = opt.dataset.correct === 'true';
        const parent = opt.closest('.mcq-container');
        parent.querySelectorAll('.mcq-option').forEach(s => {
          s.classList.remove('selected-correct', 'selected-wrong');
        });
        if (isCorrect) opt.classList.add('selected-correct');
        else opt.classList.add('selected-wrong');
      });
    });
    document.querySelectorAll('.check-input').forEach(input => {
      input.addEventListener('input', () => { checkInput(input); });
      input.addEventListener('blur', () => { checkInput(input); });
    });
    function checkInput(input) {
      const val = input.value.trim().toLowerCase();
      const ans = input.dataset.answer.toLowerCase();
      if (val === ans) input.classList.add('correct');
      else input.classList.remove('correct');
    }
  });
`;

const LINKING_ADVERBS = new Set([
  'however', 'therefore', 'thus', 'consequently', 'as a result', 'in contrast',
  'by contrast', 'on the other hand', 'instead', 'moreover', 'furthermore',
  'nevertheless', 'then',
]);

/** One model answer per connector: fact + that connector + its continuation. */
function buildExpansionModelAnswer(fact: string, connector: string, continuation: string): string {
  const base = String(fact ?? '').trim().replace(/[.\s]+$/, '');
  const clause = String(continuation ?? '').trim().replace(/^[,;]\s*/, '');
  const link = String(connector ?? '').trim();
  if (!base || !clause || !link) return '';

  if (LINKING_ADVERBS.has(link.toLowerCase())) {
    const capitalized = link.charAt(0).toUpperCase() + link.slice(1);
    return `${base}. ${capitalized}, ${clause}`;
  }
  return `${base}, ${link} ${clause}`;
}

const SECTION_INSTRUCTIONS: Record<string, string> = {
  summary: 'Read the summary and fill in each blank with a word or short phrase from the article. Keep your answers grammatically correct in the sentence.',
  mc: 'Choose the best answer for each question. Use evidence from the article, not only general knowledge.',
  sentenceInsertion: 'Read the extra sentence. Decide where it fits best in the paragraph and mark the correct position [1], [2], [3], or [4].',
  syntaxDeconstruction: 'Study the sentence structure carefully. Break down how the key parts of the sentence work together.',
  writing: 'Use ideas from the article to build stronger sentences and short responses. Focus on clear logic, accurate language, and complete meaning.',
};

const PrintableField: React.FC<{
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
  tagName?: 'h1' | 'div' | 'span' | 'p';
  viewMode: ViewMode;
}> = ({ value, onChange, className = "", placeholder = "", tagName = 'div', viewMode }) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current && viewMode === 'editor') {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [value, viewMode]);

  if (viewMode !== 'editor') {
    if (tagName === 'span') {
      return (
        <span className={`whitespace-pre-wrap break-words ${className}`}>
          {value || placeholder}
        </span>
      );
    }

    return (
      <div className={`whitespace-pre-wrap break-words ${className}`}>
        {value || placeholder}
      </div>
    );
  }

  return (
    <div className={`relative group ${tagName === 'span' ? 'inline-block' : 'block'} w-full`}>
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        rows={1}
        placeholder={placeholder}
        className={`bg-transparent resize-none overflow-hidden transition-colors editable-field rounded no-print block w-full focus:outline-none focus:ring-1 focus:ring-blue-300 ${className}`}
      />
    </div>
  );
};

const HeaderLabelField: React.FC<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  viewMode: ViewMode;
}> = ({ value, onChange, placeholder, viewMode }) => {
  if (viewMode !== 'editor') {
    return <span>{value || placeholder}</span>;
  }

  return (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="bg-transparent editable-field rounded no-print inline-block min-w-0 focus:outline-none focus:ring-1 focus:ring-blue-300"
      style={{
        font: 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit',
        width: `${Math.max(5, (value || placeholder).length + 1)}ch`,
      }}
    />
  );
};

const Toggle: React.FC<{ checked: boolean; onChange: () => void; label?: string; size?: 'sm' | 'xs' }> = ({ checked, onChange, label, size = 'sm' }) => (
  <label className="flex items-center cursor-pointer gap-2">
    <div className="relative">
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <div className={`bg-gray-200 rounded-full shadow-inner transition-colors ${checked ? 'bg-blue-600' : ''} ${size === 'xs' ? 'w-6 h-3' : 'w-8 h-5'}`}></div>
      <div className={`dot absolute left-0.5 top-0.5 bg-white rounded-full shadow transition-transform ${checked ? (size === 'xs' ? 'translate-x-3' : 'translate-x-3') : ''} ${size === 'xs' ? 'w-2 h-2' : 'w-3 h-3 left-1 top-1'}`}></div>
    </div>
    {label && <span className="text-sm font-medium text-gray-700">{label}</span>}
  </label>
);

const BLANK_TOKEN_RE = /\[BLANK\d*\]/gi;

function splitSummaryParagraph(paragraph: string): string[] {
  return (paragraph || '').split(BLANK_TOKEN_RE);
}

// --- The Worksheet Paper Component ---
const WorksheetPaper: React.FC<{
  data: WorksheetData;
  settings: AppSettings;
  visibleSections: Set<string>;
  sectionOrder: string[];
  onUpdate?: (key: keyof WorksheetData, val: any) => void;
  onRegenerateQuestion?: (id: string) => void;
  regeneratingQuestionId?: string | null;
  viewMode: ViewMode;
}> = ({ data, settings, visibleSections, sectionOrder, onUpdate, onRegenerateQuestion, regeneratingQuestionId, viewMode }) => {
  
  const isCompact = viewMode === 'print-compact' || viewMode === 'pdf';
  const isInteractive = viewMode === 'interactive';
  const watermarkText = (settings.watermarkText || '').trim();
  
  const partLabels = useMemo(() => {
    const active = sectionOrder.filter(id => visibleSections.has(id));
    const mapping: Record<string, string> = {};
    active.forEach((id, index) => {
      mapping[id] = `Part ${index + 1}`;
    });
    return mapping;
  }, [visibleSections, sectionOrder]);

  const update = (key: keyof WorksheetData, val: any) => {
    if (onUpdate && viewMode === 'editor') onUpdate(key, val);
  };

  const header = data.header || { brand: 'OTIA', nameLabel: 'Name', scoreLabel: 'Score' };

  const updateHeader = (patch: Partial<NonNullable<WorksheetData['header']>>) => {
    update('header', { ...header, ...patch });
  };

  const renderSection = (sectionId: string) => {
    const renderInstruction = (id: string) => {
      const instruction = SECTION_INSTRUCTIONS[id];
      if (!instruction) return null;
      return (
        <div className="section-instruction">
          {instruction}
        </div>
      );
    };

    switch (sectionId) {
      case 'summary':
        return data.summary && (
          <section key="summary" className="section-gap">
            <h2 className="section-title">
              {partLabels['summary']}: 🧩 Summary Completion
            </h2>
            {renderInstruction('summary')}
            {/* Always show blanks as split text — never raw [BLANK] tokens */}
            {viewMode === 'editor' ? (
              <div className={`text-justify ${isCompact ? 'leading-relaxed' : 'leading-[2.5rem]'}`}>
                {splitSummaryParagraph(data.summary.paragraph || "").map((chunk, i, arr) => (
                  <React.Fragment key={i}>
                    <span className="text-[11pt]">{chunk}</span>
                    {i < arr.length - 1 && (
                      <input
                        type="text"
                        value={data.summary.blanks?.[i] || data.keys?.summary?.[i] || ''}
                        onChange={e => {
                          const next = [...(data.summary.blanks || [])];
                          next[i] = e.target.value;
                          update('summary', { ...data.summary, blanks: next });
                        }}
                        className="inline border-b-2 border-gray-400 bg-gray-50 mx-1 text-center text-[11pt] font-bold text-blue-700 min-w-[80px] focus:outline-none focus:border-blue-500 focus:bg-blue-50 rounded-t"
                        placeholder={`(${i + 1})`}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className={`text-justify ${isCompact ? 'leading-relaxed' : 'leading-[2.5rem]'}`}>
                {splitSummaryParagraph(data.summary.paragraph || "").map((chunk, i, arr) => (
                  <React.Fragment key={i}>
                    {chunk}
                    {i < arr.length - 1 && (
                      isInteractive ? (
                        <input
                          type="text"
                          className="check-input interactive-input mx-1 w-32 text-center"
                          data-answer={data.keys.summary[i] || ''}
                          placeholder={`(${i + 1})`}
                        />
                      ) : (
                        <span className="summary-blank mx-1 font-bold whitespace-nowrap" data-index={i + 1}>
                        </span>
                      )
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </section>
        );

      case 'mc':
        return (
          <section key="mc" className="section-gap">
             <h2 className="section-title">
              {partLabels['mc']}: 🧠 Logical Analysis
            </h2>
            {renderInstruction('mc')}
            <div className={isCompact ? 'space-y-3' : 'space-y-6'}>
              {(data.multipleChoice || []).map((q, i) => (
                <div key={q.id} className="avoid-break mcq-container">
                  <div className="flex gap-3 mb-1 items-start">
                    <span className="font-black bg-black text-white px-2 py-0.5 text-xs h-fit mt-1 rounded-sm">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <PrintableField 
                        value={q.question}
                        onChange={e => {
                          const next = [...data.multipleChoice];
                          next[i].question = e.target.value;
                          update('multipleChoice', next);
                        }}
                        className="font-bold"
                        viewMode={viewMode}
                      />
                    </div>
                    {viewMode === 'editor' && onRegenerateQuestion && (
                      <button
                        type="button"
                        onClick={() => onRegenerateQuestion(q.id)}
                        disabled={regeneratingQuestionId === q.id}
                        title="Regenerate this question with the same skill target"
                        aria-label={`Regenerate question ${i + 1}`}
                        className="no-print shrink-0 mt-0.5 inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        <i className={`fas ${regeneratingQuestionId === q.id ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
                        {regeneratingQuestionId === q.id ? 'Working' : 'Regenerate'}
                      </button>
                    )}
                  </div>
                  <div className={`grid grid-cols-1 ${viewMode === 'editor' ? '' : 'md:grid-cols-2'} ml-10 ${isCompact ? 'gap-x-4 gap-y-0' : 'gap-x-8 gap-y-1'}`}>
                    {q.options.map((opt, oIdx) => {
                       const letter = String.fromCharCode(65 + oIdx);
                       const isCorrect = letter === data.keys.mc[q.id];
                       return (
                        <div 
                          key={oIdx} 
                          className={`flex gap-2 items-start ${isInteractive ? 'mcq-option interactive-opt p-1 rounded' : ''}`}
                          data-correct={isInteractive ? isCorrect : undefined}
                        >
                          <span className="font-bold text-xs mt-1">{letter}.</span>
                          <PrintableField 
                            value={opt.replace(/^([A-Da-d]|\d+)[.)\]]\s*/, '')}
                            onChange={e => {
                              const next = [...data.multipleChoice];
                              next[i].options[oIdx] = e.target.value;
                              update('multipleChoice', next);
                            }}
                            viewMode={viewMode}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );

      case 'sentenceInsertion':
        return (
          <section key="sentenceInsertion" className="section-gap">
            <h2 className="section-title">
              {partLabels['sentenceInsertion']}: 🧩 Sentence Insertion
            </h2>
            {renderInstruction('sentenceInsertion')}
            <div className={isCompact ? 'space-y-3' : 'space-y-6'}>
              {(data.sentenceInsertion || []).map((item, i) => {
                const correctPos = data.keys?.sentenceInsertion?.[item.id];
                return (
                  <div key={item.id} className="avoid-break mcq-container">
                    <div className="flex gap-3 mb-2 items-start">
                      <span className="font-black bg-black text-white px-2 py-0.5 text-xs h-fit mt-1 rounded-sm">{i + 1}</span>
                      <div className="flex-1 min-w-0 border-l-4 border-amber-300 pl-2">
                        <PrintableField
                          value={item.sentence}
                          onChange={e => {
                            const next = [...(data.sentenceInsertion || [])];
                            next[i].sentence = e.target.value;
                            update('sentenceInsertion', next);
                          }}
                          className="font-bold"
                          viewMode={viewMode}
                        />
                      </div>
                    </div>
                    <div className={`ml-10 text-justify ${isCompact ? 'leading-relaxed' : 'leading-[2.5rem]'}`}>
                      {splitInsertionParagraph(item.paragraph).map((chunk, cIdx) => (
                        chunk.marker === null ? (
                          <span key={cIdx} className="text-[11pt]">{chunk.text}</span>
                        ) : isInteractive ? (
                          <span
                            key={cIdx}
                            className="mcq-option interactive-opt insertion-marker"
                            data-correct={String(chunk.marker === correctPos)}
                          >
                            {chunk.marker}
                          </span>
                        ) : (
                          <span key={cIdx} className="insertion-marker">{chunk.marker}</span>
                        )
                      ))}
                    </div>
                    <div className="flex items-center gap-3 ml-10 mt-2">
                      <span className="text-xs font-bold uppercase text-gray-400">Answer</span>
                      <span className="insertion-marker">1</span>
                      <span className="insertion-marker">2</span>
                      <span className="insertion-marker">3</span>
                      <span className="insertion-marker">4</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );

      case 'syntaxDeconstruction':
        return (
          <section key="syntaxDeconstruction" className="section-gap">
            <h2 className="section-title">
              {partLabels['syntaxDeconstruction']}: 🎨 Syntax Deconstruction
            </h2>
            {renderInstruction('syntaxDeconstruction')}
            {(data.syntaxDeconstruction || []).map((p, i) => (
              <div key={p.id} className={`avoid-break ${isCompact ? 'mb-4' : 'mb-8'}`}>
                <div className="flex gap-2 mb-2">
                  <span className="font-serif italic text-gray-400">"{' '}"</span>
                  <PrintableField 
                    value={p.original}
                    onChange={e => {
                      const next = [...data.syntaxDeconstruction];
                      next[i].original = e.target.value;
                      update('syntaxDeconstruction', next);
                    }}
                    className="italic font-medium text-gray-800"
                    viewMode={viewMode}
                  />
                   <span className="font-serif italic text-gray-400">"{' '}"</span>
                </div>
                {isInteractive ? (
                   <textarea className="w-full border rounded p-2 text-sm bg-gray-50 h-20" placeholder="Type your answer here..." />
                ) : (
                  <>
                    <div className="writing-line mt-2"></div>
                    <div className="writing-line"></div>
                  </>
                )}
              </div>
            ))}
          </section>
        );

      case 'writing':
        return data.writingWorkshop && (
          <section key="writing" className="section-gap pt-2">
            <h2 className="section-title">
              {partLabels['writing']}: ✍️ Writing & Logic Workshop
            </h2>
            {renderInstruction('writing')}

            <div className={isCompact ? 'space-y-6' : 'space-y-12'}>
              
              {visibleSections.has('writing_expansion') && (
                <div>
                  <h3 className="text-sm font-black uppercase mb-2 tracking-wider border-l-4 border-gray-300 pl-2">🌱 A. Sentence Expansion</h3>
                  <p className="italic text-xs mb-3 text-gray-600">Choose ONE conjunction and continue the fact to make a complex sentence.</p>
                  {(data.writingWorkshop.expansion || []).slice(0, 4).map((ex, i) => (
                    <div key={i} className="mb-4 avoid-break">
                      <div className="flex gap-2 items-baseline mb-1 text-[11pt]">
                        <span className="font-bold">{i+1}.</span>
                        <PrintableField 
                          value={ex.fact}
                          onChange={e => {
                            const next = [...data.writingWorkshop.expansion];
                            next[i].fact = e.target.value;
                            update('writingWorkshop', { ...data.writingWorkshop, expansion: next });
                          }}
                          viewMode={viewMode}
                        />
                        <span className="font-black whitespace-nowrap">[{ (ex.conjunctions || []).join(' / ') }]</span>
                      </div>
                      {isInteractive ? (
                         <input className="w-full border-b border-gray-300 bg-gray-50 p-1" placeholder="Type sentence..." />
                      ) : (
                        <>
                          <div className="writing-line"></div>
                          <div className="writing-line"></div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {visibleSections.has('writing_keywords') && (
                <div>
                  <h3 className="text-sm font-black uppercase mb-2 tracking-wider border-l-4 border-gray-300 pl-2">🗝️ B. Keyword Paragraph</h3>
                  <p className="italic text-xs mb-3 text-gray-600">
                    Using the keywords below, write a short paragraph reflecting the main points of the article. Do not copy sentences directly from the text.
                  </p>
                  
                  {/* Grouped for Print Safety */}
                  <div className="avoid-break">
                    {/* Keywords Display */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        {(data.writingWorkshop.keywords || []).map((kw, i) => (
                        viewMode === 'editor' ? (
                            <input 
                            key={i}
                            value={kw}
                            onChange={e => {
                                const next = [...data.writingWorkshop.keywords];
                                next[i] = e.target.value;
                                update('writingWorkshop', { ...data.writingWorkshop, keywords: next });
                            }}
                            className="px-2 py-1 border border-gray-300 text-sm font-bold w-32 text-center rounded bg-gray-50"
                            />
                        ) : (
                            <span key={i} className="px-3 py-1 bg-gray-100 border border-gray-300 text-sm font-bold text-gray-800 rounded">
                            {kw}
                            </span>
                        )
                        ))}
                    </div>

                    {/* 5 Writing Lines */}
                    <div className="mt-2">
                        {isInteractive ? (
                            <textarea className="w-full border rounded p-3 h-32 bg-gray-50 text-sm" placeholder="Write your paragraph here using the keywords..." />
                        ) : (
                            Array.from({ length: 5 }).map((_, i) => <div key={i} className="writing-line"></div>)
                        )}
                    </div>
                  </div>
                </div>
              )}

              {visibleSections.has('writing_qa') && (
                <div>
                  <h3 className="text-sm font-black uppercase mb-2 tracking-wider border-l-4 border-gray-300 pl-2">❓ C. The Q&A Chain</h3>
                  <p className="italic text-xs mb-3 text-gray-600">Answer the questions to build a logical summary.</p>
                  {(data.writingWorkshop.qaChain || []).map((q, i) => (
                    <div key={i} className="mb-4 avoid-break">
                      <div className="flex gap-2 items-baseline mb-1">
                        <span className="font-bold">{i+1}.</span>
                        <PrintableField 
                          value={q}
                          onChange={e => {
                            const next = [...data.writingWorkshop.qaChain];
                            next[i] = e.target.value;
                            update('writingWorkshop', { ...data.writingWorkshop, qaChain: next });
                          }}
                          viewMode={viewMode}
                        />
                      </div>
                      {isInteractive ? (
                          <textarea className="w-full border rounded p-2 h-16 bg-gray-50" />
                      ) : (
                        <>
                          <div className="writing-line"></div>
                          <div className="writing-line"></div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {visibleSections.has('writing_critical') && (
                <div className="avoid-break">
                  <h3 className="text-sm font-black uppercase mb-2 tracking-wider border-l-4 border-gray-300 pl-2">💡 D. Critical Perspective</h3>
                  <PrintableField 
                    value={data.writingWorkshop.criticalThinking}
                    onChange={e => update('writingWorkshop', { ...data.writingWorkshop, criticalThinking: e.target.value })}
                    className="text-[11pt] font-bold mb-4"
                    viewMode={viewMode}
                  />
                  <div>
                  {isInteractive ? (
                     <textarea className="w-full border rounded p-4 h-48 bg-gray-50" placeholder="Write your critical evaluation here..." />
                  ) : (
                    Array.from({ length: 8 }).map((_, i) => <div key={i} className="writing-line"></div>)
                  )}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
        
      default:
        return null;
    }
  };

  const renderKeySection = (sectionId: string) => {
    switch (sectionId) {
        case 'summary':
            return (
                <div key="key-summary" className="avoid-break">
                  <h3 className="text-blue-900 mb-4 uppercase tracking-wider border-b pb-2 section-title">{partLabels['summary']} Answers</h3>
                  <div className="grid grid-cols-2 gap-x-12 gap-y-3">
                    {(data.keys.summary || []).map((k, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="font-black text-gray-500 w-8">({i + 1})</span>
                        <PrintableField 
                          value={k}
                          onChange={e => {
                            const next = [...data.keys.summary];
                            next[i] = e.target.value;
                            update('keys', { ...data.keys, summary: next });
                          }}
                          className="font-mono text-sm"
                          viewMode={viewMode}
                        />
                      </div>
                    ))}
                  </div>
                </div>
            );
        case 'mc':
            return (
                <div key="key-mc" className="avoid-break">
                  <h3 className="text-blue-900 mb-4 uppercase tracking-wider border-b pb-2 section-title">{partLabels['mc']} Answers</h3>
                  <div className="grid grid-cols-5 gap-4">
                    {(data.multipleChoice || []).map((q, i) => (
                      <div key={q.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                        <span className="font-black text-gray-500">{i + 1}:</span>
                        <span className="w-10 font-bold text-center inline-block">{data.keys.mc[q.id] || ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
            );
        case 'sentenceInsertion':
            return (
                <div key="key-sentenceInsertion" className="avoid-break">
                  <h3 className="text-blue-900 mb-4 uppercase tracking-wider border-b pb-2 section-title">{partLabels['sentenceInsertion']} Answers</h3>
                  <div className="space-y-3">
                    {(data.sentenceInsertion || []).map((item, i) => (
                      <div key={item.id} className="flex items-start gap-3 bg-gray-50 p-3 rounded border avoid-break">
                        <span className="font-black text-gray-500 h-fit mt-0.5">{i + 1}:</span>
                        <span className="insertion-marker h-fit">{data.keys?.sentenceInsertion?.[item.id] ?? '—'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs italic text-gray-500 mb-1">"{item.sentence}"</div>
                          <PrintableField
                            value={item.explanation || ''}
                            onChange={e => {
                              const next = [...(data.sentenceInsertion || [])];
                              next[i].explanation = e.target.value;
                              update('sentenceInsertion', next);
                            }}
                            className="text-sm text-gray-700"
                            viewMode={viewMode}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
            );
        case 'syntaxDeconstruction':
            return (data.keys.syntaxDeconstruction || []).map((p, i) => (
                <div key={`key-para-${i}`} className="bg-gray-50 p-4 rounded border avoid-break">
                   <div className="text-[9pt] font-black text-gray-400 uppercase mb-1">Deconstruction {i+1} ({partLabels['syntaxDeconstruction']})</div>
                   <PrintableField 
                      value={p}
                      onChange={e => {
                        const next = [...data.keys.syntaxDeconstruction];
                        next[i] = e.target.value;
                        update('keys', { ...data.keys, syntaxDeconstruction: next });
                      }}
                      className="italic text-gray-700"
                      viewMode={viewMode}
                    />
                </div>
            ));
        case 'writing':
            return (
                <div key="key-writing" className="space-y-6 avoid-break">
                  <h3 className="text-blue-900 mb-2 uppercase tracking-wider border-b pb-2 section-title">{partLabels['writing']} Suggestions</h3>

                  {visibleSections.has('writing_expansion') && (
                    <div className="bg-blue-50 p-4 border rounded border-blue-200 avoid-break">
                      <div className="text-[9pt] font-black text-blue-900 uppercase mb-3">A. Sentence Expansion — Model Answers</div>
                      <div className="space-y-3">
                        {(data.writingWorkshop.expansion || []).slice(0, 4).map((ex, i) => (
                          <div key={ex.id || i} className="bg-white p-3 rounded border border-blue-100">
                            <div className="text-xs font-bold text-gray-500 mb-1">Fact {i + 1}: {ex.fact}</div>
                            <div className="text-xs text-gray-600 mb-1">Conjunctions: [{ex.conjunctions?.join(' / ') || '—'}]</div>
                            {ex.continuations && ex.continuations.length > 0 ? (
                              <div className="space-y-1.5">
                                {ex.continuations.map((cont, cIdx) => (
                                  <div key={cIdx} className="flex items-start gap-2">
                                    <span className="text-[10px] font-black text-blue-600 mt-0.5 shrink-0 w-24">{cont.connector}</span>
                                    <span className="text-sm text-blue-800 italic flex-1">{buildExpansionModelAnswer(ex.fact, cont.connector, cont.continuation)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-black text-blue-600 mt-0.5 shrink-0">KEY:</span>
                                <PrintableField
                                  value={data.keys.expansion?.[i] || ''}
                                  onChange={e => {
                                    const next = [...(data.keys.expansion || [])];
                                    next[i] = e.target.value;
                                    update('keys', { ...data.keys, expansion: next });
                                  }}
                                  className="text-sm text-blue-800 italic flex-1"
                                  viewMode={viewMode}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleSections.has('writing_keywords') && (
                    <div className="bg-blue-50 p-4 border rounded border-blue-200 avoid-break">
                      <div className="text-[9pt] font-black text-blue-900 uppercase mb-2">B. Keywords</div>
                      <div className="flex flex-wrap gap-2">
                        {(data.writingWorkshop.keywords || []).map((kw, i) => (
                           <span key={i} className="px-2 py-1 bg-white border border-blue-300 rounded text-sm font-bold text-blue-800">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleSections.has('writing_qa') && (
                    <div className="bg-blue-50 p-4 border rounded border-blue-200 avoid-break">
                      <div className="text-[9pt] font-black text-blue-900 uppercase mb-3">C. Q&A Chain — Model Answers</div>
                      <div className="space-y-3">
                        {(data.writingWorkshop.qaChain || []).map((q, i) => (
                          <div key={i} className="bg-white p-3 rounded border border-blue-100">
                            <div className="text-xs font-semibold text-gray-700 mb-1">Q{i + 1}: {q}</div>
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-black text-blue-600 mt-0.5 shrink-0">A:</span>
                              <PrintableField
                                value={data.keys.qa?.[i] || ''}
                                onChange={e => {
                                  const next = [...(data.keys.qa || [])];
                                  next[i] = e.target.value;
                                  update('keys', { ...data.keys, qa: next });
                                }}
                                className="text-sm text-blue-800 italic flex-1"
                                viewMode={viewMode}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleSections.has('writing_critical') && (
                    <div className="bg-blue-50 p-4 border-l-4 border-blue-900 rounded-r avoid-break">
                       <div className="text-[9pt] font-black text-blue-900 uppercase mb-1">D. Critical Thinking Guide</div>
                       <PrintableField
                          value={data.keys.critical}
                          onChange={e => update('keys', { ...data.keys, critical: e.target.value })}
                          className="text-blue-900"
                          viewMode={viewMode}
                        />
                    </div>
                  )}
                </div>
            );
        default: return null;
    }
  }

  return (
    <div className={`paper mx-auto bg-white shadow-sm overflow-hidden ${viewMode === 'editor' ? 'min-h-[29.7cm] max-w-[960px] p-8' : 'max-w-[210mm] p-8 md:p-12'} ${viewMode === 'print-compact' ? 'max-w-[210mm]' : ''}`}>
      {watermarkText && <div className="print-watermark" aria-hidden="true">{watermarkText}</div>}
      <div className="print-corner-mark" aria-hidden="true"></div>
      <div className="relative z-10">
      {/* Header */}
      <div className="worksheet-header mb-8 border-b-2 border-gray-800 pb-5">
          <div className="worksheet-brand">
            <PrintableField
                value={header.brand}
                onChange={(e) => updateHeader({ brand: e.target.value })}
                viewMode={viewMode}
                tagName="div"
                placeholder="OTIA"
             />
          </div>
          <h1 className="worksheet-title text-3xl font-black uppercase tracking-widest text-gray-900 mb-6 text-center">
            <PrintableField
                value={data.title}
                onChange={(e) => update('title', e.target.value)}
                viewMode={viewMode}
                tagName="h1"
                placeholder="Untitled Worksheet"
             />
          </h1>

          <div className="worksheet-meta grid grid-cols-3 gap-6 text-sm font-bold text-gray-600 uppercase tracking-wider items-end">
              <div className="worksheet-field flex items-end gap-2">
                  <span className="shrink-0 whitespace-nowrap inline-flex items-baseline">
                    <HeaderLabelField
                      value={header.nameLabel}
                      onChange={(e) => updateHeader({ nameLabel: e.target.value })}
                      viewMode={viewMode}
                      placeholder="Name"
                    />
                    <span>:</span>
                  </span>
                  <span className="worksheet-field-line block flex-1 border-b-2 border-gray-300 h-5">
                    {settings.teacherName ? (
                      <span className="normal-case tracking-normal text-gray-900">{settings.teacherName}</span>
                    ) : null}
                  </span>
              </div>
              <div className="worksheet-level text-center">
                  <span>Level: {settings.difficulty}</span>
              </div>
              <div className="worksheet-field flex items-end gap-2">
                  <span className="shrink-0 whitespace-nowrap inline-flex items-baseline">
                    <HeaderLabelField
                      value={header.scoreLabel}
                      onChange={(e) => updateHeader({ scoreLabel: e.target.value })}
                      viewMode={viewMode}
                      placeholder="Score"
                    />
                    <span>:</span>
                  </span>
                  <span className="worksheet-field-line block flex-1 border-b-2 border-gray-300 h-5"></span>
              </div>
          </div>
      </div>
      
      {/* Sections */}
      {sectionOrder.map(id => {
         if (!visibleSections.has(id)) return null;
         return (
            <React.Fragment key={id}>
                {renderSection(id)}
            </React.Fragment>
         );
      })}

      {/* Keys */}
      {visibleSections.has('keys') && (
          <div className="mt-12 pt-8 border-t-4 border-double border-gray-300 page-break force-break-key">
              <h2 className="text-2xl font-black uppercase text-center mb-8 text-gray-400">Answer Key</h2>
              {sectionOrder.map(id => renderKeySection(id))}
          </div>
      )}
      
      {/* Interactive Script Injection */}
      {isInteractive && (
           <script dangerouslySetInnerHTML={{ __html: INTERACTIVE_SCRIPT }} />
      )}
      </div>
    </div>
  );
};

export { Toggle };
export default WorksheetPaper;

