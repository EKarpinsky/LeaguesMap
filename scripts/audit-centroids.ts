/**
 * Lists every task still falling through to a region-centroid fallback pin.
 * Helps identify which task patterns still need curated landmarks/aliases.
 *
 *   npx tsx scripts/audit-centroids.ts
 */
import tasksJson from "../src/data/tasks.json" with { type: "json" };
import type { Task } from "../src/types";
import { resolveTasks } from "../src/lib/resolver";

const tasks = tasksJson as Task[];
const placements = resolveTasks(tasks);

const byRegion = new Map<string, { name: string; desc: string }[]>();
for (let i = 0; i < placements.length; i++) {
  const p = placements[i];
  if (p.matchMethod !== "region-fallback") continue;
  const t = tasks[i];
  if (!byRegion.has(t.region)) byRegion.set(t.region, []);
  byRegion.get(t.region)!.push({ name: t.name, desc: t.descriptionClean });
}

const ordered = [...byRegion.keys()].sort();
for (const region of ordered) {
  const list = byRegion.get(region)!;
  console.log(`\n=== ${region} (${list.length}) ===`);
  for (const t of list) console.log(`  • ${t.name}  —  ${t.desc}`);
}

const total = [...byRegion.values()].reduce((n, l) => n + l.length, 0);
console.log(`\nTotal centroid-fallback tasks: ${total}`);
