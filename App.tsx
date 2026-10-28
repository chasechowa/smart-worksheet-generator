
import React, { useState, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorksheetData, AppSettings, Difficulty, Project, ValidationResult, GenerationOptions, ValidationIssue } from './types';
import { generateAndRefine, regenerateMCQuestion, applyRegeneratedMCQuestion } from './services/aiService';
import { validateWorksheet } from './services/validatorService';
import { createProject, saveProject, getProjects, getProject } from './services/storageService';
import { getActiveConfig } from './services/configService';
import TestPreview, { Toggle } from './components/TestPreview';
import { ConfigPanel } from './components/ConfigPanel';
import { ProjectPanel } from './components/ProjectPanel';
import { ValidationPanel } from './components/ValidationPanel';

type ViewMode = 'editor' | 'print-std' | 'print-compact' | 'interactive' | 'pdf';

const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  summary: true,
  mc: true,
  sentenceInsertion: false,
  syntaxDeconstruction: true,
  writing_expansion: true,
  writing_keywords: true,
  writing_qa: true,
  writing_critical: true,
};

const DEFAULT_SECTION_ORDER = ['summary', 'mc', 'sentenceInsertion', 'syntaxDeconstruction', 'writing'];

function normalizeSummaryParagraph(paragraph: string): string {
  return (paragraph || '').replace(/\[BLANK\d+\]/gi, '[BLANK]');
}

function normalizeWorksheetData(raw: Partial<WorksheetData> | null | undefined): WorksheetData {
  const data = raw || {};
  const keys = data.keys || {} as WorksheetData['keys'];
  const writingWorkshop = data.writingWorkshop || {} as WorksheetData['writingWorkshop'];

  return {
    title: data.title || 'Untitled Worksheet',
    articleSnippet: data.articleSnippet || '',
    header: {
      brand: data.header?.brand || 'OTIA',
      nameLabel: data.header?.nameLabel || 'Name',
      scoreLabel: data.header?.scoreLabel || 'Score',
    },
    summary: {
      paragraph: normalizeSummaryParagraph(data.summary?.paragraph || ''),
      blanks: Array.isArray(data.summary?.blanks) ? data.summary.blanks : [],
    },
    multipleChoice: Array.isArray(data.multipleChoice)
      ? data.multipleChoice.map((q, index) => ({
          ...q,
          id: q.id || `q${index + 1}`,
          type: q.type || 'Literal Comprehension',
          question: q.question || '',
          options: Array.isArray(q.options) ? q.options : [],
          answer: q.answer || '',
          explanation: q.explanation || '',
        }))
      : [],
    syntaxDeconstruction: Array.isArray(data.syntaxDeconstruction)
      ? data.syntaxDeconstruction.map((item, index) => ({
          ...item,
          id: item.id || `s${index + 1}`,
          original: item.original || '',
          answer: item.answer || '',
        }))
      : [],
    // Stays undefined when absent so the insertion validator remains silent.
    sentenceInsertion: Array.isArray(data.sentenceInsertion)
      ? data.sentenceInsertion.map((item, index) => ({
          ...item,
          id: item.id || `si${index + 1}`,
          sentence: item.sentence || '',
          paragraph: item.paragraph || '',
          answer: typeof item.answer === 'number' ? item.answer : Number(item.answer) || 0,
          explanation: item.explanation || '',
        }))
      : undefined,
    writingWorkshop: {
      expansion: Array.isArray(writingWorkshop.expansion) ? writingWorkshop.expansion : [],
      keywords: Array.isArray(writingWorkshop.keywords) ? writingWorkshop.keywords : [],
      qaChain: Array.isArray(writingWorkshop.qaChain) ? writingWorkshop.qaChain : [],
      criticalThinking: writingWorkshop.criticalThinking || '',
    },
    keys: {
      summary: Array.isArray(keys.summary) ? keys.summary : [],
      mc: keys.mc || {},
      sentenceInsertion: keys.sentenceInsertion || {},
      syntaxDeconstruction: Array.isArray(keys.syntaxDeconstruction) ? keys.syntaxDeconstruction : [],
      expansion: Array.isArray(keys.expansion) ? keys.expansion : [],
      qa: Array.isArray(keys.qa) ? keys.qa : [],
      critical: keys.critical || '',
    },
    _meta: data._meta,
  };
}

function normalizeProject(project: Project): Project {
  const worksheets = Array.isArray(project.worksheets)
    ? project.worksheets.map(worksheet => normalizeWorksheetData(worksheet))
    : [];
  const snapshot = project.snapshot || {};

  return {
    ...project,
    kind: project.kind || (worksheets.length > 0 ? 'worksheet' : 'article'),
    articleText: project.articleText || '',
    difficulty: project.difficulty || 'B2',
    worksheets,
    snapshot: {
      ...snapshot,
      visibleSections: Array.isArray(snapshot.visibleSections) ? snapshot.visibleSections : undefined,
      sectionOrder: Array.isArray(snapshot.sectionOrder) ? snapshot.sectionOrder : undefined,
      generationOptions: snapshot.generationOptions || undefined,
    },
  };
}

function hasWorksheetContent(worksheet: WorksheetData): boolean {
  return Boolean(
    worksheet.articleSnippet?.trim() ||
    worksheet.summary?.paragraph?.trim() ||
    worksheet.multipleChoice?.length ||
    worksheet.sentenceInsertion?.length ||
    worksheet.syntaxDeconstruction?.length ||
    worksheet.writingWorkshop?.expansion?.length ||
    worksheet.writingWorkshop?.keywords?.length ||
    worksheet.writingWorkshop?.qaChain?.length ||
    worksheet.writingWorkshop?.criticalThinking?.trim()
  );
}

function hasRenderableWorksheetSections(worksheet: WorksheetData): boolean {
  return Boolean(
    worksheet.summary?.paragraph?.trim() &&
    worksheet.multipleChoice?.length > 0 &&
    worksheet.syntaxDeconstruction?.length > 0 &&
    worksheet.writingWorkshop?.expansion?.length > 0 &&
    worksheet.writingWorkshop?.keywords?.length > 0 &&
    worksheet.writingWorkshop?.qaChain?.length > 0 &&
    worksheet.writingWorkshop?.criticalThinking?.trim()
  );
}

function hasAnyGeneratedSection(options: GenerationOptions): boolean {
  return Object.values(options).some(Boolean);
}

function hasWritingSection(options: GenerationOptions): boolean {
  return options.writing_expansion || options.writing_keywords || options.writing_qa || options.writing_critical;
}

function getVisibleSectionsForGeneration(options: GenerationOptions): Set<string> {
  const next = new Set<string>();
  if (options.summary) next.add('summary');
  if (options.mc) next.add('mc');
  if (options.sentenceInsertion) next.add('sentenceInsertion');
  if (options.syntaxDeconstruction) next.add('syntaxDeconstruction');
  if (hasWritingSection(options)) next.add('writing');
  if (options.writing_expansion) next.add('writing_expansion');
  if (options.writing_keywords) next.add('writing_keywords');
  if (options.writing_qa) next.add('writing_qa');
  if (options.writing_critical) next.add('writing_critical');
  if (next.size > 0) next.add('keys');
  return next;
}

