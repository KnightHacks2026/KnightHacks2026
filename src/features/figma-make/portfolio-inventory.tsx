"use client";

import { useState } from "react";
import type { Account, ExampleAsset, FinancialSnapshot, Instrument } from "@/contracts";

export type InventoryView = "Consolidated" | "Cold Storage" | "Treasury" | "Client Omnibus";
export const inventoryViews: InventoryView[] = ["Consolidated", "Cold Storage", "Treasury", "Client Omnibus"];

export interface PortfolioDataset {
  dataset: { id: string; name: string };
  accounts: Account[];
  instruments: Instrument[];
  snapshot: FinancialSnapshot;
}

const segmentColors = ["bitcoin", "ethereum", "solana", "stable", "other"];

export function AllocationDonut({ assets }: { assets: ExampleAsset[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const selected = assets.find(asset => asset.symbol === (hovered ?? pinned));
  const totalShare = assets.reduce((sum, asset) => sum + asset.share, 0);
  const valid = assets.length > 0 && assets.every(asset => Number.isFinite(asset.share) && asset.share >= 0 && asset.share <= 100)
    && Math.abs(totalShare - 100) <= .2;
  let offset = 0;
  return <div className="allocation-donut">
    <div className="donut-visual">
      <svg viewBox="0 0 120 120" role="group" aria-label="Portfolio asset allocation">
        <circle className="donut-track" cx="60" cy="60" r="44" />
        {valid && assets.map((asset, index) => {
          const dashOffset = offset;
          offset += asset.share;
          return <circle key={asset.symbol} className={`donut-segment ${segmentColors[index % segmentColors.length]}`}
            cx="60" cy="60" r="44" pathLength="100" role="button" tabIndex={0}
            aria-label={`${asset.name} (${asset.symbol}) allocation`}
            aria-pressed={pinned === asset.symbol}
            style={{ strokeDasharray: `${asset.share} ${100 - asset.share}`, strokeDashoffset: -dashOffset }}
            onPointerEnter={() => setHovered(asset.symbol)} onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(asset.symbol)} onBlur={() => setHovered(null)}
            onClick={() => setPinned(current => current === asset.symbol ? null : asset.symbol)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPinned(current => current === asset.symbol ? null : asset.symbol); } }} />;
        })}
      </svg>
      <span><strong>{assets.length}</strong><small>GROUPS</small></span>
    </div>
    <div className="donut-legend">
      <p className="eyebrow">ALLOCATION</p>
      {valid ? assets.map(asset => <div key={asset.symbol} className={selected?.symbol === asset.symbol ? "is-selected" : ""}><i /><span>{asset.symbol}</span><strong>{asset.value}</strong><em>{asset.share}%</em></div>)
        : <p className="allocation-unavailable">No complete allocation percentages are available for these assets.</p>}
      {selected && <div className="allocation-detail" role="status" aria-live="polite"><strong>{selected.name} · {selected.symbol}</strong><span>{selected.share}% allocation · {selected.value} USD value</span><span>{selected.symbol === "OTHER" ? "Units: not available for aggregate group" : `${selected.balance} ${selected.symbol} held`}</span></div>}
    </div>
  </div>;
}

