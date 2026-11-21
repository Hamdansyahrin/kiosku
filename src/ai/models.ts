import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  type AI,
  type GenerativeModel,
  type HybridParams,
  type ModelParams,
} from "firebase/ai";
import { app } from "../firebase/app";

/**
 * All inference in KiosKu goes through Firebase AI Logic with the Gemini
 * Developer API backend (free tier / Spark) — a contest requirement and the
 * only supported path for hybrid on-device + cloud inference on the web.
 */
let aiInstance: AI | null = null;

export function getAi(): AI {
  if (!aiInstance) {
    aiInstance = getAI(app, { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}

/** Create a hybrid model: per-feature InferenceMode with separate
 *  on-device / in-cloud parameter sets. */
export function createHybridModel(params: HybridParams): GenerativeModel {
  return getGenerativeModel(getAi(), params);
}

/** Create a plain cloud model (used for cloud-only features). */
export function createCloudModel(params: ModelParams): GenerativeModel {
  return getGenerativeModel(getAi(), params);
}
