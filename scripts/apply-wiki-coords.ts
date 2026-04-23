/**
 * Apply the wiki-sourced coordinate corrections (from scripts/wiki-coords.json)
 * to src/data/locations.ts in-place.
 *
 * The JSON is produced by scripts/fetch-wiki-coords.py. Each record has:
 *    { id, current: [x, y], wiki: [x, y], source, note, wiki_page, delta_tiles }
 *
 * Edits ONLY the numeric x, y literals in each `L("id", "name", X, Y, ...)`
 * call in locations.ts — everything else (region, aliases, blurb) is untouched.
 *
 * Run:  npx tsx scripts/apply-wiki-coords.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOCATIONS_TS = resolve(ROOT, "src/data/locations.ts");
const WIKI_JSON = resolve(ROOT, "scripts/wiki-coords.json");

interface CoordRecord {
  id: string;
  name: string;
  current: [number, number];
  wiki: [number, number] | null;
  region: string;
  category: string;
  wiki_page: string;
  delta_tiles: number | null;
  source: "wiki" | "curated" | null;
  note: string;
}

function main(): void {
  const records: CoordRecord[] = JSON.parse(readFileSync(WIKI_JSON, "utf8"));
  let src = readFileSync(LOCATIONS_TS, "utf8");

  let changed = 0;
  let unchanged = 0;
  const missing: string[] = [];
  const moved: Array<{ id: string; from: [number, number]; to: [number, number]; source: string; delta: number }> = [];

  for (const r of records) {
    if (!r.wiki) continue;
    const [nx, ny] = r.wiki;
    const [cx, cy] = r.current;
    if (nx === cx && ny === cy) {
      unchanged++;
      continue;
    }
    // Match the EXACT existing L(...) call for this id and swap x,y.
    // We capture the prefix (id, name) and suffix (region, ...) so nothing else shifts.
    const pattern = new RegExp(
      String.raw`(L\(\s*"${escapeRegExp(r.id)}"\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*)(\d+)(\s*,\s*)(\d+)(\s*,)`,
      "g",
    );
    let found = false;
    const replaced = src.replace(pattern, (_m, pre, _ox, mid, _oy, post) => {
      found = true;
      return `${pre}${nx}${mid}${ny}${post}`;
    });
    if (!found) {
      missing.push(r.id);
      continue;
    }
    src = replaced;
    moved.push({ id: r.id, from: [cx, cy], to: [nx, ny], source: r.source ?? "?", delta: r.delta_tiles ?? 0 });
    changed++;
  }

  writeFileSync(LOCATIONS_TS, src);

  console.log(`Applied ${changed} coordinate updates to src/data/locations.ts`);
  console.log(`  unchanged (already correct): ${unchanged}`);
  if (missing.length > 0) {
    console.log(`  WARNING — ids not found in locations.ts: ${missing.length}`);
    for (const id of missing) console.log(`    ${id}`);
  }
  console.log();
  moved.sort((a, b) => b.delta - a.delta);
  console.log(`Changes applied (sorted by distance moved):`);
  for (const m of moved) {
    console.log(
      `  ${m.id.padEnd(32)}  ${fmt(m.from)} → ${fmt(m.to)}  Δ=${m.delta.toFixed(1).padStart(6)} tiles  [${m.source}]`,
    );
  }
}

function fmt([x, y]: [number, number]): string {
  return `(${String(x).padStart(4)},${String(y).padStart(4)})`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
