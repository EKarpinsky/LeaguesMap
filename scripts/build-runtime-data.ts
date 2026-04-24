/**
 * Build-time resolver. Runs the task → location resolver once per build,
 * emits two small JSON files into src/data/generated/:
 *
 *   placements.json — TaskPlacement[] for every task in tasks.json.
 *   locations.json  — WorldLocation[] for every location actually
 *                     referenced by a placement (landmarks + entity pins
 *                     in use + region centroids), with resolver-only
 *                     fields (aliases, wikiTitle, spawnIndex) stripped.
 *
 * Lets the runtime drop wikiEntities.json (~450 KB) and resolver.ts
 * from the client bundle. taskIndex.ts reads the generated files
 * directly — no resolver call on page load.
 *
 * Wired to `prebuild` and `predev` in package.json so the files are
 * always fresh when Vite starts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Task, TaskPlacement, Region, WorldLocation } from "../src/types.ts";
import { LOCATIONS } from "../src/data/locations.ts";
import { ENTITY_LOCATIONS } from "../src/data/wikiEntities.ts";
import {
  centroidLocationId,
  regionCentroid,
  resolveTasks,
} from "../src/lib/resolver.ts";
import tasksJson from "../src/data/tasks.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "..", "src", "data", "generated");
mkdirSync(OUT_DIR, { recursive: true });

const ALL_TASKS = tasksJson as Task[];
const placements: TaskPlacement[] = resolveTasks(ALL_TASKS);

// Collect every location id any placement actually references plus every
// region that needs a centroid fallback pin. This drives runtime
// payload pruning.
const usedLocationIds = new Set<string>();
const usedFallbackRegions = new Set<Region>();
const taskById = new Map<string, Task>(ALL_TASKS.map((t) => [t.id, t]));

for (const p of placements) {
  if (p.unmappable) continue;
  if (p.primary) usedLocationIds.add(p.primary);
  for (const id of p.locations) usedLocationIds.add(id);
  if (p.matchMethod === "region-fallback") {
    const t = taskById.get(p.taskId);
    if (t) usedFallbackRegions.add(t.region);
  }
}

// Build the slim runtime location list. Strip resolver-only fields
// (aliases, wikiTitle, spawnIndex) — the runtime never reads them.
const realLocations: WorldLocation[] = [...LOCATIONS, ...ENTITY_LOCATIONS]
  .filter((l) => usedLocationIds.has(l.id))
  .map(({ id, name, x, y, region, category, blurb }) => {
    const out: WorldLocation = { id, name, x, y, region, category };
    if (blurb !== undefined) out.blurb = blurb;
    return out;
  });

const centroids: WorldLocation[] = [];
for (const region of usedFallbackRegions) {
  const c = regionCentroid(region);
  if (!c) continue;
  centroids.push({
    id: centroidLocationId(region),
    name: `${region} (general area)`,
    x: c.x,
    y: c.y,
    region,
    category: "landmark",
    blurb: "Exact spot unknown — region-level fallback pin.",
  });
}

const allLocations = [...realLocations, ...centroids];

writeFileSync(
  resolve(OUT_DIR, "placements.json"),
  JSON.stringify(placements),
);
writeFileSync(
  resolve(OUT_DIR, "locations.json"),
  JSON.stringify(allLocations),
);

const mappable = placements.filter((p) => !p.unmappable).length;
const unmappable = placements.length - mappable;
console.log(
  `[build-runtime-data] ${placements.length} placements (${mappable} mappable, ${unmappable} unmappable), ${allLocations.length} locations (${realLocations.length} real + ${centroids.length} centroids)`,
);
