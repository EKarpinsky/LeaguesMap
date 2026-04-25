#!/usr/bin/env python3
"""Audit every landmark.region in src/data/locations.ts against the wiki's
leagueRegion for the corresponding wiki page (using landmark.name).

Per the user's rule: landmark.region MUST equal the wiki's leagueRegion.
No bbox, no surface-entry overrides, no guessing.

Outputs:
  - VERIFIED: landmark.region == wiki.leagueRegion
  - FIX: landmark.region != wiki.leagueRegion (with line numbers + new value)
  - NEEDS-TRIAGE: wiki page missing, leagueRegion absent, or sentinel value
"""
import re
import sys
import time
import urllib.parse
import urllib.request
import concurrent.futures
from pathlib import Path

LOCATIONS_TS = Path("/Users/elikarpinsky/LeaguesMap/src/data/locations.ts")
USER_AGENT = "LeaguesMap/1.0 (eli@karpinsky.io)"

# canonical league regions (matches src/types.ts Region union)
VALID_REGIONS = {
    "Asgarnia", "Desert", "Fremennik", "Karamja", "Tirannwn",
    "Wilderness", "Varlamore", "Kandarin", "Kourend",
    "Morytania", "Misthalin", "General",
}
SENTINELS = {"n/a", "na", "n", "no", "none", "null", ""}

# Map alternate wiki spellings to our canonical regions
NORMALIZE_MAP = {
    "kebos": "Kourend",
    "kharidian desert": "Desert",
    "fremennik province": "Fremennik",
    "great kourend": "Kourend",
}


def normalize_region(value):
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered in SENTINELS:
        return None
    if any(sep in cleaned for sep in (",", "&", "/", "|")):
        return None
    if lowered in NORMALIZE_MAP:
        return NORMALIZE_MAP[lowered]
    title = lowered.title()
    if title in VALID_REGIONS:
        return title
    return None


# Parse `L("id", "Name", x, y, "Region", "category", ...)` lines from locations.ts
LANDMARK_RE = re.compile(
    r'^(\s*)L\("([^"]+)",\s*"((?:[^"\\]|\\.)+)",\s*(-?\d+\.?\d*),\s*(-?\d+\.?\d*),\s*"([^"]+)"',
    re.MULTILINE,
)


def parse_landmarks(text):
    out = []
    for m in LANDMARK_RE.finditer(text):
        line_no = text[:m.start()].count("\n") + 1
        out.append({
            "line": line_no,
            "id": m.group(2),
            "name": m.group(3),
            "x": float(m.group(4)),
            "y": float(m.group(5)),
            "region": m.group(6),
            "match_start": m.start(),
        })
    return out


# Map landmark name → wiki page title (handle special cases / parentheticals)
def name_to_wiki_title(name):
    # Strip "(anchor)", "(some descriptor)" suffixes
    stripped = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
    # Special cases that aren't a 1:1 page lookup
    OVERRIDES = {
        "Hallowed Sepulchre": "Hallowed Sepulchre",
        "Yama's Lair": "Yama%27s Lair",
        "Mt Karuulm": "Mount Karuulm",
        "Mt. Karuulm": "Mount Karuulm",
        "TzHaar Inferno": "Inferno",
        "Inferno (Karamja)": "Inferno",
        "Mage Arena": "Mage Arena II",  # Bounty Hunter is also called Mage Arena
        "Capital of Varlamore": "Civitas illa Fortis",
        "Catherby fishing dock": "Catherby",
        "Civitas": "Civitas illa Fortis",
        "Civitas Illa Fortis": "Civitas illa Fortis",
        "Twilight Temple": "Twilight Temple",
        "Doom of Mokhaiotl": "Doom of Mokhaiotl",
        "Cerberus's Lair": "Cerberus",
        "Cerberus Lair": "Cerberus",
        "Crystalline Hunllef": "Corrupted Gauntlet",
        "Hunter Guild": "Hunter Guild",
        "Hunter's Guild": "Hunter Guild",
        "Tonali Cavern": "Tonali Cavern",
        "Tlati Rainforest": "Tlati Rainforest",
        "Auburnvale": "Auburnvale",
        "Stonecutter Outpost": "Stonecutter Outpost",
        "Custodia Pass": "Custodia Pass",
        "Quetzin's Achilka": "Quetzin's Achilka",
        "Tarn's Lair": "Tarn's Lair",
        "Brimhaven Dungeon": "Brimhaven Dungeon",
        "Witchaven": "Witchaven",
        "Aldarin": "Aldarin",
    }
    if stripped in OVERRIDES:
        return OVERRIDES[stripped]
    return stripped.replace(" ", "_")


