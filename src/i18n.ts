/**
 * Bilingual UI (Indonesian / English). Indonesian is the default — it is
 * the shop owner's language — with English one tap away, because the
 * #BuildHybridAI judges read English (the Devpost testing instructions
 * point them at this toggle). The choice persists in localStorage.
 */

export type Lang = "id" | "en";

const en = {
  taglinePre:
    "AI back-office for Indonesian warung owners — order chats become a ledger ",
  taglineDevice: "on-device",
  taglineMid: ", business insight comes from the ",
  taglineCloud: "cloud",
  taglinePost: ".",
  signingIn: "Signing in…",
  authError: "Auth error",
  anonymousAccount: "Anonymous account",
  googleAccount: "Google account",
  upgradeToGoogle: "Upgrade to Google",
  openingGoogle: "Opening Google…",

  statusTitle: "Connection & AI status",
  onDeviceModel: "On-device model (Gemini Nano)",
  dsReady: "On-device ready",
  dsDownloading: "Downloading model…",
  dsChecking: "Checking…",
  dsUnavailable: "On-device unavailable",
  dsCloudOnly: "Cloud only on this browser",
  dsUnknown: "Not probed yet",
  enableOnDevice: "Enable on-device AI",
  enableHint:
    "Downloads Gemini Nano in this browser (needs your click). Until then, hybrid features fall back to cloud Gemini and say so.",
  lastInference: "Last inference ran on",
  appCheck: "App Check",
  appCheckDebug: "Debug provider (localhost)",
  appCheckProd: "reCAPTCHA Enterprise",
  routingThreshold: "Routing threshold (Remote Config)",
  routingThresholdText: "Inputs > {n} chars go cloud-only",
  firestoreLabel: "Firestore",
  runHealthcheck: "Run healthcheck write/read",
  checking: "Checking…",
  healthcheckHint:
    "Writes healthcheck/{uid} and reads it back, proving the data path end-to-end.",

  badgeOnDevice: "On-device · Gemini Nano",
  badgeCloud: "Cloud · Gemini",
  badgeUnknown: "Path not reported",
  badgeNone: "No inference ran",
  badgeDemo: "Demo data",

  demoTitle: "Demo warung",
  demoText:
    "New here? Load a seeded demo shop — a 15-product price book and 7 days of plausible sales — to see the full product in 30 seconds. Demo data is labelled everywhere and can be removed with one tap; it is sample data, not AI output.",
  loadDemo: "Load demo warung",
  seeding: "Seeding…",
  removeDemo: "Remove demo data",
  removing: "Removing…",
  demoLoaded: "Demo loaded: {entries} sales across {days} days, {products} products.",
  demoRemoved: "Demo data removed ({n} documents).",
  demoActive: "Demo data is loaded in this shop.",

  intakeTitle: "Order intake — WhatsApp chat → structured ledger entry",
  intakeTextPre: "Paste a customer's order message. Short messages route ",
  intakeTextDevice: "prefer-on-device",
  intakeTextMid: " (private, offline-capable); long pastes route ",
  intakeTextCloud: "cloud-only",
  intakeTextPost:
    " by design. The badge on each result is the path that actually ran. Confirmed orders are saved to your Firestore ledger, and prices are learned into the price book.",
  parseOrder: "Parse order",
  parsing: "Parsing…",
  chars: "chars",
  parseFailed: "Parse failed",
  parseAppCheckHint:
    "On localhost this is expected until the App Check debug token printed in the browser console is registered in the Firebase console (see README).",
  savedToLedger: "Saved to ledger",
  priceFilledNote: "Prices filled from your price book for:",

  ledgerTitle: "Ledger",
  ledgerEmpty:
    "No entries yet — parse the sample order above, or load the demo warung.",
  ledgerLoading: "Loading your shop data…",
  ledgerError:
    "Shop data could not be loaded. Until the Firestore security rules are deployed, the backend denies access — the exact error is:",
  unknownBuyer: "Unknown buyer",
  priceNa: "price n/a",
  noteLabel: "Note",
  total: "Total",
  dayTotal: "Day total",

  bookTitle: "Price book",
  bookHint:
    "Sell prices are learned automatically from parsed orders. Add cost (modal) prices to unlock margin estimates — margins are only estimated over products whose cost is known.",
  colProduct: "Product",
  colSell: "Sell price",
  colCost: "Cost price",
  colSource: "Source",
  colActions: "",
  bookEmpty: "No products yet — parse an order with prices, or load the demo warung.",
  addProduct: "Add product",
  productName: "Product name",
  save: "Save",
  cancel: "Cancel",
  edit: "Edit",
  delete: "Delete",
  srcLearned: "learned",
  srcDemo: "demo",
  srcManual: "manual",

  recapTitle: "Daily recap",
  recapText:
    "End-of-day summary of today's numbers — a short, private job, so it runs prefer-on-device (Gemini Nano) with cloud fallback. Figures are computed from the ledger; the AI only narrates them.",
  generateRecap: "Generate today's recap",
  generating: "Generating…",
  recapEmpty: "No sales recorded today yet.",
  recapFailed: "Recap failed",
  statOrders: "Orders",
  statSales: "Sales",
  statMargin: "Est. margin",
  statTopItem: "Top item",
  marginUnknown: "unknown — add cost prices",
  adviceLabel: "Suggestion",
  recapCached: "Saved recap from {time} — regenerate to refresh.",

  weeklyTitle: "Weekly report",
  weeklyText:
    "The week's ledger analyzed in the cloud (long-context work, cloud-only by design): margins, best sellers, a restock plan, and a ready-to-send supplier WhatsApp message.",
  generateWeekly: "Generate weekly report",
  generatingWeekly: "Analyzing the week…",
  weeklyEmpty: "No sales in the last 7 days yet — load the demo warung to try this instantly.",
  weeklyFailed: "Weekly report failed",
  reportSummary: "Summary",
  reportMargins: "Margin analysis",
  reportBest: "Best sellers",
  reportRestock: "Restock plan",
  reportSupplier: "Supplier WhatsApp message",
  reportRisks: "Watch-outs",
  copyMessage: "Copy message",
  copied: "Copied",
  reportCached: "Saved report from {time}.",
  weekOrders: "orders",
  weekSales: "sales",

  logTitle: "Routing log",
  logEmpty:
    "Every inference call lands here — feature, mode requested, path that actually ran, latency.",
  logFailed: "FAILED",

  footer:
    "KiosKu — #BuildHybridAI 2026 entry. Hybrid inference via Firebase AI Logic (Gemini Nano on-device + Gemini in the cloud). Apache-2.0.",
  language: "Language",
};

