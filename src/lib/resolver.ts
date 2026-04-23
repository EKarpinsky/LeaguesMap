import type { Task, TaskPlacement, Region } from "../types";
import { LOCATIONS } from "../data/locations";
import { ENTITIES_BY_TITLE, ENTITY_LOCATIONS } from "../data/wikiEntities";

/**
 * Maps tasks to world locations.
 *
 * Strategy (in order):
 *   1. ENTITY MATCH: walk task.wikiLinks; if any link maps to a wiki-sourced
 *      entity pin (Black Knight spawn, Xolo's tile, Thurgo's house, etc.)
 *      use those — this is the "boil-the-ocean" precision path.
 *   2. ENTITY TEXT SCAN: if wikiLinks yielded nothing, fuzzy-match the
 *      cleaned description against entity names/aliases — catches tasks
 *      whose wiki link points to an item page (e.g. "Dharok's equipment")
 *      but the description mentions the boss ("Dharok") directly.
 *   3. LANDMARK ALIAS MATCH: same-region landmarks first, then any region.
 *   4. UNMAPPABLE: non-spatial totals/skill tasks.
 *   5. REGION CENTROID: last-resort pin so something still renders.
 */

/** Keywords whose presence alone marks a task as non-spatial. */
const UNMAPPABLE_PATTERNS: RegExp[] = [
  /^reach combat level/i,
  /^reach total level/i,
  /^reach base level/i,
  /^reach level \d+ /i,
  /^achieve your first level/i,
  /^obtain \d[\d,]* million .* xp/i,
  /^obtain \d{2,3} million xp/i,
  /^(\d+ )?collection log slots/i,
  /^\d+ combat achievements/i,
  /combat achievements (easy|medium|hard|elite|master) tier/i,
  /^complete all tasks for/i,
  /^complete \d+ speed tasks?/i,
  /^obtain (a )?(boss|skilling) pet/i,
  /^slay \d+ creatures/i,
  /^complete \d+ slayer tasks/i,
];

/**
 * Region-level fallback pin coordinates. Tasks that we can't resolve to a
 * specific landmark or entity get a pin at the centroid of their region
 * as a last-resort "somewhere in X" marker.
 *
 * `General` is intentionally absent: these are "do this anywhere"
 * tasks (Create an Antipoison, Cut a Ruby, Open any Clue Scroll…)
 * that don't belong anywhere specific. Dropping them at a centroid
 * would put 70+ pins on a single tile in Lumbridge — and Lumbridge is
 * Misthalin, which the player can't reach this league. These tasks
 * stay visible in the task list and get no map pin.
 *
 * `Misthalin` is also intentionally absent: the region is locked this
 * league, so pinning there is pure noise (see INACCESSIBLE_REGIONS in
 * src/data/wikiEntities.ts).
 */
const REGION_CENTROIDS: Partial<Record<Region, { x: number; y: number }>> = {
  Varlamore: { x: 1600, y: 3060 },
  Karamja: { x: 2850, y: 3100 },
  Asgarnia: { x: 2980, y: 3360 },
  Desert: { x: 3300, y: 2950 },
  Fremennik: { x: 2660, y: 3680 },
  Kandarin: { x: 2690, y: 3300 },
  Kourend: { x: 1700, y: 3670 },
  Morytania: { x: 3550, y: 3400 },
  Tirannwn: { x: 2300, y: 3200 },
  Wilderness: { x: 3200, y: 3800 },
};

interface PreparedLocation {
  id: string;
  region: Region;
  aliases: string[]; // lowercased
}

const PREPARED: PreparedLocation[] = LOCATIONS.map((l) => ({
  id: l.id,
  region: l.region,
  aliases: [l.name.toLowerCase(), ...(l.aliases ?? []).map((a) => a.toLowerCase())],
}));

/**
 * Entity aliases sorted longest-first so "Silk Merchant (Civitas illa Fortis)"
 * wins over "Silk" when doing description scans. Built once at module load.
 */
