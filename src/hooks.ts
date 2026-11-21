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
import {
  attachShop,
  getShopState,
  subscribeShop,
  type ShopState,
} from "./shop/ledger";
import { getLang, subscribeLang, type Lang } from "./i18n";

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

/** The signed-in user's shop data (ledger, price book, daily aggregates),
 *  live from Firestore. Attaches listeners once the uid is known. */
export function useShop(uid: string | null): ShopState {
  const state = useSyncExternalStore(subscribeShop, getShopState);
  useEffect(() => {
    if (uid) attachShop(uid);
  }, [uid]);
  return state;
}

/** Current UI language (id default, en one tap away). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang);
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
