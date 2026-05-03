/**
 * Find every (x, y) tile where MORE THAN ONE distinct location id is in
 * use by at least one task placement. Those are visually-overlapping
 * pins that look like a single bug to the user. Used to catch the
 * entity-vs-landmark dedup failure pattern globally, not just for the
 * dp-v1.4 batch we just fixed.
 */
import placementsData from "../src/data/generated/placements.json" with { type: "json" };
import locationsData from "../src/data/generated/locations.json" with { type: "json" };
import tasksJson from "../src/data/tasks.json" with { type: "json" };

interface Placement {
  taskId: string;
  primary: string | null;
  locations: string[];
}

const placements = placementsData as unknown as Placement[];
const locations = locationsData as unknown as Array<{
  id: string;
  name: string;
  x: number;
  y: number;
  region?: string;
}>;
const tasks = tasksJson as unknown as Array<{ id: string; name: string }>;
const taskById = new Map(tasks.map((t) => [t.id, t]));
const locById = new Map(locations.map((l) => [l.id, l]));

const usedLocIds = new Set<string>();
const usingTasks = new Map<string, string[]>();
for (const p of placements) {
  const ids = new Set<string>(p.locations);
  if (p.primary) ids.add(p.primary);
  for (const id of ids) {
    usedLocIds.add(id);
    if (!usingTasks.has(id)) usingTasks.set(id, []);
    usingTasks.get(id)!.push(p.taskId);
  }
}

const byTile = new Map<string, string[]>();
for (const id of usedLocIds) {
  const l = locById.get(id);
  if (!l) continue;
  const key = `${l.x},${l.y}`;
  if (!byTile.has(key)) byTile.set(key, []);
  byTile.get(key)!.push(id);
}

const collisions: Array<{ key: string; ids: string[] }> = [];
for (const [key, ids] of byTile) {
  if (ids.length > 1) collisions.push({ key, ids });
}

if (collisions.length === 0) {
  console.log("✅ No coordinate collisions across all in-use map pins.");
  process.exit(0);
}

console.log(`Found ${collisions.length} tile(s) with >1 distinct in-use location id:\n`);
for (const c of collisions) {
  console.log(`@ (${c.key}):`);
  for (const id of c.ids) {
    const l = locById.get(id);
    const ts = (usingTasks.get(id) ?? []).slice(0, 4);
    const sample = ts
      .map((tid) => `#${tid} ${taskById.get(tid)?.name ?? "?"}`)
      .join(" | ");
    console.log(
      `  ${id} [${l?.name}] (${(usingTasks.get(id) ?? []).length} tasks)`
    );
    console.log(`    sample: ${sample}`);
  }
  console.log("");
}
process.exit(1);
