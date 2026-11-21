import type { InferenceMode, InferenceSource } from "firebase/ai";

/** The product features that run inference. Each maps to its own model
 *  instance with its own InferenceMode (see models.ts / orderParser.ts). */
export type FeatureId = "order-parse" | "daily-recap" | "weekly-report";

/** Which path actually executed a call, as reported by the SDK
 *  (`response.inferenceSource`), or "unknown" when the SDK did not say. */
export type InferenceSourceLabel = InferenceSource | "unknown";

export interface RoutingLogEntry {
  id: number;
  /** ISO timestamp of completion. */
  at: string;
  feature: FeatureId;
  /** The InferenceMode the feature requested. */
  modeRequested: InferenceMode;
  /** The path that actually ran; null when the call failed before any
   *  inference happened (e.g. App Check rejection, offline). */
  inferenceSource: InferenceSourceLabel | null;
  latencyMs: number;
  ok: boolean;
  /** Error detail when ok is false. */
  error?: string;
}

export type InferenceOutcome<T> =
  | {
      ok: true;
      data: T;
      inferenceSource: InferenceSourceLabel;
      latencyMs: number;
    }
  | {
      ok: false;
      error: string;
      inferenceSource: InferenceSourceLabel | null;
      latencyMs: number;
    };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    return code ? `${code}: ${e.message}` : e.message;
  }
  return String(e);
}
