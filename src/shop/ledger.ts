import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase/firestore";
import type { InferenceSourceLabel } from "../ai/types";
import { computeDailyAggregate } from "./stats";
import {
  dayKeyOf,
  productKey,
  type DailyAggregate,
  type DailyRecap,
  type LedgerEntry,
  type LedgerItem,
  type Product,
  type WeeklyReport,
} from "./types";

/**
 * The shop data layer: Firestore persistence for everything under
 * users/{uid}/, behind a small observable store the UI subscribes to.
 *
 * Writes are owner-scoped by firestore.rules; until those rules are
 * deployed the backend rejects every call with permission-denied, and
 * that error is surfaced verbatim in the store (status: "error") rather
 * than hidden — the same honesty rule as the stage-1 healthcheck.
 */

export interface ShopState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  entries: LedgerEntry[];
  products: Product[];
  aggregates: Map<string, DailyAggregate>;
  demoSeeded: boolean;
}

const EMPTY: ShopState = {
  status: "idle",
  entries: [],
  products: [],
  aggregates: new Map(),
  demoSeeded: false,
};

let state: ShopState = EMPTY;
let attachedUid: string | null = null;
let unsubs: Unsubscribe[] = [];
const listeners = new Set<() => void>();

function setState(next: ShopState) {
  state = next;
  listeners.forEach((fn) => fn());
}

export function subscribeShop(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getShopState(): ShopState {
  return state;
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    return code ? `${code}: ${e.message}` : e.message;
  }
  return String(e);
}

function toMs(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  return Date.now();
}

function entryFromDoc(id: string, data: Record<string, unknown>): LedgerEntry {
  const items = Array.isArray(data.items)
    ? (data.items as LedgerItem[]).map((it) => ({
        name: String(it.name ?? ""),
        qty: Number(it.qty ?? 0),
        unitPriceIdr: Number(it.unitPriceIdr ?? 0),
      }))
    : [];
  return {
    id,
    buyer: String(data.buyer ?? ""),
    items,
    notes: String(data.notes ?? ""),
    totalIdr: Number(data.totalIdr ?? 0),
    inferenceSource:
      (data.inferenceSource as InferenceSourceLabel | null) ?? null,
    source: (data.source as LedgerEntry["source"]) ?? "manual",
    dayKey: String(data.dayKey ?? ""),
    createdAtMs: toMs(data.createdAt),
  };
}

function productFromDoc(id: string, data: Record<string, unknown>): Product {
  return {
    id,
    name: String(data.name ?? id),
    sellPriceIdr: Number(data.sellPriceIdr ?? 0),
    costPriceIdr: Number(data.costPriceIdr ?? 0),
    source: (data.source as Product["source"]) ?? "manual",
    updatedAtMs: toMs(data.updatedAt),
  };
}

function aggregateFromDoc(data: Record<string, unknown>): DailyAggregate {
  return {
    dayKey: String(data.dayKey ?? ""),
    orderCount: Number(data.orderCount ?? 0),
    totalSalesIdr: Number(data.totalSalesIdr ?? 0),
    knownCostIdr:
      data.knownCostIdr === null || data.knownCostIdr === undefined
        ? null
        : Number(data.knownCostIdr),
    marginIdr:
      data.marginIdr === null || data.marginIdr === undefined
        ? null
        : Number(data.marginIdr),
    marginCoverage: Number(data.marginCoverage ?? 0),
    items: Array.isArray(data.items)
      ? (data.items as DailyAggregate["items"])
      : [],
    updatedAtMs: toMs(data.updatedAt),
  };
}

/** Attach snapshot listeners for one user's shop. Safe to call again when
 *  the uid changes (account upgrade keeps the uid, so usually once). */
