import { useMemo, useState } from "react";
import "./App.css";
import { appCheckDebugMode } from "./firebase/app";
import { upgradeWithGoogle } from "./firebase/auth";
import {
  runFirestoreHealthcheck,
  type HealthcheckResult,
} from "./firebase/firestore";
import { enableOnDeviceAI } from "./ai/deviceModel";
import {
  parseOrderMessage,
  type ParsedOrder,
} from "./ai/orderParser";
import type { InferenceSourceLabel } from "./ai/types";
import {
  useAuthState,
  useDeviceModelStatus,
  useRemoteConfig,
  useRoutingLog,
} from "./hooks";

const SAMPLE_ORDER = `Bu Rina: Assalamualaikum mbak, mau pesan buat besok pagi ya
- beras rojo lele 5kg, harga 68rb
- minyak goreng 2 liter @31rb
- telur 1 krat
- gula pasir 2kg 17rb/kg
- kopi kapal api 1 renceng
Bayar transfer BCA, tolong diantar ke rumah sebelum jam 7 pagi. Makasih!`;

interface LedgerEntry {
  id: number;
  order: ParsedOrder;
  inferenceSource: InferenceSourceLabel;
  at: string;
}

function formatIdr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

function sourceBadge(source: InferenceSourceLabel | null): string {
  switch (source) {
    case "on_device":
      return "On-device · Gemini Nano";
    case "in_cloud":
      return "Cloud · Gemini";
    case "unknown":
      return "Path not reported";
    default:
      return "No inference ran";
  }
}

function deviceStatusText(kind: string): string {
  switch (kind) {
    case "ready":
      return "On-device ready";
    case "downloading":
      return "Downloading model…";
    case "checking":
      return "Checking…";
    case "unavailable":
      return "On-device unavailable";
    case "cloud-only":
      return "Cloud only on this browser";
    default:
      return "Not probed yet";
  }
}

