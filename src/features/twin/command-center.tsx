"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { Activity, ArrowRight, Check, ChevronDown, CircleHelp, GitBranch, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { DecimalInteger, GetTwinResponse, RunSimulationRequest, RunSimulationResponse, SimulationResult, TwinProjection } from "../../contracts";
import { cascadeBaselineProjection, cascadeImport, cascadeSnapshot, fullFundingScenario, partialFundingScenario } from "../../contracts/fixtures";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatAssetUnits, formatUtc, reasonLabel } from "./format";
import "./command-center.css";

const SettlementGraph = dynamic(() => import("./settlement-graph").then((module) => module.SettlementGraph), {
  ssr: false, loading: () => <div className="settlement-graph cc-loading">Loading dependency map…</div>,
});
const scenarios = [
  { id: "partial", name: "Partial transfer", detail: "Leaves part of the opening cash gap.", request: partialFundingScenario },
  { id: "full", name: "Full-gap transfer", detail: "Matches the opening shortfall.", request: fullFundingScenario },
] as const;
const accounts = Object.fromEntries(cascadeImport.accounts.map((account) => [account.id, account.name]));
const cash = { kind: "cash", currency: "USD" } as const;
const amount = (request: RunSimulationRequest) => {
  const intervention = request.interventions[0];
  return intervention.kind === "cash_transfer" ? formatAssetUnits(cash, intervention.amount.minorUnits) : "—";
};
function isTwinResponse(value: unknown): value is Extract<GetTwinResponse, { ok: true }> {
  const response = value as { ok?: unknown; data?: { projection?: TwinProjection } } | null;
  return response?.ok === true && !!response.data?.projection?.obligations;
}
function isSimulationResponse(value: unknown): value is Extract<RunSimulationResponse, { ok: true }> {
  const response = value as { ok?: unknown; data?: { result?: SimulationResult } } | null;
  return response?.ok === true && !!response.data?.result;
}
function ProjectionRows({ projection }: { projection?: TwinProjection }) {
  if (!projection) return <p className="cc-empty">Run a scenario to view an engine calculated projection.</p>;
  return <div className="cc-projection-rows">{projection.obligations.map((item) => {
    const obligation = cascadeSnapshot.obligations.find((entry) => entry.id === item.obligationId);
    return <div className="cc-projection-row" key={item.obligationId}>
      <strong>{obligation?.externalId.toUpperCase() ?? item.obligationId}</strong>
      <span>{obligation ? `${accounts[obligation.fromAccountId]} → ${accounts[obligation.toAccountId]}` : "Unknown route"}</span>
      <Badge tone={item.status === "blocked" ? "danger" : item.status === "settled" ? "success" : "neutral"}>{item.status.replace("_", " ")}</Badge>
    </div>;
  })}</div>;
}

