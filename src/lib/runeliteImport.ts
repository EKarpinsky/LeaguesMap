/**
 * RuneLite "Tasks Tracker" plugin importer.
 *
 * Why this exists
 * ───────────────
 * The OSRS Wiki's WikiSync API is the obvious sync source — it stores every
 * player's league varp bitfield and exposes a clean
 * `GET /runelite/player/{rsn}/DEMONIC_PACTS_LEAGUE` endpoint. We can't use
 * it: weirdgloop blocks third-party origins at Cloudflare with a hard 403
 * ("Please do not use WikiSync in your own projects.") and ships a public
 * policy forbidding third-party use. Routing it through our own server
 * would just be ducking the policy.
 *
 * Tasks Tracker is a fully-public RuneLite plugin that exports the same
 * underlying data — the player's raw league task varps (player variables
 * 2616..4049) — to a JSON file the user can save & paste/upload. Decoding
 * those varps with the same algorithm WikiSync uses gives us the exact
 * same set of completed task IDs, with zero backend.
 *
 * Decoding algorithm (verbatim from the open-source wikisync-api repo,
 * src/runelite/transformers/LeagueTransformer.ts):
 *
 *     LEAGUE_TASK_VARPS.forEach((varp, index) => {
 *       const v = varps[varp];
 *       for (let i = 0; i < 32; i++) {
 *         if (isBitSet(v, i)) results.push(32 * index + i);
 *       }
 *     });
 *
 * Our `tasks.json` IDs are 0..1591 — already in this `32*index + bit`
 * scheme — so the decoded numbers map 1:1 to task IDs with zero remap
 * table.
 *
 * The bitfield-to-task-ID promise is what every league-tracker tool
 * downstream of Jagex's varp design relies on, so it's stable across
 * weekly updates: Jagex would need to renumber the varps to break it,
 * and that hasn't happened in 5+ leagues.
 */

import { ALL_TASKS } from "./taskIndex";

/**
 * The 62 player-variables (varps) Jagex uses to store Demonic Pacts task
 * completion. Each varp is a signed 32-bit int storing 32 tasks as bits;
 * the array index determines which task ID range the varp covers.
 *
 * Source: https://github.com/weirdgloop/wikisync-api/blob/master/src/runelite/data/leagueTaskVarps.json
 *
 * If a future weekly bump adds varps to this list, either re-fetch from
 * the upstream repo or extend in place — extra varps not yet covered
 * will silently no-op (the user just won't see those tasks marked).
 */
export const LEAGUE_TASK_VARPS: readonly number[] = [
  2616, 2617, 2618, 2619, 2620, 2621, 2622, 2623, 2624, 2625, 2626, 2627,
  2628, 2629, 2630, 2631, 2808, 2809, 2810, 2811, 2812, 2813, 2814, 2815,
  2816, 2817, 2818, 2819, 2820, 2821, 2822, 2823, 2824, 2825, 2826, 2827,
  2828, 2829, 2830, 2831, 2832, 2833, 2834, 2835, 3339, 3340, 3341, 3342,
  4036, 4037, 4038, 4039, 4040, 4041, 4042, 4043, 4044, 4045, 4046, 4047,
  4048, 4049,
];

