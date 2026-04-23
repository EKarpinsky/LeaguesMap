import type { Task, TaskPlacement, Region, WorldLocation } from "../types";
import { LOCATIONS } from "../data/locations";
import { ENTITY_LOCATIONS } from "../data/wikiEntities";
import {
  centroidLocationId,
  regionCentroid,
  resolveTasks,
} from "./resolver";
import tasksJson from "../data/tasks.json" with { type: "json" };

export const ALL_TASKS: Task[] = tasksJson as Task[];
export const ALL_PLACEMENTS: TaskPlacement[] = resolveTasks(ALL_TASKS);

const TASK_BY_ID = new Map<string, Task>(ALL_TASKS.map((t) => [t.id, t]));
const PLACEMENT_BY_ID = new Map<string, TaskPlacement>(
  ALL_PLACEMENTS.map((p) => [p.taskId, p]),
);

/**
 * Real world locations (landmarks + fine-grained entity pins) plus
 * synthetic centroids for region fallbacks.
 *
 * Entity pins land LAST in the array so landmarks "win" any id collision
 * but every entity still gets its own marker on the map.
 */
export const ALL_LOCATIONS: WorldLocation[] = (() => {
  const real: WorldLocation[] = [...LOCATIONS, ...ENTITY_LOCATIONS];
  const regions = new Set<Region>();
  for (const p of ALL_PLACEMENTS) {
    if (p.matchMethod === "region-fallback") {
      const task = TASK_BY_ID.get(p.taskId);
      if (task) regions.add(task.region);
    }
  }
  for (const region of regions) {
    const c = regionCentroid(region);
    if (!c) continue; // Regions without a centroid (General, Misthalin) never get a fallback pin.
    real.push({
      id: centroidLocationId(region),
      name: `${region} (general area)`,
      x: c.x,
      y: c.y,
      region,
      category: "landmark",
      blurb: "Exact spot unknown — region-level fallback pin.",
    });
  }
  return real;
})();

const LOCATION_BY_ID = new Map<string, WorldLocation>(
  ALL_LOCATIONS.map((l) => [l.id, l]),
);

/** Map of locationId → tasks placed there. Built once. */
export const TASKS_BY_LOCATION: Map<string, Task[]> = (() => {
  const m = new Map<string, Task[]>();
  for (const p of ALL_PLACEMENTS) {
    if (p.unmappable || p.locations.length === 0) continue;
    const task = TASK_BY_ID.get(p.taskId);
    if (!task) continue;
    for (const locId of p.locations) {
      const arr = m.get(locId) ?? [];
      arr.push(task);
      m.set(locId, arr);
    }
  }
  return m;
})();

export function getTask(id: string): Task | undefined {
  return TASK_BY_ID.get(id);
}
export function getPlacement(id: string): TaskPlacement | undefined {
  return PLACEMENT_BY_ID.get(id);
}
export function getLocation(id: string): WorldLocation | undefined {
  return LOCATION_BY_ID.get(id);
}

/** Unique skill names across all task requirements, sorted. */
export const ALL_SKILLS: string[] = (() => {
  const s = new Set<string>();
  for (const t of ALL_TASKS) {
    for (const r of t.skillRequirements) s.add(r.skill);
  }
  return [...s].sort();
})();