const ENTITY_ALIAS_INDEX: { alias: string; location: (typeof ENTITY_LOCATIONS)[number] }[] = (() => {
  const out: { alias: string; location: (typeof ENTITY_LOCATIONS)[number] }[] = [];
  for (const ent of ENTITY_LOCATIONS) {
    for (const a of ent.aliases ?? []) out.push({ alias: a, location: ent });
  }
  out.sort((a, b) => b.alias.length - a.alias.length);
  return out;
})();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns true if `haystack` contains `needle` as a whole-word (or phrase) match. */
function hasAlias(haystack: string, alias: string): boolean {
  if (!alias) return false;
  // Short aliases (<=3 chars) require word boundaries to avoid false positives.
  if (alias.length <= 3) {
    const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
    return re.test(haystack);
  }
  // Phrases (with space) are matched literally.
  if (alias.includes(" ")) return haystack.includes(alias);
  // Single-word aliases: allow trailing 's' plural, require start-of-word.
  const re = new RegExp(`\\b${escapeRegex(alias)}s?\\b`, "i");
  return re.test(haystack);
}

function isUnmappable(task: Task): boolean {
  const line = task.name + " " + task.descriptionClean;
  return UNMAPPABLE_PATTERNS.some((p) => p.test(line));
}

/**
 * Given a list of entity candidates (one entry per region the entity
 * spawns in), pick the id that best matches the task's own region.
 * If none of the candidates match, return all candidate ids (the UI
 * will pick the first as primary).
 */
function pickEntitySpawnForRegion(
  task: Task,
  candidates: readonly { id: string; region: Region }[],
): string[] {
  // "General" tasks (e.g. "Pickpocket a Citizen", "Defeat a Rat") aren't
  // tied to any region — they're completable anywhere the entity lives,
  // so we pin to EVERY region the entity spawns in. This gives the
  // player a visible marker in each league area they have unlocked.
  if (task.region === "General") {
    return candidates.map((c) => c.id);
  }
  // Region-tagged tasks prefer same-region spawns; fall back to all.
  const sameRegion = candidates.filter((c) => c.region === task.region);
  if (sameRegion.length > 0) return sameRegion.map((c) => c.id);
  return candidates.map((c) => c.id);
}

/**
 * Match a task to fine-grained entity pins via its wikiLinks.
 *
 * Each `wikiLink` is an exact wiki page title (e.g. "Thurgo",
 * "Black Knight", "Silk Merchant (Civitas illa Fortis)"). The entity
 * table is keyed by lowercased wiki title, so a direct lookup gives
 * O(1) resolution with zero false positives.
 *
 * For multi-spawn monsters we prefer the spawn inside the task's own
 * region — "Defeat a Black Knight in Asgarnia" picks the spawn in
 * White Knights' Castle, not the Wilderness cluster.
 */
function matchEntitiesViaLinks(task: Task): string[] {
  const hits = new Set<string>();
  for (const link of task.wikiLinks) {
    const ents = ENTITIES_BY_TITLE.get(link.toLowerCase());
    if (!ents) continue;
    for (const id of pickEntitySpawnForRegion(task, ents)) hits.add(id);
  }
  return [...hits];
}

/**
 * Fallback: scan the cleaned description for entity aliases. Handles cases
 * like "Equip Full Dharoks Armour Set" where the wiki link points at the
 * equipment page (no coord) but the boss name appears in text.
 */
