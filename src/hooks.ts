import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getAuthState,
  subscribeAuth,
  type AuthState,
} from "./firebase/auth";
import {
  getRoutingLog,
  subscribeRoutingLog,
} from "./ai/routingLog";
import type { RoutingLogEntry } from "./ai/types";
import {
  getDeviceModelStatus,
  probeDeviceModel,
  subscribeDeviceModel,
  type DeviceModelStatus,
} from "./ai/deviceModel";
import {
  initRemoteConfig,
  refreshRemoteConfig,
  type KiosKuRemoteConfig,
} from "./firebase/remoteConfig";

export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribeAuth, getAuthState);
}

export function useRoutingLog(): RoutingLogEntry[] {
  return useSyncExternalStore(subscribeRoutingLog, getRoutingLog);
}

export function useDeviceModelStatus(): DeviceModelStatus {
  const status = useSyncExternalStore(
    subscribeDeviceModel,
    getDeviceModelStatus,
  );
  useEffect(() => {
    // Probe once on mount (read-only; never triggers a download).
    void probeDeviceModel();
  }, []);
  return status;
}

/** Remote Config values: defaults immediately, refreshed values when the
 *  fetch lands. */
export function useRemoteConfig(): KiosKuRemoteConfig {
  const [values, setValues] = useState<KiosKuRemoteConfig>(() =>
    initRemoteConfig(),
  );
  useEffect(() => {
    let cancelled = false;
    refreshRemoteConfig().then((v) => {
      if (!cancelled) setValues(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return values;
}
