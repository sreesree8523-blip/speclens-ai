import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleHelp, FileText, History,
  LayoutDashboard, LoaderCircle, LockKeyhole, Search, ShieldCheck, TriangleAlert, X,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey, getGetAnalysisQueryKey, getListAnalysesQueryKey,
  useAnalyzePrd, useGetAiStatus, useGetAnalysis, useGetDashboardSummary, useListAnalyses,
} from '@workspace/api-client-react';
import type { Analysis, AnalysisListItem, Finding, PreflightCheck } from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function analysisErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const payload = (error as { data?: unknown }).data;
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  if (error instanceof Error && /fetch|network/i.test(error.message)) {
    return 'Cannot reach the analysis server. Check your connection and retry. No result was saved.';
  }
  return 'The analysis could not be completed. No result was saved. Retry when the service is available.';
}

function NavLink({ href, icon: Icon, label, active }: { href: string; icon: typeof Search; label: string; active: boolean }) {
  return <Link href={href} className={`nav-link${active ? ' active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} aria-current={active ? 'page' : undefined}>
    <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
  </Link>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: aiStatus, isLoading: aiLoading, isError: aiError } = useGetAiStatus();
  const pageName = location === '/' ? 'New analysis' : location.startsWith('/history') ? 'Analysis history' : location.startsWith('/dashboard') ? 'Overview' : 'Saved analysis';
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <Link href="/" className="brand" data-testid="link-brand-home">
        <span className="brand-mark"><Search size={18} strokeWidth={2.2} /></span>
        <span><span className="brand-name">SpecLens</span><span className="brand-caption">Product clarity, before code</span></span>
      </Link>
      <div className="nav-label">Workspace</div>
      <nav className="nav-list">
        <NavLink href="/" icon={Search} label="New analysis" active={location === '/'} />
        <NavLink href="/dashboard" icon={LayoutDashboard} label="Overview" active={location === '/dashboard'} />
        <NavLink href="/history" icon={History} label="History" active={location === '/history'} />
      </nav>
      <div className="sidebar-bottom">
        <div className="ai-indicator"><span className="status-dot" style={{ background: aiError || (!aiLoading && !aiStatus?.ready) ? 'hsl(var(--chart-4))' : undefined }} />
          <span>{aiLoading ? 'Checking analysis service…' : aiError ? 'Service status unavailable' : aiStatus?.message ?? 'Analysis service status unavailable'}</span>
        </div>
        <div className="sidebar-foot">SPECLENS AI&nbsp; / &nbsp;PRD REVIEW</div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="crumb">Workspace <ChevronRight size={12} style={{ verticalAlign: 'middle', margin: '0 5px' }} /> <span style={{ color: 'hsl(var(--foreground))' }}>{pageName}</span></div>
        <div className="top-actions"><span className="workspace-chip"><i /> Engineering handoff</span></div>
      </header>
      {children}
    </main>
  </div>;
}

function preflight(featureName: string, prdText: string): PreflightCheck[] {
  const body = prdText.trim();
  const hasAcceptance = /\b(acceptance criteria|given\b|when\b|then\b|must\b|should\b|success criteria)\b/i.test(body);
  const hasEdgeCases = /\b(error|empty|invalid|edge case|timeout|failure|retry|fallback)\b/i.test(body);
  const hasInputs = /\b(input|field|parameter|user|account|id|date|amount|value)\b/i.test(body);
  return [
    { id: 'feature-name', label: 'Feature is named', passed: featureName.trim().length >= 3, detail: featureName.trim().length >= 3 ? 'A clear feature name is present.' : 'Add a short, recognizable feature name.' },
    { id: 'prd-content', label: 'PRD has substance', passed: body.length >= 80, detail: body.length >= 80 ? `${body.length.toLocaleString()} characters ready to review.` : 'Add at least 80 characters so the review has enough context.' },
    { id: 'acceptance-criteria', label: 'Acceptance logic included', passed: hasAcceptance, detail: hasAcceptance ? 'Acceptance or behavior language detected.' : 'Consider adding observable acceptance criteria.' },
    { id: 'edge-cases', label: 'Failure paths considered', passed: hasEdgeCases, detail: hasEdgeCases ? 'A failure or edge-case term was detected.' : 'No obvious failure or edge-case language detected.' },
    { id: 'inputs', label: 'Inputs described', passed: hasInputs, detail: hasInputs ? 'Input or parameter language detected.' : 'Name the data users provide or the system receives.' },
  ];
}

function Preflight({ checks }: { checks: PreflightCheck[] }) {
  const passedCount = checks.filter((check) => check.passed).length;
  return <section className="checks" aria-label="Preflight checks" data-testid="section-preflight">
    <div className="check-head"><span className="check-title">Preflight checks</span><span className="check-score">{passedCount} / {checks.length} signals present</span></div>
    <div className="check-grid">{checks.map((check) => <div className="check-item" key={check.id} data-testid={`check-${check.id}`}>
      <span className={`check-icon${check.passed ? '' : ' fail'}`}>{check.passed ? <Check size={11} /> : <X size={11} />}</span>
      <span className="check-copy"><b>{check.label}</b>{check.passed ? 'Ready to include' : check.detail}</span>
    </div>)}</div>
  </section>;
}

function FindingCard({ finding }: { finding: Finding }) {
  const severity = finding.severity.toLowerCase();
  return <article className="finding" data-testid={`finding-${finding.id}`}>
    <div className="finding-top"><div>
      <div className="finding-title">{finding.title}</div>
      <div className="finding-category">{finding.category}</div>
    </div><span className={`severity severity-${severity}`}>{finding.severity}</span></div>
    <div className="evidence"><span className="evidence-label">{finding.evidenceType === 'quoted_text' ? 'Evidence from the PRD' : 'Not specified in the PRD'}</span>
      {finding.evidence ? <q>{finding.evidence}</q> : 'No direct statement found. This requirement appears to be absent from the supplied text.'}
    </div>
    <div className="finding-grid">
      <div><span className="detail-label">Missing requirement</span><p>{finding.missingRequirement}</p></div>
      <div><span className="detail-label">Implementation risk</span><p>{finding.implementationRisk}</p></div>
    </div>
    <div className="recommendation"><b>Recommendation</b>{finding.recommendation}</div>
  </article>;
}

function AnalysisResults({ analysis, onReset }: { analysis: Analysis; onReset?: () => void }) {
  const high = analysis.findings.filter((finding) => finding.severity === 'High').length;
  return <section className="result-wrap" id="analysis-results" data-testid="section-analysis-results">
    <div className="result-heading">
      <div><div className="eyebrow">Review complete</div><h2>{analysis.featureName}</h2><div className="result-meta">ANALYSIS #{analysis.id} &nbsp;·&nbsp; {formatDate(analysis.createdAt)}</div></div>
      {onReset && <button className="secondary-btn" onClick={onReset} data-testid="button-new-analysis">New review <ArrowRight size={14} /></button>}
    </div>
    <div className="summary-grid">
      <div className="summary-card confidence-card">
        <div className="confidence-ring" style={{ '--confidence': `${Math.max(0, Math.min(100, analysis.confidence.score))}%` } as CSSProperties} aria-label={`Heuristic confidence ${analysis.confidence.score} percent`}>
          <span className="confidence-number">{analysis.confidence.score}</span>
        </div>
        <div className="summary-copy"><strong>Heuristic confidence signal</strong><p>{analysis.confidence.explanation} This is a directional heuristic, not a calibrated probability or guarantee of completeness.</p></div>
      </div>
      <div className="summary-card summary-stat"><span>Findings to resolve</span><strong>{analysis.findings.length}</strong><small>{high} high-severity {high === 1 ? 'risk' : 'risks'} flagged</small></div>
    </div>
    <div className="section-card result-section">
      <div className="section-head"><h3>Findings &amp; recommendations</h3><span>{analysis.findings.length} ITEMS</span></div>
      {analysis.findings.length ? analysis.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />) :
        <div className="empty-state"><div className="empty-mark"><ShieldCheck size={18} /></div><h3>No material gaps returned</h3><p>The analysis did not identify findings in the submitted PRD. Treat this as a review aid, not a substitute for engineering discussion.</p></div>}
    </div>
    <div className="section-card result-section">
      <div className="section-head"><h3>Questions for the handoff</h3><span>{analysis.questions.length} OPEN QUESTIONS</span></div>
      {analysis.questions.length ? <ol className="question-list">{analysis.questions.map((question, index) => <li key={`${index}-${question}`} data-testid={`question-${index}`}>{question}</li>)}</ol> : <div className="empty-state"><p>No clarifying questions were returned.</p></div>}
    </div>
    <div className="section-card result-section">
      <div className="section-head"><h3>Preflight record</h3><span>BEFORE ANALYSIS</span></div>
      <div className="preflight-list">{analysis.preflightChecks.map((check) => <div className="preflight-row" key={check.id}>
        {check.passed ? <CheckCircle2 size={15} /> : <CircleHelp size={15} />}
        <span><b>{check.label}</b>{check.detail}</span>
      </div>)}</div>
    </div>
  </section>;
}

function HomePage() {
  const [featureName, setFeatureName] = useState('');
  const [prdText, setPrdText] = useState('');
  const [result, setResult] = useState<Analysis | null>(null);
  const { data: aiStatus } = useGetAiStatus();
  const analyze = useAnalyzePrd();
  const client = useQueryClient();
  const checks = useMemo(() => preflight(featureName, prdText), [featureName, prdText]);
  const valid = featureName.trim().length > 0 && prdText.trim().length > 0 && featureName.trim().length <= 120 && prdText.length <= 20000;
  const submit = () => {
    if (!valid) return;
    analyze.mutate({ data: { featureName: featureName.trim(), prdText: prdText.trim() } }, {
      onSuccess: (analysis) => {
        setResult(analysis);
        client.invalidateQueries({ queryKey: getListAnalysesQueryKey({ limit: 50, offset: 0 }) });
        client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        window.setTimeout(() => document.getElementById('analysis-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      },
    });
  };
  const reset = () => { setResult(null); analyze.reset(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return <div className="page">
    <div className="hero-head">
      <div><div className="eyebrow">Before the first ticket</div><h1 className="page-title">Make the handoff<br />feel certain.</h1><p className="page-lede">Review your product requirements for material ambiguity, missing logic, and undefined inputs—before they become engineering assumptions.</p></div>
        <div className="ready-pill"><span className="status-dot" style={{ width: 6, height: 6, margin: 0 }} />{aiStatus?.ready ? 'OPENAI KEY CONFIGURED' : 'AI SETUP REQUIRED'}</div>
    </div>
    <div className="form-panel">
      <div className="form-topline"><span className="step-num">01</span> Add your specification <span style={{ marginLeft: 'auto', color: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 400 }}>Saved to this workspace</span></div>
      <div className="form-inner">
        <div className="field-block"><label className="field-label" htmlFor="feature-name">Feature name <span className="field-note">{featureName.length} / 120</span></label>
          <input className="text-field" id="feature-name" value={featureName} maxLength={120} onChange={(event) => setFeatureName(event.target.value)} placeholder="e.g. Saved payment methods" data-testid="input-feature-name" />
        </div>
        <div className="field-block"><label className="field-label" htmlFor="prd-text">Product requirements document <span className="field-note">Paste the working draft</span></label>
          <textarea className="prd-field" id="prd-text" value={prdText} maxLength={20000} onChange={(event) => setPrdText(event.target.value)} placeholder={'Describe the user, the intended behavior, and what success looks like.\n\nYou can paste a full PRD or a focused feature brief.'} data-testid="input-prd-text" />
          <div className="editor-foot"><span>Use the actual working draft. Missing detail is useful signal.</span><span>{prdText.length.toLocaleString()} / 20,000</span></div>
        </div>
      </div>
      <Preflight checks={checks} />
      {analyze.isError && <div className="error-box" role="alert" data-testid="status-analysis-error">
        <span>{analysisErrorMessage(analyze.error)}</span>
        <button className="secondary-btn" onClick={submit} disabled={!valid || analyze.isPending} data-testid="button-retry-analysis"><ArrowRight size={13} /> Retry</button>
      </div>}
      <div className="form-submitbar"><span className="form-hint"><LockKeyhole size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />Saved analysis can be revisited from History.</span>
        <button className="primary-btn" onClick={submit} disabled={!valid || analyze.isPending} data-testid="button-analyze">
          {analyze.isPending ? <><LoaderCircle size={15} className="spin" /> Reviewing PRD…</> : <>Analyze specification <ArrowRight size={15} /></>}
        </button>
      </div>
    </div>
    <div className="lower-note"><ShieldCheck size={16} />SpecLens gives your team a structured second look. It does not replace product judgment or an engineering review.</div>
    {result && <AnalysisResults analysis={result} onReset={reset} />}
  </div>;
}

function LoadingPanel({ label = 'Loading saved analyses' }: { label?: string }) {
  return <div className="section-card loading-state" aria-live="polite" data-testid="status-loading"><div className="skeleton" style={{ width: 42, margin: '0 auto 14px' }} /><h3>{label}</h3><p>Retrieving persisted workspace data.</p></div>;
}

function QueryError({ onRetry, label = 'Could not load this data' }: { onRetry: () => void; label?: string }) {
  return <div className="section-card error-state" role="alert" data-testid="status-query-error"><div className="empty-mark"><TriangleAlert size={18} /></div><h3>{label}</h3><p>The saved workspace data could not be reached. Check the connection and try again.</p><button className="secondary-btn" onClick={onRetry} data-testid="button-retry-query">Try again <ArrowRight size={13} /></button></div>;
}

function EmptyAnalyses() {
  return <div className="section-card empty-state" data-testid="status-empty-analyses"><div className="empty-mark"><FileText size={18} /></div><h3>No analyses yet</h3><p>Your persisted PRD reviews will appear here once you run the first one.</p><Link href="/" className="primary-btn" data-testid="link-start-analysis">Start an analysis <ArrowRight size={14} /></Link></div>;
}

function AnalysisTable({ items }: { items: AnalysisListItem[] }) {
  return <div className="section-card" style={{ overflowX: 'auto' }}>
    <table className="analysis-table"><thead><tr><th>Feature</th><th>Findings</th><th>High severity</th><th>Reviewed</th><th></th></tr></thead>
      <tbody>{items.map((item) => <tr className="analysis-row" key={item.id} data-testid={`row-analysis-${item.id}`}>
        <td className="feature-cell"><Link href={`/analyses/${item.id}`} style={{ color: 'inherit', textDecoration: 'none' }} data-testid={`link-analysis-${item.id}`}>{item.featureName}<span className="row-sub">Review #{item.id}</span></Link></td>
        <td><span className="count-pill">{item.findingCount} {item.findingCount === 1 ? 'finding' : 'findings'}</span></td>
        <td><span className="count-pill high-count">{item.highSeverityCount}</span></td>
        <td>{formatDate(item.createdAt)}</td>
        <td><Link href={`/analyses/${item.id}`} className="quiet-btn" aria-label={`Open ${item.featureName}`} data-testid={`button-open-analysis-${item.id}`}><ArrowRight size={15} /></Link></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function HistoryPage() {
  const [offset, setOffset] = useState(0);
  const params = useMemo(() => ({ limit: 20, offset }), [offset]);
  const query = useListAnalyses(params);
  return <div className="page">
    <div className="page-toolbar"><div><div className="eyebrow">Saved work</div><h1 className="page-title">Analysis history</h1><p className="page-lede">Every completed review, ready to revisit and bring into the handoff conversation.</p></div>
      <Link href="/" className="primary-btn" data-testid="link-new-analysis"><Search size={14} /> New analysis</Link>
    </div>
    {query.isLoading ? <LoadingPanel /> : query.isError ? <QueryError onRetry={() => query.refetch()} label="History is unavailable" /> :
      !query.data?.length && offset === 0 ? <EmptyAnalyses /> : <><AnalysisTable items={query.data ?? []} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14 }}>
          <span className="result-meta">Showing {offset + 1}–{offset + (query.data?.length ?? 0)} persisted reviews</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="secondary-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))} data-testid="button-history-previous"><ArrowLeft size={13} /> Previous</button>
            <button className="secondary-btn" disabled={(query.data?.length ?? 0) < 20} onClick={() => setOffset(offset + 20)} data-testid="button-history-next">Next <ArrowRight size={13} /></button>
          </div>
        </div>
      </>}
  </div>;
}

function DashboardPage() {
  const query = useGetDashboardSummary();
  if (query.isLoading) return <div className="page"><div className="eyebrow">Workspace pulse</div><h1 className="page-title">Overview</h1><LoadingPanel label="Loading workspace metrics" /></div>;
  if (query.isError || !query.data) return <div className="page"><div className="eyebrow">Workspace pulse</div><h1 className="page-title">Overview</h1><QueryError onRetry={() => query.refetch()} label="Dashboard is unavailable" /></div>;
  const summary = query.data;
  const categories = [
    ['Ambiguity', summary.findingsByCategory.ambiguity],
    ['Missing logic', summary.findingsByCategory.missingLogic],
    ['Undefined inputs', summary.findingsByCategory.undefinedInputs],
  ] as const;
  const maxCategory = Math.max(1, ...categories.map((entry) => entry[1]));
  const maxSeverity = Math.max(1, summary.findingsBySeverity.high, summary.findingsBySeverity.medium, summary.findingsBySeverity.low);
  return <div className="page">
    <div className="page-toolbar"><div><div className="eyebrow">Workspace pulse</div><h1 className="page-title">Overview</h1><p className="page-lede">A view of the gaps your team has surfaced across saved PRD reviews.</p></div>
      <Link href="/" className="primary-btn" data-testid="link-dashboard-new-analysis"><Search size={14} /> Review a PRD</Link>
    </div>
    {!summary.totalAnalyses ? <EmptyAnalyses /> : <>
      <div className="metric-grid">
        <div className="metric-card"><span className="metric-label">Reviews completed</span><strong className="metric-value" data-testid="metric-total-analyses">{summary.totalAnalyses}</strong><div className="metric-foot">Persisted analyses in this workspace</div></div>
        <div className="metric-card"><span className="metric-label">Material gaps found</span><strong className="metric-value" data-testid="metric-total-findings">{summary.totalFindings}</strong><div className="metric-foot">Across all saved reviews</div></div>
        <div className="metric-card"><span className="metric-label">High severity</span><strong className="metric-value" data-testid="metric-high-severity">{summary.findingsBySeverity.high}</strong><div className="metric-foot">Risks worth resolving before handoff</div></div>
      </div>
      <div className="dashboard-grid">
        <section className="section-card chart-card"><h2 className="chart-title">Finding categories</h2><p className="chart-subtitle">Where requirements need more definition</p>
          <div className="bar-list">{categories.map(([label, value]) => <div className="bar-line" key={label}><span className="bar-name">{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(value / maxCategory) * 100}%` }} /></div><span className="bar-count">{value}</span></div>)}</div>
        </section>
        <section className="section-card chart-card"><h2 className="chart-title">Severity distribution</h2><p className="chart-subtitle">Finding counts by estimated impact</p>
          <div className="bar-list">{[
            ['High', summary.findingsBySeverity.high, 'hsl(var(--chart-4))'],
            ['Medium', summary.findingsBySeverity.medium, 'hsl(var(--chart-2))'],
            ['Low', summary.findingsBySeverity.low, 'hsl(var(--chart-1))'],
          ].map(([label, value, color]) => <div className="bar-line" key={label as string}><span className="bar-name">{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(value) / maxSeverity) * 100}%`, background: color as string }} /></div><span className="bar-count">{value}</span></div>)}</div>
          <div className="severity-legend"><span><i className="legend-dot" style={{ background: 'hsl(var(--chart-4))' }} />High</span><span><i className="legend-dot" style={{ background: 'hsl(var(--chart-2))' }} />Medium</span><span><i className="legend-dot" style={{ background: 'hsl(var(--chart-1))' }} />Low</span></div>
        </section>
      </div>
      <div className="recent-heading"><h2>Recent reviews</h2><Link href="/history" className="quiet-btn" data-testid="link-view-history">All history <ArrowRight size={13} /></Link></div>
      {summary.recentAnalyses.length ? <AnalysisTable items={summary.recentAnalyses} /> : <div className="section-card empty-state"><p>No recent analyses to show.</p></div>}
    </>}
  </div>;
}

function AnalysisDetailPage() {
  const params = useParams();
  const rawId = params.id ?? '';
  const analysisId = Number(rawId);
  const validId = Number.isInteger(analysisId) && analysisId > 0;
  const query = useGetAnalysis(analysisId, { query: { enabled: validId, queryKey: getGetAnalysisQueryKey(analysisId) } });
  if (!validId) return <div className="page"><div className="eyebrow">Saved review</div><h1 className="page-title">Analysis not found</h1><div className="section-card error-state"><p>This review link does not contain a valid analysis ID.</p><Link href="/history" className="secondary-btn"><ArrowLeft size={13} /> Back to history</Link></div></div>;
  if (query.isLoading) return <div className="page"><div className="eyebrow">Saved review</div><h1 className="page-title">Opening analysis</h1><LoadingPanel label="Retrieving persisted analysis" /></div>;
  if (query.isError || !query.data) return <div className="page"><div className="eyebrow">Saved review</div><h1 className="page-title">Analysis unavailable</h1><QueryError onRetry={() => query.refetch()} label="Could not open this saved analysis" /></div>;
  const analysis = query.data;
  return <div className="page">
    <div className="page-toolbar"><div><Link href="/history" className="quiet-btn" data-testid="link-back-history"><ArrowLeft size={13} /> History</Link><div className="eyebrow" style={{ marginTop: 14 }}>Persisted review · #{analysis.id}</div></div>
      <span className="result-meta">{formatDate(analysis.createdAt)}</span>
    </div>
    <AnalysisResults analysis={analysis} />
    <section className="section-card result-section"><div className="section-head"><h3>Submitted PRD</h3><span>ORIGINAL INPUT</span></div><div style={{ padding: 17 }}><div className="detail-label">{analysis.featureName}</div><div className="detail-prd" data-testid="text-saved-prd">{analysis.prdText}</div></div></section>
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/history" component={HistoryPage} />
    <Route path="/dashboard" component={DashboardPage} />
    <Route path="/analyses/:id" component={AnalysisDetailPage} />
    <Route component={NotFound} />
  </Switch></Shell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider>
  </QueryClientProvider>;
}

export default App;
