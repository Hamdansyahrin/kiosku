import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase/firestore";
import {
  deleteDocsBySource,
  recomputeDayAggregate,
  setDemoSeeded,
} from "./ledger";
import { dayKeyOf, productKey } from "./types";

/**
 * Seeded demo warung.
 *
 * One tap gives judges a believable shop: a 15-product price book (with
 * cost prices, so margin estimates work) and 7 days of sales. The data is
 * DETERMINISTIC — a fixed-seed PRNG over a hand-written catalog of
 * plausible warung products, buyers and prices. No AI call is involved in
 * creating it, and every seeded entry is stored with source: "demo" and
 * inferenceSource: null, so the UI badges it as demo data and never
 * pretends a model produced it. "Remove demo data" deletes exactly the
 * documents carrying that source flag.
 */

interface DemoProduct {
  name: string;
  sellPriceIdr: number;
  costPriceIdr: number;
}

const CATALOG: DemoProduct[] = [
  { name: "Beras 5 kg", sellPriceIdr: 68000, costPriceIdr: 59500 },
  { name: "Minyak goreng 2 L", sellPriceIdr: 31000, costPriceIdr: 26500 },
  { name: "Telur ayam 1 kg", sellPriceIdr: 27000, costPriceIdr: 23000 },
  { name: "Gula pasir 1 kg", sellPriceIdr: 17000, costPriceIdr: 14500 },
  { name: "Kopi Kapal Api renceng", sellPriceIdr: 12000, costPriceIdr: 9500 },
  { name: "Indomie goreng", sellPriceIdr: 3500, costPriceIdr: 2900 },
  { name: "Susu kental manis", sellPriceIdr: 12000, costPriceIdr: 10200 },
  { name: "Teh celup Sariwangi", sellPriceIdr: 6500, costPriceIdr: 5200 },
  { name: "Sabun cuci piring", sellPriceIdr: 10000, costPriceIdr: 8200 },
  { name: "Gas LPG 3 kg", sellPriceIdr: 21000, costPriceIdr: 18500 },
  { name: "Air galon isi ulang", sellPriceIdr: 6000, costPriceIdr: 4000 },
  { name: "Rokok Surya 12", sellPriceIdr: 26000, costPriceIdr: 23800 },
  { name: "Kecap manis 600 ml", sellPriceIdr: 22000, costPriceIdr: 18500 },
  { name: "Tepung terigu 1 kg", sellPriceIdr: 13000, costPriceIdr: 10800 },
  { name: "Mie telur 200 g", sellPriceIdr: 5500, costPriceIdr: 4400 },
];

const BUYERS = [
  "Bu Rina",
  "Pak Budi",
  "Bu Sari",
  "Pak Joko",
  "Bu Tini",
  "Pak Agus",
  "Mbak Dewi",
  "Pak Slamet",
  "Bu Ani",
  "Pak Dedi",
];

const NOTES = [
  "Bayar transfer",
  "Diantar ke rumah",
  "Bon dulu, bayar Jumat",
  "Ambil sendiri sore",
  "",
  "",
];

/** mulberry32 — tiny deterministic PRNG; same seed, same demo shop. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoEntry {
  buyer: string;
  items: { name: string; qty: number; unitPriceIdr: number }[];
  notes: string;
  at: Date;
}

function generateDemoEntries(now: Date): DemoEntry[] {
  const rand = mulberry32(20261121);
  const entries: DemoEntry[] = [];
  // 7 days: six days ago .. today.
  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const day = new Date(now);
    day.setDate(day.getDate() - dayOffset);
    const orderCount = 3 + Math.floor(rand() * 4); // 3..6 orders/day
    for (let o = 0; o < orderCount; o++) {
      const itemCount = 1 + Math.floor(rand() * 4); // 1..4 items
      const picked = new Set<number>();
      const items: DemoEntry["items"] = [];
      for (let i = 0; i < itemCount; i++) {
        let idx = Math.floor(rand() * CATALOG.length);
        while (picked.has(idx)) idx = Math.floor(rand() * CATALOG.length);
        picked.add(idx);
        const product = CATALOG[idx];
        items.push({
          name: product.name,
          qty: 1 + Math.floor(rand() * 6),
          unitPriceIdr: product.sellPriceIdr,
        });
      }
      const at = new Date(day);
      at.setHours(6 + Math.floor(rand() * 14), Math.floor(rand() * 60), 0, 0);
      // Never seed sales in the future (today's later hours).
      if (at.getTime() > now.getTime()) at.setTime(now.getTime() - 30 * 60000);
      entries.push({
        buyer: BUYERS[Math.floor(rand() * BUYERS.length)],
        items,
        notes: NOTES[Math.floor(rand() * NOTES.length)],
        at,
      });
    }
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface SeedResult {
  productsWritten: number;
  entriesWritten: number;
  days: string[];
}

/** Seed the demo shop. Existing price-book products are never clobbered:
 *  a product the owner (or real parsing) already created is left alone. */
export async function seedDemoShop(uid: string): Promise<SeedResult> {
  const base = `users/${uid}`;
  const now = new Date();

  let productsWritten = 0;
  for (const product of CATALOG) {
    const ref = doc(db, `${base}/products`, productKey(product.name));
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await setDoc(ref, {
      name: product.name,
      sellPriceIdr: product.sellPriceIdr,
      costPriceIdr: product.costPriceIdr,
      source: "demo",
      updatedAt: Timestamp.fromDate(now),
    });
    productsWritten++;
  }

  const entries = generateDemoEntries(now);
  const days = new Set<string>();
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    for (const entry of entries.slice(i, i + 400)) {
      const totalIdr = entry.items.reduce(
        (sum, it) => sum + it.qty * it.unitPriceIdr,
        0,
      );
      days.add(dayKeyOf(entry.at));
      batch.set(doc(collection(db, `${base}/ledgerEntries`)), {
        buyer: entry.buyer,
        items: entry.items,
        notes: entry.notes,
        totalIdr,
        inferenceSource: null,
        source: "demo",
        dayKey: dayKeyOf(entry.at),
        createdAt: Timestamp.fromDate(entry.at),
      });
    }
    await batch.commit();
  }

  for (const dayKey of days) {
    await recomputeDayAggregate(uid, dayKey);
  }
  await setDemoSeeded(uid, true);
  return {
    productsWritten,
    entriesWritten: entries.length,
    days: [...days].sort(),
  };
}

/** Remove exactly the demo-seeded documents and rebuild the aggregates
 *  of the affected days from whatever real data remains. */
export async function removeDemoShop(uid: string): Promise<{ removed: number }> {
  const base = `users/${uid}`;
  const demoSnap = await getDocs(
    query(
      collection(db, `${base}/ledgerEntries`),
      where("source", "==", "demo"),
    ),
  );
  const days = new Set<string>();
  demoSnap.docs.forEach((d) => {
    const dayKey = (d.data() as Record<string, unknown>).dayKey;
    if (typeof dayKey === "string") days.add(dayKey);
  });

  const removedEntries = await deleteDocsBySource(uid, "ledgerEntries", "demo");
  const removedProducts = await deleteDocsBySource(uid, "products", "demo");
  for (const dayKey of days) {
    await recomputeDayAggregate(uid, dayKey);
  }
  await setDemoSeeded(uid, false);
  return { removed: removedEntries + removedProducts };
}
