import type { InferenceSourceLabel } from "../ai/types";

/**
 * KiosKu shop data model. Everything lives under users/{uid}/ in
 * Firestore (see firestore.rules — owner-only access):
 *
 *   users/{uid}                                  shop profile
 *   users/{uid}/ledgerEntries/{entryId}          one sale (from a parsed
 *                                                order, demo seed, or a
 *                                                manual entry)
 *   users/{uid}/products/{productId}             the price book — product
 *                                                id is the normalized name
 *                                                slug, so learning a price
 *                                                twice updates one doc
 *   users/{uid}/dailyAggregates/{dayKey}         per-day rollup, recomputed
 *                                                from the day's entries on
 *                                                every write (single-owner
 *                                                shop: no contention)
 *   users/{uid}/recaps/{dayKey}                  cached daily recap (AI
 *                                                narrative + stats snapshot)
 *   users/{uid}/reports/{reportId}               cached weekly reports
 */

export interface LedgerItem {
  name: string;
  qty: number;
  /** Unit sell price in rupiah; 0 when unknown. */
  unitPriceIdr: number;
}

export type LedgerSource = "ai-parse" | "demo" | "manual";

export interface LedgerEntry {
  id: string;
  buyer: string;
  items: LedgerItem[];
  notes: string;
  /** Sum of qty * unitPriceIdr. */
  totalIdr: number;
  /**
   * The inference path that produced this entry, from the SDK's
   * `response.inferenceSource`. Null when no inference ran (demo seed,
   * manual entry) — the UI badges those honestly instead of inventing a
   * path.
   */
  inferenceSource: InferenceSourceLabel | null;
  source: LedgerSource;
  /** Local calendar day, "YYYY-MM-DD". */
  dayKey: string;
  /** Epoch ms of the sale. */
  createdAtMs: number;
}

export interface Product {
  /** Document id: normalized-name slug. */
  id: string;
  name: string;
  /** Current sell price in rupiah; 0 when never learned. */
  sellPriceIdr: number;
  /** Cost (modal) price in rupiah; 0 when unknown — margins are only
   *  estimated over items whose cost is known. */
  costPriceIdr: number;
  source: "learned" | "demo" | "manual";
  updatedAtMs: number;
}

export interface ItemTotal {
  name: string;
  qty: number;
  revenueIdr: number;
  /** Cost total, or null when the cost price is unknown. */
  costIdr: number | null;
}

export interface DailyAggregate {
  dayKey: string;
  orderCount: number;
  totalSalesIdr: number;
  /** Cost total over items with a known cost price; null when none known. */
  knownCostIdr: number | null;
  /** Estimated gross margin (sales − known cost); null when no cost known. */
  marginIdr: number | null;
  /** Share of revenue covered by items with a known cost price, 0..1. */
  marginCoverage: number;
  /** Item totals for the day, sorted by revenue desc. */
  items: ItemTotal[];
  updatedAtMs: number;
}

export interface DailyRecap {
  dayKey: string;
  headline: string;
  highlights: string[];
  advice: string;
  inferenceSource: InferenceSourceLabel;
  /** Stats snapshot the narrative was generated from. */
  stats: {
    orderCount: number;
    totalSalesIdr: number;
    marginIdr: number | null;
    topItemName: string;
  };
  createdAtMs: number;
}

export interface RestockItem {
  product: string;
  qtySuggestion: string;
  reason: string;
}

export interface WeeklyReport {
  id: string;
  /** Inclusive range, "YYYY-MM-DD". */
  rangeStart: string;
  rangeEnd: string;
  summary: string;
  marginAnalysis: string;
  bestSellers: string[];
  restockPlan: RestockItem[];
  /** Ready-to-send supplier WhatsApp message (Indonesian). */
  supplierMessage: string;
  risks: string[];
  inferenceSource: InferenceSourceLabel;
  stats: {
    orderCount: number;
    totalSalesIdr: number;
    marginIdr: number | null;
    marginCoverage: number;
  };
  createdAtMs: number;
}

/** "YYYY-MM-DD" for a Date in local time. */
export function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return dayKeyOf(new Date());
}

/** Normalized product-name key: the price book's identity for a product. */
export function productKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
