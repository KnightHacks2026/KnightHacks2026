import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTRACT_VERSION, type AuditEvent, type Dataset, type FinancialSnapshot, type ImportDatasetRequest, type ImportDatasetResponse, type SourceRecord } from "@/contracts";
import { cascadeImport } from "@/contracts/fixtures";

let databasePromise: Promise<DatabaseSync> | undefined;

async function openDatabase(): Promise<DatabaseSync> {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Dataset persistence requires Node.js 24 or newer.");
  const databasePath = resolve(/* turbopackIgnore: true */ process.env.CUSTODYOS_DATABASE_PATH ?? "data/custodyos.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  connection.exec(`
  CREATE TABLE IF NOT EXISTS imported_datasets (
    id TEXT PRIMARY KEY, revision TEXT NOT NULL, contract_version TEXT NOT NULL,
    payload TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS financial_snapshots (
    id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES imported_datasets(id),
    dataset_revision TEXT NOT NULL, payload TEXT NOT NULL,
    UNIQUE(dataset_id, dataset_revision)
  );
  CREATE TABLE IF NOT EXISTS dataset_audit_events (
    id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES imported_datasets(id),
    dataset_revision TEXT NOT NULL, payload TEXT NOT NULL
  );
`);
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

export async function importDataset(data: ImportDatasetRequest): Promise<Extract<ImportDatasetResponse, { ok: true }>["data"]> {
  if (data.dataset.id === cascadeImport.dataset.id) throw new DatasetConflictError("The cascade fixture dataset ID is reserved.");
  const database = await getDatabase();
  const createdAt = new Date().toISOString();
  const revision = "1" as const;
  const dataset: Dataset = { ...data.dataset, revision, createdAt, status: "ready" };
  const snapshotId = `snapshot-${createHash("sha256").update(data.dataset.id).digest("hex").slice(0, 24)}-1`;
  const snapshot: FinancialSnapshot = { id: snapshotId, datasetId: dataset.id, datasetRevision: revision, asOf: dataset.asOf,
    cashBalances: data.initialCashBalances, securitiesBalances: data.initialSecuritiesBalances, obligations: data.obligations };
  const auditEventId = `audit-${crypto.randomUUID()}`;
  const auditEvent: AuditEvent = { id: auditEventId, datasetId: dataset.id, actorId: "anonymous", action: "DATASET_IMPORTED",
    subjectId: dataset.id, occurredAt: createdAt, datasetRevisionBefore: "0", datasetRevisionAfter: revision,
    details: { snapshotId, contractVersion: CONTRACT_VERSION } };
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO imported_datasets (id, revision, contract_version, payload, created_at) VALUES (?, ?, ?, ?, ?)").run(
      dataset.id, revision, data.contractVersion, JSON.stringify({ dataset, institutions: data.institutions, accounts: data.accounts,
        instruments: data.instruments, sourceRecords: data.sourceRecords, dependencies: data.dependencies }), createdAt);
    database.prepare("INSERT INTO financial_snapshots (id, dataset_id, dataset_revision, payload) VALUES (?, ?, ?, ?)").run(
      snapshotId, dataset.id, revision, JSON.stringify(snapshot));
    database.prepare("INSERT INTO dataset_audit_events (id, dataset_id, dataset_revision, payload) VALUES (?, ?, ?, ?)").run(
      auditEventId, dataset.id, revision, JSON.stringify(auditEvent));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: imported_datasets.id")) {
      throw new DatasetConflictError("Dataset ID already exists; import is create-only under contract v1.");
    }
    throw error;
  }
  return { dataset, snapshotId, imported: { institutions: data.institutions.length, accounts: data.accounts.length,
    instruments: data.instruments.length, sourceRecords: data.sourceRecords.length, obligations: data.obligations.length,
    dependencies: data.dependencies.length }, auditEventId };
}

export async function getImportedDataset(datasetId: string): Promise<DatasetSource | null> {
  const database = await getDatabase();
  const record = database.prepare("SELECT revision, payload FROM imported_datasets WHERE id = ?").get(datasetId) as { revision: string; payload: string } | undefined;
  if (!record) return null;
  const content = JSON.parse(record.payload) as Pick<DatasetSource, "dataset" | "institutions" | "accounts" | "instruments" | "sourceRecords" | "dependencies">;
  const snapshotRecord = database.prepare("SELECT payload FROM financial_snapshots WHERE dataset_id = ? AND dataset_revision = ?").get(datasetId, record.revision) as { payload: string } | undefined;
  if (!snapshotRecord) throw new Error(`No snapshot for dataset ${datasetId} revision ${record.revision}`);
  const auditRecords = database.prepare("SELECT payload FROM dataset_audit_events WHERE dataset_id = ? ORDER BY rowid DESC").all(datasetId) as { payload: string }[];
  return { ...content, snapshot: JSON.parse(snapshotRecord.payload) as FinancialSnapshot,
    auditEvents: auditRecords.map(event => JSON.parse(event.payload) as AuditEvent) };
}
