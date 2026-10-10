import { describe, expect, it } from "vitest";
import { formatTransferAmount, normalizeTransferAmount, transferAmountCaret } from "../../src/features/figma-make/transfer-amount";

describe("transfer amount display and submission", () => {
  it.each([
    ["1000", "1,000", "1000"],
    ["2000000000", "2,000,000,000", "2000000000"],
    ["2,000,000,000", "2,000,000,000", "2000000000"],
    ["1234567.89", "1,234,567.89", "1234567.89"],
    ["0.00000001", "0.00000001", "0.00000001"],
  ])("formats %s without changing its submitted value", (raw, display, submitted) => {
    expect(formatTransferAmount(raw)).toBe(display);
    expect(normalizeTransferAmount(display)).toBe(submitted);
  });

  it.each(["", "0", "0.00", "-1", "1e3", "1,2", "12,34", "1,,000", "1.2.3", "1.", "1x000"])("rejects %s", value => {
    expect(normalizeTransferAmount(value)).toBeNull();
  });

  it("keeps the caret aligned to digits across inserted separators", () => {
    expect(transferAmountCaret("1,000", 1)).toBe(1);
    expect(transferAmountCaret("1,000", 2)).toBe(3);
    expect(transferAmountCaret("2,000,000,000", 10)).toBe(13);
  });
});
