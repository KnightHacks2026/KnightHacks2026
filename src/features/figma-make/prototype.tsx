"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { exampleData, type ExampleData, type ExampleTransaction } from "@/contracts";
import { TransferDialog } from "./transfer-dialog";
import { PolicyReview } from "./policy-review";
import { formatLedgerAmount } from "./ledger-amount";
import { joinTwinTransfers, policyResultLabel, type TransferReviews, type TwinTransfer } from "./twin-transfers";
import { SettlementCanvas, SettlementInspector, useSettlementSimulation } from "./settlement-simulation";

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

const DEMO_USER_ID = "demo-user";

type FinancialDataResponse =
  | { ok: true; data: ExampleData & { userId: string; datasets: unknown[] } }
  | { ok: false; error: { message: string } };

type ReviewsResponse =
  | { ok: true; data: TransferReviews }
  | { ok: false; error: { message: string } };

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
      <button className="brand-mark" aria-label="CustodyOS home" onClick={() => setPage("Digital Twin")}><span /></button>
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
        <button className="wordmark" onClick={() => setPage("Digital Twin")}>CUSTODY<span>OS</span></button>
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
  const [selected, setSelected] = useState("ACME BANK");
  const [selectedTransferId, setSelectedTransferId] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 960, height: 550 });
  const [nodes, setNodes] = useState(() => structuredClone(data.nodes));
  const netAssetValue = sumAssetValues(data.assets);
  const edges = data.edges;
  const transfers = useMemo(() => reviews ? joinTwinTransfers(data.transactions, reviews) : [], [data.transactions, reviews]);
  const selectedTransfer = transfers.find(item => item.transaction.id === selectedTransferId);
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
    setDragging(id);
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

  return (
    <main className="page twin-page">
      <PageHeading
        eyebrow={settlement.mode ? "DIGITAL TWIN / SYNTHETIC PREVIEW" : "DIGITAL TWIN / LIVE ESTATE"}
        title={settlement.mode ? "Settlement Simulation" : "Institutional Asset Topology"}
        description={settlement.mode ? "Explore a three-leg settlement dependency chain and compare local funding previews." : "A real-time model of entities, wallets, controls, networks, and settlement exposure."}
        actions={settlement.mode ? undefined : <><button className="button secondary">Export view</button><button className="button primary">Open console</button></>}
      />
      <div className="twin-mode-switch" role="group" aria-label="Digital Twin mode"><button type="button" aria-pressed={!settlement.mode} onClick={() => settlement.setMode(false)}>Institutional topology</button><button type="button" aria-pressed={settlement.mode} onClick={() => settlement.setMode(true)}>Settlement Simulation</button></div>
      <div className={`twin-layout ${settlement.mode ? "twin-layout--simulation" : ""}`}>
        {settlement.mode ? <SettlementCanvas state={settlement} /> : <section className="graph-shell">
          <div className="graph-meta"><span>DEMO TOPOLOGY</span><b>● {nodes.length} VISIBLE NODES</b><span>{edges.length} EDGES</span><span>PERSISTED REQUESTS IN INSPECTOR</span></div>
          <svg
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
            {nodes.map((n) => (
              <g
                className={`network-node ${n.type} ${selected === n.id ? "selected" : ""} ${dragging === n.id ? "dragging" : ""}`}
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={(event) => beginDrag(event, n.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(n.id); }}
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
        {settlement.mode ? <SettlementInspector state={settlement} /> : <EntityInspector selected={selected} assets={data.assets} transfers={transfers} selectedTransfer={selectedTransfer} onSelectTransfer={setSelectedTransferId} refreshError={refreshError} reviewsLoaded={reviews !== null} />}
      </div>
    </main>
  );
}

function EntityInspector({ selected, assets, transfers, selectedTransfer, onSelectTransfer, refreshError, reviewsLoaded }: {
  selected: string; assets: ExampleData["assets"]; transfers: TwinTransfer[]; selectedTransfer?: TwinTransfer;
  onSelectTransfer: (id: string) => void; refreshError: string; reviewsLoaded: boolean;
}) {
  const netAssetValue = sumAssetValues(assets);
  return (
    <aside className="inspector">
      <p className="eyebrow">SELECTED ENTITY</p>
      <h2>{selected}</h2>
      <p className="inspector-sub">Synthetic estate view · Edges are not transfer routes</p>
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
          <ul>{selectedTransfer.review.evaluation.checks.map(check => <li key={check.id}><span>{check.label}</span><em className={`policy-result ${check.result.toLowerCase().replace(" ", "-")}`}>{policyResultLabel(check.result)}</em><small>{check.detail}</small></li>)}</ul>
          {selectedTransfer.audit && <p className="twin-audit">{selectedTransfer.audit.decision === "approve" ? "Approved for processing" : "Rejected"} · {new Date(selectedTransfer.audit.occurredAt).toLocaleString()}<br />Reason: {selectedTransfer.audit.reason || "No reason supplied"}</p>}
        </div>}
        {selectedTransfer?.kind === "sample" && <p className="twin-sample-note">Synthetic sample transaction. No persisted transfer review or policy evaluation is available.</p>}
      </div>
      <button className="button primary inspector-button">Inspect entity <Icon name="arrow" size={14} /></button>
      <p className="entity-id">ENTITY ID · ENT-001-NY</p>
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

function Portfolios({ data }: { data: ExampleData }) {
  const { assets } = data;
  const netAssetValue = sumAssetValues(assets);
  const [active, setActive] = useState("Consolidated");
  return (
    <main className="page">
      <PageHeading eyebrow="PORTFOLIOS / CONSOLIDATED" title="Asset Inventory" description="Position-level visibility across custody, staking, settlement, and treasury accounts." actions={<button className="button secondary">Reconcile</button>} />
      <div className="portfolio-switcher">{["Consolidated", "Cold Storage", "Treasury", "Client Omnibus"].map(x => <button className={active === x ? "active" : ""} onClick={() => setActive(x)} key={x}>{x}</button>)}</div>
      <section className="portfolio-ledger">
        <div className="portfolio-overview">
          <div className="portfolio-summary">
            <div><span>NET ASSET VALUE</span><strong>{compactUsdFormatter.format(netAssetValue)}</strong></div>
            <div><span>24H MOVEMENT</span><strong className="positive">+$116.24M</strong></div>
            <div><span>AVAILABLE LIQUIDITY</span><strong>$1.84B</strong></div>
            <div><span>NETWORKS</span><strong>14</strong></div>
          </div>
          <div className="allocation-donut">
            <div className="donut-visual">
              <svg viewBox="0 0 120 120" role="img" aria-label="Portfolio asset allocation">
                <circle className="donut-track" cx="60" cy="60" r="44" />
                <circle className="donut-segment bitcoin" cx="60" cy="60" r="44" pathLength="100" />
                <circle className="donut-segment ethereum" cx="60" cy="60" r="44" pathLength="100" />
                <circle className="donut-segment solana" cx="60" cy="60" r="44" pathLength="100" />
                <circle className="donut-segment stable" cx="60" cy="60" r="44" pathLength="100" />
                <circle className="donut-segment other" cx="60" cy="60" r="44" pathLength="100" />
              </svg>
              <span><strong>48</strong><small>ASSETS</small></span>
            </div>
            <div className="donut-legend">
              <p className="eyebrow">ALLOCATION</p>
              {assets.map((asset) => <div key={asset.symbol}><i /><span>{asset.symbol}</span><strong>{asset.value}</strong><em>{asset.share}%</em></div>)}
            </div>
          </div>
        </div>
        <div className="ledger-head"><span>ASSET</span><span>BALANCE</span><span>MARKET VALUE</span><span>24H</span><span>ALLOCATION</span></div>
        {assets.map((asset) => (
          <button className="asset-row" key={asset.symbol}>
            <span className="asset-name"><i>{asset.symbol.slice(0, 1)}</i><b>{asset.symbol}<small>{asset.name}</small></b></span>
            <span>{asset.balance}</span><strong>{asset.value}</strong>
            <span className={asset.change.startsWith("-") ? "negative" : "positive"}>{asset.change}</span>
            <span className="allocation"><i><b style={{ width: `${asset.share * 2.1}%` }} /></i>{asset.share}%</span>
          </button>
        ))}
      </section>
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
      <PageHeading eyebrow="TRANSACTIONS / LIVE LEDGER" title="Transaction Monitor" description="Authorization, compliance screening, and settlement state across every asset movement." actions={<button className="button primary" onClick={onNewTransfer}>Initiate transfer</button>} />
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

function PolicyEngine({ data, onDecision }: { data: ExampleData; onDecision: (id: string, status: ExampleTransaction["status"]) => void }) {
  const [selected, setSelected] = useState(0);
  const policies = data.policies;
  const selectedPolicyIndex = Math.min(selected, Math.max(0, policies.length - 1));
  return (
    <main className="page policy-page">
      <PageHeading eyebrow="CONTROL PLANE / POLICY ENGINE" title="Programmable Governance" description="Authorization logic mapped directly to entities, wallets, transaction types, and risk limits." actions={<button className="button primary">Create policy</button>} />
      <div className="policy-workbench">
        <section className="policy-list">
          <div className="policy-list-title"><p className="eyebrow">POLICY LIBRARY</p><span>{policies.length} SAMPLE POLICIES</span></div>
          {policies.map((policy, i) => <button onClick={() => setSelected(i)} className={selectedPolicyIndex === i ? "active" : ""} key={policy.name}><span><strong>{policy.name}</strong><small>{policy.scope}</small></span><em>{policy.state}</em></button>)}
        </section>
        <section className="policy-canvas">
          {policies.length > 0 && <><div className="policy-canvas-head"><div><p className="eyebrow">POLICY / POL-00{selectedPolicyIndex + 1}</p><h2>{policies[selectedPolicyIndex].name}</h2></div><span className={policies[selectedPolicyIndex].state === "Review" ? "review" : ""}>● {policies[selectedPolicyIndex].state}</span></div>
          <div className="logic-flow">
            <div className="logic-node"><span>WHEN</span><strong>Transaction initiated</strong><small>{policies[selectedPolicyIndex].scope}</small></div><i />
            <div className="logic-node"><span>CHECK</span><strong>Risk & compliance</strong><small>Sanctions · velocity · allowlist</small></div><i />
            <div className="logic-node featured"><span>REQUIRE</span><strong>{policies[selectedPolicyIndex].rule.split(" · ")[0]}</strong><small>Approved institutional signers</small></div><i />
            <div className="logic-node"><span>ENFORCE</span><strong>{policies[selectedPolicyIndex].rule.split(" · ")[1] || "Verified route"}</strong><small>Block on policy exception</small></div>
          </div>
          <div className="policy-metrics"><div><span>SAMPLE EXECUTIONS / 30D</span><strong>2,481</strong></div><div><span>SAMPLE BLOCKED</span><strong>14</strong></div><div><span>SAMPLE AVG. DECISION</span><strong>184ms</strong></div><div><span>SAMPLE COVERAGE</span><strong>{policies[selectedPolicyIndex].coverage}%</strong></div></div></>}
        </section>
      </div>
      <PolicyReview onDecision={onDecision} />
    </main>
  );
}

function Reporting() {
  return (
    <main className="page reporting-page">
      <PageHeading eyebrow="REPORTING / SAMPLE SCHEDULE" title="Evidence & Reporting" description="Sample reporting dates and evidence queue. Connect an imported workspace to show its actual obligations and evidence status." actions={<button className="button primary">Generate report</button>} />
      <div className="report-layout">
        <section className="report-calendar">
          <div className="report-month"><button>←</button><h2>October 2026 · Sample</h2><button>→</button></div>
          <div className="weekdays">{["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => <span key={d}>{d}</span>)}</div>
          <div className="days">{Array.from({ length: 35 }, (_, i) => {
            const firstDayOffset = (new Date(Date.UTC(2026, 9, 1)).getUTCDay() + 6) % 7;
            const day = i - firstDayOffset + 1;
            const displayDay = day < 1 ? 30 + day : day > 31 ? day - 31 : day;
            return <div className={`${day === 10 ? "today" : ""} ${day < 1 || day > 31 ? "muted" : ""}`} key={i}><span>{displayDay}</span>{day === 3 && <b>Reserve attestation</b>}{day === 10 && <b>SOC evidence pack</b>}{day === 17 && <b>NYDFS filing</b>}{day === 28 && <b>Client statements</b>}</div>;
          })}</div>
        </section>
        <aside className="report-queue">
          <p className="eyebrow">SAMPLE OBLIGATION QUEUE</p>
          {[["SOC 2 evidence pack","10 Oct 2026 · 18:00 UTC","94%"],["NYDFS custody filing","17 Oct 2026","71%"],["Q3 client statements","28 Oct 2026","42%"],["Proof of reserves","01 Nov 2026","18%"]].map((r, i) => <div className="report-item" key={r[0]}><span>0{i + 1}</span><div><strong>{r[0]}</strong><small>{r[1]}</small><i><b style={{ width: r[2] }} /></i></div><em>{r[2]}</em></div>)}
          <div className="assurance-seal"><Icon name="check" size={22} /><span><strong>Demo evidence queue</strong><small>No connected evidence source</small></span></div>
        </aside>
      </div>
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
  const [page, setPage] = useState<Page>("Overview");
  const [commandOpen, setCommandOpen] = useState(false);
  const [financialData, setFinancialData] = useState<ExampleData>(exampleData);
  const [financialDataLoaded, setFinancialDataLoaded] = useState(false);
  const [financialDataError, setFinancialDataError] = useState("");
  const [reviews, setReviews] = useState<TransferReviews | null>(null);
  const [twinRefreshError, setTwinRefreshError] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const refreshSequence = useRef(0);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferNotice, setTransferNotice] = useState("");
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

  const refresh = useCallback(async (withReviews: boolean, force = false) => {
    if (refreshController.current && !force) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const sequence = ++refreshSequence.current;
    try {
      const [financialResponse, reviewsResponse] = await Promise.all([
        fetch(`/api/users/${encodeURIComponent(DEMO_USER_ID)}/financial-data`, { signal: controller.signal, cache: "no-store" }),
        withReviews ? fetch("/api/transfer/reviews", { signal: controller.signal, cache: "no-store" }) : Promise.resolve(null),
      ]);
      const body = await financialResponse.json() as FinancialDataResponse;
      if (!financialResponse.ok || !body.ok) throw new Error(body.ok ? `Financial data request failed with status ${financialResponse.status}.` : body.error.message);
      if (body.data.userId !== DEMO_USER_ID || !Array.isArray(body.data.assets) || !Array.isArray(body.data.transactions)
        || !Array.isArray(body.data.policies) || !Array.isArray(body.data.nodes) || !Array.isArray(body.data.edges)) {
        throw new Error("Financial data endpoint returned an invalid response.");
      }
      let nextReviews: TransferReviews | null = null;
      if (reviewsResponse) {
        const reviewBody = await reviewsResponse.json() as ReviewsResponse;
        if (!reviewsResponse.ok || !reviewBody.ok) throw new Error(reviewBody.ok ? "Unable to load transfer reviews." : reviewBody.error.message);
        if (!Array.isArray(reviewBody.data.transfers) || !Array.isArray(reviewBody.data.audit)) throw new Error("Review endpoint returned an invalid response.");
        nextReviews = reviewBody.data;
      }
      if (controller.signal.aborted || sequence !== refreshSequence.current) return;
      setFinancialData({ assets: body.data.assets, transactions: body.data.transactions, policies: body.data.policies,
        nodes: body.data.nodes, edges: body.data.edges });
      if (nextReviews) setReviews(nextReviews);
      setFinancialDataLoaded(true);
      setFinancialDataError("");
      if (withReviews) setTwinRefreshError("");
    } catch (error) {
      if (controller.signal.aborted || sequence !== refreshSequence.current) return;
      console.error("Unable to refresh demo financial data.", error);
      if (withReviews) setTwinRefreshError("Unable to refresh requests. Showing last loaded data.");
      else setFinancialDataError("Unable to load the demo inventory. Transfer requests are unavailable until data loads.");
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh(false, true);
    return () => refreshController.current?.abort();
  }, [refresh]);

  useEffect(() => {
    if (page !== "Digital Twin") return;
    void refresh(true, true);
    const onFocus = () => { void refresh(true); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 15_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); refreshController.current?.abort(); };
  }, [page, refresh]);

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
    "Portfolios": <Portfolios data={financialData} />,
    "Transactions": <Transactions data={financialData} onNewTransfer={openTransfer} notice={transferNotice} />,
    "Policy Engine": <PolicyEngine data={financialData} onDecision={onPolicyDecision} />,
    "Reporting": <Reporting />,
  };
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
