import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTRACT_VERSION, exampleData, type AuditEvent, type Dataset, type DecimalInteger, type ExampleData, type FinancialSnapshot, type ImportDatasetRequest, type ImportDatasetResponse, type SourceRecord } from "@/contracts";
import { cascadeImport } from "@/contracts/fixtures";
import { evaluateTransfer, type ReviewTransfer, type PolicyEvaluation } from "@/lib/policy/evaluation";

let databasePromise: Promise<DatabaseSync> | undefined;

const demoUserId = () => process.env.CUSTODYOS_DEMO_USER_ID ?? "demo-user";
const legacyUserId = () => process.env.CUSTODYOS_LEGACY_USER_ID ?? "demo-user";

const schema = `
  CREATE TABLE IF NOT EXISTS custody_authenticate (
    user_id TEXT NOT NULL PRIMARY KEY,
    password TEXT NOT NULL,
    otp_secret TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS custody_datasets (
    user_id TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, contract_version TEXT NOT NULL,
    name TEXT NOT NULL, as_of TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_institutions (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
    external_id TEXT, role TEXT NOT NULL, PRIMARY KEY(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_accounts (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, id TEXT NOT NULL, institution_id TEXT NOT NULL,
    external_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id),
    FOREIGN KEY(user_id, dataset_id, institution_id) REFERENCES custody_institutions(user_id, dataset_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_instruments (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, id TEXT NOT NULL, symbol TEXT NOT NULL,
    name TEXT NOT NULL, asset_class TEXT NOT NULL, quantity_scale INTEGER NOT NULL,
    identifiers TEXT NOT NULL, PRIMARY KEY(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_source_records (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, id TEXT NOT NULL, source_system TEXT NOT NULL,
    external_id TEXT NOT NULL, kind TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
    account_id TEXT, amount_currency TEXT, amount_minor_units TEXT, quantity_instrument_id TEXT,
    quantity_units TEXT, attributes TEXT NOT NULL, PRIMARY KEY(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_obligations (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, id TEXT NOT NULL, external_id TEXT NOT NULL,
    from_account_id TEXT NOT NULL, to_account_id TEXT NOT NULL, asset_kind TEXT NOT NULL,
    asset_currency TEXT, asset_instrument_id TEXT, required_units TEXT NOT NULL,
    settled_units TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id),
    FOREIGN KEY(user_id, dataset_id, from_account_id) REFERENCES custody_accounts(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id, to_account_id) REFERENCES custody_accounts(user_id, dataset_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_obligation_sources (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, obligation_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
    PRIMARY KEY(user_id, dataset_id, obligation_id, source_record_id),
    FOREIGN KEY(user_id, dataset_id, obligation_id) REFERENCES custody_obligations(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id, source_record_id) REFERENCES custody_source_records(user_id, dataset_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_dependencies (
    user_id TEXT NOT NULL, dataset_id TEXT NOT NULL, id TEXT NOT NULL, predecessor_obligation_id TEXT NOT NULL,
    successor_obligation_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id),
    FOREIGN KEY(user_id, dataset_id, predecessor_obligation_id) REFERENCES custody_obligations(user_id, dataset_id, id),
    FOREIGN KEY(user_id, dataset_id, successor_obligation_id) REFERENCES custody_obligations(user_id, dataset_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_snapshots (
    user_id TEXT NOT NULL, id TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_revision TEXT NOT NULL,
    as_of TEXT NOT NULL, PRIMARY KEY(user_id, id), UNIQUE(user_id, dataset_id, dataset_revision),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_cash_balances (
    user_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, account_id TEXT NOT NULL, currency TEXT NOT NULL,
    settled_minor_units TEXT NOT NULL, reserved_minor_units TEXT NOT NULL,
    PRIMARY KEY(user_id, snapshot_id, account_id, currency),
    FOREIGN KEY(user_id, snapshot_id) REFERENCES custody_snapshots(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_securities_balances (
    user_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, account_id TEXT NOT NULL, instrument_id TEXT NOT NULL,
    settled_units TEXT NOT NULL, reserved_units TEXT NOT NULL,
    PRIMARY KEY(user_id, snapshot_id, account_id, instrument_id),
    FOREIGN KEY(user_id, snapshot_id) REFERENCES custody_snapshots(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS custody_audit_events (
    user_id TEXT NOT NULL, id TEXT NOT NULL, dataset_id TEXT NOT NULL, dataset_revision TEXT NOT NULL,
    occurred_at TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, subject_id TEXT NOT NULL,
    dataset_revision_before TEXT NOT NULL, dataset_revision_after TEXT NOT NULL, details TEXT NOT NULL,
    PRIMARY KEY(user_id, id),
    FOREIGN KEY(user_id, dataset_id) REFERENCES custody_datasets(user_id, id)
  );
  CREATE TABLE IF NOT EXISTS example_data_initialized (user_id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS example_assets (
    user_id TEXT NOT NULL, position INTEGER NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL,
    balance TEXT NOT NULL, value TEXT NOT NULL, change TEXT NOT NULL, share REAL NOT NULL,
    PRIMARY KEY(user_id, symbol), UNIQUE(user_id, position)
  );
  CREATE TABLE IF NOT EXISTS example_transactions (
    user_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL, time TEXT NOT NULL,
    type TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL, value TEXT NOT NULL,
    route TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(user_id, id), UNIQUE(user_id, position)
  );
  CREATE TABLE IF NOT EXISTS example_transfer_requests (
    user_id TEXT NOT NULL, transaction_id TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL,
    source TEXT NOT NULL, destination TEXT NOT NULL, created_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Pending approval', 'Approved for processing', 'Rejected')),
    revision INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(user_id, transaction_id)
  );
  CREATE TABLE IF NOT EXISTS example_transfer_audit (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approve', 'reject')),
    reviewer_id TEXT NOT NULL, reason TEXT NOT NULL, evaluation_json TEXT NOT NULL,
    revision_before INTEGER NOT NULL, revision_after INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS example_transfer_audit_no_update BEFORE UPDATE ON example_transfer_audit
    BEGIN SELECT RAISE(ABORT, 'transfer audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS example_transfer_audit_no_delete BEFORE DELETE ON example_transfer_audit
    BEGIN SELECT RAISE(ABORT, 'transfer audit is append-only'); END;
  CREATE TABLE IF NOT EXISTS example_policies (
    user_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, scope TEXT NOT NULL,
    rule TEXT NOT NULL, state TEXT NOT NULL, coverage REAL NOT NULL, archived_from_state TEXT,
    PRIMARY KEY(user_id, name), UNIQUE(user_id, position)
  );
  CREATE TABLE IF NOT EXISTS example_policy_rules (
    user_id TEXT NOT NULL, policy_name TEXT NOT NULL, rule_type TEXT NOT NULL,
    asset TEXT NOT NULL, threshold TEXT NOT NULL, action TEXT NOT NULL, effective_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(user_id, policy_name),
    FOREIGN KEY(user_id, policy_name) REFERENCES example_policies(user_id, name)
  );
  CREATE TABLE IF NOT EXISTS example_policy_audit (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, policy_name TEXT NOT NULL,
    occurred_at TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS example_policy_audit_no_update BEFORE UPDATE ON example_policy_audit
    BEGIN SELECT RAISE(ABORT, 'policy audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS example_policy_audit_no_delete BEFORE DELETE ON example_policy_audit
    BEGIN SELECT RAISE(ABORT, 'policy audit is append-only'); END;
  CREATE TABLE IF NOT EXISTS example_twin_nodes (
    user_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
    r REAL NOT NULL, sub TEXT NOT NULL, type TEXT NOT NULL,
    PRIMARY KEY(user_id, id), UNIQUE(user_id, position)
  );
  CREATE TABLE IF NOT EXISTS example_twin_edges (
    user_id TEXT NOT NULL, position INTEGER NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL,
    PRIMARY KEY(user_id, source, target), UNIQUE(user_id, position),
    FOREIGN KEY(user_id, source) REFERENCES example_twin_nodes(user_id, id),
    FOREIGN KEY(user_id, target) REFERENCES example_twin_nodes(user_id, id)
  );
`;

