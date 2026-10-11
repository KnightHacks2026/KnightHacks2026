"use client";

import { useCallback, useEffect, useState } from "react";
import { CONTRACT_VERSION } from "@/contracts";
import type { PolicyEvaluation, ReviewTransfer } from "@/lib/policy/evaluation";

type ReviewedTransfer = ReviewTransfer & { evaluation: PolicyEvaluation };
type Audit = { id: string; transactionId: string; occurredAt: string; decision: "approve" | "reject";
  reviewerId: string; reason: string; evaluation: PolicyEvaluation };
type Reviews = { transfers: ReviewedTransfer[]; audit: Audit[] };
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

export function PolicyReview({ onDecision }: { onDecision: (id: string, status: ReviewTransfer["status"]) => void }) {
  const [reviews, setReviews] = useState<Reviews | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/transfer/reviews", { cache: "no-store", signal });
    const body = await response.json() as ApiResponse<Reviews>;
    if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to load reviews." : body.error.message);
    setReviews(body.data);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load reviews.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const pending = reviews?.transfers.filter(transfer => transfer.status === "Pending approval") ?? [];
  const selected = pending.find(transfer => transfer.id === selectedId) ?? pending[0];

  async function decide(decision: "approve" | "reject") {
    if (!selected || working) return;
    if (decision === "reject" && !reason.trim()) return setError("Enter a rejection reason.");
    setError(""); setNotice(""); setWorking(true);
    try {
      const response = await fetch(`/api/transfer/reviews/${encodeURIComponent(selected.id)}/decision`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractVersion: CONTRACT_VERSION, decision, expectedRevision: selected.revision, reason: reason.trim() }),
      });
      const body = await response.json() as ApiResponse<{ transfer: ReviewTransfer }>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? `Decision failed (${response.status}).` : body.error.message);
      onDecision(selected.id, body.data.transfer.status);
      setSelectedId(""); setReason("");
      setNotice(`${selected.id} ${body.data.transfer.status.toLowerCase()}. No assets moved.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record decision.");
      try { await refresh(); } catch { /* Preserve the actionable error above. */ }
    } finally { setWorking(false); }
  }

  return <section className="policy-review" aria-label="Local demo transfer review">
    <div className="policy-review-heading"><div><p className="eyebrow">LOCAL DEMO / HUMAN REVIEW</p><h2>Transfer review queue</h2></div><span>Reviewer: local-demo-reviewer · no authentication or role verification</span></div>
    <p className="policy-review-disclosure">Only transfers created through New Transfer appear here. Approval means approved for further processing; it does not execute or settle a transfer. For an approvable synthetic case, use destination <strong>Demo Treasury</strong> and an amount up to 10 asset units. Institutional signer and compliance checks remain unverified.</p>
    {loading && <p role="status" className="policy-review-message">Loading transfer reviews…</p>}
    {error && <p role="alert" className="policy-review-error">{error}</p>}
    {notice && <p role="status" className="policy-review-success">{notice}</p>}
    {!loading && <div className="policy-review-grid">
      <div className="policy-review-list"><div className="policy-review-label">PENDING REQUESTS <span>{pending.length}</span></div>
        {pending.length === 0 && <p className="policy-review-message">No transfer requests await review.</p>}
        {pending.map(transfer => <button key={transfer.id} type="button" className={selected?.id === transfer.id ? "active" : ""} aria-pressed={selected?.id === transfer.id} onClick={() => { setSelectedId(transfer.id); setReason(""); setError(""); }}>
          <strong>{transfer.id}</strong><small>{transfer.amount} {transfer.asset} → {transfer.destination}</small><em>{transfer.evaluation.canApprove ? "Ready for demo review" : "Evidence needed"}</em>
        </button>)}
      </div>
      <div className="policy-review-detail">{selected ? <>
        <p className="eyebrow">REQUEST / {selected.id}</p><h3>{selected.amount} {selected.asset} → {selected.destination}</h3>
        <p className="policy-review-meta">Source: {selected.source} · Submitted {new Date(selected.createdAt).toLocaleString()} · {selected.evaluation.scenario}</p>
        <ul className="policy-checks">{selected.evaluation.checks.map(check => <li key={check.id}><div><strong>{check.label}</strong><span className={`policy-result ${check.result.toLowerCase().replace(" ", "-")}`}>{check.result}{check.mandatory ? " · Mandatory" : check.result === "Approval required" ? " · Policy match" : " · Informational"}</span></div><p>{check.detail}</p></li>)}</ul>
        <label className="policy-reason" htmlFor="policy-rejection-reason">Rejection reason</label>
        <textarea id="policy-rejection-reason" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={working} placeholder="Required when rejecting a request" />
        <div className="policy-review-actions"><button type="button" className="button primary" disabled={working || !selected.evaluation.canApprove} onClick={() => decide("approve")}>{working ? "Recording…" : "Approve for processing"}</button><button type="button" className="button secondary" disabled={working} onClick={() => decide("reject")}>Reject request</button></div>
        {!selected.evaluation.canApprove && <p className="policy-review-message">Approval is blocked until every mandatory check passes. Rejection remains available.</p>}
      </> : <p className="policy-review-message">Select a pending transfer to review its policy evaluation.</p>}</div>
    </div>}
    <div className="policy-audit"><p className="eyebrow">DECISION AUDIT TRAIL</p>
      {reviews?.audit.length ? <ol>{reviews.audit.map(event => <li key={event.id}><strong>{event.transactionId} · {event.decision === "approve" ? "Approved for processing" : "Rejected"}</strong><span>{new Date(event.occurredAt).toLocaleString()} · {event.reviewerId}</span><small>{event.reason || "No reason supplied"} · {event.evaluation.scenario} · {event.evaluation.checks.map(check => `${check.label}: ${check.result}`).join("; ")}</small></li>)}</ol> : <p className="policy-review-message">No decisions recorded yet.</p>}
    </div>
  </section>;
}
