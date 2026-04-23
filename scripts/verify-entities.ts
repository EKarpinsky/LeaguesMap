/**
 * Spot-check that specific tasks resolve to specific entity pins and that
 * multi-spawn monsters land in the task's region.
 *
 * Run: npx tsx scripts/verify-entities.ts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../src/types.ts";
import { resolveTasks } from "../src/lib/resolver.ts";
import { ENTITY_LOCATIONS } from "../src/data/wikiEntities.ts";
import { LOCATIONS } from "../src/data/locations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tasks: Task[] = JSON.parse(
  readFileSync(resolve(here, "../src/data/tasks.json"), "utf8"),
);
const placements = resolveTasks(tasks);

const ENTITY_BY_ID = new Map(ENTITY_LOCATIONS.map((e) => [e.id, e]));
const LOCATION_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

const probes = [
  "Defeat a Black Knight in Asgarnia",
  "Give Oli",
  "Pet Xolo",
  "silk to a silk trader",
  "Give Thurgo",
  "Talk to the Mysterious Old Man",
  "Equip Full Dharoks",
  "Defeat a Troll in Asgarnia",
  "Defeat a Black Demon in Asgarnia",
  "Defeat a Blue Dragon in Asgarnia",
  "Defeat Araxxor",
  "Zulrah",
  "Barbarian Assault",
  "Barter for 20 silk",
  "Pickpocket a Bandit",
  "Pickpocket a Menaphite",
  "Pickpocket a Citizen",
];

function describePin(locId: string): string {
  const ent = ENTITY_BY_ID.get(locId);
  if (ent) return `ENTITY ${ent.name} @ (${ent.x},${ent.y}) [${ent.region}]`;
  const loc = LOCATION_BY_ID.get(locId);
  if (loc) return `LANDMARK ${loc.name} @ (${loc.x},${loc.y}) [${loc.region}]`;
  return `??? ${locId}`;
}

for (const probe of probes) {
  const match = tasks.findIndex((t) => t.name.toLowerCase().includes(probe.toLowerCase()));
  if (match === -1) {
    console.log(`\n❓ '${probe}': no matching task found`);
    continue;
  }
  const t = tasks[match];
  const p = placements[match];
  console.log(`\n[${t.region}/${t.difficulty}] ${t.name}`);
  console.log(`  method: ${p.matchMethod}`);
  if (p.primary) console.log(`  primary: ${describePin(p.primary)}`);
  console.log(`  all (${p.locations.length}):`);
  for (const l of p.locations.slice(0, 4)) console.log(`    - ${describePin(l)}`);
}
