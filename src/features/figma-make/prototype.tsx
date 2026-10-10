"use client";

// Figma Make prototype data below is demo/sample data and is not connected to CustodyOS APIs.
import { useMemo, useState } from "react";

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

const assets = [
  { symbol: "BTC", name: "Bitcoin", balance: "42,318.82", value: "$2.87B", change: "+1.82%", share: 34.1 },
  { symbol: "ETH", name: "Ethereum", balance: "656,104.18", value: "$2.29B", change: "+0.94%", share: 27.2 },
  { symbol: "SOL", name: "Solana", balance: "8,440,921.02", value: "$1.23B", change: "-0.38%", share: 14.6 },
  { symbol: "USDC", name: "USD Coin", balance: "998,420,104.00", value: "$998.4M", change: "0.00%", share: 11.9 },
  { symbol: "OTHER", name: "46 assets", balance: "Multi-chain", value: "$1.03B", change: "+0.21%", share: 12.2 },
];

const transactions = [
  { id: "TX-7E29A1", time: "16:38:12", type: "Withdrawal", asset: "BTC", amount: "128.42 BTC", value: "$8.71M", route: "Vault 01 → Coinbase Prime", status: "Pending approval" },
  { id: "TX-9B14C8", time: "16:26:49", type: "Settlement", asset: "USDC", amount: "24,800,000 USDC", value: "$24.80M", route: "Omnibus → Client 1842", status: "Completed" },
  { id: "TX-3A82F4", time: "15:51:03", type: "Deposit", asset: "ETH", amount: "4,806.15 ETH", value: "$16.76M", route: "Fireblocks → Vault 03", status: "Completed" },
  { id: "TX-6D21E7", time: "14:17:55", type: "Rebalance", asset: "SOL", amount: "680,000 SOL", value: "$99.28M", route: "Warm 02 → Cold 01", status: "Screening" },
  { id: "TX-1F77B2", time: "12:40:31", type: "Withdrawal", asset: "ETH", amount: "820.00 ETH", value: "$2.86M", route: "Vault 03 → Client 0917", status: "Completed" },
];

const policies = [
  { name: "Institutional Withdrawal", scope: "All cold-storage vaults", rule: "4 of 6 signers · 12h velocity", state: "Enforced", coverage: 100 },
  { name: "Treasury Rebalancing", scope: "Treasury wallets", rule: "3 of 5 signers · $250M limit", state: "Enforced", coverage: 100 },
  { name: "Counterparty Allowlist", scope: "External transfers", rule: "Verified addresses only", state: "Review", coverage: 92 },
  { name: "Travel Rule Compliance", scope: "Transfers above $3,000", rule: "Notabene screening", state: "Enforced", coverage: 98 },
];

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

