"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CONTRACT_VERSION, type CreateTransferResponse, type ExampleAsset, type ExampleTransaction } from "@/contracts";
import { formatTransferAmount, normalizeTransferAmount, transferAmountCaret } from "./transfer-amount";

interface TransferDialogProps {
  assets: ExampleAsset[];
  onClose: () => void;
  onCreated: (transaction: ExampleTransaction) => void;
}

export function TransferDialog({ assets, onClose, onCreated }: TransferDialogProps) {
  const [source, setSource] = useState("");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const sourceRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const transferableAssets = assets.filter(asset => asset.symbol !== "OTHER");

  useEffect(() => {
    sourceRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && amountRef.current === document.activeElement) {
      amountRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  }, [amount]);

  function changeAmount(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    let value = input.value;
    let caret = input.selectionStart ?? value.length;
    const inputType = (event.nativeEvent as InputEvent).inputType;

    // Removing a separator alone would immediately reinsert it. Remove the adjacent digit instead.
    if (inputType === "deleteContentBackward" && amount[caret] === "," && value === amount.slice(0, caret) + amount.slice(caret + 1)) {
      value = value.slice(0, caret - 1) + value.slice(caret);
      caret -= 1;
    } else if (inputType === "deleteContentForward" && amount[caret] === "," && value === amount.slice(0, caret) + amount.slice(caret + 1)) {
      value = value.slice(0, caret) + value.slice(caret + 1);
    }

    const significantBeforeCaret = value.slice(0, caret).replaceAll(",", "").length;
    const isDigitEdit = inputType === "deleteContentBackward" || inputType === "deleteContentForward"
      || (inputType === "insertText" && /^\d$/.test((event.nativeEvent as InputEvent).data ?? ""));
    const editablePlain = isDigitEdit && /^\d+(?:\.\d*)?$/.test(amount.replaceAll(",", ""))
      && formatTransferAmount(amount.replaceAll(",", "")) === amount
      && (value.match(/,/g)?.length ?? 0) <= (amount.match(/,/g)?.length ?? 0)
      ? value.replaceAll(",", "") : value;
    const formatted = formatTransferAmount(editablePlain);
    pendingCaret.current = transferAmountCaret(formatted, significantBeforeCaret);
    setAmount(formatted);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    const asset = transferableAssets.find(item => item.symbol === source);
    const normalizedAmount = normalizeTransferAmount(amount);
    const normalizedDestination = destination.trim();
    if (!asset) return setError("Choose a source asset from the demo inventory.");
    if (normalizedAmount === null) {
      return setError("Enter an amount greater than zero using digits and an optional decimal point.");
    }
    if (!normalizedDestination || normalizedDestination.length > 128) {
      return setError("Enter a destination of 1 to 128 characters.");
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch("/api/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          userId: "demo-user",
          assetType: asset.symbol,
          assetAmount: normalizedAmount,
          assetSource: asset.symbol,
          // The existing v1 endpoint names this field senderName; it stores the destination label.
          senderName: normalizedDestination,
        }),
      });
      const body = await response.json() as CreateTransferResponse;
      if (!response.ok || !body.ok) throw new Error(body.ok ? `Request failed (${response.status}).` : body.error.message);
      if (!body.data.transaction?.id || body.data.transaction.status !== "Pending approval") {
        throw new Error("The transfer service returned an unexpected transaction.");
      }
      onCreated(body.data.transaction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the transfer request. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return <div className="transfer-overlay" onMouseDown={() => { if (!submittingRef.current) onClose(); }}>
    <section className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title" onMouseDown={event => event.stopPropagation()}>
      <div className="transfer-dialog-head">
        <div><p className="eyebrow">TRANSACTIONS / NEW REQUEST</p><h2 id="transfer-title">New transfer</h2></div>
        <button type="button" className="transfer-close" aria-label="Close transfer form" disabled={submitting} onClick={onClose}>×</button>
      </div>
      <p className="transfer-explainer">Create a request for approval. No assets move and balances stay unchanged.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="transfer-source">Source asset</label>
        <select id="transfer-source" ref={sourceRef} value={source} onChange={event => setSource(event.target.value)} disabled={submitting} required>
          <option value="">Select an asset</option>
          {transferableAssets.map(asset => <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {asset.name}</option>)}
        </select>
        <label htmlFor="transfer-amount">Amount</label>
        <input id="transfer-amount" ref={amountRef} inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={changeAmount} disabled={submitting} required />
        <label htmlFor="transfer-destination">Destination</label>
        <input id="transfer-destination" autoComplete="off" maxLength={128} placeholder="Institution or account label" value={destination} onChange={event => setDestination(event.target.value)} disabled={submitting} required />
        <p className="transfer-hint">Demo request only · Pending approval after submission. Use Demo Treasury for the synthetic approvable route.</p>
        {error && <p className="transfer-error" role="alert">{error}</p>}
        <div className="transfer-actions">
          <button type="button" className="button secondary" disabled={submitting} onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={submitting || transferableAssets.length === 0}>{submitting ? "Submitting…" : "Submit request"}</button>
        </div>
      </form>
    </section>
  </div>;
}
