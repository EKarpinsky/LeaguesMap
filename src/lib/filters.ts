import { REGION_DISPLAY_ORDER, DIFFICULTIES } from "../types";
import type { Task, TaskPlacement, Region, Difficulty } from "../types";

export interface FilterState {
  /**
   * Regions to show. An empty set shows NOTHING — "select none" really
   * means no tasks. App initializes this to the full region set.
   */
  regions: Set<Region>;
  /** Same semantics as `regions`: empty = show none. */
  difficulties: Set<Difficulty>;
  search: string;
  pactOnly: boolean;
  /** Show tasks that have no location (skill totals, collection log, etc). */
  includeUnmappable: boolean;
  /** Show region-centroid fallback pins and their tasks. */
  includeCentroidFallbacks: boolean;
  /** Minimum skill requirement filter, e.g. { Agility: 70 }. */
  skillMin: Partial<Record<string, number>>;
}

/** Initial filter state: all regions and difficulties selected. */
export function defaultFilters(): FilterState {
  return {
    regions: new Set<Region>(REGION_DISPLAY_ORDER),
    difficulties: new Set<Difficulty>(DIFFICULTIES),
    search: "",
    pactOnly: false,
    includeUnmappable: true,
    includeCentroidFallbacks: true,
    skillMin: {},
  };
}

export function matchesFilter(
  task: Task,
  placement: TaskPlacement,
  f: FilterState,
): boolean {
  if (!f.regions.has(task.region)) return false;
  if (!f.difficulties.has(task.difficulty)) return false;
  if (f.pactOnly && !task.isDemonicPact) return false;
  if (!f.includeUnmappable && placement.unmappable) return false;
  if (!f.includeCentroidFallbacks && placement.matchMethod === "region-fallback")
    return false;

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = (task.name + " " + task.descriptionClean).toLowerCase();
    if (!hay.includes(q)) return false;
  }

  // All declared skill minimums must be satisfiable (task req ≤ filter min).
  const entries = Object.entries(f.skillMin).filter(([, v]) => typeof v === "number");
  if (entries.length > 0) {
    for (const req of task.skillRequirements) {
      const cap = f.skillMin[req.skill];
      if (typeof cap === "number" && req.level > cap) return false;
    }
  }

  return true;
}