function hasRenderableGeneratedSections(worksheet: WorksheetData, options: GenerationOptions): boolean {
  if (options.summary && !worksheet.summary?.paragraph?.trim()) return false;
  if (options.mc && worksheet.multipleChoice?.length === 0) return false;
  if (options.sentenceInsertion && (worksheet.sentenceInsertion?.length ?? 0) === 0) return false;
  if (options.syntaxDeconstruction && worksheet.syntaxDeconstruction?.length === 0) return false;
  if (options.writing_expansion && worksheet.writingWorkshop?.expansion?.length === 0) return false;
  if (options.writing_keywords && worksheet.writingWorkshop?.keywords?.length === 0) return false;
  if (options.writing_qa && worksheet.writingWorkshop?.qaChain?.length === 0) return false;
  if (options.writing_critical && !worksheet.writingWorkshop?.criticalThinking?.trim()) return false;
  return true;
}

function shouldKeepValidationIssue(issue: ValidationIssue, options: GenerationOptions): boolean {
  if (issue.section === 'global') return true;
  if (issue.section === 'summary') return options.summary;
  if (issue.section === 'mc') return options.mc;
  if (issue.section === 'insertion') return options.sentenceInsertion;
  if (issue.section === 'syntax') return options.syntaxDeconstruction;
  if (issue.section === 'writing') {
    if (/expansion|sentence expansion/i.test(issue.message)) return options.writing_expansion;
    if (/keyword/i.test(issue.message)) return options.writing_keywords;
    if (/q&a|qa chain/i.test(issue.message)) return options.writing_qa;
    if (/critical/i.test(issue.message)) return options.writing_critical;
    return hasWritingSection(options);
  }
  if (issue.section === 'keys') return true;
  return true;
}

function scopeValidationResult(validation: ValidationResult, options: GenerationOptions): ValidationResult {
  const issues = validation.issues.filter(issue => shouldKeepValidationIssue(issue, options));
  const errors = issues.filter(issue => issue.severity === 'error');
  return {
    ...validation,
    valid: errors.length === 0,
    issues,
    data: {
      ...validation.data,
      _meta: validation.data._meta
        ? {
            ...validation.data._meta,
            validated: errors.length === 0,
            validationIssues: issues.map(i => `[${i.severity.toUpperCase()}] ${i.section}: ${i.message}`),
          }
        : validation.data._meta,
    },
  };
}

// --- Styles for Exported HTML ---
const BASE_STYLES = `
  body {
    background: white;
    color: black;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif !important;
    font-size: 11pt !important;
    line-height: 1.5;
  }

  @media print {
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }

    .avoid-break {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    h1, h2, h3, h4, h5 {
      page-break-after: avoid;
      break-after: avoid;
    }

    body, html, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      display: block !important;
    }

    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    body {
      position: relative;
      background: #ffffff !important;
    }

    #root,
    .paper {
      position: relative;
      z-index: 1;
      background: transparent !important;
    }

    .paper::before,
    .paper::after {
      display: none !important;
    }

    .print-watermark {
      bottom: 18mm;
      color: rgba(15, 23, 42, 0.09);
      display: block !important;
      font-size: clamp(34pt, 9vw, 58pt) !important;
      font-weight: 900;
      letter-spacing: 0.12em;
      line-height: 0.86;
      max-width: 92mm;
      pointer-events: none;
      position: fixed;
      right: 12mm;
      text-align: right;
      text-transform: uppercase;
      transform: rotate(-18deg);
      transform-origin: center;
      white-space: normal;
      overflow-wrap: anywhere;
      z-index: 0;
    }

    .print-corner-mark {
      bottom: 9mm;
      display: block !important;
      height: 44mm;
      pointer-events: none;
      position: fixed;
      right: 10mm;
      width: 64mm;
      z-index: 0;
      background:
        linear-gradient(rgba(14, 165, 233, 0.13), rgba(14, 165, 233, 0.13)),
        linear-gradient(rgba(99, 102, 241, 0.10), rgba(99, 102, 241, 0.10)),
        linear-gradient(rgba(15, 23, 42, 0.075), rgba(15, 23, 42, 0.075)),
        linear-gradient(rgba(14, 165, 233, 0.085), rgba(14, 165, 233, 0.085)),
        linear-gradient(rgba(99, 102, 241, 0.075), rgba(99, 102, 241, 0.075)),
        radial-gradient(circle at 70% 70%, rgba(14, 165, 233, 0.12), transparent 34mm);
      background-position: right 2mm bottom 1mm, right 24mm bottom 13mm, right 10mm bottom 24mm, right 45mm bottom 5mm, right 36mm bottom 28mm, right bottom;
      background-repeat: no-repeat;
      background-size: 20mm 20mm, 13mm 13mm, 8mm 8mm, 6mm 24mm, 18mm 6mm, 64mm 44mm;
      opacity: 0.72;
    }

    .section-title {
        background: linear-gradient(90deg, #eef6ff 0%, #f8fbff 58%, #ffffff 100%) !important;
        border: 1px solid #dbeafe;
        border-left: 4px solid #60a5fa;
        border-radius: 0.5rem;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
        padding: 0.5rem 1rem;
        margin-top: 1.5rem;
        margin-bottom: 0.45rem;
    }

    .section-instruction {
        color: #64748b !important;
        font-size: 8.5pt !important;
        line-height: 1.32 !important;
        margin: -0.1rem 0 0.75rem 0.95rem;
        max-width: 92%;
    }

    ::-webkit-scrollbar { display: none; }

    p, div:not(.print-watermark):not(.print-corner-mark), span, li, td {
        font-family: Arial, sans-serif !important;
        font-size: 11pt !important;
    }
  }

  h1 { font-weight: 900; text-transform: uppercase; text-align: center; font-size: 24pt !important; margin-bottom: 1rem; }
  h2 { font-weight: 900; text-transform: uppercase; margin-bottom: 0.5rem; font-size: 14pt !important; }
  .print-watermark,
  .print-corner-mark {
    display: none;
  }
  .paper {
    margin: 0 auto;
    position: relative;
    isolation: isolate;
  }
  .worksheet-header {
    background: linear-gradient(135deg, #f8fafc 0%, #eef6ff 52%, #f7f9ff 100%);
    border-bottom: 2px solid #1f2937;
    border-radius: 10px;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22);
    margin-bottom: 1.25rem;
    padding: 0.8rem 1rem 0.95rem;
  }
  .worksheet-brand {
    color: #111827;
    font-size: 10pt !important;
    font-weight: 900;
    letter-spacing: 0.16em;
    line-height: 1;
    margin-bottom: 0.55rem;
    text-transform: uppercase;
  }
  .worksheet-brand * {
    font-size: inherit !important;
    letter-spacing: inherit;
    line-height: inherit;
  }
  .worksheet-title {
    color: #111827;
    font-size: 18pt !important;
    font-weight: 900;
    letter-spacing: 0.08em;
    line-height: 1.15;
    margin: 0 0 0.85rem 0 !important;
    overflow-wrap: anywhere;
    text-align: center;
    text-transform: uppercase;
  }
  .worksheet-title * {
    font-size: inherit !important;
    font-weight: inherit;
    letter-spacing: inherit;
    line-height: inherit;
  }
  .worksheet-meta {
    align-items: end;
    color: #4b5563;
    display: grid;
    font-size: 10pt !important;
    font-weight: 700;
    gap: 1.5rem;
    grid-template-columns: 1fr auto 1fr;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .worksheet-field {
    align-items: end;
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }
  .worksheet-field > span:first-child,
  .worksheet-level,
  .worksheet-level * {
    font-size: inherit !important;
  }
  .worksheet-field-line {
    border-bottom: 1.5px solid #111827;
    display: inline-block;
    flex: 1 1 auto;
    height: 1rem;
    min-width: 8rem;
  }
  .worksheet-level {
    text-align: center;
    white-space: nowrap;
  }
  .summary-blank {
    border-bottom: 2px solid #111827;
    display: inline-block;
    font-weight: 700;
    line-height: 1.1;
    margin: 0 0.25rem;
    min-width: 7rem;
    padding: 0 0.35rem 0.1rem;
    text-align: center;
    white-space: nowrap;
  }
  .summary-blank::before {
    content: "(" attr(data-index) ")";
    color: #111827;
  }
  .insertion-marker {
    display: inline-block;
    font-weight: 900;
    font-size: 9pt;
    line-height: 1.3;
    color: #1d4ed8;
    border: 1px solid #93c5fd;
    background: #eff6ff;
    border-radius: 3px;
    padding: 0 4px;
    margin: 0 2px;
    white-space: nowrap;
  }
  .insertion-marker::before { content: "["; }
  .insertion-marker::after { content: "]"; }

  .interactive-input { border: 1px solid #ccc; border-radius: 4px; padding: 2px 5px; background: #f9fafb; font-family: monospace; }
  .interactive-input:focus { outline: 2px solid #3b82f6; background: white; }
  .interactive-input.correct { background-color: #dcfce7; border-color: #22c55e; color: #15803d; font-weight: bold; }

  .interactive-opt { cursor: pointer; transition: all 0.2s; border: 1px solid transparent; }
  .interactive-opt:hover { background-color: #f3f4f6; }
  .interactive-opt.selected-correct { background-color: #dcfce7 !important; border-color: #22c55e; }
  .interactive-opt.selected-wrong { background-color: #fee2e2 !important; border-color: #ef4444; }

  .section-title {
    background: linear-gradient(90deg, #eef6ff 0%, #f8fbff 58%, #ffffff 100%);
    border: 1px solid #dbeafe;
    border-left: 4px solid #60a5fa;
    border-radius: 8px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
    padding: 8px 12px;
    margin-top: 24px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-instruction {
    color: #64748b;
    font-size: 9pt !important;
    line-height: 1.35;
    margin: -4px 0 14px 14px;
    max-width: 92%;
  }
`;

