#!/usr/bin/env python3
"""
Fetch authoritative game-tile coordinates for every location in
src/data/locations.ts from the OSRS Wiki and report discrepancies.

For each location we look up an OSRS Wiki page and parse every
coordinate template on it:

    * {{Map|name=X|x=NNN|y=NNN|...}}              infobox-style map
    * {{Map|NNN,NNN|plane=0|mapID=0|...}}          positional
    * {{LocLine|...|x:NNN,y:NNN|...}}              NPC location rows
    * {{LocLine|...|NNN,NNN|NNN,NNN|...}}          multi-pin spawn lists

We then filter to the first "surface" coordinate: mapID == 0 (or
unset), plane == 0 (or unset), and y < 6400. Underground bosses
(Araxxor, King Black Dragon, Kalphite Queen, etc.) live in layers
with y >= 6400, so they're re-routed to the SURFACE ENTRANCE page
of their dungeon via WIKI_PAGE_OVERRIDES below, and a few are
hand-anchored via CURATED_COORDS where the wiki doesn't expose a
surface pin.

Output: scripts/wiki-coords.json with one record per location:

  {
    "id":           "taxidermist",
    "current":      [3495, 3489],
    "wiki":         [3479, 3484],
    "wiki_page":    "Taxidermist",
    "delta_tiles":  16.6,
    "source":       "wiki" | "curated" | null,
    "note":         ""
  }

Run:  python3 scripts/fetch-wiki-coords.py
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCATIONS_TS = ROOT / "src" / "data" / "locations.ts"
OUTPUT_JSON = ROOT / "scripts" / "wiki-coords.json"

WIKI_API = "https://oldschool.runescape.wiki/api.php"
USER_AGENT = "LeaguesMap-coord-audit/1.0 (local research)"


# ---------------------------------------------------------------------------
# Wiki page overrides
# ---------------------------------------------------------------------------
# Keys are the LOCATION ids from locations.ts. Values are the OSRS Wiki
# page title to query. Needed when:
#   - the location's display name differs from the wiki page title
#   - the underlying entity is underground/instanced (y >= 6400 or mapID=-1)
#     and we want the SURFACE ENTRANCE page instead
#   - multiple candidate pages exist and we want a specific one
# ---------------------------------------------------------------------------
WIKI_PAGE_OVERRIDES: dict[str, str] = {
    # Varlamore
    "civitas": "Civitas illa Fortis",
    "yamas-lair": "Yama",
    "aldarin": "Aldarin",
    "sunset-coast": "Sunset Coast",
    "cam-torum": "Cam Torum",
    "tal-teklan": "Tal Teklan",
    "auburnvale": "Auburnvale",
    "fortis-colosseum": "Fortis Colosseum",
    "hunter-guild": "Hunter Guild",
    "tlati-rainforest": "Tlati Rainforest",
    "avium-savannah": "Avium Savannah",
    "mastering-mixology": "Mastering Mixology",
    "hueycoatl-arena": "The Hueycoatl",
    "amoxliatl-cave": "Amoxliatl",
    "moons-of-peril": "Neypotzli",
    "vale-totems": "Vale Totems",
    "the-heart-dungeon": "The Ruins of Tapoyauik",
    "salvager-overlook": "Salvager Overlook",
    "doom-mokhaiotl": "Doom of Mokhaiotl",
    "gemstone-crab": "Gemstone Crab",
    "stonecutter-outpost": "Stonecutter Outpost",
    "custodia-pass": "Custodia Pass",
    "varlamore-agility": "Colossal Wyrm Agility Course",
    "kastori": "Kastori",
    "quetzin-achilka": "Achilka",
    "river-fortis": "River Fortis",

    # Karamja
    "musa-point": "Musa Point",
    "brimhaven": "Brimhaven",
    "shilo-village": "Shilo Village",
    "tai-bwo-wannai": "Tai Bwo Wannai",
    "mor-ul-rek": "Mor Ul Rek",
    "karamja-volcano": "Karamja Volcano",
    "karamja-nature-altar": "Nature altar",
    "crandor": "Crandor",

    # Asgarnia
    "falador": "Falador",
    "rimmington": "Rimmington",
    "draynor": "Draynor Village",
    "port-sarim": "Port Sarim",
    "burthorpe": "Burthorpe",
    "taverley": "Taverley",
    "wizards-tower": "Wizards' Tower",
    "motherlode-mine": "Motherlode Mine",
    "pest-control": "Pest Control",
    "barbarian-outpost": "Barbarian Outpost",
    "white-wolf-mtn": "White Wolf Mountain",
    "royal-titans": "The Royal Titans",

    # Desert
    "al-kharid": "Al Kharid",
    "pollnivneach": "Pollnivneach",
    "nardah": "Nardah",
    "sophanem": "Sophanem",
    "toa": "Tombs of Amascut",
    "duel-arena": "Emir's Arena",
    "kalphite-lair": "Kalphite Lair",
    "mage-training-arena": "Mage Training Arena",
    "giants-foundry": "Giants' Foundry",
    "pyramid-plunder": "Pyramid Plunder",
    "desert-treasure-ii": "Desert Treasure II - The Fallen Empire",
    "gotr": "Guardians of the Rift",
    "nex-lair": "Ancient Prison",

    # Fremennik
    "rellekka": "Rellekka",
    "keldagrim": "Keldagrim",
    "miscellania": "Miscellania",
    "neitiznot": "Neitiznot",
    "waterbirth": "Waterbirth Island",
    "dagannoth-kings": "Waterbirth Island Dungeon",
    "vorkath": "Ungael",
    "fremennik-slayer-dungeon": "Fremennik Slayer Dungeon",
    "thermonuclear": "Smoke Dungeon",
    "god-wars": "God Wars Dungeon",

    # Kandarin
    "east-ardougne": "Ardougne",
    "west-ardougne": "West Ardougne",
    "camelot": "Camelot",
    "catherby": "Catherby",
    "yanille": "Yanille",
    "khazard": "Port Khazard",
    "gnome-stronghold": "Tree Gnome Stronghold",
    "mcgrubors": "McGrubor's Wood",
    "sinclair-mansion": "Sinclair Mansion",
    "zul-andra": "Zul-Andra",
    "fishing-guild": "Fishing Guild",
    "witchaven": "Witchaven",
    "ranging-guild": "Ranging Guild",
    "castle-wars": "Castle Wars Arena",
    "chompy-hunting": "Feldip Hills",
    "hespori": "Farming Guild",

    # Kourend
    "port-piscarilius": "Port Piscarilius",
    "hosidius": "Hosidius",
    "lovakengj": "Lovakengj",
    "shayzien": "Shayzien",
    "arceuus": "Arceuus",
    "cox": "Chambers of Xeric",
    "mt-karuulm": "Mount Karuulm",
    "darkmeyer-hallowed": "Hallowed Sepulchre",
    "dark-altar": "Dark Altar",
    "tithe-farm": "Tithe Farm",
    "aerial-fishing": "Aerial fishing",
    "forthos": "Forthos Dungeon",

    # Morytania
    "canifis": "Canifis",
    "port-phasmatys": "Port Phasmatys",
    "morttown": "Mort'ton",
    "mos-leharmless": "Mos Le'Harmless",
    "darkmeyer": "Darkmeyer",
    "barrows": "Barrows",
    "haunted-mine": "Abandoned Mine",
    "abyssal-nexus": "Abyssal Sire",
    "slayer-tower": "Slayer Tower",
    "nightmare": "Sisterhood Sanctuary",
    "spider-cave": "Morytania Spider Cave",
    "temple-trekking": "Temple Trekking",
    "trouble-brewing": "Trouble Brewing",
    "taxidermist": "Taxidermist",

    # Tirannwn
    "prifddinas": "Prifddinas",
    "lletya": "Lletya",
    "tirannwn-mynydd": "Mynydd",
    "tirannwn-elven-coast": "Isafdar",
    "corrupted-hunllef": "The Gauntlet",
    "zalcano": "Zalcano",

    # Wilderness
    "edgeville": "Edgeville",
    "bh": "Mage Arena",
    "king-black-dragon": "King Black Dragon",
    "chaos-ele": "Chaos Elemental",
    "callisto": "Callisto",
    "venenatis": "Venenatis",
    "vetion": "Vet'ion",
    "scorpia": "Scorpia",
    "chaos-altar": "Chaos Altar",
    "wilderness-slayer-cave": "Wilderness Slayer Cave",
    "mage-bank": "Mage Arena",
    "rev-caves": "Forinthry Dungeon",
    "wilderness-agility": "Wilderness Agility Course",
    "corporeal-beast": "Corporeal Beast",

    # Resources / anchors
    "willows-draynor": "",
    "willows-catherby": "",
    "maples-seers": "",
    "yews-edgeville": "",
    "yews-varlamore": "",
    "magics-sorceress": "Sorceress's Garden",
    "magics-auburn": "",
    "iron-mine-dwarven": "Dwarven Mine",
    "coal-mine-mining-guild": "Mining Guild",
    "mithril-mining-guild": "Mining Guild",
    "adamantite-mining-guild": "Mining Guild",
    "runite-mining-guild": "Mining Guild",
    "silver-mine-crafting-guild": "Crafting Guild",
    "lumbridge-cows": "",
    "hill-giants-edge": "Edgeville Dungeon",
    "seers-rooftop": "Seers' Village Rooftop Course",
    "tempoross": "Tempoross",
    "wintertodt": "Wintertodt",
    "zanaris": "Zanaris",
    "puro-puro": "Puro-Puro",
    "abyss": "The Abyss",
    "fairy-ring-ckq": "",
}


# ---------------------------------------------------------------------------
# Hand-curated coordinates (fallback when the wiki has no usable surface
# pin). These are intentionally few — every one corresponds to a dungeon
# or minigame whose wiki page shows only the instanced/underground layer.
# Coordinates are the SURFACE ENTRANCE visible on the world map PNG.
# ---------------------------------------------------------------------------
CURATED_COORDS: dict[str, tuple[int, int, str]] = {
    # id: (x, y, reason)
    "yamas-lair":        (1484, 3202, "Yama cave entrance in Varlamore underground tunnels; wiki map is instanced"),
    "cam-torum":         (1421, 3114, "Cam Torum entrance (walk-in from Quetzacalli Gorge) - wiki infobox map is subsurface"),
    "hueycoatl-arena":   (1341, 3080, "Ralos Arena entrance near Tomb of Hueycoatl (Neypotzli)"),
    "amoxliatl-cave":    (1262, 3132, "Amoxliatl cave mouth in Hunter Guild basement surface access"),
    "moons-of-peril":    (1460, 3284, "Neypotzli gate entrance to the Shrine of Ralos"),
    "the-heart-dungeon": (1435, 3009, "The Heart of Darkness / Ruins of Tapoyauik entrance in southern Varlamore"),
    "doom-mokhaiotl":    (1420, 3175, "Doom of Mokhaiotl delve entrance (Stonecutter Outpost underground)"),
    "gemstone-crab":     (1275, 3160, "Gemstone Crab spawn area, Tlati Rainforest (first surface pin from LocLine)"),
    "river-fortis":      (1672, 3145, "Fortis River near the cabbage path east of Civitas"),
    "motherlode-mine":   (3057, 3375, "Motherlode Mine surface entrance in Falador Dwarven Mine"),
    "royal-titans":      (2908, 3536, "Royal Titans arena entrance in Burthorpe (north Asgarnia)"),
    "kalphite-lair":     (3226, 3108, "Kalphite pit ladder in Al Kharid desert"),
    "desert-treasure-ii":(2666, 3691, "DT2 pins scattered; anchor at Quetzacalli Gorge signpost"),
    "gotr":              (1572, 3842, "Guardians of the Rift minigame portal in Temple of the Eye"),
    "nex-lair":          (2915, 3745, "GWD entrance at the foot of Trollheim (Ancient Prison below)"),
    "keldagrim":         (2923, 3536, "Keldagrim surface entrance via Dwarven Mine ladder"),
    "dagannoth-kings":   (2522, 3745, "Waterbirth Island Dungeon entrance stairs"),
    "aerial-fishing":    (1740, 3738, "Aerial Fishing platform (Molch), north-east of Lovakengj"),
    "abyssal-nexus":     (3040, 3571, "Abyssal Sire entrance ruins north of Edgeville (ruined temple)"),
    "slayer-tower":      (3428, 3538, "Slayer Tower ground floor entrance doors"),
    "nightmare":         (3681, 3373, "Sisterhood Sanctuary above-ground entrance (ruined church south of Darkmeyer)"),
    "prifddinas":        (2210, 3390, "Prifddinas city centre (the fountain/portal)"),
    "seers-rooftop":     (2729, 3486, "Seers' Village Rooftop Course start pad"),
    "corrupted-hunllef": (2210, 3415, "Gauntlet portal inside Prifddinas; instanced boss — anchor at crystal gate"),
    "zalcano":           (2209, 3396, "Zalcano is instanced in Prifddinas; anchor at Trahaearn tower"),
    "bh":                (3106, 3956, "Mage Arena entrance hall (deep wildy fortress)"),
    "mage-bank":         (3094, 3949, "Mage Bank vault level 52 wildy"),
    "king-black-dragon": (3017, 3849, "KBD Lava Maze ladder in level 46 wildy"),
    "callisto":          (3291, 3849, "Callisto/Artio den in Lava Dragon Isle (LocLine surface pin)"),
    "venenatis":         (3319, 3798, "Silk Chasm surface pin"),
    "vetion":            (3240, 3778, "Vet'ion/Calvar'ion boss chamber entrance (Rogues' Castle catacombs)"),
    "scorpia":           (3232, 3938, "Scorpia den in Forgotten Cemetery"),
    "wilderness-slayer-cave": (3246, 3740, "Slayer Cave entrance north of Graveyard of Shadows"),
    "rev-caves":         (3127, 3805, "Forinthry Dungeon entrance (former Revenant Caves north entrance)"),
    "wilderness-agility":(3005, 3931, "Wilderness Agility Course entrance in Forgotten Cemetery area"),
    "corporeal-beast":   (2966, 4382, "Corporeal Beast cave; instanced — anchor at Graveyard of Shadows"),
    "willows-draynor":   (3088, 3239, "Draynor willow tree cluster by the bank"),
    "willows-catherby":  (2774, 3445, "Catherby willow cluster by the bank"),
    "maples-seers":      (2728, 3502, "Seers' maples east of bank"),
    "yews-edgeville":    (3087, 3475, "Yews by Edgeville monastery/graveyard"),
    "yews-varlamore":    (1625, 2997, "Quetzacalli Gorge yew grove"),
    "magics-auburn":     (1293, 3073, "Magic trees in Auburn Valley (Vale Totems area)"),
    "magics-sorceress":  (2710, 3488, "Seers' Village magic trees grove (the 'Sorcerer's Garden')"),
    "lumbridge-cows":    (3253, 3271, "Lumbridge east cow field"),
    "fairy-ring-ckq":    (1404, 2930, "CKQ ring in Aldarin"),
    "zanaris":           (2452, 4474, "Zanaris lives on its own mapID; pin at throne of the Lucien Fairy"),
    "puro-puro":         (2590, 4320, "Puro-Puro implings realm; pin at centre of crop circle"),
}


# ---------------------------------------------------------------------------
# locations.ts parser
# ---------------------------------------------------------------------------
def parse_locations_ts() -> list[dict]:
    src = LOCATIONS_TS.read_text()
    pat = re.compile(
        r'L\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"',
    )
    out: list[dict] = []
    for m in pat.finditer(src):
        out.append(
            {
                "id": m.group(1),
                "name": m.group(2).replace('\\"', '"'),
                "x": int(m.group(3)),
                "y": int(m.group(4)),
                "region": m.group(5),
                "category": m.group(6),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Wiki fetch + coord parser
# ---------------------------------------------------------------------------
_wiki_cache: dict[str, str] = {}


def fetch_wikitext(page: str) -> str | None:
    if page in _wiki_cache:
        return _wiki_cache[page]
    q = urllib.parse.urlencode(
        {
            "action": "parse",
            "page": page,
            "prop": "wikitext",
            "redirects": "1",
            "format": "json",
        }
    )
    url = f"{WIKI_API}?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.load(resp)
    except Exception as e:
        print(f"    HTTP error fetching {page}: {e}", file=sys.stderr)
        return None
    wt = payload.get("parse", {}).get("wikitext", {}).get("*")
    if not wt:
        err = payload.get("error", {}).get("info", "no wikitext")
        print(f"    {page}: {err}", file=sys.stderr)
        _wiki_cache[page] = ""
        return None
    _wiki_cache[page] = wt
    return wt


_TEMPLATE_RE = re.compile(
    r"\{\{(Map|LocLine)\b([^{}]*?(?:\{\{[^{}]*\}\}[^{}]*?)*)\}\}",
    re.DOTALL | re.IGNORECASE,
)
# positional coords: ONLY accept a part that is exactly "NNN,NNN" (optional
# leading/trailing whitespace). Parts like "mtype:line,1418:9632,1387:9590"
# or "r:10,1440:9619" are path/style metadata and must be skipped.
_XY_POS_STRICT_RE = re.compile(r"^\s*(\d{3,5})\s*,\s*(\d{3,5})\s*$")
# named coords inside a |...| segment: x=NNN y=NNN  OR  x:NNN,y:NNN
_XY_NAMED_RE = re.compile(r"x\s*[:=]\s*(\d{3,5})\s*[,|]?\s*y\s*[:=]\s*(\d{3,5})", re.IGNORECASE)
# keywords in a part that mean "this isn't a coord literal, it's style data"
_STYLE_KEYWORDS = ("mtype:", "stroke", "fill:", "desc:", "label:", "width", "opacity")


def parse_coords(wt: str) -> list[dict]:
    """Return every candidate coord on the page as a list of dicts:
        [{x, y, plane, mapID, kind, raw}]
    """
    out: list[dict] = []
    for m in _TEMPLATE_RE.finditer(wt):
        kind = m.group(1).lower()
        body = m.group(2)
        parts = _split_top_level(body)
        # defaults inherited by every coord in this template
        plane: int | None = None
        mapID: int | None = None
        xs: list[tuple[int, int]] = []
        # first pass: extract named plane/mapID, and any explicit x= y=
        inline_x: int | None = None
        inline_y: int | None = None
        for p in parts:
            ps = p.strip()
            if "=" in ps:
                key, _, val = ps.partition("=")
                k = key.strip().lower()
                v = val.strip()
                if k == "x":
                    inline_x = _maybe_int(v)
                elif k == "y":
                    inline_y = _maybe_int(v)
                elif k == "plane":
                    plane = _maybe_int(v)
                elif k == "mapid":
                    mapID = _maybe_int(v)
        if inline_x is not None and inline_y is not None:
            xs.append((inline_x, inline_y))
        # second pass: positional X,Y pairs (strict) and x:N,y:N pairs (per part).
        for p in parts:
            ps = p.strip()
            # skip style/path data that happens to look like NNN,NNN fragments
            if any(k in ps for k in _STYLE_KEYWORDS):
                continue
            # x:3199,y:9424 form (LocLine style)
            for mm in _XY_NAMED_RE.finditer(ps):
                xs.append((int(mm.group(1)), int(mm.group(2))))
            # strict "NNN,NNN" exact match only
            if "=" in ps:
                continue
            mm = _XY_POS_STRICT_RE.match(ps)
            if mm:
                xs.append((int(mm.group(1)), int(mm.group(2))))
        seen: set[tuple[int, int]] = set()
        for (x, y) in xs:
            if (x, y) in seen:
                continue
            seen.add((x, y))
            out.append({
                "x": x, "y": y, "plane": plane, "mapID": mapID,
                "kind": kind, "raw": m.group(0)[:140],
            })
    return out


def _split_top_level(body: str) -> list[str]:
    out, depth, buf = [], 0, []
    i = 0
    while i < len(body):
        c = body[i]
        if c == "{" and i + 1 < len(body) and body[i + 1] == "{":
            depth += 1
            buf.append(c)
        elif c == "}" and i + 1 < len(body) and body[i + 1] == "}":
            depth -= 1
            buf.append(c)
        elif c == "|" and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(c)
        i += 1
    out.append("".join(buf))
    return out


def _maybe_int(s: str) -> int | None:
    s = s.strip()
    try:
        return int(s)
    except ValueError:
        return None


def is_surface_pin(m: dict) -> bool:
    """True iff the coord is on the base-game surface map (mapID 0 or unset,
    plane 0 or unset, inside OSRS surface-world x/y bounds).

    Surface-world bounds (mapID=0) are roughly x∈[1024, 3904], y∈[2496, 4544].
    Anything outside that is either dungeon (y>=6400), instanced (mapID!=0),
    or off-map test coords.
    """
    if m["mapID"] not in (None, 0):
        return False
    if m["plane"] not in (None, 0):
        return False
    if m["y"] >= 6400:
        return False
    if not (900 <= m["x"] <= 4000 and 2400 <= m["y"] <= 4550):
        return False
    return True


def pick_surface_coord(maps: list[dict]) -> dict | None:
    # Prefer {{Map}} templates over {{LocLine}} ones, and within each
    # class only accept surface pins.
    for m in maps:
        if m["kind"] == "map" and is_surface_pin(m):
            return m
    for m in maps:
        if is_surface_pin(m):
            return m
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    locs = parse_locations_ts()
    print(f"Loaded {len(locs)} locations from {LOCATIONS_TS.relative_to(ROOT)}")

    results: list[dict] = []
    fixed_wiki = 0
    fixed_curated = 0
    unresolved = 0
    for i, loc in enumerate(locs, 1):
        entry: dict = {
            "id": loc["id"],
            "name": loc["name"],
            "current": [loc["x"], loc["y"]],
            "region": loc["region"],
            "category": loc["category"],
            "wiki_page": WIKI_PAGE_OVERRIDES.get(loc["id"], loc["name"]),
            "wiki": None,
            "delta_tiles": None,
            "source": None,
            "note": "",
        }

        # 1. Try wiki
        page = entry["wiki_page"]
        wiki_coord: tuple[int, int] | None = None
        if page:
            wt = fetch_wikitext(page)
            if wt is not None:
                coords = parse_coords(wt)
                best = pick_surface_coord(coords)
                if best is not None:
                    wiki_coord = (best["x"], best["y"])
                    entry["note"] = f"from {{{{{best['kind']}}}}} on '{page}' (maps_scanned={len(coords)})"
            else:
                entry["note"] = "page fetch failed"
            time.sleep(0.10)

        # 2. Fallback to curated coord
        if wiki_coord is None:
            curated = CURATED_COORDS.get(loc["id"])
            if curated is not None:
                wiki_coord = (curated[0], curated[1])
                entry["source"] = "curated"
                entry["note"] = f"curated: {curated[2]}"
        else:
            entry["source"] = "wiki"

        if wiki_coord is None:
            unresolved += 1
            entry["note"] = entry["note"] or "unresolved"
            results.append(entry)
            continue

        entry["wiki"] = list(wiki_coord)
        dx = wiki_coord[0] - loc["x"]
        dy = wiki_coord[1] - loc["y"]
        entry["delta_tiles"] = round(math.hypot(dx, dy), 1)
        if entry["source"] == "wiki":
            fixed_wiki += 1
        else:
            fixed_curated += 1
        results.append(entry)
        print(
            f"  [{i:3d}/{len(locs)}] {loc['id']:32s}  "
            f"cur=({loc['x']:4d},{loc['y']:4d})  "
            f"→ ({wiki_coord[0]:4d},{wiki_coord[1]:4d})  "
            f"Δ={entry['delta_tiles']:6.1f}  "
            f"src={entry['source']}"
        )

    OUTPUT_JSON.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {OUTPUT_JSON.relative_to(ROOT)}")
    print(f"  wiki-sourced:    {fixed_wiki}")
    print(f"  curated:         {fixed_curated}")
    print(f"  unresolved:      {unresolved}")
    print(f"  total scanned:   {len(locs)}")

    ranked = [e for e in results if e["delta_tiles"] is not None and e["delta_tiles"] > 5]
    ranked.sort(key=lambda e: e["delta_tiles"], reverse=True)
    print(f"\n{len(ranked)} locations moved by >5 tiles. Top 25:")
    for e in ranked[:25]:
        print(
            f"  {e['id']:32s}  cur={tuple(e['current'])}  "
            f"new={tuple(e['wiki'])}  Δ={e['delta_tiles']:6.1f}  [{e['source']}] {e['wiki_page'] or ''}"
        )

    unresolved_list = [e for e in results if e["wiki"] is None]
    if unresolved_list:
        print(f"\nUNRESOLVED ({len(unresolved_list)}):")
        for e in unresolved_list:
            print(f"  {e['id']:32s}  [{e['wiki_page']}]  {e['note']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
