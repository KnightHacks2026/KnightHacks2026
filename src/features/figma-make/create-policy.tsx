"use client";

import { useState, type FormEvent } from "react";
import type { ExamplePolicy } from "@/contracts";

export function CreatePolicy({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: (policy: ExamplePolicy) => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [rule, setRule] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ([name, scope, rule].some(value => value.trim().length < 3)) {
      setError("Name, scope, and rule description must each contain at least 3 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/policies`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), scope: scope.trim(), rule: rule.trim() }),
      });
      const result = await response.json() as { ok: true; data: ExamplePolicy } | { ok: false; error: { message: string } };
      if (!response.ok || !result.ok) throw new Error(result.ok ? "Unable to save policy." : result.error.message);
      onCreated(result.data);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save policy. Try again.");
    } finally { setSaving(false); }
  };
  return <div className="topology-overlay" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="topology-panel create-policy" role="dialog" aria-modal="true" aria-label="Create policy">
      <header className="topology-panel__head"><div><p className="eyebrow">POLICY ENGINE / LIBRARY</p><h2>Create Policy</h2></div><button type="button" className="button secondary" onClick={onClose}>Close</button></header>
      <p className="topology-panel__note">Created policies are saved as drafts in your policy library. The transfer review engine does not evaluate library drafts; entering a rule here does not authorize or block a transfer.</p>
      <form onSubmit={submit} noValidate>
        <label>Policy name<input autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Treasury withdrawal review" /></label>
        <label>Scope description<input maxLength={120} value={scope} onChange={event => setScope(event.target.value)} placeholder="e.g. Treasury wallet requests" /></label>
        <label>Rule description<textarea maxLength={240} value={rule} onChange={event => setRule(event.target.value)} placeholder="Describe the proposed control for human review" /></label>
        {error && <p className="create-policy__error" role="alert">{error}</p>}
        <div className="create-policy__actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save draft policy"}</button></div>
      </form>
    </section>
  </div>;
}
