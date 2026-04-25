import type { Region, WorldLocation } from "../types";
import { MAP_IMAGE } from "../lib/calibration";
import rawEntities from "./wikiEntities.json" with { type: "json" };

/**
 * Hard gate applied to every (x, y) spawn before it becomes a pin. Any
 * coord outside the calibrated world-map PNG must be rejected — pins
 * would otherwise render in the dark void outside the image. Belt-and-
 * suspenders backup for the scraper's own surface-pin filter: if a new
 * wiki template or a mis-tagged mapID ever smuggles a non-surface coord
 * through, we still refuse to place it on the map.
 */
function isOnMap(x: number, y: number): boolean {
  return (
    x >= MAP_IMAGE.gameXMin &&
    x <= MAP_IMAGE.gameXMax &&
    y >= MAP_IMAGE.gameYMin &&
    // Surface content on the PNG stops at y≈4094; anything above is
    // instance / dungeon coord space that happens to fit inside the
    // linear-calibration envelope (gameYMax=4270) but lives in the
    // void above the rendered image.
    y <= 4094
  );
}

/**
 * Fine-grained NPC / monster / scenery pins sourced from the OSRS Wiki.
 *
 * Built by `scripts/fetch-wiki-entities.py`, which walks every wiki page
 * referenced from tasks.json and parses every {{Map}} / {{LocLine}}
 * template for surface-world coordinates.
 *
 * This is what lets "Give Oli some Stew" pin to Oli's actual tile in
 * Civitas and "Defeat a Black Knight in Asgarnia" pin to the White
 * Knights' Castle basement — instead of collapsing every Civitas or
 * Asgarnia task into a single city anchor.
 */

interface RawEntity {
  title: string;
  resolvedTitle: string;
  x: number;
  y: number;
  source: "map" | "locline" | "curated";
  allSpawns: [number, number][];
  /**
   * Optional parallel array to `allSpawns`: `spawnNotes[i]` is the curated
   * blurb for spawn `i`. Used by multi-anchor curated entities where the
   * entity-level `note` can only describe ONE region's pin — e.g. "Troll"
   * has a Burthorpe (Asgarnia) spawn AND a Keldagrim entrance (Fremennik)
   * spawn. Without this, every regional pin would inherit the first spawn's
   * note and the Fremennik pin would render "Burthorpe" as its blurb.
   */
  spawnNotes?: (string | null)[];
  /**
   * Optional parallel array to `allSpawns`: `spawnRegions[i]` is the
   * wiki-authoritative `leagueRegion` for spawn `i`. Sourced from the
   * `leagueRegion=` parameter on each {{LocLine}} template (or the
   * anchor page's infobox for curated entries). When present, this is
   * the SOURCE OF TRUTH for the spawn's region — `inferRegion` trusts
   * it absolutely and skips the bbox classification. The bbox path
   * only runs as a last-resort fallback for spawns the wiki didn't tag.
   *
   * This is the fix for "Kraken Cove and Piscatoris listed as
   * Fremennik" — the wiki tags both pages `leagueRegion = Kandarin`,
   * but their spawn coords (y > 3580) sit just outside the runtime
   * Kandarin bbox, so the bbox guess used to win and mislabel them
   * as Fremennik. With wiki-sourced per-spawn regions in hand, we
   * stop guessing.
   */
  spawnRegions?: (string | null)[];
  category: string | null;
  leagueRegion: string | null;
  note?: string;
}

const RAW = rawEntities as unknown as Record<string, RawEntity>;

/** Entity id = stable string key the resolver uses (`"entity:<lowercase-title>"`). */
export function entityLocationId(title: string): string {
  return `entity:${title.toLowerCase()}`;
}

/**
 * Accept-list of wiki categories we trust as "real pins". Skill/shop/quest
 * pages accidentally match locations of shopkeepers/quest-starters — these
 * are legitimate NPC pins. Items (where the wiki infobox Map pins the NPC
 * who drops them) are rejected because the coord is the DROPPER, not the
 * item itself.
 */
const USABLE_CATEGORIES = new Set([
  "npc",
  "monster",
  "shop",
  "boss",
  "minigame",
  "raid",
  "dungeon",
  "activity",
  "landmark",
  "scenery",
  "quest",
  "city",
]);

const REJECT_CATEGORIES = new Set(["item", "equipment"]);

