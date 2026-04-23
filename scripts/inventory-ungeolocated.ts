import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../src/types.ts";
import { resolveTasks } from "../src/lib/resolver.ts";
import { ENTITIES_BY_TITLE } from "../src/data/wikiEntities.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tasks: Task[] = JSON.parse(
  readFileSync(resolve(here, "../src/data/tasks.json"), "utf8"),
);
const placements = resolveTasks(tasks);

// For each fallback task, show what wikiLinks it had and which have no entity
const linkCounts = new Map<string, number>();
for (let i = 0; i < tasks.length; i++) {
  const t = tasks[i];
  const p = placements[i];
  if (p.matchMethod !== "region-fallback") continue;
  if (t.region === "General") continue;
  for (const link of t.wikiLinks ?? []) {
    if (!ENTITIES_BY_TITLE.has(link.toLowerCase())) {
      linkCounts.set(link, (linkCounts.get(link) ?? 0) + 1);
    }
  }
}
const sorted = [...linkCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Top ungeolocated wiki links (among fallback tasks):`);
for (const [k, v] of sorted.slice(0, 40)) {
  console.log(`  ${v.toString().padStart(3)}  ${k}`);
}
