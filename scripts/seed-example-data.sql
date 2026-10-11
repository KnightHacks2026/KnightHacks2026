-- Seed the CustodyOS prototype example records for the local demo user.
-- Safe to rerun: existing rows are left unchanged by INSERT OR IGNORE.
-- Demo login: username demo-user, password demo-password, TOTP secret JBSWY3DPEHPK3PXP.

.bail on
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS custody_authenticate (
  user_id TEXT NOT NULL PRIMARY KEY,
  password TEXT NOT NULL,
  otp_secret TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS example_data_initialized (
  user_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS example_assets (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  balance TEXT NOT NULL,
  value TEXT NOT NULL,
  change TEXT NOT NULL,
  share REAL NOT NULL,
  PRIMARY KEY(user_id, symbol),
  UNIQUE(user_id, position)
);

CREATE TABLE IF NOT EXISTS example_transactions (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  id TEXT NOT NULL,
  time TEXT NOT NULL,
  type TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  value TEXT NOT NULL,
  route TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(user_id, id),
  UNIQUE(user_id, position)
);

CREATE TABLE IF NOT EXISTS example_policies (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  rule TEXT NOT NULL,
  state TEXT NOT NULL,
  coverage REAL NOT NULL,
  PRIMARY KEY(user_id, name),
  UNIQUE(user_id, position)
);

CREATE TABLE IF NOT EXISTS example_twin_nodes (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  r REAL NOT NULL,
  sub TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY(user_id, id),
  UNIQUE(user_id, position)
);

CREATE TABLE IF NOT EXISTS example_twin_edges (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY(user_id, source, target),
  UNIQUE(user_id, position),
  FOREIGN KEY(user_id, source) REFERENCES example_twin_nodes(user_id, id),
  FOREIGN KEY(user_id, target) REFERENCES example_twin_nodes(user_id, id)
);

INSERT OR IGNORE INTO example_assets
  (user_id, position, symbol, name, balance, value, change, share)
VALUES
  ('demo-user', 0, 'BTC', 'Bitcoin', '42,318.82', '$2.87B', '+1.82%', 34.1),
  ('demo-user', 1, 'ETH', 'Ethereum', '656,104.18', '$2.29B', '+0.94%', 27.2),
  ('demo-user', 2, 'SOL', 'Solana', '8,440,921.02', '$1.23B', '-0.38%', 14.6),
  ('demo-user', 3, 'USDC', 'USD Coin', '998,420,104.00', '$998.4M', '0.00%', 11.9),
  ('demo-user', 4, 'OTHER', '46 assets', 'Multi-chain', '$1.03B', '+0.21%', 12.2);

INSERT OR IGNORE INTO example_transactions
  (user_id, position, id, time, type, asset, amount, value, route, status)
VALUES
  ('demo-user', 0, 'TX-7E29A1', '16:38:12', 'Withdrawal', 'BTC', '128.42 BTC', '$8.71M', 'Vault 01 → Coinbase Prime', 'Pending approval'),
  ('demo-user', 1, 'TX-9B14C8', '16:26:49', 'Settlement', 'USDC', '24,800,000 USDC', '$24.80M', 'Omnibus → Client 1842', 'Completed'),
  ('demo-user', 2, 'TX-3A82F4', '15:51:03', 'Deposit', 'ETH', '4,806.15 ETH', '$16.76M', 'Fireblocks → Vault 03', 'Completed'),
  ('demo-user', 3, 'TX-6D21E7', '14:17:55', 'Rebalance', 'SOL', '680,000 SOL', '$99.28M', 'Warm 02 → Cold 01', 'Screening'),
  ('demo-user', 4, 'TX-1F77B2', '12:40:31', 'Withdrawal', 'ETH', '820.00 ETH', '$2.86M', 'Vault 03 → Client 0917', 'Completed');

INSERT OR IGNORE INTO example_policies
  (user_id, position, name, scope, rule, state, coverage)
VALUES
  ('demo-user', 0, 'Institutional Withdrawal', 'All cold-storage vaults', '4 of 6 signers · 12h velocity', 'Enforced', 100),
  ('demo-user', 1, 'Treasury Rebalancing', 'Treasury wallets', '3 of 5 signers · $250M limit', 'Enforced', 100),
  ('demo-user', 2, 'Counterparty Allowlist', 'External transfers', 'Verified addresses only', 'Review', 92),
  ('demo-user', 3, 'Travel Rule Compliance', 'Transfers above $3,000', 'Notabene screening', 'Enforced', 98);

INSERT OR IGNORE INTO example_twin_nodes
  (user_id, position, id, x, y, r, sub, type)
VALUES
  ('demo-user', 0, 'ACME BANK', 480, 280, 58, '$8.42B AUC', 'master'),
  ('demo-user', 1, 'BTC VAULT', 230, 145, 34, '$3.86B', 'asset'),
  ('demo-user', 2, 'ETH VAULT', 210, 430, 32, '$2.17B', 'asset'),
  ('demo-user', 3, 'FIREBLOCKS', 735, 105, 36, 'MPC NETWORK', 'network'),
  ('demo-user', 4, 'POLICY 01', 765, 405, 35, '4 OF 6', 'policy'),
  ('demo-user', 5, 'SETTLEMENT', 880, 270, 30, 'OMNIBUS', 'network'),
  ('demo-user', 6, 'SIGNER 04', 625, 180, 24, 'MPC SIGNER', 'policy'),
  ('demo-user', 7, 'RISK LIMIT', 615, 385, 24, '$250M / DAY', 'policy');

INSERT OR IGNORE INTO example_twin_edges
  (user_id, position, source, target)
VALUES
  ('demo-user', 0, 'ACME BANK', 'BTC VAULT'),
  ('demo-user', 1, 'ACME BANK', 'ETH VAULT'),
  ('demo-user', 2, 'ACME BANK', 'FIREBLOCKS'),
  ('demo-user', 3, 'ACME BANK', 'POLICY 01'),
  ('demo-user', 4, 'ACME BANK', 'SETTLEMENT'),
  ('demo-user', 5, 'ACME BANK', 'SIGNER 04'),
  ('demo-user', 6, 'ACME BANK', 'RISK LIMIT'),
  ('demo-user', 7, 'FIREBLOCKS', 'SETTLEMENT'),
  ('demo-user', 8, 'POLICY 01', 'RISK LIMIT');

INSERT OR IGNORE INTO example_data_initialized (user_id)
VALUES ('demo-user');

INSERT OR IGNORE INTO custody_authenticate (user_id, password, otp_secret)
VALUES ('demo-user', '41bd876b085d6031cb0e04de35b88d77f83a4ba39f879fee40805ac19e356023', 'JBSWY3DPEHPK3PXP');

COMMIT;

-- Verification queries.
SELECT 'assets' AS table_name, COUNT(*) AS rows, COUNT(DISTINCT user_id) AS users
FROM example_assets
UNION ALL
SELECT 'transactions', COUNT(*), COUNT(DISTINCT user_id) FROM example_transactions
UNION ALL
SELECT 'policies', COUNT(*), COUNT(DISTINCT user_id) FROM example_policies
UNION ALL
SELECT 'twin_nodes', COUNT(*), COUNT(DISTINCT user_id) FROM example_twin_nodes
UNION ALL
SELECT 'twin_edges', COUNT(*), COUNT(DISTINCT user_id) FROM example_twin_edges;

SELECT * FROM example_data_initialized WHERE user_id = 'demo-user';
PRAGMA foreign_key_check;

-- Example detail queries.
SELECT symbol, name, balance, value, change, share
FROM example_assets
WHERE user_id = 'demo-user'
ORDER BY position;

SELECT id, type, asset, amount, status
FROM example_transactions
WHERE user_id = 'demo-user'
ORDER BY position
LIMIT 2;
