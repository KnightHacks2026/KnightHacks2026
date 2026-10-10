"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, GitBranch,
  Layers3, Maximize2, Play, RotateCcw, ShieldCheck, Sparkles, X,
} from "lucide-react";
import type {
  GetTwinResponse, Obligation, ProjectedObligation, RunSimulationRequest,
  RunSimulationResponse, SimulationResult, TwinProjection,
} from "../../contracts";
import {
  cascadeBaselineProjection, cascadeImport, cascadeSnapshot,
  fullFundingScenario, partialFundingScenario,
} from "../../contracts/fixtures";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatAssetUnits, formatUtc, reasonLabel } from "./format";

const SettlementGraph = dynamic(() => import("./settlement-graph").then((module) => module.SettlementGraph), {
  ssr: false,
  loading: () => <div className="settlement-graph graph-loading">Loading dependency map…</div>,
});

const scenarios = [
  { id: "full", name: "Close the shortfall", description: "Transfer the fixture's USD 10.00 from the uncommitted reserve.", request: fullFundingScenario },
  { id: "partial", name: "Partial funding", description: "Transfer the fixture's USD 5.00 from the same reserve.", request: partialFundingScenario },
] as const;

const accountNames = Object.fromEntries(cascadeImport.accounts.map((account) => [account.id, account.name]));
const institutionNames = Object.fromEntries(cascadeImport.institutions.map((institution) => [institution.id, institution.name]));

function statusTone(status: ProjectedObligation["status"]) {
  return status === "blocked" ? "danger" : status === "at_risk" ? "warning" : status === "settled" ? "success" : "neutral";
}

function StatusPill({ status }: { status: ProjectedObligation["status"] }) {
  return <Badge tone={statusTone(status)}><span className="status-dot" />{status.replace("_", " ")}</Badge>;
}

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>;
}

function Navigation() {
  return (
    <aside className="navigation-rail" aria-label="Workspace navigation">
      <div className="rail-top"><BrandMark /><span className="rail-wordmark">CUSTODY<span>OS</span></span></div>
      <div className="rail-group-label">WORKSPACE</div>
      <nav className="rail-nav">
        <a className="rail-link" href="/"><Activity size={18} /><span>Command center</span></a>
        <a className="rail-link is-active" href="/twin"><GitBranch size={18} /><span>Custody Twin</span><span className="rail-link__active" /></a>
        <a className="rail-link" href="#cascade"><Activity size={18} /><span>Dependency map</span></a>
        <a className="rail-link" href="#scenario"><Layers3 size={18} /><span>Scenarios</span></a>
        <a className="rail-link" href="#comparison"><Boxes size={18} /><span>Comparison</span></a>
      </nav>
      <div className="rail-spacer" />
      <div className="rail-bottom">
        <div className="rail-environment"><span className="environment-light" /><div><strong>Sandbox environment</strong><small>Fixture dataset · v1.0.0</small></div></div>
        <div className="rail-profile"><div className="avatar">CO</div><div><strong>Custody Operations</strong><small>Workspace viewer</small></div><ChevronDown size={15} /></div>
      </div>
    </aside>
  );
}

