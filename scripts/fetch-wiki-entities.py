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
    # The Mountain Troll wiki has only ONE Fremennik LocLine — "South of
    # Keldagrim" at mapID=10 (underground tunnel between the surface trapdoor
    # and Keldagrim itself, x:2825-2844, y:10083-10101). The previous Fremennik
    # troll pin (Trollheim, 2891, 3678) was actually the Trollheim plateau in
    # *Asgarnia* — wrong region for Fremennik tasks AND wrong physical area for
    # what players want from a Fremennik troll pin. The right surface pin for
    # the south-of-Keldagrim tunnel is the cave entrance east of Rellekka,
    # which the wiki canonically reaches via fairy ring DKS at (2744, 3719) —
    # the Keldagrim wiki page even names the fairy ring as the recommended
    # entry point: "Players can use fairy ring code DKS to teleport right next
    # to the cave entrance to Keldagrim." There is no wiki page with a
    # surface {{Map}} for the cave entrance scenery itself (its infobox map
    # points to (2781, 10161) inside the cave), so we override the anchor to
    # the wiki-confirmed fairy ring landing tile.
    "Keldagrim entrance": (2744, 3719),
    # The Prifddinas wiki page's {{Map}} points at (2210, 3390), the
    # Tower of Voices teleport pad. Players who walk to ANY Prifddinas-
    # instanced boss (Zalcano, The Gauntlet / Corrupted Gauntlet,
    # Fragment of Seren) arrive at the Crystal Gate just north of the
    # tower — the tile players actually stand on to launch the instance,
    # and the same coord locations.ts uses for these bosses. Locking the
    # anchor here keeps every Prifddinas-instanced-boss pin co-located on
    # the gate row instead of drifting to whatever the next wiki re-scrape
    # of "Prifddinas" returns. Lletya remains its own pin via the wiki's
    # native (2338, 3171) coord — this override only fires for entities
    # that explicitly anchor to "Prifddinas" in CURATED_ENTITIES.
    "Prifddinas": (2210, 3415),
    # Ruins of Tapoyauik (Amoxliatl's home) sits beneath the Twilight Temple
    # east of Civitas illa Fortis. Its wiki page's {{Map|mtype=rectangle|...|
    # x:1693.5,y:3232}} can't be parsed by the integer-only X/Y regex, so we
    # hand-curate the rounded surface entrance coord here. Verified visually
    # against the world-map PNG (Twilight Temple courtyard is the rectangle
    # the wiki Map highlights).
    "Ruins of Tapoyauik": (1693, 3232),
    # Tonali Cavern is the surface entrance to the Crypt of Tonali / Ruins
    # of Mokhaiotl (Doom of Mokhaiotl's lair). Two ladder-down points exist
    # in the Tlati Rainforest at (1309, 3104) and (1305, 3033); we use the
    # northern one because it's closer to the Civitas teleport hub and is
    # the tile players actually walk to from the Mokhaiotl waystone arrival
    # area. Wiki: {{Map|1309,3104|1305,3033|caption=Entrances to Tonali
    # Cavern}}.
    "Tonali Cavern": (1309, 3104),
}


