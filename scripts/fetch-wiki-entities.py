#!/usr/bin/env python3
"""
Boil-the-ocean NPC/entity geolocator.

Pulls every wiki page referenced from src/data/tasks.json's `wikiLinks`,
extracts every {{Map}} and {{LocLine}} template, and emits
src/data/wikiEntities.json with per-entity surface-world coordinates.

This is how "Defeat a Black Knight in Asgarnia" gets pinned to the actual
Black Knight spawn in White Knights' Castle basement, and "Pet Xolo in
Civitas" points at Xolo's actual tile — instead of both dumping onto the
city's anchor pin.

For each unique title across all tasks.json wikiLinks we:

  1. Batch-query the OSRS Wiki action=query API (50 titles per request)
     with prop=revisions&rvprop=content&redirects=1 to get wikitext and
     redirect resolution.
  2. Parse every {{Map}} and {{LocLine}} on the page (existing parser
     logic — surface-pin filter: mapID ∈ {0, -1, unset}, y < 6400,
     900 ≤ x ≤ 4200; plane is allowed to be anything because all planes
     project to the same x,y on the flat world map).
  3. Pick the FIRST surface-pin we encounter (preferring {{Map}} over
     {{LocLine}} since Map is the infobox pin).
  4. Record: {title, resolvedTitle, x, y, source, allSpawns, category,
     leagueRegion}.

Output: src/data/wikiEntities.json — a JSON object keyed by lowercased
original wikiLink title (so the TS resolver can match task.wikiLinks
directly).

Run: python3 scripts/fetch-wiki-entities.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASKS_JSON = ROOT / "src" / "data" / "tasks.json"
OUTPUT_JSON = ROOT / "src" / "data" / "wikiEntities.json"

WIKI_API = "https://oldschool.runescape.wiki/api.php"
USER_AGENT = "LeaguesMap-entity-fetch/1.0 (Demonic Pacts League fan map)"
BATCH_SIZE = 50  # mediawiki hard cap


# ---------------------------------------------------------------------------
# Non-geolocatable deny-list
# ---------------------------------------------------------------------------
# These are wiki pages that will NEVER have useful surface coordinates:
# skills, concepts, meta pages, and generic items. Skipping them cuts the
# fetch cost by ~40% with zero loss in precision because the wiki parser
# would have returned no surface pin for them anyway.
SKIP_TITLES: set[str] = {
    # skills + meta
    "agility", "attack", "cooking", "crafting", "construction", "defence",
    "farming", "firemaking", "fishing", "fletching", "herblore", "hitpoints",
    "hunter", "magic", "mining", "prayer", "ranged", "runecraft", "runecrafting",
    "slayer", "smithing", "strength", "thieving", "woodcutting",
    "combat achievements", "combat achievement", "collection log",
    "player owned house", "player-owned house", "pet", "pets",
    "quest", "quests", "quest points", "quest point",
    "music track", "music", "stash", "stash unit", "stash units",
    "coins", "coin", "experience", "xp",
    "levels", "level", "base level", "total level",
    # tiers
    "reward casket (easy)", "reward casket (medium)", "reward casket (hard)",
    "reward casket (elite)", "reward casket (master)",
    "easy clue scroll", "medium clue scroll", "hard clue scroll",
    "elite clue scroll", "master clue scroll",
    "easy clue scrolls", "medium clue scrolls", "hard clue scrolls",
    "elite clue scrolls", "master clue scrolls",
    "clue scroll", "clue scrolls", "clue scroll (easy)",
    "clue scroll (medium)", "clue scroll (hard)",
    "clue scroll (elite)", "clue scroll (master)",
    # region names (we already have landmarks for these)
    "asgarnia", "desert", "fremennik", "fremennik province",
    "fremennik provinces", "kandarin", "karamja", "kharidian desert",
    "kourend", "great kourend", "morytania", "tirannwn", "varlamore",
    "wilderness", "misthalin", "zeah",
    # generic concepts
    "superior slayer monster", "superior slayer monsters",
    "echo boss", "echo bosses",
    "slayer task", "slayer tasks", "slayer master",
    "bounty hunter", "last man standing",
    "tzhaar-ket-rak's challenges",
    "god wars dungeon",  # we have gwd landmark
}


def should_skip(title: str) -> bool:
    t = title.strip().lower()
    if t in SKIP_TITLES:
        return True
    # items (lowercased common noun patterns)
    if re.match(r"^(raw |cooked )?[a-z]+ (log|logs|ore|bar|seed|seeds|potion|rune)$", t):
        return True
    return False


# ---------------------------------------------------------------------------
# Hand-curated coord overrides for anchor pages
# ---------------------------------------------------------------------------
# Some wiki pages (Cam Torum, Camdozaal, Mor Ul Rek…) only have an instanced
# / underground {{Map}} coord, so `pick_surface_coord` returns nothing and
# the anchor stays unresolved. For those pages we hand-curate the SURFACE
# entrance coord here. `resolve_anchor_coord` checks this dict before doing
# any wiki lookup, so the override always wins.
#
# Coords MUST be the surface walk-in tile visible on the world map PNG.
# Mirror any change here in scripts/fetch-wiki-coords.py CURATED_COORDS so
# the landmark layer stays in sync.
ANCHOR_COORD_OVERRIDES: dict[str, tuple[int, int]] = {
    # Cam Torum's wiki infobox map points underground; the surface entrance
    # (and therefore the surface route to Neypotzli / Moons of Peril) is the
    # walk-in from Quetzacalli Gorge at the foot of Ralos' Rise.
    "Cam Torum": (1421, 3114),
}


# ---------------------------------------------------------------------------
# Curated entity overrides — WIKI-AUTHORITATIVE
# ---------------------------------------------------------------------------
# Keys are lowercased wikiLink titles. Each override specifies the name of
# a real WIKI PAGE ("anchor") whose {{Map}} coord should be used as the pin.
# The fetcher resolves anchors by hitting the wiki API, so no coord is ever
# hand-typed — every pin traces back to a wiki-sourced (x,y) pair, except
# for anchors listed in ANCHOR_COORD_OVERRIDES above where we substitute a
# curated surface entrance because the wiki page only has subsurface coords.
#
# Format:
#   Single pin:  "title": {"anchor": "Wiki Page Title", "category": "boss"}
#   Multi-spawn: "title": {"spawns": [{"anchor": "...", "region_hint": "..."}, ...], "category": "monster"}
#
# region_hint is purely documentation — regions are inferred from the
# resolved coord's bbox. Anchors that fail to resolve print a LOUD warning
# at fetch time so they can be replaced.
CURATED_ENTITIES: dict[str, dict] = {
    # ───── Instanced Varlamore bosses (anchored to entrance) ─────
    "araxxor":                  {"anchor": "Morytania Spider Cave",   "category": "boss"},
    "amoxliatl":                {"anchor": "Hunter Guild",            "category": "boss"},
    "hueycoatl":                {"anchor": "Hunter Guild",            "category": "boss"},
    "the hueycoatl":            {"anchor": "Hunter Guild",            "category": "boss"},
    "doom of mokhaiotl":        {"anchor": "Hunter Guild",            "category": "boss"},
    "mokhaiotl":                {"anchor": "Hunter Guild",            "category": "boss"},
    # Moons of Peril live in Neypotzli, beneath Cam Torum (NOT in the Hunter
    # Guild — the previous anchor was just plain wrong). The Cam Torum anchor
    # resolves via ANCHOR_COORD_OVERRIDES because the wiki infobox map for
    # Cam Torum points to the underground city, not the surface entrance.
    "moons of peril":           {"anchor": "Cam Torum",               "category": "boss"},
    "blood moon":               {"anchor": "Cam Torum",               "category": "boss"},
    "blue moon":                {"anchor": "Cam Torum",               "category": "boss"},
    "eclipse moon":             {"anchor": "Cam Torum",               "category": "boss"},
    "gemstone crab":            {"anchor": "Sunset Coast",            "category": "boss"},
    "sol heredit":              {"anchor": "Fortis Colosseum",        "category": "boss"},

    # ───── Instanced quest bosses ─────
    "zalcano":                  {"anchor": "Lletya",                  "category": "boss"},
    "corrupted hunllef":        {"anchor": "Lletya",                  "category": "boss"},
    "the hunllef":              {"anchor": "Lletya",                  "category": "boss"},
    "the corrupted gauntlet":   {"anchor": "Lletya",                  "category": "boss"},
    "the gauntlet":             {"anchor": "Lletya",                  "category": "boss"},

    # ───── God Wars & DT2 bosses (surface entrances) ─────
    "nex":                      {"anchor": "God Wars Dungeon",        "category": "boss"},
    "kree'arra":                {"anchor": "God Wars Dungeon",        "category": "boss"},
    "commander zilyana":        {"anchor": "God Wars Dungeon",        "category": "boss"},
    "general graardor":         {"anchor": "God Wars Dungeon",        "category": "boss"},
    "k'ril tsutsaroth":         {"anchor": "God Wars Dungeon",        "category": "boss"},
    "duke sucellus":            {"anchor": "Ghorrock",                "category": "boss"},
    "vardorvis":                {"anchor": "Strangled",               "category": "boss"},
    "the leviathan":            {"anchor": "Edgeville",               "category": "boss"},
    "leviathan":                {"anchor": "Edgeville",               "category": "boss"},
    "the whisperer":            {"anchor": "Edgeville",               "category": "boss"},
    "whisperer":                {"anchor": "Edgeville",               "category": "boss"},

    # ───── Wilderness & classic bosses ─────
    "king black dragon":         {"anchor": "Lava Maze",              "category": "boss"},
    "kalphite queen":            {"anchor": "Shantay Pass",           "category": "boss"},
    "chaos elemental":           {"anchor": "Rogues' Castle",         "category": "boss"},
    "callisto":                  {"anchor": "Demonic Ruins",          "category": "boss"},
    "artio":                     {"anchor": "Demonic Ruins",          "category": "boss"},
    "venenatis":                 {"anchor": "Bone Yard",              "category": "boss"},
    "spindel":                   {"anchor": "Bone Yard",              "category": "boss"},
    "vet'ion":                   {"anchor": "Graveyard of Shadows",   "category": "boss"},
    "calvar'ion":                {"anchor": "Graveyard of Shadows",   "category": "boss"},
    "scorpia":                   {"anchor": "Bone Yard",              "category": "boss"},
    "abyssal sire":              {"anchor": "Edgeville",              "category": "boss"},
    "abyssal nexus":             {"anchor": "Edgeville",              "category": "boss"},
    # Cerberus' Lair is accessed via the hellhound room in Taverley
    # Dungeon (Asgarnia). The Cerberus' Lair wiki page's own Map template
    # points at instance coords (mapID=10030), so we anchor to Taverley
    # Dungeon's surface entrance at (2884, 3398) instead.
    "cerberus":                  {"anchor": "Taverley Dungeon",       "category": "boss"},
    "alchemical hydra":          {"anchor": "Mount Karuulm",          "category": "boss"},
    "thermonuclear smoke devil": {"anchor": "Smoke Dungeon",          "category": "boss"},
    "corporeal beast":           {"anchor": "Corporeal Beast",        "category": "boss"},
    "grotesque guardians":       {"anchor": "Canifis",                "category": "boss"},
    "dusk":                      {"anchor": "Canifis",                "category": "boss"},
    "dawn":                      {"anchor": "Canifis",                "category": "boss"},
    # The Mimic boss is fought at the Strange Casket UPSTAIRS in Watson's
    # house in Hosidius (Kourend) — NOT at the Varrock Museum. The wiki
    # explicitly calls this out: "players must first speak to the strange
    # casket upstairs in Watson's house in Hosidius to enable Mimic
    # encounters". The old Varrock anchor was wrong (and made the pin
    # disappear entirely under Demonic Pacts because Misthalin is locked,
    # which is what triggered the user's "Defeat the Mimic" task to fall
    # back to the Kourend region centroid).
    "the mimic":                 {"anchor": "Watson",                 "category": "boss"},
    "phantom muspah":            {"anchor": "Ancient Cavern",         "category": "boss"},

    # ───── Dagannoth Kings (Waterbirth) ─────
    "dagannoth kings":          {"anchor": "Waterbirth Island",       "category": "boss"},
    "dagannoth rex":            {"anchor": "Waterbirth Island",       "category": "boss"},
    "dagannoth prime":          {"anchor": "Waterbirth Island",       "category": "boss"},
    "dagannoth supreme":        {"anchor": "Waterbirth Island",       "category": "boss"},

    # ───── Vorkath / Zulrah / Phosani ─────
    "vorkath":                   {"anchor": "Ungael",                 "category": "boss"},
    "zulrah":                    {"anchor": "Zul-Andra",              "category": "boss"},
    "the nightmare":             {"anchor": "Slepe",                  "category": "boss"},
    "phosani's nightmare":       {"anchor": "Slepe",                  "category": "boss"},
    "tempoross":                 {"anchor": "Ruins of Unkah",         "category": "boss"},
    "wintertodt":                {"anchor": "Doors of Dinh",          "category": "boss"},

    # ───── Barrows brothers & their equipment → Barrows mounds ─────
    "dharok the wretched":              {"anchor": "Barrows", "category": "monster"},
    "ahrim the blighted":               {"anchor": "Barrows", "category": "monster"},
    "karil the tainted":                {"anchor": "Barrows", "category": "monster"},
    "verac the defiled":                {"anchor": "Barrows", "category": "monster"},
    "guthan the infested":              {"anchor": "Barrows", "category": "monster"},
    "torag the corrupted":              {"anchor": "Barrows", "category": "monster"},
    "dharok the wretched's equipment":  {"anchor": "Barrows", "category": "item"},
    "ahrim the blighted's equipment":   {"anchor": "Barrows", "category": "item"},
    "karil the tainted's equipment":    {"anchor": "Barrows", "category": "item"},
    "verac the defiled's equipment":    {"anchor": "Barrows", "category": "item"},
    "guthan the infested's equipment":  {"anchor": "Barrows", "category": "item"},
    "torag the corrupted's equipment":  {"anchor": "Barrows", "category": "item"},

    # ───── Raids (surface entrances) ─────
    "chambers of xeric":         {"anchor": "Chambers of Xeric",      "category": "raid"},
    "tombs of amascut":          {"anchor": "Tombs of Amascut",       "category": "raid"},
    "theatre of blood":          {"anchor": "Theatre of Blood",       "category": "raid"},

    # ───── TzHaar ─────
    "tzhaar-ket-rak":              {"anchor": "Mor Ul Rek", "category": "monster"},
    "tzhaar-ket-rak's challenges": {"anchor": "Mor Ul Rek", "category": "boss"},

    # ───── Activities tied to a location ─────
    "forestry":                  {"anchor": "Draynor Village",         "category": "activity"},
    "motherlode mine":           {"anchor": "Falador",                 "category": "activity"},
    "blast furnace":             {"anchor": "White Wolf Mountain",     "category": "activity"},
    "giants' foundry":           {"anchor": "Giants' Foundry",         "category": "activity"},
    "nightmare zone":            {"anchor": "Nightmare Zone",          "category": "activity"},
    "volcanic mine":             {"anchor": "Volcanic Mine",           "category": "activity"},

    # ───── Combat monsters with underground-only wiki coords (per-region) ─────
    "blue dragon":               {"spawns": [
        {"anchor": "Taverley Dungeon",     "region_hint": "Asgarnia"},
        {"anchor": "Ardougne Zoo",         "region_hint": "Kandarin"},
        {"anchor": "Heroes' Guild",        "region_hint": "Asgarnia"},
    ], "category": "monster"},
    "black demon":               {"spawns": [
        {"anchor": "Taverley Dungeon",     "region_hint": "Asgarnia"},
        {"anchor": "Brimhaven Dungeon",    "region_hint": "Karamja"},
        {"anchor": "Edgeville Dungeon",    "region_hint": "Wilderness"},
        {"anchor": "Chaos Druid Tower",    "region_hint": "Kandarin"},
    ], "category": "monster"},
    "troll":                     {"spawns": [
        {"anchor": "Burthorpe",            "region_hint": "Asgarnia"},
        {"anchor": "Trollheim",            "region_hint": "Fremennik"},
    ], "category": "monster"},
    "fire giant":                {"spawns": [
        {"anchor": "Waterfall Dungeon",    "region_hint": "Kandarin"},
        {"anchor": "Deep Wilderness Dungeon", "region_hint": "Wilderness"},
        {"anchor": "Mount Karuulm",  "region_hint": "Kourend"},
    ], "category": "monster"},
    "drake":                           {"anchor": "Mount Karuulm",              "category": "monster"},
    "hydra":                           {"anchor": "Mount Karuulm",              "category": "monster"},
    "dark beast":                      {"anchor": "West Ardougne",              "category": "monster"},
    "moss giant (iorwerth dungeon)":   {"anchor": "Lletya",                     "category": "monster"},
    "elf":                             {"anchor": "Lletya",                     "category": "monster"},
    "elf (disambiguation)":            {"anchor": "Lletya",                     "category": "monster"},
    "fragment of seren":               {"anchor": "Lletya",                     "category": "boss"},
    "frost crab":                      {"anchor": "Sunset Coast",               "category": "monster"},
    "jubster":                         {"anchor": "Feldip Hills",               "category": "monster"},
    "steel dragon":                    {"anchor": "Brimhaven Dungeon",          "category": "monster"},
    "revenant dragon":                 {"anchor": "Bone Yard",                  "category": "monster"},
    "kalphite":                        {"anchor": "Shantay Pass",               "category": "monster"},
    "kalphite guardian":               {"anchor": "Shantay Pass",               "category": "monster"},
    "king sand crab":                  {"anchor": "Hosidius",                   "category": "monster"},
    "dagannoth":                       {"anchor": "Waterbirth Island",          "category": "monster"},
    "brine rat":                       {"anchor": "Windswept tree", "location_match": "brine rat cavern", "category": "monster"},
    "cockatrice":                      {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    "jelly":                           {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    "kurask":                          {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    "turoth":                          {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    "wallasalki":                      {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    "wallasaki":                       {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    # Pyrefiend's wiki page has 6 LocLines but every Fremennik / Asgarnia /
    # Morytania / Desert / Wilderness entry is underground (mapID > 0 or
    # y > 4094, both filtered out). The only mapID=0 entry is the Isle
    # of Souls (Soul Wars), which is tagged `leagueRegion = misthalin`
    # — locked in Demonic Pacts and now dropped at scrape time. With
    # zero surface spawns left, the curated anchor pins Pyrefiend at the
    # Fremennik Slayer Dungeon trapdoor (north-east of Rellekka), which
    # is the actual surface route to the Fremennik Slayer Cave.
    "pyrefiend":                       {"anchor": "Fremennik Slayer Dungeon",   "category": "monster"},
    "penguin":                         {"anchor": "Iceberg",                    "category": "monster"},
    "werewolf":                        {"anchor": "Canifis",                    "category": "monster"},
    "snail":                           {"anchor": "Mort Myre Swamp",            "category": "monster"},
    "fiyr shade":                      {"anchor": "Shades of Mort'ton",         "category": "monster"},
    "urium shade":                     {"anchor": "Shades of Mort'ton",         "category": "monster"},
    "sarachnis":                       {"anchor": "Forthos Dungeon",            "category": "boss"},
    "yama":                            {"anchor": "Slepe",                      "category": "boss"},
    # See the long comment on `"the mimic"` above — Mimic challenge is at
    # the Strange Casket upstairs in Watson's house, Hosidius. Watson's
    # NPC infobox has {{Map|x=1646|y=3574}} which the anchor resolver
    # picks up automatically from the wiki.
    "mimic":                           {"anchor": "Watson",                     "category": "boss"},
    "duke sucellus sleeper":           {"anchor": "Ghorrock",                   "category": "boss"},
    "leviathan sleeper":               {"anchor": "Edgeville",                  "category": "boss"},
    "vardorvis sleeper":               {"anchor": "Strangled",                  "category": "boss"},
    "whispered":                       {"anchor": "Edgeville",                  "category": "boss"},
    "unbound jaltok-jad":              {"anchor": "Mor Ul Rek",                 "category": "boss"},
    "royal titans":                    {"anchor": "Burthorpe",                  "category": "boss"},

    # ───── Other high-value overrides ─────
    "shooting stars":             {"anchor": "Falador",                "category": "activity"},
    "shooting star":              {"anchor": "Falador",                "category": "activity"},
    "shades of mort'ton":         {"anchor": "Shades of Mort'ton",     "category": "minigame"},
    "pyramid plunder":             {"anchor": "Pyramid Plunder",       "category": "minigame"},
    "mahogany homes":              {"anchor": "Mahogany Homes",        "category": "activity"},
    "tithe farm":                  {"anchor": "Tithe Farm",            "category": "minigame"},
    "aerial fishing":              {"anchor": "Lovakengj",             "category": "minigame"},
    "trouble brewing":             {"anchor": "Trouble Brewing",       "category": "minigame"},
    "hallowed sepulchre":          {"anchor": "Hallowed Sepulchre",    "category": "minigame"},
    "guardians of the rift":       {"anchor": "Arceuus",               "category": "minigame"},
    "barbarian assault":           {"anchor": "Barbarian Outpost",     "category": "minigame"},
    "mage training arena":         {"anchor": "Mage Training Arena",   "category": "minigame"},
    "barrows":                     {"anchor": "Barrows",               "category": "minigame"},
    "vale totems":                 {"anchor": "Auburnvale",            "category": "minigame"},
    "hunter rumours":              {"anchor": "Hunter Guild",          "category": "activity"},
    "mastering mixology":          {"anchor": "Aldarin",               "category": "minigame"},
    "hespori":                     {"anchor": "Farming Guild",         "category": "boss"},
    "slayer tower":                {"anchor": "Canifis",               "category": "dungeon"},
    "god wars dungeon":            {"anchor": "God Wars Dungeon",      "category": "dungeon"},
    "waterbirth island dungeon":   {"anchor": "Waterbirth Island",     "category": "dungeon"},
    "kraken":                      {"anchor": "Kraken Cove",           "category": "boss"},
    "kraken cove":                 {"anchor": "Kraken Cove",           "category": "dungeon"},
    "smoke devil dungeon":         {"anchor": "Smoke Dungeon",         "category": "dungeon"},
    "lunar isle":                  {"anchor": "Lunar Isle",            "category": "city"},
    "ape atoll":                   {"anchor": "Ape Atoll",             "category": "city"},
    "piscatoris":                  {"anchor": "Piscatoris",            "category": "landmark"},
    "fight caves":                 {"anchor": "Mor Ul Rek",            "category": "minigame"},
    "the inferno":                 {"anchor": "Mor Ul Rek",            "category": "minigame"},
    "inferno":                     {"anchor": "Mor Ul Rek",            "category": "minigame"},

    # ───── Off-map / instanced leftovers ─────
    "baby impling":                {"anchor": "Draynor Village",       "category": "monster"},
    "bardur":                      {"anchor": "Waterbirth Island",     "category": "npc"},
    "rock lobster":                {"anchor": "Waterbirth Island",     "category": "monster"},
    "scarab mage":                 {"anchor": "Shantay Pass",          "category": "monster"},
}


# ---------------------------------------------------------------------------
# Coord template parser (lifted from scripts/fetch-wiki-coords.py)
# ---------------------------------------------------------------------------
_TEMPLATE_RE = re.compile(
    r"\{\{(Map|LocLine|ObjectLocLine|ItemSpawnLine|NPCLocLine)\b([^{}]*?(?:\{\{[^{}]*\}\}[^{}]*?)*)\}\}",
    re.DOTALL | re.IGNORECASE,
)
_XY_POS_STRICT_RE = re.compile(r"^\s*(\d{3,5})\s*,\s*(\d{3,5})\s*$")
_XY_NAMED_RE = re.compile(
    r"x\s*[:=]\s*(\d{3,5})\s*[,|]?\s*y\s*[:=]\s*(\d{3,5})", re.IGNORECASE
)
_STYLE_KEYWORDS = (
    "mtype:", "stroke", "fill:", "desc:", "label:", "width", "opacity",
)
_INFOBOX_RE = re.compile(r"\{\{Infobox\s+([A-Za-z][A-Za-z ]*)", re.IGNORECASE)
_LEAGUE_REGION_RE = re.compile(r"leagueRegion\s*=\s*([A-Za-z' ]+)", re.IGNORECASE)


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


def parse_coords(wt: str) -> list[dict]:
    """Return every candidate coord found on the page.

    Each emitted dict carries:
      • `location`   — raw `location=` value from the LocLine, lowercased &
                       wiki-link-stripped, so callers can filter by sub-area
                       (e.g. `Windswept tree` lists both Fossil Island and
                       Brine Rat Cavern entries; the curated entry for
                       brine rat selects only the latter).
      • `leagueRegion` — the per-LocLine `leagueRegion=` value (or None).
                       Each LocLine on a page can declare its own league
                       region; e.g. on the Scorpion page the Sailing-era
                       island entries ("Sunbleak", "Abalone Cliffs",
                       "The Great Conch") are tagged `leagueRegion = N/A`
                       even though the entity-level fallback is "Desert".
                       Without per-spawn data those Sailing coords would
                       leak into the Desert pin and render in the southern
                       ocean. The runtime drops `N/A` spawns entirely.
    """
    out: list[dict] = []
    for m in _TEMPLATE_RE.finditer(wt):
        kind = m.group(1).lower()
        body = m.group(2)
        parts = _split_top_level(body)
        plane: int | None = None
        mapID: int | None = None
        location: str = ""
        league_region: str | None = None
        xs: list[tuple[int, int]] = []
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
                elif k == "location":
                    # Strip [[wiki links]] and extract display text
                    loc = re.sub(r"\[\[([^\]|]*\|)?([^\]]+)\]\]", r"\2", v)
                    location = loc.strip().lower()
                elif k == "leagueregion":
                    league_region = v.strip()
        if inline_x is not None and inline_y is not None:
            xs.append((inline_x, inline_y))
        for p in parts:
            ps = p.strip()
            if any(k in ps for k in _STYLE_KEYWORDS):
                continue
            for mm in _XY_NAMED_RE.finditer(ps):
                xs.append((int(mm.group(1)), int(mm.group(2))))
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
                "x": x, "y": y,
                "plane": plane, "mapID": mapID,
                "kind": kind, "location": location,
                "leagueRegion": league_region,
            })
    return out


def is_surface_pin(m: dict) -> bool:
    """True iff the coord is on the base-game surface map.

    The decisive filter is the (x, y) envelope, NOT the mapID. mapID is
    used inconsistently on the wiki:

      • unset  → surface (implicit)
      • 0      → surface (explicit)
      • -1     → "layer unspecified". Often still a perfectly valid
                 surface tile: the Rat page has 76 LocLines all tagged
                 mapID=-1 for real surface spots (Grand Exchange, Slepe,
                 Lovakengj, Lumbridge, Falador Farm…). Treating -1 as
                 non-surface drops ~20% of the scraped entities.
                 Occasionally it marks an instance coord like the Tree
                 Gnome Village Dungeon (x=2793, y=4256) — which the
                 y-bound below catches anyway.
      • N>0    → specific non-surface layer (Prifddinas=29, caves=19,
                 etc.) — reject.

    Surface-world y stops at 4094 on the rendered PNG; anything above is
    instanced coord space (dungeon, Prifddinas interior, Colosseum…).
    Plane is ignored because upstairs NPCs project to the same (x, y).

    `src/data/wikiEntities.ts` applies a second tight gate at load time
    (using the calibrated PNG bounds) as defense-in-depth: if a new
    template or bad mapID ever smuggles a non-renderable coord through
    here, the runtime still refuses to place it on the map.
    """
    if m["mapID"] not in (None, 0, -1):
        return False
    if not (900 <= m["x"] <= 4100 and 2300 <= m["y"] <= 4094):
        return False
    # Per-LocLine `leagueRegion = N/A` flags content that's outside the
    # league entirely (Sailing islands, post-launch additions, etc.).
    # Without this filter the Sailing scorpion spawns at y≈2350 leak
    # into the Scorpion (Desert) pin and render in the southern ocean.
    lr = m.get("leagueRegion")
    if lr:
        lr_upper = lr.strip().upper()
        if lr_upper in {"N/A", "NA", "NONE"}:
            return False
        # Misthalin is locked in Demonic Pacts. Per-spawn `leagueRegion =
        # misthalin` flags content the player can never reach — most
        # notably the Isle of Souls (Soul Wars) entries the wiki tags as
        # misthalin even though their (x, y) sits outside our Misthalin
        # bbox. Without this filter, e.g. Pyrefiend's only mapID=0 spawns
        # are the 10 Isle of Souls coords; they leak into the entity-
        # level fallback ("Fremennik" from the infobox) and render the
        # Pyrefiend (Fremennik Province) task pin smack on Soul Wars.
        # This is the per-spawn analogue of the runtime
        # INACCESSIBLE_REGIONS check in src/data/wikiEntities.ts — we
        # apply it at scrape time so the JSON doesn't ship with phantom
        # Misthalin spawns waiting to be misclassified at runtime.
        if lr_upper == "MISTHALIN":
            return False
    return True


def pick_surface_coord(maps: list[dict]) -> dict | None:
    # Prefer {{Map}} over {{LocLine}} since Map is usually the infobox pin.
    for m in maps:
        if m["kind"] == "map" and is_surface_pin(m):
            return m
    for m in maps:
        if is_surface_pin(m):
            return m
    return None


def infer_category(wt: str) -> str | None:
    m = _INFOBOX_RE.search(wt)
    if not m:
        return None
    tag = m.group(1).strip().lower()
    if "npc" in tag:
        return "npc"
    if "monster" in tag:
        return "monster"
    if "item" in tag:
        return "item"
    if "scenery" in tag:
        return "scenery"
    if "location" in tag:
        return "landmark"
    if "shop" in tag:
        return "shop"
    if "quest" in tag:
        return "quest"
    if "minigame" in tag:
        return "minigame"
    return tag.split()[0]


def extract_league_region(wt: str) -> str | None:
    m = _LEAGUE_REGION_RE.search(wt)
    if not m:
        return None
    return m.group(1).strip().title()


# ---------------------------------------------------------------------------
# Batch wiki fetch
# ---------------------------------------------------------------------------
def fetch_batch(titles: list[str]) -> tuple[dict[str, str], dict[str, str], list[str]]:
    """Return (wikitext_by_resolved_title, original_to_resolved_map, missing_titles)."""
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "redirects": "1",
        "titles": "|".join(titles),
    }
    url = f"{WIKI_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)

    q = payload.get("query", {})
    wt_by_resolved: dict[str, str] = {}
    original_to_resolved: dict[str, str] = {}
    missing: list[str] = []

    # Redirect arrows: from -> to.
    for r in q.get("redirects", []):
        original_to_resolved[r["from"]] = r["to"]
    # Normalisation: e.g. "black knight" → "Black knight" via normalized form.
    for n in q.get("normalized", []):
        original_to_resolved[n["from"]] = n["to"]

    for page in q.get("pages", []):
        title = page.get("title")
        if page.get("missing") or page.get("invalid"):
            missing.append(title)
            continue
        revs = page.get("revisions") or []
        if not revs:
            missing.append(title)
            continue
        content = revs[0].get("slots", {}).get("main", {}).get("content")
        if content:
            wt_by_resolved[title] = content
    return wt_by_resolved, original_to_resolved, missing


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def collect_titles() -> list[str]:
    tasks = json.loads(TASKS_JSON.read_text())
    seen: dict[str, int] = {}
    for t in tasks:
        for link in t.get("wikiLinks", []):
            key = link.strip()
            if not key:
                continue
            seen[key] = seen.get(key, 0) + 1
    # Sort by frequency desc, then alpha — so if something goes wrong we've
    # still covered the highest-impact entities.
    return sorted(seen, key=lambda k: (-seen[k], k.lower()))


def main() -> int:
    titles = collect_titles()
    print(f"Found {len(titles)} unique wikiLinks across tasks.json")

    to_fetch = [t for t in titles if not should_skip(t)]
    skipped = [t for t in titles if should_skip(t)]
    print(f"  {len(skipped)} pre-skipped as non-geo (skills, meta, items)")
    print(f"  {len(to_fetch)} to fetch from the wiki")

    # Resolve-title map: original query title -> canonical wiki title
    resolved_map: dict[str, str] = {}
    wt_by_title: dict[str, str] = {}

    batches = [to_fetch[i : i + BATCH_SIZE] for i in range(0, len(to_fetch), BATCH_SIZE)]
    for idx, batch in enumerate(batches):
        print(f"  batch {idx + 1}/{len(batches)}  ({len(batch)} titles)...", end=" ", flush=True)
        try:
            wt_by_resolved, orig_to_res, missing = fetch_batch(batch)
        except Exception as e:
            print(f"FAILED: {e}")
            time.sleep(2.0)
            continue
        wt_by_title.update(wt_by_resolved)
        resolved_map.update(orig_to_res)
        print(f"resolved {len(wt_by_resolved)} pages, {len(missing)} missing")
        time.sleep(0.3)

    print()
    print(f"Fetched {len(wt_by_title)} wikitext pages.")

    # Now parse coords for every original title
    entities: dict[str, dict] = {}
    hits = 0
    for title in titles:
        resolved = resolved_map.get(title, title)
        wt = wt_by_title.get(resolved)
        if not wt:
            continue
        coords = parse_coords(wt)
        pick = pick_surface_coord(coords)
        if not pick:
            continue
        all_surface = [(c["x"], c["y"]) for c in coords if is_surface_pin(c)]
        # de-dupe preserving order
        seen_xy: set[tuple[int, int]] = set()
        all_spawns: list[list[int]] = []
        for xy in all_surface:
            if xy in seen_xy:
                continue
            seen_xy.add(xy)
            all_spawns.append(list(xy))
        entities[title.lower()] = {
            "title": title,
            "resolvedTitle": resolved,
            "x": pick["x"],
            "y": pick["y"],
            "source": pick["kind"],
            "allSpawns": all_spawns,
            "category": infer_category(wt),
            "leagueRegion": extract_league_region(wt),
        }
        hits += 1

    print(f"Geolocated {hits} / {len(to_fetch)} pages from wiki ({100 * hits / max(1, len(to_fetch)):.1f}%).")

    # ── Resolve curated anchors from the wiki ──
    # Collect every unique "anchor" page referenced by CURATED_ENTITIES, then
    # batch-fetch those pages and parse their {{Map}} coord. No coordinate
    # is ever hand-typed — every curated pin traces back to a wiki page.
    anchor_titles: set[str] = set()
    for override in CURATED_ENTITIES.values():
        if "spawns" in override:
            for s in override["spawns"]:
                anchor_titles.add(s["anchor"])
        else:
            anchor_titles.add(override["anchor"])
    anchor_list = sorted(anchor_titles)
    print(f"\nResolving {len(anchor_list)} curated anchor pages from the wiki...")

    # Skip anchors we already fetched in the main pass.
    anchor_to_fetch = [t for t in anchor_list if t not in wt_by_title and t not in resolved_map]
    anchor_batches = [anchor_to_fetch[i : i + BATCH_SIZE] for i in range(0, len(anchor_to_fetch), BATCH_SIZE)]
    for idx, batch in enumerate(anchor_batches):
        print(f"  anchor batch {idx + 1}/{len(anchor_batches)}  ({len(batch)} titles)...", end=" ", flush=True)
        try:
            wt_by_resolved, orig_to_res, missing = fetch_batch(batch)
        except Exception as e:
            print(f"FAILED: {e}")
            time.sleep(2.0)
            continue
        wt_by_title.update(wt_by_resolved)
        resolved_map.update(orig_to_res)
        print(f"resolved {len(wt_by_resolved)} pages, {len(missing)} missing")
        time.sleep(0.3)

    # Build anchor → (default (x,y), all parsed coords) maps.
    # We keep the full coord list per anchor so curated entries can request
    # a sub-location filter (e.g. `Windswept tree` has both Fossil Island
    # and Brine Rat Cavern entries — the `brine rat` curated entry selects
    # only the `Brine Rat Cavern` coord via location_match).
    anchor_coord: dict[str, tuple[int, int]] = {}
    anchor_all_coords: dict[str, list[dict]] = {}
    unresolved_anchors: list[str] = []
    for anchor in anchor_list:
        resolved = resolved_map.get(anchor, anchor)
        wt = wt_by_title.get(resolved)
        if not wt:
            unresolved_anchors.append(anchor)
            continue
        coords = parse_coords(wt)
        anchor_all_coords[anchor] = coords
        pick = pick_surface_coord(coords)
        if not pick:
            unresolved_anchors.append(anchor)
            continue
        anchor_coord[anchor] = (pick["x"], pick["y"])

    def resolve_anchor_coord(anchor: str, location_match: str | None) -> tuple[int, int] | None:
        """Return (x, y) for an anchor, optionally filtered by sub-location.

        Order of resolution:
          1. ANCHOR_COORD_OVERRIDES (hand-curated surface coord — used when
             the wiki page only has an instanced/underground {{Map}}).
          2. Wiki-scraped coords filtered by `location_match` (sub-region).
          3. Wiki-scraped default coord for the anchor.
        """
        if anchor in ANCHOR_COORD_OVERRIDES and not location_match:
            return ANCHOR_COORD_OVERRIDES[anchor]
        if not location_match:
            return anchor_coord.get(anchor)
        coords = anchor_all_coords.get(anchor)
        if not coords:
            return None
        needle = location_match.lower()
        filtered = [c for c in coords if needle in c.get("location", "")]
        pick = pick_surface_coord(filtered)
        return (pick["x"], pick["y"]) if pick else None

    if unresolved_anchors:
        print("\n⚠️  UNRESOLVED CURATED ANCHORS — these pages had no surface {{Map}}:")
        for a in unresolved_anchors:
            print(f"    - {a!r}")
        print("  Fix: change the CURATED_ENTITIES 'anchor' to a nearby page with a Map template.")

    # ── Apply curated overrides using wiki-sourced coords ──
    curated_applied = 0
    curated_added = 0
    curated_skipped = 0
    for key, override in CURATED_ENTITIES.items():
        existing = entities.get(key)
        if "spawns" in override:
            resolved_spawns = []
            for s in override["spawns"]:
                xy = resolve_anchor_coord(s["anchor"], s.get("location_match"))
                if xy:
                    resolved_spawns.append({"x": xy[0], "y": xy[1],
                                            "note": f"{s['anchor']} ({s.get('region_hint','')})"})
        else:
            xy = resolve_anchor_coord(override["anchor"], override.get("location_match"))
            resolved_spawns = [{"x": xy[0], "y": xy[1], "note": override["anchor"]}] if xy else []
        if not resolved_spawns:
            curated_skipped += 1
            continue
        first = resolved_spawns[0]
        # De-dupe spawns by (x,y) — multiple anchor titles may map to same coord.
        seen_xy: set[tuple[int, int]] = set()
        all_spawns: list[list[int]] = []
        for s in resolved_spawns:
            xy = (s["x"], s["y"])
            if xy in seen_xy:
                continue
            seen_xy.add(xy)
            all_spawns.append([xy[0], xy[1]])
        entities[key] = {
            "title": existing["title"] if existing else key.title(),
            "resolvedTitle": existing["resolvedTitle"] if existing else key.title(),
            "x": first["x"],
            "y": first["y"],
            "source": "curated",
            "allSpawns": all_spawns,
            "category": override.get("category") or (existing and existing.get("category")) or "landmark",
            "leagueRegion": existing["leagueRegion"] if existing else None,
            "note": first.get("note", ""),
        }
        if existing:
            curated_applied += 1
        else:
            curated_added += 1
    print(f"\nCurated overrides: replaced {curated_applied}, added {curated_added} new entities, skipped {curated_skipped} (unresolvable).")
    print(f"Final entity count: {len(entities)}")

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(entities, indent=2, sort_keys=True))
    print(f"Wrote {OUTPUT_JSON.relative_to(ROOT)}")

    # Print a small sample so we can eyeball it
    print("\nSample entities:")
    for title in ["Thurgo", "Black Knight", "Malignius Mortifer", "Xolo", "Oli",
                  "Silk trader", "Mysterious Old Man", "Dharok", "cow", "troll"]:
        e = entities.get(title.lower())
        if e:
            print(f"  {title:30s} → ({e['x']}, {e['y']})  [{e['category']}]  spawns={len(e['allSpawns'])}")
        else:
            print(f"  {title:30s} → (none)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