function SummaryCards({ projection }: { projection: TwinProjection }) {
  const blocked = projection.obligations.filter((item) => item.status === "blocked").length;
  const affected = projection.obligations.filter((item) => item.reasonCodes.includes("UPSTREAM_SETTLEMENT_BLOCKED")).length;
  const cards = [
    { label: "TOTAL OBLIGATIONS", value: String(projection.obligations.length).padStart(2, "0"), sub: "In this settlement chain", icon: Layers3, tone: "ink" },
    { label: "BLOCKED LEGS", value: String(blocked).padStart(2, "0"), sub: "Require resolution", icon: ArrowDownRight, tone: "coral" },
    { label: "DOWNSTREAM IMPACT", value: String(affected).padStart(2, "0"), sub: "Blocked by an upstream leg", icon: Activity, tone: "violet" },
    { label: "DEPENDENCIES", value: String(projection.dependencies.length).padStart(2, "0"), sub: "Settlement proceeds", icon: GitBranch, tone: "blue" },
  ];
  return <div className="summary-grid">{cards.map(({ label, value, sub, icon: Icon, tone }, index) => (
    <motion.div key={label} className={`summary-card summary-card--${tone}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.07 }}>
      <div className="summary-card__head"><span>{label}</span><Icon size={18} /></div>
      <div className="summary-card__value">{value}<ArrowUpRight size={17} /></div>
      <p>{sub}</p>
    </motion.div>
  ))}</div>;
}

function ObligationDetail({ obligation, projected, projection }: { obligation?: Obligation; projected?: ProjectedObligation; projection: TwinProjection }) {
  if (!obligation || !projected) return <div className="detail-empty">Select a settlement leg to inspect its source and dependencies.</div>;
  const predecessors = projection.dependencies.filter((dep) => dep.successorObligationId === obligation.id);
  const successors = projection.dependencies.filter((dep) => dep.predecessorObligationId === obligation.id);
  const from = cascadeImport.accounts.find((account) => account.id === obligation.fromAccountId);
  const to = cascadeImport.accounts.find((account) => account.id === obligation.toAccountId);
  return (
    <AnimatePresence mode="wait"><motion.div key={obligation.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
      <div className="detail-title-row"><div><span className="section-overline">SELECTED OBLIGATION</span><h3>{obligation.externalId.toUpperCase()}</h3></div><StatusPill status={projected.status} /></div>
      <div className="detail-amount-label">Required settlement</div>
      <div className="detail-amount">{formatAssetUnits(obligation.asset, obligation.requiredUnits)}</div>
      <div className="detail-progress"><span style={{ width: `${BigInt(obligation.requiredUnits) === 0n ? 0 : Number(BigInt(projected.settledUnits) * 100n / BigInt(obligation.requiredUnits))}%` }} /></div>
      <div className="detail-progress-label"><span>Settled {formatAssetUnits(obligation.asset, projected.settledUnits)}</span><span>{formatUtc(obligation.dueAt)}</span></div>
      <div className="detail-divider" />
      <div className="detail-meta"><span>FROM</span><strong>{from?.name ?? obligation.fromAccountId}</strong><small>{from ? institutionNames[from.institutionId] : ""}</small></div>
      <div className="detail-route-line"><span /><ArrowRight size={14} /><span /></div>
      <div className="detail-meta"><span>TO</span><strong>{to?.name ?? obligation.toAccountId}</strong><small>{to ? institutionNames[to.institutionId] : ""}</small></div>
      <div className="detail-divider" />
      <div className="detail-list"><span>REASON CODES</span>{projected.reasonCodes.length ? projected.reasonCodes.map((code) => <div className="reason-row" key={code}><span className="reason-icon">!</span>{reasonLabel(code)}</div>) : <p>No reason code supplied.</p>}</div>
      <div className="detail-divider" />
      <div className="detail-list"><span>DEPENDENCY LINKS</span><p>{predecessors.length} incoming · {successors.length} outgoing</p></div>
      <div className="detail-source">Source record: {obligation.sourceRecordIds.join(", ") || "None supplied"}</div>
    </motion.div></AnimatePresence>
  );
}

function ComparisonColumn({ title, eyebrow, projection, obligations, isPending }: { title: string; eyebrow: string; projection?: TwinProjection; obligations: Obligation[]; isPending?: boolean }) {
  return <div className={`comparison-column ${isPending ? "comparison-column--pending" : ""}`}>
    <div className="comparison-column__header"><div><span className="section-overline">{eyebrow}</span><h3>{title}</h3></div><div className={`comparison-indicator ${isPending ? "is-pending" : ""}`} /></div>
    {projection ? <>
      <div className="comparison-tally"><strong>{projection.obligations.filter((item) => item.status === "blocked").length}</strong><span>blocked obligations</span></div>
      <div className="comparison-list">{projection.obligations.map((item) => {
        const obligation = obligations.find((entry) => entry.id === item.obligationId);
        return <div className="comparison-row" key={item.obligationId}><span>{obligation?.externalId.toUpperCase() ?? item.obligationId}</span><span>{obligation ? formatAssetUnits(obligation.asset, obligation.requiredUnits) : "—"}</span><StatusPill status={item.status} /></div>;
      })}</div>
    </> : <div className="comparison-placeholder"><div className="placeholder-icon"><Sparkles size={22} /></div><strong>Awaiting simulation</strong><p>Run a scenario to see an engine-derived projection and compare each obligation.</p></div>}
  </div>;
}

function isTwinResponse(value: unknown): value is Extract<GetTwinResponse, { ok: true }> {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  const response = value as { ok?: unknown; data?: { projection?: TwinProjection } };
  return response.ok === true && !!response.data?.projection?.obligations;
}

function isSimulationResponse(value: unknown): value is Extract<RunSimulationResponse, { ok: true }> {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  const response = value as { ok?: unknown; data?: { result?: SimulationResult } };
  return response.ok === true && !!response.data?.result;
}

export function CustodyTwinWorkspace() {
  const [projection, setProjection] = useState<TwinProjection>(cascadeBaselineProjection);
  const [source, setSource] = useState<"fixture" | "api">("fixture");
  const [selectedId, setSelectedId] = useState("obligation-1");
  const [scenarioId, setScenarioId] = useState<(typeof scenarios)[number]["id"]>("full");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId)!;
  const selectedObligation = cascadeSnapshot.obligations.find((obligation) => obligation.id === selectedId);
  const selectedProjection = projection.obligations.find((obligation) => obligation.obligationId === selectedId);
  const activeResult = result?.status === "valid" ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const path = `/api/datasets/${encodeURIComponent(cascadeImport.dataset.id)}/twin?snapshotId=${encodeURIComponent(cascadeSnapshot.id)}`;
    fetch(path, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (isTwinResponse(body) && body.data.projection.datasetId === cascadeImport.dataset.id && body.data.projection.snapshotId === cascadeSnapshot.id && body.data.projection.obligations.every((item) => cascadeSnapshot.obligations.some((obligation) => obligation.id === item.obligationId))) {
        setProjection(body.data.projection);
        setSource("api");
      }
    }).catch(() => { /* Fixture remains visible until Platform is available. */ });
    return () => controller.abort();
  }, []);

  async function runScenario(request: RunSimulationRequest) {
    setRunning(true);
    setNotice(null);
    setResult(null);
    try {
      const response = await fetch(`/api/datasets/${encodeURIComponent(request.datasetId)}/simulations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const body: unknown = await response.json();
      if (!isSimulationResponse(body)) {
        const message = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error ? String(body.error.message) : "Simulation service is not available yet.";
        setNotice(message);
        return;
      }
      const simulation = body.data.result;
      if (simulation.datasetId !== request.datasetId || simulation.baseSnapshotId !== request.baseSnapshotId || !request.interventions.every((intervention) => simulation.interventionIds.includes(intervention.id))) {
        setNotice("Simulation response did not match this snapshot.");
        return;
      }
      setResult(simulation);
      if (simulation.status === "invalid") setNotice(simulation.validationIssues.map((issue) => issue.message).join(" ") || "The intervention was rejected.");
    } catch {
      setNotice("Simulation service is not available yet. The baseline fixture is still shown.");
    } finally {
      setRunning(false);
    }
  }

  function selectScenario(id: (typeof scenarios)[number]["id"]) {
    setScenarioId(id);
    setResult(null);
    setNotice(null);
  }

  const comparison = activeResult?.comparison;

  return <div className="app-shell" id="twin">
    <Navigation />
    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>Custody Twin</strong></div><div className="topbar-actions"><span className="topbar-time"><Clock3 size={14} /> Snapshot {formatUtc(projection.asOf)}</span><span className="topbar-separator" /><div className="topbar-avatar">CO</div></div></header>
      <div className="content-wrap">
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" />THE OPERATIONS INTELLIGENCE LAYER</div><h1>See the <em>ripple effect.</em><br />Before it happens.</h1><p>Trace every settlement dependency, isolate the point of failure, and test a corrective path against the same immutable snapshot.</p><div className="hero-meta"><Badge tone="violet"><span className="live-pulse" />{source === "api" ? "LIVE API PROJECTION" : "SYNTHETIC FIXTURE"}</Badge><span>Snapshot {projection.snapshotId}</span><span className="hero-meta-divider" /><span>Revision {cascadeSnapshot.datasetRevision}</span></div></div><div className="hero-art" aria-hidden="true"><div className="hero-art__orbit orbit-one" /><div className="hero-art__orbit orbit-two" /><div className="hero-art__orbit orbit-three" /><div className="hero-art__center"><BrandMark /></div><span className="hero-art__point point-one" /><span className="hero-art__point point-two" /><span className="hero-art__point point-three" /><span className="hero-art__point point-four" /></div></section>
        <SummaryCards projection={projection} />
        <section className="workspace-section" id="cascade"><div className="section-heading"><div><div className="section-overline">01 / THE NETWORK</div><h2>Settlement dependency map</h2><p>Follow the flow of proceeds across connected obligations.</p></div><div className="section-heading__right"><span className="snapshot-tag"><span />BASELINE SNAPSHOT</span><Button variant="outline" size="sm" onClick={() => setSelectedId("obligation-1")}><RotateCcw size={14} /> Reset focus</Button></div></div>
          <Card className="graph-card"><div className="graph-main"><div className="graph-toolbar"><div className="graph-toolbar__title"><span className="graph-toolbar__icon"><GitBranch size={17} /></span><div><strong>Three-leg settlement cascade</strong><small>{cascadeImport.dataset.name} · {projection.obligations.length} obligations</small></div></div><div className="graph-legend"><span><i className="legend-dot legend-dot--danger" />Blocked</span><span><i className="legend-line" />Dependency</span><span className="graph-hint"><Maximize2 size={14} /> Scroll to zoom</span></div></div><SettlementGraph projection={projection} obligations={cascadeSnapshot.obligations} accountNames={accountNames} selectedId={selectedId} onSelect={setSelectedId} /><div className="graph-footer"><span><span className="graph-footer__pulse" />Dependency direction follows settlement proceeds</span><span>Click an obligation to inspect</span></div></div><aside className="detail-panel" aria-label="Selected obligation details"><label className="detail-select-label" htmlFor="obligation-select">INSPECT OBLIGATION</label><select id="obligation-select" className="detail-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{cascadeSnapshot.obligations.map((obligation) => <option key={obligation.id} value={obligation.id}>{obligation.externalId.toUpperCase()}</option>)}</select><ObligationDetail obligation={selectedObligation} projected={selectedProjection} projection={projection} /></aside></Card>
        </section>
        <section className="workspace-section scenario-section" id="scenario"><div className="section-heading"><div><div className="section-overline">02 / WHAT-IF ANALYSIS</div><h2>Test an intervention</h2><p>Choose a contract fixture scenario and request an engine calculation.</p></div><Badge tone="neutral"><ShieldCheck size={14} /> SIMULATION ONLY</Badge></div>
          <div className="scenario-layout"><Card className="scenario-card"><div className="scenario-card__header"><div className="scenario-number">01—02</div><div><span className="section-overline">SCENARIO BUILDER</span><h3>Funding the first leg</h3><p>The source account has USD 90.00 settled against a USD 100.00 obligation. The fixture includes a separate USD 20.00 uncommitted reserve.</p></div></div><div className="scenario-options" role="radiogroup" aria-label="Choose a scenario">{scenarios.map((scenario) => <button key={scenario.id} type="button" role="radio" aria-checked={scenarioId === scenario.id} disabled={running} className={`scenario-option ${scenarioId === scenario.id ? "is-selected" : ""}`} onClick={() => selectScenario(scenario.id)}><span className="scenario-radio">{scenarioId === scenario.id && <Check size={12} />}</span><span><strong>{scenario.name}</strong><small>{scenario.description}</small></span><ArrowUpRight size={16} /></button>)}</div><div className="scenario-card__bottom"><div><span>Intervention</span><strong>Cash transfer · {formatAssetUnits({ kind: "cash", currency: "USD" }, selectedScenario.request.interventions[0].kind === "cash_transfer" ? selectedScenario.request.interventions[0].amount.minorUnits : "0")}</strong></div><Button onClick={() => runScenario(selectedScenario.request)} disabled={running}><Play size={15} fill="currentColor" />{running ? "Running…" : "Run simulation"}</Button></div>{notice && <div className="scenario-notice" role="status"><CircleHelp size={17} /><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={14} /></button></div>}</Card><Card className="scenario-context"><div className="context-illustration"><span className="context-node context-node--first">A</span><span className="context-path" /><span className="context-node">B</span><span className="context-path" /><span className="context-node">C</span><span className="context-path" /><span className="context-node">D</span></div><span className="section-overline">HOW TO READ THIS SCENARIO</span><h3>One shortfall.<br /><em>A network of consequences.</em></h3><p>The baseline projection identifies a cash shortfall at the first obligation and upstream blockage on both successors. Simulation is the authority for whether an intervention changes those states.</p><div className="context-note"><Sparkles size={17} /><span>Scenario requests do not assert a financial outcome.</span></div></Card></div>
        </section>
        <section className="workspace-section comparison-section" id="comparison"><div className="section-heading"><div><div className="section-overline">03 / DECISION VIEW</div><h2>Compare the paths</h2><p>Review the unchanged baseline beside the simulation service’s projected state.</p></div>{activeResult && <Badge tone="success"><Check size={14} /> ENGINE RESULT</Badge>}</div><Card className="comparison-card"><ComparisonColumn title="Current state" eyebrow="BASELINE / SNAPSHOT" projection={activeResult?.baseline ?? projection} obligations={cascadeSnapshot.obligations} /><div className="comparison-divider"><div><ArrowRight size={18} /></div></div><ComparisonColumn title="With intervention" eyebrow="PROJECTED / SIMULATION" projection={activeResult?.projected} obligations={cascadeSnapshot.obligations} isPending={!activeResult} /></Card>{comparison && <div className="comparison-insight"><div className="comparison-insight__icon"><Activity size={18} /></div><div><strong>Engine comparison</strong><span>{comparison.newlySettledObligationIds.length} newly settled · {comparison.stillBlockedObligationIds.length} still blocked · {comparison.newlyAtRiskObligationIds.length} newly at risk</span></div><span>Result {activeResult?.id}</span></div>}{!activeResult && <div className="comparison-disclaimer"><ShieldCheck size={16} /> No projected outcome is displayed until the simulation API returns a valid, matching result.</div>}</section>
        <footer className="page-footer"><span><BrandMark /> CustodyOS · Institutional operations, made visible.</span><span>Sandbox workspace <span className="footer-dot">·</span> Contract v1.0.0</span></footer>
      </div>
    </main>
  </div>;
}
