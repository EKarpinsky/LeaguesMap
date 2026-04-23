/**
 * Scrapes Demonic Pacts League tasks from the OSRS Wiki and emits
 * structured JSON to src/data/tasks.json.
 *
 * The tasks live in template invocations like:
 *   {{DPLTaskRow|Name|Description|s=skills|other=other|tier=easy|region=General|pactTask=yes|id=3}}
 *
 * Run: npx tsx scripts/scrape-tasks.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WIKI_API =
  "https://oldschool.runescape.wiki/api.php?action=parse&page=Demonic_Pacts_League/Tasks&prop=wikitext&format=json&formatversion=2";

const TIER_POINTS: Record<string, number> = {
  easy: 10,
  medium: 30,
  hard: 80,
  elite: 200,
  master: 400,
};

const REGION_ALIASES: Record<string, string> = {
  "kharidian desert": "Desert",
  desert: "Desert",
  "fremennik provinces": "Fremennik",
  fremennik: "Fremennik",
};

type Difficulty = "Easy" | "Medium" | "Hard" | "Elite" | "Master";

export interface Task {
  id: string;
  name: string;
  description: string;
  descriptionClean: string;
  region: string;
  difficulty: Difficulty;
  points: number;
  isDemonicPact: boolean;
  skillRequirements: { skill: string; level: number }[];
  otherRequirements: string;
  /** Extracted wiki links (pages referenced in the description). */
  wikiLinks: string[];
}

/** Splits the top-level arguments of a single template invocation on pipes. */
function splitTemplateArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let linkDepth = 0;
  let buf = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    const n = inner[i + 1];
    if (c === "{" && n === "{") {
      depth++;
      buf += c + n;
      i++;
      continue;
    }
    if (c === "}" && n === "}") {
      depth--;
      buf += c + n;
      i++;
      continue;
    }
    if (c === "[" && n === "[") {
      linkDepth++;
      buf += c + n;
      i++;
      continue;
    }
    if (c === "]" && n === "]") {
      linkDepth--;
      buf += c + n;
      i++;
      continue;
    }
    if (c === "|" && depth === 0 && linkDepth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

/** Finds the inner contents of every {{DPLTaskRow|...}} invocation. */
function extractTaskRows(wikitext: string): string[] {
  const needle = "{{DPLTaskRow|";
  const rows: string[] = [];
  let cursor = 0;
  while (cursor < wikitext.length) {
    const start = wikitext.indexOf(needle, cursor);
    if (start === -1) break;
    let i = start + 2;
    let depth = 1;
    while (i < wikitext.length && depth > 0) {
      if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
        depth++;
        i += 2;
      } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
        depth--;
        i += 2;
      } else {
        i++;
      }
    }
    rows.push(wikitext.slice(start + 2, i - 2));
    cursor = i;
  }
  return rows;
}

function parseSkillRequirements(s: string): { skill: string; level: number }[] {
  if (!s) return [];
  const out: { skill: string; level: number }[] = [];
  const re = /\{\{SCP\|([A-Za-z ]+)\|(\d+)[^}]*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push({ skill: m[1].trim(), level: parseInt(m[2], 10) });
  }
  return out;
}

function stripWikiMarkup(text: string): string {
  return text
    .replace(/\{\{SCP\|([A-Za-z ]+)\|(\d+)[^}]*\}\}/g, (_m, skill, lvl) => `${skill} ${lvl}`)
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''|''/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWikiLinks(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const page = m[1].trim();
    if (page) out.push(page);
  }
  return [...new Set(out)];
}

function normalizeRegion(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (REGION_ALIASES[k]) return REGION_ALIASES[k];
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main(): Promise<void> {
  console.log("Fetching tasks page from OSRS Wiki…");
  const res = await fetch(WIKI_API, {
    headers: { "User-Agent": "LeaguesMap/0.1 (https://github.com/)" },
  });
  if (!res.ok) {
    throw new Error(`Wiki API returned ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { parse: { wikitext: string } };
  const wikitext = data.parse.wikitext;
  console.log(`  wikitext length: ${wikitext.length.toLocaleString()} chars`);

  const rows = extractTaskRows(wikitext);
  console.log(`  found ${rows.length} DPLTaskRow invocations`);

  const tasks: Task[] = [];
  for (const row of rows) {
    const parts = splitTemplateArgs(row);
    // parts[0] is the template name ("DPLTaskRow"); positional args follow.
    // Positional: [template, name, description, ...named]
    const name = parts[1]?.trim();
    const description = parts[2]?.trim() ?? "";
    const named: Record<string, string> = {};
    for (let i = 3; i < parts.length; i++) {
      const p = parts[i];
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      const key = p.slice(0, eq).trim();
      const value = p.slice(eq + 1).trim();
      named[key] = value;
    }

    if (!name || !named.tier || !named.region || !named.id) continue;
    const tier = named.tier.toLowerCase();
    const difficulty = (tier.charAt(0).toUpperCase() + tier.slice(1)) as Difficulty;
    const points = TIER_POINTS[tier] ?? 0;

    tasks.push({
      id: named.id,
      name,
      description,
      descriptionClean: stripWikiMarkup(description),
      region: normalizeRegion(named.region),
      difficulty,
      points,
      isDemonicPact: (named.pactTask ?? "").toLowerCase() === "yes",
      skillRequirements: parseSkillRequirements(named.s ?? ""),
      otherRequirements: stripWikiMarkup(named.other ?? ""),
      wikiLinks: extractWikiLinks(description),
    });
  }

  tasks.sort((a, b) => {
    if (a.region !== b.region) return a.region.localeCompare(b.region);
    const order = ["Easy", "Medium", "Hard", "Elite", "Master"];
    const d = order.indexOf(a.difficulty) - order.indexOf(b.difficulty);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });

  // Summary
  const byRegion = new Map<string, number>();
  const byDifficulty = new Map<string, number>();
  let pactCount = 0;
  let totalPoints = 0;
  for (const t of tasks) {
    byRegion.set(t.region, (byRegion.get(t.region) ?? 0) + 1);
    byDifficulty.set(t.difficulty, (byDifficulty.get(t.difficulty) ?? 0) + 1);
    if (t.isDemonicPact) pactCount++;
    totalPoints += t.points;
  }
  console.log(`  parsed ${tasks.length} tasks, ${pactCount} demonic-pact tasks`);
  console.log(`  total points: ${totalPoints.toLocaleString()}`);
  console.log("  by region:", Object.fromEntries([...byRegion].sort()));
  console.log("  by difficulty:", Object.fromEntries([...byDifficulty]));

  const here = dirname(fileURLToPath(import.meta.url));
  const outFile = resolve(here, "../src/data/tasks.json");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(tasks, null, 2));
  console.log(`Wrote ${tasks.length} tasks to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
