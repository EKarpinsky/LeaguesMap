export type Difficulty = "Easy" | "Medium" | "Hard" | "Elite" | "Master";

export const REGIONS = [
  "General",
  "Varlamore",
  "Karamja",
  "Asgarnia",
  "Desert",
  "Fremennik",
  "Kandarin",
  "Kourend",
  "Morytania",
  "Tirannwn",
  "Wilderness",
  "Misthalin",
] as const;
export type Region = (typeof REGIONS)[number];

/**
 * Display order for region chips in the filter UI. Misthalin is omitted
 * because no league task targets it (it's still a valid `Region` type for
 * forward-compatibility with wiki data).
 */
export const REGION_DISPLAY_ORDER: Region[] = [
  "General",
  "Varlamore",
  "Asgarnia",
  "Desert",
  "Fremennik",
  "Kandarin",
  "Karamja",
  "Kourend",
  "Morytania",
  "Tirannwn",
  "Wilderness",
];

export const DIFFICULTIES: Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
  "Elite",
  "Master",
];

/**
 * Region color palette — single source of truth shared by the map pins,
 * filter chips, and task-row region tags.
 *
 * Each entry was seeded by sampling the dominant interior color of the
 * region's official OSRS Leagues area badge (see
 * `scripts/extract-region-colors.py`), then hand-tuned so every region
 * is visually distinct at chip-size against the dark UI. A few badges
 * share palette slots on the wiki (Karamja / Kourend / Tirannwn all
 * sit in the same green bucket; Asgarnia / Misthalin share the blue
 * bucket; Desert / Kandarin share red); those were nudged to
 * neighbouring hues to preserve recognizability in the filter bar.
 *
 *   base — solid fill used for the map pin body and the active
 *          chip/tag border.
 *   text — a brightened version of `base` for chip/tag labels so
 *          they read cleanly on the dark panel.
 */
export const REGION_PALETTE: Record<Region, { base: string; text: string }> = {
  General: { base: "#8a8a99", text: "#d0d0dc" }, // neutral (no badge)
  Varlamore: { base: "#f5a023", text: "#fbcd7d" }, // gold sunburst
  Karamja: { base: "#1fa85c", text: "#8ed9ae" }, // green shield
  Asgarnia: { base: "#3484e0", text: "#a8c9f1" }, // royal blue + cross
  Desert: { base: "#d13535", text: "#efa3a3" }, // red shield
  Fremennik: { base: "#a87750", text: "#d9bfa4" }, // brown shield
  Kandarin: { base: "#c22e6a", text: "#e89bbd" }, // magenta chevron
  Kourend: { base: "#2fa88e", text: "#94d6c7" }, // jade (distinct from Karamja)
  Morytania: { base: "#7f5aa8", text: "#c2a8e0" }, // purple crest
  Tirannwn: { base: "#45d6a5", text: "#a9e9cf" }, // mint/cyan diamond
  Wilderness: { base: "#8a8a8a", text: "#c8c8c8" }, // skull gray
  Misthalin: { base: "#6c93b5", text: "#b4cbde" }, // desaturated (locked)
};

/** A single OSRS world location, expressed in game tile coordinates. */
export interface WorldLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  region: Region;
  category: LocationCategory;
  /**
   * Lowercase strings that, when found in a task description or wiki link,
   * should associate the task with this location.
   */
  aliases?: string[];
  /** Short context for the popup, e.g. "City", "Slayer boss lair". */
  blurb?: string;
}

export type LocationCategory =
  | "city"
  | "landmark"
  | "dungeon"
  | "boss"
  | "raid"
  | "minigame"
  | "npc"
  | "resource"
  | "shop"
  | "quest";

export interface Task {
  id: string;
  name: string;
  description: string;
  descriptionClean: string;
  region: Region;
  difficulty: Difficulty;
  points: number;
  isDemonicPact: boolean;
  skillRequirements: { skill: string; level: number }[];
  otherRequirements: string;
  wikiLinks: string[];
}

/** The result of resolving one task to zero or more world locations. */
export interface TaskPlacement {
  taskId: string;
  /** Primary location id — the "best" or canonical spot. */
  primary?: string;
  /** All viable locations for this task (includes primary). */
  locations: string[];
  /**
   * If true, the task is not tied to a single location
   * (skill totals, collection log counts, "any region" tasks, etc.).
   */
  unmappable: boolean;
  /** How the match was produced, for debugging/dev mode. */
  matchMethod:
    | "explicit-alias"
    | "wiki-link"
    | "resource-pattern"
    | "region-fallback"
    | "none";
}
