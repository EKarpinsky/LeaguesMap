import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../src/types.ts";
import { resolveTasks } from "../src/lib/resolver.ts";
import { ALL_LOCATIONS } from "../src/lib/taskIndex.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tasks: Task[] = JSON.parse(readFileSync(resolve(here, "../src/data/tasks.json"), "utf8"));
const placements = resolveTasks(tasks);
const locsById = new Map(ALL_LOCATIONS.map(l => [l.id, l]));

for (let i = 0; i < tasks.length; i++) {
  if (!/brine/i.test(tasks[i].name)) continue;
  const t = tasks[i], p = placements[i];
  const loc = p.primary ? locsById.get(p.primary) : undefined;
  console.log(`[${t.region}] ${t.name}  →  ${loc ? `${loc.name} (${loc.x},${loc.y})` : p.primary}`);
}
