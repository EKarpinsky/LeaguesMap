import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../src/types.ts";
import { resolveTasks } from "../src/lib/resolver.ts";
import { ALL_LOCATIONS } from "../src/lib/taskIndex.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tasks: Task[] = JSON.parse(readFileSync(resolve(here, "../src/data/tasks.json"), "utf8"));
const placements = resolveTasks(tasks);

const findPatterns = [
  /arctic pine tree/i,
  /swaying tree/i,
  /snape grass/i,
  /give .+ silk/i,
  /silk trader/i,
  /oli/i,
  /xolo/i,
  /thurgo/i,
  /defeat zulrah/i,
  /defeat a black knight/i,
  /corrupted gauntlet/i,
  /enter prifddinas/i,
];
const locsById = new Map(ALL_LOCATIONS.map(l => [l.id, l]));

for (const pat of findPatterns) {
  console.log(`\n=== /${pat.source}/ ===`);
  let found = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (!pat.test(tasks[i].name)) continue;
    const t = tasks[i], p = placements[i];
    const loc = p.primary ? locsById.get(p.primary) : undefined;
    const at = loc ? `${loc.name} (${loc.x},${loc.y}) region=${loc.region}` : p.primary;
    console.log(`  [${t.region}] ${t.name}  →  ${p.matchMethod}  →  ${at ?? "(none)"}`);
    if (++found >= 4) break;
  }
  if (found === 0) console.log("  (no matches)");
}
