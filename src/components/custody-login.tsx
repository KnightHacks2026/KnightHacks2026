"use client";

import { sha256 } from "js-sha256";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cascadeImport } from "../contracts/fixtures/twin-cascade";
import styles from "./custody-login.module.css";

const accounts = new Map(cascadeImport.accounts.map((account) => [account.id, account.name]));
const obligations = cascadeImport.obligations;
const firstLeg = obligations[0];
const originCash = cascadeImport.initialCashBalances.find((balance) => balance.accountId === firstLeg.fromAccountId);
const reserveCash = cascadeImport.initialCashBalances.find((balance) => balance.accountId === "acct-reserve");
const originSettled = BigInt(originCash?.settledMinorUnits ?? "0");
const originReserved = BigInt(originCash?.reservedMinorUnits ?? "0");
const available = originSettled > originReserved ? originSettled - originReserved : 0n;
const required = BigInt(firstLeg.requiredUnits);
const reserveSettled = BigInt(reserveCash?.settledMinorUnits ?? "0");
const reserveReserved = BigInt(reserveCash?.reservedMinorUnits ?? "0");
const reserve = reserveSettled > reserveReserved ? reserveSettled - reserveReserved : 0n;
const shortfall = required > available ? required - available : 0n;
const rawCoverage = required > 0n ? (available * 100n) / required : 0n;
const coverage = Number(rawCoverage > 100n ? 100n : rawCoverage);
const leadMinutes = Math.round((Date.parse(firstLeg.dueAt) - Date.parse(cascadeImport.dataset.asOf)) / 60_000);
const dollars = (minorUnits: bigint) => {
  const whole = minorUnits / 100n;
  const cents = minorUnits % 100n;
  return `$${whole}${cents ? `.${cents.toString().padStart(2, "0")}` : ""}`;
};
const previewEmail = "analyst@institution.com";
const previewPassword = "********";

type RegistrationStep = "login" | "details" | "mfa";

