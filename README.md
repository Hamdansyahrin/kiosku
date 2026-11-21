# KiosKu — AI back-office for warung owners

**#BuildHybridAI 2026 entry (Web / Chrome).** KiosKu is an AI back-office for
Indonesia's millions of warung (micro-retail) owners who keep their books on
paper, sell over WhatsApp, and work on unreliable connections.

During the day, **on-device** Gemini Nano turns messy WhatsApp order chats
and quick sales notes into a structured ledger — offline, free, and private:
the shop's numbers never have to leave the device. Back online, **cloud**
Gemini does the heavy, long-context work: margins, best sellers, a restock
plan, and ready-to-send supplier messages. Every AI result is stamped with
the path that actually ran (`response.inferenceSource`) — "On-device ·
Gemini Nano" or "Cloud · Gemini" — because in KiosKu the hybrid split *is*
the product.

**Live demo: https://kiosku-2cda8.web.app** — no sign-up needed (anonymous
sign-in on first load). See "Try it in 30 seconds" below.

> Status: **live.** The full product is deployed — Firestore shop data
> (ledger, price book, daily aggregates) behind owner-only security rules
> (deployed, see "Firestore security rules" below), App Check enforced
> with the production reCAPTCHA Enterprise provider, the daily recap
> (on-device-preferred), the weekly cloud report with supplier-message
> drafting, a seeded demo warung, and a bilingual EN/ID UI.

## The hybrid architecture

All inference goes through **Firebase AI Logic** (`firebase/ai`, Gemini
Developer API backend). Each feature gets its own model instance with its
own `InferenceMode`:

| Feature | Mode | Why |
|---|---|---|
| Order-chat parsing (short input) | `PREFER_ON_DEVICE` | Small, structured, privacy-sensitive; must work offline at the shop. Falls back to cloud Gemini when Nano is unavailable. |
| Order-chat parsing (long input) | `ONLY_IN_CLOUD` | Inputs over a Remote Config threshold (`max_ondevice_input_chars`, default 1500) are long-context work — deliberately forced to the cloud model. |
| Daily recap | `PREFER_ON_DEVICE` | Short narrative over today's deterministically computed numbers. |
| Weekly report | `ONLY_IN_CLOUD` | Margins / best sellers / restock plan / supplier message over a week of ledger data. |

One JSON schema constrains both paths of the parser: it is the cloud
`responseSchema` and — serialized to plain JSON — the on-device
`responseConstraint`. Every call flows through a single routing engine
(`src/ai/engine.ts`) that times the call, reads `response.inferenceSource`,
validates the JSON against the feature's schema before anything trusts it,
retries transient 429/503s with exponential backoff, and appends to a
routing log the UI renders verbatim.

**Firebase services used:** AI Logic (hybrid inference), App Check
(enforced; debug provider locally, reCAPTCHA Enterprise in production),
Authentication (anonymous-first, Google upgrade via account linking),
Firestore (shop data under `users/{uid}/`: ledger entries, price book,
daily aggregates, cached recaps and reports; persistent local cache so
the ledger works on flaky connections), Remote Config (routing
threshold + model selection, tunable without a redeploy).

All money math is deterministic code (`src/shop/stats.ts`): totals,
rankings, and margin estimates are computed from the ledger and the
price book, and the AI features only narrate those figures. Margins are
estimated only over products whose cost price is known, and the
coverage share is always shown next to the estimate.

## Try it in 30 seconds

No credentials needed — the app signs you in anonymously on first load.

1. Open **https://kiosku-2cda8.web.app** (any modern browser; desktop
   Chrome ≥ 139 shows the full hybrid story).
2. Tap **Load demo warung** — a 15-product price book and 7 days of
   sales appear in the ledger (all badged "Demo data").
3. In **Order intake**, tap **Parse order** on the pre-filled sample
   WhatsApp order. The parsed entry is badged with the path that
   actually ran — "Cloud · Gemini" on a browser without Gemini Nano,
   "On-device · Gemini Nano" on a Nano-enabled Chrome. Confirm it into
   the ledger and watch the price book learn.
4. Tap **Generate today's recap** — deterministic totals plus a short
   AI narrative, stamped with its execution path.
5. Tap **Generate weekly report** — margins with coverage, best
   sellers, a restock plan, and a ready-to-send supplier WhatsApp
   message (**Copy message**).
6. Tap **EN** in the header to switch the whole UI between English and
   Indonesian.
7. Scroll to the **Routing log** to see every inference call: feature,
   mode requested, path that ran, latency.