export function CustodyTwinWorkspace() {
  const [projection, setProjection] = useState<TwinProjection>(cascadeBaselineProjection);
  const [source, setSource] = useState<"fixture" | "api">("fixture");
  const [selectedId, setSelectedId] = useState("obligation-1");
  const [scenarioId, setScenarioId] = useState<(typeof scenarios)[number]["id"]>("full");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scenario = scenarios.find((entry) => entry.id === scenarioId)!;
  const activeResult = result?.status === "valid" ? result : null;
  const root = cascadeSnapshot.obligations.find((item) => projection.obligations.some((projected) => projected.obligationId === item.id && projected.reasonCodes.includes("CASH_SHORTFALL")));
  const balance = root && projection.cashBalances.find((item) => item.accountId === root.fromAccountId && root.asset.kind === "cash" && item.currency === root.asset.currency);
  const reserve = projection.cashBalances.find((item) => item.accountId === "acct-reserve" && item.currency === "USD");
  const shortfall = root && balance ? BigInt(root.requiredUnits) - BigInt(balance.settledMinorUnits) + BigInt(balance.reservedMinorUnits) : null;
  const shortfallUnits = shortfall?.toString() as DecimalInteger | undefined;
  const blocked = projection.obligations.filter((item) => item.status === "blocked").length;
  const downstream = projection.obligations.filter((item) => item.reasonCodes.includes("UPSTREAM_SETTLEMENT_BLOCKED")).length;
  const selected = cascadeSnapshot.obligations.find((item) => item.id === selectedId);
  const selectedProjection = projection.obligations.find((item) => item.obligationId === selectedId);

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
    }).catch(() => { /* The labeled fixture remains visible while the API is unavailable. */ });
    return () => controller.abort();
  }, []);

  async function runScenario(request: RunSimulationRequest) {
    setRunning(true); setNotice(null); setResult(null);
    try {
      const response = await fetch(`/api/datasets/${encodeURIComponent(request.datasetId)}/simulations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const body: unknown = await response.json();
      if (!isSimulationResponse(body)) {
        const message = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error ? String(body.error.message) : "Simulation service is not available yet.";
        setNotice(message); return;
      }
      const simulation = body.data.result;
      if (simulation.datasetId !== request.datasetId || simulation.baseSnapshotId !== request.baseSnapshotId || !request.interventions.every((item) => simulation.interventionIds.includes(item.id))) {
        setNotice("Simulation response did not match this snapshot."); return;
      }
      setResult(simulation);
      if (simulation.status === "invalid") setNotice(simulation.validationIssues.map((item) => item.message).join(" ") || "The intervention was rejected.");
    } catch {
      setNotice("Simulation service is not available yet. The baseline fixture is still shown.");
    } finally { setRunning(false); }
  }

  return <div className="cc-shell" id="twin">
    <aside className="cc-sidebar" aria-label="Workspace navigation">
      <a className="cc-brand" href="#twin"><span className="cc-brand-mark">C</span>CustodyOS</a>
      <div className="cc-institution"><span className="cc-kicker">INSTITUTIONAL CUSTODY</span><strong>Demo Custodian <ChevronDown size={13} /></strong></div>
      <span className="cc-nav-label">WORKSPACE</span>
      <nav className="cc-nav"><a className="is-active" href="#twin"><Activity size={16} />Command center</a><a href="#cascade"><GitBranch size={16} />Digital twin</a><a href="#scenario"><ArrowRight size={16} />Scenarios</a></nav>
      <div className="cc-sidebar-bottom"><span className="cc-avatar">CO</span><div><strong>Custody Operations</strong><small>Operations analyst</small></div></div>
    </aside>
    <main className="cc-main">
      <div className="cc-toolbar"><span>OPERATIONS &nbsp;/&nbsp; COMMAND CENTER</span><span className="cc-snapshot"><strong>{source === "api" ? "API PROJECTION" : "SYNTHETIC FIXTURE"}</strong><span>{formatUtc(projection.asOf)}</span></span></div>
      <div className="cc-heading"><div><h1>Three-leg settlement cascade</h1><p>Start at the first failed obligation and trace downstream settlement impact.</p></div><div className="cc-heading-context"><strong>SETTLEMENT RISK · SANDBOX</strong><span>Fixed synthetic snapshot</span></div></div>
      <motion.section className="cc-panel cc-risk" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }} aria-label="Settlement risk summary">
        <div className="cc-risk-copy"><span className="cc-alert">!</span><div><h2>{root && shortfall !== null && shortfall > 0n && shortfallUnits ? `One ${formatAssetUnits(root.asset, shortfallUnits)} cash shortfall blocks ${blocked} obligations.` : `${blocked} obligations require review.`}</h2><p>{root && balance ? `${accounts[root.fromAccountId]} has ${formatAssetUnits(root.asset, balance.settledMinorUnits)} against ${formatAssetUnits(root.asset, root.requiredUnits)} due; ${downstream} downstream legs depend on its proceeds.` : "Review the baseline projection and settlement dependencies."}</p></div></div>
        <div className="cc-metrics"><div><strong>{blocked}</strong><span>blocked obligations</span></div><div><strong>{root && shortfall !== null && shortfall > 0n && shortfallUnits ? formatAssetUnits(root.asset, shortfallUnits) : "—"}</strong><span>initial shortfall</span></div><div><strong>{downstream}</strong><span>downstream exposed</span></div></div>
      </motion.section>
      <div className="cc-workspace">
        <div className="cc-left">
          <motion.section className="cc-panel cc-chain" id="cascade" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1, duration: .45 }}>
            <div className="cc-panel-heading"><div><h2>Dependency chain</h2><p>Cash obligations · ordered by due time</p></div><span className="cc-baseline">BASELINE · NO INTERVENTION</span></div>
            <div className="cc-graph-label"><span>EARLIEST DUE FIRST</span><button type="button" onClick={() => setSelectedId("obligation-1")}><RotateCcw size={13} />Reset focus</button></div>
            <SettlementGraph projection={projection} obligations={cascadeSnapshot.obligations} accountNames={accounts} selectedId={selectedId} onSelect={setSelectedId} />
            <div className="cc-balances"><div><span>{root ? accounts[root.fromAccountId] : "Origin"} · available cash</span><strong className="cc-danger">{balance ? formatAssetUnits(cash, balance.settledMinorUnits) : "—"}</strong></div><div><span>Settlement due</span><strong>{root ? formatAssetUnits(root.asset, root.requiredUnits) : "—"}</strong></div><div><span>Uncommitted reserve</span><strong>{reserve ? formatAssetUnits(cash, reserve.settledMinorUnits) : "—"}</strong></div></div>
          </motion.section>
          <motion.section className="cc-panel cc-obligations" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .16, duration: .45 }}>
            <div className="cc-panel-heading"><div><h2>Obligation details</h2><p>Baseline status and timing for each leg</p></div><span className="cc-row-count">{projection.obligations.length} obligations</span></div>
            <div className="cc-table-wrap"><table><thead><tr><th>LEG</th><th>ROUTE</th><th>AMOUNT</th><th>DUE</th><th>BASELINE STATUS</th></tr></thead><tbody>{cascadeSnapshot.obligations.map((obligation) => {
              const item = projection.obligations.find((entry) => entry.obligationId === obligation.id);
              return <tr key={obligation.id} className={selectedId === obligation.id ? "is-selected" : ""}><td><button type="button" onClick={() => setSelectedId(obligation.id)}>{obligation.externalId.toUpperCase()}</button></td><td>{accounts[obligation.fromAccountId]} → {accounts[obligation.toAccountId]}</td><td>{formatAssetUnits(obligation.asset, obligation.requiredUnits)}</td><td>{formatUtc(obligation.dueAt)}</td><td>{item && <Badge tone={item.reasonCodes.includes("UPSTREAM_SETTLEMENT_BLOCKED") ? "warning" : item.status === "blocked" ? "danger" : "success"}>{item.status} · {item.reasonCodes.map(reasonLabel).join(", ")}</Badge>}</td></tr>;
            })}</tbody></table></div>
          </motion.section>
        </div>
        <motion.section className="cc-panel cc-simulator" id="scenario" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .2, duration: .45 }}>
          <div className="cc-sim-heading"><span className="cc-sim-icon"><ArrowRight size={18} /></span><div><h2>Test an intervention</h2><p>Compare against this snapshot</p></div><span className="cc-not-executed">NOT EXECUTED</span></div>
          <div className="cc-sim-disclaimer"><strong>SIMULATION ONLY</strong><span>No funds move; no settlement instruction is created.</span></div>
          <span className="cc-field-label">PROPOSED TRANSFER</span><div className="cc-transfer"><span>Uncommitted Reserve <ArrowRight size={14} /> {root ? accounts[root.fromAccountId] : "Origin"}</span><strong>{amount(scenario.request)}</strong></div>
          <span className="cc-field-label">FIXTURE SCENARIO</span><div className="cc-scenario-list" role="radiogroup" aria-label="Choose a scenario">{scenarios.map((entry) => <button type="button" role="radio" aria-checked={scenarioId === entry.id} disabled={running} key={entry.id} className={`cc-scenario ${scenarioId === entry.id ? "is-selected" : ""}`} onClick={() => { setScenarioId(entry.id); setResult(null); setNotice(null); }}><span className="cc-radio">{scenarioId === entry.id && <Check size={10} />}</span><span><strong>{entry.name} · {amount(entry.request)}</strong><small>{entry.detail}</small></span></button>)}</div>
          <div className="cc-rationale"><strong>WHY THIS SCENARIO</strong><span>Uses {amount(scenario.request)} of the {reserve ? formatAssetUnits(cash, reserve.settledMinorUnits) : "available"} uncommitted reserve. Engine calculates downstream statuses.</span></div>
          <Button className="cc-run" onClick={() => runScenario(scenario.request)} disabled={running}><span>{running ? "Running comparison…" : "Run comparison"}</span><ArrowRight size={16} /></Button>
          <p className="cc-review"><span>●</span>Analyst review required · action remains unexecuted</p>
          <AnimatePresence>{notice && <motion.div className="cc-notice" role="status" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}><CircleHelp size={16} /><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={14} /></button></motion.div>}</AnimatePresence>
        </motion.section>
      </div>
      <section className="cc-lower" aria-label="Inspection and comparison">
        <Card className="cc-panel cc-inspector"><div className="cc-panel-heading"><div><span className="cc-kicker">SELECTED OBLIGATION</span><h2>{selected?.externalId.toUpperCase() ?? "Select a leg"}</h2></div><select aria-label="Inspect obligation" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{cascadeSnapshot.obligations.map((item) => <option key={item.id} value={item.id}>{item.externalId.toUpperCase()}</option>)}</select></div>{selected && selectedProjection && <div className="cc-inspector-body"><div><span>Required settlement</span><strong>{formatAssetUnits(selected.asset, selected.requiredUnits)}</strong></div><div><span>Route</span><strong>{accounts[selected.fromAccountId]} → {accounts[selected.toAccountId]}</strong></div><div><span>Reason</span><strong>{selectedProjection.reasonCodes.map(reasonLabel).join(", ") || "No reason supplied"}</strong></div><div><span>Source record</span><strong>{selected.sourceRecordIds.join(", ") || "None supplied"}</strong></div></div>}</Card>
        <Card className="cc-panel cc-comparison" id="comparison"><div className="cc-panel-heading"><div><span className="cc-kicker">DECISION VIEW</span><h2>Compare the paths</h2></div>{activeResult && <Badge tone="success"><Check size={12} />ENGINE RESULT</Badge>}</div><div className="cc-comparison-grid"><div><span className="cc-kicker">BASELINE / SNAPSHOT</span><h3>Current state</h3><ProjectionRows projection={activeResult?.baseline ?? projection} /></div><div><span className="cc-kicker">PROJECTED / SIMULATION</span><h3>With intervention</h3><ProjectionRows projection={activeResult?.projected} /></div></div>{activeResult?.comparison && <p className="cc-comparison-insight"><Activity size={15} /> {activeResult.comparison.newlySettledObligationIds.length} newly settled · {activeResult.comparison.stillBlockedObligationIds.length} still blocked · {activeResult.comparison.newlyAtRiskObligationIds.length} newly at risk</p>}{!activeResult && <p className="cc-review"><ShieldCheck size={14} />No projected outcome is shown until the simulation API returns a valid matching result.</p>}</Card>
      </section>
      <footer className="cc-footer"><span>All values from the fixed synthetic fixture · No live settlement instructions</span><span>CUSTODYOS · SANDBOX</span></footer>
    </main>
  </div>;
}
