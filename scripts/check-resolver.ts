/**
 * Runs the task resolver against the scraped tasks and prints coverage stats.
 * Useful for quickly validating that the locations database + pattern matcher
 * are getting good pin coverage.
 *
 * Run: npx tsx scripts/check-resolver.ts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../src/types.ts";
import { resolveTasks } from "../src/lib/resolver.ts";
import { LOCATIONS } from "../src/data/locations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tasks: Task[] = JSON.parse(
  readFileSync(resolve(here, "../src/data/tasks.json"), "utf8"),
);
const placements = resolveTasks(tasks);

let mapped = 0;
let unmappable = 0;
let regionFallback = 0;
const byRegion = new Map<string, { total: number; mapped: number; fallback: number }>();
const sampleUnresolved: Task[] = [];
const sampleMapped: { task: Task; loc: string }[] = [];

for (let i = 0; i < tasks.length; i++) {
  const t = tasks[i];
  const p = placements[i];
  const bucket = byRegion.get(t.region) ?? { total: 0, mapped: 0, fallback: 0 };
  bucket.total++;
  if (p.unmappable) {
    unmappable++;
  } else if (p.matchMethod === "region-fallback") {
    regionFallback++;
    bucket.fallback++;
  } else {
    mapped++;
    bucket.mapped++;
    if (sampleMapped.length < 10 && t.region !== "General") {
      sampleMapped.push({ task: t, loc: p.primary ?? "(none)" });
    }
  }
  byRegion.set(t.region, bucket);
  if (
    p.matchMethod === "region-fallback" &&
    sampleUnresolved.length < 25 &&
    t.region !== "General"
  ) {
    sampleUnresolved.push(t);
  }
}

console.log(`Tasks: ${tasks.length}`);
console.log(
  `  mapped to real location: ${mapped} (${((mapped / tasks.length) * 100).toFixed(1)}%)`,
);
console.log(
  `  region-centroid fallback: ${regionFallback} (${((regionFallback / tasks.length) * 100).toFixed(1)}%)`,
);
console.log(
  `  unmappable (skill/collection/meta): ${unmappable} (${((unmappable / tasks.length) * 100).toFixed(1)}%)`,
);

console.log("\nBy region:");
for (const [region, stats] of [...byRegion].sort()) {
  const pct = ((stats.mapped / stats.total) * 100).toFixed(0);
  console.log(
    `  ${region.padEnd(12)} mapped ${stats.mapped}/${stats.total} (${pct}%), fallback ${stats.fallback}`,
  );
}

console.log(`\nLocations in database: ${LOCATIONS.length}`);

console.log("\nSample mapped tasks (non-General):");
for (const s of sampleMapped) {
  console.log(`  [${s.task.region}/${s.task.difficulty}] ${s.task.name}  →  ${s.loc}`);
}

console.log("\nSample region-fallback tasks (candidates for new locations):");
for (const t of sampleUnresolved) {
  console.log(`  [${t.region}/${t.difficulty}] ${t.name}`);
  console.log(`      "${t.descriptionClean.slice(0, 120)}"`);
}
