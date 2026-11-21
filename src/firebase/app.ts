import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { firebaseConfig } from "./config";

/**
 * App Check wiring.
 *
 * AI Logic enforces App Check for this project ("Basic - Enforced"), so every
 * AI call must carry a valid App Check token.
 *
 * LOCAL DEVELOPMENT (localhost / 127.0.0.1): we switch the SDK into its debug
 * provider BEFORE initializeAppCheck runs. With the debug flag set, the SDK
 * ignores the attestation provider below and instead uses a per-browser debug
 * token: on first run it generates one, persists it in IndexedDB, and prints
 * it to the browser console as:
 *
 *     Firebase App Check debug token: <token>
 *
 * That token must be registered once by the project owner in the Firebase
 * console (App Check -> Apps -> "KiosKu Web" -> Manage debug tokens) before
 * local AI calls succeed. Full steps are in the project README
 * ("App Check: registering the local debug token"). We never invent or commit
 * a debug token — it is unique per browser profile.
 *
 * PRODUCTION: the reCAPTCHA Enterprise provider is used with the site key
 * provided at build time via VITE_APPCHECK_SITE_KEY. The production provider
 * registration in the console is a separate deploy-stage step.
 */
const isLocalhost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

if (isLocalhost) {
  // Must be set before initializeAppCheck() is called.
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean })[
    "FIREBASE_APPCHECK_DEBUG_TOKEN"
  ] = true;
}

export const app: FirebaseApp = initializeApp(firebaseConfig);

export const appCheck: AppCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(
    import.meta.env.VITE_APPCHECK_SITE_KEY ?? "APPCHECK_SITE_KEY_NOT_CONFIGURED",
  ),
  isTokenAutoRefreshEnabled: true,
});

/** True when running on localhost, i.e. App Check uses the debug provider. */
export const appCheckDebugMode = isLocalhost;
