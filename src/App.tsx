import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { appCheckDebugMode } from "./firebase/app";
import { upgradeWithGoogle } from "./firebase/auth";
import {
  runFirestoreHealthcheck,
  type HealthcheckResult,
} from "./firebase/firestore";
import { enableOnDeviceAI } from "./ai/deviceModel";
import { parseOrderMessage, type ParsedOrder } from "./ai/orderParser";
import { generateDailyRecap } from "./ai/dailyRecap";
import { generateWeeklyReport } from "./ai/weeklyReport";
import type { InferenceSourceLabel } from "./ai/types";
import {
  addLedgerEntry,
  deleteProduct,
  loadLatestReport,
  loadRecap,
  saveRecap,
  saveReport,
  upsertProduct,
} from "./shop/ledger";
import { removeDemoShop, seedDemoShop } from "./shop/demoData";
import { computeDailyAggregate, computeWeekStats } from "./shop/stats";
import {
  dayKeyOf,
  productKey,
  todayKey,
  type DailyRecap,
  type LedgerEntry,
  type WeeklyReport,
} from "./shop/types";
import { fmt, setLang, STRINGS, type Lang } from "./i18n";
import {
  useAuthState,
  useDeviceModelStatus,
  useLang,
  useRemoteConfig,
  useRoutingLog,
  useShop,
} from "./hooks";

const SAMPLE_ORDER = `Bu Rina: Assalamualaikum mbak, mau pesan buat besok pagi ya
- beras rojo lele 5kg, harga 68rb
- minyak goreng 2 liter @31rb
- telur 1 krat
- gula pasir 2kg 17rb/kg
- kopi kapal api 1 renceng
Bayar transfer BCA, tolong diantar ke rumah sebelum jam 7 pagi. Makasih!`;

function formatIdr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

function sourceBadge(
  source: InferenceSourceLabel | null,
  lang: Lang,
): string {
  const t = STRINGS[lang];
  switch (source) {
    case "on_device":
      return t.badgeOnDevice;
    case "in_cloud":
      return t.badgeCloud;
    case "unknown":
      return t.badgeUnknown;
    default:
      return t.badgeNone;
  }
}

function deviceStatusText(kind: string, lang: Lang): string {
  const t = STRINGS[lang];
  switch (kind) {
    case "ready":
      return t.dsReady;
    case "downloading":
      return t.dsDownloading;
    case "checking":
      return t.dsChecking;
    case "unavailable":
      return t.dsUnavailable;
    case "cloud-only":
      return t.dsCloudOnly;
    default:
      return t.dsUnknown;
  }
}

