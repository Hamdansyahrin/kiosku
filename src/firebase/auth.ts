import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";
import { app } from "./app";

export const auth: Auth = getAuth(app);

export type AuthState =
  | { status: "loading" }
  | { status: "signed-in"; user: User }
  | { status: "error"; error: string };

type Listener = (state: AuthState) => void;

const listeners = new Set<Listener>();
let state: AuthState = { status: "loading" };
let started = false;

function setState(next: AuthState) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function init() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      setState({ status: "signed-in", user });
      return;
    }
    // First run (or signed out): anonymous sign-in keeps the barrier to
    // entry at zero for a warung owner; the account can be upgraded to
    // Google later without losing the shop's data (same uid via linking).
    signInAnonymously(auth).catch((e: unknown) => {
      setState({ status: "error", error: describeError(e) });
    });
  });
}

/** Subscribe to auth state. The first subscriber starts the auth flow. */
export function subscribeAuth(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  if (!started) {
    started = true;
    init();
  }
  return () => {
    listeners.delete(fn);
  };
}

export function getAuthState(): AuthState {
  return state;
}

/**
 * Upgrade path: link the anonymous account to Google so the owner keeps the
 * same uid (and therefore the same shop data) across devices. If the Google
 * account is already tied to a different KiosKu account, fall back to a plain
 * Google sign-in.
 */
export async function upgradeWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  const current = auth.currentUser;
  if (current && current.isAnonymous) {
    try {
      await linkWithPopup(current, provider);
      return;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "auth/credential-already-in-use") throw e;
      // fall through to plain sign-in below
    }
  }
  await signInWithPopup(auth, provider);
}