8. *(Optional, for the on-device path)* In desktop Chrome ≥ 139, enable
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`,
   reload, then click **Enable on-device AI** in the status panel and
   let Gemini Nano download. Parse an order with airplane mode on — it
   still works, badged "On-device · Gemini Nano".

## Firestore security rules

`firestore.rules` (repo root) grants each signed-in user access to
exactly their own subtree (`users/{uid}/**`, plus their stage-1
`healthcheck/{uid}` probe document) and denies everything else. **These
rules are deployed on the live project** (verified: owner-path reads and
writes succeed, cross-account access is denied). The project was created
with production starter rules that deny all client access, so the rules
had to be deployed once before any data path worked — the procedure is
kept here for reproducibility:

**Console paste procedure (project owner):**

1. Open the [Firestore rules editor](https://console.firebase.google.com/project/kiosku-2cda8/firestore/rules)
   (Firebase console → project **KiosKu** → Firestore Database → Rules).
2. Select all existing text in the editor and delete it.
3. Paste the entire contents of `firestore.rules` from this repo.
4. Click **Publish**. The change is live within about a minute.
5. Reload the app: the status panel's Firestore healthcheck turns green
   and the ledger / price book / demo seed start working.

Alternatively, with the Firebase CLI: `firebase deploy --only
firestore:rules` from the repo root (`firebase.json` already points at
the rules file).

## Demo warung & language

- **Load demo warung** (in the app) seeds a deterministic demo shop: a
  15-product price book with cost prices and 7 days of plausible sales,
  all stored with `source: "demo"` and badged "Demo data" everywhere.
  No AI call creates it, and **Remove demo data** deletes exactly those
  documents.
- The UI is bilingual: **Indonesian by default** (the owner's language),
  English one tap away via the **ID | EN** toggle in the header.

## Run it locally

Prerequisites: Node 20+, npm. For the on-device path: Chrome desktop ≥ 139
with the Gemini Nano Prompt API flag enabled
(`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`) — without
it, everything still works via cloud fallback.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
```

The Firebase client config in `src/firebase/config.ts` is the project's
public web config (it identifies the project; it is not a secret — access
is governed by Security Rules and App Check).

### App Check: registering the local debug token (required once)

AI Logic enforces App Check on this project, so local AI calls fail until
your browser's debug token is registered. The app already enables the SDK's
debug provider on localhost — you only need to register the token it
generates:

1. Run `npm run dev` and open http://localhost:5173 in Chrome.
2. Open DevTools → Console. On first run the SDK prints:
   `Firebase App Check debug token: <a UUID>` (it persists the token in
   IndexedDB, so it stays stable for that browser profile).
3. In the [Firebase console](https://console.firebase.google.com/project/kiosku-2cda8/appcheck),
   open **App Check → Apps → KiosKu Web → Manage debug tokens**, add the
   token from step 2, and save.
4. Reload the app. Cloud inference calls now pass App Check from this
   browser. (On-device calls never needed the token — Nano runs locally.)

Never commit a debug token to this repo; it is per-developer and grants
your browser access to the project's enforced APIs. Production uses the
reCAPTCHA Enterprise provider instead (site key via `VITE_APPCHECK_SITE_KEY`,
see `.env.example`) — that provider **is registered** for the live site
(Fraud Defense, domains `kiosku-2cda8.web.app` and
`kiosku-2cda8.firebaseapp.com`), so hosted AI calls pass App Check with
no debug token.

### On-device AI

Open the app in a Nano-capable Chrome and click **Enable on-device AI** in
the status panel. The click is required: Chrome only allows the Gemini Nano
download after a user gesture. The panel reports the honest state —
`ready`, `downloading` (with progress), `unavailable`, or `cloud-only` —
and every result badge shows which path actually executed.

## Project layout

```
src/
  firebase/   config, app + App Check init, auth (anonymous + Google
              linking), Firestore (offline-persistent; healthcheck),
              Remote Config (routing knobs)
  ai/         routing engine, routing log store, model factory,
              device-model lifecycle, order parser, daily recap,
              weekly report (schema + validation for each)
  shop/       data model, Firestore data layer (observable store),
              deterministic stats (totals / margins), demo seed data
  i18n.ts     EN/ID string table + language store (ID default)
  App.tsx     status panel, demo card, order intake, Firestore ledger,
              price book, daily recap, weekly report, routing log
firestore.rules   owner-only security rules (deploy once — see above)
firebase.json     hosting + rules wiring
```

## Notes for judges / testers

- Sign-in is anonymous on first load — no credentials needed to try it.
  "Upgrade to Google" links the same account so data survives devices.
- On a browser without Gemini Nano, all AI features still work via cloud
  Gemini and are badged "Cloud · Gemini". To see the on-device path, use
  Chrome ≥ 139 with the flag above and click "Enable on-device AI".
- Firestore runs in production mode behind the owner-only rules in
  `firestore.rules` (deployed — see "Firestore security rules" above);
  the status panel's healthcheck proves the data path end-to-end.
- Fastest full tour: see "Try it in 30 seconds" above.

## License

Apache-2.0 — see [LICENSE](LICENSE). KiosKu was built with AI coding
assistance (explicitly permitted by the #BuildHybridAI rules); the entrant
of record is the project owner.