export default function App() {
  const authState = useAuthState();
  const deviceStatus = useDeviceModelStatus();
  const routingLog = useRoutingLog();
  const remoteConfig = useRemoteConfig();

  const [message, setMessage] = useState(SAMPLE_ORDER);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [health, setHealth] = useState<HealthcheckResult | null>(null);
  const [healthRunning, setHealthRunning] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const lastRun = useMemo(
    () => routingLog.find((e) => e.inferenceSource !== null),
    [routingLog],
  );
  const ledgerTotal = useMemo(
    () => ledger.reduce((sum, e) => sum + e.order.totalIdr, 0),
    [ledger],
  );

  const user = authState.status === "signed-in" ? authState.user : null;

  async function onParse() {
    setParsing(true);
    setParseError(null);
    try {
      const { outcome } = await parseOrderMessage(message);
      if (outcome.ok) {
        setLedger((prev) => [
          {
            id: Date.now(),
            order: outcome.data,
            inferenceSource: outcome.inferenceSource,
            at: new Date().toLocaleTimeString(),
          },
          ...prev,
        ]);
      } else {
        setParseError(outcome.error);
      }
    } finally {
      setParsing(false);
    }
  }

  async function onHealthcheck() {
    if (!user) return;
    setHealthRunning(true);
    try {
      setHealth(await runFirestoreHealthcheck(user.uid));
    } finally {
      setHealthRunning(false);
    }
  }

  async function onUpgrade() {
    setUpgrading(true);
    setUpgradeError(null);
    try {
      await upgradeWithGoogle();
    } catch (e: unknown) {
      setUpgradeError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>KiosKu</h1>
          <p className="tagline">
            AI back-office for Indonesian warung owners — order chats become a
            ledger <strong>on-device</strong>, business insight comes from the{" "}
            <strong>cloud</strong>.
          </p>
        </div>
        <div className="account">
          {authState.status === "loading" && <span>Signing in…</span>}
          {authState.status === "error" && (
            <span className="error">Auth error: {authState.error}</span>
          )}
          {user && (
            <>
              <span className="uid">
                {user.isAnonymous ? "Anonymous account" : "Google account"} ·{" "}
                {user.uid.slice(0, 8)}…
              </span>
              {user.isAnonymous && (
                <button onClick={onUpgrade} disabled={upgrading}>
                  {upgrading ? "Opening Google…" : "Upgrade to Google"}
                </button>
              )}
              {upgradeError && <span className="error">{upgradeError}</span>}
            </>
          )}
        </div>
      </header>

      <section className="card">
        <h2>Connection &amp; AI status</h2>
        <div className="status-grid">
          <div>
            <div className="label">On-device model (Gemini Nano)</div>
            <div className="value">
              {deviceStatusText(deviceStatus.kind)}
              {deviceStatus.kind === "downloading" &&
                ` (${Math.round(deviceStatus.progress * 100)}%)`}
            </div>
            {(deviceStatus.kind === "unavailable" ||
              deviceStatus.kind === "cloud-only") && (
              <div className="hint">{deviceStatus.reason}</div>
            )}
            <button
              className="mt"
              onClick={() => void enableOnDeviceAI()}
              disabled={
                deviceStatus.kind === "checking" ||
                deviceStatus.kind === "downloading" ||
                deviceStatus.kind === "ready"
              }
            >
              Enable on-device AI
            </button>
            <div className="hint">
              Downloads Gemini Nano in this browser (needs your click). Until
              then, hybrid features fall back to cloud Gemini and say so.
            </div>
          </div>
          <div>
            <div className="label">Last inference ran on</div>
            <div className="value">
              {lastRun ? sourceBadge(lastRun.inferenceSource) : "—"}
            </div>
            {lastRun && (
              <div className="hint">
                {lastRun.feature} · {lastRun.latencyMs} ms ·{" "}
                {new Date(lastRun.at).toLocaleTimeString()}
              </div>
            )}
            <div className="label mt">App Check</div>
            <div className="value">
              {appCheckDebugMode
                ? "Debug provider (localhost)"
                : "reCAPTCHA Enterprise"}
            </div>
            <div className="label mt">Routing threshold (Remote Config)</div>
            <div className="value">
              Inputs &gt; {remoteConfig.maxOnDeviceInputChars} chars go
              cloud-only
            </div>
          </div>
          <div>
            <div className="label">Firestore</div>
            <button
              className="mt"
              onClick={onHealthcheck}
              disabled={!user || healthRunning}
            >
              {healthRunning ? "Checking…" : "Run healthcheck write/read"}
            </button>
            {health && (
              <div className={health.ok ? "hint ok" : "hint error"}>
                {health.detail}
              </div>
            )}
            <div className="hint">
              Writes <code>healthcheck/{"{uid}"}</code> and reads it back.
              Ledger persistence lands in stage 2.
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Order intake — WhatsApp chat → structured ledger entry</h2>
        <p className="hint">
          Paste a customer&apos;s order message. Short messages route{" "}
          <strong>prefer-on-device</strong> (private, offline-capable); long
          pastes route <strong>cloud-only</strong> by design. The badge on each
          result is the path that actually ran.
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={9}
          spellCheck={false}
        />
        <div className="row">
          <button className="primary" onClick={onParse} disabled={parsing}>
            {parsing ? "Parsing…" : "Parse order"}
          </button>
          <span className="hint">{message.length} chars</span>
        </div>
        {parseError && (
          <div className="error-box">
            Parse failed: {parseError}
            <div className="hint">
              On localhost this is expected until the App Check debug token
              printed in the browser console is registered in the Firebase
              console (see README).
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Ledger (this session)</h2>
        {ledger.length === 0 && (
          <p className="hint">No entries yet — parse the sample order above.</p>
        )}
        {ledger.map((entry) => (
          <div key={entry.id} className="ledger-entry">
            <div className="ledger-head">
              <strong>{entry.order.buyer || "Unknown buyer"}</strong>
              <span className="badge">
                {sourceBadge(entry.inferenceSource)}
              </span>
              <span className="hint">{entry.at}</span>
            </div>
            <table>
              <tbody>
                {entry.order.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.name}</td>
                    <td className="num">× {item.qty}</td>
                    <td className="num">
                      {item.unitPriceIdr > 0
                        ? formatIdr(item.unitPriceIdr)
                        : "price n/a"}
                    </td>
                    <td className="num">
                      {item.unitPriceIdr > 0
                        ? formatIdr(item.qty * item.unitPriceIdr)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entry.order.notes && (
              <div className="hint">Note: {entry.order.notes}</div>
            )}
            <div className="ledger-total">
              Total: {formatIdr(entry.order.totalIdr)}
            </div>
          </div>
        ))}
        {ledger.length > 0 && (
          <div className="grand-total">
            Session total: {formatIdr(ledgerTotal)}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Routing log</h2>
        {routingLog.length === 0 && (
          <p className="hint">
            Every inference call lands here — feature, mode requested, path
            that actually ran, latency.
          </p>
        )}
        <ul className="log">
          {routingLog.map((e) => (
            <li key={e.id} className={e.ok ? "" : "failed"}>
              <span className="mono">
                {new Date(e.at).toLocaleTimeString()}
              </span>{" "}
              <strong>{e.feature}</strong> · mode: {e.modeRequested} · ran:{" "}
              {sourceBadge(e.inferenceSource)} · {e.latencyMs} ms
              {e.ok ? "" : ` · FAILED: ${e.error}`}
            </li>
          ))}
        </ul>
      </section>

      <footer className="hint">
        KiosKu — #BuildHybridAI 2026 entry. Hybrid inference via Firebase AI
        Logic (Gemini Nano on-device + Gemini in the cloud). Apache-2.0.
      </footer>
    </div>
  );
}
