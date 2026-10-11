"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSettlementScenario, millions, scenarioLabels, type SettlementScenario, type SettlementView } from "./settlement-adapter";

type Phase = "ready" | "root" | "leg1" | "flow12" | "leg2" | "flow23" | "leg3" | "complete";
const phaseText: Record<Phase, string> = {
  ready: "Select a scenario, then run the synthetic preview",
  root: "Resolving root funding gap",
  leg1: "Projecting LEG-01 settlement",
  flow12: "Propagating proceeds to LEG-02",
  leg2: "Projecting LEG-02 settlement",
  flow23: "Propagating proceeds to LEG-03",
  leg3: "Projecting LEG-03 settlement",
  complete: "Projection complete",
};
const blockedPhaseText: Partial<Record<Phase, string>> = {
  root: "Evaluating remaining root funding gap",
  flow12: "Tracing blocked dependency to LEG-02",
  leg2: "Projecting LEG-02 blocked",
  flow23: "Tracing blocked dependency to LEG-03",
  leg3: "Projecting LEG-03 blocked",
};
function stageDescription(state: SettlementState) {
  if (state.loading) return "Calculating synthetic projection…";
  if (state.error) return "Projection unavailable";
  return state.result && state.result.statuses[0] === "blocked" ? blockedPhaseText[state.phase] ?? phaseText[state.phase] : phaseText[state.phase];
}

const obligations = [
  { id: "LEG-01", from: "Origin · A", to: "Clearing · B", relation: "A → B", time: "14:00", kind: "ROOT LIQUIDITY" },
  { id: "LEG-02", from: "Clearing · B", to: "Intermediate · C", relation: "B → C", time: "14:05", kind: "SETTLEMENT PROCEEDS" },
  { id: "LEG-03", from: "Intermediate · C", to: "Destination · D", relation: "C → D", time: "14:10", kind: "SETTLEMENT PROCEEDS" },
] as const;

