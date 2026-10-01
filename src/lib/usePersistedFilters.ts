import { useCallback, useEffect, useRef, useState } from "react";
import { defaultFilters } from "./filters";
import type { FilterState } from "./filters";
import {
  DIFFICULTIES,
  REGION_DISPLAY_ORDER,
  type Difficulty,
  type Region,
} from "../types";

/**
 * Local-first filter persistence.
 *
 * Why this hook:
 *
 *   The whole app's UI state — which regions are showing, which tier
 *   buttons are pressed, "Hide completed" toggle, "Demonic Pact tasks
 *   only", per-skill mins — is the player's mental model of "what am
 *   I working on right now". Refreshing the page (or being kicked
 *   back to it by a browser update, accidental Cmd+R, OS sleep, tab
 *   discard) and losing all of that is a sharp paper-cut: the user
 *   has to re-curate the view every visit.
 *
 *   Mirrors the design of `useCompletedTasks`:
 *     - Versioned envelope (lm.filters.v1) so future schema bumps can
 *       branch on `parsed.version` without breaking existing saves.
 *     - Sets serialize as sorted arrays; cross-tab sync via the
 *       `storage` event with a self-write guard so we don't echo our
 *       own writes.
 *     - Debounced writes (250 ms) coalesce a click-spree on the
 *       region grid into a single localStorage update.
 *     - `beforeunload` flush so a fast tab-close doesn't lose the
 *       last toggle.
 *
 * What we deliberately DO NOT persist:
 *
 *   - `search`: every visit should start with a clean search box.
 *     Search has its own restoration path via the `?q=` URL param
 *     (powering the schema.org SearchAction declared in index.html),
 *     and a sticky search query is the kind of thing that quietly
 *     filters away the task you're looking for the next morning.
 *
 * Validation gate on load:
 *
 *   We drop any region or difficulty whose name isn't in the current
 *   valid set. If a future league removes "Tirannwn" from the world
 *   for some reason, the persisted filter doesn't resurrect a dead
 *   bucket and break the count math. Same protection applies if a
 *   third-party tool wrote junk into our key.
 */

const STORAGE_KEY = "lm.filters.v1";
const SCHEMA_VERSION = 1;
const DEBOUNCE_MS = 250;

interface StoredFilters {
  version: number;
  regions: string[];
  difficulties: string[];
  pactOnly: boolean;
  includeUnmappable: boolean;
  includeCentroidFallbacks: boolean;
  hideCompleted: boolean;
  skillMin: Partial<Record<string, number>>;
  updatedAt: string;
}

function isStoredFilters(v: unknown): v is StoredFilters {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === "number" &&
    Array.isArray(o.regions) &&
    Array.isArray(o.difficulties) &&
    typeof o.pactOnly === "boolean" &&
    typeof o.includeUnmappable === "boolean" &&
    typeof o.includeCentroidFallbacks === "boolean" &&
    typeof o.hideCompleted === "boolean" &&
    o.skillMin !== null &&
    typeof o.skillMin === "object"
  );
}

const VALID_REGIONS = new Set<Region>(REGION_DISPLAY_ORDER);
const VALID_DIFFICULTIES = new Set<Difficulty>(DIFFICULTIES);

/**
 * Convert a stored snapshot back into a runtime FilterState. Anything
 * that doesn't validate is silently dropped — never throws — because a
 * partially-corrupt save should still load enough to be useful.
 */
function hydrateFilters(parsed: unknown): FilterState | null {
  if (!isStoredFilters(parsed)) return null;
  const base = defaultFilters();
  return {
    regions: new Set<Region>(
      parsed.regions.filter((r): r is Region =>
        VALID_REGIONS.has(r as Region),
      ),
    ),
    difficulties: new Set<Difficulty>(
      parsed.difficulties.filter((d): d is Difficulty =>
        VALID_DIFFICULTIES.has(d as Difficulty),
      ),
    ),
    search: base.search,
    pactOnly: parsed.pactOnly,
    includeUnmappable: parsed.includeUnmappable,
    includeCentroidFallbacks: parsed.includeCentroidFallbacks,
    hideCompleted: parsed.hideCompleted,
    skillMin: { ...parsed.skillMin },
  };
}