const PREVIEW_WORKSHEET_STYLES = `
  .worksheet-preview-scope .print-watermark,
  .worksheet-preview-scope .print-corner-mark {
    display: none;
  }
  .worksheet-preview-scope.preview-export {
    --line-height: 2rem;
    color: black;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif !important;
    font-size: 11pt !important;
    line-height: 1.5;
  }
  .worksheet-preview-scope.preview-compact {
    --line-height: 1.6rem;
  }
  .worksheet-preview-scope.preview-export h1 {
    font-weight: 900;
    text-transform: uppercase;
    text-align: center;
    font-size: 24pt !important;
    margin-bottom: 1rem;
  }
  .worksheet-preview-scope.preview-export h2 {
    font-weight: 900;
    text-transform: uppercase;
    margin-bottom: 0.5rem;
    font-size: 14pt !important;
  }
  .worksheet-preview-scope.preview-export .paper {
    max-width: 210mm;
    padding: 6mm 8mm 8mm;
    position: relative;
    isolation: isolate;
  }
  .worksheet-preview-scope.preview-export .writing-line {
    border-bottom: 1px solid #000;
    height: var(--line-height);
    margin-bottom: 0.1rem;
    width: 100%;
    display: block;
  }
  .worksheet-preview-scope.preview-compact .writing-line {
    margin-bottom: 0;
  }
  .worksheet-preview-scope.preview-export .section-gap {
    margin-bottom: 1.5rem;
  }
  .worksheet-preview-scope.preview-compact .section-gap {
    margin-bottom: 1rem;
  }
  .worksheet-preview-scope.preview-export .worksheet-header {
    background: linear-gradient(135deg, #f8fafc 0%, #eef6ff 52%, #f7f9ff 100%);
    border-bottom: 2px solid #1f2937;
    border-radius: 10px;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22);
    margin-bottom: 1.25rem;
    padding: 0.8rem 1rem 0.95rem;
  }
  .worksheet-preview-scope.preview-export .worksheet-brand {
    color: #111827;
    font-size: 10pt !important;
    font-weight: 900;
    letter-spacing: 0.16em;
    line-height: 1;
    margin-bottom: 0.55rem;
    text-transform: uppercase;
  }
  .worksheet-preview-scope.preview-export .worksheet-brand * {
    font-size: inherit !important;
    letter-spacing: inherit;
    line-height: inherit;
  }
  .worksheet-preview-scope.preview-export .worksheet-title {
    color: #111827;
    font-size: 18pt !important;
    font-weight: 900;
    letter-spacing: 0.08em;
    line-height: 1.15;
    margin: 0 0 0.85rem 0 !important;
    overflow-wrap: anywhere;
    text-align: center;
    text-transform: uppercase;
  }
  .worksheet-preview-scope.preview-export .worksheet-title * {
    font-size: inherit !important;
    font-weight: inherit;
    letter-spacing: inherit;
    line-height: inherit;
  }
  .worksheet-preview-scope.preview-export .worksheet-meta {
    align-items: end;
    color: #4b5563;
    display: grid;
    font-size: 10pt !important;
    font-weight: 700;
    gap: 1.5rem;
    grid-template-columns: 1fr auto 1fr;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .worksheet-preview-scope.preview-export .worksheet-field {
    align-items: end;
    display: flex;
    gap: 0.5rem;
    min-width: 0;
  }
  .worksheet-preview-scope.preview-export .worksheet-field > span:first-child,
  .worksheet-preview-scope.preview-export .worksheet-level,
  .worksheet-preview-scope.preview-export .worksheet-level * {
    font-size: inherit !important;
  }
  .worksheet-preview-scope.preview-export .worksheet-field-line {
    border-bottom: 1.5px solid #111827;
    display: inline-block;
    flex: 1 1 auto;
    height: 1rem;
    min-width: 8rem;
  }
  .worksheet-preview-scope.preview-export .worksheet-level {
    text-align: center;
    white-space: nowrap;
  }
  .worksheet-preview-scope.preview-export .summary-blank {
    border-bottom: 2px solid #111827;
    display: inline-block;
    font-weight: 700;
    line-height: 1.1;
    margin: 0 0.25rem;
    min-width: 7rem;
    padding: 0 0.35rem 0.1rem;
    text-align: center;
    white-space: nowrap;
  }
  .worksheet-preview-scope.preview-export .summary-blank::before {
    content: "(" attr(data-index) ")";
    color: #111827;
  }
  .worksheet-preview-scope.preview-export .insertion-marker {
    display: inline-block;
    font-weight: 900;
    font-size: 9pt;
    line-height: 1.3;
    color: #1d4ed8;
    border: 1px solid #93c5fd;
    background: #eff6ff;
    border-radius: 3px;
    padding: 0 4px;
    margin: 0 2px;
    white-space: nowrap;
  }
  .worksheet-preview-scope.preview-export .insertion-marker::before { content: "["; }
  .worksheet-preview-scope.preview-export .insertion-marker::after { content: "]"; }
  .worksheet-preview-scope.preview-export .section-title {
    background: linear-gradient(90deg, #eef6ff 0%, #f8fbff 58%, #ffffff 100%);
    border: 1px solid #dbeafe;
    border-left: 4px solid #60a5fa;
    border-radius: 8px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
    padding: 8px 12px;
    margin-top: 24px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .worksheet-preview-scope.preview-export .section-instruction {
    color: #64748b;
    font-size: 9pt !important;
    line-height: 1.35;
    margin: -2px 0 12px 14px;
    max-width: 92%;
  }
  .worksheet-preview-scope.preview-export .print-watermark {
    bottom: 18mm;
    color: rgba(15, 23, 42, 0.09);
    display: block !important;
    font-size: clamp(34pt, 9vw, 58pt) !important;
    font-weight: 900;
    letter-spacing: 0.12em;
    line-height: 0.86;
    max-width: 92mm;
    pointer-events: none;
    position: absolute;
    right: 12mm;
    text-align: right;
    text-transform: uppercase;
    transform: rotate(-18deg);
    transform-origin: center;
    white-space: normal;
    overflow-wrap: anywhere;
    z-index: 0;
  }
  .worksheet-preview-scope.preview-export .print-corner-mark {
    bottom: 9mm;
    display: block !important;
    height: 44mm;
    pointer-events: none;
    position: absolute;
    right: 10mm;
    width: 64mm;
    z-index: 0;
    background:
      linear-gradient(rgba(14, 165, 233, 0.13), rgba(14, 165, 233, 0.13)),
      linear-gradient(rgba(99, 102, 241, 0.10), rgba(99, 102, 241, 0.10)),
      linear-gradient(rgba(15, 23, 42, 0.075), rgba(15, 23, 42, 0.075)),
      linear-gradient(rgba(14, 165, 233, 0.085), rgba(14, 165, 233, 0.085)),
      linear-gradient(rgba(99, 102, 241, 0.075), rgba(99, 102, 241, 0.075)),
      radial-gradient(circle at 70% 70%, rgba(14, 165, 233, 0.12), transparent 34mm);
    background-position: right 2mm bottom 1mm, right 24mm bottom 13mm, right 10mm bottom 24mm, right 45mm bottom 5mm, right 36mm bottom 28mm, right bottom;
    background-repeat: no-repeat;
    background-size: 20mm 20mm, 13mm 13mm, 8mm 8mm, 6mm 24mm, 18mm 6mm, 64mm 44mm;
    opacity: 0.72;
  }
`;

