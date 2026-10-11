"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExampleData, ExamplePolicy, ExampleTransaction } from "@/contracts";
import { TransferDialog } from "./transfer-dialog";
import { PolicyReview } from "./policy-review";
import { formatLedgerAmount } from "./ledger-amount";
import { joinTwinTransfers, policyResultLabel, type TransferReviews, type TwinTransfer } from "./twin-transfers";
import { SettlementCanvas, SettlementInspector, useSettlementSimulation } from "./settlement-simulation";
import { activityNodes, topologyDemoActivities, type TopologyActivity } from "./topology-activity";
import { downloadTopologySvg } from "./topology-export";
import { TopologyPanel } from "./topology-panel";
import { CreatePolicy } from "./create-policy";
import { CategorizedInventory, ConsolidatedInventory, inventoryViews, type InventoryView, type PortfolioDataset } from "./portfolio-inventory";
import { DatasetImportDialog } from "./dataset-import-dialog";
import type { ImportDatasetResponse } from "@/contracts";

type Page = "Overview" | "Digital Twin" | "Portfolios" | "Transactions" | "Policy Engine" | "Reporting";

const emptyFinancialData: ExampleData = { assets: [], transactions: [], policies: [], nodes: [], edges: [] };

type IconName =
  | "overview"
  | "twin"
  | "portfolio"
  | "transactions"
  | "policy"
  | "reporting"
  | "search"
  | "command"
  | "bell"
  | "arrow"
  | "check";

const navigation: { label: Page; icon: IconName }[] = [
  { label: "Overview", icon: "overview" },
  { label: "Digital Twin", icon: "twin" },
  { label: "Portfolios", icon: "portfolio" },
  { label: "Transactions", icon: "transactions" },
  { label: "Policy Engine", icon: "policy" },
  { label: "Reporting", icon: "reporting" },
];

type FinancialDataResponse =
  | { ok: true; data: ExampleData & { userId: string; datasets: PortfolioDataset[] } }
  | { ok: false; error: { message: string } };

type ReviewsResponse =
  | { ok: true; data: TransferReviews }
  | { ok: false; error: { message: string } };

type CreatePolicyResponse =
  | { ok: true; data: { policy: ExamplePolicy; archivedPolicyNames: string[] } }
  | { ok: false; error: { message: string } };

type ReconciliationException = {
  id: string; reasonCode: string; severity: "info" | "warning" | "critical"; summary: string;
  sourceRecordIds: string[]; obligationIds: string[]; evidence: { sourceRecordId: string; sourceSystem: string; externalId: string }[];
};

type ReconciliationAssessment = {
  datasetId: string; snapshotId: string; asOf: string; exceptions: ReconciliationException[];
  indicators: { obligationCount: number; settledCount: number; pendingCount: number; blockedCount: number; failedCount: number; readyCount: number; exceptionCount: number; exceptionCountsBySeverity: { info: number; warning: number; critical: number }; settlementReadiness: { ready: number; eligible: number } };
};

function parseUsdValue(value: string, description: string) {
  const match = value.match(/^\s*\$?([\d,]+(?:\.\d+)?)\s*([KMBT]?)\s*$/i);
  if (!match) {
    throw new Error(`${description} has an unsupported USD value: ${value}`);
  }

  const amount = Number(match[1].replaceAll(",", ""));
  const multiplier = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2].toUpperCase()];
  if (!Number.isFinite(amount) || multiplier === undefined) {
    throw new Error(`${description} has an invalid USD value: ${value}`);
  }

  return amount * multiplier;
}

function sumAssetValues(assets: ExampleData["assets"]) {
  return assets.reduce((total, asset) => total + parseUsdValue(asset.value, `Asset ${asset.symbol}`), 0);
}

function sumTransactionValues(transactions: ExampleData["transactions"]) {
  return transactions.reduce((total, transaction) => transaction.value === "—"
    ? total
    : total + parseUsdValue(transaction.value, `Transaction ${transaction.id}`), 0);
}

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4v16" /></>,
    twin: <><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" /><path d="M12 3V1M21 12h2M12 21v2M3 12H1" /></>,
    portfolio: <><path d="M4 7h16v13H4zM8 7V4h8v3" /><path d="M4 12h16" /></>,
    transactions: <><path d="M4 7h15M15 3l4 4-4 4M20 17H5M9 13l-4 4 4 4" /></>,
    policy: <><path d="M12 3l7 3v5c0 4.8-2.8 8.1-7 10-4.2-1.9-7-5.2-7-10V6z" /><path d="M9 12l2 2 4-5" /></>,
    reporting: <><path d="M5 20V10M12 20V4M19 20v-7" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5" /></>,
    command: <><path d="M8 8V6a3 3 0 10-3 3h2M16 8V6a3 3 0 113 3h-2M8 16v2a3 3 0 11-3-3h2M16 16v2a3 3 0 103-3h-2M8 8h8v8H8z" /></>,
    bell: <><path d="M6 9a6 6 0 0112 0c0 7 3 7 3 7H3s3 0 3-7M10 20h4" /></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    check: <path d="M5 12l4 4L19 6" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Rail({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  return (
    <aside className="rail">
      <button type="button" className="brand-mark" aria-label="CustodyOS home" onClick={() => setPage("Overview")}><span /></button>
      <nav className="rail-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <button
            key={item.label}
            className={`rail-link ${page === item.label ? "active" : ""}`}
            aria-label={item.label}
            title={item.label}
            onClick={() => setPage(item.label)}
          >
            <Icon name={item.icon} />
          </button>
        ))}
      </nav>
      <button className="avatar" aria-label="Account menu">JD</button>
    </aside>
  );
}