export function useSettlementSimulation() {
  const [mode, setMode] = useState(false);
  const [choice, setChoiceState] = useState<SettlementScenario>("baseline");
  const [selected, setSelected] = useState(0);
  const [run, setRun] = useState(0);
  const [active, setActive] = useState<SettlementScenario | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<SettlementView | null>(null);
  const [baseline, setBaseline] = useState<SettlementView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const running = loading || (active !== null && result !== null && phase !== "complete");
  useEffect(() => {
    if (!mode || baseline) return;
    const controller = new AbortController();
    void fetchSettlementScenario("baseline", controller.signal).then(setBaseline).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Baseline unavailable.");
    });
    return () => controller.abort();
  }, [mode, baseline]);
  useEffect(() => {
    if (!run || !result) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers = result.sequence.map((step, index) => window.setTimeout(() => setPhase(step), (index + 1) * 520));
    return () => timers.forEach(window.clearTimeout);
  }, [run, result]);
  useEffect(() => () => requestRef.current?.abort(), []);
  const setChoice = (next: SettlementScenario) => {
    if (running) return;
    setChoiceState(next);
    setActive(null);
    setResult(null);
    setError("");
    setPhase("ready");
  };
  const runPreview = async () => {
    if (running) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    setActive(null);
    setResult(null);
    setPhase("ready");
    try {
      const base = baseline ?? await fetchSettlementScenario("baseline", controller.signal);
      if (controller.signal.aborted) return;
      setBaseline(base);
      const next = choice === "baseline" ? await fetchSettlementScenario("baseline", controller.signal) : await fetchSettlementScenario(choice, controller.signal);
      if (controller.signal.aborted) return;
      if (choice === "baseline") setBaseline(next);
      setResult(next);
      setActive(choice);
      setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "complete" : "ready");
      setRun(value => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Simulation unavailable.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return { mode, setMode, choice, setChoice, selected, setSelected, run, active, phase, running, loading, error, result, baseline, runPreview };
}

export type SettlementState = ReturnType<typeof useSettlementSimulation>;

function reached(state: SettlementState, target: Phase) {
  if (!state.result || !state.active) return false;
  const steps = state.result.sequence;
  return steps.indexOf(target) >= 0 && steps.indexOf(state.phase) >= steps.indexOf(target);
}

function nodeStatus(state: SettlementState, index: number) {
  if (!state.result || !state.active) return index === 0 && state.baseline?.statuses[0] === "blocked" && state.baseline.reasons[0].includes("CASH_SHORTFALL") ? "Liquidity shortfall" : "Awaiting upstream";
  const projected = state.result.statuses[index];
  if (projected === "settled") {
    const target: Phase = index === 0 ? "leg1" : index === 1 ? "leg2" : "leg3";
    return reached(state, target) ? "Projected settled" : index === 0 && reached(state, "root") ? "Gap closed · awaiting settlement" : "Awaiting upstream";
  }
  const target: Phase = index === 0 ? "root" : index === 1 ? "leg2" : "leg3";
  return reached(state, target) ? index === 0 ? state.result.gapMinorUnits < state.baseline!.gapMinorUnits ? "Partially funded" : "Liquidity shortfall" : "Dependency blocked" : "Awaiting upstream";
}

function funding(state: SettlementState) {
  return state.result && reached(state, "root") ? state.result.fundedMinorUnits : state.baseline?.fundedMinorUnits ?? null;
}

export function SettlementCanvas({ state }: { state: SettlementState }) {
  const complete = state.phase === "complete" && state.result !== null;
  const preview = complete ? state.result : null;
  const funded = funding(state);
  const required = state.baseline?.requiredMinorUnits ?? null;
  const gap = funded !== null && required !== null ? required - funded : null;
  const fundedPercent = funded !== null && required !== null ? Number(funded * 100n / required) : null;
  return <section className={`settlement-canvas settlement-canvas--${state.active ?? "baseline"} ${state.running ? "is-running" : ""}`} data-phase={state.phase} aria-label="Settlement simulation workspace">
    <div className="settlement-canvas__topline"><span>SETTLEMENT DEPENDENCY TWIN</span><span><i /> SYNTHETIC PREVIEW · LOCAL DEMO STATE</span></div>
    <div className="settlement-canvas__heading"><div><p className="eyebrow">THREE-LEG CASH SETTLEMENT</p><h2>Watch the cascade</h2><p>One liquidity constraint propagates through a connected $100M obligation chain.</p></div><div className="settlement-canvas__scenario-tag">{scenarioLabels[state.choice]}<small>SELECTED SCENARIO</small></div></div>
    <div className="settlement-toolbar" role="group" aria-label="Scenario">
      {(["baseline", "partial", "full"] as const).map(key => <button type="button" key={key} aria-pressed={state.choice === key} disabled={state.running} onClick={() => state.setChoice(key)}><span className="settlement-toolbar__indicator" />{scenarioLabels[key]}</button>)}
      <button type="button" className="settlement-toolbar__run" disabled={state.running} onClick={() => void state.runPreview()}>{state.loading ? "Calculating preview…" : state.running ? "Running preview…" : state.error ? "Retry Simulation" : complete ? "Replay Simulation" : "Run Simulation"} <span aria-hidden="true">↗</span></button>
    </div>
    <div className="settlement-progress" role="status" aria-live="polite"><span className="settlement-progress__track"><i style={{ width: state.running && state.result ? `${Math.max(8, (state.result.sequence.indexOf(state.phase) + 1) / state.result.sequence.length * 100)}%` : complete ? "100%" : "0%" }} /></span><strong>{stageDescription(state)}</strong></div>
    {state.error && <p role="alert" className="settlement-canvas__note">{state.error} Retry the simulation.</p>}
    <div className="settlement-overview" aria-live="polite">
      <div><span>REMAINING SHORTFALL · SYNTHETIC</span><strong>{gap === null ? "—" : `$${millions(gap)}M`}</strong><small>at root obligation</small></div>
      <div><span>BLOCKED · SYNTHETIC</span><strong>{preview ? preview.blocked : "—"}<em> / 3</em></strong><small>{complete ? "obligations" : "pending projection"}</small></div>
      <div><span>PROJECTED SETTLED · SYNTHETIC</span><strong>{preview ? preview.settled : "—"}<em> / 3</em></strong><small>{complete ? "synthetic preview" : "pending projection"}</small></div>
      <div className="settlement-overview__signal"><span>CHAIN SIGNAL · SYNTHETIC</span><strong>{preview ? preview.settled === 3 ? "FLOW RESTORED" : preview.gapMinorUnits < state.baseline!.gapMinorUnits ? "GAP NARROWED" : "FLOW INTERRUPTED" : "PREVIEW PENDING"}</strong><small>{preview ? `${scenarioLabels[state.active!]} · $${millions(preview.gapMinorUnits)}M gap · ${preview.settled} projected settled · ${preview.blocked} blocked` : "run to reveal scenario result"}</small></div>
    </div>
    <div className="settlement-graph" role="region" aria-label="Three connected settlement obligations">
      <div className="settlement-graph__header"><span>DEPENDENCY PATH <b>01 / 03</b></span><span>USD CASH · $100M EACH · SYNTHETIC</span></div>
      <div className="settlement-graph__flow">
        {obligations.map((obligation, index) => {
          const status = nodeStatus(state, index);
          const target: Phase = index === 0 ? state.result?.statuses[0] === "settled" ? "leg1" : "root" : index === 1 ? "leg2" : "leg3";
          return <div className="settlement-graph__segment" key={obligation.id}>
          <button type="button" className={`settlement-node ${state.selected === index ? "is-selected" : ""} ${index === 0 ? "is-root" : "is-downstream"} ${status === "Projected settled" ? "is-settled" : status === "Partially funded" ? "is-partial" : status === "Dependency blocked" || status === "Liquidity shortfall" ? "is-blocked" : "is-awaiting"} ${state.running && state.phase === target ? "is-current" : ""}`} aria-pressed={state.selected === index} onClick={() => state.setSelected(index)}>
            <span className="settlement-node__eyebrow"><i />{obligation.kind}<small>{obligation.time} UTC</small></span>
            <span className="settlement-node__center"><span className="settlement-node__icon" aria-hidden="true">{index === 0 ? "◈" : "◇"}</span><span><strong>{obligation.id}</strong><small>{obligation.relation} · {obligation.from} to {obligation.to}</small></span></span>
            <span className="settlement-node__amount">$100M <small>NOTIONAL · SYNTHETIC</small></span>
            <span className="settlement-node__status"><i />{status}</span>
          </button>
          {index === 0 && <div className="settlement-root-cause"><b>ROOT CAUSE</b><span>{fundedPercent === null || gap === null ? "Projection pending" : `${fundedPercent}% funded · $${millions(gap)}M gap`}</span></div>}
          {index < 2 && <div className={`settlement-graph__link ${reached(state, index === 0 ? "leg2" : "leg3") ? state.result?.statuses[index + 1] === "settled" ? "is-restored" : state.result && state.baseline && state.result.gapMinorUnits < state.baseline.gapMinorUnits ? "is-partial-blocked" : "is-blocked" : ""} ${state.active && state.phase === (index === 0 ? "flow12" : "flow23") ? "is-propagating" : ""}`} data-signal={state.result?.statuses[index + 1] === "settled" ? "projected-proceeds" : "blocked-dependency"} aria-hidden="true"><span>{state.result?.statuses[index + 1] === "settled" ? "PROCEEDS" : "DEPENDENCY"}</span><svg viewBox="0 0 100 20" preserveAspectRatio="none" focusable="false"><path className="settlement-graph__link-line" d="M 1 10 H 84" /><path className="settlement-graph__link-head" d="M 84 3 L 99 10 L 84 17 Z" /></svg><i /></div>}
        </div>;
        })}
      </div>
      <div className="settlement-graph__foot"><span><i /> Root funding {funded === null ? "—" : `$${millions(funded)}M`} / $100M · SYNTHETIC</span><span>SELECT AN OBLIGATION TO INSPECT ITS DEPENDENCIES</span></div>
    </div>
    <div className="settlement-canvas__note"><span className="settlement-canvas__note-mark">ⓘ</span><span>Synthetic engine projection for demonstration. No transfer or settlement is executed.</span></div>
  </section>;
}

export function SettlementInspector({ state }: { state: SettlementState }) {
  const preview = state.phase === "complete" ? state.result : null;
  const obligation = obligations[state.selected];
  const root = state.selected === 0;
  const status = nodeStatus(state, state.selected);
  const rootFunding = funding(state);
  const rootPercent = rootFunding !== null && state.baseline ? Number(rootFunding * 100n / state.baseline.requiredMinorUnits) : null;
  const rootGap = rootFunding !== null && state.baseline ? state.baseline.requiredMinorUnits - rootFunding : null;
  const settled = status === "Projected settled";
  return <aside className={`settlement-detail settlement-detail--${state.active ?? "baseline"}`} aria-label="Settlement obligation inspector">
    <div className="settlement-detail__kicker"><span>OBLIGATION INSPECTOR</span><span>0{state.selected + 1} / 03</span></div>
    <h2>{obligation.id}</h2><p className="settlement-detail__route">{obligation.from} <span>→</span> {obligation.to}</p>
    <div className="settlement-detail__status"><span>SYNTHETIC PREVIEW STATUS</span><strong><i />{status}</strong><small>{state.running ? stageDescription(state) : preview ? `${scenarioLabels[state.active!]} · complete` : state.error ? "Projection unavailable" : "Scenario preview pending"}</small></div>
    <div className="settlement-detail__section"><div className="settlement-detail__section-head"><span>FUNDING PROGRESS · SYNTHETIC</span><strong>{root ? rootPercent === null ? "—" : `${rootPercent}%` : settled ? "100%" : "Awaiting proceeds"}</strong></div><div className="settlement-detail__meter"><i style={{ width: root ? `${rootPercent ?? 0}%` : settled ? "100%" : "0%" }} /></div><div className="settlement-detail__scale"><span>{root ? rootFunding === null ? "Projection pending" : `$${millions(rootFunding)}M available` : settled ? "$100M projected" : "$0M proceeds"}</span><span>$100M required</span></div></div>
    <div className="settlement-detail__section"><span className="settlement-detail__label">ROOT CAUSE</span><p>{root ? rootGap === null ? "Baseline projection pending." : rootGap > 0n ? `$${millions(rootGap)}M liquidity gap at the origin account.` : "Root liquidity gap closed in this synthetic preview." : "Upstream settlement proceeds are required before this leg can proceed."}</p></div>
    <div className="settlement-detail__section"><span className="settlement-detail__label">DOWNSTREAM DEPENDENCIES</span><div className="settlement-detail__dependencies">{state.selected === 2 ? <span>End of chain · no downstream leg</span> : obligations.slice(state.selected + 1).map(item => <span key={item.id}><i />{item.id}<small>{item.relation}</small></span>)}</div></div>
    <div className="settlement-detail__impact"><span>SCENARIO IMPACT · SYNTHETIC</span><p>{preview ? preview.settled === 3 ? "The root gap closes. Settlement proceeds can flow through all three projected legs." : preview.gapMinorUnits < state.baseline!.gapMinorUnits ? `The root gap narrows to $${millions(preview.gapMinorUnits)}M. All three obligations remain blocked in this synthetic preview.` : `The first obligation lacks $${millions(preview.gapMinorUnits)}M. Settlement proceeds cannot reach the next two legs.` : state.error ? "The projection could not be calculated. Retry the simulation." : "Run the selected scenario to reveal its synthetic outcome."}</p></div>
    <p className="settlement-detail__disclaimer">LOCAL DEMO PREVIEW · NO FINANCIAL ACTION</p>
  </aside>;
}