const STD_STYLES = `
  :root { --line-height: 2rem; }
  @page { margin: 8mm; size: A4; }
  .writing-line { border-bottom: 1px solid #000; height: var(--line-height); margin-bottom: 0.1rem; width: 100%; display: block; }
  .paper { max-width: 210mm; padding: 6mm 8mm 8mm; }
  .section-gap { margin-bottom: 1.5rem; }
`;

const COMPACT_STYLES = `
  :root { --line-height: 1.6rem; }
  @page { margin: 8mm; size: A4; }
  .writing-line { border-bottom: 1px solid #000; height: var(--line-height); margin-bottom: 0px; width: 100%; display: block; }
  .paper { max-width: 210mm; padding: 6mm 8mm 8mm; }
  .section-gap { margin-bottom: 1rem; }

  @media print {
    .page-break { page-break-before: auto !important; margin-top: 2rem; border-top: 1px dashed #ccc; padding-top: 1rem; }
    .force-break-key { page-break-before: always !important; }
  }
`;

// === PDF Export: minimal overrides, keep identical to HTML print layout ===
// HTML export already prints perfectly to 4 pages in browser; the PDF button
// opens this standalone doc in a new window and triggers the browser print dialog.
const PDF_STYLES = `
  /* === PDF-only break control ( everything else comes from @media print ) === */
  .avoid-break {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .force-break-key {
    page-break-before: always !important;
    break-before: always !important;
  }
  .page-break {
    page-break-before: always !important;
  }
  h1, h2, h3, h4, h5 {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
`;