function Header({ page, setPage, openCommand, datasets }: { page: Page; setPage: (page: Page) => void; openCommand: () => void; datasets: PortfolioDataset[] }) {
  const latestDataset = [...datasets].sort((left, right) => Date.parse(right.snapshot.asOf) - Date.parse(left.snapshot.asOf))[0];
  const openObligations = latestDataset?.snapshot.obligations.filter(item => item.status !== "settled" && item.status !== "cancelled").length ?? 0;
  return (
    <>
      <header className="topbar">
        <button type="button" className="wordmark" aria-label="CustodyOS home" onClick={() => setPage("Overview")}>CUSTODY<span>OS</span></button>
        <div className="desk-name">GLOBAL DIGITAL ASSET OPERATIONS</div>
        <div className="market-strip" aria-label="Imported workspace summary">
          <span>DATASETS</span><strong>{datasets.length}</strong>
          <span>ACCOUNTS</span><strong>{latestDataset?.accounts.length ?? 0}</strong>
          <span>OPEN</span><strong>{openObligations}</strong>
        </div>
        <div className="system-health"><i /> WORKSPACE LOADED</div>
        <div className="institution" title={latestDataset?.dataset.name ?? "No imported dataset"}>{latestDataset?.dataset.name ?? "LOCAL WORKSPACE"}</div>
      </header>
      <div className="sectionbar">
        <div className="section-tabs">
          {navigation.map((item) => (
            <button className={page === item.label ? "active" : ""} key={item.label} onClick={() => setPage(item.label)}>
              {item.label}
            </button>
          ))}
        </div>
        <button className="command-trigger" onClick={openCommand}><Icon name="search" size={14} /> Search <kbd>⌘ K</kbd></button>
      </div>
    </>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="description">{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

function DigitalTwin({ data, reviews, refreshError }: { data: ExampleData; reviews: TransferReviews | null; refreshError: string }) {
  const settlement = useSettlementSimulation();
  const topologyRef = useRef<SVGSVGElement>(null);
  const [panel, setPanel] = useState<"console" | "inspect" | null>(null);
  const [exportNotice, setExportNotice] = useState("");
  const [selected, setSelected] = useState("ACME BANK");
  const [selectedTransferId, setSelectedTransferId] = useState("");
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 960, height: 550 });
  const [nodes, setNodes] = useState(() => structuredClone(data.nodes));
  const netAssetValue = sumAssetValues(data.assets);
  const edges = data.edges;
  const transfers = useMemo(() => reviews ? joinTwinTransfers(data.transactions, reviews) : [], [data.transactions, reviews]);
  const selectedTransfer = transfers.find(item => item.transaction.id === selectedTransferId);
  const selectedActivity = topologyDemoActivities.find(item => item.id === selectedActivityId);
  const activityPair = selectedActivity ? activityNodes(selectedActivity, nodes) : null;
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));

  useEffect(() => {
    setNodes(current => data.nodes.map(node => {
      const dragged = current.find(item => item.id === node.id);
      return dragged ? { ...node, x: dragged.x, y: dragged.y } : { ...node };
    }));
  }, [data.nodes]);

  useEffect(() => {
    if (!data.nodes.some(node => node.id === selected)) setSelected(data.nodes[0]?.id ?? "");
  }, [data.nodes, selected]);

  const moveNode = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = viewport.x + ((event.clientX - bounds.left) / bounds.width) * viewport.width;
    const y = viewport.y + ((event.clientY - bounds.top) / bounds.height) * viewport.height;
    setNodes((current) => current.map((node) => node.id === dragging
      ? { ...node, x: Math.max(node.r + 8, Math.min(952 - node.r, x)), y: Math.max(node.r + 8, Math.min(542 - node.r, y)) }
      : node));
  };

  const beginDrag = (event: React.PointerEvent<SVGGElement>, id: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(id);
    setSelectedActivityId("");
    setDragging(id);
  };

  const selectActivity = (activity: TopologyActivity) => {
    setSelectedActivityId(activity.id);
    setSelected(activity.nodeIds[0]);
  };

  const zoomGraph = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = viewport.x + ((event.clientX - bounds.left) / bounds.width) * viewport.width;
    const pointerY = viewport.y + ((event.clientY - bounds.top) / bounds.height) * viewport.height;
    const requestedWidth = viewport.width * (event.deltaY > 0 ? 1.12 : .88);
    const width = Math.max(384, Math.min(1200, requestedWidth));
    const factor = width / viewport.width;
    const height = width * (550 / 960);
    setViewport({
      x: pointerX - (pointerX - viewport.x) * factor,
      y: pointerY - (pointerY - viewport.y) * factor,
      width,
      height,
    });
  };

  const resetZoom = () => setViewport({ x: 0, y: 0, width: 960, height: 550 });
  const zoomPercent = Math.round((960 / viewport.width) * 100);
  const exportView = () => {
    try {
      if (!topologyRef.current) throw new Error("The topology is not ready.");
      downloadTopologySvg(topologyRef.current);
      setExportNotice("Topology SVG downloaded.");
    } catch (error) {
      setExportNotice(error instanceof Error ? `Export failed: ${error.message}` : "Export failed. Try again.");
    }
  };

  return (
    <main className="page twin-page">
      <PageHeading
        eyebrow={settlement.mode ? "DIGITAL TWIN / SYNTHETIC PREVIEW" : "DIGITAL TWIN / LIVE ESTATE"}
        title={settlement.mode ? "Settlement Simulation" : "Institutional Asset Topology"}
        description={settlement.mode ? "Explore a three-leg settlement dependency chain and compare local funding previews." : "A real-time model of entities, wallets, controls, networks, and settlement exposure."}
        actions={settlement.mode ? undefined : <><button type="button" className="button secondary" onClick={exportView}>Export view</button><button type="button" className="button primary" onClick={() => setPanel("console")}>Open console</button></>}
      />
      {exportNotice && <p className="topology-export-notice" role="status">{exportNotice}</p>}
      <div className="twin-mode-switch" role="group" aria-label="Digital Twin mode"><button type="button" aria-pressed={!settlement.mode} onClick={() => settlement.setMode(false)}>Institutional topology</button><button type="button" aria-pressed={settlement.mode} onClick={() => settlement.setMode(true)}>Settlement Simulation</button></div>
      <div className={`twin-layout ${settlement.mode ? "twin-layout--simulation" : ""}`}>
        {settlement.mode ? <SettlementCanvas state={settlement} /> : <section className="graph-shell">
          <div className="graph-meta"><span>DEMO TOPOLOGY</span><b>● {nodes.length} VISIBLE NODES</b><span>{edges.length} EDGES</span><span>PERSISTED REQUESTS IN INSPECTOR</span></div>
          <svg
            ref={topologyRef}
            className={`network ${dragging ? "is-dragging" : ""}`}
            viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label="Interactive digital asset custody network"
            onPointerMove={moveNode}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onWheel={zoomGraph}
          >
            <g className="edges">
              {edges.map(([fromId, toId]) => {
                const from = nodeById[fromId];
                const to = nodeById[toId];
                const curve = Math.abs(from.x - to.x) > 180 ? -24 : 16;
                const isPrimaryConnection = fromId === "ACME BANK" && (selected === "ACME BANK" || toId === selected);
                return <path className={`${to.type === "policy" ? "policy-edge" : ""} ${isPrimaryConnection ? "selected-edge" : ""}`} key={`${fromId}-${toId}`} d={`M${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 + curve} ${to.x} ${to.y}`} />;
              })}
            </g>
            {selectedActivity && activityPair && <g className={`topology-activity-signal is-${selectedActivity.state}`} aria-hidden="true">
              <path className="topology-activity-signal__track" d={`M${activityPair[0].x} ${activityPair[0].y} L${activityPair[1].x} ${activityPair[1].y}`} />
              <path className="topology-activity-signal__pulse" d={`M${activityPair[0].x} ${activityPair[0].y} L${activityPair[1].x} ${activityPair[1].y}`} />
              <circle className="topology-activity-signal__endpoint" cx={activityPair[0].x} cy={activityPair[0].y} r={activityPair[0].r + 6} />
              <circle className="topology-activity-signal__endpoint" cx={activityPair[1].x} cy={activityPair[1].y} r={activityPair[1].r + 6} />
            </g>}
            {nodes.map((n) => (
              <g
                className={`network-node ${n.type} ${selected === n.id ? "selected" : ""} ${selectedActivity?.nodeIds.includes(n.id) ? `activity-associated activity-${selectedActivity.state}` : ""} ${dragging === n.id ? "dragging" : ""}`}
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={(event) => beginDrag(event, n.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelected(n.id); setSelectedActivityId(""); } }}
                role="button"
                tabIndex={0}
              >
                {selected === n.id && <>
                  <circle className="selection-ring ring-one" r={n.r + 10} />
                  <circle className="selection-ring ring-two" r={n.r + 18} />
                </>}
                <circle className="node-core" r={n.r} />
                {n.type === "master" && <text className="node-kicker" y="-13">MASTER ENTITY</text>}
                <text className={n.type === "master" ? "master-label" : ""} y={n.type === "master" ? 8 : -2}>{n.id}</text>
                <text className={n.type === "master" ? "node-value" : "node-sub"} y={n.type === "master" ? 27 : 15}>
                  {n.type === "master" ? `${compactUsdFormatter.format(netAssetValue)} AUC` : n.sub}
                </text>
              </g>
            ))}
          </svg>
          <div className="graph-controls">CLICK TO SELECT <span>·</span> DRAG NODES <span>·</span> SCROLL TO ZOOM</div>
          <button className="zoom-reset" onClick={resetZoom} aria-label="Reset graph zoom">{zoomPercent}% <span>RESET</span></button>
        </section>}
        {settlement.mode ? <SettlementInspector state={settlement} /> : <EntityInspector selected={selected} selectedActivity={selectedActivity} onSelectActivity={selectActivity} assets={data.assets} transfers={transfers} selectedTransfer={selectedTransfer} onSelectTransfer={setSelectedTransferId} onInspect={() => setPanel("inspect")} refreshError={refreshError} reviewsLoaded={reviews !== null} />}
      </div>
      {panel && <TopologyPanel mode={panel} selected={selected} onSelect={setSelected} onClose={() => setPanel(null)} onSettlement={() => { setPanel(null); settlement.setMode(true); }} data={data} transfers={transfers} reviews={reviews} />}
    </main>
  );
}

