import { formatTransferAmount } from "./transfer-amount";

/** Format a ledger amount for display without changing the stored amount. */
export function formatLedgerAmount(amount: string, asset: string): string {
  const symbol = asset.trim();
  let numericAmount = amount.trim();

  if (symbol) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    numericAmount = numericAmount
      .replace(new RegExp(`^${escapedSymbol}\\s+`, "i"), "")
      .replace(new RegExp(`\\s+${escapedSymbol}$`, "i"), "");
  }

  return formatTransferAmount(numericAmount);
}
