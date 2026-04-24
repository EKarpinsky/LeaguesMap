import type { Task, TaskPlacement, WorldLocation } from "../types";
import tasksJson from "../data/tasks.json" with { type: "json" };
import placementsJson from "../data/generated/placements.json" with { type: "json" };
import locationsJson from "../data/generated/locations.json" with { type: "json" };

/**
 * Runtime data is fully pre-resolved at build time by
 * `scripts/build-runtime-data.ts`, run via the `prebuild` and `predev`
 * npm hooks. The resolver, the wiki entity table, and the original
 * wikiEntities.json (~450 KB) all stay out of the client bundle —
 * the runtime only ever sees these three small JSON inputs.
 */

export const ALL_TASKS: Task[] = tasksJson as Task[];
export const ALL_PLACEMENTS: TaskPlacement[] = placementsJson as TaskPlacement[];
export const ALL_LOCATIONS: WorldLocation[] = locationsJson as WorldLocation[];

const TASK_BY_ID = new Map<string, Task>(ALL_TASKS.map((t) => [t.id, t]));
const PLACEMENT_BY_ID = new Map<string, TaskPlacement>(
  ALL_PLACEMENTS.map((p) => [p.taskId, p]),
);
const LOCATION_BY_ID = new Map<string, WorldLocation>(
  ALL_LOCATIONS.map((l) => [l.id, l]),
);

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
