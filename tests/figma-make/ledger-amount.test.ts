import { describe, expect, it } from "vitest";
import { formatLedgerAmount } from "../../src/features/figma-make/ledger-amount";

describe("ledger amount display", () => {
  it.each([
    ["200000000 ETH", "ETH", "200,000,000"],
    ["2000000 BTC", "BTC", "2,000,000"],
    ["2000000000 BTC", "BTC", "2,000,000,000"],
    ["24800000 USDC", "USDC", "24,800,000"],
    ["24,800,000 USDC", "USDC", "24,800,000"],
    ["128.42 BTC", "BTC", "128.42"],
    ["4806.15000000 ETH", "ETH", "4,806.15000000"],
    ["0.000000000000000001 BTC", "BTC", "0.000000000000000001"],
    ["BTC 2000000", "BTC", "2,000,000"],
  ])("formats %s for %s as %s", (stored, asset, display) => {
    expect(formatLedgerAmount(stored, asset)).toBe(display);
  });
});