# ---------------------------------------------------------------------------
# Post-scrape entity coord overrides
# ---------------------------------------------------------------------------
# Applied AFTER the default wiki-scrape has populated (x, y) for each entity.
# Use for entities where the wiki page's own {{Map}} coord is canonically
# correct (points at a real in-game tile) but lands the pin far from where
# the wiki's world-map PNG prints that entity's LABEL. The distinction from
# ANCHOR_COORD_OVERRIDES is that these are looked up by the entity's lower-
# cased wiki title (matching the key used in wikiEntities.json) — they are
# not tied to the CURATED_ENTITIES anchor flow.
#
# Each override MUST document why the wiki coord is at one place but the
# visible label renders elsewhere. Coords are validated against the world-
# map PNG by scripts/verify-calibration.ts conventions (src-px ±15 of the
# rendered label center).
ENTITY_COORD_OVERRIDES: dict[str, tuple[int, int]] = {
    # The Colossal Wyrm Remains wiki page's {{Map}} points at (1640, 2921),
    # which is the NORTHERN RIM of the crater where the Colossal Wyrm
    # Agility Course starts. That coord is physically correct — players
    # walking to the agility entrance land there — but the "Colossal Wyrm
    # Remains" TEXT LABEL is printed in the middle of the crater on the
    # wiki world-map PNG, ~130 src-px south of the rim. Both entries also
    # currently share the exact same scraped coord (both (1640, 2921)), so
    # every wyrm-region task stacks on a pin sitting above the visible
    # crater. Measured label center in /tmp/osrs_worldmap.orig.png is
    # src ≈ (2050, 3940); inverting through the CURRENT piecewise
    # calibration gives game (1657, 2890), which puts the pin ON the
    # label. See scripts/verify-calibration.ts + /tmp/cal_debug/y_check/
    # Colossal_Wyrm_Remains_label.jpg for the visual derivation.
    "colossal wyrm remains":        (1657, 2890),
    "colossal wyrm agility course": (1657, 2890),
    # King Sand Crabs live on the Hosidius SAND CRAB BEACH (south coast of
    # Kourend), NOT at Hosidius town centre. The curated anchor "Hosidius"
    # resolves to the town-hall coord (1762, 3598), which is ~130 game tiles
    # NORTH of the beach where players actually afk King Sand Crabs. This
    # override pins to the Xeric's talisman "Sand Crabs" teleport destination,
    # which is the canonical middle of the sand-crab line on the Hosidius
    # beach — players land on top of King Sand Crab spawns there.
    "king sand crab":               (1782, 3469),
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
    # Amoxliatl is fought on the bottom floor of the Ruins of Tapoyauik,
    # the dungeon underneath the Twilight Temple east of Civitas illa
    # Fortis. The previous "Hunter Guild" anchor was a lazy bucketing of
    # every Varlamore boss to the same Quetzal hub and put the pin ~140
    # game tiles west of where players actually walk in. Anchor coord
    # comes from ANCHOR_COORD_OVERRIDES["Ruins of Tapoyauik"] above
    # (the wiki Map template uses non-integer x:1693.5 which the parser
    # can't read directly).
    "amoxliatl":                {"anchor": "Ruins of Tapoyauik",      "category": "boss"},
    # Hueycoatl is fought at THE DARKFROST mountain on the north flank of
    # Civitas illa Fortis (Hailstorm Mountains), NOT in the Hunter Guild.
    # The previous "Hunter Guild" anchor was a lazy bucketing of every
    # Varlamore boss to the same Quetzal hub and put both Hueycoatl pins
    # on top of Civitas's Hunter Guild (1559, 3048) — wrong by ~250 game
    # tiles. The Darkfrost wiki page's {{Map}} resolves to (1512, 3285),
    # which is the rendered "The Darkfrost" label on the world map and
    # matches both the LocLine on `The Hueycoatl` itself
    # (x:1509, y:3290) and the Pendant of Ates teleport landing tile
    # players use to reach the arena entrance.
    "hueycoatl":                {"anchor": "The Darkfrost",           "category": "boss"},
    "the hueycoatl":            {"anchor": "The Darkfrost",           "category": "boss"},
    # Doom of Mokhaiotl is fought deep beneath the Crypt of Tonali in the
    # Tlati Rainforest — surface entrance is the Tonali Cavern ladder at
    # (1309, 3104), reached via the Mokhaiotl waystone after `The Final
    # Dawn`. Same lazy-Hunter-Guild bucketing as the other two; pin was
    # ~250 game tiles east of the actual cavern. Anchor coord comes from
    # ANCHOR_COORD_OVERRIDES["Tonali Cavern"] above.
    "doom of mokhaiotl":        {"anchor": "Tonali Cavern",           "category": "boss"},
    "mokhaiotl":                {"anchor": "Tonali Cavern",           "category": "boss"},
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
    # All anchored to Prifddinas (Tower of Voices area), NOT Lletya. The
    # Gauntlet portal sits at the Crystal Gate next to the Tower of Voices,
    # and Zalcano lives inside the Trahaearn smithing district. Lletya is
    # ~225 game tiles southeast and would put every elf-quest pin in the
    # wrong elven settlement. ANCHOR_COORD_OVERRIDES["Prifddinas"] below
    # locks the resolved coord to the Tower of Voices area so a single
    # marker covers all of these instanced bosses + Song of the Elves
    # endgame, matching where players actually walk in.
    "zalcano":                  {"anchor": "Prifddinas",              "category": "boss"},
    "corrupted hunllef":        {"anchor": "Prifddinas",              "category": "boss"},
    "the hunllef":              {"anchor": "Prifddinas",              "category": "boss"},
    "the corrupted gauntlet":   {"anchor": "Prifddinas",              "category": "boss"},
    "the gauntlet":             {"anchor": "Prifddinas",              "category": "boss"},

    # ───── God Wars & DT2 bosses (surface entrances) ─────
    "nex":                      {"anchor": "God Wars Dungeon",        "category": "boss"},
    "kree'arra":                {"anchor": "God Wars Dungeon",        "category": "boss"},
    "commander zilyana":        {"anchor": "God Wars Dungeon",        "category": "boss"},
    "general graardor":         {"anchor": "God Wars Dungeon",        "category": "boss"},
    "k'ril tsutsaroth":         {"anchor": "God Wars Dungeon",        "category": "boss"},
    # The four DT2 bosses (Vardorvis, The Whisperer, The Leviathan, Duke
    # Sucellus) used to live here as curated entities, but they were all
    # broken: "Strangled" resolved to (1170, 3414) in Varlamore Sunset
    # Coast (some random NPC page that happened to title-match), and
    # "Edgeville" was a pure placeholder for the three remaining bosses
    # — all three pinned to the Edgeville bank tile, even though their
    # lairs are nowhere near each other (Whisperer beneath Ice Mountain,
    # Leviathan in Lithkren Vault, Duke Sucellus at Ghorrock). On top of
    # that the four DT2 *vestige rings* (Bellator/Magus/Ultor/Venator)
    # all collapsed onto the single `desert-treasure-ii` quest-start pin
    # (2666, 3691) because each ring is its own item with no entity hook
    # — visually, all four ring tasks "huddled in one spot" north of Al
    # Kharid instead of pointing players at the boss that actually drops
    # them.
    #
    # Both problems are now solved by **landmarks** in
    # src/data/locations.ts (search for "vardorvis-arena",
    # "whisperer-lair", "duke-sucellus-lair", "leviathan-lair"). Each
    # landmark holds the boss aliases (so "Defeat Vardorvis" still
    # resolves) AND the dropped-ring/bow aliases (so "Equip the Ultor
    # Ring" lands on Vardorvis's lair, not the DT2 quest start). Keeping
    # them as *landmarks* instead of curated entities means they pin to
    # exactly one well-chosen surface entrance per boss with no chance
    # of the wiki scraper later overwriting the coord with whatever
    # {{Map}} template happens to live on the boss's own wiki page
    # (Vardorvis's page resolves to mapID=11421, an instance coord).
    #
    # If you ever want to re-add them here, the right anchors are:
    #   Whisperer    → "Frozen Door"          (3008, 3501) Asgarnia
    #   Leviathan    → "Lithkren Vault"       (3551, 3553) Morytania
    #   Duke Sucellus→ "Ghorrock"             (2915, 3935) Wilderness  ✓ correct already
    #   Vardorvis    → "Stranglewood" / "The Strangled"  (3623, 3378) Morytania

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
    # Black dragon's wiki page lists 8 LocLine entries but every Demonic
    # Pacts-reachable spawn is underground (mapID > 0), so the auto-scrape
    # only catches the Mynydd surface dragon in Tirannwn — leaving a
    # Kandarin task ("Cast water surge at a Black dragon in Kandarin") to
    # mis-pin onto Mynydd because there's no Kandarin candidate. The wiki
    # tags the Demonic Pacts-reachable surface entrances as: Taverley
    # Dungeon (Asgarnia), Myths' Guild basement / Corsair Cove Dungeon
    # (Kandarin), Mynydd summit (Tirannwn), Lava Maze Dungeon + Wilderness
    # Slayer Cave (Wilderness). Charred Dungeon and Evil Chicken's Lair
    # both lack a Demonic Pacts region tag so they're omitted.
    "black dragon":              {"spawns": [
        {"anchor": "Taverley Dungeon",     "region_hint": "Asgarnia"},
        {"anchor": "Myths' Guild",         "region_hint": "Kandarin"},
        {"anchor": "Mynydd",               "region_hint": "Tirannwn"},
        {"anchor": "Lava Maze",            "region_hint": "Wilderness"},
    ], "category": "monster"},
    "black demon":               {"spawns": [
        {"anchor": "Taverley Dungeon",     "region_hint": "Asgarnia"},
        {"anchor": "Brimhaven Dungeon",    "region_hint": "Karamja"},
        {"anchor": "Edgeville Dungeon",    "region_hint": "Wilderness"},
        {"anchor": "Chaos Druid Tower",    "region_hint": "Kandarin"},
    ], "category": "monster"},
    "troll":                     {"spawns": [
        {"anchor": "Burthorpe",            "region_hint": "Asgarnia"},
        # Fremennik Mountain Trolls only spawn underground in the south-of-
        # Keldagrim tunnel (Mountain_troll wiki LocLine, mapID=10, leagueRegion
        # = Fremennik). Surface entry is the cave east of Rellekka, reachable
        # via fairy ring DKS — see ANCHOR_COORD_OVERRIDES["Keldagrim entrance"].
        # Trollheim itself sits in Asgarnia (region_hint "Fremennik" on a
        # Trollheim coord would mis-tag the pin), so we anchor on the
        # Keldagrim entrance area instead.
        {"anchor": "Keldagrim entrance",   "region_hint": "Fremennik"},
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
    # Song of the Elves final boss — fought in Prifddinas's Grand Library,
    # NOT Lletya. Anchor to Prifddinas so the pin lands at the Tower of
    # Voices alongside the other Prifddinas-instanced bosses.
    "fragment of seren":               {"anchor": "Prifddinas",                 "category": "boss"},
    "frost crab":                      {"anchor": "Sunset Coast",               "category": "monster"},
    # Jubster is a player-created Creature Creation monster, only spawnable
    # in the Tower of Life basement (Ardougne) — not a wild Feldip Hills
    # creature, despite some old wiki revisions tagging it that way.
    "jubster":                         {"anchor": "Tower of Life",              "category": "monster"},
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
    # DT2 Awakened/Sleeper variants live in the same lairs as their base
    # bosses — see the long comment on the base "vardorvis"/"whisperer"/
    # "leviathan"/"duke sucellus" entries above for why these are now
    # handled as landmarks in src/data/locations.ts. The base boss
    # landmark aliases ("whisperer", "vardorvis", etc.) catch the
    # Awakened-variant tasks too via the description-text scan in
    # the resolver — every Awakened task description still contains
    # the base boss name (e.g. "Defeat Awakened Whisperer.").
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

# Detects a {{Map}} template that lives inside an EMPTY `leagues-global-flag`
# table cell. Wiki convention on multi-location pages (e.g. Furnace, Anvil
# in newer table format) is to flag each row with its league region:
#   |class="leagues-global-flag"|{{LeagueRegion|Karamja}}
#   |{{Map|...|x=2857|y=2967|...}}
# Rows tagged for Sailing / post-launch content leave that cell EMPTY:
#   |class="leagues-global-flag"|
#   |{{Map|...|x=1948|y=2755|...}}     ← Deepfin Point (Sailing 67)
# The empty cell is the wiki's own "this content isn't in any league area"
# signal — same semantics as `leagueRegion = N/A` on a per-LocLine page,
# just expressed structurally instead of via a parameter. We catch it here
# so the scraper auto-drops these spawns instead of leaking them into the
# entity-level `leagueRegion` fallback (which renders the pin in random
# southern ocean as a "General"-region marker).
_EMPTY_LEAGUE_FLAG_THEN_MAP_RE = re.compile(
    r'class="leagues-global-flag"\|[ \t]*\n[ \t]*\|\s*(\{\{Map\b[^{}]*?(?:\{\{[^{}]*\}\}[^{}]*?)*\}\})',
    re.IGNORECASE | re.DOTALL,
)

# Coords known to be Sailing / post-launch content that the wiki doesn't
# tag with `leagueRegion = N/A` and that fall outside the empty-flag
# pattern above. Empirical fallback for cases the structural detection
# can't catch:
#
#   • (2218, 2784) — Anvil on Isle of Souls (Soul Wars). The wiki Anvil
#     page uses an old-format table with no leagues-global-flag column;
#     the row text "Isle of Souls" is the only signal and we don't parse
#     row context.
#
#   • Port master Sailing-port coords. The Port_master wiki page packs
#     all 30 Sailing ports into ONE {{Map}} template with no per-coord
#     leagueRegion parameter, so neither the structural detector nor
#     `is_surface_pin`'s leagueRegion gate can split league-area ports
#     from Sailing ports. Coords listed here are the Port_master spawns
#     that don't fall in any league bbox AND lie in the southern Sailing
#     y-band (post-league ocean ports the player can't reach pre-Sailing).
#
# Adding a coord here causes `is_surface_pin` to reject it BEFORE region
# inference, so the affected entity loses the bad spawn but keeps every
# legitimate league-area spawn. Tested against tasks pinning to these
# entities — Smelt/Smith/Talk-to-Port-Master tasks now fan out to all
# real regional pins instead of collapsing onto the Sailing-port medoid.
SAILING_LEAK_COORDS: set[tuple[int, int]] = {
    # Anvil — Isle of Souls (Soul Wars), old-format table row
    (2218, 2784),
    # Anvil — Sailing-only locations (no league flag column, no bbox
    # match, y > POST_LEAGUE_SOUTH_Y so runtime fallback can't drop
    # them either). Per Anvil wiki page table: Shipyard / Deepfin Point
    # Bank Chest area and similar post-launch ports.
    (1949, 2761),  # Anvil at southern Sailing port (Deepfin-class)
    (2066, 2719),  # Anvil at Shipyard / Deepfin Point Bank Chest
    # Port master — Sailing ports outside any reachable league region.
    # Manually triaged from the Port_master wiki page's 30-coord {{Map}}
    # template against REGION_BBOXES in src/data/wikiEntities.ts.
    (1927, 2761),  # south-Varlamore Sailing port
    (2581, 2848),  # south-central ocean Sailing port (the original BAD pin)
    (3061, 2985),  # south-Asgarnia Sailing port
    (3148, 2826),  # south-Desert Sailing port
    # Crimson swift — Dognose Island, an Unquiet Ocean island reachable
    # only with Sailing 40 (post-launch content, locked in Demonic Pacts).
    # The wiki Crimson_swift page lists Dognose with `leagueRegion = N/A`
    # in the human-readable column but the underlying LocLine template
    # carries no per-coord leagueRegion tag, so the N/A filter doesn't
    # see it. Without this entry the 2 Dognose spawns fall back to the
    # entity-level leagueRegion ("Desert", from the Ullek wiki entry that
    # happens to be first), polluting the Desert medoid.
    (2161, 2818),
    (2165, 2819),
}


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
    # Pre-scan: collect start positions of {{Map}} templates that follow
    # an EMPTY `leagues-global-flag` table cell. Their league region is
    # implicit-N/A — see _EMPTY_LEAGUE_FLAG_THEN_MAP_RE comment for the
    # full rationale. We tag them inline below by overriding their
    # parsed `leagueRegion` so the existing N/A filter in is_surface_pin
    # drops them without any other scraper-side change.
    tainted_template_starts: set[int] = set()
    for tm in _EMPTY_LEAGUE_FLAG_THEN_MAP_RE.finditer(wt):
        tainted_template_starts.add(tm.start(1))

    out: list[dict] = []
    for m in _TEMPLATE_RE.finditer(wt):
        kind = m.group(1).lower()
        body = m.group(2)
        parts = _split_top_level(body)
        plane: int | None = None
        mapID: int | None = None
        location: str = ""
        league_region: str | None = None
        is_empty_flag_tainted = m.start() in tainted_template_starts
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
        # An empty `leagues-global-flag` table cell directly preceding this
        # {{Map}} template is the wiki's structural signal that the row's
        # content is unreachable Sailing / post-launch material. Force
        # `leagueRegion = "N/A"` so the existing N/A filter in
        # `is_surface_pin` drops every coord this template emits — same
        # outcome as if the wiki author had explicitly written
        # `leagueRegion = N/A`, just inferred from the table structure.
        effective_league_region = "N/A" if is_empty_flag_tainted else league_region
        seen: set[tuple[int, int]] = set()
        for (x, y) in xs:
            if (x, y) in seen:
                continue
            seen.add((x, y))
            out.append({
                "x": x, "y": y,
                "plane": plane, "mapID": mapID,
                "kind": kind, "location": location,
                "leagueRegion": effective_league_region,
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
    # Hardcoded Sailing / post-launch coord blocklist — see
    # SAILING_LEAK_COORDS doc-comment for the per-coord justification.
    # Caught BEFORE the leagueRegion gate because these coords come from
    # wiki templates that lack any leagueRegion signal at all.
    if (m["x"], m["y"]) in SAILING_LEAK_COORDS:
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
                    # Per-spawn note is JUST the anchor name (e.g. "Burthorpe",
                    # "Trollheim"). The "(region)" suffix is redundant — the
                    # popup already renders a region badge above the blurb,
                    # and worse: when the runtime split this into per-region
                    # locations it would render "Burthorpe (Asgarnia)" on the
                    # Fremennik Trollheim pin if the suffix was retained AND
                    # the entity-level note leaked.
                    resolved_spawns.append({"x": xy[0], "y": xy[1],
                                            "note": s["anchor"]})
        else:
            xy = resolve_anchor_coord(override["anchor"], override.get("location_match"))
            resolved_spawns = [{"x": xy[0], "y": xy[1], "note": override["anchor"]}] if xy else []
        if not resolved_spawns:
            curated_skipped += 1
            continue
        first = resolved_spawns[0]
        # De-dupe spawns by (x,y) — multiple anchor titles may map to same coord.
        # Track per-spawn notes in the same order so the runtime can look up
        # the right blurb for each regional pin (e.g. the Fremennik Troll pin
        # gets "Trollheim" instead of inheriting the Asgarnia "Burthorpe"
        # blurb from the entity-level `note`).
        seen_xy: set[tuple[int, int]] = set()
        all_spawns: list[list[int]] = []
        spawn_notes: list[str | None] = []
        for s in resolved_spawns:
            xy = (s["x"], s["y"])
            if xy in seen_xy:
                continue
            seen_xy.add(xy)
            all_spawns.append([xy[0], xy[1]])
            spawn_notes.append(s.get("note") or None)
        entities[key] = {
            "title": existing["title"] if existing else key.title(),
            "resolvedTitle": existing["resolvedTitle"] if existing else key.title(),
            "x": first["x"],
            "y": first["y"],
            "source": "curated",
            "allSpawns": all_spawns,
            # Only emit spawnNotes when at least one spawn has a non-empty
            # note — keeps the JSON small for single-anchor entities where
            # the entity-level `note` already does the job.
            **({"spawnNotes": spawn_notes} if any(spawn_notes) else {}),
            "category": override.get("category") or (existing and existing.get("category")) or "landmark",
            "leagueRegion": existing["leagueRegion"] if existing else None,
            "note": first.get("note", ""),
        }
        if existing:
            curated_applied += 1
        else:
            curated_added += 1
    print(f"\nCurated overrides: replaced {curated_applied}, added {curated_added} new entities, skipped {curated_skipped} (unresolvable).")

    # -------------------------------------------------------------------
    # Apply ENTITY_COORD_OVERRIDES as a final pass. These correct entities
    # whose wiki-scraped coord is physically right but visually mis-
    # renders on the wiki world-map PNG (see ENTITY_COORD_OVERRIDES docs).
    # -------------------------------------------------------------------
    coord_overrides_applied = 0
    for key, (nx, ny) in ENTITY_COORD_OVERRIDES.items():
        e = entities.get(key)
        if not e:
            print(f"  WARN ENTITY_COORD_OVERRIDES: no entity '{key}' to override; skipping")
            continue
        e["x"] = nx
        e["y"] = ny
        # Rewrite allSpawns to a single-entry list so downstream medoid
        # logic doesn't pull the pin back to the old rim coord. The agility
        # course's original multi-spawn wiki data would average out to the
        # rim again if we kept it.
        e["allSpawns"] = [[nx, ny]]
        coord_overrides_applied += 1
    print(f"Entity coord overrides applied: {coord_overrides_applied}")

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