export default function App() {
  const [article, setArticle] = useState('');
  const [settings, setSettings] = useState<AppSettings>({
    aiConfig: {
      provider: 'deepseek',
      apiKey: '',
      model: 'deepseek-v4-pro',
      enabled: false,
    },
    difficulty: 'B2',
    teacherName: '',
    watermarkText: 'OTIA',
    showKeys: true
  });
  const [data, setData] = useState<WorksheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Generating...');
  const [error, setError] = useState<string | null>(null);
  const [refinementSummary, setRefinementSummary] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configEverSaved, setConfigEverSaved] = useState(false);

  // Auto-open config on first visit if no API key
  useEffect(() => {
    const config = getActiveConfig();
    if (!config || !config.apiKey) {
      setShowConfig(true);
    } else {
      setConfigEverSaved(true);
    }
  }, []);
  const [viewMode, setViewMode] = useState<ViewMode>('editor');

  const [sectionOrder, setSectionOrder] = useState<string[]>(DEFAULT_SECTION_ORDER);

  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set([
      ...DEFAULT_SECTION_ORDER,
      'writing_expansion',
      'writing_keywords',
      'writing_qa',
      'writing_critical',
      'keys'
  ]));
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>(DEFAULT_GENERATION_OPTIONS);

  // Project state
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [regeneratingQuestionId, setRegeneratingQuestionId] = useState<string | null>(null);
  const [regeneratedNotice, setRegeneratedNotice] = useState<{ id: string; previousData: WorksheetData } | null>(null);

  const getProjectTitleSeed = () => {
    const fromData = data?.title?.trim();
    const fromArticle = article.trim().split(/\n+/)[0]?.replace(/\s+/g, ' ').slice(0, 80);
    return fromData || fromArticle || 'Saved Worksheet';
  };

  const buildProjectSnapshot = (): Project['snapshot'] => ({
    settings: {
      difficulty: settings.difficulty,
      teacherName: settings.teacherName,
      watermarkText: settings.watermarkText,
      showKeys: settings.showKeys,
    },
    visibleSections: Array.from(visibleSections),
    sectionOrder,
    generationOptions,
  });

  const applyProjectSnapshot = (project: Project) => {
    const snapshot = project.snapshot;
    setSettings(prev => ({
      ...prev,
      difficulty: snapshot?.settings?.difficulty || project.difficulty || prev.difficulty,
      teacherName: snapshot?.settings?.teacherName ?? prev.teacherName,
      watermarkText: snapshot?.settings?.watermarkText ?? prev.watermarkText,
      showKeys: snapshot?.settings?.showKeys ?? prev.showKeys,
    }));
    if (snapshot?.visibleSections?.length) {
      setVisibleSections(new Set(snapshot.visibleSections));
    }
    if (snapshot?.sectionOrder?.length) {
      // Merge so projects saved before a section existed still get its row.
      setSectionOrder(Array.from(new Set([...snapshot.sectionOrder, ...DEFAULT_SECTION_ORDER])));
    }
    if (snapshot?.generationOptions) {
      setGenerationOptions({ ...DEFAULT_GENERATION_OPTIONS, ...snapshot.generationOptions });
    }
  };

  useEffect(() => {
    getProjects()
      .then(async list => {
        if (article.trim() || list.length === 0) return;
        const latest = await getProject(list[0].id);
        const normalized = normalizeProject(latest);
        setCurrentProject(normalized);
        setArticle(normalized.articleText || '');
        applyProjectSnapshot(normalized);
      })
      .catch(() => {});
  }, []);

  // Auto-save project when data changes
  useEffect(() => {
    if (!currentProject || !data) return;
    if (!hasWorksheetContent(data)) return;

    const updatedProject: Project = {
      ...currentProject,
      kind: 'worksheet',
      articleText: article,
      difficulty: settings.difficulty,
      worksheets: [data],
      snapshot: buildProjectSnapshot(),
      updatedAt: Date.now(),
    };

    const hasContentChange =
      updatedProject.articleText !== currentProject.articleText ||
      updatedProject.difficulty !== currentProject.difficulty ||
      JSON.stringify(updatedProject.worksheets) !== JSON.stringify(currentProject.worksheets);

    if (!hasContentChange) return;

    setCurrentProject(updatedProject);
    saveProject(updatedProject)
      .then(saved => setCurrentProject(normalizeProject(saved)))
      .catch(err => setError(err?.message || 'Local save failed.'));
  }, [data, currentProject, article, settings.difficulty]);

  // Cache compiled Tailwind CSS for self-contained HTML export (no CDN dependency)
  const exportTailwindCSS = useRef<string>('');

  useEffect(() => {
    fetch(`/export-tailwind.css?v=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.text())
      .then(css => { exportTailwindCSS.current = css; })
      .catch(() => console.warn('export-tailwind.css not found, export will use base styles only'));
  }, []);

  const handleGenerate = async () => {
    if (!article.trim()) {
      setError('Paste an article before generating a worksheet.');
      return;
    }
    if (!hasAnyGeneratedSection(generationOptions)) {
      setError('Select at least one worksheet section to generate.');
      return;
    }

    const wordCount = article.trim().split(/\s+/).length;
    if (wordCount > 3000) {
      setError(`Article is ${wordCount} words — too long for reliable generation. Please trim to under 3000 words.`);
      return;
    }

    const config = getActiveConfig();
    if (!config || !config.apiKey) {
      setShowConfig(true);
      return;
    }

    setLoading(true);
    setLoadingMessage('Generating...');
    setError(null);
    setRefinementSummary(null);
    setValidationResult(null);

    try {
      // Generate + auto-refine
      const { data: rawData, rounds, reports } = await generateAndRefine(
        article,
        settings.difficulty,
        (round, _data, report) => {
          const total = report.fixedIssues.length + report.remainingIssues.length;
          setLoadingMessage(`Refining (round ${round}) — fixed ${report.fixedIssues.length}, ${report.remainingIssues.length} remaining...`);
        },
        message => setLoadingMessage(message),
        generationOptions,
      );

      // Run generated data through the same safety normalizer used for saved projects.
      // Faster models can occasionally omit nested arrays; validation should report that,
      // not let preview rendering crash the page.
      const normalizedRawData = normalizeWorksheetData(rawData);
      const validation = scopeValidationResult(
        validateWorksheet(normalizedRawData, article, settings.difficulty),
        generationOptions,
      );
      const errors = validation.issues.filter(i => i.severity === 'error');
      const warnings = validation.issues.filter(i => i.severity === 'warning');
      const finalData = validation.data;

      // Show refinement summary from structured reports
      if (rounds > 0) {
        const totalFixed = reports.reduce((sum, r) => sum + r.fixedIssues.length, 0);
        const lastReport = reports[reports.length - 1];
        const remaining = lastReport?.remainingIssues.length ?? 0;
        const introduced = lastReport?.introducedIssues.length ?? 0;

        if (lastReport?.checklistPassed && remaining === 0) {
          setRefinementSummary(`Auto-refined in ${rounds} round(s) — all ${totalFixed} issue(s) fixed. Worksheet is clean.`);
        } else if (remaining > 0 && introduced === 0) {
          setRefinementSummary(`Auto-refined in ${rounds} round(s) — fixed ${totalFixed}, ${remaining} minor issue(s) remain (see below).`);
        } else if (introduced > 0) {
          setRefinementSummary(`Auto-refined in ${rounds} round(s) — fixed ${totalFixed}, but ${introduced} new issue(s) introduced.`);
        } else {
          setRefinementSummary(`Auto-refined in ${rounds} round(s) — ${totalFixed} issue(s) addressed.`);
        }
      }

      if (!hasRenderableGeneratedSections(finalData, generationOptions)) {
        setValidationResult({ ...validation, data: finalData });
        setError('Generation returned an incomplete worksheet with missing sections. Please retry.');
        return;
      }

      const generatedVisibleSections = getVisibleSectionsForGeneration(generationOptions);
      setVisibleSections(generatedVisibleSections);
      setData(finalData);
      setValidationResult(validation.issues.length > 0 ? { ...validation, data: finalData } : null);

      // Create or update project
      if (!currentProject) {
        const newProject = createProject(
          finalData.title || 'Untitled Project',
          article,
          settings.difficulty
        );
        newProject.kind = 'worksheet';
        newProject.worksheets = [finalData];
        newProject.snapshot = {
          ...buildProjectSnapshot(),
          visibleSections: Array.from(generatedVisibleSections),
        };
        const savedProject = await saveProject(newProject);
        setCurrentProject(normalizeProject(savedProject));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate');
    } finally {
      setLoading(false);
      setLoadingMessage('Generating...');
    }
  };

  const handleRetryValidation = async () => {
    if (!article) return;
    setLoading(true);
    setLoadingMessage('Regenerating...');
    try {
      const { data: rawData } = await generateAndRefine(
        article,
        settings.difficulty,
        (round, _data, report) => {
          setLoadingMessage(`Refining (round ${round}) — ${report.fixedIssues.length} fixed, ${report.remainingIssues.length} remaining...`);
        },
        message => setLoadingMessage(message),
        generationOptions,
      );
      const normalizedRawData = normalizeWorksheetData(rawData);
      const validation = scopeValidationResult(
        validateWorksheet(normalizedRawData, article, settings.difficulty),
        generationOptions,
      );
      setValidationResult(validation);
      const errors = validation.issues.filter(i => i.severity === 'error');
      if (!hasRenderableGeneratedSections(validation.data, generationOptions)) {
        setError('Regeneration returned an incomplete worksheet with missing sections. Please retry.');
        return;
      }
      setVisibleSections(getVisibleSectionsForGeneration(generationOptions));
      setData(validation.data);
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate');
    } finally {
      setLoading(false);
      setLoadingMessage('Generating...');
    }
  };

  const handleForceUse = () => {
    if (validationResult?.data) {
      setData(validationResult.data);
      setValidationResult(null);
    }
  };

  const handleRegenerateQuestion = async (questionId: string) => {
    if (!data || regeneratingQuestionId) return;
    const current = data.multipleChoice?.find(question => question.id === questionId);
    if (!current) return;

    setRegeneratingQuestionId(questionId);
    setError(null);
    setRefinementSummary(null);
    const previousData = data;

    try {
      const regenerated = await regenerateMCQuestion(
        article,
        settings.difficulty,
        questionId,
        data.multipleChoice,
        message => setLoadingMessage(message),
      );
      const nextData: WorksheetData = {
        ...data,
        multipleChoice: applyRegeneratedMCQuestion(data.multipleChoice, regenerated, settings.difficulty),
        keys: { ...data.keys, mc: { ...data.keys.mc, [questionId]: regenerated.answer } },
      };
      const validation = scopeValidationResult(
        validateWorksheet(nextData, article, settings.difficulty, { fixAnswerDistribution: false }),
        generationOptions,
      );
      setData(validation.data);
      setValidationResult(validation.issues.length > 0 ? { ...validation, data: validation.data } : null);
      setRegeneratedNotice({ id: questionId, previousData });
    } catch (err: any) {
      setError(err?.message || `Failed to regenerate ${questionId}`);
    } finally {
      setRegeneratingQuestionId(null);
      setLoadingMessage('Generating...');
    }
  };

  const handleUndoRegeneration = () => {
    if (!regeneratedNotice) return;
    setData(regeneratedNotice.previousData);
    setValidationResult(null);
    setRegeneratedNotice(null);
  };

  const handleLoadProject = (project: Project) => {
    const normalizedProject = normalizeProject(project);
    setCurrentProject(normalizedProject);
    setArticle(normalizedProject.articleText);
    applyProjectSnapshot(normalizedProject);
    const renderableWorksheets = normalizedProject.worksheets.filter(hasWorksheetContent);
    if (renderableWorksheets.length > 0) {
      const latest = renderableWorksheets[renderableWorksheets.length - 1];
      setData(latest);
    } else {
      setData(null);
    }
    setValidationResult(null);
  };

  const handleReset = () => {
    setData(null);
    setValidationResult(null);
    setViewMode('editor');
  };

  const handleSaveCurrent = async () => {
    if (!article.trim() && !data) {
      setError('Nothing to save yet. Add article text or generate a worksheet first.');
      return;
    }
    const shouldUpdateCurrentWorksheet = currentProject?.kind === 'worksheet';
    const baseProject = shouldUpdateCurrentWorksheet
      ? currentProject
      : createProject(getProjectTitleSeed(), article, settings.difficulty);
    const updated: Project = {
      ...baseProject,
      kind: data ? 'worksheet' : 'article',
      title: baseProject.title || getProjectTitleSeed(),
      articleText: article,
      difficulty: settings.difficulty,
      worksheets: data ? [data] : [],
      snapshot: buildProjectSnapshot(),
      updatedAt: Date.now(),
    };
    try {
      const saved = await saveProject(updated);
      setCurrentProject(normalizeProject(saved));
      setError(null);
      setRefinementSummary('Current worksheet saved locally.');
    } catch (err: any) {
      setError(err?.message || 'Local save failed.');
    }
  };

  const handleSaveArticle = async () => {
    if (!article.trim()) return;
    const project = currentProject?.kind === 'article'
      ? {
          ...currentProject,
          kind: 'article' as const,
          title: currentProject.title || getProjectTitleSeed() || 'Saved Article',
          articleText: article,
          difficulty: settings.difficulty,
          worksheets: [],
          snapshot: buildProjectSnapshot(),
          updatedAt: Date.now(),
        }
      : {
          ...createProject(getProjectTitleSeed() || 'Saved Article', article, settings.difficulty),
          kind: 'article' as const,
          worksheets: [],
          snapshot: buildProjectSnapshot(),
        };

    try {
      const saved = await saveProject(project);
      setCurrentProject(normalizeProject(saved));
      setError(null);
      setRefinementSummary('Article saved locally. It will auto-load next time.');
    } catch (err: any) {
      setError(err?.message || 'Local save failed.');
    }
  };

  const setGenerationOption = (key: keyof GenerationOptions, value: boolean) => {
    setGenerationOptions(prev => ({ ...prev, [key]: value }));
  };

  const toggleSection = (id: string) => {
    const next = new Set(visibleSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisibleSections(next);
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...sectionOrder];
    if (direction === 'up' && index > 0) {
      [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
    } else if (direction === 'down' && index < newOrder.length - 1) {
       [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    }
    setSectionOrder(newOrder);
  };

  const getSectionLabel = (id: string) => {
    switch(id) {
        case 'summary': return 'Summary Completion';
        case 'mc': return 'Multiple Choice';
        case 'sentenceInsertion': return 'Sentence Insertion';
        case 'syntaxDeconstruction': return 'Syntax Deconstruction';
        case 'writing': return 'Writing Workshop';
        case 'keys': return 'Answer Key';
        default: return id;
    }
  };

  const renderGenerateCheckbox = (key: keyof GenerationOptions, label: string, description?: string) => (
    <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={generationOptions[key]}
        onChange={e => setGenerationOption(key, e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-gray-800">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-gray-400 mt-0.5">{description}</span>}
      </span>
    </label>
  );

  const renderGenerationSelector = (isCompact: boolean) => (
    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <label className="text-xs font-bold uppercase text-gray-400 block tracking-wide">Generate Sections</label>
          <p className="text-[11px] text-gray-400 mt-0.5">Only checked parts call the API and appear in preview.</p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setGenerationOptions({ ...DEFAULT_GENERATION_OPTIONS, sentenceInsertion: true })}
            className="text-[10px] font-bold px-2 py-1 rounded bg-white border border-gray-200 text-gray-500 hover:text-indigo-600"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setGenerationOptions({ ...DEFAULT_GENERATION_OPTIONS, writing_expansion: false, writing_keywords: false, writing_qa: false, writing_critical: false })}
            className="text-[10px] font-bold px-2 py-1 rounded bg-white border border-gray-200 text-gray-500 hover:text-indigo-600"
          >
            Core
          </button>
        </div>
      </div>
      <div className={`grid gap-2 ${isCompact ? 'grid-cols-1' : 'md:grid-cols-3'}`}>
        {renderGenerateCheckbox('summary', 'Summary Completion', '5 blanks + answer key')}
        {renderGenerateCheckbox('mc', 'Logical Analysis', '10 MC questions, generated in parallel')}
        {renderGenerateCheckbox('sentenceInsertion', 'Sentence Insertion', '2 TOEFL-style items — extra sentence + 4 inline positions')}
        {renderGenerateCheckbox('syntaxDeconstruction', 'Syntax Deconstruction', '2 grammar breakdowns')}
      </div>
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-[11px] font-black uppercase tracking-wide text-gray-400 mb-2">Writing Workshop</div>
        <div className={`grid gap-2 ${isCompact ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
          {renderGenerateCheckbox('writing_expansion', 'A. Sentence Expansion')}
          {renderGenerateCheckbox('writing_keywords', 'B. Keyword Paragraph')}
          {renderGenerateCheckbox('writing_qa', 'C. Q&A Chain')}
          {renderGenerateCheckbox('writing_critical', 'D. Critical Perspective')}
        </div>
      </div>
    </div>
  );

  const buildExportHTML = (forPdf: boolean) => {
    if (!data) return '';
    // PDF uses dedicated 'pdf' view mode for ultra-compact layout
    const exportViewMode = forPdf ? 'pdf' : viewMode;
    const element = (
      <html>
        <head>
          <meta charSet="utf-8" />
          <title>{data.title}</title>
          <style>{exportTailwindCSS.current}</style>
          <style>{BASE_STYLES}</style>
          <style>{exportViewMode === 'print-compact' ? COMPACT_STYLES : STD_STYLES}</style>
          {forPdf && <style>{PDF_STYLES}</style>}
        </head>
        <body>
            <div id="root">
                 <TestPreview
                    data={data}
                    settings={settings}
                    visibleSections={visibleSections}
                    sectionOrder={sectionOrder}
                    viewMode={exportViewMode}
                 />
            </div>
        </body>
      </html>
    );
    return "<!DOCTYPE html>" + renderToStaticMarkup(element);
  };

  const handleExportHTML = () => {
    const html = buildExportHTML(false);
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data!.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    a.click();
  };

  const handleExportPDF = () => {
    const html = buildExportHTML(true);
    if (!html) return;
    const win = window.open('', '_blank');
    if (!win) {
      alert('Popup blocked. Please allow popups to export the PDF.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // Give the injected stylesheet a tick to apply before opening the print dialog.
    setTimeout(() => win.print(), 120);
  };

  // Shared input controls used in both home and sidebar layouts
  const renderInputCore = (isCompact: boolean, showProjects = true, showConfigButton = true) => (
    <div className={`space-y-6 ${isCompact ? '' : 'w-full'}`}>
      {!isCompact && (
        <div className="mb-6">
          <h1 className="text-4xl xl:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 uppercase tracking-[0.12em] mb-3">
            Smart Worksheet
          </h1>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold tracking-[0.25em] text-indigo-400 uppercase bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">OTIA EXCLUSIVE</span>
            <div className="h-px flex-1 bg-gradient-to-r from-indigo-200 to-transparent"></div>
          </div>
          <p className="text-gray-400 text-sm font-medium">AI-Powered Reading Comprehension Worksheet Generator</p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <label className="text-xs font-bold uppercase text-gray-400 block tracking-wide">Article Text</label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">{article.trim() ? `${article.trim().split(/\s+/).length} words` : 'No article loaded'}</span>
            <button
              type="button"
              onClick={handleSaveArticle}
              disabled={!article.trim()}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-40"
            >
              Save Article
            </button>
          </div>
        </div>
        <textarea
          value={article}
          onChange={e => setArticle(e.target.value)}
          className={`w-full border border-gray-200 rounded-xl p-4 text-sm leading-relaxed focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none resize-none transition-shadow bg-white/90 placeholder-gray-300 ${isCompact ? 'h-32' : 'h-[300px] xl:h-[380px]'}`}
          placeholder="Paste article content here..."
        />
      </div>

      <div className={isCompact ? 'space-y-3' : 'flex gap-4'}>
        <div className={isCompact ? '' : 'flex-1'}>
          <label className="text-xs font-bold uppercase text-gray-400 block mb-2 tracking-wide">Level</label>
          <select
            value={settings.difficulty}
            onChange={e => setSettings({...settings, difficulty: e.target.value as Difficulty})}
            className="w-full border border-gray-200 rounded-xl p-2.5 text-sm bg-white/90 focus:ring-2 focus:ring-indigo-400 outline-none transition-shadow"
          >
            <option value="A2">A2 (Elementary)</option>
            <option value="B1">B1 (Intermediate)</option>
            <option value="B2">B2 (Upper Intermediate)</option>
            <option value="C1">C1 (Advanced)</option>
          </select>
        </div>

        {!isCompact && (
          <div className="flex-1">
            <label className="text-xs font-bold uppercase text-gray-400 block mb-2 tracking-wide">Instructor</label>
            <input
              value={settings.teacherName}
              onChange={e => setSettings({...settings, teacherName: e.target.value})}
              placeholder="Name (optional)"
              className="w-full border border-gray-200 rounded-xl p-2.5 text-sm bg-white/90 focus:ring-2 focus:ring-indigo-400 outline-none transition-shadow placeholder-gray-300"
            />
          </div>
        )}
      </div>

      {!isCompact && (
        <div>
          <label className="text-xs font-bold uppercase text-gray-400 block mb-2 tracking-wide">Watermark</label>
          <input
            value={settings.watermarkText}
            onChange={e => setSettings({...settings, watermarkText: e.target.value})}
            placeholder="OTIA"
            className="w-full border border-gray-200 rounded-xl p-2.5 text-sm bg-white/90 focus:ring-2 focus:ring-indigo-400 outline-none transition-shadow placeholder-gray-300"
          />
        </div>
      )}

      {renderGenerationSelector(isCompact)}

      {showConfigButton && (
        <button
          onClick={() => setShowConfig(true)}
          className="w-full py-2.5 rounded-xl font-bold text-xs text-gray-500 hover:text-indigo-600 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 transition-all flex items-center justify-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          AI Configuration
        </button>
      )}

      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowConfig(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b">
              <span className="text-sm font-bold">AI Configuration</span>
              <button onClick={() => setShowConfig(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="p-3">
              <ConfigPanel embedded onSaved={() => { setShowConfig(false); setConfigEverSaved(true); }} />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading || !article || !hasAnyGeneratedSection(generationOptions)}
        className={`w-full py-3.5 rounded-xl font-bold text-white shadow-lg transition-all text-lg tracking-wide ${
          loading
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 hover:from-indigo-700 hover:via-blue-700 hover:to-cyan-700 shadow-indigo-500/25 hover:shadow-indigo-500/40 active:scale-[0.98]'
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {loadingMessage}
          </span>
        ) : 'Generate Worksheet'}
      </button>

      {error && <div className="text-red-600 text-xs bg-red-50 p-2 rounded border border-red-200">{error}</div>}

      {refinementSummary && !error && (
        <div className={`text-xs p-2 rounded border flex items-center gap-2 ${refinementSummary.includes('clean') ? 'bg-green-50 border-green-200 text-green-700' : refinementSummary.includes('minor') ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{refinementSummary.includes('clean') ? '✓' : '◉'}</span>
          {refinementSummary}
        </div>
      )}

      {regeneratedNotice && !error && (
        <div className="text-xs p-2 rounded border bg-indigo-50 border-indigo-200 text-indigo-800 flex items-center justify-between gap-2">
          <span>Question {regeneratedNotice.id.replace(/^q/i, '')} regenerated with the same skill target.</span>
          <button onClick={handleUndoRegeneration} className="font-bold underline hover:text-indigo-600">Undo</button>
        </div>
      )}

      <ValidationPanel
        result={validationResult}
        onRetry={handleRetryValidation}
        onForceUse={handleForceUse}
      />

      {showProjects && (
        <ProjectPanel
          currentProject={currentProject}
          onLoadProject={handleLoadProject}
          onSaveCurrent={handleSaveCurrent}
        />
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <style>{`
        ${PREVIEW_WORKSHEET_STYLES}
        @media print {
          ${viewMode === 'print-compact' ? COMPACT_STYLES : STD_STYLES}
          .no-print { display: none !important; }
        }
      `}</style>

      {!data ? (
        // === WIDE WORKSPACE LAYOUT (before generation) ===
        <div className="min-h-screen p-5 xl:p-8 no-print bg-gradient-to-br from-slate-50 via-white to-indigo-50">
          <div className="mx-auto w-full max-w-[1500px]">
            <div className="grid gap-5 xl:gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
              <section className="min-w-0 bg-white/85 backdrop-blur-sm rounded-2xl shadow-xl shadow-indigo-500/5 border border-indigo-100/50 p-6 xl:p-8">
                {renderInputCore(false, false, false)}
              </section>

              <aside className="space-y-5">
                <div className="bg-white/85 backdrop-blur-sm rounded-2xl shadow-lg shadow-indigo-500/5 border border-indigo-100/50 p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <label className="text-xs font-bold uppercase text-gray-400 block tracking-wide">Workspace</label>
                      <p className="text-sm font-bold text-gray-700 mt-1">Online version</p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">LIVE</span>
                  </div>
                  <button
                    onClick={() => setShowConfig(true)}
                    className="w-full py-2.5 rounded-xl font-bold text-xs text-gray-500 hover:text-indigo-600 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 transition-all flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    AI Configuration
                  </button>
                </div>

                <div className="bg-white/85 backdrop-blur-sm rounded-2xl shadow-lg shadow-indigo-500/5 border border-indigo-100/50 p-5">
                  <ProjectPanel
                    currentProject={currentProject}
                    onLoadProject={handleLoadProject}
                    onSaveCurrent={handleSaveCurrent}
                  />
                </div>
              </aside>
            </div>
          </div>
          <p className="mt-6 text-center text-[11px] text-gray-300 font-medium tracking-wider uppercase">CHASECCC</p>
        </div>
      ) : (
        // === SPLIT SIDEBAR LAYOUT (after generation) ===
        <>
          {/* Sidebar */}
          <div className="fixed top-0 left-0 h-full w-[420px] bg-white border-r shadow-lg p-5 overflow-y-auto hidden lg:block no-print z-50">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-blue-600 uppercase tracking-wider">Smart Worksheet</h1>
                <span className="text-[9px] font-bold tracking-[0.2em] text-indigo-400 uppercase">OTIA EXCLUSIVE</span>
              </div>
              <button
                onClick={handleReset}
                className="text-xs text-gray-400 hover:text-indigo-600 font-bold transition-colors mt-1"
                title="Back to home"
              >
                <i className="fas fa-home mr-1"></i>Home
              </button>
            </div>
            {renderInputCore(true)}

            <div className="border-t pt-6">
              <label className="text-xs font-bold uppercase text-gray-400 block mb-2">View Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {(['editor', 'print-std', 'print-compact', 'interactive'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`text-xs font-bold py-1 px-2 border rounded capitalize ${viewMode === mode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {mode.replace('print-', '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t pt-6">
              <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Sections & Order</label>
              <div className="space-y-1 bg-gray-50 p-2 rounded border border-gray-100">
                 {sectionOrder.map((id, index) => (
                   <React.Fragment key={id}>
                   <div className="flex items-center justify-between p-1 bg-white rounded shadow-sm border border-gray-200">
                      <div className="flex items-center gap-2">
                           <Toggle checked={visibleSections.has(id)} onChange={() => toggleSection(id)} />
                           <span className="text-xs font-bold text-gray-700">{getSectionLabel(id)}</span>
                      </div>
                      <div className="flex gap-1">
                          <button
                              onClick={() => moveSection(index, 'up')}
                              disabled={index === 0}
                              className="w-5 h-5 flex items-center justify-center text-[10px] bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30"
                          >
                              <i className="fas fa-arrow-up"></i>
                          </button>
                          <button
                              onClick={() => moveSection(index, 'down')}
                              disabled={index === sectionOrder.length - 1}
                              className="w-5 h-5 flex items-center justify-center text-[10px] bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30"
                          >
                              <i className="fas fa-arrow-down"></i>
                          </button>
                      </div>
                   </div>
                   {id === 'writing' && visibleSections.has('writing') && (
                      <div className="ml-6 space-y-1 mt-1 border-l-2 border-gray-200 pl-2">
                          <div className="flex items-center gap-2">
                              <Toggle size="xs" checked={visibleSections.has('writing_expansion')} onChange={() => toggleSection('writing_expansion')} />
                              <span className="text-[10px] uppercase font-bold text-gray-500">A. Expansion</span>
                          </div>
                          <div className="flex items-center gap-2">
                              <Toggle size="xs" checked={visibleSections.has('writing_keywords')} onChange={() => toggleSection('writing_keywords')} />
                              <span className="text-[10px] uppercase font-bold text-gray-500">B. Keywords</span>
                          </div>
                          <div className="flex items-center gap-2">
                              <Toggle size="xs" checked={visibleSections.has('writing_qa')} onChange={() => toggleSection('writing_qa')} />
                              <span className="text-[10px] uppercase font-bold text-gray-500">C. Q&A Chain</span>
                          </div>
                          <div className="flex items-center gap-2">
                              <Toggle size="xs" checked={visibleSections.has('writing_critical')} onChange={() => toggleSection('writing_critical')} />
                              <span className="text-[10px] uppercase font-bold text-gray-500">D. Critical</span>
                          </div>
                      </div>
                   )}
                   </React.Fragment>
                 ))}
                 <div className="flex items-center justify-between p-1 mt-2 border-t border-dashed">
                    <div className="flex items-center gap-2">
                        <Toggle checked={visibleSections.has('keys')} onChange={() => toggleSection('keys')} />
                        <span className="text-xs font-bold text-gray-700">Answer Key</span>
                    </div>
                 </div>
              </div>
            </div>

            <div className="border-t pt-6">
               <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Instructor</label>
               <input
                  value={settings.teacherName}
                  onChange={e => setSettings({...settings, teacherName: e.target.value})}
                  placeholder="Name"
                  className="w-full border rounded p-2 text-sm"
               />
            </div>

            <div className="border-t pt-6">
               <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Watermark</label>
               <input
                  value={settings.watermarkText}
                  onChange={e => setSettings({...settings, watermarkText: e.target.value})}
                  placeholder="OTIA"
                  className="w-full border rounded p-2 text-sm"
               />
            </div>

            <div className="flex gap-2 pt-4">
              <button onClick={() => window.print()} className="flex-1 bg-gray-800 text-white py-2.5 rounded-xl font-bold text-xs hover:bg-gray-900 transition-colors" title="Print">
                <i className="fas fa-print mr-1"></i>Print
              </button>
              <button onClick={handleExportHTML} className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-2.5 rounded-xl font-bold text-xs hover:from-emerald-600 hover:to-teal-700 transition-all" title="Export HTML">
                 <i className="fas fa-file-code mr-1"></i>HTML
              </button>
              <button onClick={handleExportPDF} className="flex-1 bg-gradient-to-r from-rose-500 to-pink-600 text-white py-2.5 rounded-xl font-bold text-xs hover:from-rose-600 hover:to-pink-700 transition-all" title="Export PDF">
                 <i className="fas fa-file-pdf mr-1"></i>PDF
              </button>
            </div>
          </div>

          {/* Main Area */}
          <div className="lg:ml-[420px] min-h-screen">
             {/* Mobile Nav */}
             <div className="lg:hidden bg-white/90 backdrop-blur-sm shadow-sm border-b border-gray-100 p-4 flex justify-between items-center no-print sticky top-0 z-40">
                <div>
                  <h1 className="font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-blue-600 text-sm uppercase tracking-wider">Smart Worksheet</h1>
                  <span className="text-[8px] font-bold tracking-[0.2em] text-indigo-400 uppercase">OTIA EXCLUSIVE</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReset}
                    className="text-xs text-gray-500 hover:text-indigo-600 font-bold transition-colors"
                  >
                    <i className="fas fa-home mr-1"></i>Home
                  </button>
                  <button
                    onClick={() => { document.querySelector('.lg\\:block')?.classList.remove('hidden'); }}
                    className="text-gray-600"
                  >
                    <i className="fas fa-bars"></i>
                  </button>
                </div>
             </div>

             <div className={`p-0 lg:p-8 worksheet-preview-scope ${viewMode === 'print-compact' ? 'preview-export preview-compact' : viewMode === 'print-std' || viewMode === 'pdf' ? 'preview-export preview-standard' : ''}`}>
                <TestPreview
                  data={data}
                  settings={settings}
                  visibleSections={visibleSections}
                  sectionOrder={sectionOrder}
                  onUpdate={(key, val) => setData({...data, [key]: val})}
                  onRegenerateQuestion={handleRegenerateQuestion}
                  regeneratingQuestionId={regeneratingQuestionId}
                  viewMode={viewMode}
                />
                <p className="mt-12 text-center text-[11px] text-gray-300 font-medium tracking-wider uppercase no-print">CHASECCC</p>
             </div>
          </div>
        </>
      )}
    </div>
  );
}