WIKI_LEAGUE_RE = re.compile(r"\|\s*leagueRegion\s*=\s*([^\n|}]+)")


def _http_get(url, retries=4):
    last_exc = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last_exc = e
        except Exception as e:
            last_exc = e
        time.sleep(1.5 * (2 ** attempt))
    raise last_exc


def fetch_wiki_league_region(name):
    """Returns (status, value, url) where status is 'ok'|'404'|'no-tag'|'error'."""
    title = name_to_wiki_title(name)
    if title.startswith("http"):
        url = title
    else:
        encoded = urllib.parse.quote(title, safe="%/")
        url = f"https://oldschool.runescape.wiki/w/{encoded}?action=raw"
    try:
        text = _http_get(url)
    except urllib.error.HTTPError as e:
        return ("404" if e.code == 404 else "error", None, url)
    except Exception as e:
        return ("error", str(e), url)

    # Some pages are #REDIRECT to another page — follow once
    redir = re.match(r"^#REDIRECT\s*\[\[([^\]|]+)", text)
    if redir:
        target = redir.group(1).strip().replace(" ", "_")
        encoded = urllib.parse.quote(target, safe="%/")
        url2 = f"https://oldschool.runescape.wiki/w/{encoded}?action=raw"
        try:
            text = _http_get(url2)
            url = url2
        except Exception as e:
            return ("error", str(e), url)

    matches = [m.group(1).strip() for m in WIKI_LEAGUE_RE.finditer(text)]
    if not matches:
        return ("no-tag", None, url)
    # Prefer the first non-sentinel value; if all are sentinels, return the
    # first raw value so caller can see "N/A" etc.
    for raw in matches:
        norm = normalize_region(raw)
        if norm:
            return ("ok", norm, url)
    return ("sentinel", matches[0], url)


def main():
    text = LOCATIONS_TS.read_text()
    landmarks = parse_landmarks(text)
    print(f"Parsed {len(landmarks)} landmarks", file=sys.stderr)

    results = []
    for i, lm in enumerate(landmarks, 1):
        status, value, url = fetch_wiki_league_region(lm["name"])
        results.append((lm, status, value, url))
        if i % 20 == 0:
            print(f"  …fetched {i}/{len(landmarks)}", file=sys.stderr)
        time.sleep(0.15)  # gentle on the wiki

    results.sort(key=lambda r: r[0]["line"])

    verified = []
    fixes = []
    triage = []
    for lm, status, value, url in results:
        if status == "ok":
            if value == lm["region"]:
                verified.append(lm)
            else:
                fixes.append((lm, value, url))
        else:
            triage.append((lm, status, value, url))

    print(f"\n=== VERIFIED ({len(verified)}) ===")
    for lm in verified:
        print(f"  ✓ L{lm['line']:>4} {lm['id']:<28} = {lm['region']}")

    print(f"\n=== FIXES ({len(fixes)}) ===")
    for lm, wiki_lr, url in fixes:
        print(f"  ✗ L{lm['line']:>4} {lm['id']:<28} {lm['region']:>12} → {wiki_lr:<12}  {url}")

    print(f"\n=== TRIAGE ({len(triage)}) ===")
    for lm, status, value, url in triage:
        print(f"  ? L{lm['line']:>4} {lm['id']:<28} status={status:<8} value={value} url={url}")

    # Emit a JSON summary for downstream scripting
    import json
    summary_path = Path("/tmp/landmark_audit_summary.json")
    summary_path.write_text(json.dumps({
        "verified": [lm["id"] for lm in verified],
        "fixes": [
            {"id": lm["id"], "line": lm["line"], "name": lm["name"],
             "current": lm["region"], "wiki": wiki_lr, "url": url}
            for lm, wiki_lr, url in fixes
        ],
        "triage": [
            {"id": lm["id"], "line": lm["line"], "name": lm["name"],
             "current": lm["region"], "status": status, "value": value, "url": url}
            for lm, status, value, url in triage
        ],
    }, indent=2))
    print(f"\nSummary written to {summary_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