/**
 * OSRS-world region bounding boxes used to classify individual spawns.
 * Misthalin is intentionally included here so spawns in Lumbridge/Varrock
 * are correctly identified as Misthalin and then *dropped*: Misthalin is
 * locked in the Demonic Pacts league, so Lumbridge pins would be useless
 * to the player. Entities like `Woman`, `Man`, `Onion`, `Frog` still get
 * pins in every accessible league region they spawn in.
 */
const REGION_BBOXES: { region: Region; xmin: number; xmax: number; ymin: number; ymax: number }[] = [
  { region: "Varlamore",  xmin: 1150, xmax: 1900, ymin: 2850, ymax: 3420 },
  { region: "Karamja",    xmin: 2700, xmax: 2980, ymin: 2900, ymax: 3270 },
  { region: "Asgarnia",   xmin: 2850, xmax: 3100, ymin: 3130, ymax: 3580 },
  // Misthalin bbox is intentionally wide so it overlaps Asgarnia's east
  // edge / Wilderness's south edge. Thanks to the tightest-bbox tiebreak
  // Misthalin still wins inside Lumbridge / Draynor / Varrock / GE /
  // Edgeville proper, which lets INACCESSIBLE_REGIONS drop those
  // coords. Entities that spawn in both Misthalin and a real league
  // region (like Master Farmer, Wheat, Man) keep their valid-region
  // pins; the only effect is that Draynor-cluster medoids stop leaking
  // into the Asgarnia bucket.
  // Misthalin extends slightly south + east to absorb Giants' Plateau /
  // Giants' Foundry (game ~3360, ~3155 — the Anvil pin "East of Al
  // Kharid, west of Citharede Abbey"), which is canonically Misthalin
  // and therefore unreachable in Demonic Pacts. Without this, the
  // anvil there falls back to "General" and the Smith-bar tasks pin
  // their primary to a place the player can never reach. The new
  // (3070-3400, 3140-3520) bbox is still tighter than Asgarnia at the
  // overlap strip on the east side of Edgeville/Falador, so it doesn't
  // bleed into reachable Asgarnia coords.
  { region: "Misthalin",  xmin: 3070, xmax: 3400, ymin: 3140, ymax: 3520 },
  { region: "Desert",     xmin: 3150, xmax: 3550, ymin: 2700, ymax: 3150 },
  // Kandarin extends south to y=2820 to cover Feldip Hills + Myths' Guild
  // (game ~2464, ~2848 — the upstairs anvil from Dragon Slayer II) and
  // surrounding Corsair Cove / Castle Wars approaches. The southern
  // extension overlaps Karamja's western edge (Karamja xmin=2700,
  // ymin=2900) but the tightest-bbox tiebreak keeps Karamja-region
  // coords on Karamja since Karamja's bbox is ~5× smaller. Without
  // this extension, the Anvil entity collapses its General-region
  // medoid onto a Sailing port instead of pinning to Myths' Guild.
  { region: "Kandarin",   xmin: 2150, xmax: 2850, ymin: 2820, ymax: 3580 },
  // Kourend extends west to x=1170 to capture the south-west coast of the
  // Kebos Lowlands (Crimson Swift snare site at game ~1185, ~3595 — wiki
  // page tags this cluster as Kourend explicitly). Without the extension
  // these coords match no bbox and fall back to the entity-level
  // leagueRegion, which on Crimson Swift is "Desert" (the wiki's first
  // LocLine entry is the single Ruins of Ullek spawn). The result: 5
  // Kebos spawns medoid-collapsed onto a "Desert" pin rendered in Kebos
  // Lowlands. Same fix incidentally re-classifies a Rock Crab spawn
  // (1197, 3587) from Fremennik fallback to Kourend, which is correct
  // (Land's End rock crabs are canonically Kourend).
  { region: "Kourend",    xmin: 1170, xmax: 1900, ymin: 3420, ymax: 3980 },
  { region: "Morytania",  xmin: 3400, xmax: 3800, ymin: 3100, ymax: 3530 },
  // Fremennik extends west to x=2050 to cover Lunar Isle, Suqah Isle,
  // and the Pirates' Cove / Lunar dock approaches (game ~2117 to ~2210
  // at y > 3800). The Lunar Isle pin itself was already classified as
  // Fremennik via the entity-level leagueRegion fallback, but coords
  // packed into multi-spawn templates without per-coord leagueRegion
  // tags (e.g. the Port master entity at game 2146, 3879) need a real
  // bbox match to avoid collapsing to "General". The extension can't
  // absorb Tirannwn coords because the y-ranges don't overlap (Tirannwn
  // ymax=3500 < Fremennik ymin=3580).
  { region: "Fremennik",  xmin: 2050, xmax: 2900, ymin: 3580, ymax: 4100 },
  { region: "Tirannwn",   xmin: 2100, xmax: 2350, ymin: 3050, ymax: 3500 },
  { region: "Wilderness", xmin: 2940, xmax: 3400, ymin: 3520, ymax: 4000 },
];