async function openDatabase(): Promise<DatabaseSync> {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Dataset persistence requires Node.js 24 or newer.");
  const databasePath = resolve(/* turbopackIgnore: true */ process.env.CUSTODYOS_DATABASE_PATH ?? "data/custodyos.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  connection.exec(schema);
  const policyColumns = connection.prepare("PRAGMA table_info(example_policies)").all()
    .map(column => String(column.name));
  if (!policyColumns.includes("archived_from_state")) {
    connection.exec("ALTER TABLE example_policies ADD COLUMN archived_from_state TEXT");
  }
  const policyRuleColumns = connection.prepare("PRAGMA table_info(example_policy_rules)").all()
    .map(column => String(column.name));
  if (!policyRuleColumns.includes("effective_at")) {
    connection.exec("ALTER TABLE example_policy_rules ADD COLUMN effective_at TEXT NOT NULL DEFAULT ''");
  }
  connection.prepare("UPDATE example_policy_rules SET effective_at = '1970-01-01T00:00:00.000Z' WHERE effective_at = ''").run();
  seedExampleData(connection, demoUserId());
  return connection;
}

function getDatabase(): Promise<DatabaseSync> {
  return databasePromise ??= openDatabase();
}

export async function getAuthenticationOtpSecret(userId: string, passwordHash: string): Promise<string | null> {
  const database = await getDatabase();
  const record = database.prepare(`
    SELECT otp_secret FROM custody_authenticate
    WHERE user_id = ? AND password = ?
  `).get(userId, passwordHash) as { otp_secret: string } | undefined;
  return record?.otp_secret ?? null;
}

export async function hasAuthenticationUser(userId: string): Promise<boolean> {
  const database = await getDatabase();
  return database.prepare("SELECT 1 AS present FROM custody_authenticate WHERE user_id = ?").get(userId) !== undefined;
}

export async function createAuthenticationUser(userId: string, passwordHash: string, otpSecret: string): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(`
    INSERT INTO custody_authenticate (user_id, password, otp_secret)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, passwordHash, otpSecret);
  return result.changes === 1;
}

export interface DatasetSource {
  dataset: Dataset;
  snapshot: FinancialSnapshot;
  institutions: ImportDatasetRequest["institutions"];
  accounts: ImportDatasetRequest["accounts"];
  instruments: ImportDatasetRequest["instruments"];
  sourceRecords: SourceRecord[];
  dependencies: ImportDatasetRequest["dependencies"];
  auditEvents: AuditEvent[];
}

export class DatasetConflictError extends Error {}

function writeExampleData(database: DatabaseSync, userId: string, data: ExampleData) {
  database.prepare("DELETE FROM example_twin_edges WHERE user_id = ?").run(userId);
  database.prepare("DELETE FROM example_policy_rules WHERE user_id = ?").run(userId);
  for (const table of ["example_assets", "example_transactions", "example_policies", "example_twin_nodes"] as const) {
    database.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }
  database.prepare("DELETE FROM example_data_initialized WHERE user_id = ?").run(userId);
  const asset = database.prepare("INSERT INTO example_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  data.assets.forEach((row, position) => asset.run(userId, position, row.symbol, row.name, row.balance, row.value, row.change, row.share));
  const transaction = database.prepare("INSERT INTO example_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  data.transactions.forEach((row, position) => transaction.run(userId, position, row.id, row.time, row.type, row.asset, row.amount, row.value, row.route, row.status));
  const policy = database.prepare(`INSERT INTO example_policies
    (user_id, position, name, scope, rule, state, coverage) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  data.policies.forEach((row, position) => policy.run(userId, position, row.name, row.scope, row.rule, row.state, row.coverage));
  const node = database.prepare("INSERT INTO example_twin_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  data.nodes.forEach((row, position) => node.run(userId, position, row.id, row.x, row.y, row.r, row.sub, row.type));
  const edge = database.prepare("INSERT INTO example_twin_edges VALUES (?, ?, ?, ?)");
  data.edges.forEach(([source, target], position) => edge.run(userId, position, source, target));
  database.prepare("INSERT INTO example_data_initialized (user_id) VALUES (?)").run(userId);
}

function seedExampleData(database: DatabaseSync, userId: string) {
  const existing = database.prepare("SELECT user_id FROM example_data_initialized WHERE user_id = ?").get(userId);
  if (existing) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    writeExampleData(database, userId, exampleData);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function getExampleData(userId = demoUserId()): Promise<ExampleData> {
  const database = await getDatabase();
  if (userId === demoUserId()) seedExampleData(database, userId);
  const assets = database.prepare("SELECT symbol, name, balance, value, change, share FROM example_assets WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => ({ symbol: String(row.symbol), name: String(row.name), balance: String(row.balance), value: String(row.value), change: String(row.change), share: Number(row.share) }));
  const transactions = database.prepare("SELECT id, time, type, asset, amount, value, route, status FROM example_transactions WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => ({ id: String(row.id), time: String(row.time), type: String(row.type), asset: String(row.asset), amount: String(row.amount), value: String(row.value), route: String(row.route), status: String(row.status) }));
  const policies = database.prepare(`SELECT p.name, p.scope, p.rule, p.state, p.coverage, r.asset, r.threshold, r.action
    FROM example_policies p LEFT JOIN example_policy_rules r
      ON r.user_id = p.user_id AND r.policy_name = p.name
    WHERE p.user_id = ? ORDER BY p.position`).all(userId)
    .map(row => ({
      name: String(row.name), scope: String(row.scope), rule: String(row.rule), state: String(row.state), coverage: Number(row.coverage),
      ...(row.asset == null ? {} : { asset: String(row.asset), threshold: String(row.threshold), action: String(row.action) }),
    }));
  const nodes = database.prepare("SELECT id, x, y, r, sub, type FROM example_twin_nodes WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => ({ id: String(row.id), x: Number(row.x), y: Number(row.y), r: Number(row.r), sub: String(row.sub), type: String(row.type) }));
  const edges = database.prepare("SELECT source, target FROM example_twin_edges WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => [String(row.source), String(row.target)] as [string, string]);
  return { assets, transactions, policies, nodes, edges };
}

export class PolicyNameConflictError extends Error {}
export class PolicyArchiveConflictError extends Error {}

export async function createExamplePolicy(input: {
  userId: string;
  name: string;
  asset: string;
  threshold: string;
  archivePolicyNames: string[];
}): Promise<ExampleData["policies"][number]> {
  const database = await getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const duplicate = database.prepare(`SELECT 1 FROM example_policies
      WHERE user_id = ? AND LOWER(name) = LOWER(?)`).get(input.userId, input.name);
    if (duplicate) throw new PolicyNameConflictError("A policy with this name already exists.");

    const archiveNames = [...new Set(input.archivePolicyNames)];
    for (const policyName of archiveNames) {
      const overlapping = database.prepare(`SELECT p.state FROM example_policies p
        JOIN example_policy_rules r ON r.user_id = p.user_id AND r.policy_name = p.name
        WHERE p.user_id = ? AND p.name = ? AND p.state = 'Enforced'
          AND r.rule_type = 'amount_threshold' AND r.asset = ?`).get(input.userId, policyName, input.asset);
      if (!overlapping) {
        throw new PolicyArchiveConflictError(`Policy “${policyName}” is no longer an enforced threshold rule for ${input.asset}. Refresh and try again.`);
      }
    }

    const position = Number((database.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM example_policies WHERE user_id = ?",
    ).get(input.userId) as { position: number }).position);
    const scope = "All new transfers";
    const rule = `${input.asset} amount > ${input.threshold} · Human approval`;
    const action = "human_approval";
    const effectiveAt = new Date().toISOString();
    const archivePolicy = database.prepare(`UPDATE example_policies SET archived_from_state = state, state = 'Archived'
      WHERE user_id = ? AND name = ? AND state = 'Enforced'`);
    const auditPolicyArchive = database.prepare(`INSERT INTO example_policy_audit
      (id, user_id, policy_name, occurred_at, action, details)
      VALUES (?, ?, ?, ?, 'archived', ?)`);
    for (const policyName of archiveNames) {
      const archived = archivePolicy.run(input.userId, policyName);
      if (archived.changes !== 1) throw new PolicyArchiveConflictError(`Policy “${policyName}” changed while the new policy was being saved. Refresh and try again.`);
      auditPolicyArchive.run(`policy-audit-${randomUUID()}`, input.userId, policyName, effectiveAt, JSON.stringify({ replacedBy: input.name }));
    }
    database.prepare(`INSERT INTO example_policies (user_id, position, name, scope, rule, state, coverage)
      VALUES (?, ?, ?, ?, ?, 'Enforced', 100)`).run(input.userId, position, input.name, scope, rule);
    database.prepare(`INSERT INTO example_policy_rules
      (user_id, policy_name, rule_type, asset, threshold, action, effective_at)
      VALUES (?, ?, 'amount_threshold', ?, ?, ?, ?)`)
      .run(input.userId, input.name, input.asset, input.threshold, action, effectiveAt);
    database.prepare(`INSERT INTO example_policy_audit
      (id, user_id, policy_name, occurred_at, action, details)
      VALUES (?, ?, ?, ?, 'created', ?)`)
      .run(`policy-audit-${randomUUID()}`, input.userId, input.name, effectiveAt, JSON.stringify({ asset: input.asset, threshold: input.threshold, state: "Enforced" }));
    database.exec("COMMIT");
    return { name: input.name, scope, rule, state: "Enforced", coverage: 100, asset: input.asset, threshold: input.threshold, action };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function setExamplePolicyArchived(userId: string, name: string, archived: boolean) {
  const database = await getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database.prepare(`SELECT state, archived_from_state FROM example_policies
      WHERE user_id = ? AND name = ?`).get(userId, name) as { state: string; archived_from_state: string | null } | undefined;
    if (!current) {
      database.exec("ROLLBACK");
      return null;
    }
    if (archived && current.state === "Archived") {
      database.exec("ROLLBACK");
      return { ok: false as const, reason: "ALREADY_ARCHIVED" as const };
    }
    if (!archived && current.state !== "Archived") {
      database.exec("ROLLBACK");
      return { ok: false as const, reason: "NOT_ARCHIVED" as const };
    }
    const nextState = archived ? "Archived" : current.archived_from_state ?? "Review";
    database.prepare(`UPDATE example_policies SET state = ?, archived_from_state = ?
      WHERE user_id = ? AND name = ?`).run(nextState, archived ? current.state : null, userId, name);
    database.prepare(`INSERT INTO example_policy_audit
      (id, user_id, policy_name, occurred_at, action, details)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(`policy-audit-${randomUUID()}`, userId, name, new Date().toISOString(), archived ? "archived" : "restored", JSON.stringify({ from: current.state, to: nextState }));
    database.exec("COMMIT");
    return { ok: true as const, state: nextState };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function saveExampleData(data: ExampleData): Promise<void> {
  const database = await getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    writeExampleData(database, demoUserId(), data);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function createExampleTransfer(input: {
  userId: string;
  assetType: string;
  assetAmount: string;
  assetSource: string;
  senderName: string;
}): Promise<
  | { ok: true; transaction: ExampleData["transactions"][number] }
  | { ok: false; reason: "ASSET_NOT_OWNED" | "ASSET_TYPE_MISMATCH" }
> {
  const database = await getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const ownedAsset = database.prepare(`SELECT symbol FROM example_assets
      WHERE user_id = ? AND (symbol = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)`)
      .get(input.userId, input.assetSource, input.assetSource) as { symbol: string } | undefined;
    if (!ownedAsset) {
      database.exec("ROLLBACK");
      return { ok: false, reason: "ASSET_NOT_OWNED" };
    }
    if (ownedAsset.symbol.toUpperCase() !== input.assetType.toUpperCase()) {
      database.exec("ROLLBACK");
      return { ok: false, reason: "ASSET_TYPE_MISMATCH" };
    }

    const position = database.prepare(`SELECT COALESCE(MIN(position), 0) - 1 AS position
      FROM example_transactions WHERE user_id = ?`).get(input.userId) as { position: number };
    const transaction = {
      id: `TX-${randomUUID().toUpperCase()}`,
      time: new Date().toISOString().slice(11, 19),
      type: "Transfer",
      asset: ownedAsset.symbol,
      amount: `${input.assetAmount} ${ownedAsset.symbol}`,
      value: "—",
      route: `${input.assetSource} → ${input.senderName}`,
      status: "Pending approval",
    };
    database.prepare(`INSERT INTO example_transactions
      (user_id, position, id, time, type, asset, amount, value, route, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.userId, position.position, transaction.id, transaction.time, transaction.type, transaction.asset,
      transaction.amount, transaction.value, transaction.route, transaction.status,
    );
    database.prepare(`INSERT INTO example_transfer_requests
      (user_id, transaction_id, asset, amount, source, destination, created_at, status, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending approval', 1)`).run(
      input.userId, transaction.id, ownedAsset.symbol, input.assetAmount, input.assetSource,
      input.senderName, new Date().toISOString(),
    );
    database.exec("COMMIT");
    return { ok: true, transaction };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export interface TransferAuditRecord {
  id: string;
  transactionId: string;
  occurredAt: string;
  decision: "approve" | "reject";
  reviewerId: string;
  reason: string;
  evaluation: PolicyEvaluation;
  revisionBefore: number;
  revisionAfter: number;
}

function reviewRow(row: Record<string, unknown>): ReviewTransfer {
  return {
    id: String(row.transaction_id), userId: String(row.user_id), asset: String(row.asset),
    amount: String(row.amount), source: String(row.source), destination: String(row.destination),
    createdAt: String(row.created_at), status: String(row.status) as ReviewTransfer["status"],
    revision: Number(row.revision),
  };
}

function sourceOwned(database: DatabaseSync, transfer: ReviewTransfer): boolean {
  return Boolean(database.prepare("SELECT 1 FROM example_assets WHERE user_id = ? AND symbol = ?")
    .get(transfer.userId, transfer.asset));
}

function amountThresholdPolicies(database: DatabaseSync, userId: string) {
  return database.prepare(`SELECT p.name, r.asset, r.threshold, r.effective_at FROM example_policy_rules r
    JOIN example_policies p ON p.user_id = r.user_id AND p.name = r.policy_name
    WHERE r.user_id = ? AND r.rule_type = 'amount_threshold' AND p.state = 'Enforced'
    ORDER BY p.position`).all(userId).map(row => ({
      name: String(row.name), asset: String(row.asset), threshold: String(row.threshold), effectiveAt: String(row.effective_at),
    }));
}

export async function getTransferReviews(userId = demoUserId()) {
  const database = await getDatabase();
  const transfers = database.prepare(`SELECT r.* FROM example_transfer_requests r
    JOIN example_transactions t ON t.user_id = r.user_id AND t.id = r.transaction_id AND t.status = r.status
    WHERE r.user_id = ? ORDER BY r.created_at DESC, r.rowid DESC`).all(userId).map(row => reviewRow(row));
  const audit = database.prepare(`SELECT * FROM example_transfer_audit WHERE user_id = ?
    ORDER BY occurred_at DESC, rowid DESC`).all(userId).map(row => ({
    id: String(row.id), transactionId: String(row.transaction_id), occurredAt: String(row.occurred_at),
    decision: String(row.decision) as TransferAuditRecord["decision"], reviewerId: String(row.reviewer_id),
    reason: String(row.reason), evaluation: JSON.parse(String(row.evaluation_json)) as PolicyEvaluation,
    revisionBefore: Number(row.revision_before), revisionAfter: Number(row.revision_after),
  }));
  const policies = amountThresholdPolicies(database, userId);
  return { transfers: transfers.map(transfer => ({ ...transfer, evaluation: evaluateTransfer(transfer, sourceOwned(database, transfer), policies) })), audit };
}

export async function decideTransfer(input: {
  userId: string; transactionId: string; expectedRevision: number;
  decision: "approve" | "reject"; reason: string;
}): Promise<{ ok: true; transfer: ReviewTransfer; audit: TransferAuditRecord } |
  { ok: false; reason: "NOT_FOUND" | "CONFLICT" | "EVIDENCE_REQUIRED" }> {
  const database = await getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare(`SELECT r.* FROM example_transfer_requests r
      JOIN example_transactions t ON t.user_id = r.user_id AND t.id = r.transaction_id AND t.status = r.status
      WHERE r.user_id = ? AND r.transaction_id = ?`)
      .get(input.userId, input.transactionId);
    if (!row) { database.exec("ROLLBACK"); return { ok: false, reason: "NOT_FOUND" }; }
    const transfer = reviewRow(row);
    if (transfer.status !== "Pending approval" || transfer.revision !== input.expectedRevision) {
      database.exec("ROLLBACK"); return { ok: false, reason: "CONFLICT" };
    }
    const evaluation = evaluateTransfer(transfer, sourceOwned(database, transfer), amountThresholdPolicies(database, input.userId));
    if (input.decision === "approve" && !evaluation.canApprove) {
      database.exec("ROLLBACK"); return { ok: false, reason: "EVIDENCE_REQUIRED" };
    }
    const status = input.decision === "approve" ? "Approved for processing" : "Rejected";
    const changed = database.prepare(`UPDATE example_transfer_requests SET status = ?, revision = revision + 1
      WHERE user_id = ? AND transaction_id = ? AND status = 'Pending approval' AND revision = ?`)
      .run(status, input.userId, input.transactionId, input.expectedRevision);
    if (changed.changes !== 1) { database.exec("ROLLBACK"); return { ok: false, reason: "CONFLICT" }; }
    const transactionChanged = database.prepare(`UPDATE example_transactions SET status = ?
      WHERE user_id = ? AND id = ? AND status = 'Pending approval'`)
      .run(status, input.userId, input.transactionId);
    if (transactionChanged.changes !== 1) throw new Error("Transfer and transaction statuses diverged.");
    const audit: TransferAuditRecord = {
      id: `transfer-audit-${randomUUID()}`, transactionId: transfer.id, occurredAt: new Date().toISOString(),
      decision: input.decision, reviewerId: "local-demo-reviewer", reason: input.reason,
      evaluation, revisionBefore: transfer.revision, revisionAfter: transfer.revision + 1,
    };
    database.prepare(`INSERT INTO example_transfer_audit
      (id, user_id, transaction_id, occurred_at, decision, reviewer_id, reason, evaluation_json, revision_before, revision_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      audit.id, input.userId, transfer.id, audit.occurredAt, audit.decision, audit.reviewerId,
      audit.reason, JSON.stringify(evaluation), audit.revisionBefore, audit.revisionAfter,
    );
    database.exec("COMMIT");
    return { ok: true, transfer: { ...transfer, status, revision: audit.revisionAfter }, audit };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function importDataset(data: ImportDatasetRequest): Promise<Extract<ImportDatasetResponse, { ok: true }>["data"]> {
  if (data.dataset.id === cascadeImport.dataset.id) throw new DatasetConflictError("The cascade fixture dataset ID is reserved.");
  const database = await getDatabase();
  const userId = demoUserId();
  const createdAt = new Date().toISOString();
  const revision = "1" as const;
  const dataset: Dataset = { ...data.dataset, revision, createdAt, status: "ready" };
  const snapshotId = `snapshot-${createHash("sha256").update(`${userId}:${data.dataset.id}`).digest("hex").slice(0, 24)}-1`;
  const snapshot: FinancialSnapshot = { id: snapshotId, datasetId: dataset.id, datasetRevision: revision, asOf: dataset.asOf,
    cashBalances: data.initialCashBalances, securitiesBalances: data.initialSecuritiesBalances, obligations: data.obligations };
  const auditEventId = `audit-${crypto.randomUUID()}`;
  const auditEvent: AuditEvent = { id: auditEventId, datasetId: dataset.id, actorId: userId, action: "DATASET_IMPORTED",
    subjectId: dataset.id, occurredAt: createdAt, datasetRevisionBefore: "0", datasetRevisionAfter: revision,
    details: { snapshotId, contractVersion: CONTRACT_VERSION } };
  database.exec("BEGIN IMMEDIATE");
  try {
    if (userId === legacyUserId() && hasLegacyDataset(database, dataset.id)) {
      throw new DatasetConflictError("Dataset ID already exists; import is create-only under contract v1.");
    }
    database.prepare(`INSERT INTO custody_datasets
      (user_id, id, revision, contract_version, name, as_of, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId, dataset.id, revision, data.contractVersion, dataset.name, dataset.asOf, createdAt, dataset.status);

    const institution = database.prepare("INSERT INTO custody_institutions VALUES (?, ?, ?, ?, ?, ?)");
    data.institutions.forEach(row => institution.run(userId, dataset.id, row.id, row.name, row.externalId ?? null, row.role));
    const account = database.prepare("INSERT INTO custody_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    data.accounts.forEach(row => account.run(userId, dataset.id, row.id, row.institutionId, row.externalId, row.name, row.kind, row.status));
    const instrument = database.prepare("INSERT INTO custody_instruments VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    data.instruments.forEach(row => instrument.run(userId, dataset.id, row.id, row.symbol, row.name, row.assetClass, row.quantityScale, JSON.stringify(row.identifiers)));
    const sourceRecord = database.prepare("INSERT INTO custody_source_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    data.sourceRecords.forEach(row => sourceRecord.run(userId, dataset.id, row.id, row.sourceSystem, row.externalId, row.kind, row.occurredAt, row.receivedAt,
      row.accountId ?? null, row.amount?.currency ?? null, row.amount?.minorUnits ?? null, row.quantity?.instrumentId ?? null, row.quantity?.units ?? null, JSON.stringify(row.attributes)));
    const obligation = database.prepare(`INSERT INTO custody_obligations
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const obligationSource = database.prepare("INSERT INTO custody_obligation_sources VALUES (?, ?, ?, ?)");
    data.obligations.forEach(row => {
      obligation.run(userId, dataset.id, row.id, row.externalId, row.fromAccountId, row.toAccountId, row.asset.kind,
        row.asset.kind === "cash" ? row.asset.currency : null, row.asset.kind === "security" ? row.asset.instrumentId : null,
        row.requiredUnits, row.settledUnits, row.dueAt, row.status);
      row.sourceRecordIds.forEach(sourceId => obligationSource.run(userId, dataset.id, row.id, sourceId));
    });
    const dependency = database.prepare("INSERT INTO custody_dependencies VALUES (?, ?, ?, ?, ?, ?)");
    data.dependencies.forEach(row => dependency.run(userId, dataset.id, row.id, row.predecessorObligationId, row.successorObligationId, row.kind));

    database.prepare("INSERT INTO custody_snapshots VALUES (?, ?, ?, ?, ?)").run(userId, snapshotId, dataset.id, revision, snapshot.asOf);
    const cashBalance = database.prepare("INSERT INTO custody_cash_balances VALUES (?, ?, ?, ?, ?, ?)");
    data.initialCashBalances.forEach(row => cashBalance.run(userId, snapshotId, row.accountId, row.currency, row.settledMinorUnits, row.reservedMinorUnits));
    const securitiesBalance = database.prepare("INSERT INTO custody_securities_balances VALUES (?, ?, ?, ?, ?, ?)");
    data.initialSecuritiesBalances.forEach(row => securitiesBalance.run(userId, snapshotId, row.accountId, row.instrumentId, row.settledUnits, row.reservedUnits));
    database.prepare(`INSERT INTO custody_audit_events
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, auditEventId, dataset.id, revision, createdAt, userId,
      auditEvent.action, auditEvent.subjectId, auditEvent.datasetRevisionBefore, auditEvent.datasetRevisionAfter, JSON.stringify(auditEvent.details));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    if (error instanceof DatasetConflictError) throw error;
    if (error instanceof Error && (error.message.includes("UNIQUE constraint failed: custody_datasets.user_id, custody_datasets.id")
      || error.message.includes("UNIQUE constraint failed: imported_datasets.id"))) {
      throw new DatasetConflictError("Dataset ID already exists; import is create-only under contract v1.");
    }
    throw error;
  }
  return { dataset, snapshotId, imported: { institutions: data.institutions.length, accounts: data.accounts.length,
    instruments: data.instruments.length, sourceRecords: data.sourceRecords.length, obligations: data.obligations.length,
    dependencies: data.dependencies.length }, auditEventId };
}

type DatasetRow = { id: string; revision: DecimalInteger; contract_version: string; name: string; as_of: string; created_at: string; status: Dataset["status"] };
type ObligationRow = { id: string; dataset_id: string; external_id: string; from_account_id: string; to_account_id: string; asset_kind: "cash" | "security"; asset_currency: string | null; asset_instrument_id: string | null; required_units: string; settled_units: string; due_at: string; status: "pending" | "at_risk" | "blocked" | "settled" | "cancelled" };

function hasLegacyDataset(database: DatabaseSync, datasetId: string): boolean {
  const table = database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'imported_datasets'").get();
  if (!table) return false;
  return Boolean(database.prepare("SELECT 1 FROM imported_datasets WHERE id = ?").get(datasetId));
}

function getLegacyDataset(database: DatabaseSync, datasetId: string): Promise<DatasetSource | null> {
  if (demoUserId() !== legacyUserId()) return Promise.resolve(null);
  const table = database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'imported_datasets'").get();
  if (!table) return Promise.resolve(null);
  const record = database.prepare("SELECT revision, payload FROM imported_datasets WHERE id = ?").get(datasetId) as { revision: string; payload: string } | undefined;
  if (!record) return Promise.resolve(null);
  const content = JSON.parse(record.payload) as Pick<DatasetSource, "dataset" | "institutions" | "accounts" | "instruments" | "sourceRecords" | "dependencies">;
  const snapshotRecord = database.prepare("SELECT payload FROM financial_snapshots WHERE dataset_id = ? AND dataset_revision = ?").get(datasetId, record.revision) as { payload: string } | undefined;
  if (!snapshotRecord) throw new Error(`No snapshot for dataset ${datasetId} revision ${record.revision}`);
  const auditRecords = database.prepare("SELECT payload FROM dataset_audit_events WHERE dataset_id = ? ORDER BY rowid DESC").all(datasetId) as { payload: string }[];
  return Promise.resolve({ ...content, snapshot: JSON.parse(snapshotRecord.payload) as FinancialSnapshot,
    auditEvents: auditRecords.map(event => JSON.parse(event.payload) as AuditEvent) });
}

export async function getImportedDataset(datasetId: string, userId = demoUserId()): Promise<DatasetSource | null> {
  const database = await getDatabase();
  const record = database.prepare(`SELECT id, revision, contract_version, name, as_of, created_at, status
    FROM custody_datasets WHERE user_id = ? AND id = ?`).get(userId, datasetId) as DatasetRow | undefined;
  if (!record) return userId === demoUserId() ? getLegacyDataset(database, datasetId) : null;

  const dataset: Dataset = { id: record.id, revision: record.revision, contractVersion: record.contract_version as Dataset["contractVersion"],
    name: record.name, asOf: record.as_of, createdAt: record.created_at, status: record.status };
  const institutions = database.prepare(`SELECT id, dataset_id, name, external_id, role FROM custody_institutions
    WHERE user_id = ? AND dataset_id = ? ORDER BY rowid`).all(userId, datasetId).map(row => ({
    id: row.id, datasetId: row.dataset_id, name: row.name, ...(row.external_id === null ? {} : { externalId: row.external_id }), role: row.role,
  })) as ImportDatasetRequest["institutions"];
  const accounts = database.prepare(`SELECT id, dataset_id, institution_id, external_id, name, kind, status FROM custody_accounts
    WHERE user_id = ? AND dataset_id = ? ORDER BY rowid`).all(userId, datasetId).map(row => ({
    id: row.id, datasetId: row.dataset_id, institutionId: row.institution_id, externalId: row.external_id, name: row.name, kind: row.kind, status: row.status,
  })) as ImportDatasetRequest["accounts"];
  const instruments = database.prepare(`SELECT id, dataset_id, symbol, name, asset_class, quantity_scale, identifiers FROM custody_instruments
    WHERE user_id = ? AND dataset_id = ? ORDER BY rowid`).all(userId, datasetId).map(row => ({
    id: row.id, datasetId: row.dataset_id, symbol: row.symbol, name: row.name, assetClass: row.asset_class, quantityScale: row.quantity_scale,
    identifiers: JSON.parse(String(row.identifiers)),
  })) as ImportDatasetRequest["instruments"];
  const sourceRows = database.prepare(`SELECT id, dataset_id, source_system, external_id, kind, occurred_at, received_at, account_id,
    amount_currency, amount_minor_units, quantity_instrument_id, quantity_units, attributes FROM custody_source_records
    WHERE user_id = ? AND dataset_id = ? ORDER BY rowid`).all(userId, datasetId);
  const sourceRecords = sourceRows.map(row => ({
    id: String(row.id), datasetId: String(row.dataset_id), sourceSystem: String(row.source_system), externalId: String(row.external_id), kind: String(row.kind),
    occurredAt: String(row.occurred_at), receivedAt: String(row.received_at), ...(row.account_id === null ? {} : { accountId: String(row.account_id) }),
    ...(row.amount_currency === null ? {} : { amount: { currency: String(row.amount_currency), minorUnits: String(row.amount_minor_units) as `${bigint}` } }),
    ...(row.quantity_instrument_id === null ? {} : { quantity: { instrumentId: String(row.quantity_instrument_id), units: String(row.quantity_units) as `${bigint}` } }),
    attributes: JSON.parse(String(row.attributes)),
  })) as SourceRecord[];
  const obligationRows = database.prepare(`SELECT id, dataset_id, external_id, from_account_id, to_account_id, asset_kind, asset_currency,
    asset_instrument_id, required_units, settled_units, due_at, status FROM custody_obligations
    WHERE user_id = ? AND dataset_id = ? ORDER BY rowid`).all(userId, datasetId) as ObligationRow[];
  const obligations = obligationRows.map(row => {
    const sourceRecordIds = database.prepare(`SELECT source_record_id FROM custody_obligation_sources
      WHERE user_id = ? AND dataset_id = ? AND obligation_id = ? ORDER BY rowid`).all(userId, datasetId, row.id).map(item => item.source_record_id as string);
    const asset = row.asset_kind === "cash" ? { kind: "cash" as const, currency: row.asset_currency! }
      : { kind: "security" as const, instrumentId: row.asset_instrument_id! };
    return { id: row.id, datasetId: row.dataset_id, externalId: row.external_id, fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id, asset, requiredUnits: row.required_units as DecimalInteger, settledUnits: row.settled_units as DecimalInteger,
      dueAt: row.due_at, status: row.status, sourceRecordIds };
  }) as ImportDatasetRequest["obligations"];
  const dependencies = database.prepare(`SELECT id, dataset_id, predecessor_obligation_id, successor_obligation_id, kind
    FROM custody_dependencies WHERE user_id = ? AND dataset_id = ? ORDER BY rowid`).all(userId, datasetId).map(row => ({
    id: row.id, datasetId: row.dataset_id, predecessorObligationId: row.predecessor_obligation_id,
    successorObligationId: row.successor_obligation_id, kind: row.kind,
  })) as ImportDatasetRequest["dependencies"];

  const snapshotRow = database.prepare(`SELECT id, dataset_id, dataset_revision, as_of FROM custody_snapshots
    WHERE user_id = ? AND dataset_id = ? AND dataset_revision = ?`).get(userId, datasetId, record.revision) as {
    id: string; dataset_id: string; dataset_revision: string; as_of: string;
  } | undefined;
  if (!snapshotRow) throw new Error(`No snapshot for dataset ${datasetId} revision ${record.revision}`);
  const cashBalances = database.prepare(`SELECT account_id, currency, settled_minor_units, reserved_minor_units
    FROM custody_cash_balances WHERE user_id = ? AND snapshot_id = ? ORDER BY rowid`).all(userId, snapshotRow.id)
    .map(row => ({ accountId: row.account_id, currency: row.currency, settledMinorUnits: row.settled_minor_units as DecimalInteger, reservedMinorUnits: row.reserved_minor_units as DecimalInteger })) as FinancialSnapshot["cashBalances"];
  const securitiesBalances = database.prepare(`SELECT account_id, instrument_id, settled_units, reserved_units
    FROM custody_securities_balances WHERE user_id = ? AND snapshot_id = ? ORDER BY rowid`).all(userId, snapshotRow.id)
    .map(row => ({ accountId: row.account_id, instrumentId: row.instrument_id, settledUnits: row.settled_units as DecimalInteger, reservedUnits: row.reserved_units as DecimalInteger })) as FinancialSnapshot["securitiesBalances"];
  const auditEvents = database.prepare(`SELECT id, dataset_id, dataset_revision, occurred_at, actor_id, action, subject_id,
    dataset_revision_before, dataset_revision_after, details FROM custody_audit_events
    WHERE user_id = ? AND dataset_id = ? ORDER BY rowid DESC`).all(userId, datasetId).map(row => ({
    id: row.id, datasetId: row.dataset_id, datasetRevision: row.dataset_revision, occurredAt: row.occurred_at,
    actorId: row.actor_id, action: row.action, subjectId: row.subject_id, datasetRevisionBefore: row.dataset_revision_before,
    datasetRevisionAfter: row.dataset_revision_after, details: JSON.parse(String(row.details)),
  })) as AuditEvent[];
  const snapshot: FinancialSnapshot = { id: snapshotRow.id, datasetId: snapshotRow.dataset_id, datasetRevision: snapshotRow.dataset_revision as DecimalInteger,
    asOf: snapshotRow.as_of, cashBalances, securitiesBalances, obligations };
  return { dataset, snapshot, institutions, accounts, instruments, sourceRecords, dependencies, auditEvents };
}

export async function getFinancialDataForUser(userId: string) {
  const database = await getDatabase();
  const datasetRows = database.prepare("SELECT id FROM custody_datasets WHERE user_id = ? ORDER BY created_at DESC, id").all(userId);
  const datasets = await Promise.all(datasetRows.map(row => getImportedDataset(String(row.id), userId)));
  return {
    userId,
    ...(await getExampleData(userId)),
    datasets: datasets.filter((dataset): dataset is DatasetSource => dataset !== null),
  };
}