export interface ParseSuccess {
  ok: true;
  /** Set of task IDs (as strings, matching ALL_TASKS[].id) that the export marks complete. */
  completedIds: Set<string>;
  /** RSN from the export, if present — surfaced in the dialog so the user can sanity-check. */
  displayName: string | null;
  /** Plugin-reported task type. We accept anything containing "LEAGUE" since older exports used "LEAGUE_5", "LEAGUE_6", etc. */
  taskType: string | null;
  /** Diagnostics for the dialog: how many varps were present, decoded bits, and how many decoded IDs aren't tasks in our manifest. */
  stats: {
    varpsCovered: number;
    varpsTotal: number;
    bitsSet: number;
    matchedTasks: number;
    unknownIds: number;
  };
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

interface RawExport {
  varps?: Record<string, unknown>;
  displayName?: unknown;
  taskType?: unknown;
}

/**
 * Parse + validate a Tasks Tracker JSON export and return the set of
 * completed task IDs. Returns a discriminated union — failures carry a
 * human-readable `error` string suitable for direct display in the modal.
 *
 * We're permissive about everything except the `varps` object: missing
 * displayName / taskType / quests / diaries / tasks fields are all fine
 * (older exports omit them), but a missing or empty varps map is a hard
 * failure since varps are the entire payload we care about.
 */
export function parseTasksTrackerExport(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty input. Paste the export JSON or pick the file." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    return { ok: false, error: `Couldn't parse JSON: ${msg}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Export must be a JSON object (got " + typeof parsed + ")." };
  }

  const obj = parsed as RawExport;
  const varps = obj.varps;

  if (!varps || typeof varps !== "object") {
    return {
      ok: false,
      error:
        "No `varps` field found. Make sure you exported from RuneLite's Tasks Tracker plugin (Tasks Tracker → Export → Copy to clipboard).",
    };
  }

  // Tasks Tracker stores varps as { "<varpId>": <int32> }. We accept both
  // numeric and string keys to be tolerant of different export formats.
  const numericVarps: Record<number, number> = {};
  let parsedVarpCount = 0;
  for (const [k, v] of Object.entries(varps as Record<string, unknown>)) {
    const id = Number(k);
    const value = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(id) || !Number.isFinite(value)) continue;
    numericVarps[id] = value | 0;
    parsedVarpCount += 1;
  }

  if (parsedVarpCount === 0) {
    return {
      ok: false,
      error:
        "Found `varps` but it's empty. Your character may not have any league tasks recorded yet, or the export was generated before logging into a Demonic Pacts world.",
    };
  }

  const validTaskIds = new Set(ALL_TASKS.map((t) => t.id));
  const completedIds = new Set<string>();
  let varpsCovered = 0;
  let bitsSet = 0;
  let unknownIds = 0;

  // Mirrors the WikiSync algorithm exactly. Use unsigned shift (>>> 0) so
  // the sign bit on negative varp values (e.g. -1 = "all 32 tasks done")
  // doesn't cause `(v >> bit) & 1` to sign-extend and miss bit 31.
  for (let idx = 0; idx < LEAGUE_TASK_VARPS.length; idx++) {
    const varpId = LEAGUE_TASK_VARPS[idx];
    if (!(varpId in numericVarps)) continue;
    varpsCovered += 1;
    const value = numericVarps[varpId] >>> 0;
    for (let bit = 0; bit < 32; bit++) {
      if ((value & (1 << bit)) === 0) continue;
      bitsSet += 1;
      const taskId = String(idx * 32 + bit);
      if (validTaskIds.has(taskId)) {
        completedIds.add(taskId);
      } else {
        // A bit set for an ID outside our manifest just means Jagex added
        // a task we haven't scraped yet — log the count for diagnostics
        // but don't fail the whole import.
        unknownIds += 1;
      }
    }
  }

  // Last sanity gate: we must have decoded at least ONE recognised task,
  // otherwise the file is structurally valid but useless (e.g. someone
  // pasted a Trailblazer Reloaded export from the same plugin).
  if (completedIds.size === 0) {
    return {
      ok: false,
      error:
        "Decoded 0 league tasks from your varps. If this is a non-Demonic-Pacts export (Echoes, Trailblazer, etc.) the bitfields are different and won't map onto this league's tasks.",
    };
  }

  return {
    ok: true,
    completedIds,
    displayName:
      typeof obj.displayName === "string" && obj.displayName.length > 0
        ? obj.displayName
        : null,
    taskType: typeof obj.taskType === "string" ? obj.taskType : null,
    stats: {
      varpsCovered,
      varpsTotal: LEAGUE_TASK_VARPS.length,
      bitsSet,
      matchedTasks: completedIds.size,
      unknownIds,
    },
  };
}
