import type { RoutingLogEntry } from "./types";

/**
 * A tiny observable store for the routing log. Every inference call appends
 * exactly one entry (success or failure) so the UI can show — honestly —
 * which features ran where, how long they took, and what failed.
 */
const MAX_ENTRIES = 50;

let entries: RoutingLogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function appendRoutingLog(
  entry: Omit<RoutingLogEntry, "id" | "at">,
): RoutingLogEntry {
  const full: RoutingLogEntry = {
    ...entry,
    id: nextId++,
    at: new Date().toISOString(),
  };
  entries = [full, ...entries].slice(0, MAX_ENTRIES);
  listeners.forEach((fn) => fn());
  return full;
}

export function getRoutingLog(): RoutingLogEntry[] {
  return entries;
}

export function subscribeRoutingLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLastInferenceSource(): RoutingLogEntry | undefined {
  return entries.find((e) => e.inferenceSource !== null);
}