/**
 * Regions that are NOT unlockable in the Demonic Pacts league. Spawns
 * that classify into these regions are dropped entirely when building
 * entity pins — the player can never reach them, so a pin there is
 * noise at best and actively misleading at worst (as in the old
 * "woman (Misthalin)" bucket eating General citizen tasks).
 */
const INACCESSIBLE_REGIONS: ReadonlySet<Region> = new Set(["Misthalin"]);

/**
 * Coords below this y are Sailing-era southern-ocean content (Sunbleak
 * Island, Abalone Cliffs, The Great Conch, the post-launch Pandemonium /
 * Summer Shore / Port Roberts / Red Rock / Deepfin Point ports). None of
 * the eleven Demonic Pacts league regions extend below y=2700 — Menaphos
 * (y≈2742) and Ape Atoll (y≈2715) are the southernmost reachable land —
 * so any spawn south of this latitude that doesn't land in a region bbox
 * is, by elimination, post-league content and should be dropped instead
 * of falling back to the entity-level leagueRegion (which would render
 * the pin in the open ocean).
 */
const POST_LEAGUE_SOUTH_Y = 2700;

const LEAGUE_REGION_LOOKUP: Record<string, Region> = {
  varlamore: "Varlamore",
  karamja: "Karamja",
  asgarnia: "Asgarnia",
  misthalin: "Misthalin",
  desert: "Desert",
  "kharidian desert": "Desert",
  kandarin: "Kandarin",
  kourend: "Kourend",
  "great kourend": "Kourend",
  morytania: "Morytania",
  fremennik: "Fremennik",
  "fremennik province": "Fremennik",
  tirannwn: "Tirannwn",
  wilderness: "Wilderness",
};

function lookupLeagueRegion(lr: string | null): Region | null {
  if (!lr) return null;
  return LEAGUE_REGION_LOOKUP[lr.trim().toLowerCase()] ?? null;
}

/**
 * Resolve the league region for a single spawn coord.
 *
 * Priority (highest first — the user's NO GUESSING rule):
 *
 *   1. Per-spawn `spawnRegion` from the wiki's {{LocLine|leagueRegion=…}}
 *      parameter (or anchor-page infobox for curated entries). This is
 *      the wiki author's own classification of THIS specific spawn —
 *      authoritative.
 *
 *   2. Entity-level `leagueRegion` from the wiki page's infobox, BUT
 *      only when the spawn coord is consistent with that region's bbox.
 *      If the page says "Kandarin" and the bbox-of-Kandarin contains
 *      this spawn, trust the page. If they disagree (e.g. Black Knight
 *      page tagged Wilderness but a spawn sits in the White Knights'
 *      Castle basement at Asgarnia coords), fall through — the wiki's
 *      page-level tag describes the entity's "primary" region, not
 *      every individual spawn.
 *
 *   3. Single-spawn shortcut: if the entity has only ONE spawn and a
 *      page-level `leagueRegion`, trust the page even when the bbox
 *      disagrees. Single-spawn entities with a wiki tag are landmarks /
 *      bosses / dungeons whose region cannot be ambiguous; the bbox is
 *      just our coordinate geometry, not a wiki source.
 *
 *   4. Bounding-box classification (last resort, used to be primary).
 *      Pick the TIGHTEST (smallest-area) matching bbox so Tirannwn
 *      wins over Kandarin for points in Zul-Andra, etc.
 *
 *   5. Page-level `leagueRegion` as final coord-free fallback (e.g.
 *      Pest Control at (2658, 2625) has no bbox match but the page
 *      tags it Asgarnia).
 *
 * Returns null only when every signal is missing AND the spawn sits
 * below the southern Demonic Pacts boundary (Sailing-era ocean).
 */
