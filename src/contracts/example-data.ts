export interface ExampleAsset {
  symbol: string;
  name: string;
  balance: string;
  value: string;
  change: string;
  share: number;
}

export interface ExampleTransaction {
  id: string;
  time: string;
  type: string;
  asset: string;
  amount: string;
  value: string;
  route: string;
  status: string;
}

export interface ExamplePolicy {
  name: string;
  scope: string;
  rule: string;
  state: string;
  coverage: number;
}

export interface ExampleTwinNode {
  id: string;
  x: number;
  y: number;
  r: number;
  sub: string;
  type: string;
}

export type ExampleTwinEdge = [source: string, target: string];

export interface ExampleData {
  assets: ExampleAsset[];
  transactions: ExampleTransaction[];
  policies: ExamplePolicy[];
  nodes: ExampleTwinNode[];
  edges: ExampleTwinEdge[];
}

export const exampleData: ExampleData = {
  assets: [
    { symbol: "BTC", name: "Bitcoin", balance: "42,318.82", value: "$2.87B", change: "+1.82%", share: 34.1 },
    { symbol: "ETH", name: "Ethereum", balance: "656,104.18", value: "$2.29B", change: "+0.94%", share: 27.2 },
    { symbol: "SOL", name: "Solana", balance: "8,440,921.02", value: "$1.23B", change: "-0.38%", share: 14.6 },
    { symbol: "USDC", name: "USD Coin", balance: "998,420,104.00", value: "$998.4M", change: "0.00%", share: 11.9 },
    { symbol: "OTHER", name: "46 assets", balance: "Multi-chain", value: "$1.03B", change: "+0.21%", share: 12.2 },
  ],
  transactions: [
    { id: "TX-7E29A1", time: "16:38:12", type: "Withdrawal", asset: "BTC", amount: "128.42 BTC", value: "$8.71M", route: "Vault 01 → Coinbase Prime", status: "Pending approval" },
    { id: "TX-9B14C8", time: "16:26:49", type: "Settlement", asset: "USDC", amount: "24,800,000 USDC", value: "$24.80M", route: "Omnibus → Client 1842", status: "Completed" },
    { id: "TX-3A82F4", time: "15:51:03", type: "Deposit", asset: "ETH", amount: "4,806.15 ETH", value: "$16.76M", route: "Fireblocks → Vault 03", status: "Completed" },
    { id: "TX-6D21E7", time: "14:17:55", type: "Rebalance", asset: "SOL", amount: "680,000 SOL", value: "$99.28M", route: "Warm 02 → Cold 01", status: "Screening" },
    { id: "TX-1F77B2", time: "12:40:31", type: "Withdrawal", asset: "ETH", amount: "820.00 ETH", value: "$2.86M", route: "Vault 03 → Client 0917", status: "Completed" },
  ],
  policies: [
    { name: "Institutional Withdrawal", scope: "All cold-storage vaults", rule: "4 of 6 signers · 12h velocity", state: "Enforced", coverage: 100 },
    { name: "Treasury Rebalancing", scope: "Treasury wallets", rule: "3 of 5 signers · $250M limit", state: "Enforced", coverage: 100 },
    { name: "Counterparty Allowlist", scope: "External transfers", rule: "Verified addresses only", state: "Review", coverage: 92 },
    { name: "Travel Rule Compliance", scope: "Transfers above $3,000", rule: "Notabene screening", state: "Enforced", coverage: 98 },
  ],
  nodes: [
    { id: "ACME BANK", x: 480, y: 280, r: 58, sub: "$8.42B AUC", type: "master" },
    { id: "BTC VAULT", x: 230, y: 145, r: 34, sub: "$3.86B", type: "asset" },
    { id: "ETH VAULT", x: 210, y: 430, r: 32, sub: "$2.17B", type: "asset" },
    { id: "FIREBLOCKS", x: 735, y: 105, r: 36, sub: "MPC NETWORK", type: "network" },
    { id: "POLICY 01", x: 765, y: 405, r: 35, sub: "4 OF 6", type: "policy" },
    { id: "SETTLEMENT", x: 880, y: 270, r: 30, sub: "OMNIBUS", type: "network" },
    { id: "SIGNER 04", x: 625, y: 180, r: 24, sub: "MPC SIGNER", type: "policy" },
    { id: "RISK LIMIT", x: 615, y: 385, r: 24, sub: "$250M / DAY", type: "policy" },
  ],
  edges: [
    ["ACME BANK", "BTC VAULT"],
    ["ACME BANK", "ETH VAULT"],
    ["ACME BANK", "FIREBLOCKS"],
    ["ACME BANK", "POLICY 01"],
    ["ACME BANK", "SETTLEMENT"],
    ["ACME BANK", "SIGNER 04"],
    ["ACME BANK", "RISK LIMIT"],
    ["FIREBLOCKS", "SETTLEMENT"],
    ["POLICY 01", "RISK LIMIT"],
  ],
};
