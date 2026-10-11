"use client";

import { useEffect, useMemo, useState } from "react";
import { CONTRACT_VERSION, type Explanation, type Obligation, type RunSimulationResponse } from "@/contracts";
import type { Recommendation, RecommendationsData } from "@/lib/ai/intelligence";
import { formatAssetUnits, reasonLabel } from "@/features/twin/format";
import type { PortfolioDataset } from "./portfolio-inventory";

type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = body.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

function formatDueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

function isRelevantRecommendation(item: Recommendation, obligation: Obligation) {
  if (item.comparison.newlySettledObligationIds.includes(obligation.id)) return true;
  return item.intervention.kind === "cash_transfer"
    ? item.intervention.targetAccountId === obligation.fromAccountId
      && obligation.asset.kind === "cash"
      && item.intervention.amount.currency === obligation.asset.currency
    : item.intervention.obligationId === obligation.id || item.intervention.aheadOfObligationId === obligation.id;
}

export function ObligationRiskReview({ dataset, obligation, onClose }: {
  dataset: PortfolioDataset;
  obligation: Obligation;
  onClose: () => void;
}) {
  const [explanation, setExplanation] = useState<LoadState<Explanation>>({ status: "loading" });
  const [recommendations, setRecommendations] = useState<LoadState<Recommendation[]>>({ status: "loading" });
  const [simulation, setSimulation] = useState<LoadState<Extract<RunSimulationResponse, { ok: true }>["data"]["result"]> | null>(null);
  const [runningIntervention, setRunningIntervention] = useState("");
  const accountNames = useMemo(() => new Map(dataset.accounts.map(account => [account.id, account.name])), [dataset.accounts]);
  const downstreamCount = dataset.dependencies.filter(edge => edge.predecessorObligationId === obligation.id).length;
  const selectedAsset = obligation.asset.kind === "cash"
    ? { kind: "cash" as const, currency: obligation.asset.currency }
    : { kind: "security" as const, instrumentId: obligation.asset.instrumentId };
  const instrumentId = obligation.asset.kind === "security" ? obligation.asset.instrumentId : undefined;
  const instrumentSymbol = instrumentId
    ? dataset.instruments.find(item => item.id === instrumentId)?.symbol
    : undefined;
  const cashCurrency = obligation.asset.kind === "cash" ? obligation.asset.currency : undefined;
  const cashBalance = cashCurrency
    ? dataset.snapshot.cashBalances.find(balance => balance.accountId === obligation.fromAccountId && balance.currency === cashCurrency)
    : undefined;
  const remainingUnits = BigInt(obligation.requiredUnits) - BigInt(obligation.settledUnits);
  const availableCashUnits = cashBalance ? BigInt(cashBalance.settledMinorUnits) - BigInt(cashBalance.reservedMinorUnits) : null;
  const fundingGapUnits = availableCashUnits === null ? null : remainingUnits - availableCashUnits > 0n ? remainingUnits - availableCashUnits : 0n;

  useEffect(() => {
    const controller = new AbortController();
    setExplanation({ status: "loading" });
    setRecommendations({ status: "loading" });
    setSimulation(null);
    const explanationRequest = fetch(`/api/datasets/${encodeURIComponent(dataset.dataset.id)}/explanations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: CONTRACT_VERSION, datasetId: dataset.dataset.id, subject: { kind: "obligation", id: obligation.id } }),
      signal: controller.signal,
    }).then(async response => {
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true || !("data" in body)) {
        throw new Error(responseError(body, "The obligation explanation is unavailable."));
      }
      const data = body.data as { explanation?: Explanation };
      if (!data.explanation || data.explanation.datasetId !== dataset.dataset.id
        || data.explanation.subject.kind !== "obligation" || data.explanation.subject.id !== obligation.id) {
        throw new Error("The explanation did not match this obligation.");
      }
      setExplanation({ status: "ready", data: data.explanation });
    }).catch(error => {
      if (!controller.signal.aborted) setExplanation({ status: "error", message: error instanceof Error ? error.message : "The obligation explanation is unavailable." });
    });
    const recommendationRequest = fetch(`/api/datasets/${encodeURIComponent(dataset.dataset.id)}/recommendations?contractVersion=${CONTRACT_VERSION}`, { signal: controller.signal })
      .then(async response => {
        const body: unknown = await response.json();
        if (!response.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true || !("data" in body)) {
          throw new Error(responseError(body, "Interventions are unavailable for this snapshot."));
        }
        const data = body.data as RecommendationsData;
        if (data.snapshotId !== dataset.snapshot.id || !Array.isArray(data.recommendations)) throw new Error("Interventions did not match the current snapshot.");
        setRecommendations({ status: "ready", data: data.recommendations.filter(item => isRelevantRecommendation(item, obligation)) });
      }).catch(error => {
        if (!controller.signal.aborted) setRecommendations({ status: "error", message: error instanceof Error ? error.message : "Interventions are unavailable for this snapshot." });
      });
    void Promise.all([explanationRequest, recommendationRequest]);
    return () => controller.abort();
  }, [dataset.dataset.id, dataset.snapshot.id, obligation]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !runningIntervention) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, runningIntervention]);

  async function runSimulation(recommendation: Recommendation) {
    setRunningIntervention(recommendation.intervention.id);
    setSimulation({ status: "loading" });
    try {
      const response = await fetch(`/api/datasets/${encodeURIComponent(dataset.dataset.id)}/simulations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          datasetId: dataset.dataset.id,
          expectedDatasetRevision: dataset.dataset.revision,
          baseSnapshotId: dataset.snapshot.id,
          interventions: [recommendation.intervention],
        }),
      });
      const body = await response.json() as RunSimulationResponse;
      if (!response.ok || !body.ok) throw new Error(body.ok ? `Simulation failed (${response.status}).` : body.error.message);
      if (body.data.result.datasetId !== dataset.dataset.id || body.data.result.baseSnapshotId !== dataset.snapshot.id) throw new Error("Simulation result did not match this dataset snapshot.");
      setSimulation({ status: "ready", data: body.data.result });
    } catch (error) {
      setSimulation({ status: "error", message: error instanceof Error ? error.message : "Simulation could not be completed." });
    } finally {
      setRunningIntervention("");
    }
  }

  const projectedObligation = simulation?.status === "ready" && simulation.data.status === "valid"
    ? simulation.data.projected.obligations.find(item => item.obligationId === obligation.id)
    : undefined;
  const baselineObligation = simulation?.status === "ready" && simulation.data.status === "valid"
    ? simulation.data.baseline.obligations.find(item => item.obligationId === obligation.id)
    : undefined;

  return <div className="risk-review-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !runningIntervention) onClose(); }}>
    <aside className="risk-review-panel" role="dialog" aria-modal="true" aria-labelledby="risk-review-title">
      <header className="risk-review-head"><div><p className="eyebrow">OBLIGATION REVIEW / {dataset.dataset.name}</p><h2 id="risk-review-title">{obligation.externalId}</h2><span>{obligation.id}</span></div><button type="button" aria-label="Close obligation review" onClick={onClose} disabled={!!runningIntervention}>×</button></header>
      <div className="risk-review-summary">
        <div><span>STATUS</span><strong className={`risk-state ${obligation.status}`}>{obligation.status.replaceAll("_", " ")}</strong></div>
        <div><span>REMAINING</span><strong>{formatAssetUnits(selectedAsset, (BigInt(obligation.requiredUnits) - BigInt(obligation.settledUnits)).toString() as `${bigint}`, instrumentSymbol)}</strong></div>
        <div><span>DUE</span><strong>{formatDueDate(obligation.dueAt)}</strong></div>
      </div>
      <div className="risk-review-context"><span>{accountNames.get(obligation.fromAccountId) ?? obligation.fromAccountId} → {accountNames.get(obligation.toAccountId) ?? obligation.toAccountId}</span><span>{downstreamCount} downstream obligation{downstreamCount === 1 ? "" : "s"}</span><span>Snapshot {dataset.snapshot.id}</span></div>
      <section className="risk-review-section"><div className="risk-review-section-title"><span>WHY IT NEEDS REVIEW</span><em>{explanation.status === "ready" ? explanation.data.model : "EVIDENCE"}</em></div>
        {explanation.status === "loading" && <p role="status">Loading obligation evidence…</p>}
        {explanation.status === "error" && <p className="risk-review-error" role="alert">{explanation.message}</p>}
        {explanation.status === "ready" && <>
          <div className="risk-cause-heading"><span>{explanation.data.reasonCodes[0] ? reasonLabel(explanation.data.reasonCodes[0]) : "Operational risk"}</span><h3>{explanation.data.reasonCodes.includes("CASH_SHORTFALL") ? "Available cash is below the amount needed to settle." : explanation.data.summary.split(".")[0]}</h3></div>
          {explanation.data.reasonCodes.includes("CASH_SHORTFALL") && obligation.asset.kind === "cash" && <div className="risk-cash-gap" aria-label="Cash shortfall calculation">
            <div><span>AVAILABLE SETTLED CASH</span><strong>{availableCashUnits === null ? "Not provided" : formatAssetUnits(selectedAsset, availableCashUnits.toString() as `${bigint}`)}</strong></div>
            <i aria-hidden="true">→</i>
            <div><span>REQUIRED TO SETTLE</span><strong>{formatAssetUnits(selectedAsset, remainingUnits.toString() as `${bigint}`)}</strong></div>
            <div className="risk-gap-total"><span>FUNDING GAP</span><strong>{fundingGapUnits === null ? "Not available" : formatAssetUnits(selectedAsset, fundingGapUnits.toString() as `${bigint}`)}</strong></div>
          </div>}
          {explanation.data.reasonCodes.length > 1 && <div className="risk-reason-tags" aria-label="Additional reasons">{explanation.data.reasonCodes.slice(1).map(code => <span key={code}>{reasonLabel(code)}</span>)}</div>}
          <details className="risk-evidence-details"><summary>Rule explanation and source evidence</summary><p>{explanation.data.summary}</p><dl><div><dt>Source records</dt><dd>{explanation.data.sourceRecordIds.length ? explanation.data.sourceRecordIds.map(id => <code key={id}>{id}</code>) : "None attached"}</dd></div></dl></details>
        </>}
      </section>
      <section className="risk-review-section"><div className="risk-review-section-title"><span>AVAILABLE INTERVENTIONS</span><em>HUMAN REVIEW REQUIRED</em></div>
        {recommendations.status === "loading" && <p role="status">Checking evidence-backed interventions…</p>}
        {recommendations.status === "error" && <p className="risk-review-error" role="alert">{recommendations.message}</p>}
        {recommendations.status === "ready" && (recommendations.data.length === 0
          ? <p>No intervention currently improves this obligation in the deterministic model.</p>
          : recommendations.data.map(item => <article className="risk-recommendation" key={item.id}>
            <span>{item.kind === "cash_transfer" ? "FUNDING SIMULATION" : "SETTLEMENT PRIORITY"}</span><p>{item.summary}</p><small>{item.rationale}</small>
            <button type="button" className="button primary" onClick={() => void runSimulation(item)} disabled={!!runningIntervention}>{runningIntervention === item.intervention.id ? "Running simulation…" : "Simulate this intervention"}</button>
          </article>))}
      </section>
      {simulation && <section className="risk-review-section risk-simulation-result" aria-live="polite"><div className="risk-review-section-title"><span>PROJECTED OUTCOME</span><em>NO DATA CHANGED</em></div>
        {simulation.status === "loading" && <p role="status">Running the settlement model…</p>}
        {simulation.status === "error" && <p className="risk-review-error" role="alert">{simulation.message}</p>}
        {simulation.status === "ready" && (simulation.data.status === "invalid"
          ? <p className="risk-review-error">Simulation rejected: {simulation.data.validationIssues.map(issue => issue.message).join(" ")}</p>
          : <><div className="risk-result-metrics"><div><span>BLOCKED OBLIGATIONS</span><strong>{simulation.data.comparison.blockedCountBefore} → {simulation.data.comparison.blockedCountAfter}</strong></div><div><span>THIS OBLIGATION</span><strong>{baselineObligation?.status ?? obligation.status} → {projectedObligation?.status ?? "unchanged"}</strong></div></div><p>{simulation.data.comparison.newlySettledObligationIds.length} newly settled in projection · {simulation.data.comparison.stillBlockedObligationIds.length} remain blocked.</p><small>Deterministic projection against {dataset.snapshot.id}. No balances, obligations, or transfers were changed.</small></>)}
      </section>}
      <p className="risk-review-disclosure">This view supports investigation and simulation. It does not approve or execute a financial transfer.</p>
    </aside>
  </div>;
}
