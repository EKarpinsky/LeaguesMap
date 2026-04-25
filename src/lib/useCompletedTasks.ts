import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_TASKS } from "./taskIndex";
import type { Task } from "../types";

/**
 * Local-first task completion tracker.
 *
 * Storage shape (versioned, JSON-serializable):
 *
 *   { version: 1, completed: ["407", "411", ...], updatedAt: <ISO> }
 *
 * Why a Set in memory + array on disk:
 *   - The hot path (TaskList render, MapView pin recompute, filter eval) is
 *     `isCompleted(id)` called O(tasks) times per render. Set.has() is O(1)
 *     vs Array.includes() O(n) — the difference shows up when filters
 *     re-evaluate ~1500 tasks every keystroke.
 *   - localStorage stores strings, so Set must serialize to an array. We
 *     dedupe and sort on write so the export file is stable & diffable.
 *
 * Why a versioned envelope:
 *   - The first wrong move is to dump a bare array; later you want to add
 *     timestamps, per-task notes, presets, multiple league saves… and you
 *     can't tell apart v1 from v2 without breaking everyone's saves.
 *
 * Cross-tab sync:
 *   - The `storage` event fires in OTHER tabs when localStorage is written.
 *     Two browser windows of the map stay in sync without polling. The
 *     listener guards against re-emitting our own writes by snapshotting
 *     the JSON we just wrote and ignoring matching incoming events.
 *
 * Debounced writes:
 *   - Toggling 50 tasks in a burst should result in 1 localStorage write,
 *     not 50. We debounce by 250 ms; long enough to coalesce a click-spree
 *     but short enough that a tab close still flushes (we also flush on
 *     `beforeunload` as a belt-and-suspenders).
 *
 * Validity gate:
 *   - We discard ids on load that aren't in the current task set. Old
 *     league data should never resurrect deleted tasks; if a task was
 *     removed from the wiki, its progress entry is dead weight.
 */

const STORAGE_KEY = "lm.completed.v1";
const SCHEMA_VERSION = 1;
const DEBOUNCE_MS = 250;

interface StoredProgress {
  version: number;
  completed: string[];
  updatedAt: string;
}

function isStoredProgress(v: unknown): v is StoredProgress {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === "number" &&
    Array.isArray(o.completed) &&
    o.completed.every((x) => typeof x === "string")
  );
}

/** Parse + validate raw localStorage JSON. Returns a Set of valid task ids. */
function parseStored(raw: string | null, validIds: Set<string>): Set<string> {
  if (!raw) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!isStoredProgress(parsed)) return new Set();
  // Migration hook: when SCHEMA_VERSION bumps, branch by parsed.version
  // here. v1 is the only schema right now so we just accept it.
  return new Set(parsed.completed.filter((id) => validIds.has(id)));
}

function readInitialFromStorage(validIds: Set<string>): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseStored(window.localStorage.getItem(STORAGE_KEY), validIds);
  } catch {
    // Private mode / quota / disabled storage all throw on access.
    return new Set();
  }
}

export interface ProgressStats {
  /** Number of tasks completed (across the entire task set). */
  completedCount: number;
  /** Total tasks in the league. */
  totalCount: number;
  /** Sum of `task.points` for completed tasks. */
  completedPoints: number;
  /** Sum of `task.points` across the league. */
  totalPoints: number;
  /** Per-difficulty counts: completedByDifficulty["Master"] = 12. */
  completedByDifficulty: Record<string, number>;
  /** Per-difficulty totals: same shape, denominators. */
  totalByDifficulty: Record<string, number>;
}

export interface UseCompletedTasks {
  completed: ReadonlySet<string>;
  isCompleted: (taskId: string) => boolean;
  toggleTask: (taskId: string) => void;
  setCompleted: (taskId: string, value: boolean) => void;
  markMany: (taskIds: Iterable<string>) => void;
  clearMany: (taskIds: Iterable<string>) => void;
  /**
   * Replace the entire completion set in one shot. Used by the RuneLite
   * sync flow where the imported export is the authoritative source of
   * truth and any stale local ticks should be wiped — semantically
   * different from `markMany` (union) so the sync result is predictable
   * and idempotent: re-syncing the same export always yields the same
   * state, regardless of what was in localStorage before.
   */
  replaceAll: (taskIds: Iterable<string>) => void;
  resetAll: () => void;
  stats: ProgressStats;
}

