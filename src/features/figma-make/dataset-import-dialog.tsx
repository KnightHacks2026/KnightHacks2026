"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ImportDatasetRequest, ImportDatasetResponse } from "@/contracts";
import { cascadeImport } from "@/contracts/fixtures";

type ImportedDataset = Extract<ImportDatasetResponse, { ok: true }>['data'];

interface DatasetImportDialogProps {
  latestSnapshotAsOf: string | null;
  onClose: () => void;
  onImported: (result: ImportedDataset) => void;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function makeCascadeExample(latestSnapshotAsOf: string | null): ImportDatasetRequest {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const id = (value: string) => `${value}-${suffix}`;
  const latestKnownTime = latestSnapshotAsOf ? Date.parse(latestSnapshotAsOf) : 0;
  const asOf = new Date(Math.max(Date.now(), Number.isFinite(latestKnownTime) ? latestKnownTime : 0) + 60_000);
  const asOfIso = asOf.toISOString();
  const timestamp = (minutesFromAsOf: number) => new Date(asOf.getTime() + minutesFromAsOf * 60_000).toISOString();
  const ids = new Map<string, string>([
    [cascadeImport.dataset.id, `dataset-demo-${suffix}`],
    ...cascadeImport.institutions.map(row => [row.id, id(row.id)] as const),
    ...cascadeImport.accounts.map(row => [row.id, id(row.id)] as const),
    ...cascadeImport.instruments.map(row => [row.id, id(row.id)] as const),
    ...cascadeImport.sourceRecords.map(row => [row.id, id(row.id)] as const),
    ...cascadeImport.obligations.map(row => [row.id, id(row.id)] as const),
    ...cascadeImport.dependencies.map(row => [row.id, id(row.id)] as const),
  ]);
  const ref = (value: string) => ids.get(value) ?? value;

  return {
    contractVersion: cascadeImport.contractVersion,
    dataset: { ...cascadeImport.dataset, id: ref(cascadeImport.dataset.id), name: "Three-leg settlement cascade · synthetic", asOf: asOfIso },
    institutions: cascadeImport.institutions.map(row => ({ ...row, id: ref(row.id), datasetId: ref(row.datasetId) })),
    accounts: cascadeImport.accounts.map(row => ({ ...row, id: ref(row.id), datasetId: ref(row.datasetId), institutionId: ref(row.institutionId), externalId: id(row.externalId) })),
    instruments: cascadeImport.instruments.map(row => ({ ...row, id: ref(row.id), datasetId: ref(row.datasetId) })),
    sourceRecords: cascadeImport.sourceRecords.map((row, index) => ({ ...row, id: ref(row.id), datasetId: ref(row.datasetId), externalId: id(row.externalId), accountId: row.accountId ? ref(row.accountId) : undefined, occurredAt: timestamp(-60 + index * 2), receivedAt: timestamp(-59 + index * 2) })),
    obligations: cascadeImport.obligations.map((row, index) => ({ ...row, id: ref(row.id), datasetId: ref(row.datasetId), externalId: id(row.externalId), fromAccountId: ref(row.fromAccountId), toAccountId: ref(row.toAccountId), dueAt: timestamp(60 + index * 5), sourceRecordIds: row.sourceRecordIds.map(ref) })),
    dependencies: cascadeImport.dependencies.map(row => ({ ...row, id: ref(row.id), datasetId: ref(row.datasetId), predecessorObligationId: ref(row.predecessorObligationId), successorObligationId: ref(row.successorObligationId) })),
    initialCashBalances: cascadeImport.initialCashBalances.map(row => ({ ...row, accountId: ref(row.accountId) })),
    initialSecuritiesBalances: cascadeImport.initialSecuritiesBalances.map(row => ({ ...row, accountId: ref(row.accountId), instrumentId: ref(row.instrumentId) })),
  };
}

export function DatasetImportDialog({ latestSnapshotAsOf, onClose, onImported }: DatasetImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    fileRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0] ?? null;
    setError("");
    if (!selected) {
      setFile(null);
      return;
    }
    if (!selected.name.toLocaleLowerCase().endsWith(".json")) {
      setFile(null);
      setError("Choose a .json file using the CustodyOS import contract.");
      event.currentTarget.value = "";
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setFile(null);
      setError("Dataset file must be 2 MB or smaller.");
      event.currentTarget.value = "";
      return;
    }
    setFile(selected);
  }

  async function submit(payload: ImportDatasetRequest) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/datasets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as ImportDatasetResponse;
      if (!response.ok || !body.ok) {
        if (body.ok) throw new Error(`Import request failed (${response.status}).`);
        const details = body.error.validationIssues?.slice(0, 3).map(issue => `${issue.field}: ${issue.message}`).join(" ");
        throw new Error(details ? `${body.error.message} ${details}` : body.error.message);
      }
      onImported(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import this dataset. Check the file and try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function importFile() {
    if (!file) {
      setError("Choose a CustodyOS JSON dataset first.");
      return;
    }
    try {
      const content = JSON.parse(await file.text()) as unknown;
      await submit(content as ImportDatasetRequest);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "The selected file is not valid JSON." : cause instanceof Error ? cause.message : "Unable to read this file.");
    }
  }

  return <div className="transfer-overlay dataset-import-overlay" onMouseDown={() => { if (!submittingRef.current) onClose(); }}>
    <section className="transfer-dialog dataset-import-dialog" role="dialog" aria-modal="true" aria-labelledby="dataset-import-title" onMouseDown={event => event.stopPropagation()}>
      <div className="transfer-dialog-head">
        <div><p className="eyebrow">WORKSPACE / DATA</p><h2 id="dataset-import-title">Import dataset</h2></div>
        <button type="button" className="transfer-close" aria-label="Close dataset import" disabled={submitting} onClick={onClose}>×</button>
      </div>
      <p className="transfer-explainer">Load a normalized CustodyOS dataset to update this workspace and its dashboard metrics.</p>
      <div className="dataset-import-format"><strong>Accepted format</strong><span>JSON · contract v1.0.0</span><small>SQLite files need to be converted to the CustodyOS JSON contract before import.</small></div>
      <label className="dataset-import-label" htmlFor="dataset-import-file">Dataset file</label>
      <input ref={fileRef} id="dataset-import-file" className="dataset-import-file" type="file" accept=".json,application/json" onChange={selectFile} disabled={submitting} />
      <p className="dataset-import-file-name">{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "No file selected · maximum 2 MB"}</p>
      {error && <p className="transfer-error" role="alert">{error}</p>}
      <div className="transfer-actions dataset-import-actions">
        <button type="button" className="button secondary" disabled={submitting} onClick={onClose}>Cancel</button>
        <button type="button" className="button secondary" disabled={submitting} onClick={() => void submit(makeCascadeExample(latestSnapshotAsOf))}>{submitting ? "Importing…" : "Load synthetic example"}</button>
        <button type="button" className="button primary" disabled={submitting || !file} onClick={() => void importFile()}>{submitting ? "Importing…" : "Import JSON"}</button>
      </div>
    </section>
  </div>;
}