function serializeFilters(f: FilterState): StoredFilters {
  return {
    version: SCHEMA_VERSION,
    regions: [...f.regions].sort(),
    difficulties: [...f.difficulties].sort(),
    pactOnly: f.pactOnly,
    includeUnmappable: f.includeUnmappable,
    includeCentroidFallbacks: f.includeCentroidFallbacks,
    hideCompleted: f.hideCompleted,
    skillMin: { ...f.skillMin },
    updatedAt: new Date().toISOString(),
  };
}

/** Apply the URL `?q=` override on top of any other initial state. */
function applyUrlSearch(state: FilterState): FilterState {
  if (typeof window === "undefined") return state;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  if (q && q.trim()) {
    return { ...state, search: q.trim().slice(0, 200) };
  }
  return state;
}

function readInitial(): FilterState {
  const base = applyUrlSearch(defaultFilters());
  if (typeof window === "undefined") return base;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return base;
  }
  if (!raw) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  const hydrated = hydrateFilters(parsed);
  if (!hydrated) return base;
  // URL ?q= still wins over the persisted (always empty) search.
  return applyUrlSearch(hydrated);
}

export interface UsePersistedFilters {
  filters: FilterState;
  setFilters: (updater: (prev: FilterState) => FilterState) => void;
}

/**
 * Stable string key for a FilterState. Two states with the same key are
 * equivalent for storage purposes — used by the persist effect to skip
 * idempotent re-writes and by the cross-tab listener to detect "no real
 * change". `search` is intentionally excluded because we never persist
 * it (see header), so flipping it shouldn't cause a write or a sync.
 */
function filtersIdentity(f: FilterState): string {
  return [
    [...f.regions].sort().join("|"),
    [...f.difficulties].sort().join("|"),
    f.pactOnly ? 1 : 0,
    f.includeUnmappable ? 1 : 0,
    f.includeCentroidFallbacks ? 1 : 0,
    f.hideCompleted ? 1 : 0,
    Object.keys(f.skillMin)
      .sort()
      .map((k) => `${k}:${f.skillMin[k] ?? 0}`)
      .join(","),
  ].join("§");
}

export function usePersistedFilters(): UsePersistedFilters {
  const [filters, setFiltersState] = useState<FilterState>(() => readInitial());

  // Identity of the filter state we last wrote. Same role as
  // `lastPersistedIdsRef` in useCompletedTasks — guards against the
  // updatedAt-driven cross-tab ping-pong loop. See useCompletedTasks
  // header comment for the full story; the failure mode is identical
  // (a recent local toggle gets reverted by an echo from another tab).
  const lastPersistedIdentityRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounced persist + beforeunload flush. Same shape as
  // useCompletedTasks so the two storage layers behave identically.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => {
      const identity = filtersIdentity(filters);
      if (identity === lastPersistedIdentityRef.current) return;
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(serializeFilters(filters)),
        );
        lastPersistedIdentityRef.current = identity;
      } catch {
        // Quota / private mode — silent failure beats crashing.
      }
    };
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(flush, DEBOUNCE_MS);
    const onBeforeUnload = () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      flush();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [filters]);

  // Cross-tab sync. If a sibling tab toggles a filter, mirror it here so
  // both windows agree about "what am I looking at" without polling.
  // Identity-equality guard breaks the ping-pong loop and prevents a
  // stale-echo from clobbering a fresh local edit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      let parsed: unknown;
      try {
        parsed = e.newValue ? JSON.parse(e.newValue) : null;
      } catch {
        return;
      }
      const hydrated = hydrateFilters(parsed);
      if (!hydrated) return;
      setFiltersState((prev) => {
        // Preserve the local search box across cross-tab sync — typing
        // in tab A shouldn't blow away your half-finished query in tab B.
        const merged = { ...hydrated, search: prev.search };
        if (filtersIdentity(prev) === filtersIdentity(merged)) return prev;
        return merged;
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setFilters = useCallback(
    (updater: (prev: FilterState) => FilterState) => {
      setFiltersState(updater);
    },
    [],
  );

  return { filters, setFilters };
}