export type Strings = typeof en;

const id: Strings = {
  taglinePre:
    "Back-office AI untuk pemilik warung Indonesia — chat pesanan menjadi buku kas ",
  taglineDevice: "di perangkat",
  taglineMid: ", insight bisnis datang dari ",
  taglineCloud: "cloud",
  taglinePost: ".",
  signingIn: "Masuk…",
  authError: "Error autentikasi",
  anonymousAccount: "Akun anonim",
  googleAccount: "Akun Google",
  upgradeToGoogle: "Tautkan Google",
  openingGoogle: "Membuka Google…",

  statusTitle: "Status koneksi & AI",
  onDeviceModel: "Model di perangkat (Gemini Nano)",
  dsReady: "Siap di perangkat",
  dsDownloading: "Mengunduh model…",
  dsChecking: "Memeriksa…",
  dsUnavailable: "Tidak tersedia di perangkat",
  dsCloudOnly: "Hanya cloud di browser ini",
  dsUnknown: "Belum diperiksa",
  enableOnDevice: "Aktifkan AI di perangkat",
  enableHint:
    "Mengunduh Gemini Nano di browser ini (perlu klik Anda). Sebelum itu, fitur hybrid memakai cloud Gemini dan menampilkannya apa adanya.",
  lastInference: "Inferensi terakhir berjalan di",
  appCheck: "App Check",
  appCheckDebug: "Provider debug (localhost)",
  appCheckProd: "reCAPTCHA Enterprise",
  routingThreshold: "Ambang perutean (Remote Config)",
  routingThresholdText: "Input > {n} karakter langsung ke cloud",
  firestoreLabel: "Firestore",
  runHealthcheck: "Jalankan cek tulis/baca",
  checking: "Memeriksa…",
  healthcheckHint:
    "Menulis healthcheck/{uid} lalu membacanya kembali, membuktikan jalur data ujung ke ujung.",

  badgeOnDevice: "Di perangkat · Gemini Nano",
  badgeCloud: "Cloud · Gemini",
  badgeUnknown: "Jalur tidak dilaporkan",
  badgeNone: "Tanpa inferensi",
  badgeDemo: "Data demo",

  demoTitle: "Warung demo",
  demoText:
    "Baru di sini? Muat warung demo — buku harga 15 produk dan 7 hari penjualan contoh — untuk melihat produk utuhnya dalam 30 detik. Data demo diberi label di semua tempat dan bisa dihapus sekali tap; ini data contoh, bukan hasil AI.",
  loadDemo: "Muat warung demo",
  seeding: "Memuat…",
  removeDemo: "Hapus data demo",
  removing: "Menghapus…",
  demoLoaded: "Demo dimuat: {entries} penjualan dalam {days} hari, {products} produk.",
  demoRemoved: "Data demo dihapus ({n} dokumen).",
  demoActive: "Data demo sedang dimuat di toko ini.",

  intakeTitle: "Pesanan masuk — chat WhatsApp → entri buku kas terstruktur",
  intakeTextPre: "Tempel pesan pesanan pelanggan. Pesan pendek dirutekan ",
  intakeTextDevice: "utamakan di perangkat",
  intakeTextMid: " (privat, bisa offline); tempelan panjang dirutekan ",
  intakeTextCloud: "khusus cloud",
  intakeTextPost:
    " secara sengaja. Lencana pada setiap hasil adalah jalur yang benar-benar berjalan. Pesanan yang dikonfirmasi tersimpan ke buku kas Firestore Anda, dan harganya dipelajari ke buku harga.",
  parseOrder: "Urai pesanan",
  parsing: "Mengurai…",
  chars: "karakter",
  parseFailed: "Penguraian gagal",
  parseAppCheckHint:
    "Di localhost ini wajar terjadi sampai token debug App Check yang tercetak di konsol browser didaftarkan di Firebase console (lihat README).",
  savedToLedger: "Tersimpan di buku kas",
  priceFilledNote: "Harga diisi dari buku harga Anda untuk:",

  ledgerTitle: "Buku kas",
  ledgerEmpty:
    "Belum ada entri — urai contoh pesanan di atas, atau muat warung demo.",
  ledgerLoading: "Memuat data toko Anda…",
  ledgerError:
    "Data toko tidak dapat dimuat. Sampai aturan keamanan Firestore diterapkan, backend menolak akses — error persisnya:",
  unknownBuyer: "Pembeli tak dikenal",
  priceNa: "harga tdk ada",
  noteLabel: "Catatan",
  total: "Total",
  dayTotal: "Total hari itu",

  bookTitle: "Buku harga",
  bookHint:
    "Harga jual dipelajari otomatis dari pesanan yang diurai. Tambahkan harga modal untuk membuka estimasi margin — margin hanya diestimasi atas produk yang modalnya diketahui.",
  colProduct: "Produk",
  colSell: "Harga jual",
  colCost: "Harga modal",
  colSource: "Sumber",
  colActions: "",
  bookEmpty: "Belum ada produk — urai pesanan berharga, atau muat warung demo.",
  addProduct: "Tambah produk",
  productName: "Nama produk",
  save: "Simpan",
  cancel: "Batal",
  edit: "Ubah",
  delete: "Hapus",
  srcLearned: "dipelajari",
  srcDemo: "demo",
  srcManual: "manual",

  recapTitle: "Rekap harian",
  recapText:
    "Ringkasan akhir hari dari angka hari ini — pekerjaan singkat dan privat, jadi berjalan utamakan di perangkat (Gemini Nano) dengan cadangan cloud. Angka dihitung dari buku kas; AI hanya menarasikannya.",
  generateRecap: "Buat rekap hari ini",
  generating: "Membuat…",
  recapEmpty: "Belum ada penjualan tercatat hari ini.",
  recapFailed: "Rekap gagal",
  statOrders: "Pesanan",
  statSales: "Penjualan",
  statMargin: "Estimasi margin",
  statTopItem: "Terlaris",
  marginUnknown: "tidak diketahui — isi harga modal",
  adviceLabel: "Saran",
  recapCached: "Rekap tersimpan dari {time} — buat ulang untuk menyegarkan.",

  weeklyTitle: "Laporan mingguan",
  weeklyText:
    "Buku kas seminggu dianalisis di cloud (pekerjaan konteks panjang, sengaja khusus cloud): margin, produk terlaris, rencana kulakan, dan pesan WhatsApp siap kirim untuk supplier.",
  generateWeekly: "Buat laporan mingguan",
  generatingWeekly: "Menganalisis minggu ini…",
  weeklyEmpty: "Belum ada penjualan dalam 7 hari terakhir — muat warung demo untuk mencobanya langsung.",
  weeklyFailed: "Laporan mingguan gagal",
  reportSummary: "Ringkasan",
  reportMargins: "Analisis margin",
  reportBest: "Produk terlaris",
  reportRestock: "Rencana kulakan",
  reportSupplier: "Pesan WhatsApp untuk supplier",
  reportRisks: "Perlu diwaspadai",
  copyMessage: "Salin pesan",
  copied: "Tersalin",
  reportCached: "Laporan tersimpan dari {time}.",
  weekOrders: "pesanan",
  weekSales: "penjualan",

  logTitle: "Log perutean",
  logEmpty:
    "Setiap panggilan inferensi tercatat di sini — fitur, mode yang diminta, jalur yang benar-benar berjalan, latensi.",
  logFailed: "GAGAL",

  footer:
    "KiosKu — entri #BuildHybridAI 2026. Inferensi hybrid via Firebase AI Logic (Gemini Nano di perangkat + Gemini di cloud). Apache-2.0.",
  language: "Bahasa",
};

export const STRINGS: Record<Lang, Strings> = { en, id };

const STORAGE_KEY = "kiosku-lang";

let lang: Lang = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en" ? "en" : "id";
  } catch {
    return "id";
  }
})();

const listeners = new Set<() => void>();

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // storage unavailable (private mode): language just won't persist.
  }
  listeners.forEach((fn) => fn());
}

/** Fill {name} placeholders in a string. */
export function fmt(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(vars[key] ?? `{${key}}`),
  );
}