function parsePriceInput(v: string): number {
  const n = Number(v.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export default function App() {
  const lang = useLang();
  const t = STRINGS[lang];
  const authState = useAuthState();
  const deviceStatus = useDeviceModelStatus();
  const routingLog = useRoutingLog();
  const remoteConfig = useRemoteConfig();

  const user = authState.status === "signed-in" ? authState.user : null;
  const uid = user?.uid ?? null;
  const shop = useShop(uid);

  // Order intake
  const [message, setMessage] = useState(SAMPLE_ORDER);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [filledFromBook, setFilledFromBook] = useState<string[]>([]);

  // Status panel
  const [health, setHealth] = useState<HealthcheckResult | null>(null);
  const [healthRunning, setHealthRunning] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Demo
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Price book editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSell, setEditSell] = useState("");
  const [editCost, setEditCost] = useState("");
  const [newName, setNewName] = useState("");
  const [newSell, setNewSell] = useState("");
  const [newCost, setNewCost] = useState("");
  const [bookError, setBookError] = useState<string | null>(null);

  // Recap / report
  const [recap, setRecap] = useState<DailyRecap | null>(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const lastRun = useMemo(
    () => routingLog.find((e) => e.inferenceSource !== null),
    [routingLog],
  );

  const productsByKey = useMemo(
    () => new Map(shop.products.map((p) => [p.id, p])),
    [shop.products],
  );

  const today = todayKey();
  const todayEntries = useMemo(
    () => shop.entries.filter((e) => e.dayKey === today),
    [shop.entries, today],
  );
  const todayAgg = useMemo(
    () =>
      todayEntries.length > 0
        ? computeDailyAggregate(today, todayEntries, productsByKey)
        : null,
    [today, todayEntries, productsByKey],
  );

  const weekRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return { start: dayKeyOf(start), end: dayKeyOf(end) };
  }, []);
  const weekStats = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKeyOf(d);
      const dayEntries = shop.entries.filter((e) => e.dayKey === key);
      if (dayEntries.length > 0) {
        days.push(computeDailyAggregate(key, dayEntries, productsByKey));
      }
    }
    return computeWeekStats(days, weekRange.start, weekRange.end);
  }, [shop.entries, productsByKey, weekRange]);

  const ledgerByDay = useMemo(() => {
    const groups = new Map<string, LedgerEntry[]>();
    for (const entry of shop.entries) {
      const list = groups.get(entry.dayKey) ?? [];
      list.push(entry);
      groups.set(entry.dayKey, list);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [shop.entries]);

  // Load the cached recap + latest weekly report once data is reachable.
  useEffect(() => {
    if (!uid || shop.status !== "ready") return;
    let cancelled = false;
    loadRecap(uid, today)
      .then((r) => {
        if (!cancelled && r) setRecap(r);
      })
      .catch(() => undefined);
    loadLatestReport(uid)
      .then((r) => {
        if (!cancelled && r) setReport(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, shop.status === "ready"]);

  async function onParse() {
    if (!uid) return;
    setParsing(true);
    setParseError(null);
    setSavedNotice(null);
    setFilledFromBook([]);
    try {
      const { outcome } = await parseOrderMessage(message);
      if (!outcome.ok) {
        setParseError(outcome.error);
        return;
      }
      // Fill prices the message didn't state from the price book — the
      // book is the shop's memory, and the UI marks every filled price.
      const filled: string[] = [];
      const items = outcome.data.items.map((item) => {
        if (item.unitPriceIdr > 0) return item;
        const known = productsByKey.get(productKey(item.name));
        if (known && known.sellPriceIdr > 0) {
          filled.push(item.name);
          return { ...item, unitPriceIdr: known.sellPriceIdr };
        }
        return item;
      });
      const order: ParsedOrder = {
        ...outcome.data,
        items,
        totalIdr: items.reduce((s, it) => s + it.qty * it.unitPriceIdr, 0),
      };
      try {
        await addLedgerEntry(uid, {
          buyer: order.buyer,
          items: order.items,
          notes: order.notes,
          inferenceSource: outcome.inferenceSource,
          source: "ai-parse",
        });
        setFilledFromBook(filled);
        setSavedNotice(
          `${t.savedToLedger}: ${order.buyer || t.unknownBuyer} · ${formatIdr(order.totalIdr)}`,
        );
      } catch (e: unknown) {
        setParseError(
          `Parsed OK, but saving to Firestore failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
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

  async function onSeedDemo() {
    if (!uid) return;
    setDemoBusy(true);
    setDemoError(null);
    setDemoNotice(null);
    try {
      const result = await seedDemoShop(uid);
      setDemoNotice(
        fmt(t.demoLoaded, {
          entries: result.entriesWritten,
          days: result.days.length,
          products: result.productsWritten,
        }),
      );
    } catch (e: unknown) {
      setDemoError(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoBusy(false);
    }
  }

  async function onRemoveDemo() {
    if (!uid) return;
    setDemoBusy(true);
    setDemoError(null);
    setDemoNotice(null);
    try {
      const result = await removeDemoShop(uid);
      setDemoNotice(fmt(t.demoRemoved, { n: result.removed }));
    } catch (e: unknown) {
      setDemoError(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoBusy(false);
    }
  }

  async function onSaveProductEdit(name: string) {
    if (!uid) return;
    setBookError(null);
    try {
      await upsertProduct(uid, {
        name,
        sellPriceIdr: parsePriceInput(editSell),
        costPriceIdr: parsePriceInput(editCost),
      });
      setEditingId(null);
    } catch (e: unknown) {
      setBookError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onAddProduct() {
    if (!uid || !newName.trim()) return;
    setBookError(null);
    try {
      await upsertProduct(uid, {
        name: newName.trim(),
        sellPriceIdr: parsePriceInput(newSell),
        costPriceIdr: parsePriceInput(newCost),
      });
      setNewName("");
      setNewSell("");
      setNewCost("");
    } catch (e: unknown) {
      setBookError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteProduct(productId: string) {
    if (!uid) return;
    setBookError(null);
    try {
      await deleteProduct(uid, productId);
    } catch (e: unknown) {
      setBookError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onGenerateRecap() {
    if (!uid || !todayAgg) return;
    setRecapBusy(true);
    setRecapError(null);
    try {
      const outcome = await generateDailyRecap(todayAgg, lang);
      if (!outcome.ok) {
        setRecapError(outcome.error);
        return;
      }
      const saved: DailyRecap = {
        dayKey: today,
        headline: outcome.data.headline,
        highlights: outcome.data.highlights,
        advice: outcome.data.advice,
        inferenceSource: outcome.inferenceSource,
        stats: {
          orderCount: todayAgg.orderCount,
          totalSalesIdr: todayAgg.totalSalesIdr,
          marginIdr: todayAgg.marginIdr,
          topItemName: todayAgg.items[0]?.name ?? "",
        },
        createdAtMs: Date.now(),
      };
      setRecap(saved);
      await saveRecap(uid, saved).catch(() => undefined);
    } finally {
      setRecapBusy(false);
    }
  }

  async function onGenerateReport() {
    if (!uid) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const outcome = await generateWeeklyReport(weekStats, lang);
      if (!outcome.ok) {
        setReportError(outcome.error);
        return;
      }
      const draft = {
        rangeStart: weekStats.rangeStart,
        rangeEnd: weekStats.rangeEnd,
        summary: outcome.data.summary,
        marginAnalysis: outcome.data.marginAnalysis,
        bestSellers: outcome.data.bestSellers,
        restockPlan: outcome.data.restockPlan,
        supplierMessage: outcome.data.supplierMessage,
        risks: outcome.data.risks,
        inferenceSource: outcome.inferenceSource,
        stats: {
          orderCount: weekStats.orderCount,
          totalSalesIdr: weekStats.totalSalesIdr,
          marginIdr: weekStats.marginIdr,
          marginCoverage: weekStats.marginCoverage,
        },
      };
      let id = "";
      try {
        id = await saveReport(uid, draft);
      } catch {
        // Saving the cache is best-effort; the report itself is real.
      }
      setReport({ ...draft, id, createdAtMs: Date.now() });
    } finally {
      setReportBusy(false);
    }
  }

  async function onCopySupplier() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.supplierMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>KiosKu</h1>
          <p className="tagline">
            {t.taglinePre}
            <strong>{t.taglineDevice}</strong>
            {t.taglineMid}
            <strong>{t.taglineCloud}</strong>
            {t.taglinePost}
          </p>
        </div>
        <div className="account">
          <div className="lang-toggle" role="group" aria-label={t.language}>
            <span className="hint">{t.language}:</span>
            <button
              className={lang === "id" ? "lang active" : "lang"}
              onClick={() => setLang("id")}
            >
              ID
            </button>
            <button
              className={lang === "en" ? "lang active" : "lang"}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>
          {authState.status === "loading" && <span>{t.signingIn}</span>}
          {authState.status === "error" && (
            <span className="error">
              {t.authError}: {authState.error}
            </span>
          )}
          {user && (
            <>
              <span className="uid">
                {user.isAnonymous ? t.anonymousAccount : t.googleAccount} ·{" "}
                {user.uid.slice(0, 8)}…
              </span>
              {user.isAnonymous && (
                <button onClick={onUpgrade} disabled={upgrading}>
                  {upgrading ? t.openingGoogle : t.upgradeToGoogle}
                </button>
              )}
              {upgradeError && <span className="error">{upgradeError}</span>}
            </>
          )}
        </div>
      </header>

      <section className="card">
        <h2>{t.statusTitle}</h2>
        <div className="status-grid">
          <div>
            <div className="label">{t.onDeviceModel}</div>
            <div className="value">
              {deviceStatusText(deviceStatus.kind, lang)}
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
              {t.enableOnDevice}
            </button>
            <div className="hint">{t.enableHint}</div>
          </div>
          <div>
            <div className="label">{t.lastInference}</div>
            <div className="value">
              {lastRun ? sourceBadge(lastRun.inferenceSource, lang) : "—"}
            </div>
            {lastRun && (
              <div className="hint">
                {lastRun.feature} · {lastRun.latencyMs} ms ·{" "}
                {new Date(lastRun.at).toLocaleTimeString()}
              </div>
            )}
            <div className="label mt">{t.appCheck}</div>
            <div className="value">
              {appCheckDebugMode ? t.appCheckDebug : t.appCheckProd}
            </div>
            <div className="label mt">{t.routingThreshold}</div>
            <div className="value">
              {fmt(t.routingThresholdText, {
                n: remoteConfig.maxOnDeviceInputChars,
              })}
            </div>
          </div>
          <div>
            <div className="label">{t.firestoreLabel}</div>
            <button
              className="mt"
              onClick={onHealthcheck}
              disabled={!user || healthRunning}
            >
              {healthRunning ? t.checking : t.runHealthcheck}
            </button>
            {health && (
              <div className={health.ok ? "hint ok" : "hint error"}>
                {health.detail}
              </div>
            )}
            <div className="hint">{t.healthcheckHint}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t.demoTitle}</h2>
        <p className="hint">{t.demoText}</p>
        <div className="row">
          {!shop.demoSeeded ? (
            <button
              className="primary"
              onClick={onSeedDemo}
              disabled={!uid || demoBusy || shop.status === "error"}
            >
              {demoBusy ? t.seeding : t.loadDemo}
            </button>
          ) : (
            <>
              <span className="badge demo">{t.demoActive}</span>
              <button onClick={onRemoveDemo} disabled={demoBusy}>
                {demoBusy ? t.removing : t.removeDemo}
              </button>
            </>
          )}
        </div>
        {demoNotice && <div className="hint ok">{demoNotice}</div>}
        {demoError && <div className="error-box">{demoError}</div>}
      </section>

      <section className="card">
        <h2>{t.intakeTitle}</h2>
        <p className="hint">
          {t.intakeTextPre}
          <strong>{t.intakeTextDevice}</strong>
          {t.intakeTextMid}
          <strong>{t.intakeTextCloud}</strong>
          {t.intakeTextPost}
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={9}
          spellCheck={false}
        />
        <div className="row">
          <button
            className="primary"
            onClick={onParse}
            disabled={parsing || !uid}
          >
            {parsing ? t.parsing : t.parseOrder}
          </button>
          <span className="hint">
            {message.length} {t.chars}
          </span>
        </div>
        {savedNotice && (
          <div className="hint ok">
            ✓ {savedNotice}
            {filledFromBook.length > 0 && (
              <div className="hint">
                {t.priceFilledNote} {filledFromBook.join(", ")}
              </div>
            )}
          </div>
        )}
        {parseError && (
          <div className="error-box">
            {t.parseFailed}: {parseError}
            <div className="hint">{t.parseAppCheckHint}</div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.ledgerTitle}</h2>
        {shop.status === "loading" && (
          <p className="hint">{t.ledgerLoading}</p>
        )}
        {shop.status === "error" && (
          <div className="error-box">
            {t.ledgerError}
            <div className="mono">{shop.error}</div>
          </div>
        )}
        {shop.status === "ready" && shop.entries.length === 0 && (
          <p className="hint">{t.ledgerEmpty}</p>
        )}
        {ledgerByDay.map(([dayKey, entries]) => (
          <div key={dayKey} className="ledger-day">
            <div className="ledger-day-head">
              <strong>{dayKey}</strong>
              <span className="hint">
                {t.dayTotal}:{" "}
                {formatIdr(entries.reduce((s, e) => s + e.totalIdr, 0))}
              </span>
            </div>
            {entries.map((entry) => (
              <div key={entry.id} className="ledger-entry">
                <div className="ledger-head">
                  <strong>{entry.buyer || t.unknownBuyer}</strong>
                  <span className="badge">
                    {sourceBadge(entry.inferenceSource, lang)}
                  </span>
                  {entry.source === "demo" && (
                    <span className="badge demo">{t.badgeDemo}</span>
                  )}
                  <span className="hint">
                    {new Date(entry.createdAtMs).toLocaleTimeString()}
                  </span>
                </div>
                <table>
                  <tbody>
                    {entry.items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.name}</td>
                        <td className="num">× {item.qty}</td>
                        <td className="num">
                          {item.unitPriceIdr > 0
                            ? formatIdr(item.unitPriceIdr)
                            : t.priceNa}
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
                {entry.notes && (
                  <div className="hint">
                    {t.noteLabel}: {entry.notes}
                  </div>
                )}
                <div className="ledger-total">
                  {t.total}: {formatIdr(entry.totalIdr)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>{t.bookTitle}</h2>
        <p className="hint">{t.bookHint}</p>
        {shop.products.length === 0 && (
          <p className="hint">{t.bookEmpty}</p>
        )}
        {shop.products.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t.colProduct}</th>
                <th className="num">{t.colSell}</th>
                <th className="num">{t.colCost}</th>
                <th>{t.colSource}</th>
                <th>{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {shop.products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  {editingId === p.id ? (
                    <>
                      <td className="num">
                        <input
                          className="price-input"
                          value={editSell}
                          onChange={(e) => setEditSell(e.target.value)}
                          inputMode="numeric"
                        />
                      </td>
                      <td className="num">
                        <input
                          className="price-input"
                          value={editCost}
                          onChange={(e) => setEditCost(e.target.value)}
                          inputMode="numeric"
                        />
                      </td>
                      <td>
                        {p.source === "demo"
                          ? t.srcDemo
                          : p.source === "learned"
                            ? t.srcLearned
                            : t.srcManual}
                      </td>
                      <td className="actions">
                        <button
                          onClick={() => void onSaveProductEdit(p.name)}
                        >
                          {t.save}
                        </button>
                        <button onClick={() => setEditingId(null)}>
                          {t.cancel}
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">
                        {p.sellPriceIdr > 0
                          ? formatIdr(p.sellPriceIdr)
                          : "—"}
                      </td>
                      <td className="num">
                        {p.costPriceIdr > 0
                          ? formatIdr(p.costPriceIdr)
                          : "—"}
                      </td>
                      <td>
                        {p.source === "demo"
                          ? t.srcDemo
                          : p.source === "learned"
                            ? t.srcLearned
                            : t.srcManual}
                      </td>
                      <td className="actions">
                        <button
                          onClick={() => {
                            setEditingId(p.id);
                            setEditSell(
                              p.sellPriceIdr ? String(p.sellPriceIdr) : "",
                            );
                            setEditCost(
                              p.costPriceIdr ? String(p.costPriceIdr) : "",
                            );
                          }}
                        >
                          {t.edit}
                        </button>
                        <button onClick={() => void onDeleteProduct(p.id)}>
                          {t.delete}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row wrap">
          <input
            className="name-input"
            placeholder={t.productName}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="price-input"
            placeholder={t.colSell}
            value={newSell}
            onChange={(e) => setNewSell(e.target.value)}
            inputMode="numeric"
          />
          <input
            className="price-input"
            placeholder={t.colCost}
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            inputMode="numeric"
          />
          <button onClick={onAddProduct} disabled={!newName.trim() || !uid}>
            {t.addProduct}
          </button>
        </div>
        {bookError && <div className="error-box">{bookError}</div>}
      </section>

      <section className="card">
        <h2>{t.recapTitle}</h2>
        <p className="hint">{t.recapText}</p>
        {!todayAgg && <p className="hint">{t.recapEmpty}</p>}
        {todayAgg && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="label">{t.statOrders}</div>
                <div className="value">{todayAgg.orderCount}</div>
              </div>
              <div className="stat">
                <div className="label">{t.statSales}</div>
                <div className="value">
                  {formatIdr(todayAgg.totalSalesIdr)}
                </div>
              </div>
              <div className="stat">
                <div className="label">{t.statMargin}</div>
                <div className="value">
                  {todayAgg.marginIdr !== null
                    ? `${formatIdr(todayAgg.marginIdr)} (${Math.round(
                        todayAgg.marginCoverage * 100,
                      )}%)`
                    : t.marginUnknown}
                </div>
              </div>
              <div className="stat">
                <div className="label">{t.statTopItem}</div>
                <div className="value">
                  {todayAgg.items[0]?.name ?? "—"}
                </div>
              </div>
            </div>
            <div className="row">
              <button
                className="primary"
                onClick={onGenerateRecap}
                disabled={recapBusy}
              >
                {recapBusy ? t.generating : t.generateRecap}
              </button>
              {recap && (
                <span className="badge">
                  {sourceBadge(recap.inferenceSource, lang)}
                </span>
              )}
            </div>
          </>
        )}
        {recapError && (
          <div className="error-box">
            {t.recapFailed}: {recapError}
            <div className="hint">{t.parseAppCheckHint}</div>
          </div>
        )}
        {recap && (
          <div className="recap">
            <div className="recap-headline">{recap.headline}</div>
            <ul>
              {recap.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
            <div className="hint">
              <strong>{t.adviceLabel}:</strong> {recap.advice}
            </div>
            <div className="hint">
              {fmt(t.recapCached, {
                time: new Date(recap.createdAtMs).toLocaleTimeString(),
              })}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.weeklyTitle}</h2>
        <p className="hint">{t.weeklyText}</p>
        {weekStats.orderCount === 0 ? (
          <p className="hint">{t.weeklyEmpty}</p>
        ) : (
          <>
            <div className="hint">
              {weekStats.rangeStart} → {weekStats.rangeEnd} ·{" "}
              {weekStats.orderCount} {t.weekOrders} ·{" "}
              {formatIdr(weekStats.totalSalesIdr)} {t.weekSales}
              {weekStats.marginIdr !== null &&
                ` · ${t.statMargin}: ${formatIdr(weekStats.marginIdr)} (${Math.round(
                  weekStats.marginCoverage * 100,
                )}%)`}
            </div>
            <div className="row">
              <button
                className="primary"
                onClick={onGenerateReport}
                disabled={reportBusy}
              >
                {reportBusy ? t.generatingWeekly : t.generateWeekly}
              </button>
              {report && (
                <span className="badge">
                  {sourceBadge(report.inferenceSource, lang)}
                </span>
              )}
            </div>
          </>
        )}
        {reportError && (
          <div className="error-box">
            {t.weeklyFailed}: {reportError}
            <div className="hint">{t.parseAppCheckHint}</div>
          </div>
        )}
        {report && (
          <div className="report">
            <h3>{t.reportSummary}</h3>
            <p>{report.summary}</p>
            <h3>{t.reportMargins}</h3>
            <p>{report.marginAnalysis}</p>
            <h3>{t.reportBest}</h3>
            <ul>
              {report.bestSellers.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <h3>{t.reportRestock}</h3>
            <table>
              <tbody>
                {report.restockPlan.map((r, i) => (
                  <tr key={i}>
                    <td>{r.product}</td>
                    <td className="num">{r.qtySuggestion}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>{t.reportSupplier}</h3>
            <pre className="supplier">{report.supplierMessage}</pre>
            <div className="row">
              <button onClick={onCopySupplier}>
                {copied ? t.copied : t.copyMessage}
              </button>
            </div>
            {report.risks.length > 0 && (
              <>
                <h3>{t.reportRisks}</h3>
                <ul>
                  {report.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="hint">
              {fmt(t.reportCached, {
                time: new Date(report.createdAtMs).toLocaleString(),
              })}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.logTitle}</h2>
        {routingLog.length === 0 && <p className="hint">{t.logEmpty}</p>}
        <ul className="log">
          {routingLog.map((e) => (
            <li key={e.id} className={e.ok ? "" : "failed"}>
              <span className="mono">
                {new Date(e.at).toLocaleTimeString()}
              </span>{" "}
              <strong>{e.feature}</strong> · mode: {e.modeRequested} · ran:{" "}
              {sourceBadge(e.inferenceSource, lang)} · {e.latencyMs} ms
              {e.ok ? "" : ` · ${t.logFailed}: ${e.error}`}
            </li>
          ))}
        </ul>
      </section>

      <footer className="hint">{t.footer}</footer>
    </div>
  );
}