function inferRegion(
  x: number,
  y: number,
  spawnRegion: string | null,
  entityRegion: string | null,
  isSingleSpawn: boolean,
): Region | null {
  // 1. Per-spawn wiki tag — absolute source of truth.
  const fromSpawn = lookupLeagueRegion(spawnRegion);
  if (fromSpawn) return fromSpawn;

  // Compute bbox classification once — used in priorities 2, 3 and 4.
  let bboxRegion: Region | null = null;
  let bestArea = Infinity;
  for (const bb of REGION_BBOXES) {
    if (x >= bb.xmin && x <= bb.xmax && y >= bb.ymin && y <= bb.ymax) {
      const area = (bb.xmax - bb.xmin) * (bb.ymax - bb.ymin);
      if (area < bestArea) {
        bestArea = area;
        bboxRegion = bb.region;
      }
    }
  }

  const fromEntity = lookupLeagueRegion(entityRegion);

  // 2. Entity-level tag wins when bbox agrees — high confidence.
  if (fromEntity && bboxRegion === fromEntity) return fromEntity;

  // 3. Single-spawn shortcut — entity tag is unambiguous for this spawn.
  // Even if bbox disagrees (Kraken Cove at y=3611 falls outside our
  // Kandarin bbox), the wiki said Kandarin and we trust the wiki.
  if (isSingleSpawn && fromEntity) return fromEntity;

  // 4. Bbox classification (multi-spawn entities w/o per-spawn tag).
  if (bboxRegion) return bboxRegion;

  // 5. No bbox match — fall back to the page-level tag, then "General".
  // Below the southern Demonic Pacts boundary we refuse to fall back
  // to "General" or to a missing leagueRegion — those are post-league
  // Sailing coords (Port master at y=2370 etc.) that would render in
  // the open sea. A known league region is still honoured (the wiki
  // author has explicitly tagged the content as reachable).
  if (y < POST_LEAGUE_SOUTH_Y) return fromEntity;
  return fromEntity ?? "General";
}

function mapCategory(c: string | null): WorldLocation["category"] {
  switch (c) {
    case "npc": return "npc";
    case "monster": return "npc";
    case "shop": return "shop";
    case "boss": return "boss";
    case "minigame": return "minigame";
    case "raid": return "raid";
    case "dungeon": return "dungeon";
    case "quest": return "quest";
    case "city": return "city";
    case "scenery":
    case "activity":
    case "landmark":
    default:
      return "landmark";
  }
}

/**
 * For multi-spawn entities (monsters like "Black Knight" that spawn in
 * several regions), we generate a SEPARATE WorldLocation per region they
 * appear in. The resolver can then pick the spawn in the task's region:
 * "Defeat a Black Knight in Asgarnia" → the Black Knight pin inside the
 * White Knights' Castle basement, not the Wilderness spawn cluster.
 *
 * This keeps regional tasks visually correct while still letting
 * unspecified tasks ("Defeat a Black Knight") use the first spawn.
 */
export interface EntityLocation extends WorldLocation {
  /** Original wiki title (pre-lowercase key). */
  wikiTitle: string;
  /** Zero-indexed — 0 means the primary/first spawn for this entity. */
  spawnIndex: number;
}