export function useCompletedTasks(): UseCompletedTasks {
  // Pre-compute valid task ids ONCE; cheap because ALL_TASKS is module-level
  // and frozen for the session. Used to reject stale ids on load/import.
  const validIds = useMemo(() => new Set(ALL_TASKS.map((t) => t.id)), []);

  const [completed, setCompletedSet] = useState<Set<string>>(() =>
    readInitialFromStorage(validIds),
  );

  // Last JSON we wrote; used to ignore the storage event we trigger on
  // ourselves. (The standard `storage` event only fires in OTHER tabs in
  // most browsers, but Safari/Firefox quirks have shipped that fired in
  // the writing tab too — this guard makes us robust to either.)
  const lastWrittenRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Persist on change (debounced + flushed on unmount/unload).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => {
      const payload: StoredProgress = {
        version: SCHEMA_VERSION,
        completed: [...completed].sort(),
        updatedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(payload);
      lastWrittenRef.current = json;
      try {
        window.localStorage.setItem(STORAGE_KEY, json);
      } catch {
        // Quota exceeded / private mode — silent failure beats crashing.
      }
    };
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(flush, DEBOUNCE_MS);
    // Flush on unload so a fast tab-close doesn't lose the last toggle.
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
  }, [completed]);

  // Cross-tab sync via the storage event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === lastWrittenRef.current) return;
      const next = parseStored(e.newValue, validIds);
      setCompletedSet(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [validIds]);

  const isCompleted = useCallback(
    (taskId: string) => completed.has(taskId),
    [completed],
  );

  const setCompleted = useCallback((taskId: string, value: boolean) => {
    setCompletedSet((prev) => {
      const has = prev.has(taskId);
      if (has === value) return prev;
      const next = new Set(prev);
      if (value) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  const toggleTask = useCallback((taskId: string) => {
    setCompletedSet((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const markMany = useCallback((taskIds: Iterable<string>) => {
    setCompletedSet((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) next.add(id);
      return next;
    });
  }, []);

  const clearMany = useCallback((taskIds: Iterable<string>) => {
    setCompletedSet((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) next.delete(id);
      return next;
    });
  }, []);

  const replaceAll = useCallback(
    (taskIds: Iterable<string>) => {
      const next = new Set<string>();
      for (const id of taskIds) {
        if (validIds.has(id)) next.add(id);
      }
      setCompletedSet(next);
    },
    [validIds],
  );

  const resetAll = useCallback(() => {
    setCompletedSet(new Set());
  }, []);

  const stats = useMemo<ProgressStats>(() => {
    const completedByDifficulty: Record<string, number> = {};
    const totalByDifficulty: Record<string, number> = {};
    let completedPoints = 0;
    let totalPoints = 0;
    for (const t of ALL_TASKS) {
      totalPoints += t.points;
      totalByDifficulty[t.difficulty] =
        (totalByDifficulty[t.difficulty] ?? 0) + 1;
      if (completed.has(t.id)) {
        completedPoints += t.points;
        completedByDifficulty[t.difficulty] =
          (completedByDifficulty[t.difficulty] ?? 0) + 1;
      }
    }
    return {
      completedCount: completed.size,
      totalCount: ALL_TASKS.length,
      completedPoints,
      totalPoints,
      completedByDifficulty,
      totalByDifficulty,
    };
  }, [completed]);

  return {
    completed,
    isCompleted,
    toggleTask,
    setCompleted,
    markMany,
    clearMany,
    replaceAll,
    resetAll,
    stats,
  };
}

/**
 * Shared helper: count how many tasks in `tasks` are completed and what
 * their summed point value is. Used by FilterSidebar's per-region /
 * per-difficulty count rendering and by the MapView pin badges.
 */
export function summarize(
  tasks: Task[],
  completed: ReadonlySet<string>,
): { done: number; total: number; remaining: number } {
  let done = 0;
  for (const t of tasks) if (completed.has(t.id)) done += 1;
  return { done, total: tasks.length, remaining: tasks.length - done };
}
