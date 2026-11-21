import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { app } from "./app";

export const db: Firestore = getFirestore(app);

export interface HealthcheckResult {
  ok: boolean;
  /** Human-readable outcome, including the exact backend error when it fails. */
  detail: string;
  /** The document as read back from Firestore, when the round-trip succeeds. */
  data?: Record<string, unknown>;
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    return code ? `${code}: ${e.message}` : e.message;
  }
  return String(e);
}

/**
 * Prove the Firestore path end-to-end: write a `healthcheck/{uid}` document
 * and read it back. Stage 1 uses this to verify project wiring; the shop's
 * real collections (products, orders, ledgerEntries, reports) land in
 * stage 2.
 *
 * Note: the project was created with Firestore in production mode, whose
 * starter rules deny all client access until real rules are deployed. Until
 * then this returns ok:false with a permission-denied detail — surfaced
 * honestly in the UI rather than hidden.
 */
export async function runFirestoreHealthcheck(
  uid: string,
): Promise<HealthcheckResult> {
  const ref = doc(db, "healthcheck", uid);
  try {
    await setDoc(
      ref,
      {
        app: "kiosku",
        client: "web",
        at: serverTimestamp(),
        userAgent: navigator.userAgent,
      },
      { merge: true },
    );
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return { ok: false, detail: "Write completed but the document did not read back." };
    }
    return {
      ok: true,
      detail: "Firestore write + read-back succeeded.",
      data: snap.data() as Record<string, unknown>,
    };
  } catch (e: unknown) {
    return { ok: false, detail: describeError(e) };
  }
}
