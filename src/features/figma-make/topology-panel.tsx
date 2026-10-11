"use client";

import { useState } from "react";
import type { ExampleData } from "@/contracts";
import type { TransferReviews, TwinTransfer } from "./twin-transfers";

export function TopologyPanel({ mode, selected, onSelect, onClose, onSettlement, data, transfers, reviews }: {
  mode: "console" | "inspect"; selected: string; onSelect: (id: string) => void; onClose: () => void;
  onSettlement: () => void; data: ExampleData; transfers: TwinTransfer[]; reviews: TransferReviews | null;
}) {
  const [tab, setTab] = useState<"activity" | "policies">("activity");
  const node = data.nodes.find(item => item.id === selected);
  const connected = data.edges.flatMap(([from, to]) => from === selected ? [to] : to === selected ? [from] : []);
  const matched = transfers.filter((item): item is Extract<TwinTransfer, { kind: "request" }> => item.kind === "request" &&
    (item.review.source === selected || item.review.destination === selected));
  return <div className="topology-overlay" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="topology-panel" role="dialog" aria-modal="true" aria-label={mode === "console" ? "Operational console" : "Entity inspection"}>
      <header className="topology-panel__head"><div><p className="eyebrow">DIGITAL TWIN / {mode === "console" ? "OPERATIONS" : "ENTITY"}</p><h2>{mode === "console" ? "Operational Console" : selected}</h2></div><button type="button" className="button secondary" onClick={onClose} aria-label="Close panel">Close</button></header>
      <p className="topology-panel__note">Topology nodes and relationships are synthetic demo metadata. Persisted transfer requests are identified separately below. Edges do not establish transfer routes.</p>
      {mode === "inspect" ? <>
        <dl className="topology-panel__facts"><div><dt>Entity ID</dt><dd>{node?.id ?? "Unavailable"} · demo topology ID</dd></div><div><dt>Type</dt><dd>{node?.type ?? "Unavailable"}</dd></div><div><dt>Topology label</dt><dd>{node?.sub ?? "Unavailable"}</dd></div><div><dt>Associated wallets</dt><dd>No verified wallet association in the loaded data.</dd></div></dl>
        <h3>Connected nodes <small>SYNTHETIC TOPOLOGY</small></h3>
        <div className="topology-panel__chips">{connected.length ? connected.map(id => <button type="button" key={id} onClick={() => onSelect(id)}>{id} →</button>) : <p>No connected nodes in this topology.</p>}</div>
        <h3>Transfer records <small>PERSISTED REQUESTS</small></h3>
        {matched.length ? matched.map(item => <p className="topology-panel__row" key={item.transaction.id}><strong>{item.transaction.id}</strong><span>{item.review.amount} {item.review.asset} · {item.review.status}</span></p>) : <p className="topology-panel__empty">No persisted transfer request identifies this topology ID as its source or destination.</p>}
        <h3>Policy information</h3>
        {node?.type === "policy" ? <p className="topology-panel__empty">This demo policy node has no verified link to a persisted policy record.</p> : <p className="topology-panel__empty">No policy record is linked to this topology node.</p>}
      </> : <>
        <div className="topology-panel__summary"><div><span>TOPOLOGY NODES</span><strong>{data.nodes.length}</strong></div><div><span>PERSISTED REQUESTS</span><strong>{transfers.filter(item => item.kind === "request").length}</strong></div><div><span>POLICIES IN LIBRARY</span><strong>{data.policies.length}</strong></div></div>
        <div className="topology-panel__tabs" role="tablist" aria-label="Console sections"><button type="button" role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")}>Transfer activity</button><button type="button" role="tab" aria-selected={tab === "policies"} onClick={() => setTab("policies")}>Policy evaluations</button></div>
        {tab === "activity" ? <section aria-label="Transfer activity"><p className="topology-panel__empty">Requests come from the transfer review API. Sample transactions are marked as synthetic.</p>{transfers.length ? transfers.map(item => <p className="topology-panel__row" key={item.transaction.id}><strong>{item.transaction.id} · {item.kind === "request" ? "PERSISTED REQUEST" : "SYNTHETIC SAMPLE"}</strong><span>{item.transaction.type} · {item.transaction.status} · {item.transaction.amount}</span></p>) : <p>No transfer activity is available.</p>}</section> : <section aria-label="Policy evaluations"><p className="topology-panel__empty">Only persisted transfer requests have server policy evaluations. Library policies are display records and do not drive those checks.</p>{reviews?.transfers.length ? reviews.transfers.map(item => <p className="topology-panel__row" key={item.id}><strong>{item.id} · {item.evaluation.scenario}</strong><span>{item.evaluation.checks.map(check => `${check.label}: ${check.result}`).join(" · ")}</span></p>) : <p>No persisted policy evaluations are available.</p>}</section>}
        <button type="button" className="button primary topology-panel__settlement" onClick={onSettlement}>Open Settlement Simulation</button>
      </>}
    </section>
  </div>;
}