export default function CustodyLogin() {
  const router = useRouter();
  const [activeLeg, setActiveLeg] = useState(0);
  const [emailPreview, setEmailPreview] = useState("");
  const [passwordPreview, setPasswordPreview] = useState("");
  const [previewPaused, setPreviewPaused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [registrationStep, setRegistrationStep] = useState<RegistrationStep>("login");
  const [manualCodeVisible, setManualCodeVisible] = useState(false);
  const [registrationNotice, setRegistrationNotice] = useState("");

  useEffect(() => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionPreference.matches) return;
    const timer = window.setInterval(() => setActiveLeg((current) => (current + 1) % obligations.length), 2400);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (previewPaused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEmailPreview(previewEmail);
      setPasswordPreview(previewPassword);
      return;
    }

    let step = 0;
    const betweenFields = 5;
    const typingEnd = previewEmail.length + betweenFields + previewPassword.length;
    const holdEnd = typingEnd + 55;
    const cycleEnd = holdEnd + 8;
    const timer = window.setInterval(() => {
      step = (step + 1) % cycleEnd;
      if (step <= previewEmail.length) {
        setEmailPreview(previewEmail.slice(0, step));
        if (step === 0) setPasswordPreview("");
      } else if (step > previewEmail.length + betweenFields && step <= typingEnd) {
        setPasswordPreview(previewPassword.slice(0, step - previewEmail.length - betweenFields));
      } else if (step === holdEnd + 1) {
        setEmailPreview("");
        setPasswordPreview("");
      }
    }, 105);
    return () => window.clearInterval(timer);
  }, [previewPaused]);

  return (
    <main className={styles.screen}>
      <section className={styles.access} aria-labelledby="access-title">
        <header className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true"><span /><span /><span /><span /></span>
          <span className={styles.brandName}>CUSTODY</span>
          <span className={styles.brandOs}>OS</span>
        </header>

        {registrationStep === "login" && (
          <div className={styles.accessBody}>
            <p className={styles.kicker}>CUSTODY OPERATIONS</p>
            <h1 id="access-title">Sign in to<br />CustodyOS.</h1>
            <p className={styles.intro}>Review settlement risk and funding options in one workspace.</p>

            <form
              className={styles.loginForm}
              autoComplete="off"
              onFocusCapture={() => setPreviewPaused(true)}
              onSubmit={async (event) => {
                event.preventDefault();
                if (isSubmitting) return;

                const formData = new FormData(event.currentTarget);
                const username = String(formData.get("username") ?? "").trim();
                const password = String(formData.get("password") ?? "");
                const otpCode = String(formData.get("otp") ?? "");

                setIsSubmitting(true);
                setLoginError("");
                try {
                  const response = await fetch("/api/users/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password: sha256(password), otpCode }),
                  });
                  const result: unknown = await response.json();
                  if (!response.ok) {
                    setLoginError("Invalid username, password, or one-time password.");
                    return;
                  }
                  if (
                    typeof result !== "object" ||
                    result === null ||
                    !("ok" in result) ||
                    result.ok !== true ||
                    !("data" in result) ||
                    typeof result.data !== "object" ||
                    result.data === null ||
                    !("userId" in result.data) ||
                    typeof result.data.userId !== "string"
                  ) {
                    throw new Error("Login endpoint returned an invalid response.");
                  }
                  window.sessionStorage.setItem("userid", result.data.userId);
                  router.push("/");
                } catch {
                  setLoginError("Unable to sign in right now. Please try again.");
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              <label className={styles.field}>
                <span>WORK EMAIL</span>
                <input type="text" name="username" autoComplete="username" placeholder={previewPaused ? "name@institution.com" : emailPreview} required />
              </label>
              <label className={styles.field}>
                <span>PASSWORD</span>
                <input type="password" name="password" autoComplete="current-password" placeholder={previewPaused ? "Enter a sample password" : passwordPreview} required />
              </label>
              <label className={styles.field}>
                <span>ONE TIME PASSWORD</span>
                <input type="text" name="otp" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
              </label>
              {loginError && <p className={styles.loginError} role="alert">{loginError}</p>}
              <button className={styles.enterButton} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in…" : "Log in"} <span aria-hidden="true">→</span>
              </button>
            </form>

            <button className={styles.signupButton} type="button" onClick={() => setRegistrationStep("details")}>
              Sign up
            </button>
          </div>
        )}

        {registrationStep === "details" && (
          <div className={styles.accessBody}>
            <p className={styles.kicker}>CUSTODY OPERATIONS</p>
            <h1 id="access-title">Welcome to<br />CustodyOS!</h1>
            <p className={styles.intro}>Create your account to get ahead of settlement risk.</p>

            <form
              className={`${styles.loginForm} ${styles.registrationForm}`}
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault();
                setManualCodeVisible(false);
                setRegistrationNotice("");
                setRegistrationStep("mfa");
              }}
            >
              <label className={styles.field}>
                <span>WORK EMAIL</span>
                <input type="email" name="registration-email" autoComplete="email" placeholder="name@institution.com" required />
              </label>
              <label className={styles.field}>
                <span>PASSWORD</span>
                <input type="password" name="registration-password" autoComplete="new-password" placeholder="Enter a sample password" minLength={8} required />
              </label>
              <button className={styles.enterButton} type="submit">
                Sign up <span aria-hidden="true">→</span>
              </button>
            </form>

            <button className={`${styles.signupButton} ${styles.registrationBack}`} type="button" onClick={() => setRegistrationStep("login")}>
              Go back
            </button>
          </div>
        )}

        {registrationStep === "mfa" && (
          <div className={styles.mfaBody}>
            <h1 id="access-title">Register MFA</h1>
            <div className={styles.mfaCard}>
              <div className={styles.qrSection}>
                <img
                  className={styles.qrImage}
                  src="/images/custodyos-register-qr.png"
                  width="251"
                  height="251"
                  alt="Sample authenticator QR code for visual preview only"
                />
                <button
                  className={styles.manualCodeButton}
                  type="button"
                  aria-expanded={manualCodeVisible}
                  onClick={() => setManualCodeVisible((visible) => !visible)}
                >
                  {manualCodeVisible ? "Hide manual code" : "Show manual code"}
                </button>
                {manualCodeVisible && (
                  <p className={styles.manualCodeNote}>
                    Manual setup is unavailable in this visual-only preview.
                  </p>
                )}
              </div>

              <form
                className={styles.mfaForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  setRegistrationNotice("This visual preview is not connected to account creation. No account was created.");
                }}
              >
                <label className={styles.field}>
                  <span>ONE TIME PASSWORD</span>
                  <input
                    type="text"
                    name="registration-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123-456"
                    pattern="[0-9]{3}-?[0-9]{3}"
                    maxLength={7}
                    required
                  />
                </label>
                <button className={`${styles.enterButton} ${styles.mfaSubmit}`} type="submit">
                  Submit
                </button>
                {registrationNotice && <p className={styles.mfaNotice} role="status">{registrationNotice}</p>}
              </form>
            </div>
            <p className={styles.mfaPreviewNote}>
              Visual preview only; no account or MFA setup is created.
            </p>
            <button className={styles.mfaBack} type="button" onClick={() => setRegistrationStep("details")}>
              Back to account details
            </button>
          </div>
        )}
      </section>

      <section className={styles.stage} aria-label="Synthetic settlement case preview">
        <div className={styles.stageTitle}>
          <h2>One cash shortfall.<br />Three blocked settlements.</h2>
          <span>Origin cannot meet its first obligation. The next two depend on it.</span>
          <div className={styles.timeCue}>
            <span>FIRST OBLIGATION DUE IN</span>
            <strong>{leadMinutes} MIN</strong>
          </div>
        </div>

        <div className={styles.caseGrid}>
          <section className={styles.chainPanel} aria-labelledby="chain-title">
            <header className={styles.panelHead}>
              <h3 id="chain-title">Settlement dependency chain</h3>
              <span aria-hidden="true">REPLAY {String(activeLeg + 1).padStart(2, "0")} / {String(obligations.length).padStart(2, "0")}</span>
            </header>
            <div className={styles.chainBody}>
              <div className={styles.rail} aria-hidden="true" />
              {obligations.map((obligation, index) => (
                <div className={`${styles.leg} ${activeLeg === index ? styles.activeLeg : ""}`} key={obligation.id}>
                  <div className={styles.legTop}>
                    <span>LEG {String(index + 1).padStart(2, "0")}</span>
                    <span>DUE {obligation.dueAt.slice(11, 16)} UTC</span>
                  </div>
                  <div className={styles.legRoute}>
                    {accounts.get(obligation.fromAccountId)} <span aria-hidden="true">→</span> {accounts.get(obligation.toAccountId)}
                  </div>
                  <div className={styles.legStatus}>
                    <span>{dollars(BigInt(obligation.requiredUnits))} USD</span>
                    <span>{index === 0 ? "ROOT CASH SHORTFALL" : "UPSTREAM BLOCK"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.fundingPanel} aria-labelledby="funding-title">
            <header className={styles.panelHead}>
              <h3 id="funding-title">Origin funding</h3>
              <span>BASELINE</span>
            </header>
            <div className={styles.fundingValue}>
              <strong>{dollars(available)}</strong>
              <span>of {dollars(required)} due</span>
            </div>
            <div className={styles.fundingBar} role="img" aria-label={`${coverage}% funded`}>
              <span className={styles.fundingFill} style={{ width: `${coverage}%` }} />
            </div>
            <div className={styles.fundingKey}><span>{coverage}% FUNDED</span><span>{dollars(shortfall)} GAP</span></div>
            <div className={styles.reserve}>
              <span>UNCOMMITTED RESERVE</span>
              <strong>{dollars(reserve)}</strong>
              <small>Available for an analyst-reviewed intervention.</small>
            </div>
          </section>
        </div>

        <footer className={styles.stageFooter}>Sample data <span>·</span> Replay only <span>·</span> No settlement instructions sent</footer>
      </section>
    </main>
  );
}
