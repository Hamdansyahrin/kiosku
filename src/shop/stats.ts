import {
  productKey,
  type DailyAggregate,
  type ItemTotal,
  type LedgerEntry,
  type Product,
} from "./types";

/**
 * Deterministic shop math. The AI never invents numbers: totals, rankings
 * and margin estimates are computed here from the ledger + price book, and
 * the AI features only narrate these figures. Margins are estimated only
 * over items whose cost price is known, and the coverage share is always
 * reported alongside so a partial estimate is never dressed up as exact.
 */
export function computeDailyAggregate(
  dayKey: string,
  entries: LedgerEntry[],
  products: Map<string, Product>,
): DailyAggregate {
  const byItem = new Map<string, ItemTotal>();
  let totalSalesIdr = 0;

  for (const entry of entries) {
    for (const item of entry.items) {
      const revenue = item.qty * item.unitPriceIdr;
      totalSalesIdr += revenue;
      const key = productKey(item.name);
      const existing = byItem.get(key);
      const product = products.get(key);
      const cost =
        product && product.costPriceIdr > 0
          ? item.qty * product.costPriceIdr
          : null;
      if (existing) {
        existing.qty += item.qty;
        existing.revenueIdr += revenue;
        if (cost !== null) {
          existing.costIdr = (existing.costIdr ?? 0) + cost;
        }
      } else {
        byItem.set(key, {
          name: item.name,
          qty: item.qty,
          revenueIdr: revenue,
          costIdr: cost,
        });
      }
    }
  }

  const items = [...byItem.values()].sort(
    (a, b) => b.revenueIdr - a.revenueIdr,
  );

  let knownCostIdr: number | null = null;
  let knownRevenueIdr = 0;
  for (const item of items) {
    if (item.costIdr !== null) {
      knownCostIdr = (knownCostIdr ?? 0) + item.costIdr;
      knownRevenueIdr += item.revenueIdr;
    }
  }

  return {
    dayKey,
    orderCount: entries.length,
    totalSalesIdr,
    knownCostIdr,
    marginIdr: knownCostIdr !== null ? knownRevenueIdr - knownCostIdr : null,
    marginCoverage: totalSalesIdr > 0 ? knownRevenueIdr / totalSalesIdr : 0,
    items,
    updatedAtMs: Date.now(),
  };
}

export interface WeekStats {
  rangeStart: string;
  rangeEnd: string;
  orderCount: number;
  totalSalesIdr: number;
  marginIdr: number | null;
  marginCoverage: number;
  /** Per-day aggregates, oldest first. */
  days: DailyAggregate[];
  /** Item totals across the whole range, revenue desc. */
  items: ItemTotal[];
  /** Items whose remaining implied stock signal is weakest: highest qty
   *  sold — the deterministic seed of the AI's restock plan. */
  topByQty: ItemTotal[];
}

export function computeWeekStats(
  days: DailyAggregate[],
  rangeStart: string,
  rangeEnd: string,
): WeekStats {
  const byItem = new Map<string, ItemTotal>();
  let orderCount = 0;
  let totalSalesIdr = 0;
  let knownCostIdr: number | null = null;
  let knownRevenueIdr = 0;

  for (const day of days) {
    orderCount += day.orderCount;
    totalSalesIdr += day.totalSalesIdr;
    if (day.knownCostIdr !== null && day.marginIdr !== null) {
      knownCostIdr = (knownCostIdr ?? 0) + day.knownCostIdr;
      knownRevenueIdr += day.marginIdr + day.knownCostIdr;
    }
    for (const item of day.items) {
      const key = productKey(item.name);
      const existing = byItem.get(key);
      if (existing) {
        existing.qty += item.qty;
        existing.revenueIdr += item.revenueIdr;
        if (item.costIdr !== null) {
          existing.costIdr = (existing.costIdr ?? 0) + item.costIdr;
        }
      } else {
        byItem.set(key, { ...item });
      }
    }
  }

  const items = [...byItem.values()].sort(
    (a, b) => b.revenueIdr - a.revenueIdr,
  );
  const topByQty = [...byItem.values()].sort((a, b) => b.qty - a.qty);

  return {
    rangeStart,
    rangeEnd,
    orderCount,
    totalSalesIdr,
    marginIdr: knownCostIdr !== null ? knownRevenueIdr - knownCostIdr : null,
    marginCoverage: totalSalesIdr > 0 ? knownRevenueIdr / totalSalesIdr : 0,
    days,
    items,
    topByQty,
  };
}
