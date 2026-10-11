"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { exampleData, type ExampleData, type ExamplePolicy, type ExampleTransaction } from "@/contracts";
import { TransferDialog } from "./transfer-dialog";
import { PolicyReview } from "./policy-review";
import { formatLedgerAmount } from "./ledger-amount";
import { joinTwinTransfers, policyResultLabel, type TransferReviews, type TwinTransfer } from "./twin-transfers";
import { SettlementCanvas, SettlementInspector, useSettlementSimulation } from "./settlement-simulation";
import { activityNodes, topologyDemoActivities, type TopologyActivity } from "./topology-activity";
import { downloadTopologySvg } from "./topology-export";
import { TopologyPanel } from "./topology-panel";
import { CreatePolicy } from "./create-policy";
import { AllocationDonut, CategorizedInventory, inventoryViews, type InventoryView, type PortfolioDataset } from "./portfolio-inventory";

type Page = "Overview" | "Digital Twin" | "Portfolios" | "Transactions" | "Policy Engine" | "Reporting";

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

function Header({ page, setPage, openCommand }: { page: Page; setPage: (page: Page) => void; openCommand: () => void }) {
  return (
    <>
      <header className="topbar">
        <button type="button" className="wordmark" aria-label="CustodyOS home" onClick={() => setPage("Overview")}>CUSTODY<span>OS</span></button>
        <div className="desk-name">GLOBAL DIGITAL ASSET OPERATIONS</div>
        <div className="market-strip">
          <span>BTC</span><strong>$67,842.10</strong><em>+1.82%</em>
          <span>ETH</span><strong>$3,486.22</strong><em>+0.94%</em>
        </div>
        <div className="system-health"><i /> SYSTEMS NOMINAL</div>
        <button className="institution">ACME BANK <span>⌄</span></button>
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

function Overview({ data, onNewTransfer }: { data: ExampleData; onNewTransfer: () => void }) {
  const { assets, transactions } = data;
  const netAssetValue = sumAssetValues(assets);
  const attentionTransactions = transactions.filter(transaction => transaction.status !== "Completed");
  const bars = [38, 48, 45, 58, 56, 63, 72, 68, 78, 74, 82, 88, 84, 93, 90, 98, 94, 104, 112, 108, 118, 124, 121, 132];
  const [activeChartPoint, setActiveChartPoint] = useState<number | null>(null);
  const chartPoints = bars.map((height, index) => {
    const progress = index / (bars.length - 1);
    const trendHeight = 38 + progress * (132 - 38);
    const valueBillions = Math.min(8.42, Math.max(8.1, 8.1 + progress * 0.32 + (height - trendHeight) * 0.00025));
    const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(2025, 8, 9 + Math.round(progress * 31))));
    return { height, date, value: `~$${valueBillions.toFixed(2)}B` };
  });
  return (
    <main className="page">
      <PageHeading eyebrow="COMMAND CENTER / 10 OCT 2025" title="Operational Overview" description="Estate health, treasury posture, and high-priority actions across the global custody network." actions={<button className="button primary" onClick={onNewTransfer}>New transfer</button>} />
      <div className="overview-grid">
        <section className="exposure-panel">
          <div className="panel-top"><p className="eyebrow">ASSETS UNDER CUSTODY</p><span className="positive">+2.4% MTD</span></div>
          <div className="hero-number">{compactUsdFormatter.format(netAssetValue)}</div>
          <div className="chart">
            {chartPoints.map((point, i) => (
              <i
                key={i}
                style={{ height: point.height }}
                className={i > 19 ? "current" : ""}
                tabIndex={0}
                aria-label={`Estimated sample assets under custody: ${point.value} on ${point.date}`}
                onPointerEnter={() => setActiveChartPoint(i)}
                onPointerLeave={() => setActiveChartPoint((active) => active === i ? null : active)}
                onFocus={() => setActiveChartPoint(i)}
                onBlur={() => setActiveChartPoint((active) => active === i ? null : active)}
              >
                {activeChartPoint === i && <span className="chart-tooltip" aria-hidden="true">{point.date}<strong>{point.value}</strong></span>}
              </i>
            ))}
          </div>
          <div className="chart-axis"><span>09 SEP</span><span>18 SEP</span><span>27 SEP</span><span>10 OCT</span></div>
        </section>
        <section className="action-ledger">
          <div className="panel-top"><p className="eyebrow">REQUIRES ATTENTION</p><span>{String(attentionTransactions.length).padStart(2, "0")} OPEN</span></div>
          {attentionTransactions.map((transaction, index) => (
            <button className="action-row" key={transaction.id}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span><strong>{transaction.type} · {transaction.status}</strong><small>{transaction.asset} · {transaction.amount}</small></span>
              <time>{transaction.time}</time><Icon name="arrow" size={14} />
            </button>
          ))}
        </section>
        <section className="asset-ribbon">
          <p className="eyebrow">ASSET COMPOSITION</p>
          <div className="allocation-bar">{assets.map(a => <i key={a.symbol} style={{ width: `${a.share}%` }} />)}</div>
          <div className="asset-mini-grid">{assets.slice(0, 4).map(a => <div key={a.symbol}><span>{a.symbol}</span><strong>{a.value}</strong><small>{a.share}%</small></div>)}</div>
        </section>
        <section className="operations-stream">
          <div className="panel-top"><p className="eyebrow">LIVE OPERATIONS</p><span className="live-dot">LIVE</span></div>
          {transactions.slice(0, 4).map(tx => <div className="stream-row" key={tx.id}><time>{tx.time}</time><i /><span>{tx.type} · {tx.asset}</span><strong>{tx.value}</strong><small>{tx.status}</small></div>)}
        </section>
      </div>
    </main>
  );
}

