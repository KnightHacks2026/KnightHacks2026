import { z } from "zod";
import { CONTRACT_VERSION, type ImportDatasetRequest, type ValidationIssue } from "@/contracts";

const id = z.string().min(1);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const signedDecimal = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const dateTime = z.iso.datetime({ offset: false });
const currency = z.string().regex(/^[A-Z]{3}$/);
const money = z.strictObject({ currency, minorUnits: signedDecimal });
const quantity = z.strictObject({ instrumentId: id, units: signedDecimal });
const owned = { id, datasetId: id };

export const importSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  dataset: z.strictObject({ id, name: z.string().min(1), asOf: dateTime, contractVersion: z.literal(CONTRACT_VERSION) }),
  institutions: z.array(z.strictObject({ ...owned, name: z.string().min(1), externalId: id.optional(), role: z.enum(["custodian", "client", "counterparty"]) })),
  accounts: z.array(z.strictObject({ ...owned, institutionId: id, externalId: id, name: z.string().min(1), kind: z.enum(["cash", "securities", "omnibus"]), status: z.enum(["open", "restricted", "closed"]) })),
  instruments: z.array(z.strictObject({ ...owned, symbol: id, name: z.string().min(1), assetClass: z.enum(["equity", "fixed_income", "fund", "other"]), quantityScale: z.number().int().min(0), identifiers: z.strictObject({ isin: id.optional(), cusip: id.optional() }) })),
  sourceRecords: z.array(z.strictObject({ ...owned, sourceSystem: id, externalId: id, kind: z.enum(["trade", "cash_movement", "position", "settlement", "other"]), occurredAt: dateTime, receivedAt: dateTime, accountId: id.optional(), amount: money.optional(), quantity: quantity.optional(), attributes: z.record(z.string(), z.json()) })),
  obligations: z.array(z.strictObject({ ...owned, externalId: id, fromAccountId: id, toAccountId: id, asset: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("cash"), currency }), z.strictObject({ kind: z.literal("security"), instrumentId: id })]), requiredUnits: decimal, settledUnits: decimal, dueAt: dateTime, status: z.enum(["pending", "at_risk", "blocked", "settled", "cancelled"]), sourceRecordIds: z.array(id) })),
  dependencies: z.array(z.strictObject({ ...owned, predecessorObligationId: id, successorObligationId: id, kind: z.enum(["settlement_proceeds", "inventory_release", "operational"]) })),
  initialCashBalances: z.array(z.strictObject({ accountId: id, currency, settledMinorUnits: decimal, reservedMinorUnits: decimal })),
  initialSecuritiesBalances: z.array(z.strictObject({ accountId: id, instrumentId: id, settledUnits: decimal, reservedUnits: decimal })),
});

