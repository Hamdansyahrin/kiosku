import type { GenerativeModel, InferenceMode } from "firebase/ai";
import { appendRoutingLog } from "./routingLog";
import {
  describeError,
  type FeatureId,
  type InferenceOutcome,
  type ValidationResult,
} from "./types";

/**
 * The hybrid routing engine: every structured inference call in KiosKu goes
 * through runStructured(), which
 *   1. calls the feature's own model instance (its InferenceMode decides
 *      on-device vs cloud, with SDK-managed fallback under PREFER modes),
 *   2. reads `response.inferenceSource` so the app reports the path that
 *      ACTUALLY ran — never the path it hoped for,
 *   3. parses and schema-validates the JSON before anything downstream
 *      trusts it,
 *   4. retries transient cloud failures (429 / 503) with exponential
 *      backoff, as the free tier requires, and
 *   5. appends exactly one entry to the routing log, success or failure.
 */

export interface StructuredRequest<T> {
  feature: FeatureId;
  model: GenerativeModel;
  modeRequested: InferenceMode;
  prompt: string;
  /** Validate (and coerce) the decoded JSON into the feature's data type. */
  validate: (raw: unknown) => ValidationResult<T>;
  maxAttempts?: number;
}

const RETRYABLE_PATTERNS = [
  "429",
  "503",
  "resource-exhausted",
  "unavailable",
  "rate",
  "overloaded",
  "deadline",
];

function isRetryable(e: unknown): boolean {
  const text = describeError(e).toLowerCase();
  return RETRYABLE_PATTERNS.some((p) => text.includes(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runStructured<T>(
  req: StructuredRequest<T>,
): Promise<InferenceOutcome<T>> {
  const startedAt = performance.now();
  const maxAttempts = req.maxAttempts ?? 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await req.model.generateContent(req.prompt);
      const response = result.response;
      const inferenceSource = response.inferenceSource ?? "unknown";
      const text = response.text();

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        const latencyMs = Math.round(performance.now() - startedAt);
        const error = `Model returned non-JSON output: ${text.slice(0, 200)}`;
        appendRoutingLog({
          feature: req.feature,
          modeRequested: req.modeRequested,
          inferenceSource,
          latencyMs,
          ok: false,
          error,
        });
        return { ok: false, error, inferenceSource, latencyMs };
      }

      const validation = req.validate(raw);
      const latencyMs = Math.round(performance.now() - startedAt);
      if (!validation.ok) {
        const error = `Schema validation failed: ${validation.errors.join("; ")}`;
        appendRoutingLog({
          feature: req.feature,
          modeRequested: req.modeRequested,
          inferenceSource,
          latencyMs,
          ok: false,
          error,
        });
        return { ok: false, error, inferenceSource, latencyMs };
      }

      appendRoutingLog({
        feature: req.feature,
        modeRequested: req.modeRequested,
        inferenceSource,
        latencyMs,
        ok: true,
      });
      return { ok: true, data: validation.value, inferenceSource, latencyMs };
    } catch (e: unknown) {
      lastError = e;
      if (attempt < maxAttempts && isRetryable(e)) {
        // Exponential backoff with a small base: 600ms, 1200ms, ...
        await sleep(600 * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const error = describeError(lastError);
  appendRoutingLog({
    feature: req.feature,
    modeRequested: req.modeRequested,
    inferenceSource: null,
    latencyMs,
    ok: false,
    error,
  });
  return { ok: false, error, inferenceSource: null, latencyMs };
}
