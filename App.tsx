
import React, { useState, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorksheetData, AppSettings, Difficulty, Project, ValidationResult } from './types';
import { generateAndRefine } from './services/aiService';
import { validateWorksheet } from './services/validatorService';
import { createProject, saveProject, getProjects, getProject } from './services/storageService';
import { getActiveConfig } from './services/configService';
import TestPreview, { Toggle } from './components/TestPreview';
import { ConfigPanel } from './components/ConfigPanel';
import { ProjectPanel } from './components/ProjectPanel';
import { ValidationPanel } from './components/ValidationPanel';

type ViewMode = 'editor' | 'print-std' | 'print-compact' | 'interactive' | 'pdf';

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

    .section-title {
        background-color: #f3f4f6 !important;
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        margin-top: 1.5rem;
        margin-bottom: 1rem;
        border: 1px solid #e5e7eb;
    }

    ::-webkit-scrollbar { display: none; }

    p, div, span, li, td {
        font-family: Arial, sans-serif !important;
        font-size: 11pt !important;
    }
  }

  h1 { font-weight: 900; text-transform: uppercase; text-align: center; font-size: 24pt !important; margin-bottom: 1rem; }
  h2 { font-weight: 900; text-transform: uppercase; margin-bottom: 0.5rem; font-size: 14pt !important; }
  .paper { margin: 0 auto; }

  .interactive-input { border: 1px solid #ccc; border-radius: 4px; padding: 2px 5px; background: #f9fafb; font-family: monospace; }
  .interactive-input:focus { outline: 2px solid #3b82f6; background: white; }
  .interactive-input.correct { background-color: #dcfce7; border-color: #22c55e; color: #15803d; font-weight: bold; }

  .interactive-opt { cursor: pointer; transition: all 0.2s; border: 1px solid transparent; }
  .interactive-opt:hover { background-color: #f3f4f6; }
  .interactive-opt.selected-correct { background-color: #dcfce7 !important; border-color: #22c55e; }
  .interactive-opt.selected-wrong { background-color: #fee2e2 !important; border-color: #ef4444; }

  .section-title {
    background-color: #f3f4f6;
    border-radius: 8px;
    padding: 8px 12px;
    margin-top: 24px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
`;

const STD_STYLES = `
  :root { --line-height: 2rem; }
  @page { margin: 1.5cm; size: A4; }
  .writing-line { border-bottom: 1px solid #000; height: var(--line-height); margin-bottom: 0.1rem; width: 100%; display: block; }
  .paper { max-width: 210mm; padding: 10mm; }
  .section-gap { margin-bottom: 1.5rem; }
`;

const COMPACT_STYLES = `
  :root { --line-height: 1.6rem; }
  @page { margin: 1cm; size: A4; }
  .writing-line { border-bottom: 1px solid #000; height: var(--line-height); margin-bottom: 0px; width: 100%; display: block; }
  .paper { max-width: 210mm; padding: 10mm; }
  .section-gap { margin-bottom: 1rem; }

  @media print {
    .page-break { page-break-before: auto !important; margin-top: 2rem; border-top: 1px dashed #ccc; padding-top: 1rem; }
    .force-break-key { page-break-before: always !important; }
  }
`;

// === PDF Export: minimal overrides, keep identical to HTML print layout ===
// HTML export already prints perfectly to 4 pages in browser; we only
// ensure Electron printToPDF respects the same @media print rules.
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
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-3-flash-preview',
      enabled: false,
    },
    difficulty: 'B2',
    teacherName: '',
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

  const [sectionOrder, setSectionOrder] = useState<string[]>(['summary', 'mc', 'syntaxDeconstruction', 'writing']);

  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set([
      'summary',
      'mc',
      'syntaxDeconstruction',
      'writing',
      'writing_expansion',
      'writing_keywords',
      'writing_qa',
      'writing_critical',
      'keys'
  ]));

  // Project state
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Auto-save project when data changes
  useEffect(() => {
    if (!currentProject || !data) return;

    const updatedProject: Project = {
      ...currentProject,
      articleText: article,
      difficulty: settings.difficulty,
      worksheets: currentProject.worksheets.map(w => w._meta?.generatedAt === data._meta?.generatedAt ? data : w),
      updatedAt: Date.now(),
    };

    if (!updatedProject.worksheets.find(w => w._meta?.generatedAt === data._meta?.generatedAt)) {
      updatedProject.worksheets.push(data);
    }

    saveProject(updatedProject).catch(console.error);
  }, [data, currentProject]);

  // Cache compiled Tailwind CSS for self-contained HTML export (no CDN dependency)
  const exportTailwindCSS = useRef<string>('');

  useEffect(() => {
    fetch('/export-tailwind.css')
      .then(res => res.text())
      .then(css => { exportTailwindCSS.current = css; })
      .catch(() => console.warn('export-tailwind.css not found, export will use base styles only'));
  }, []);

  const handleGenerate = async () => {
    if (!article.trim()) return;

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
      );

      // Run final validation (auto-fixes mechanical issues like option rotation)
      const validation = validateWorksheet(rawData, article);
      const errors = validation.issues.filter(i => i.severity === 'error');
      const warnings = validation.issues.filter(i => i.severity === 'warning');
      const finalData = validation.data;
      setData(finalData);

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

      // Show validation panel only for hard errors
      if (errors.length > 0) {
        setValidationResult({ ...validation, data: finalData });
      }

      // Create or update project
      if (!currentProject) {
        const newProject = createProject(
          finalData.title || 'Untitled Project',
          article,
          settings.difficulty
        );
        newProject.worksheets = [finalData];
        await saveProject(newProject);
        setCurrentProject(newProject);
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
      );
      const validation = validateWorksheet(rawData, article);
      setValidationResult(validation);
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

  const handleLoadProject = (project: Project) => {
    setCurrentProject(project);
    setArticle(project.articleText);
    setSettings(prev => ({ ...prev, difficulty: project.difficulty }));
    if (project.worksheets.length > 0) {
      const latest = project.worksheets[project.worksheets.length - 1];
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
    if (!currentProject) return;
    const updated: Project = {
      ...currentProject,
      articleText: article,
      difficulty: settings.difficulty,
      updatedAt: Date.now(),
    };
    if (data) {
      const exists = updated.worksheets.find(w => w._meta?.generatedAt === data._meta?.generatedAt);
      if (!exists) {
        updated.worksheets.push(data);
      } else {
        updated.worksheets = updated.worksheets.map(w =>
          w._meta?.generatedAt === data._meta?.generatedAt ? data : w
        );
      }
    }
    await saveProject(updated);
    setCurrentProject(updated);
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
        case 'syntaxDeconstruction': return 'Syntax Deconstruction';
        case 'writing': return 'Writing Workshop';
        case 'keys': return 'Answer Key';
        default: return id;
    }
  };

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

  const handleExportPDF = async () => {
    const html = buildExportHTML(true);
    if (!html) return;
    try {
      const filename = `${data!.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
      const result = await (window as any).electronAPI.exportPDF(html, filename);
      if (result?.success) {
        alert(`PDF saved to:\n${result.path}`);
      }
    } catch (err: any) {
      alert('PDF export failed: ' + err.message);
    }
  };

  // Shared input controls used in both centered and sidebar layouts
  const renderInputCore = (isCompact: boolean) => (
    <div className={`space-y-6 ${isCompact ? '' : 'w-full max-w-4xl mx-auto'}`}>
      {!isCompact && (
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-blue-900 uppercase tracking-widest mb-2">Worksheet Generator</h1>
          <p className="text-gray-400 text-sm font-medium">Paste an article to generate reading comprehension worksheets</p>
        </div>
      )}

      <div>
        <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Article Text</label>
        <textarea
          value={article}
          onChange={e => setArticle(e.target.value)}
          className={`w-full border rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none ${isCompact ? 'h-32' : 'h-64'}`}
          placeholder="Paste article content here..."
        />
      </div>

      <div className={isCompact ? '' : 'flex gap-4'}>
        <div className={isCompact ? '' : 'flex-1'}>
          <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Level</label>
          <select
            value={settings.difficulty}
            onChange={e => setSettings({...settings, difficulty: e.target.value as Difficulty})}
            className="w-full border rounded p-2 text-sm"
          >
            <option value="A2">A2 (Elem)</option>
            <option value="B1">B1 (Inter)</option>
            <option value="B2">B2 (Upper)</option>
            <option value="C1">C1 (Adv)</option>
          </select>
        </div>

        {!isCompact && (
          <div className="flex-1">
            <label className="text-xs font-bold uppercase text-gray-400 block mb-2">Instructor</label>
            <input
              value={settings.teacherName}
              onChange={e => setSettings({...settings, teacherName: e.target.value})}
              placeholder="Name (optional)"
              className="w-full border rounded p-2 text-sm"
            />
          </div>
        )}
      </div>

      <button
        onClick={() => setShowConfig(true)}
        className="w-full py-2 rounded font-bold text-xs bg-gray-200 hover:bg-gray-300 transition-colors flex items-center justify-center gap-1"
      >
        <span>⚙</span> AI Configuration
      </button>

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
        disabled={loading || !article}
        className={`w-full py-3 rounded font-bold text-white shadow transition-all text-lg ${loading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
      >
        {loading ? loadingMessage : 'Generate Worksheet'}
      </button>

      {error && <div className="text-red-600 text-xs bg-red-50 p-2 rounded border border-red-200">{error}</div>}

      {refinementSummary && !error && (
        <div className={`text-xs p-2 rounded border flex items-center gap-2 ${refinementSummary.includes('clean') ? 'bg-green-50 border-green-200 text-green-700' : refinementSummary.includes('minor') ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{refinementSummary.includes('clean') ? '✓' : '◉'}</span>
          {refinementSummary}
        </div>
      )}

      <ValidationPanel
        result={validationResult}
        onRetry={handleRetryValidation}
        onForceUse={handleForceUse}
      />

      <ProjectPanel
        currentProject={currentProject}
        onLoadProject={handleLoadProject}
        onSaveCurrent={handleSaveCurrent}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <style>{`
        @media print {
          ${viewMode === 'print-compact' ? COMPACT_STYLES : STD_STYLES}
          .no-print { display: none !important; }
        }
      `}</style>

      {!data ? (
        // === CENTERED INPUT LAYOUT (before generation) ===
        <div className="min-h-screen flex items-center justify-center p-6 no-print">
          {renderInputCore(false)}
        </div>
      ) : (
        // === SPLIT SIDEBAR LAYOUT (after generation) ===
        <>
          {/* Sidebar */}
          <div className="fixed top-0 left-0 h-full w-80 bg-white border-r shadow-lg p-6 overflow-y-auto hidden lg:block no-print z-50">
            <div className="flex items-start justify-between mb-4">
              <h1 className="text-xl font-black text-blue-900 uppercase tracking-wider">Worksheet<br/>Generator</h1>
              <button
                onClick={handleReset}
                className="text-xs text-gray-400 hover:text-blue-600 font-bold transition-colors mt-1"
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

            <div className="flex gap-2 pt-4">
              <button onClick={() => window.print()} className="flex-1 bg-gray-800 text-white py-2 rounded font-bold text-sm hover:bg-black" title="Print">
                <i className="fas fa-print"></i>
              </button>
              <button onClick={handleExportHTML} className="flex-1 bg-green-600 text-white py-2 rounded font-bold text-sm hover:bg-green-700" title="Export HTML">
                 <i className="fas fa-file-code"></i>
              </button>
              <button onClick={handleExportPDF} className="flex-1 bg-red-600 text-white py-2 rounded font-bold text-sm hover:bg-red-700" title="Export PDF">
                 <i className="fas fa-file-pdf"></i>
              </button>
            </div>
          </div>

          {/* Main Area */}
          <div className="lg:ml-80 min-h-screen">
             {/* Mobile Nav */}
             <div className="lg:hidden bg-white shadow p-4 flex justify-between items-center no-print sticky top-0 z-40">
                <h1 className="font-bold text-blue-900">Worksheet Gen</h1>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReset}
                    className="text-xs text-gray-500 hover:text-blue-600 font-bold"
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

             <div className="p-0 lg:p-8">
                <TestPreview
                  data={data}
                  settings={settings}
                  visibleSections={visibleSections}
                  sectionOrder={sectionOrder}
                  onUpdate={(key, val) => setData({...data, [key]: val})}
                  viewMode={viewMode}
                />
             </div>
          </div>
        </>
      )}
    </div>
  );
}