/** All entity-derived locations (one per distinct region a monster spawns in). */
export const ENTITY_LOCATIONS: EntityLocation[] = (() => {
  const out: EntityLocation[] = [];
  for (const [key, ent] of Object.entries(RAW)) {
    const cat = ent.category ?? "";
    if (REJECT_CATEGORIES.has(cat)) continue;
    if (!USABLE_CATEGORIES.has(cat) && ent.source !== "curated") continue;

    // Group spawns by the region they fall in. One marker per region.
    // Spawns in inaccessible regions (Misthalin) are dropped — the
    // player can't reach them, so a pin there is worse than no pin.
    const spawnsByRegion = new Map<Region, [number, number][]>();
    const rawSpawns: [number, number][] = ent.allSpawns.length > 0
      ? ent.allSpawns
      : [[ent.x, ent.y]];
    // Keep `spawnNotes` and `spawnRegions` parallel to the filtered
    // spawns so we can attach the right per-spawn blurb AND the wiki's
    // per-spawn `leagueRegion` to each region's medoid pin later.
    const noteByCoord = new Map<string, string | null>();
    const regionByCoord = new Map<string, string | null>();
    if (ent.spawnNotes) {
      ent.allSpawns.forEach((s, i) => {
        noteByCoord.set(`${s[0]},${s[1]}`, ent.spawnNotes?.[i] ?? null);
      });
    }
    if (ent.spawnRegions) {
      ent.allSpawns.forEach((s, i) => {
        regionByCoord.set(`${s[0]},${s[1]}`, ent.spawnRegions?.[i] ?? null);
      });
    }
    const spawns = rawSpawns.filter(([sx, sy]) => isOnMap(sx, sy));
    if (spawns.length === 0) continue;
    // `isSingleSpawn` triggers the "trust the wiki, ignore the bbox"
    // shortcut in `inferRegion` — but only when the entity genuinely has
    // ONE on-map spawn. Multi-spawn entities (Black Knight et al.) keep
    // bbox-per-spawn so regional tasks find the right pin.
    const isSingleSpawn = spawns.length === 1;
    for (const [sx, sy] of spawns) {
      const spawnLR = regionByCoord.get(`${sx},${sy}`) ?? null;
      const r = inferRegion(sx, sy, spawnLR, ent.leagueRegion, isSingleSpawn);
      if (r === null) continue;
      if (INACCESSIBLE_REGIONS.has(r)) continue;
      const arr = spawnsByRegion.get(r) ?? [];
      arr.push([sx, sy]);
      spawnsByRegion.set(r, arr);
    }
    // Entity has spawns only in inaccessible regions — skip entirely.
    if (spawnsByRegion.size === 0) continue;

    // Display name uses the canonical wiki-resolved title, not the
    // lower-cased lookup key: "Woman" not "woman", "Black Knight" not
    // "black knight".
    const displayName = ent.resolvedTitle;

    let idx = 0;
    for (const [region, list] of spawnsByRegion) {
      // Pick the MEDOID — the spawn minimizing summed distance to every
      // other spawn in the region. Unlike the mean centroid, this is
      // robust to bimodal clusters (e.g. Arctic pines around Neitiznot +
      // a small grove near Keldagrim, whose mean falls in open ocean).
      // The medoid is always an actual spawn inside the densest cluster.
      let best = list[0];
      let bestSum = Infinity;
      for (const [px, py] of list) {
        let sum = 0;
        for (const [qx, qy] of list) {
          sum += Math.hypot(px - qx, py - qy);
        }
        if (sum < bestSum) {
          bestSum = sum;
          best = [px, py];
        }
      }
      const suffix = idx === 0 ? "" : `:${region.toLowerCase()}`;
      // Dedupe aliases: key, title, resolvedTitle are often the same
      // string after lower-casing (e.g. "woman" / "woman" / "woman").
      // Leaving duplicates in here would cause ENTITIES_BY_TITLE to
      // register the same entity 3× under the same key.
      const aliasSet = new Set<string>([
        key,
        ent.title.toLowerCase(),
        ent.resolvedTitle.toLowerCase(),
      ]);
      // Name stays just the entity title — the popup already shows the
      // region via its badge + "Asgarnia · 3 tasks" meta line, so
      // "Warriors' Guild (Asgarnia)" is redundant. Curated `ent.note`
      // still passes through for hand-written hints (e.g. dungeon
      // entrance pointers).
      // Per-spawn blurb wins over the entity-level `note`, so the Fremennik
      // Troll pin gets "Keldagrim entrance" and the Asgarnia Burthorpe pin
      // gets "Burthorpe" — instead of both inheriting whichever happened
      // to be the entity's first-spawn note.
      const perSpawnNote = noteByCoord.get(`${best[0]},${best[1]}`);
      const blurb = perSpawnNote ?? ent.note;
      out.push({
        id: `${entityLocationId(key)}${suffix}`,
        name: displayName,
        x: best[0],
        y: best[1],
        region,
        category: mapCategory(ent.category),
        aliases: [...aliasSet],
        blurb,
        wikiTitle: ent.title,
        spawnIndex: idx,
      });
      idx++;
    }
  }
  return out;
})();

/**
 * Lookup: lowercased wiki title → ALL EntityLocation pins for that entity,
 * one per region it spawns in. Resolver picks the best-matching region.
 */
export const ENTITIES_BY_TITLE: Map<string, EntityLocation[]> = (() => {
  const m = new Map<string, EntityLocation[]>();
  for (const ent of ENTITY_LOCATIONS) {
    for (const a of ent.aliases ?? []) {
      const arr = m.get(a) ?? [];
      arr.push(ent);
      m.set(a, arr);
    }
  }
  return m;
})();