function DigitalTwin() {
  const [selected, setSelected] = useState("ACME BANK");
  const [dragging, setDragging] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 960, height: 550 });
  const [nodes, setNodes] = useState([
    { id: "ACME BANK", x: 480, y: 280, r: 58, sub: "$8.42B AUC", type: "master" },
    { id: "BTC VAULT", x: 230, y: 145, r: 34, sub: "$3.86B", type: "asset" },
    { id: "ETH VAULT", x: 210, y: 430, r: 32, sub: "$2.17B", type: "asset" },
    { id: "FIREBLOCKS", x: 735, y: 105, r: 36, sub: "MPC NETWORK", type: "network" },
    { id: "POLICY 01", x: 765, y: 405, r: 35, sub: "4 OF 6", type: "policy" },
    { id: "SETTLEMENT", x: 880, y: 270, r: 30, sub: "OMNIBUS", type: "network" },
    { id: "SIGNER 04", x: 625, y: 180, r: 24, sub: "MPC SIGNER", type: "policy" },
    { id: "RISK LIMIT", x: 615, y: 385, r: 24, sub: "$250M / DAY", type: "policy" },
  ]);
  const edges = [
    ["ACME BANK", "BTC VAULT"],
    ["ACME BANK", "ETH VAULT"],
    ["ACME BANK", "FIREBLOCKS"],
    ["ACME BANK", "POLICY 01"],
    ["ACME BANK", "SETTLEMENT"],
    ["ACME BANK", "SIGNER 04"],
    ["ACME BANK", "RISK LIMIT"],
    ["FIREBLOCKS", "SETTLEMENT"],
    ["POLICY 01", "RISK LIMIT"],
  ];
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));

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
        eyebrow="DIGITAL TWIN / LIVE ESTATE"
        title="Institutional Asset Topology"
        description="A real-time model of entities, wallets, controls, networks, and settlement exposure."
        actions={<><button className="button secondary">Export view</button><button className="button primary">Open console</button></>}
      />
      <div className="twin-layout">
        <section className="graph-shell">
          <div className="graph-meta"><span>LIVE GRAPH</span><b>● 8 VISIBLE NODES</b><span>9 EDGES</span><span>UPDATED 2S AGO</span></div>
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
                <text className={n.type === "master" ? "node-value" : "node-sub"} y={n.type === "master" ? 27 : 15}>{n.sub}</text>
              </g>
            ))}
          </svg>
          <div className="graph-controls">CLICK TO SELECT <span>·</span> DRAG NODES <span>·</span> SCROLL TO ZOOM</div>
          <button className="zoom-reset" onClick={resetZoom} aria-label="Reset graph zoom">{zoomPercent}% <span>RESET</span></button>
        </section>
        <EntityInspector selected={selected} />
      </div>
    </main>
  );
}

function EntityInspector({ selected }: { selected: string }) {
  return (
    <aside className="inspector">
      <p className="eyebrow">SELECTED ENTITY</p>
      <h2>{selected}</h2>
      <p className="inspector-sub">Institutional master entity · New York</p>
      <div className="inspector-value"><span>ASSETS UNDER CUSTODY</span><strong>$8.42B</strong></div>
      <div className="split-stats"><div><span>CONNECTED WALLETS</span><strong>18</strong></div><div><span>ACTIVE POLICIES</span><strong>12</strong></div></div>
      <div className="coverage">
        <p className="eyebrow">CONTROL COVERAGE</p><div className="meter"><i /></div>
        <div><span>95.2% verified</span><small>2 exceptions</small></div>
      </div>
      <div className="events">
        <p className="eyebrow">RECENT GRAPH EVENTS</p>
        <div><span>Policy quorum satisfied</span><time>12:42:08</time></div>
        <div><span>Wallet 0x8F…A2 reconciled</span><time>12:41:51</time></div>
        <div><span>BTC reserve attested</span><time>12:39:17</time></div>
      </div>
      <button className="button primary inspector-button">Inspect entity <Icon name="arrow" size={14} /></button>
      <p className="entity-id">ENTITY ID · ENT-001-NY</p>
    </aside>
  );
}