function EntityInspector({ selected, selectedActivity, onSelectActivity, assets, transfers, selectedTransfer, onSelectTransfer, onInspect, refreshError, reviewsLoaded }: {
  selected: string; assets: ExampleData["assets"]; transfers: TwinTransfer[]; selectedTransfer?: TwinTransfer;
  selectedActivity?: TopologyActivity; onSelectActivity: (activity: TopologyActivity) => void;
  onSelectTransfer: (id: string) => void; onInspect: () => void; refreshError: string; reviewsLoaded: boolean;
}) {
  const netAssetValue = sumAssetValues(assets);
  return (
    <aside className="inspector">
      <p className="eyebrow">SELECTED ENTITY</p>
      <h2>{selected}</h2>
      <p className="inspector-sub">Synthetic estate view · Edges are not transfer routes</p>
      <section className="topology-activity" aria-label="Synthetic operational activity">
        <div className="topology-activity__heading"><p className="eyebrow">OPERATIONAL ACTIVITY</p><span>SYNTHETIC DEMO</span></div>
        <p className="topology-activity__note">Preview states only. Signals show illustrative node associations, not verified settlement routes or persisted transactions.</p>
        <div className="topology-activity__feed" aria-label="Synthetic activity feed">
          {topologyDemoActivities.map(activity => <button type="button" key={activity.id} className={`topology-activity__item is-${activity.state}`} aria-pressed={selectedActivity?.id === activity.id} onClick={() => onSelectActivity(activity)}>
            <span className="topology-activity__dot" /><span className="topology-activity__main"><strong>{activity.type}</strong><small>{activity.id} · {activity.time}</small><small>{activity.source && activity.destination ? `${activity.source} → ${activity.destination}` : "Hypothetical preview"}</small></span><span className="topology-activity__amount">{activity.amount ?? "—"}</span><em>{activity.status}</em>
          </button>)}
        </div>
        {selectedActivity && <div className={`topology-activity__detail is-${selectedActivity.state}`} aria-label="Selected operational event">
          <div className="topology-activity__detail-head"><span>{selectedActivity.state === "simulation" ? "HYPOTHETICAL / DEMO" : "OPERATIONAL STATE / DEMO"}</span><strong>{selectedActivity.id}</strong></div>
          <h3>{selectedActivity.type}</h3>
          <p className="topology-activity__status">{selectedActivity.status}</p>
          <dl><div><dt>Related nodes</dt><dd>{selectedActivity.nodeIds.join(" → ")}</dd></div><div><dt>Transfer amount</dt><dd>{selectedActivity.amount ?? "Not applicable"}</dd></div><div><dt>Source / destination</dt><dd>{selectedActivity.source && selectedActivity.destination ? `${selectedActivity.source} → ${selectedActivity.destination}` : "Not applicable"}</dd></div>{selectedActivity.reason && <div><dt>Policy reason</dt><dd>{selectedActivity.reason}</dd></div>}</dl>
          <p className="eyebrow">EVENT TIMELINE</p><ol>{selectedActivity.timeline.map(step => <li key={step}>{step}</li>)}</ol>
        </div>}
      </section>
      <div className="inspector-value"><span>ASSETS UNDER CUSTODY</span><strong>{compactUsdFormatter.format(netAssetValue)}</strong></div>
      <div className="split-stats"><div><span>SAMPLE WALLETS</span><strong>18</strong></div><div><span>SAMPLE POLICIES</span><strong>12</strong></div></div>
      <div className="coverage">
        <p className="eyebrow">SAMPLE CONTROL COVERAGE</p><div className="meter"><i /></div>
        <div><span>95.2% sample</span><small>2 sample exceptions</small></div>
      </div>
      <div className="twin-transfers">
        <p className="eyebrow">TRANSFER ACTIVITY</p>
        {refreshError && <p className="twin-refresh-error" role="status">{refreshError}</p>}
        {!reviewsLoaded && !refreshError && <p className="twin-sample-note" role="status">Loading transfer reviews…</p>}
        <div className="twin-transfer-list" aria-label="Transfer activity">
          {transfers.map(item => <button type="button" key={item.transaction.id} aria-pressed={selectedTransfer?.transaction.id === item.transaction.id} onClick={() => onSelectTransfer(item.transaction.id)}>
            <strong>{item.transaction.id}</strong><small>{item.kind === "request" ? "PERSISTED REQUEST" : "SYNTHETIC SAMPLE"}</small>
            <span>{item.kind === "request" ? item.review.status : item.transaction.status}</span>
          </button>)}
        </div>
        {selectedTransfer?.kind === "request" && <div className="twin-transfer-detail" aria-label="Selected transfer details">
          <p className="eyebrow">REQUEST / {selectedTransfer.transaction.id}</p>
          <strong>{selectedTransfer.review.amount} {selectedTransfer.review.asset}</strong>
          <p>From {selectedTransfer.review.source} to {selectedTransfer.review.destination}</p>
          <p>Status: {selectedTransfer.review.status}</p>
          <p>{selectedTransfer.review.evaluation.scenario} · Institutional evidence is not verified.</p>
          <ul>{selectedTransfer.review.evaluation.checks.map(check => <li key={check.id}><span>{check.label}</span><em className={`policy-result ${check.result.toLowerCase().replace(" ", "-")}`}>{policyResultLabel(check.result)}{check.result === "Approval required" ? " · Policy match" : ""}</em><small>{check.detail}</small></li>)}</ul>
          {selectedTransfer.audit && <p className="twin-audit">{selectedTransfer.audit.decision === "approve" ? "Approved for processing" : "Rejected"} · {new Date(selectedTransfer.audit.occurredAt).toLocaleString()}<br />Reason: {selectedTransfer.audit.reason || "No reason supplied"}</p>}
        </div>}
        {selectedTransfer?.kind === "sample" && <p className="twin-sample-note">Synthetic sample transaction. No persisted transfer review or policy evaluation is available.</p>}
      </div>
      <button type="button" className="button primary inspector-button" onClick={onInspect}>Inspect entity <Icon name="arrow" size={14} /></button>
      <p className="entity-id">DEMO TOPOLOGY ID · {selected}</p>
    </aside>
  );
}

function Overview({ data, datasets, onNewTransfer, onImportDataset, importNotice }: { data: ExampleData; datasets: PortfolioDataset[]; onNewTransfer: () => void; onImportDataset: () => void; importNotice: string }) {
  const [activeChartPoint, setActiveChartPoint] = useState<number | null>(null);
  const latestDataset = [...datasets].sort((left, right) => Date.parse(right.snapshot.asOf) - Date.parse(left.snapshot.asOf))[0];
  const snapshot = latestDataset?.snapshot;
  const accounts = latestDataset?.accounts ?? [];
  const obligations = snapshot?.obligations ?? [];
  const statusGroups = ([
    ["Pending", obligations.filter(item => item.status === "pending")],
    ["At risk", obligations.filter(item => item.status === "at_risk")],
    ["Blocked", obligations.filter(item => item.status === "blocked")],
    ["Settled", obligations.filter(item => item.status === "settled")],
  ] as const).map(([label, items]) => ({ label, count: items.length }));
  const maxStatusCount = Math.max(1, ...statusGroups.map(group => group.count));
  const cashByCurrency = new Map<string, bigint>();
  for (const balance of snapshot?.cashBalances ?? []) {
    cashByCurrency.set(balance.currency, (cashByCurrency.get(balance.currency) ?? 0n) + BigInt(balance.settledMinorUnits));
  }
  const usdMinorUnits = cashByCurrency.get("USD") ?? 0n;
  const usdBalance = compactUsdFormatter.format(usdMinorUnits / 100n);
  const openObligations = obligations.filter(item => item.status !== "settled" && item.status !== "cancelled");
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const snapshotDate = snapshot
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(snapshot.asOf)) + " UTC"
    : "No imported snapshot";
  const transactionRows = data.transactions.slice(0, 4);
  return (
    <main className="page">
      <PageHeading eyebrow={`COMMAND CENTER / ${snapshotDate}`} title="Operational Overview" description="Imported custody balances, settlement obligations, and workspace transfers from your latest snapshot." actions={<><button type="button" className="button secondary" onClick={onImportDataset}>Import dataset</button><button type="button" className="button primary" onClick={onNewTransfer}>New transfer</button></>} />
      {importNotice && <p className="dataset-import-notice" role="status">{importNotice}</p>}
      <div className="overview-grid">
        <section className="exposure-panel">
          <div className="panel-top"><p className="eyebrow">SETTLED CASH · USD</p><span>{latestDataset?.dataset.name ?? "NO DATASET"}</span></div>
          <div className="hero-number">{snapshot ? usdBalance : "—"}</div>
          <div className="chart">
            {statusGroups.map((point, i) => (
              <i
                key={point.label}
                style={{ height: `${point.count === 0 ? 2 : Math.max(8, (point.count / maxStatusCount) * 112)}px` }}
                className={point.label === "At risk" || point.label === "Blocked" ? "current" : ""}
                tabIndex={0}
                aria-label={`${point.label}: ${point.count} obligations`}
                onPointerEnter={() => setActiveChartPoint(i)}
                onPointerLeave={() => setActiveChartPoint((active) => active === i ? null : active)}
                onFocus={() => setActiveChartPoint(i)}
                onBlur={() => setActiveChartPoint((active) => active === i ? null : active)}
              >
                {activeChartPoint === i && <span className="chart-tooltip" aria-hidden="true">{point.label}<strong>{point.count} obligations</strong></span>}
              </i>
            ))}
          </div>
          <div className="chart-axis">{statusGroups.map(group => <span key={group.label}>{group.label.toUpperCase()}</span>)}</div>
        </section>
        <section className="action-ledger">
          <div className="panel-top"><p className="eyebrow">OPEN OBLIGATIONS</p><span>{String(openObligations.length).padStart(2, "0")} OPEN</span></div>
          {openObligations.slice(0, 5).map((obligation, index) => (
            <div className="action-row" key={obligation.id}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span><strong>{obligation.externalId} · {obligation.status.replaceAll("_", " ")}</strong><small>{accountNames.get(obligation.fromAccountId) ?? obligation.fromAccountId} → {accountNames.get(obligation.toAccountId) ?? obligation.toAccountId}</small></span>
              <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(obligation.dueAt))}</time><Icon name="arrow" size={14} />
            </div>
          ))}
          {openObligations.length === 0 && <p role="status">{snapshot ? "No open obligations in this snapshot." : "Import a financial dataset to see settlement obligations here."}</p>}
        </section>
        <section className="asset-ribbon">
          <p className="eyebrow">SNAPSHOT COVERAGE</p>
          <div className="asset-mini-grid"><div><span>ACCOUNTS</span><strong>{snapshot ? accounts.length : "—"}</strong><small>in latest dataset</small></div><div><span>OBLIGATIONS</span><strong>{snapshot ? obligations.length : "—"}</strong><small>in latest snapshot</small></div><div><span>SECURITY BALANCES</span><strong>{snapshot ? snapshot.securitiesBalances.length : "—"}</strong><small>position entries</small></div><div><span>CASH ENTRIES</span><strong>{snapshot ? snapshot.cashBalances.length : "—"}</strong><small>in latest snapshot</small></div></div>
        </section>
        <section className="operations-stream">
          <div className="panel-top"><p className="eyebrow">WORKSPACE TRANSFERS</p><span>{data.transactions.length} LOADED</span></div>
          {transactionRows.map(tx => <div className="stream-row" key={tx.id}><time>{tx.time}</time><i /><span>{tx.type} · {tx.asset}</span><strong>{tx.value}</strong><small>{tx.status}</small></div>)}
          {transactionRows.length === 0 && <p role="status">New transfer requests will appear here after they are submitted.</p>}
        </section>
      </div>
    </main>
  );
}

