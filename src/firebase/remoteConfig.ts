import {
  getRemoteConfig,
  fetchAndActivate,
  getNumber,
  getString,
  type RemoteConfig,
} from "firebase/remote-config";
import { app } from "./app";

/**
 * Remote Config carries KiosKu's routing knobs so thresholds and model
 * choices can be tuned (or used as a rate-limit escape hatch) without a
 * redeploy. Defaults below are the values the app ships with; the console
 * parameters of the same names override them after fetchAndActivate.
 */
export interface KiosKuRemoteConfig {
  /**
   * Inputs longer than this (characters) are routed cloud-only: long order
   * logs and multi-day chats exceed what an on-device model should chew on,
   * and Nano's context window is the wrong tool for them.
   */
  maxOnDeviceInputChars: number;
  /** Cloud model for the weekly business report (long-context feature). */
  weeklyReportModel: string;
  /** Cloud fallback model for the order parser. */
  parseCloudModel: string;
}

export const REMOTE_CONFIG_DEFAULTS: KiosKuRemoteConfig = {
  maxOnDeviceInputChars: 1500,
  weeklyReportModel: "gemini-3.5-flash-lite",
  parseCloudModel: "gemini-3.5-flash-lite",
};

const KEYS = {
  maxOnDeviceInputChars: "max_ondevice_input_chars",
  weeklyReportModel: "weekly_report_model",
  parseCloudModel: "parse_cloud_model",
} as const;

let rc: RemoteConfig | null = null;

export function initRemoteConfig(): KiosKuRemoteConfig {
  try {
    rc = getRemoteConfig(app);
    // Short interval keeps the demo responsive while tuning; a production
    // deployment would raise this to hours.
    rc.settings.minimumFetchIntervalMillis = 60_000;
    rc.defaultConfig = {
      [KEYS.maxOnDeviceInputChars]: REMOTE_CONFIG_DEFAULTS.maxOnDeviceInputChars,
      [KEYS.weeklyReportModel]: REMOTE_CONFIG_DEFAULTS.weeklyReportModel,
      [KEYS.parseCloudModel]: REMOTE_CONFIG_DEFAULTS.parseCloudModel,
    };
  } catch {
    rc = null;
  }
  return getRemoteConfigValues();
}

/** Fetch the latest values from the backend (best-effort; defaults on failure). */
export async function refreshRemoteConfig(): Promise<KiosKuRemoteConfig> {
  if (rc) {
    try {
      await fetchAndActivate(rc);
    } catch {
      // Offline or throttled: keep the currently active/default values.
    }
  }
  return getRemoteConfigValues();
}

export function getRemoteConfigValues(): KiosKuRemoteConfig {
  if (!rc) return { ...REMOTE_CONFIG_DEFAULTS };
  const maxChars = getNumber(rc, KEYS.maxOnDeviceInputChars);
  const weekly = getString(rc, KEYS.weeklyReportModel);
  const parse = getString(rc, KEYS.parseCloudModel);
  return {
    maxOnDeviceInputChars:
      maxChars > 0 ? maxChars : REMOTE_CONFIG_DEFAULTS.maxOnDeviceInputChars,
    weeklyReportModel: weekly || REMOTE_CONFIG_DEFAULTS.weeklyReportModel,
    parseCloudModel: parse || REMOTE_CONFIG_DEFAULTS.parseCloudModel,
  };
}