function Overview() {
  const bars = [38, 48, 45, 58, 56, 63, 72, 68, 78, 74, 82, 88, 84, 93, 90, 98, 94, 104, 112, 108, 118, 124, 121, 132];
  return (
    <main className="page">
      <PageHeading eyebrow="COMMAND CENTER / 10 OCT 2025" title="Operational Overview" description="Estate health, treasury posture, and high-priority actions across the global custody network." actions={<button className="button primary">New transfer</button>} />
      <div className="overview-grid">
        <section className="exposure-panel">
          <div className="panel-top"><p className="eyebrow">ASSETS UNDER CUSTODY</p><span className="positive">+2.4% MTD</span></div>
          <div className="hero-number">$8.42<span>B</span></div>
          <div className="chart">
            {bars.map((height, i) => <i key={i} style={{ height }} className={i > 19 ? "current" : ""} />)}
          </div>
          <div className="chart-axis"><span>09 SEP</span><span>18 SEP</span><span>27 SEP</span><span>10 OCT</span></div>
        </section>
        <section className="action-ledger">
          <div className="panel-top"><p className="eyebrow">REQUIRES ATTENTION</p><span>04 OPEN</span></div>
          {[
            ["01", "Withdrawal approval", "$8.71M BTC transfer requires 2 signatures", "08:42"],
            ["02", "Control exception", "Counterparty allowlist coverage below threshold", "1h"],
            ["03", "Reconciliation break", "SOL sub-ledger mismatch · 0.0038%", "3h"],
            ["04", "Attestation due", "ETH reserve proof expires tomorrow", "1d"],
          ].map((row) => <button className="action-row" key={row[0]}><b>{row[0]}</b><span><strong>{row[1]}</strong><small>{row[2]}</small></span><time>{row[3]}</time><Icon name="arrow" size={14} /></button>)}
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

function Portfolios() {
  const [active, setActive] = useState("Consolidated");
  return (
    <main className="page">
      <PageHeading eyebrow="PORTFOLIOS / CONSOLIDATED" title="Asset Inventory" description="Position-level visibility across custody, staking, settlement, and treasury accounts." actions={<button className="button secondary">Reconcile</button>} />
      <div className="portfolio-switcher">{["Consolidated", "Cold Storage", "Treasury", "Client Omnibus"].map(x => <button className={active === x ? "active" : ""} onClick={() => setActive(x)} key={x}>{x}</button>)}</div>
      <section className="portfolio-ledger">
        <div className="portfolio-overview">
          <div className="portfolio-summary">
            <div><span>NET ASSET VALUE</span><strong>$8,419,628,401</strong></div>
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

function Transactions() {
  const [filter, setFilter] = useState("All activity");
  const displayed = useMemo(() => filter === "All activity" ? transactions : transactions.filter(t => t.status === filter), [filter]);
  return (
    <main className="page transactions-page">
      <PageHeading eyebrow="TRANSACTIONS / LIVE LEDGER" title="Transaction Monitor" description="Authorization, compliance screening, and settlement state across every asset movement." actions={<button className="button primary">Initiate transfer</button>} />
      <div className="transaction-toolbar">
        <div>{["All activity", "Pending approval", "Screening", "Completed"].map(x => <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{x}</button>)}</div>
        <button className="filter-control">Last 24 hours ⌄</button>
      </div>
      <section className="transaction-ledger">
        <div className="tx-head"><span>TIME / ID</span><span>TYPE</span><span>ASSET / AMOUNT</span><span>ROUTE</span><span>VALUE</span><span>STATUS</span></div>
        {displayed.map(tx => <button className="tx-row" key={tx.id}>
          <span><time>{tx.time}</time><small>{tx.id}</small></span><span>{tx.type}</span><span><b>{tx.asset}</b> {tx.amount}</span><span>{tx.route}</span><strong>{tx.value}</strong><span className={`tx-status ${tx.status.toLowerCase().replace(" ", "-")}`}>{tx.status}</span>
        </button>)}
      </section>
      <section className="transaction-volume">
        <div className="volume-heading">
          <div><p className="eyebrow">24H TRANSACTION VOLUME</p><strong>$428.6M</strong><span>1,284 settled movements</span></div>
          <div><span>FINALITY RATE</span><strong>99.998%</strong><small>Median 3.2 sec</small></div>
        </div>
        <div className="volume-chart" aria-label="Transaction volume by asset">
          {[
            { asset: "BTC", value: "$148.2M", height: 86 },
            { asset: "ETH", value: "$112.7M", height: 66 },
            { asset: "USDC", value: "$91.4M", height: 53 },
            { asset: "SOL", value: "$48.8M", height: 29 },
            { asset: "OTHER", value: "$27.5M", height: 16 },
          ].map((item) => (
            <div className="volume-column" key={item.asset}>
              <span>{item.value}</span>
              <div><i style={{ height: `${item.height}%` }} /></div>
              <strong>{item.asset}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function PolicyEngine() {
  const [selected, setSelected] = useState(0);
  return (
    <main className="page policy-page">
      <PageHeading eyebrow="CONTROL PLANE / POLICY ENGINE" title="Programmable Governance" description="Authorization logic mapped directly to entities, wallets, transaction types, and risk limits." actions={<button className="button primary">Create policy</button>} />
      <div className="policy-workbench">
        <section className="policy-list">
          <div className="policy-list-title"><p className="eyebrow">POLICY LIBRARY</p><span>4 SAMPLE POLICIES</span></div>
          {policies.map((policy, i) => <button onClick={() => setSelected(i)} className={selected === i ? "active" : ""} key={policy.name}><span><strong>{policy.name}</strong><small>{policy.scope}</small></span><em>{policy.state}</em></button>)}
        </section>
        <section className="policy-canvas">
          <div className="policy-canvas-head"><div><p className="eyebrow">POLICY / POL-00{selected + 1}</p><h2>{policies[selected].name}</h2></div><span className={policies[selected].state === "Review" ? "review" : ""}>● {policies[selected].state}</span></div>
          <div className="logic-flow">
            <div className="logic-node"><span>WHEN</span><strong>Transaction initiated</strong><small>{policies[selected].scope}</small></div><i />
            <div className="logic-node"><span>CHECK</span><strong>Risk & compliance</strong><small>Sanctions · velocity · allowlist</small></div><i />
            <div className="logic-node featured"><span>REQUIRE</span><strong>{policies[selected].rule.split(" · ")[0]}</strong><small>Approved institutional signers</small></div><i />
            <div className="logic-node"><span>ENFORCE</span><strong>{policies[selected].rule.split(" · ")[1] || "Verified route"}</strong><small>Block on policy exception</small></div>
          </div>
          <div className="policy-metrics"><div><span>SAMPLE EXECUTIONS / 30D</span><strong>2,481</strong></div><div><span>SAMPLE BLOCKED</span><strong>14</strong></div><div><span>SAMPLE AVG. DECISION</span><strong>184ms</strong></div><div><span>SAMPLE COVERAGE</span><strong>{policies[selected].coverage}%</strong></div></div>
        </section>
      </div>
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
  return (
    <div className="command-overlay" onMouseDown={close}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-input"><Icon name="search" /><input autoFocus placeholder="Search entities, wallets, transactions, or commands…" /></div>
        <p className="eyebrow">NAVIGATE</p>
        {navigation.map(n => <button key={n.label} onClick={() => { setPage(n.label); close(); }}><Icon name={n.icon} /><span>{n.label}</span><kbd>↵</kbd></button>)}
        <div className="command-foot"><span>↑↓ Navigate</span><span>↵ Open</span><span>esc Close</span></div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [commandOpen, setCommandOpen] = useState(false);
  const pages: Record<Page, React.ReactNode> = {
    "Overview": <Overview />,
    "Digital Twin": <DigitalTwin />,
    "Portfolios": <Portfolios />,
    "Transactions": <Transactions />,
    "Policy Engine": <PolicyEngine />,
    "Reporting": <Reporting />,
  };
  return (
    <div className="app-shell make-prototype" data-data-source="figma-demo-sample">
      <Rail page={page} setPage={setPage} />
      <Header page={page} setPage={setPage} openCommand={() => setCommandOpen(true)} />
      {pages[page]}
      <footer className="statusbar"><span>NETWORK <b>MAINNET</b></span><span>LAST FINALITY <b>3.2 SEC</b></span><span>POLICY ENGINE <b className="positive">OPERATIONAL</b></span><time>UTC 16:42:09</time></footer>
      {commandOpen && <CommandPalette close={() => setCommandOpen(false)} setPage={setPage} />}
    </div>
  );
}