function exactUnits(value: string, scale: number): string {
  const amount = BigInt(value);
  const divisor = 10n ** BigInt(scale);
  const whole = amount / divisor;
  const fraction = scale ? (amount % divisor).toString().padStart(scale, "0").replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function CategorizedInventory({ view, datasets }: { view: Exclude<InventoryView, "Consolidated">; datasets: PortfolioDataset[] }) {
  if (view !== "Client Omnibus") {
    return <InventoryEmpty
      view={view}
      eyebrow="NO VERIFIED CLASSIFICATION"
      title={`No verified ${view.toLowerCase()} inventory`}
      description="The loaded asset summary has no custody-location or treasury ownership field. Imported account kinds identify cash, securities, or omnibus accounts, but do not establish this classification."
      source="Source coverage: custody location and treasury ownership are unavailable."
    />;
  }
  const accounts = datasets.flatMap(source => source.accounts.filter(account => account.kind === "omnibus")
    .map(account => ({ source, account,
      cash: source.snapshot.cashBalances.filter(balance => balance.accountId === account.id),
      securities: source.snapshot.securitiesBalances.filter(balance => balance.accountId === account.id),
    })));
  if (!accounts.length) return <InventoryEmpty
    view={view}
    eyebrow="NO IMPORTED OMNIBUS ACCOUNTS"
    title="No omnibus account inventory"
    description="No imported account is classified as omnibus. This view displays settled balances when an imported financial dataset contains an omnibus account; consolidated sample assets have no verified account association."
    source={`Imported datasets checked: ${datasets.length}.`}
  />;
  return <section className="portfolio-category" aria-label="Client omnibus account inventory">
    <div className="portfolio-category__metrics"><div><span>OMNIBUS ACCOUNTS</span><strong>{accounts.length}</strong></div><div><span>DATASETS</span><strong>{new Set(accounts.map(item => item.source.dataset.id)).size}</strong></div><div><span>BALANCE ENTRIES</span><strong>{accounts.reduce((count, item) => count + item.cash.length + item.securities.length, 0)}</strong></div><div><span>USD ALLOCATION</span><strong>Unavailable</strong></div></div>
    <p className="portfolio-category__note">Imported snapshot balances are shown in exact units. No market prices or account-to-sample-asset mapping are available, so a USD allocation chart is not shown.</p>
    <div className="portfolio-category__head"><span>ACCOUNT / DATASET</span><span>CLASSIFICATION</span><span>SETTLED BALANCES</span></div>
    {accounts.map(({ source, account, cash, securities }) => <div className="portfolio-category__row" key={`${source.dataset.id}:${account.id}`}>
      <div><strong>{account.name}</strong><small>{account.id} · {source.dataset.name}</small></div><span>{account.kind} · {account.status}</span><div>{cash.map(balance => <p key={`${balance.accountId}:${balance.currency}`}>{balance.currency} {balance.currency === "USD" ? exactUnits(balance.settledMinorUnits, 2) : `${balance.settledMinorUnits} minor units`} settled<small>{balance.reservedMinorUnits} minor units reserved</small></p>)}{securities.map(balance => {
        const instrument = source.instruments.find(item => item.id === balance.instrumentId);
        return <p key={`${balance.accountId}:${balance.instrumentId}`}>{instrument ? exactUnits(balance.settledUnits, instrument.quantityScale) : balance.settledUnits} {instrument?.symbol ?? balance.instrumentId} settled<small>{balance.reservedUnits} base units reserved</small></p>;
      })}{!cash.length && !securities.length && <p>No balances in this snapshot.</p>}</div>
    </div>)}
  </section>;
}

export function ConsolidatedInventory({ datasets }: { datasets: PortfolioDataset[] }) {
  const source = [...datasets].sort((left, right) => Date.parse(right.snapshot.asOf) - Date.parse(left.snapshot.asOf))[0];
  if (!source) return <div className="portfolio-empty" role="status"><h2>No imported custody snapshot</h2><p>Import a financial dataset to see verified account balances and settlement obligations. Market value and assets under custody require pricing data that is not present in the current snapshot contract.</p></div>;

  const { snapshot, accounts, instruments } = source;
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const usdMinor = snapshot.cashBalances.filter(balance => balance.currency === "USD")
    .reduce((sum, balance) => sum + BigInt(balance.settledMinorUnits), 0n);
  const openObligations = snapshot.obligations.filter(item => item.status !== "settled" && item.status !== "cancelled");
  const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const balanceRows = [
    ...snapshot.cashBalances.map(balance => ({
      id: `cash:${balance.accountId}:${balance.currency}`,
      account: accountNames.get(balance.accountId) ?? balance.accountId,
      type: `Cash · ${balance.currency}`,
      settled: balance.currency === "USD"
        ? `${exactUnits(balance.settledMinorUnits, 2)} USD`
        : `${balance.settledMinorUnits} ${balance.currency} minor units`,
      reserved: balance.currency === "USD"
        ? `${exactUnits(balance.reservedMinorUnits, 2)} USD`
        : `${balance.reservedMinorUnits} minor units`,
    })),
    ...snapshot.securitiesBalances.map(balance => {
      const instrument = instruments.find(item => item.id === balance.instrumentId);
      return {
        id: `security:${balance.accountId}:${balance.instrumentId}`,
        account: accountNames.get(balance.accountId) ?? balance.accountId,
        type: `Security · ${instrument?.symbol ?? balance.instrumentId}`,
        settled: `${exactUnits(balance.settledUnits, instrument?.quantityScale ?? 0)} ${instrument?.symbol ?? "units"}`,
        reserved: `${exactUnits(balance.reservedUnits, instrument?.quantityScale ?? 0)} ${instrument?.symbol ?? "units"}`,
      };
    }),
  ];

  return <section className="portfolio-category" aria-label="Consolidated imported custody inventory">
    <div className="portfolio-category__metrics">
      <div><span>USD SETTLED CASH</span><strong>{usdFormatter.format(usdMinor / 100n)}</strong></div>
      <div><span>ACCOUNTS</span><strong>{accounts.length}</strong></div>
      <div><span>OPEN OBLIGATIONS</span><strong>{openObligations.length}</strong></div>
      <div><span>SNAPSHOT AS OF</span><strong>{new Date(snapshot.asOf).toLocaleString()}</strong></div>
    </div>
    <p className="portfolio-category__note">{source.dataset.name} · {balanceRows.length} imported balance entries. Market value is unavailable because this snapshot has no instrument prices.</p>
    <div className="portfolio-category__head"><span>ACCOUNT / DATASET</span><span>BALANCE TYPE</span><span>SETTLED / RESERVED</span></div>
    {balanceRows.map(row => <div className="portfolio-category__row" key={row.id}>
      <div><strong>{row.account}</strong><small>{source.dataset.name} · {snapshot.id}</small></div>
      <span>{row.type}</span>
      <div><p>{row.settled} settled<small>{row.reserved} reserved</small></p></div>
    </div>)}
    {!balanceRows.length && <p className="portfolio-category__note">This imported snapshot contains no cash or securities balance entries.</p>}
  </section>;
}

function InventoryEmpty({ view, eyebrow, title, description, source }: {
  view: Exclude<InventoryView, "Consolidated">;
  eyebrow: string;
  title: string;
  description: string;
  source: string;
}) {
  return <section className="portfolio-empty" role="status" aria-label={`${view} inventory status`}>
    <div className="portfolio-empty__mark" aria-hidden="true"><span /><span /><span /></div>
    <div className="portfolio-empty__content">
      <p className="eyebrow">{view.toUpperCase()} / {eyebrow}</p>
      <h2>{title}</h2>
      <p className="portfolio-empty__description">{description}</p>
      <p className="portfolio-empty__source">{source}</p>
    </div>
  </section>;
}
