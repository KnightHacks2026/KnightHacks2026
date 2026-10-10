import { describe, expect, it } from "vitest";
import { cascadeImport, cascadeSnapshot } from "../../src/contracts/fixtures";
import { assessCustody, CustodyValidationError, type CustodyInput } from "../../src/lib/custody";
import { GET } from "../../src/app/api/datasets/[datasetId]/custody/route";

const input = (): CustodyInput => ({ snapshot: structuredClone(cascadeSnapshot), accounts: structuredClone(cascadeImport.accounts), instruments: structuredClone(cascadeImport.instruments), sourceRecords: structuredClone(cascadeImport.sourceRecords), dependencies: structuredClone(cascadeImport.dependencies) });
const sum = (values: { settledMinorUnits: string }[]) => values.reduce((total, b) => total + BigInt(b.settledMinorUnits), 0n);

describe("custody assessment", () => {
  it("reports the cascade without changing balances and repeats exactly", () => {
    const before = input();
    const first = assessCustody(before), second = assessCustody(before);
    expect(second).toEqual(first);
    expect(first.obligations.map(o => [o.status, o.reasonCodes])).toEqual([
      ["blocked", ["CASH_SHORTFALL"]], ["blocked", ["UPSTREAM_SETTLEMENT_BLOCKED"]], ["blocked", ["UPSTREAM_SETTLEMENT_BLOCKED"]],
    ]);
    expect(first.indicators.blockedCashMinorUnitsByCurrency.USD).toBe("30000");
    expect(sum(before.snapshot.cashBalances)).toBe(11000n);
    expect(sum(first.positions.cash)).toBe(11000n);
    expect(before.snapshot).toEqual(cascadeSnapshot);
  });

  it("finds ready and settled obligations without inventing settlement", () => {
    const data = input(); data.snapshot.cashBalances[0].settledMinorUnits = "10000"; data.snapshot.obligations[0].status = "pending";
    const result = assessCustody(data);
    expect(result.obligations[0].status).toBe("pending");
    expect(result.indicators.readyCount).toBe(1);
    data.snapshot.obligations[0].status = "settled"; data.snapshot.obligations[0].settledUnits = "10000";
    const after = assessCustody(data);
    expect(after.obligations[0].status).toBe("settled");
    expect(after.indicators.settledCount).toBe(1);
  });

  it("detects securities shortfall and mismatched source quantities", () => {
    const data = input();
    data.snapshot.obligations = [{ ...data.snapshot.obligations[0], id: "security-1", asset: { kind: "security", instrumentId: "instrument-demo" }, requiredUnits: "30", sourceRecordIds: ["source-1"] }];
    data.dependencies = [];
    data.accounts[1].kind = "omnibus";
    data.sourceRecords[0].amount = undefined;
    data.sourceRecords[0].quantity = { instrumentId: "instrument-demo", units: "29" };
    const result = assessCustody(data);
    expect(result.exceptions.map(e => e.reasonCode)).toEqual(["QUANTITY_MISMATCH", "SECURITIES_SHORTFALL"]);
    expect(result.indicators.blockedSecuritiesUnitsByInstrument["instrument-demo"]).toBe("30");
  });

  it("prevents two obligations from claiming the same available inventory", () => {
    const data = input(); data.dependencies = []; data.snapshot.obligations = data.snapshot.obligations.slice(0, 2);
    data.snapshot.cashBalances[0].settledMinorUnits = "10000";
    data.snapshot.obligations[0].status = "pending";
    data.snapshot.obligations[1].status = "pending";
    data.snapshot.obligations[1].fromAccountId = "acct-a";
    data.sourceRecords[1].accountId = "acct-a";
    const result = assessCustody(data);
    expect(result.obligations.map(o => o.status)).toEqual(["pending", "blocked"]);
    expect(result.indicators.readyCount).toBe(1);
  });

  it("prevents cumulative securities claims beyond one holding", () => {
    const data = input(); data.dependencies = [];
    data.snapshot.obligations = [
      { ...data.snapshot.obligations[0], id: "security-1", status: "pending", asset: { kind: "security", instrumentId: "instrument-demo" }, requiredUnits: "20", sourceRecordIds: ["source-1"] },
      { ...data.snapshot.obligations[1], id: "security-2", status: "pending", fromAccountId: "acct-a", toAccountId: "acct-b", asset: { kind: "security", instrumentId: "instrument-demo" }, requiredUnits: "20", sourceRecordIds: ["source-2"] },
    ];
    data.accounts[1].kind = "omnibus";
    data.sourceRecords[0].amount = undefined; data.sourceRecords[0].quantity = { instrumentId: "instrument-demo", units: "20" };
    data.sourceRecords[1].amount = undefined; data.sourceRecords[1].quantity = { instrumentId: "instrument-demo", units: "20" }; data.sourceRecords[1].accountId = "acct-a";
    const result = assessCustody(data);
    expect(result.obligations.map(o => o.status)).toEqual(["pending", "blocked"]);
    expect(result.indicators.readyCount).toBe(1);
    expect(data.snapshot.securitiesBalances[0].settledUnits).toBe("25");
  });

  it("requires opposite, consistent DvP legs", () => {
    const data = input(); data.dependencies = []; data.snapshot.obligations = [data.snapshot.obligations[0], { ...data.snapshot.obligations[1], id: "security-1", fromAccountId: "acct-b", toAccountId: "acct-a", asset: { kind: "security", instrumentId: "instrument-demo" }, requiredUnits: "25", sourceRecordIds: [] }];
    data.dvpPairs = [{ cashObligationId: "obligation-1", securityObligationId: "security-1" }];
    const result = assessCustody(data);
    expect(result.obligations.every(o => o.status === "blocked")).toBe(true);
    data.snapshot.obligations[0].status = "settled"; data.snapshot.obligations[0].settledUnits = "10000";
    expect(() => assessCustody(data)).toThrow(CustodyValidationError);
    data.snapshot.obligations[0].status = "cancelled"; data.snapshot.obligations[0].settledUnits = "0";
    expect(() => assessCustody(data)).toThrow(/Invalid DvP pair/);
  });

  it("never reports one DvP leg ready when its partner has a break", () => {
    const data = input(); data.dependencies = [];
    data.snapshot.cashBalances[0].settledMinorUnits = "10000";
    data.snapshot.obligations = [
      { ...data.snapshot.obligations[0], status: "pending" },
      { ...data.snapshot.obligations[1], id: "security-1", status: "pending", fromAccountId: "acct-b", toAccountId: "acct-a", asset: { kind: "security", instrumentId: "instrument-demo" }, requiredUnits: "25", sourceRecordIds: [] },
    ];
    data.dvpPairs = [{ cashObligationId: "obligation-1", securityObligationId: "security-1" }];
    const beforeCash = sum(data.snapshot.cashBalances);
    const beforeSecurities = data.snapshot.securitiesBalances[0].settledUnits;
    const result = assessCustody(data);
    expect(result.indicators.readyCount).toBe(0);
    expect(result.obligations.map(o => o.status)).toEqual(["blocked", "blocked"]);
    expect(result.obligations[0].reasonCodes).toContain("POSITION_CONFLICT");
    expect(sum(result.positions.cash)).toBe(beforeCash);
    expect(result.positions.securities[0].settledUnits).toBe(beforeSecurities);
  });

  it("blocks obligations on restricted accounts and marks overdue breaks failed", () => {
    const data = input();
    data.accounts[0].status = "restricted";
    data.snapshot.asOf = "2026-10-09T15:00:00Z";
    const result = assessCustody(data);
    expect(result.obligations[0].status).toBe("failed");
    expect(result.obligations[0].reasonCodes).toContain("POLICY_CONSTRAINT");
    expect(result.indicators.failedCount).toBe(3);
  });

  it("blocks a cash obligation on a securities-only account", () => {
    const data = input(); data.accounts[0].kind = "securities";
    expect(assessCustody(data).obligations[0].reasonCodes).toContain("POLICY_CONSTRAINT");
  });

  it("rejects missing references, invalid reservation, and inconsistent status", () => {
    const missing = input(); missing.snapshot.obligations[0].sourceRecordIds = ["missing"];
    expect(() => assessCustody(missing)).toThrow(/missing source/);
    const reserve = input(); reserve.snapshot.cashBalances[0].reservedMinorUnits = "9001";
    expect(() => assessCustody(reserve)).toThrow(/Reservations exceed/);
    const status = input(); status.snapshot.obligations[0].status = "settled";
    expect(() => assessCustody(status)).toThrow(/contradicts settled units/);
  });
});

describe("custody API", () => {
  const context = { params: Promise.resolve({ datasetId: "dataset-cascade" }) };
  it("returns assessed fixture data in the shared envelope", async () => {
    const response = await GET(new Request("http://localhost/api/datasets/dataset-cascade/custody"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.assessment.indicators.exceptionCount).toBe(3);
    expect(body.meta.datasetRevision).toBe("1");
  });
  it("returns explicit version and dataset errors", async () => {
    const version = await GET(new Request("http://localhost/api/datasets/dataset-cascade/custody?contractVersion=2.0.0"), context);
    expect((await version.json()).error.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
    const absent = await GET(new Request("http://localhost/api/datasets/unknown/custody"), { params: Promise.resolve({ datasetId: "unknown" }) });
    expect(absent.status).toBe(404);
    expect((await absent.json()).error.code).toBe("NOT_FOUND");
  });
});
