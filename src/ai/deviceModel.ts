import { InferenceMode, type GenerativeModel } from "firebase/ai";
import { createHybridModel } from "./models";
import { describeError } from "./types";

/**
 * On-device model lifecycle.
 *
 * Gemini Nano (via Chrome's Prompt API) is NOT preinstalled: it downloads on
 * demand, only after a user gesture, and only on capable hardware running
 * Chrome desktop >= 139 with the Prompt API flag enabled. This module keeps
 * an honest status machine so the UI never pretends on-device AI exists when
 * it doesn't:
 *
 *   unknown     -> nothing probed yet
 *   checking    -> an initialize/download is in flight (no progress yet)
 *   downloading -> model download in flight, progress 0..1
 *   ready       -> on-device model initialized; PREFER_ON_DEVICE calls can
 *                  genuinely run on-device
 *   unavailable -> Prompt API exists but the model could not be made ready
 *                  (download failed, storage, policy) — calls fall back
 *   cloud-only  -> no Prompt API on this browser at all; every feature runs
 *                  in the cloud and is badged as such
 */
export type DeviceModelStatus =
  | { kind: "unknown" }
  | { kind: "checking" }
  | { kind: "downloading"; progress: number }
  | { kind: "ready" }
  | { kind: "unavailable"; reason: string }
  | { kind: "cloud-only"; reason: string };

type Listener = (status: DeviceModelStatus) => void;

const listeners = new Set<Listener>();
let status: DeviceModelStatus = { kind: "unknown" };
let probeModel: GenerativeModel | null = null;

function setStatus(next: DeviceModelStatus) {
  status = next;
  listeners.forEach((fn) => fn(status));
}

export function subscribeDeviceModel(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => {
    listeners.delete(fn);
  };
}

export function getDeviceModelStatus(): DeviceModelStatus {
  return status;
}

/** The shared hybrid probe model used for device initialization. */
export function getProbeModel(): GenerativeModel {
  if (!probeModel) {
    probeModel = createHybridModel({ mode: InferenceMode.PREFER_ON_DEVICE });
  }
  return probeModel;
}

interface LanguageModelGlobal {
  availability?: () => Promise<string>;
}

function getLanguageModelGlobal(): LanguageModelGlobal | null {
  if (typeof window === "undefined") return null;
  const lm = (window as unknown as { LanguageModel?: LanguageModelGlobal })
    .LanguageModel;
  return lm ?? null;
}

/**
 * Read-only probe of Chrome's Prompt API availability. Never triggers a
 * download (that requires the explicit user gesture in enableOnDeviceAI).
 */
export async function probeDeviceModel(): Promise<DeviceModelStatus> {
  const lm = getLanguageModelGlobal();
  if (!lm || typeof lm.availability !== "function") {
    setStatus({
      kind: "cloud-only",
      reason:
        "Chrome Prompt API (window.LanguageModel) not found. On-device AI needs Chrome desktop >= 139 with the Gemini Nano Prompt API flag enabled; this browser will use cloud inference.",
    });
    return status;
  }
  try {
    const availability = await lm.availability();
    switch (availability) {
      case "available":
        setStatus({ kind: "ready" });
        break;
      case "downloadable":
        setStatus({
          kind: "unavailable",
          reason:
            "Gemini Nano is supported on this device but not downloaded yet. Use “Enable on-device AI” to download it.",
        });
        break;
      case "downloading":
        setStatus({ kind: "downloading", progress: 0 });
        break;
      default:
        setStatus({
          kind: "cloud-only",
          reason: `On-device model unavailable on this device (availability: ${availability}). Cloud inference will be used.`,
        });
    }
  } catch (e: unknown) {
    setStatus({
      kind: "unavailable",
      reason: `Availability probe failed: ${describeError(e)}`,
    });
  }
  return status;
}

/**
 * Initialize (and if needed download) the on-device model. MUST be called
 * from a user-gesture handler (button click) — Chrome rejects model
 * downloads that were not user-triggered, and the SDK surfaces that error.
 */
export async function enableOnDeviceAI(): Promise<DeviceModelStatus> {
  setStatus({ kind: "checking" });
  try {
    await getProbeModel().initializeDeviceModel((progress: number) => {
      setStatus({ kind: "downloading", progress });
    });
    setStatus({ kind: "ready" });
  } catch (e: unknown) {
    setStatus({
      kind: "unavailable",
      reason: `On-device initialization failed: ${describeError(e)}`,
    });
  }
  return status;
}