function matchEntitiesViaText(task: Task): string[] {
  const hay = (task.name + " " + task.descriptionClean).toLowerCase();
  const hits = new Set<string>();
  const seenEntity = new Set<string>();
  for (const { alias, location } of ENTITY_ALIAS_INDEX) {
    if (alias.length < 4) continue; // skip "oli", "man", etc. - too ambiguous for text scan
    if (!hay.includes(alias)) continue;
    const idx = hay.indexOf(alias);
    const before = idx === 0 ? " " : hay[idx - 1];
    const after = idx + alias.length >= hay.length ? " " : hay[idx + alias.length];
    if (/[a-z0-9']/i.test(before) || /[a-z0-9]/i.test(after)) continue;
    // Dedupe per-entity and pick region-matching spawn.
    if (seenEntity.has(location.wikiTitle)) continue;
    seenEntity.add(location.wikiTitle);
    const ents = ENTITIES_BY_TITLE.get(alias);
    if (ents) {
      for (const id of pickEntitySpawnForRegion(task, ents)) hits.add(id);
    } else {
      hits.add(location.id);
    }
  }
  return [...hits];
}

function matchLocations(task: Task): string[] {
  const haystack = (
    task.descriptionClean +
    " " +
    task.wikiLinks.join(" ")
  ).toLowerCase();

  const matches = new Set<string>();
  // Prefer same-region matches first.
  for (const p of PREPARED) {
    if (p.region !== task.region) continue;
    for (const alias of p.aliases) {
      if (hasAlias(haystack, alias)) {
        matches.add(p.id);
        break;
      }
    }
  }
  if (matches.size > 0) return [...matches];

  // Otherwise scan all regions (useful for "General" tasks and
  // cross-regional quests like His Faithful Servants).
  for (const p of PREPARED) {
    for (const alias of p.aliases) {
      if (hasAlias(haystack, alias)) {
        matches.add(p.id);
        break;
      }
    }
  }
  return [...matches];
}

/**
 * Picks a primary location among many candidates.
 *
 * Scoring (higher wins):
 *   +1000 entity whose name appears in the task NAME  (Zulrah > Poison Waste
 *         for "Defeat Zulrah at the Poison Waste")
 *   + 100 entity/landmark in the same region as the task
 *   +  10 entity (fine-grained) over landmark (coarse)
 *   +   1 earlier in candidate array
 */
function pickPrimary(task: Task, candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const taskName = task.name.toLowerCase();

  let bestId: string | undefined;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i];
    let score = -i;
    if (id.startsWith("entity:")) {
      score += 10;
      const ent = ENTITY_LOCATIONS.find((l) => l.id === id);
      if (ent) {
        if (ent.region === task.region) score += 100;
        // Entity directly named in the task name scores highest.
        const name = ent.wikiTitle.toLowerCase();
        if (name.length >= 4 && taskName.includes(name)) score += 1000;
      }
    } else {
      const loc = LOCATIONS.find((l) => l.id === id);
      if (loc?.region === task.region) score += 100;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId ?? candidates[0];
}

export function resolveTasks(tasks: Task[]): TaskPlacement[] {
  return tasks.map((t) => resolveTask(t));
}

export function resolveTask(task: Task): TaskPlacement {
  if (isUnmappable(task)) {
    return {
      taskId: task.id,
      locations: [],
      unmappable: true,
      matchMethod: "none",
    };
  }

  // 1. Entity match via wikiLinks (precision pin).
  const entityHits = matchEntitiesViaLinks(task);
  if (entityHits.length > 0) {
    const primary = pickPrimary(task, entityHits);
    return {
      taskId: task.id,
      primary,
      locations: entityHits,
      unmappable: false,
      matchMethod: "wiki-link",
    };
  }

  // 2. Entity match via description text scan (for un-linked mentions).
  const entityText = matchEntitiesViaText(task);
  if (entityText.length > 0) {
    const primary = pickPrimary(task, entityText);
    return {
      taskId: task.id,
      primary,
      locations: entityText,
      unmappable: false,
      matchMethod: "wiki-link",
    };
  }

  // 3. Landmark alias match (coarse city/region pins).
  const candidates = matchLocations(task);
  if (candidates.length > 0) {
    const primary = pickPrimary(task, candidates);
    return {
      taskId: task.id,
      primary,
      locations: candidates,
      unmappable: false,
      matchMethod: "explicit-alias",
    };
  }

  // Region-tagged tasks with no specific match get a pin at the region's
  // centroid as a "somewhere in X" fallback. Regions absent from
  // REGION_CENTROIDS (General, Misthalin) deliberately get NO fallback pin
  // — see the REGION_CENTROIDS doc comment.
  const centroid = REGION_CENTROIDS[task.region];
  if (centroid) {
    return {
      taskId: task.id,
      locations: [`__centroid_${task.region}`],
      unmappable: false,
      matchMethod: "region-fallback",
    };
  }

  return {
    taskId: task.id,
    locations: [],
    unmappable: true,
    matchMethod: "none",
  };
}

/** Region centroid pseudo-location used for fallback pins. */
export function centroidLocationId(region: Region): string {
  return `__centroid_${region}`;
}

export function regionCentroid(
  region: Region,
): { x: number; y: number } | undefined {
  return REGION_CENTROIDS[region];
}