export function validateImport(input: unknown): { data?: ImportDatasetRequest; issues: ValidationIssue[] } {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { issues: parsed.error.issues.map(issue => ({ code: "INVALID_FIELD", message: issue.message, field: issue.path.join(".") })) };
  const data = parsed.data as ImportDatasetRequest;
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, field: string, entityId?: string) => issues.push({ code, message, field, ...(entityId ? { entityId } : {}) });
  const datasetId = data.dataset.id;
  const unique = <T extends { id: string; datasetId: string }>(items: T[], field: string) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) add("DUPLICATE_ID", `Duplicate ${field} ID ${item.id}.`, `${field}.${index}.id`, item.id);
      if (item.datasetId !== datasetId) add("DATASET_MISMATCH", `${field} belongs to another dataset.`, `${field}.${index}.datasetId`, item.id);
      seen.add(item.id);
    }
    return seen;
  };
  const institutions = unique(data.institutions, "institutions");
  const accounts = unique(data.accounts, "accounts");
  const accountById = new Map(data.accounts.map(account => [account.id, account]));
  const instruments = unique(data.instruments, "instruments");
  const sources = unique(data.sourceRecords, "sourceRecords");
  const obligations = unique(data.obligations, "obligations");
  unique(data.dependencies, "dependencies");
  const check = (known: Set<string>, reference: string, field: string, entityId?: string) => {
    if (!known.has(reference)) add("MISSING_REFERENCE", `Unknown reference ${reference}.`, field, entityId);
  };
  const sourceKeys = new Set<string>();
  const accountExternalKeys = new Set<string>();
  for (const [index, account] of data.accounts.entries()) {
    check(institutions, account.institutionId, `accounts.${index}.institutionId`, account.id);
    const key = JSON.stringify([account.institutionId, account.externalId]);
    if (accountExternalKeys.has(key)) add("DUPLICATE_EXTERNAL_ID", `Duplicate account external ID ${account.externalId} within institution ${account.institutionId}.`, `accounts.${index}.externalId`, account.id);
    accountExternalKeys.add(key);
  }
  for (const [index, source] of data.sourceRecords.entries()) {
    const key = JSON.stringify([source.sourceSystem, source.externalId]);
    if (sourceKeys.has(key)) add("DUPLICATE_SOURCE", `Duplicate source identity ${source.sourceSystem}/${source.externalId}.`, `sourceRecords.${index}.externalId`, source.id);
    sourceKeys.add(key);
    if (Date.parse(source.occurredAt) > Date.parse(source.receivedAt) || Date.parse(source.receivedAt) > Date.parse(data.dataset.asOf)) {
      add("INVALID_SOURCE_TIME", "Source event and receipt must occur no later than snapshot asOf.", `sourceRecords.${index}.receivedAt`, source.id);
    }
    if (source.accountId) check(accounts, source.accountId, `sourceRecords.${index}.accountId`, source.id);
    const account = source.accountId ? accountById.get(source.accountId) : undefined;
    if (account && ((source.amount && account.kind === "securities") || (source.quantity && account.kind === "cash"))) {
      add("ACCOUNT_POLICY", `Source ${source.id} uses an asset unsupported by account ${account.id}.`, `sourceRecords.${index}.accountId`, source.id);
    }
    if (source.quantity) check(instruments, source.quantity.instrumentId, `sourceRecords.${index}.quantity.instrumentId`, source.id);
    if (source.amount && BigInt(source.amount.minorUnits) < 0n) add("INVALID_UNITS", "Negative source cash is not supported by custody assessment.", `sourceRecords.${index}.amount.minorUnits`, source.id);
    if (source.quantity && BigInt(source.quantity.units) < 0n) add("INVALID_UNITS", "Negative source quantity is not supported by custody assessment.", `sourceRecords.${index}.quantity.units`, source.id);
  }
  const externalIds = new Set<string>();
  for (const [index, obligation] of data.obligations.entries()) {
    if (externalIds.has(obligation.externalId)) add("DUPLICATE_EXTERNAL_ID", `Duplicate obligation external ID ${obligation.externalId}.`, `obligations.${index}.externalId`, obligation.id);
    externalIds.add(obligation.externalId);
    check(accounts, obligation.fromAccountId, `obligations.${index}.fromAccountId`, obligation.id);
    check(accounts, obligation.toAccountId, `obligations.${index}.toAccountId`, obligation.id);
    if (obligation.fromAccountId === obligation.toAccountId) add("INVALID_REFERENCE", "Obligation endpoints must differ.", `obligations.${index}.toAccountId`, obligation.id);
    if (obligation.asset.kind === "security") check(instruments, obligation.asset.instrumentId, `obligations.${index}.asset.instrumentId`, obligation.id);
    for (const accountId of [obligation.fromAccountId, obligation.toAccountId]) {
      const account = accountById.get(accountId);
      if (account && (account.status !== "open" || (obligation.asset.kind === "cash" && account.kind === "securities") || (obligation.asset.kind === "security" && account.kind === "cash"))) {
        add("ACCOUNT_POLICY", `Account ${accountId} cannot settle this asset.`, `obligations.${index}`, obligation.id);
      }
    }
    obligation.sourceRecordIds.forEach((sourceId, sourceIndex) => check(sources, sourceId, `obligations.${index}.sourceRecordIds.${sourceIndex}`, obligation.id));
    if (new Set(obligation.sourceRecordIds).size !== obligation.sourceRecordIds.length) add("DUPLICATE_REFERENCE", "Duplicate source reference.", `obligations.${index}.sourceRecordIds`, obligation.id);
    if (BigInt(obligation.settledUnits) > BigInt(obligation.requiredUnits)) add("INVALID_UNITS", "Settled units exceed required units.", `obligations.${index}.settledUnits`, obligation.id);
    if (obligation.status === "settled" && obligation.settledUnits !== obligation.requiredUnits) add("INVALID_STATUS", "Settled obligation must be fully settled.", `obligations.${index}.status`, obligation.id);
    if (obligation.status !== "settled" && obligation.status !== "cancelled" && obligation.settledUnits === obligation.requiredUnits) add("INVALID_STATUS", "Fully settled obligation must have settled status.", `obligations.${index}.status`, obligation.id);
    if (obligation.status === "cancelled" && obligation.settledUnits !== "0") add("INVALID_STATUS", "Cancelled obligation cannot have settled units.", `obligations.${index}.settledUnits`, obligation.id);
  }
  const predecessors = new Map(data.obligations.map(obligation => [obligation.id, [] as string[]]));
  for (const [index, dependency] of data.dependencies.entries()) {
    check(obligations, dependency.predecessorObligationId, `dependencies.${index}.predecessorObligationId`, dependency.id);
    check(obligations, dependency.successorObligationId, `dependencies.${index}.successorObligationId`, dependency.id);
    predecessors.get(dependency.successorObligationId)?.push(dependency.predecessorObligationId);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const predecessor of predecessors.get(node) ?? []) if (visit(predecessor)) return true;
    visiting.delete(node); visited.add(node); return false;
  };
  if ([...predecessors.keys()].some(visit)) add("DEPENDENCY_CYCLE", "Dependencies must be acyclic.", "dependencies");
  const cashKeys = new Set<string>(), securityKeys = new Set<string>();
  for (const [index, balance] of data.initialCashBalances.entries()) {
    check(accounts, balance.accountId, `initialCashBalances.${index}.accountId`);
    if (accountById.get(balance.accountId)?.kind === "securities") add("ACCOUNT_POLICY", "Cash balance belongs to a securities-only account.", `initialCashBalances.${index}.accountId`);
    const key = JSON.stringify([balance.accountId, balance.currency]);
    if (cashKeys.has(key)) add("DUPLICATE_BALANCE", "Duplicate cash balance.", `initialCashBalances.${index}`);
    cashKeys.add(key);
    if (BigInt(balance.reservedMinorUnits) > BigInt(balance.settledMinorUnits)) add("INVALID_BALANCE", "Cash reservation exceeds settled balance.", `initialCashBalances.${index}.reservedMinorUnits`);
  }
  for (const [index, balance] of data.initialSecuritiesBalances.entries()) {
    check(accounts, balance.accountId, `initialSecuritiesBalances.${index}.accountId`);
    if (accountById.get(balance.accountId)?.kind === "cash") add("ACCOUNT_POLICY", "Securities balance belongs to a cash-only account.", `initialSecuritiesBalances.${index}.accountId`);
    check(instruments, balance.instrumentId, `initialSecuritiesBalances.${index}.instrumentId`);
    const key = JSON.stringify([balance.accountId, balance.instrumentId]);
    if (securityKeys.has(key)) add("DUPLICATE_BALANCE", "Duplicate securities balance.", `initialSecuritiesBalances.${index}`);
    securityKeys.add(key);
    if (BigInt(balance.reservedUnits) > BigInt(balance.settledUnits)) add("INVALID_BALANCE", "Securities reservation exceeds settled balance.", `initialSecuritiesBalances.${index}.reservedUnits`);
  }
  return { data, issues };
}
