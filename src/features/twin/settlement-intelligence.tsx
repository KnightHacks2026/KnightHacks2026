"use client";

import { useEffect, useState } from "react";
import type { ApiResponse, Explanation, GetExplanationResponse } from "../../contracts";
import { CONTRACT_VERSION } from "../../contracts";
import { cascadeImport } from "../../contracts/fixtures";
import type { Recommendation, RecommendationsData } from "../../lib/ai/intelligence";
import { formatAssetUnits, reasonLabel } from "./format";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const accountNames = Object.fromEntries(cascadeImport.accounts.map((account) => [account.id, account.name]));

function recommendationTitle(item: Recommendation) {
  const intervention = item.intervention;
  if (intervention.kind === "cash_transfer") {
    const amount = formatAssetUnits({ kind: "cash", currency: intervention.amount.currency }, intervention.amount.minorUnits);
    return `Transfer ${amount} from ${accountNames[intervention.sourceAccountId] ?? intervention.sourceAccountId} to ${accountNames[intervention.targetAccountId] ?? intervention.targetAccountId}`;
  }
  return `Prioritize ${intervention.obligationId} ahead of ${intervention.aheadOfObligationId}`;
}

function errorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value) {
    const error = value.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return fallback;
}

function isExplanation(value: unknown, datasetId: string, obligationId: string): value is Extract<GetExplanationResponse, { ok: true }> {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("data" in value)) return false;
  const data = value.data as { explanation?: Explanation } | null;
  const explanation = data?.explanation;
  if (!explanation) return false;
  return explanation.datasetId === datasetId
    && explanation.subject.kind === "obligation"
    && explanation.subject.id === obligationId
    && typeof explanation.summary === "string";
}

function isRecommendations(value: unknown, snapshotId: string): value is Extract<ApiResponse<RecommendationsData>, { ok: true }> {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("data" in value)) return false;
  const data = value.data as RecommendationsData | null;
  return !!data && data.snapshotId === snapshotId && Array.isArray(data.recommendations);
}

export function SettlementIntelligence({ datasetId, snapshotId, obligationId }: {
  datasetId: string;
  snapshotId: string;
  obligationId: string;
}) {
  const [explanation, setExplanation] = useState<LoadState<Explanation>>({ status: "loading" });
  const [recommendations, setRecommendations] = useState<LoadState<Recommendation[]>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setExplanation({ status: "loading" });
    fetch(`/api/datasets/${encodeURIComponent(datasetId)}/explanations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: CONTRACT_VERSION, datasetId, subject: { kind: "obligation", id: obligationId } }),
      signal: controller.signal,
    }).then(async (response) => {
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !isExplanation(body, datasetId, obligationId)) {
        setExplanation({ status: "error", message: errorMessage(body, "An explanation is unavailable for this obligation.") });
        return;
      }
      setExplanation({ status: "ready", data: body.data.explanation });
    }).catch(() => {
      if (!controller.signal.aborted) setExplanation({ status: "error", message: "Could not load the explanation." });
    });
    return () => controller.abort();
  }, [datasetId, obligationId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/datasets/${encodeURIComponent(datasetId)}/recommendations?contractVersion=${CONTRACT_VERSION}`, {
      signal: controller.signal,
    }).then(async (response) => {
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !isRecommendations(body, snapshotId)) {
        setRecommendations({ status: "error", message: errorMessage(body, "Recommendations are unavailable for this snapshot.") });
        return;
      }
      setRecommendations({ status: "ready", data: body.data.recommendations });
    }).catch(() => {
      if (!controller.signal.aborted) setRecommendations({ status: "error", message: "Could not load recommendations." });
    });
    return () => controller.abort();
  }, [datasetId, snapshotId]);

  return <section className="cc-intelligence" aria-label="Settlement intelligence">
    <div className="cc-panel cc-intelligence-card">
      <div className="cc-panel-heading"><div><span className="cc-kicker">EVIDENCE</span><h2>Why this leg is blocked</h2></div><span className="cc-baseline">RULE BASED</span></div>
      {explanation.status === "loading" && <p className="cc-intelligence-state">Loading explanation…</p>}
      {explanation.status === "error" && <p className="cc-intelligence-state" role="status">{explanation.message}</p>}
      {explanation.status === "ready" && <div className="cc-intelligence-body">
        <p>{explanation.data.summary}</p>
        <div className="cc-evidence-list"><strong>Reason codes</strong><span>{explanation.data.reasonCodes.map(reasonLabel).join(" · ") || "None supplied"}</span></div>
        <div className="cc-evidence-list"><strong>Source records</strong><span>{explanation.data.sourceRecordIds.join(", ") || "None supplied"}</span></div>
      </div>}
    </div>
    <div className="cc-panel cc-intelligence-card">
      <div className="cc-panel-heading"><div><span className="cc-kicker">SNAPSHOT-WIDE OPTIONS</span><h2>Possible interventions</h2></div><span className="cc-baseline">REVIEW REQUIRED</span></div>
      {recommendations.status === "loading" && <p className="cc-intelligence-state">Checking interventions…</p>}
      {recommendations.status === "error" && <p className="cc-intelligence-state" role="status">{recommendations.message}</p>}
      {recommendations.status === "ready" && (recommendations.data.length === 0
        ? <p className="cc-intelligence-state">No intervention met the current evidence and custody checks.</p>
        : <div className="cc-recommendation-list">{recommendations.data.map((item) => <article key={item.id}>
          <strong>{item.kind === "cash_transfer" ? "Funding option" : "Priority option"}</strong>
          <p>{recommendationTitle(item)}</p>
          <span>{item.comparison.blockedCountBefore} blocked → {item.comparison.blockedCountAfter} blocked in the engine projection</span>
          <small>Simulated only · Analyst review required</small>
        </article>)}</div>)}
    </div>
  </section>;
}