function Portfolios({ data, datasets, userId, onOpenTwin }: { data: ExampleData; datasets: PortfolioDataset[]; userId: string; onOpenTwin: () => void }) {
  const { assets } = data;
  const netAssetValue = sumAssetValues(assets);
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
      <PageHeading eyebrow={`PORTFOLIOS / ${active.toUpperCase()}`} title="Asset Inventory" description="Position-level visibility for loaded sample assets and classified imported accounts." actions={<button className="button secondary" onClick={runReconciliation}>Run reconciliation</button>} />
      <div className="portfolio-switcher" role="tablist" aria-label="Inventory views">{inventoryViews.map(x => <button type="button" role="tab" aria-selected={active === x} className={active === x ? "active" : ""} onClick={() => setActive(x)} key={x}>{x}</button>)}</div>
      <section className="portfolio-ledger">
        {active === "Consolidated" ? <>
        <div className="portfolio-overview">
          <div className="portfolio-summary">
            <div><span>NET ASSET VALUE</span><strong>{compactUsdFormatter.format(netAssetValue)}</strong></div>
            <div><span>SAMPLE 24H MOVEMENT</span><strong className="positive">+$116.24M</strong></div>
            <div><span>SAMPLE LIQUIDITY</span><strong>$1.84B</strong></div>
            <div><span>SAMPLE NETWORKS</span><strong>14</strong></div>
          </div>
          <AllocationDonut assets={assets} />
        </div>
        <p className="portfolio-disclosure">Consolidated positions are the loaded sample asset summary. They are not mapped to imported custody accounts.</p>
        <div className="ledger-head"><span>ASSET</span><span>BALANCE</span><span>MARKET VALUE</span><span>24H</span><span>ALLOCATION</span></div>
        {assets.map((asset) => (
          <button className="asset-row" key={asset.symbol}>
            <span className="asset-name"><i>{asset.symbol.slice(0, 1)}</i><b>{asset.symbol}<small>{asset.name}</small></b></span>
            <span>{asset.balance}</span><strong>{asset.value}</strong>
            <span className={asset.change.startsWith("-") ? "negative" : "positive"}>{asset.change}</span>
            <span className="allocation"><i><b style={{ width: `${asset.share * 2.1}%` }} /></i>{asset.share}%</span>
          </button>
        ))}
        {assets.length === 0 && <div className="portfolio-empty" role="status"><h2>No consolidated assets</h2><p>This user has no loaded sample asset positions.</p></div>}
        </> : <CategorizedInventory view={active} datasets={datasets} />}
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

function Transactions({ data, onNewTransfer, notice }: { data: ExampleData; onNewTransfer: () => void; notice: string }) {
  const { assets } = data;
  const maxAssetShare = Math.max(0, ...assets.map((asset) => asset.share));
  const transactionValue = sumTransactionValues(data.transactions);
  const [filter, setFilter] = useState("All activity");
  const displayed = useMemo(() => filter === "All activity" ? data.transactions : data.transactions.filter(t => t.status === filter), [filter, data.transactions]);
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
          <div><span>FINALITY RATE</span><strong>99.998%</strong><small>Median 3.2 sec</small></div>
        </div>
        <div className="volume-chart" aria-label="Asset market value by asset">
          {assets.map((asset) => (
            <div className="volume-column" key={asset.symbol}>
              <span>{asset.value}</span>
              <div><i style={{ height: `${maxAssetShare ? (asset.share / maxAssetShare) * 86 : 0}%` }} /></div>
              <strong>{asset.symbol}</strong>
            </div>
          ))}
        </div>
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
                : <div className="policy-metrics"><div><span>SAMPLE EXECUTIONS / 30D</span><strong>2,481</strong></div><div><span>SAMPLE BLOCKED</span><strong>14</strong></div><div><span>SAMPLE AVG. DECISION</span><strong>184ms</strong></div><div><span>SAMPLE COVERAGE</span><strong>{selectedPolicy.coverage}%</strong></div></div>}
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

function Reporting({ data }: { data: ExampleData }) {
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(Date.UTC(2026, 9, 1)));
  const [reportOpen, setReportOpen] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const firstDayOffset = (visibleMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const previousMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const calendarCellCount = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonth);
  const sampleEvents: Record<string, string> = {
    "2026-10-03": "Reserve attestation",
    "2026-10-10": "SOC evidence pack",
    "2026-10-17": "NYDFS filing",
    "2026-10-28": "Client statements",
    "2026-11-01": "Proof of reserves",
  };
  const changeMonth = (increment: number) => setVisibleMonth(current =>
    new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + increment, 1)));
  const transactionValue = data.transactions.reduce((total, transaction) =>
    transaction.value.trim() === "—" ? total : total + parseUsdValue(transaction.value, transaction.id), 0);
  const completedTransactions = data.transactions.filter(transaction => transaction.status === "Completed").length;
  const attentionTransactions = data.transactions.length - completedTransactions;
  const activePolicies = data.policies.filter(policy => policy.state !== "Archived");
  const enforcedPolicies = activePolicies.filter(policy => policy.state === "Enforced").length;
  const averageCoverage = activePolicies.length
    ? Math.round(activePolicies.reduce((total, policy) => total + policy.coverage, 0) / activePolicies.length)
    : 0;
  const openReport = () => {
    setGeneratedAt(new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
    setReportOpen(true);
  };

  return (
    <main className="page reporting-page">
      <PageHeading eyebrow="REPORTING / SAMPLE SCHEDULE" title="Evidence & Reporting" description="Sample reporting dates and evidence queue. Calendar navigation changes the schedule view; snapshot exports use all currently loaded workspace data." actions={<button className="button primary" onClick={openReport}>Generate snapshot report</button>} />
      <div className="report-layout">
        <section className="report-calendar">
          <div className="report-month"><button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>←</button><h2>{monthLabel} · Sample</h2><button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>→</button></div>
          <div className="weekdays">{["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => <span key={d}>{d}</span>)}</div>
          <div className="days">{Array.from({ length: calendarCellCount }, (_, i) => {
            const day = i - firstDayOffset + 1;
            const outsideMonth = day < 1 || day > daysInMonth;
            const displayDay = day < 1 ? previousMonthDays + day : day > daysInMonth ? day - daysInMonth : day;
            const cellDate = new Date(Date.UTC(year, month, day));
            const dateKey = cellDate.toISOString().slice(0, 10);
            const event = sampleEvents[dateKey];
            return <div className={`${dateKey === "2026-10-10" ? "today" : ""} ${outsideMonth ? "muted" : ""}`} key={dateKey}><span>{displayDay}</span>{event && <b>{event}</b>}</div>;
          })}</div>
        </section>
        <aside className="report-queue">
          <p className="eyebrow">SAMPLE OBLIGATION QUEUE</p>
          {[["SOC 2 evidence pack","10 Oct 2026 · 18:00 UTC","94%"],["NYDFS custody filing","17 Oct 2026","71%"],["Q3 client statements","28 Oct 2026","42%"],["Proof of reserves","01 Nov 2026","18%"]].map((r, i) => <div className="report-item" key={r[0]}><span>0{i + 1}</span><div><strong>{r[0]}</strong><small>{r[1]}</small><i><b style={{ width: r[2] }} /></i></div><em>{r[2]}</em></div>)}
          <div className="assurance-seal"><Icon name="check" size={22} /><span><strong>Demo evidence queue</strong><small>No connected evidence source</small></span></div>
        </aside>
      </div>
      {reportOpen && <div className="report-overlay" onMouseDown={() => setReportOpen(false)}>
        <section className="report-preview" role="dialog" aria-modal="true" aria-labelledby="report-preview-title" onMouseDown={event => event.stopPropagation()}>
          <header className="report-preview-head">
            <div><p className="eyebrow">CUSTODYOS / OPERATIONS EVIDENCE</p><h2 id="report-preview-title">Workspace snapshot report</h2><span>October 2026 reference period · ACME Bank</span></div>
            <button type="button" aria-label="Close report preview" onClick={() => setReportOpen(false)}>×</button>
          </header>
          <div className="report-document">
            <div className="report-period"><span>SNAPSHOT REFERENCE PERIOD</span><strong>October 2026</strong></div>
            <div className="report-document-meta"><span>GENERATED {generatedAt}</span><span>WORKSPACE demo-user</span><span>REFERENCE MONTH OCTOBER 2026</span><span>STATUS SAMPLE DATA</span></div>
            <section className="report-executive">
              <p className="eyebrow">EXECUTIVE SUMMARY</p>
              <div className="report-kpis">
                <div><span>ASSETS UNDER CUSTODY</span><strong>{compactUsdFormatter.format(sumAssetValues(data.assets))}</strong><small>{data.assets.length} asset classes</small></div>
                <div><span>LOADED ACTIVITY</span><strong>{compactUsdFormatter.format(transactionValue)}</strong><small>{data.transactions.length} transactions</small></div>
                <div><span>REQUIRES ATTENTION</span><strong>{attentionTransactions}</strong><small>{completedTransactions} completed</small></div>
                <div><span>POLICY COVERAGE</span><strong>{averageCoverage}%</strong><small>{enforcedPolicies} enforced · {activePolicies.length} active</small></div>
              </div>
            </section>
            <div className="report-columns">
              <section><p className="eyebrow">TRANSACTION EVIDENCE</p>{data.transactions.slice(0, 5).map(transaction => <div className="report-evidence-row" key={transaction.id}><span><strong>{transaction.type} · {transaction.asset}</strong><small>{transaction.id} · {transaction.route}</small></span><em>{transaction.status}</em></div>)}</section>
              <section><p className="eyebrow">POLICY CONTROLS</p>{data.policies.map(policy => <div className="report-evidence-row" key={policy.name}><span><strong>{policy.name}</strong><small>{policy.scope} · {policy.rule}</small></span><em>{policy.state} · {policy.coverage}%</em></div>)}</section>
            </div>
            <div className="report-disclosure"><Icon name="check" size={18} /><span><strong>Evidence package generated from the loaded workspace</strong><small>This report always represents the October 2026 sample snapshot. Calendar navigation only changes the obligation schedule view; production exports should derive their period from immutable dataset and snapshot timestamps.</small></span></div>
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
  const [financialData, setFinancialData] = useState<ExampleData>(exampleData);
  const [portfolioDatasets, setPortfolioDatasets] = useState<PortfolioDataset[]>([]);
  const [financialDataLoaded, setFinancialDataLoaded] = useState(false);
  const [financialDataError, setFinancialDataError] = useState("");
  const [reviews, setReviews] = useState<TransferReviews | null>(null);
  const [twinRefreshError, setTwinRefreshError] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const refreshSequence = useRef(0);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferNotice, setTransferNotice] = useState("");
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

  useEffect(() => {
    if (!USER_ID) return;
    void refresh(false, true);
    return () => refreshController.current?.abort();
  }, [USER_ID, refresh]);

  useEffect(() => {
    if (!USER_ID || page !== "Digital Twin") return;
    void refresh(true, true);
    const onFocus = () => { void refresh(true); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 15_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); refreshController.current?.abort(); };
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
    "Overview": <Overview data={financialData} onNewTransfer={openTransfer} />,
    "Digital Twin": <DigitalTwin data={financialData} reviews={reviews} refreshError={twinRefreshError} />,
    "Portfolios": <Portfolios data={financialData} datasets={portfolioDatasets} userId={USER_ID} onOpenTwin={() => setPage("Digital Twin")} />,
    "Transactions": <Transactions data={financialData} onNewTransfer={openTransfer} notice={transferNotice} />,
    "Policy Engine": <PolicyEngine data={financialData} userId={USER_ID} onDecision={onPolicyDecision} onPolicySaved={onPolicySaved} />,
    "Reporting": <Reporting data={financialData} />,
  };
  if (!USER_ID || !financialDataLoaded) return null;

  return (
    <div className="app-shell make-prototype" data-data-source="figma-demo-sample">
      <Rail page={page} setPage={setPage} />
      <Header page={page} setPage={setPage} openCommand={() => setCommandOpen(true)} />
      {financialDataError && <p className="transfer-load-error" role="alert">{financialDataError}</p>}
      {pages[page]}
      <footer className="statusbar"><span>NETWORK <b>MAINNET</b></span><span>LAST FINALITY <b>3.2 SEC</b></span><span>POLICY ENGINE <b className="positive">OPERATIONAL</b></span><time>UTC 16:42:09</time></footer>
      {commandOpen && <CommandPalette close={() => setCommandOpen(false)} setPage={setPage} />}
      {transferOpen && (financialDataLoaded
        ? <TransferDialog assets={financialData.assets} onClose={closeTransfer} onCreated={onTransferCreated} />
        : <div className="transfer-overlay" onMouseDown={closeTransfer}><section className="transfer-dialog" role="dialog" aria-modal="true" aria-label="New transfer" onMouseDown={event => event.stopPropagation()}><p role="status">{financialDataError || "Loading demo inventory…"}</p><button type="button" className="button secondary" onClick={closeTransfer}>Close</button></section></div>)}
    </div>
  );
}