export function attachShop(uid: string): void {
  if (attachedUid === uid) return;
  unsubs.forEach((u) => u());
  unsubs = [];
  attachedUid = uid;
  setState({ ...EMPTY, status: "loading" });

  const base = `users/${uid}`;
  const onError = (e: Error) => {
    setState({ ...state, status: "error", error: describeError(e) });
  };

  unsubs.push(
    onSnapshot(
      query(
        collection(db, `${base}/ledgerEntries`),
        orderBy("createdAt", "desc"),
        limit(300),
      ),
      (snap) => {
        const entries = snap.docs.map((d) =>
          entryFromDoc(d.id, d.data() as Record<string, unknown>),
        );
        setState({ ...state, status: "ready", entries });
      },
      onError,
    ),
  );
  unsubs.push(
    onSnapshot(
      collection(db, `${base}/products`),
      (snap) => {
        const products = snap.docs
          .map((d) => productFromDoc(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => a.name.localeCompare(b.name));
        setState({ ...state, products });
      },
      onError,
    ),
  );
  unsubs.push(
    onSnapshot(
      collection(db, `${base}/dailyAggregates`),
      (snap) => {
        const aggregates = new Map<string, DailyAggregate>();
        snap.docs.forEach((d) => {
          const agg = aggregateFromDoc(d.data() as Record<string, unknown>);
          aggregates.set(agg.dayKey, agg);
        });
        setState({ ...state, aggregates });
      },
      onError,
    ),
  );
  unsubs.push(
    onSnapshot(
      doc(db, base),
      (snap) => {
        const data = snap.data() as Record<string, unknown> | undefined;
        setState({
          ...state,
          demoSeeded: Boolean(data?.demoSeeded),
        });
      },
      onError,
    ),
  );
}

function productsMap(products: Product[]): Map<string, Product> {
  return new Map(products.map((p) => [p.id, p]));
}

/** Recompute one day's aggregate from the source of truth (the day's
 *  ledger entries + the price book) and persist it. Called after every
 *  write that touches the day. Deletes the aggregate when the day becomes
 *  empty (e.g. demo data removed). */
export async function recomputeDayAggregate(
  uid: string,
  dayKey: string,
): Promise<void> {
  const base = `users/${uid}`;
  const [entrySnap, productSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, `${base}/ledgerEntries`),
        where("dayKey", "==", dayKey),
      ),
    ),
    getDocs(collection(db, `${base}/products`)),
  ]);
  const entries = entrySnap.docs.map((d) =>
    entryFromDoc(d.id, d.data() as Record<string, unknown>),
  );
  const aggRef = doc(db, `${base}/dailyAggregates`, dayKey);
  if (entries.length === 0) {
    await deleteDoc(aggRef);
    return;
  }
  const products = productSnap.docs.map((d) =>
    productFromDoc(d.id, d.data() as Record<string, unknown>),
  );
  const agg = computeDailyAggregate(dayKey, entries, productsMap(products));
  await setDoc(aggRef, {
    dayKey: agg.dayKey,
    orderCount: agg.orderCount,
    totalSalesIdr: agg.totalSalesIdr,
    knownCostIdr: agg.knownCostIdr,
    marginIdr: agg.marginIdr,
    marginCoverage: agg.marginCoverage,
    items: agg.items,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Learn prices from a parsed order into the price book: any item with a
 * stated price creates/updates its product's sell price. Cost prices are
 * never invented — they only come from the owner or the demo seed.
 */
export async function learnPrices(
  uid: string,
  items: LedgerItem[],
  source: Product["source"] = "learned",
): Promise<void> {
  const base = `users/${uid}`;
  const jobs = items
    .filter((it) => it.unitPriceIdr > 0 && productKey(it.name))
    .map((it) =>
      setDoc(
        doc(db, `${base}/products`, productKey(it.name)),
        {
          name: it.name,
          sellPriceIdr: it.unitPriceIdr,
          updatedAt: serverTimestamp(),
          source,
        },
        { merge: true },
      ),
    );
  await Promise.all(jobs);
}

export interface NewLedgerEntry {
  buyer: string;
  items: LedgerItem[];
  notes: string;
  inferenceSource: InferenceSourceLabel | null;
  source: LedgerEntry["source"];
  /** Defaults to now. */
  at?: Date;
}

/** Persist one sale, learn its prices, and refresh the day's aggregate. */
export async function addLedgerEntry(
  uid: string,
  entry: NewLedgerEntry,
): Promise<void> {
  const base = `users/${uid}`;
  const at = entry.at ?? new Date();
  const totalIdr = entry.items.reduce(
    (sum, it) => sum + it.qty * it.unitPriceIdr,
    0,
  );
  await addDoc(collection(db, `${base}/ledgerEntries`), {
    buyer: entry.buyer,
    items: entry.items,
    notes: entry.notes,
    totalIdr,
    inferenceSource: entry.inferenceSource,
    source: entry.source,
    dayKey: dayKeyOf(at),
    createdAt: Timestamp.fromDate(at),
  });
  await learnPrices(uid, entry.items);
  await recomputeDayAggregate(uid, dayKeyOf(at));
}

/** Create or update a price-book product (owner edit). */
export async function upsertProduct(
  uid: string,
  product: {
    name: string;
    sellPriceIdr: number;
    costPriceIdr: number;
    source?: Product["source"];
  },
): Promise<void> {
  const key = productKey(product.name);
  if (!key) throw new Error("Product name is empty.");
  await setDoc(
    doc(db, `users/${uid}/products`, key),
    {
      name: product.name,
      sellPriceIdr: Math.max(0, Math.round(product.sellPriceIdr)),
      costPriceIdr: Math.max(0, Math.round(product.costPriceIdr)),
      source: product.source ?? "manual",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  // Cost changes alter margin estimates: refresh every known day.
  const days = [...state.aggregates.keys()];
  await Promise.all(days.map((d) => recomputeDayAggregate(uid, d)));
}

export async function deleteProduct(uid: string, productId: string) {
  await deleteDoc(doc(db, `users/${uid}/products`, productId));
  const days = [...state.aggregates.keys()];
  await Promise.all(days.map((d) => recomputeDayAggregate(uid, d)));
}

/** Save a generated daily recap (cached so re-opening the app is free). */
export async function saveRecap(uid: string, recap: DailyRecap) {
  const { createdAtMs: _omit, ...rest } = recap;
  void _omit;
  await setDoc(doc(db, `users/${uid}/recaps`, recap.dayKey), {
    ...rest,
    createdAt: serverTimestamp(),
  });
}

export async function loadRecap(
  uid: string,
  dayKey: string,
): Promise<DailyRecap | null> {
  const snap = await getDoc(doc(db, `users/${uid}/recaps`, dayKey));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return {
    dayKey,
    headline: String(data.headline ?? ""),
    highlights: Array.isArray(data.highlights)
      ? (data.highlights as string[])
      : [],
    advice: String(data.advice ?? ""),
    inferenceSource:
      (data.inferenceSource as InferenceSourceLabel) ?? "unknown",
    stats: data.stats as DailyRecap["stats"],
    createdAtMs: toMs(data.createdAt),
  };
}

/** Save a generated weekly report and return its id. */
export async function saveReport(
  uid: string,
  report: Omit<WeeklyReport, "id" | "createdAtMs">,
): Promise<string> {
  const ref = await addDoc(collection(db, `users/${uid}/reports`), {
    ...report,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function loadLatestReport(
  uid: string,
): Promise<WeeklyReport | null> {
  const snap = await getDocs(
    query(
      collection(db, `users/${uid}/reports`),
      orderBy("createdAt", "desc"),
      limit(1),
    ),
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    rangeStart: String(data.rangeStart ?? ""),
    rangeEnd: String(data.rangeEnd ?? ""),
    summary: String(data.summary ?? ""),
    marginAnalysis: String(data.marginAnalysis ?? ""),
    bestSellers: Array.isArray(data.bestSellers)
      ? (data.bestSellers as string[])
      : [],
    restockPlan: Array.isArray(data.restockPlan)
      ? (data.restockPlan as WeeklyReport["restockPlan"])
      : [],
    supplierMessage: String(data.supplierMessage ?? ""),
    risks: Array.isArray(data.risks) ? (data.risks as string[]) : [],
    inferenceSource:
      (data.inferenceSource as InferenceSourceLabel) ?? "unknown",
    stats: data.stats as WeeklyReport["stats"],
    createdAtMs: toMs(data.createdAt),
  };
}

/** Mark/clear the demo-seeded flag on the shop profile. */
export async function setDemoSeeded(uid: string, seeded: boolean) {
  await setDoc(
    doc(db, `users/${uid}`),
    { demoSeeded: seeded, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Batched delete helper for demo removal. */
export async function deleteDocsBySource(
  uid: string,
  subcollection: string,
  source: string,
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(db, `users/${uid}/${subcollection}`),
      where("source", "==", source),
    ),
  );
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
}