function Portfolios({ datasets, userId, onOpenTwin }: { datasets: PortfolioDataset[]; userId: string; onOpenTwin: () => void }) {
  const [active, setActive] = useState<InventoryView>("Consolidated");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileError, setReconcileError] = useState("");
  const [assessment, setAssessment] = useState<ReconciliationAssessment | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [selectedExceptionId, setSelectedExceptionId] = useState("");
  const selectedException = assessment?.exceptions.find(item => item.id === selectedExceptionId) ?? assessment?.exceptions[0];
  const readiness = assessment?.indicators.settlementReadiness;
  const readinessPercent = readiness && readiness.eligible > 0 ? Math.round(readiness.ready / readiness.eligible * 100) : 0;

  const runReconciliation = async () => {
    setReconcileOpen(true); setReconcileLoading(true); setReconcileError(""); setAssessment(null); setSelectedExceptionId("");
    try {
      const dataResponse = await fetch(`/api/users/${encodeURIComponent(userId)}/financial-data`, { cache: "no-store" });
      const dataBody = await dataResponse.json() as { ok: boolean; data?: { datasets?: { dataset?: { id?: string; name?: string; status?: string } }[] }; error?: { message?: string } };
      if (!dataResponse.ok || !dataBody.ok) throw new Error(dataBody.error?.message || "Unable to load imported datasets.");
      const dataset = dataBody.data?.datasets?.find(item => item.dataset?.status === "ready") ?? dataBody.data?.datasets?.[0];
      const datasetId = dataset?.dataset?.id ?? "dataset-cascade";
      const response = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/custody`, { cache: "no-store" });
      const body = await response.json() as { ok: boolean; data?: { assessment?: ReconciliationAssessment }; error?: { message?: string } };
      if (!response.ok || !body.ok || !body.data?.assessment) throw new Error(body.error?.message || "The custody assessment did not return a reconciliation result.");
      setDatasetName(dataset?.dataset?.name || "Three-leg settlement cascade · built-in fixture");
      setAssessment(body.data.assessment);
      setSelectedExceptionId(body.data.assessment.exceptions[0]?.id ?? "");
    } catch (error) {
      setReconcileError(error instanceof Error ? error.message : "Unable to run reconciliation.");
    } finally { setReconcileLoading(false); }
  };
  return (
    <main className="page">
      <PageHeading eyebrow={`PORTFOLIOS / ${active.toUpperCase()}`} title="Asset Inventory" description="Imported custody balances and settlement obligations from the latest available snapshot." actions={<button className="button secondary" onClick={runReconciliation}>Run reconciliation</button>} />
      <div className="portfolio-switcher" role="tablist" aria-label="Inventory views">{inventoryViews.map(x => <button type="button" role="tab" aria-selected={active === x} className={active === x ? "active" : ""} onClick={() => setActive(x)} key={x}>{x}</button>)}</div>
      <section className="portfolio-ledger">
        {active === "Consolidated"
          ? <ConsolidatedInventory datasets={datasets} />
          : <CategorizedInventory view={active} datasets={datasets} />}
      </section>
      {reconcileOpen && <div className="reconcile-overlay" onMouseDown={() => setReconcileOpen(false)}>
        <aside className="reconcile-panel" role="dialog" aria-modal="true" aria-labelledby="reconcile-title" onMouseDown={event => event.stopPropagation()}>
          <div className="reconcile-head"><div><p className="eyebrow">CUSTODY / DETERMINISTIC ASSESSMENT</p><h2 id="reconcile-title">Reconciliation results</h2></div><button type="button" aria-label="Close reconciliation" onClick={() => setReconcileOpen(false)}>×</button></div>
          {reconcileLoading && <div className="reconcile-state" role="status"><i />Comparing balances, obligations, and source evidence…</div>}
          {reconcileError && <div className="reconcile-error" role="alert"><strong>Reconciliation unavailable</strong><p>{reconcileError}</p><button type="button" className="button secondary" onClick={runReconciliation}>Try again</button></div>}
          {assessment && <>
            <div className="reconcile-context"><div><span>DATASET</span><strong>{datasetName}</strong></div><div><span>SNAPSHOT</span><strong>{new Date(assessment.asOf).toLocaleString()}</strong></div></div>
            <div className="reconcile-summary">
              <div><span>SETTLEMENT READY</span><strong>{readinessPercent}%</strong><small>{assessment.indicators.readyCount} of {readiness?.eligible ?? 0} eligible</small></div>
              <div><span>OPEN EXCEPTIONS</span><strong>{assessment.indicators.exceptionCount}</strong><small>{assessment.indicators.exceptionCountsBySeverity.critical} critical · {assessment.indicators.exceptionCountsBySeverity.warning} warning</small></div>
              <div><span>OBLIGATIONS</span><strong>{assessment.indicators.obligationCount}</strong><small>{assessment.indicators.blockedCount} blocked · {assessment.indicators.failedCount} failed</small></div>
            </div>
            <div className="reconcile-body">
              <section className="exception-list"><div className="reconcile-section-title"><span>EXCEPTION QUEUE</span><em>{assessment.exceptions.length}</em></div>
                {assessment.exceptions.length === 0 && <p className="reconcile-empty">No custody breaks were detected in this snapshot.</p>}
                {assessment.exceptions.map(item => <button type="button" key={item.id} className={selectedException?.id === item.id ? "active" : ""} onClick={() => setSelectedExceptionId(item.id)}><i className={item.severity} /><span><strong>{item.reasonCode.replaceAll("_", " ")}</strong><small>{item.obligationIds.join(", ") || "No obligation reference"}</small></span><em>{item.severity}</em></button>)}
              </section>
              <section className="exception-detail">
                {selectedException ? <><div className="reconcile-section-title"><span>BREAK EVIDENCE</span><em className={selectedException.severity}>{selectedException.severity}</em></div><h3>{selectedException.reasonCode.replaceAll("_", " ")}</h3><p>{selectedException.summary}</p><dl><div><dt>Obligations</dt><dd>{selectedException.obligationIds.join(", ") || "None"}</dd></div><div><dt>Source records</dt><dd>{selectedException.sourceRecordIds.join(", ") || "Missing"}</dd></div></dl><div className="evidence-records">{selectedException.evidence.length ? selectedException.evidence.map(item => <div key={item.sourceRecordId}><strong>{item.sourceSystem}</strong><span>{item.externalId}</span><small>{item.sourceRecordId}</small></div>) : <p>No supporting source evidence was attached.</p>}</div><button type="button" className="button primary" onClick={() => { setReconcileOpen(false); onOpenTwin(); }}>View dependencies in Digital Twin</button></> : <p className="reconcile-empty">Select an exception to inspect its evidence.</p>}
              </section>
            </div>
            <p className="reconcile-disclosure">Read-only assessment. Balances, obligations, and settlement states were not modified.</p>
          </>}
        </aside>
      </div>}
    </main>
  );
}

function Transactions({ data, datasets, onNewTransfer, notice }: { data: ExampleData; datasets: PortfolioDataset[]; onNewTransfer: () => void; notice: string }) {
  const transactionValue = sumTransactionValues(data.transactions);
  const [filter, setFilter] = useState("All activity");
  const displayed = useMemo(() => filter === "All activity" ? data.transactions : data.transactions.filter(t => t.status === filter), [filter, data.transactions]);
  const latestDataset = [...datasets].sort((left, right) => Date.parse(right.snapshot.asOf) - Date.parse(left.snapshot.asOf))[0];
  const obligations = latestDataset?.snapshot.obligations ?? [];
  const accounts = new Map((latestDataset?.accounts ?? []).map(account => [account.id, account.name]));
  const attentionObligations = obligations.filter(item => item.status === "at_risk" || item.status === "blocked");
  const openObligations = obligations.filter(item => item.status !== "settled" && item.status !== "cancelled");
  return (
    <main className="page transactions-page">
      <PageHeading eyebrow="TRANSACTIONS / LIVE LEDGER" title="Transaction Monitor" description="Authorization, compliance screening, and settlement state across every asset movement." actions={<button className="button primary" onClick={onNewTransfer}>New transfer</button>} />
      {notice && <p className="transfer-notice" role="status">{notice}</p>}
      <div className="transaction-toolbar">
        <div>{["All activity", "Pending approval", "Screening", "Completed"].map(x => <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{x}</button>)}</div>
        <button className="filter-control">All loaded transactions ⌄</button>
      </div>
      <section className="transaction-ledger">
        <div className="tx-head"><span>TIME / ID</span><span>TYPE</span><span>ASSET / AMOUNT</span><span>ROUTE</span><span>VALUE</span><span>STATUS</span></div>
        {displayed.map(tx => <button className="tx-row" key={tx.id}>
          <span><time>{tx.time}</time><small>{tx.id}</small></span><span>{tx.type}</span><span><b>{tx.asset}</b> {formatLedgerAmount(tx.amount, tx.asset)}</span><span>{tx.route}</span><strong>{tx.value}</strong><span className={`tx-status ${tx.status.toLowerCase().replace(" ", "-")}`}>{tx.status}</span>
        </button>)}
      </section>
      <section className="transaction-volume">
        <div className="volume-heading">
          <div><p className="eyebrow">LOADED TRANSACTION VALUE</p><strong>{compactUsdFormatter.format(transactionValue)}</strong><span>{data.transactions.length} loaded transactions</span></div>
          <div><span>IMPORTED OBLIGATIONS</span><strong>{obligations.length}</strong><small>{attentionObligations.length} at risk or blocked</small></div>
        </div>
        <p className="portfolio-category__note">{latestDataset ? `${latestDataset.dataset.name} · Snapshot ${new Date(latestDataset.snapshot.asOf).toLocaleString()}` : "Import a dataset to load settlement obligations. Finality telemetry is not available in the current data source."}</p>
        <div className="portfolio-category__head"><span>OBLIGATION</span><span>STATUS / ROUTE</span><span>DUE</span></div>
        {openObligations.slice(0, 12).map(item => {
          const currency = item.asset.kind === "cash" ? item.asset.currency : null;
          const instrumentId = item.asset.kind === "security" ? item.asset.instrumentId : null;
          const assetLabel = currency
            ? `Cash · ${currency}`
            : `Security · ${latestDataset?.instruments.find(instrument => instrument.id === instrumentId)?.symbol ?? instrumentId}`;
          return <div className="portfolio-category__row" key={item.id}>
            <div><strong>{item.externalId}</strong><small>{assetLabel}</small></div>
            <div><span>{item.status.replaceAll("_", " ")}</span><small>{accounts.get(item.fromAccountId) ?? item.fromAccountId} → {accounts.get(item.toAccountId) ?? item.toAccountId}</small></div>
            <span>{new Date(item.dueAt).toLocaleString()}</span>
          </div>;
        })}
        {obligations.length === 0 && <p role="status">{latestDataset ? "No obligations are present in this imported snapshot." : "Imported settlement obligations will appear here when a dataset is loaded."}</p>}
      </section>
    </main>
  );
}

function CreatePolicyDialog({ userId, assets, policies, onClose, onCreated }: {
  userId: string;
  assets: ExampleData["assets"];
  policies: ExamplePolicy[];
  onClose: () => void;
  onCreated: (policy: ExamplePolicy, archivedPolicyNames: string[]) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectableAssets = assets.filter(asset => asset.symbol !== "OTHER");
  const [selectedAsset, setSelectedAsset] = useState(selectableAssets[0]?.symbol ?? "");
  const [archivePolicyNames, setArchivePolicyNames] = useState<string[]>([]);
  const overlappingPolicies = policies.filter(policy => policy.state === "Enforced" && policy.asset === selectedAsset && policy.threshold);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          name: form.get("name"),
          asset: form.get("asset"),
          threshold: form.get("threshold"),
          archivePolicyNames,
        }),
      });
      const body = await response.json() as CreatePolicyResponse;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to save this policy." : body.error.message);
      onCreated(body.data.policy, body.data.archivedPolicyNames);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this policy.");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="transfer-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="transfer-dialog policy-dialog" role="dialog" aria-modal="true" aria-labelledby="create-policy-title" onMouseDown={event => event.stopPropagation()}>
      <div className="transfer-dialog-head">
        <div><p className="eyebrow">POLICY ENGINE / NEW CONTROL</p><h2 id="create-policy-title">Create policy</h2></div>
        <button type="button" className="transfer-close" aria-label="Close policy form" disabled={submitting} onClick={onClose}>×</button>
      </div>
      <p className="transfer-explainer">Flag new transfers for human review when their asset amount exceeds a threshold. Policies are saved in this workspace and evaluated when transfer reviews load.</p>
      <form onSubmit={submit}>
        <label htmlFor="policy-name">Policy name</label>
        <input id="policy-name" name="name" placeholder="Large BTC transfer review" minLength={3} maxLength={80} required disabled={submitting} />
        <label htmlFor="policy-scope">Scope</label>
        <input id="policy-scope" value="All new transfers" disabled readOnly />
        <div className="policy-rule-fields">
          <div>
            <label htmlFor="policy-asset">Asset</label>
            <select id="policy-asset" name="asset" value={selectedAsset} onChange={event => { setSelectedAsset(event.target.value); setArchivePolicyNames([]); }} required disabled={submitting || selectableAssets.length === 0}>
              {selectableAssets.map(asset => <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {asset.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="policy-threshold">Amount threshold ({selectedAsset || "asset units"})</label>
            <input id="policy-threshold" name="threshold" inputMode="decimal" placeholder="5" pattern="\d{1,18}(\.\d{1,18})?" title="Use a positive decimal amount." required disabled={submitting} />
          </div>
        </div>
        {overlappingPolicies.length > 0 && <section className="policy-overlap" aria-label="Overlapping policies">
          <strong>Existing enforced {selectedAsset} rules</strong>
          <p>These thresholds can match the same transfer. Archive an older rule if this policy replaces it; otherwise both stay active and may both appear in review. Warnings cover structured amount rules only.</p>
          {overlappingPolicies.map(policy => <label key={policy.name}>
            <input type="checkbox" checked={archivePolicyNames.includes(policy.name)} disabled={submitting}
              onChange={event => setArchivePolicyNames(current => event.target.checked
                ? [...current, policy.name]
                : current.filter(name => name !== policy.name))} />
            <span><b>{policy.name}</b><small>{policy.asset} amount &gt; {policy.threshold} · currently enforced</small></span>
            <em>{archivePolicyNames.includes(policy.name) ? "Archive on save" : "Keep active"}</em>
          </label>)}
        </section>}
        <label htmlFor="policy-action">Action</label>
        <input id="policy-action" value="Flag for human review" disabled readOnly />
        <div className="policy-preview"><span>DEPLOYMENT STATE</span><strong>Enforced on save</strong><small>A matching request remains pending for a person to approve or reject. Approval does not move assets or settle a transfer.</small></div>
        {error && <p className="transfer-error" role="alert">{error}</p>}
        <div className="transfer-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="button primary" disabled={submitting || selectableAssets.length === 0}>{submitting ? "Saving…" : "Save policy"}</button>
        </div>
      </form>
    </section>
  </div>;
}

function PolicyEngine({ data, userId, onDecision, onPolicySaved }: {
  data: ExampleData;
  userId: string;
  onDecision: (id: string, status: ExampleTransaction["status"]) => void;
  onPolicySaved: (policy: ExamplePolicy, archivedPolicyNames?: string[]) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState("");
  const [policyActionError, setPolicyActionError] = useState("");
  const [policyActionWorking, setPolicyActionWorking] = useState(false);
  const policies = data.policies.filter(policy => showArchived ? policy.state === "Archived" : policy.state !== "Archived");
  const activePolicyCount = data.policies.filter(policy => policy.state !== "Archived").length;
  const archivedPolicyCount = data.policies.length - activePolicyCount;
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const selectedPolicyIndex = Math.min(selected, Math.max(0, policies.length - 1));
  const selectedPolicy = policies[selectedPolicyIndex];

  async function updatePolicyArchive(policy: ExamplePolicy, action: "archive" | "restore") {
    if (policyActionWorking) return;
    setPolicyActionWorking(true);
    setPolicyActionError("");
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policy.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const body = await response.json() as { ok: true; data: { state: string } } | { ok: false; error: { message: string } };
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to update this policy." : body.error.message);
      onPolicySaved({ ...policy, state: body.data.state });
      setArchiveTarget("");
      setSelected(0);
    } catch (cause) {
      setPolicyActionError(cause instanceof Error ? cause.message : "Unable to update this policy.");
    } finally {
      setPolicyActionWorking(false);
    }
  }

  async function updatePolicyState(policy: ExamplePolicy, state: "Enforced" | "Disabled") {
    if (policyActionWorking) return;
    setPolicyActionWorking(true);
    setPolicyActionError("");
    try {
      const response = await fetch(`/api/policies/${encodeURIComponent(policy.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, state }),
      });
      const body = await response.json() as { ok: true; data: { state: string } } | { ok: false; error: { message: string } };
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to update this policy." : body.error.message);
      onPolicySaved({ ...policy, state: body.data.state });
    } catch (cause) {
      setPolicyActionError(cause instanceof Error ? cause.message : "Unable to update this policy.");
    } finally {
      setPolicyActionWorking(false);
    }
  }

  return (
    <main className="page policy-page">
      <PageHeading eyebrow="CONTROL PLANE / POLICY ENGINE" title="Programmable Governance" description="Authorization logic mapped directly to entities, wallets, transaction types, and risk limits." actions={<div style={{ display: "flex", gap: 8 }}><button type="button" className="button secondary" onClick={() => setCreateOpen(true)}>Create draft</button><button type="button" className="button primary" onClick={() => setThresholdOpen(true)}>Create amount rule</button></div>} />
      <div className="policy-workbench">
        <section className="policy-list">
          <div className="policy-list-title"><p className="eyebrow">POLICY LIBRARY</p><span>{policies.length} {showArchived ? "ARCHIVED" : "ACTIVE"}</span></div>
          <div className="policy-list-filter" role="tablist" aria-label="Policy status">
            <button role="tab" aria-selected={!showArchived} className={!showArchived ? "active" : ""} onClick={() => { setShowArchived(false); setSelected(0); }}>Active <span>{activePolicyCount}</span></button>
            <button role="tab" aria-selected={showArchived} className={showArchived ? "active" : ""} onClick={() => { setShowArchived(true); setSelected(0); }}>Archived <span>{archivedPolicyCount}</span></button>
          </div>
          {policies.map((policy, i) => <button onClick={() => setSelected(i)} className={selectedPolicyIndex === i ? "active" : ""} key={policy.name}><span><strong>{policy.name}</strong><small>{policy.scope}</small></span><em>{policy.state}</em></button>)}
          {policies.length === 0 && <p className="policy-list-empty">{showArchived ? "No archived policies." : "No active policies."}</p>}
        </section>
        <section className="policy-canvas">
          {selectedPolicy && <>
            <div className="policy-canvas-head"><div><p className="eyebrow">POLICY / POL-{String(selectedPolicyIndex + 1).padStart(3, "0")}</p><h2>{selectedPolicy.name}</h2></div><div className="policy-state-control"><span className={selectedPolicy.state === "Review" ? "review" : selectedPolicy.state === "Archived" ? "archived" : selectedPolicy.state === "Disabled" ? "review" : ""}>● {selectedPolicy.state}</span>{showArchived
              ? <button type="button" className="button secondary" disabled={policyActionWorking} onClick={() => void updatePolicyArchive(selectedPolicy, "restore")}>{policyActionWorking ? "Restoring…" : "Restore"}</button>
              : <>{selectedPolicy.asset && selectedPolicy.threshold && <button type="button" className="button secondary" disabled={policyActionWorking} onClick={() => void updatePolicyState(selectedPolicy, selectedPolicy.state === "Disabled" ? "Enforced" : "Disabled")}>{policyActionWorking ? "Saving…" : selectedPolicy.state === "Disabled" ? "Enable" : "Disable"}</button>}<button type="button" className="button secondary" disabled={policyActionWorking} onClick={() => setArchiveTarget(selectedPolicy.name)}>Archive</button></>}</div></div>
            {selectedPolicy.state === "Draft" ? <div className="policy-draft-detail"><p className="eyebrow">PROPOSED CONTROL</p><p><strong>Scope:</strong> {selectedPolicy.scope}</p><p><strong>Rule:</strong> {selectedPolicy.rule}</p><p>This saved draft is not evaluated by transfer review. No enforcement or coverage is claimed.</p></div> : <>
              <div className="logic-flow">
                <div className="logic-node"><span>WHEN</span><strong>Transaction initiated</strong><small>{selectedPolicy.scope}</small></div><i />
                <div className="logic-node"><span>CHECK</span><strong>{selectedPolicy.asset ? `${selectedPolicy.asset} amount` : "Risk & compliance"}</strong><small>{selectedPolicy.asset ? `Above ${selectedPolicy.threshold} ${selectedPolicy.asset}` : "Sanctions · velocity · allowlist"}</small></div><i />
                <div className="logic-node featured"><span>{selectedPolicy.asset ? "MATCH" : "REQUIRE"}</span><strong>{selectedPolicy.asset ? "Human review" : selectedPolicy.rule.split(" · ")[0]}</strong><small>{selectedPolicy.asset ? "Operator decision required" : "Approved institutional signers"}</small></div><i />
                <div className="logic-node"><span>ENFORCE</span><strong>{selectedPolicy.asset ? "Record policy match" : selectedPolicy.rule.split(" · ")[1] || "Verified route"}</strong><small>{selectedPolicy.asset ? "No asset movement" : "Block on policy exception"}</small></div>
              </div>
              {selectedPolicy.asset
                ? <div className="policy-metrics"><div><span>RULE SCOPE</span><strong>New transfers</strong></div><div><span>ASSET</span><strong>{selectedPolicy.asset}</strong></div><div><span>THRESHOLD</span><strong>&gt; {selectedPolicy.threshold}</strong></div><div><span>EXECUTIONS</span><strong>From next review</strong></div></div>
                : <div className="policy-metrics"><div><span>EXECUTIONS</span><strong>Not tracked</strong></div><div><span>BLOCKED TRANSFERS</span><strong>Not tracked</strong></div><div><span>DECISION LATENCY</span><strong>Not tracked</strong></div><div><span>CONTROL COVERAGE</span><strong>Not instrumented</strong></div></div>}
            </>}
            {policyActionError && <p className="transfer-error" role="alert">{policyActionError}</p>}
          </>}
        </section>
      </div>
      <PolicyReview key={data.policies.map(policy => `${policy.name}:${policy.state}`).join("|")} onDecision={onDecision} />
      {createOpen && <CreatePolicy userId={userId} onClose={() => setCreateOpen(false)} onCreated={policy => {
        onPolicySaved(policy);
        setShowArchived(false);
        setSelected(activePolicyCount);
      }} />}
      {thresholdOpen && <CreatePolicyDialog userId={userId} assets={data.assets} policies={data.policies} onClose={() => setThresholdOpen(false)} onCreated={(policy, archivedPolicyNames) => {
        onPolicySaved(policy, archivedPolicyNames);
        setShowArchived(false);
        setSelected(activePolicyCount);
        setThresholdOpen(false);
      }} />}
      {archiveTarget && <div className="transfer-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !policyActionWorking) setArchiveTarget(""); }}>
        <section className="transfer-dialog policy-dialog" role="alertdialog" aria-modal="true" aria-labelledby="archive-policy-title" onMouseDown={event => event.stopPropagation()}>
          <div className="transfer-dialog-head"><div><p className="eyebrow">POLICY ENGINE / ARCHIVE</p><h2 id="archive-policy-title">Archive policy?</h2></div></div>
          <p className="transfer-explainer"><strong>{archiveTarget}</strong> will stop applying to future transfer reviews. Its audit history and definition will remain available in Archived policies. You can restore it later.</p>
          {policyActionError && <p className="transfer-error" role="alert">{policyActionError}</p>}
          <div className="transfer-actions"><button className="button secondary" disabled={policyActionWorking} onClick={() => setArchiveTarget("")}>Cancel</button><button className="button primary" disabled={policyActionWorking} onClick={() => {
            const policy = data.policies.find(item => item.name === archiveTarget);
            if (policy) void updatePolicyArchive(policy, "archive");
          }}>{policyActionWorking ? "Archiving…" : "Archive policy"}</button></div>
        </section>
      </div>}
    </main>
  );
}

