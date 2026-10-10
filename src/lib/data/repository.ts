import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTRACT_VERSION, exampleData, type AuditEvent, type Dataset, type DecimalInteger, type ExampleData, type FinancialSnapshot, type ImportDatasetRequest, type ImportDatasetResponse, type SourceRecord } from "@/contracts";
import { cascadeImport } from "@/contracts/fixtures";

let databasePromise: Promise<DatabaseSync> | undefined;

const demoUserId = () => process.env.CUSTODYOS_DEMO_USER_ID ?? "demo-user";
const legacyUserId = () => process.env.CUSTODYOS_LEGACY_USER_ID ?? "demo-user";

const schema = `
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
  CREATE TABLE IF NOT EXISTS example_policies (
    user_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, scope TEXT NOT NULL,
    rule TEXT NOT NULL, state TEXT NOT NULL, coverage REAL NOT NULL,
    PRIMARY KEY(user_id, name), UNIQUE(user_id, position)
  );
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
  seedExampleData(connection, demoUserId());
  return connection;
}

function getDatabase(): Promise<DatabaseSync> {
  return databasePromise ??= openDatabase();
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
  for (const table of ["example_assets", "example_transactions", "example_policies", "example_twin_nodes"] as const) {
    database.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }
  database.prepare("DELETE FROM example_data_initialized WHERE user_id = ?").run(userId);
  const asset = database.prepare("INSERT INTO example_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  data.assets.forEach((row, position) => asset.run(userId, position, row.symbol, row.name, row.balance, row.value, row.change, row.share));
  const transaction = database.prepare("INSERT INTO example_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  data.transactions.forEach((row, position) => transaction.run(userId, position, row.id, row.time, row.type, row.asset, row.amount, row.value, row.route, row.status));
  const policy = database.prepare("INSERT INTO example_policies VALUES (?, ?, ?, ?, ?, ?, ?)");
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
  const policies = database.prepare("SELECT name, scope, rule, state, coverage FROM example_policies WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => ({ name: String(row.name), scope: String(row.scope), rule: String(row.rule), state: String(row.state), coverage: Number(row.coverage) }));
  const nodes = database.prepare("SELECT id, x, y, r, sub, type FROM example_twin_nodes WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => ({ id: String(row.id), x: Number(row.x), y: Number(row.y), r: Number(row.r), sub: String(row.sub), type: String(row.type) }));
  const edges = database.prepare("SELECT source, target FROM example_twin_edges WHERE user_id = ? ORDER BY position").all(userId)
    .map(row => [String(row.source), String(row.target)] as [string, string]);
  return { assets, transactions, policies, nodes, edges };
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

    const position = database.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS position
      FROM example_transactions WHERE user_id = ?`).get(input.userId) as { position: number };
    const transaction = {
      id: `TX-${randomUUID().toUpperCase()}`,
      time: new Date().toISOString().slice(11, 19),
      type: "Transfer",
      asset: ownedAsset.symbol,
      amount: `${input.assetAmount} ${ownedAsset.symbol}`,
      value: "—",
      route: `${input.senderName} → ${input.assetSource}`,
      status: "Pending approval",
    };
    database.prepare(`INSERT INTO example_transactions
      (user_id, position, id, time, type, asset, amount, value, route, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.userId, position.position, transaction.id, transaction.time, transaction.type, transaction.asset,
      transaction.amount, transaction.value, transaction.route, transaction.status,
    );
    database.exec("COMMIT");
    return { ok: true, transaction };
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