function Reporting({ data, datasets }: { data: ExampleData; datasets: PortfolioDataset[] }) {
  const latestDataset = [...datasets].sort((left, right) => Date.parse(right.snapshot.asOf) - Date.parse(left.snapshot.asOf))[0];
  const snapshot = latestDataset?.snapshot;
  const obligations = snapshot?.obligations ?? [];
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [monthWasChanged, setMonthWasChanged] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  useEffect(() => {
    if (snapshot && !monthWasChanged) {
      const asOf = new Date(snapshot.asOf);
      setVisibleMonth(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1)));
    }
  }, [snapshot?.asOf, monthWasChanged]);
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const firstDayOffset = (visibleMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const previousMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const calendarCellCount = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonth);
  const obligationsByDate = new Map<string, typeof obligations>();
  for (const obligation of obligations) {
    const dateKey = new Date(obligation.dueAt).toISOString().slice(0, 10);
    obligationsByDate.set(dateKey, [...(obligationsByDate.get(dateKey) ?? []), obligation]);
  }
  const changeMonth = (increment: number) => {
    setMonthWasChanged(true);
    setVisibleMonth(current => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + increment, 1)));
  };
  const periodObligations = obligations.filter(obligation => {
    const dueAt = new Date(obligation.dueAt);
    return dueAt.getUTCFullYear() === year && dueAt.getUTCMonth() === month;
  });
  const periodAttention = periodObligations.filter(obligation => obligation.status === "at_risk" || obligation.status === "blocked");
  const monthQueue = [...periodObligations].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)).slice(0, 4);
  const cashUsdMinor = (snapshot?.cashBalances ?? []).filter(balance => balance.currency === "USD")
    .reduce((total, balance) => total + BigInt(balance.settledMinorUnits), 0n);
  const cashUsd = compactUsdFormatter.format(cashUsdMinor / 100n);
  const monthYearLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonth);
  const accountNames = new Map((latestDataset?.accounts ?? []).map(account => [account.id, account.name]));
  const activePolicies = data.policies.filter(policy => policy.state !== "Archived");
  const openReport = () => {
    setGeneratedAt(new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
    setReportOpen(true);
  };

  return (
    <main className="page reporting-page">
      <PageHeading eyebrow="REPORTING / IMPORTED DATA" title="Evidence & Reporting" description="Imported settlement obligations by due date and a read-only report for the selected month." actions={<button className="button primary" onClick={openReport}>Generate snapshot report</button>} />
      <div className="report-layout">
        <section className="report-calendar">
          <div className="report-month"><button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>←</button><h2>{monthLabel}</h2><button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>→</button></div>
          <div className="weekdays">{["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => <span key={d}>{d}</span>)}</div>
          <div className="days">{Array.from({ length: calendarCellCount }, (_, i) => {
            const day = i - firstDayOffset + 1;
            const outsideMonth = day < 1 || day > daysInMonth;
            const displayDay = day < 1 ? previousMonthDays + day : day > daysInMonth ? day - daysInMonth : day;
            const cellDate = new Date(Date.UTC(year, month, day));
            const dateKey = cellDate.toISOString().slice(0, 10);
            const dayObligations = obligationsByDate.get(dateKey) ?? [];
            return <div className={`${dateKey === new Date().toISOString().slice(0, 10) ? "today" : ""} ${outsideMonth ? "muted" : ""}`} key={dateKey}><span>{displayDay}</span>{dayObligations.length > 0 && <b>{dayObligations.length === 1 ? dayObligations[0].externalId : `${dayObligations.length} obligations`}</b>}</div>;
          })}</div>
        </section>
        <aside className="report-queue">
          <p className="eyebrow">OBLIGATIONS DUE · {monthLabel.toUpperCase()}</p>
          {monthQueue.map((obligation, i) => {
            const requiredUnits = BigInt(obligation.requiredUnits);
            const settledPercent = requiredUnits > 0n ? Math.min(100, Number(BigInt(obligation.settledUnits) * 100n / requiredUnits)) : 0;
            return <div className="report-item" key={obligation.id}><span>0{i + 1}</span><div><strong>{obligation.externalId}</strong><small>{new Date(obligation.dueAt).toLocaleString()} · {obligation.status.replaceAll("_", " ")}</small><i><b style={{ width: `${settledPercent}%` }} /></i></div><em>{obligation.status.replaceAll("_", " ")}</em></div>;
          })}
          {monthQueue.length === 0 && <p role="status">{snapshot ? "No obligations are due in this month in the imported snapshot." : "Import a dataset to see obligations by due date."}</p>}
          <div className="assurance-seal"><Icon name="check" size={22} /><span><strong>{latestDataset?.dataset.name ?? "No dataset loaded"}</strong><small>{snapshot ? `Snapshot as of ${new Date(snapshot.asOf).toLocaleString()}` : "No imported snapshot available"}</small></span></div>
        </aside>
      </div>
      {reportOpen && <div className="report-overlay" onMouseDown={() => setReportOpen(false)}>
        <section className="report-preview" role="dialog" aria-modal="true" aria-labelledby="report-preview-title" onMouseDown={event => event.stopPropagation()}>
          <header className="report-preview-head">
            <div><p className="eyebrow">CUSTODYOS / OPERATIONS EVIDENCE</p><h2 id="report-preview-title">Workspace snapshot report</h2><span>{monthYearLabel} · {latestDataset?.dataset.name ?? "No imported dataset"}</span></div>
            <button type="button" aria-label="Close report preview" onClick={() => setReportOpen(false)}>×</button>
          </header>
          <div className="report-document">
            <div className="report-period"><span>SELECTED REPORT MONTH</span><strong>{monthYearLabel}</strong></div>
            <div className="report-document-meta"><span>GENERATED {generatedAt}</span><span>DATASET {latestDataset?.dataset.id ?? "NONE"}</span><span>SNAPSHOT {snapshot ? new Date(snapshot.asOf).toLocaleString() : "NOT AVAILABLE"}</span><span>PERIOD OBLIGATIONS {periodObligations.length}</span></div>
            <section className="report-executive">
              <p className="eyebrow">EXECUTIVE SUMMARY</p>
              <div className="report-kpis">
                <div><span>USD SETTLED CASH</span><strong>{snapshot ? cashUsd : "—"}</strong><small>{snapshot?.cashBalances.filter(balance => balance.currency === "USD").length ?? 0} USD cash entries</small></div>
                <div><span>OBLIGATIONS DUE</span><strong>{periodObligations.length}</strong><small>{monthYearLabel}</small></div>
                <div><span>AT RISK / BLOCKED</span><strong>{periodAttention.length}</strong><small>in selected month</small></div>
                <div><span>ACCOUNTS</span><strong>{latestDataset?.accounts.length ?? "—"}</strong><small>in selected dataset</small></div>
              </div>
            </section>
            <div className="report-columns">
              <section><p className="eyebrow">OBLIGATION EVIDENCE · {monthYearLabel.toUpperCase()}</p>{periodObligations.slice(0, 5).map(obligation => <div className="report-evidence-row" key={obligation.id}><span><strong>{obligation.externalId} · {obligation.status.replaceAll("_", " ")}</strong><small>{accountNames.get(obligation.fromAccountId) ?? obligation.fromAccountId} → {accountNames.get(obligation.toAccountId) ?? obligation.toAccountId}</small></span><em>{new Date(obligation.dueAt).toLocaleString()}</em></div>)}{periodObligations.length === 0 && <p>No imported obligations are due in the selected month.</p>}</section>
              <section><p className="eyebrow">POLICY CONTROLS</p>{data.policies.map(policy => <div className="report-evidence-row" key={policy.name}><span><strong>{policy.name}</strong><small>{policy.scope} · {policy.rule}</small></span><em>{policy.state}</em></div>)}{data.policies.length === 0 && <p>No policies are configured for this account.</p>}</section>
            </div>
            <div className="report-disclosure"><Icon name="check" size={18} /><span><strong>Read-only snapshot report</strong><small>Balances reflect the imported snapshot timestamp above. Obligation counts and evidence rows include only obligations due in the selected month. No historical balance series is implied.</small></span></div>
          </div>
          <footer className="report-preview-actions"><span>Read-only export · no operational records changed</span><div><button type="button" className="button secondary" onClick={() => setReportOpen(false)}>Close</button><button type="button" className="button primary" onClick={() => window.print()}>Print / Save PDF</button></div></footer>
        </section>
      </div>}
    </main>
  );
}

function CommandPalette({ close, setPage }: { close: () => void; setPage: (page: Page) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const filteredNavigation = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return navigation.filter(({ label }) => label.toLocaleLowerCase().includes(normalizedQuery));
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="command-overlay" onMouseDown={close}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-input"><Icon name="search" /><input ref={inputRef} aria-label="Search entities, wallets, transactions, or commands" placeholder="Search entities, wallets, transactions, or commands…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") close(); }} /></div>
        <p className="eyebrow">NAVIGATE</p>
        {filteredNavigation.length > 0
          ? filteredNavigation.map(n => <button key={n.label} onClick={() => { setPage(n.label); close(); }}><Icon name={n.icon} /><span>{n.label}</span><kbd>↵</kbd></button>)
          : <p className="command-empty" role="status">No matching commands</p>}
        <div className="command-foot"><span>↑↓ Navigate</span><span>↵ Open</span><span>esc Close</span></div>
      </div>
    </div>
  );
}

export default function App() {
  const router = useRouter();
  const [USER_ID, setUSER_ID] = useState("");
  const [page, setPage] = useState<Page>("Overview");
  const [commandOpen, setCommandOpen] = useState(false);
  const [financialData, setFinancialData] = useState<ExampleData>(emptyFinancialData);
  const [portfolioDatasets, setPortfolioDatasets] = useState<PortfolioDataset[]>([]);
  const [financialDataLoaded, setFinancialDataLoaded] = useState(false);
  const [financialDataError, setFinancialDataError] = useState("");
  const [reviews, setReviews] = useState<TransferReviews | null>(null);
  const [twinRefreshError, setTwinRefreshError] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const refreshSequence = useRef(0);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferNotice, setTransferNotice] = useState("");
  const [datasetImportOpen, setDatasetImportOpen] = useState(false);
  const [datasetImportNotice, setDatasetImportNotice] = useState("");
  useEffect(() => {
    const userId = window.sessionStorage.getItem("userid")?.trim() ?? "";
    if (!userId) {
      router.replace("/login");
      return;
    }
    setUSER_ID(userId);
  }, [router]);
  const closeTransfer = useCallback(() => setTransferOpen(false), []);
  const openTransfer = useCallback(() => { setTransferNotice(""); setTransferOpen(true); }, []);
  const onTransferCreated = useCallback((transaction: ExampleTransaction) => {
    setFinancialData(current => ({ ...current, transactions: [transaction, ...current.transactions] }));
    setTransferNotice(`Transfer request ${transaction.id} recorded. Status: ${transaction.status}. No assets have moved.`);
    setPage("Transactions");
    setTransferOpen(false);
  }, []);
  const onPolicyDecision = useCallback((id: string, status: ExampleTransaction["status"]) => {
    setFinancialData(current => ({ ...current, transactions: current.transactions.map(transaction =>
      transaction.id === id ? { ...transaction, status } : transaction) }));
  }, []);
  const onPolicySaved = useCallback((policy: ExamplePolicy, archivedPolicyNames: string[] = []) => {
    setFinancialData(current => {
      let found = false;
      const policies = current.policies.map(existing => {
        if (existing.name === policy.name) { found = true; return policy; }
        if (archivedPolicyNames.includes(existing.name)) return { ...existing, state: "Archived" };
        return existing;
      });
      return { ...current, policies: found ? policies : [...policies, policy] };
    });
  }, []);

  const refresh = useCallback(async (withReviews: boolean, force = false) => {
    if (!USER_ID) {
      router.replace("/login");
      return;
    }
    if (refreshController.current && !force) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const sequence = ++refreshSequence.current;
    try {
      let body: FinancialDataResponse;
      try {
        const financialResponse = await fetch(`/api/users/${encodeURIComponent(USER_ID)}/financial-data`, { signal: controller.signal, cache: "no-store" });
        body = await financialResponse.json() as FinancialDataResponse;
        if (!financialResponse.ok || !body.ok) throw new Error(body.ok ? `Financial data request failed with status ${financialResponse.status}.` : body.error.message);
        if (body.data.userId !== USER_ID || !Array.isArray(body.data.assets) || !Array.isArray(body.data.transactions)
          || !Array.isArray(body.data.policies) || !Array.isArray(body.data.nodes) || !Array.isArray(body.data.edges)
          || !Array.isArray(body.data.datasets)) {
          throw new Error("Financial data endpoint returned an invalid response.");
        }
      } catch (error) {
        if (controller.signal.aborted || sequence !== refreshSequence.current) return;
        console.error("Unable to load financial data for the signed-in user.", error);
        window.sessionStorage.removeItem("userid");
        router.replace("/login");
        return;
      }

      if (controller.signal.aborted || sequence !== refreshSequence.current) return;
      setFinancialData({ assets: body.data.assets, transactions: body.data.transactions, policies: body.data.policies,
        nodes: body.data.nodes, edges: body.data.edges });
      setPortfolioDatasets(body.data.datasets);
      setFinancialDataLoaded(true);
      setFinancialDataError("");

      if (withReviews) {
        try {
          const reviewsResponse = await fetch("/api/transfer/reviews", { signal: controller.signal, cache: "no-store" });
          const reviewBody = await reviewsResponse.json() as ReviewsResponse;
          if (!reviewsResponse.ok || !reviewBody.ok) throw new Error(reviewBody.ok ? "Unable to load transfer reviews." : reviewBody.error.message);
          if (!Array.isArray(reviewBody.data.transfers) || !Array.isArray(reviewBody.data.audit)) throw new Error("Review endpoint returned an invalid response.");
          if (controller.signal.aborted || sequence !== refreshSequence.current) return;
          setReviews(reviewBody.data);
          setTwinRefreshError("");
        } catch (error) {
          if (controller.signal.aborted || sequence !== refreshSequence.current) return;
          console.error("Unable to refresh transfer reviews.", error);
          setTwinRefreshError("Unable to refresh requests. Showing last loaded data.");
        }
      }
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
    }
  }, [USER_ID, router]);

  const onDatasetImported = useCallback((result: Extract<ImportDatasetResponse, { ok: true }>['data']) => {
    setDatasetImportOpen(false);
    setDatasetImportNotice(`${result.dataset.name} imported · ${result.imported.accounts} accounts · ${result.imported.obligations} obligations. Dashboard data refreshed.`);
    void refresh(page === "Digital Twin", true);
  }, [page, refresh]);

  useEffect(() => {
    if (!USER_ID) return;
    void refresh(page === "Digital Twin", true);
    return () => refreshController.current?.abort();
  }, [USER_ID, page, refresh]);

  useEffect(() => {
    if (!USER_ID || page !== "Digital Twin") return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 15_000);
    return () => { window.clearInterval(timer); refreshController.current?.abort(); };
  }, [USER_ID, page, refresh]);

  useEffect(() => {
    if (!USER_ID) return;
    const refreshVisibleWorkspace = () => {
      if (document.visibilityState === "visible") void refresh(page === "Digital Twin", true);
    };
    window.addEventListener("focus", refreshVisibleWorkspace);
    document.addEventListener("visibilitychange", refreshVisibleWorkspace);
    return () => {
      window.removeEventListener("focus", refreshVisibleWorkspace);
      document.removeEventListener("visibilitychange", refreshVisibleWorkspace);
    };
  }, [USER_ID, page, refresh]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }

      if (event.key === "Escape" && commandOpen) {
        event.preventDefault();
        setCommandOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandOpen]);
  const pages: Record<Page, React.ReactNode> = {
    "Overview": <Overview data={financialData} datasets={portfolioDatasets} onNewTransfer={openTransfer} onImportDataset={() => { setDatasetImportNotice(""); setDatasetImportOpen(true); }} importNotice={datasetImportNotice} />,
    "Digital Twin": <DigitalTwin data={financialData} reviews={reviews} refreshError={twinRefreshError} />,
    "Portfolios": <Portfolios datasets={portfolioDatasets} userId={USER_ID} onOpenTwin={() => setPage("Digital Twin")} />,
    "Transactions": <Transactions data={financialData} datasets={portfolioDatasets} onNewTransfer={openTransfer} notice={transferNotice} />,
    "Policy Engine": <PolicyEngine data={financialData} userId={USER_ID} onDecision={onPolicyDecision} onPolicySaved={onPolicySaved} />,
    "Reporting": <Reporting data={financialData} datasets={portfolioDatasets} />,
  };
  if (!USER_ID || !financialDataLoaded) return null;

  return (
    <div className="app-shell make-prototype" data-data-source="account-api">
      <Rail page={page} setPage={setPage} />
      <Header page={page} setPage={setPage} openCommand={() => setCommandOpen(true)} datasets={portfolioDatasets} />
      {financialDataError && <p className="transfer-load-error" role="alert">{financialDataError}</p>}
      {pages[page]}
      <footer className="statusbar"><span>DATASETS <b>{portfolioDatasets.length}</b></span><span>SNAPSHOT <b>{portfolioDatasets.length ? new Date([...portfolioDatasets].sort((left, right) => Date.parse(right.snapshot.asOf) - Date.parse(left.snapshot.asOf))[0].snapshot.asOf).toLocaleString() : "NOT LOADED"}</b></span><span>POLICY RULES <b>{financialData.policies.length}</b></span></footer>
      {commandOpen && <CommandPalette close={() => setCommandOpen(false)} setPage={setPage} />}
      {datasetImportOpen && <DatasetImportDialog latestSnapshotAsOf={portfolioDatasets.reduce<string | null>((latest, dataset) => !latest || Date.parse(dataset.snapshot.asOf) > Date.parse(latest) ? dataset.snapshot.asOf : latest, null)} onClose={() => setDatasetImportOpen(false)} onImported={onDatasetImported} />}
      {transferOpen && (financialDataLoaded
        ? <TransferDialog userId={USER_ID} assets={financialData.assets} onClose={closeTransfer} onCreated={onTransferCreated} />
        : <div className="transfer-overlay" onMouseDown={closeTransfer}><section className="transfer-dialog" role="dialog" aria-modal="true" aria-label="New transfer" onMouseDown={event => event.stopPropagation()}><p role="status">{financialDataError || "Loading demo inventory…"}</p><button type="button" className="button secondary" onClick={closeTransfer}>Close</button></section></div>)}
    </div>
  );
}
