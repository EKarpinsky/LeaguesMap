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
    # Raid / boss surface entrances that already have a curated landmark in
    # src/data/locations.ts which carries BOTH the boss aliases (so
    # "Defeat the Wintertodt" still resolves) AND every drop-equip alias
    # (so "Equip an Abyssal Tentacle" lands on Kraken Cove instead of
    # falling through to a region centroid). Without skipping, the wiki
    # scraper produces a second entity pin a few tiles away from the
    # landmark — the kill-tasks pin to the entity, the equip-tasks pin to
    # the landmark, and the user sees two visually-overlapping markers at
    # the same physical location. Same Phantom-Muspah / Nex / Sire pattern
    # as the bosses skipped above.
    "theatre of blood",     # → theatre-of-blood landmark
    "cerberus",             # → cerberus landmark (Taverley Dungeon ladder)
    "wintertodt",           # → wintertodt landmark
    "kraken",               # → kraken-cove landmark
    # Sibling pages that the wiki scraper picks up via wikiLinks on the
    # boss/raid pages we just skipped, then resolves to the SAME coord as
    # the entity we removed — recreating the dup pin under a different
    # entity slug. The Cerberus page wikiLinks "Taverley Dungeon", and the
    # cave-kraken / kraken-boss pages wikiLink "Kraken Cove", so without
    # SKIPing these too the resolver falls into a sibling-entity match
    # (not the landmark) and the user still sees two pins. The matching
    # landmark already covers both the "Enter the Taverley Dungeon"
    # generic tasks (via "taverley dungeon" alias on the cerberus
    # landmark) and the Kraken/Cave Kraken tasks (via "kraken" /
    # "cave kraken" on kraken-cove).
    "taverley dungeon",     # → cerberus landmark (carries "taverley dungeon" alias)
    "kraken cove",          # → kraken-cove landmark
    # `taverley` city has its own landmark in src/data/locations.ts at the
    # same exact tile (2910, 3451). The wiki-scraped entity is redundant
    # AND was the *real* reason "Defeat Cerberus" / "Enter the Taverley
    # Dungeon" tasks couldn't reach the cerberus landmark — the entity
    # text-scan fires on the substring "Taverley" inside "Taverley
    # Dungeon" and pins the task to the city before landmark matching
    # ever runs. Skipping it lets the resolver fall through to the
    # cerberus landmark (which carries the "taverley dungeon" alias).
    "taverley",
    # `[[Evil twin|Postie Pete random event]]` — the Demonic Pacts wiki
    # task list pipes "Postie Pete random event" through the `Evil twin`
    # page, which has 32 spawn LocLines scattered across every region.
    # The resulting entity gets pinned in Karamja, Kandarin, and Asgarnia
    # (Rimmington) for the SINGLE Postie Pete task, which is total noise
    # — Postie Pete is a wandering random event that can fire anywhere
    # the player is, with no fixed task location. Skipping makes the
    # task fall through to "no pin, still in task list" (correct for
    # General-region random-event tasks with no actionable map position).
    "evil twin",
    # Lesser Wilderness boss pages all auto-resolve via {{LocLine}} to the
    # exact same tile as the corresponding hand-curated landmark in
    # src/data/locations.ts (Vet'ion = vetion 3219,3788, Callisto =
    # callisto 3291,3849, Venenatis = venenatis 3319,3798, Artio =
    # hunters-end 3116,3677, Chaos Elemental = chaos-ele 3261,3927).
    # Without skipping, the kill / CA tasks pin to the entity and the
    # equip-drop tasks pin to the landmark, producing two markers on the
    # same tile. Same Phantom-Muspah / Nex / Sire / GWD pattern — the
    # landmark already carries every drop-equip alias and stays. The
    # "X / Y / Z" landmarks intentionally bundle the upper- and lower-
    # tier alts (Vet'ion + Calvar'ion, Callisto + Artio, Venenatis +
    # Spindel) onto a single curated pin per lair; the entity-side
    # equivalents would re-fragment that grouping.
    "vet'ion", "calvar'ion",
    "callisto", "artio",
    "venenatis", "spindel",
    "chaos elemental",
    "scorpia",
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
    # Iorwerth Camp wiki Map is `{{Map|name=Iorwerth Camp|x=2198|y=3253|...}}`.
    # Locked here so SUPPLEMENTAL_SPAWNS for Bloodveld/Kurask/Nechryael
    # (Iorwerth Dungeon spawns) doesn't depend on the parser handling the
    # name= attribute correctly.
    "Iorwerth Camp": (2198, 3253),
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
# Supplemental per-region spawns — APPENDED, not replacing
# ---------------------------------------------------------------------------
# For entities whose wiki LocLines for a particular league region are ALL
# underground (mapID > 0, dropped by the surface-coord filter), we append a
# wiki-authoritative surface anchor here. Unlike CURATED_ENTITIES this does
# NOT replace the wiki-scraped data — it simply adds another (x, y) +
# spawnRegions entry so the runtime can emit a region-specific pin.
#
# Use SUPPLEMENTAL_SPAWNS when the entity already has good wiki data for
# OTHER regions and you only need to fix ONE region's missing surface
# anchor. Use CURATED_ENTITIES with `spawns` when you need to override
# every region the entity appears in.
#
# Each entry is keyed by the lowercased wiki title and lists one anchor
# per missing region:
#   "<entity title>": [
#       {"anchor": "<wiki page>", "region": "<canonical region>", "note": "<blurb>"},
#   ]
SUPPLEMENTAL_SPAWNS: dict[str, list[dict]] = {
    # Bloodveld: wiki LocLines for the Iorwerth Dungeon spawn (Mutated
    # Bloodveld, which counts as Bloodveld for slayer & league tasks)
    # are mapID > 0 and dropped. Surface anchor is the Iorwerth Camp
    # entrance to the dungeon (wiki Iorwerth_Camp page Map = 2198,3253).
    "bloodveld": [
        {"anchor": "Iorwerth Camp", "region": "Tirannwn", "note": "Iorwerth Dungeon"},
    ],
    # Kurask: wiki Kurask page lists the Iorwerth Dungeon LocLine with
    # leagueRegion = Tirannwn but mapID = -1, so the auto-scrape drops
    # it. Surface anchor is the same Iorwerth Camp entrance.
    "kurask": [
        {"anchor": "Iorwerth Camp", "region": "Tirannwn", "note": "Iorwerth Dungeon"},
    ],
    # Nechryael: wiki Greater_Nechryael page has the Iorwerth Dungeon
    # LocLine tagged Tirannwn (mapID = 34). Same Iorwerth Camp anchor.
    "nechryael": [
        {"anchor": "Iorwerth Camp", "region": "Tirannwn", "note": "Iorwerth Dungeon"},
    ],
    # Silver Stall: the Prifddinas Trahaearn-district market silver stall
    # is reachable inside the Tirannwn city. Anchor to Prifddinas (which
    # ANCHOR_COORD_OVERRIDES locks to the Tower of Voices walk-in).
    "silver stall": [
        {"anchor": "Prifddinas", "region": "Tirannwn", "note": "Prifddinas (Trahaearn)"},
    ],
    # Gem Stall: same Trahaearn market, same Prifddinas anchor.
    "gem stall": [
        {"anchor": "Prifddinas", "region": "Tirannwn", "note": "Prifddinas (Trahaearn)"},
    ],
    # Soft Clay: wiki Soft_clay page says verbatim "The only place to mine
    # soft clay directly is in the Trahaearn mine" (Prifddinas, Tirannwn).
    # The Trahaearn mine itself is mapID > 0 (instanced city interior at
    # 3290..3295, 12443..12452) so the auto-scrape drops it and the entity
    # ends up with only its Varlamore / Karamja non-clay surface spawns.
    # Without this supplement, "Mine 200 Soft Clay in Tirannwn" can't find
    # an entity-level Tirannwn pin and falls through to the lletya landmark
    # (~190 tiles SE of the actual mining spot). Anchor to Prifddinas (which
    # ANCHOR_COORD_OVERRIDES locks to the Tower of Voices walk-in).
    "soft clay": [
        {"anchor": "Prifddinas", "region": "Tirannwn", "note": "Trahaearn mine (Prifddinas)"},
    ],
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
    # Nex is intentionally NOT a curated entity — the `nex-lair`
    # landmark in src/data/locations.ts already carries the Nex aliases
    # AND every Nex drop the player goes there for (Torva pieces,
    # Zaryte crossbow / vambraces, ancient godswords, nihil shards). A
    # second curated entity at "God Wars Dungeon" was producing a pin
    # ~3 game tiles away from the landmark, splitting the 5 Nex-kill
    # tasks (which matched the entity via wikiLink) from the 5
    # equip / CA tasks (which matched the landmark via alias) onto
    # two visually-overlapping pins. Same pattern as Phantom Muspah /
    # Ghorrock and the DT2 bosses below — landmark wins.
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
    # Wilderness multi-boss lairs (Callisto/Artio, Venenatis/Spindel,
    # Vet'ion/Calvar'ion, Chaos Elemental) are intentionally NOT
    # curated entities — each has a corresponding "X / Y" landmark in
    # src/data/locations.ts that already carries both boss aliases AND
    # every drop the player goes there for (Voidwaker hilts / Tyrannical
    # & Treasonous & Ring of the Gods / Fangs of Venenatis / Skull of
    # Vet'ion / Claws of Callisto / Ursine Chainmace / Webweaver Bow /
    # Accursed Sceptre, etc.). Without dropping the entities, each lair
    # produced 2-3 visually overlapping pins (entity for the upper-tier
    # boss, entity for the Calvar'ion-tier "Singles+" alt, landmark for
    # the equip tasks) — same Phantom-Muspah / Nex / Sire pattern.
    # Scorpia was extra-broken: anchored to "Bone Yard" so its entity
    # pin landed at the Venenatis lair (3236, 3746) instead of the
    # actual Scorpion Pit at (3232, 3938). The landmark sits at the
    # right Scorpion Pit coord. Landmark wins.
    # Chaos Fanatic stays curated — it lives at the Chaos Temple Hut
    # northwest of Edgeville (~2979, 3846), nowhere near the Chaos
    # Elemental's Rogues' Castle, so it genuinely deserves its own pin.
    # Abyssal Sire / Nexus are intentionally NOT curated entities —
    # the `abyssal-nexus` landmark in src/data/locations.ts already
    # carries both aliases AND every Sire drop the player goes there
    # for (Abyssal Whip / Bludgeon / Dagger, Unsired, Font of
    # Consumption). Two pins were splitting the 5 Sire-kill tasks
    # (matched via wikiLink → entity) from the 3 equip tasks (matched
    # via landmark alias). Same pattern as Phantom Muspah / Nex —
    # landmark wins. The landmark itself is region-tagged "General"
    # to honor the wiki's own LocLine `leagueRegion = General` for the
    # Sire (the Abyss is reachable via Mage of Zamorak teleport
    # without any region unlock); without that, kill tasks were
    # showing up with a Wilderness badge in the popup despite being
    # General-region in the task list.
    # Cerberus is intentionally NOT a curated entity — the `cerberus`
    # landmark in src/data/locations.ts already carries both the boss
    # alias (so "Defeat Cerberus" still resolves) AND the boot drops
    # (Primordial / Pegasian / Eternal Boots + crystals). Two pins were
    # splitting the 5 kill / CA / boots-set tasks (matched via wikiLink →
    # entity at Taverley Dungeon ladder 2884,3398) from the 1 generic
    # boots-equip task (matched via landmark alias at Taverley Slayer
    # Cave 2874,3426). Same Phantom-Muspah / Nex / Sire pattern —
    # landmark wins. Listed in SKIP_TITLES above to keep wiki re-scrapes
    # from re-creating the entity from the Cerberus wiki page.
    "alchemical hydra":          {"anchor": "Mount Karuulm",          "category": "boss"},
    # Wiki distinguishes [[Smoke Dungeon]] (Desert, DT1-era dust devils at
    # 3310,2962) from [[Smoke Devil Dungeon]] (Kandarin, the thermonuclear's
    # actual home south-east of Castle Wars at 2412,3061). The Thermonuclear
    # smoke devil's own infobox tags it `leagueRegion = Kandarin`, so the
    # anchor MUST be the Kandarin "Smoke Devil Dungeon".
    "thermonuclear smoke devil": {"anchor": "Smoke Devil Dungeon",    "category": "boss"},
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
    # Phantom Muspah is intentionally NOT a curated entity — the
    # `ghorrock-dungeon` landmark in src/data/locations.ts already
    # carries the Muspah aliases AND every drop the player goes there
    # for (Ancient Sceptre, Ice Ancient Sceptre, Ancient Essence). A
    # second curated entity would split those tasks across two pins
    # ~75 game tiles apart in the same region. The landmark is at the
    # actual dungeon entrance (2977, 3896) and tagged Fremennik, which
    # matches the wiki's `leagueRegion = fremennik` for the Muspah.

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
    # Wintertodt is intentionally NOT a curated entity — the `wintertodt`
    # landmark already carries both the boss alias AND the Frozen Cache /
    # Pyromancer outfit drops. Listed in SKIP_TITLES above. Same
    # landmark-wins dedup as Cerberus / ToB / Kraken.

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
    # Theatre of Blood is intentionally NOT a curated entity — the
    # `theatre-of-blood` landmark in src/data/locations.ts already carries
    # both "theatre of blood" / "tob" / "ver sinhaza" aliases AND every
    # ToB drop the player goes there for (Scythe of Vitur, Ghrazi
    # Rapier, Avernic Defender, Justiciar set pieces, Sanguine dust, ToB
    # ornament kit). Two pins were splitting the 4 kill / ornament / CA
    # tasks (matched via wikiLink → entity at 3663,3219) from the 5
    # equip-set tasks (matched via landmark alias at 3671,3224 — the
    # actual Ver Sinhaza entrance). Listed in SKIP_TITLES above. Same
    # landmark-wins dedup as CoX/ToA stay curated because their entity
    # coords already happen to exactly match the landmark.

    # ───── TzHaar ─────
    "tzhaar-ket-rak":              {"anchor": "Mor Ul Rek", "category": "monster"},
    "tzhaar-ket-rak's challenges": {"anchor": "Mor Ul Rek", "category": "boss"},

    # ───── Activities tied to a location ─────
    "forestry":                  {"anchor": "Draynor Village",         "category": "activity"},
    "motherlode mine":           {"anchor": "Falador",                 "category": "activity"},
    # Blast Furnace is in Keldagrim (Fremennik). White Wolf Mountain
    # resolved to the Asgarnia side and was mis-tagging the activity.
    "blast furnace":             {"anchor": "Keldagrim",              "category": "activity",
                                  "leagueRegion": "Fremennik"},
    "giants' foundry":           {"anchor": "Giants' Foundry",         "category": "activity"},
    "nightmare zone":            {"anchor": "Nightmare Zone",          "category": "activity"},
    "volcanic mine":             {"anchor": "Volcanic Mine",           "category": "activity"},

    # ───── Combat monsters with underground-only wiki coords (per-region) ─────
    # Blue dragon's wiki page tags `leagueRegion = Kandarin` (its primary
    # surface spawn is Ardougne Zoo / Heroes' Guild basement). The
    # entity-level fallback was inheriting Asgarnia from the first spawn.
    "blue dragon":               {"spawns": [
        {"anchor": "Taverley Dungeon",     "region_hint": "Asgarnia"},
        {"anchor": "Ardougne Zoo",         "region_hint": "Kandarin"},
        {"anchor": "Heroes' Guild",        "region_hint": "Asgarnia"},
    ], "category": "monster", "leagueRegion": "Kandarin"},
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
    ], "category": "monster", "leagueRegion": "Kandarin"},
    # Black demon's wiki page tags `leagueRegion = Karamja` (its main
    # surface presence is Brimhaven Dungeon). The Edgeville Dungeon
    # spawn is tagged `Misthalin` on the wiki, not Wilderness — locked
    # in Demonic Pacts and dropped at runtime, but the hint should
    # still match the wiki for accuracy.
    "black demon":               {"spawns": [
        {"anchor": "Taverley Dungeon",     "region_hint": "Asgarnia"},
        {"anchor": "Brimhaven Dungeon",    "region_hint": "Karamja"},
        {"anchor": "Edgeville Dungeon",    "region_hint": "Misthalin"},
        {"anchor": "Chaos Druid Tower",    "region_hint": "Kandarin"},
    ], "category": "monster", "leagueRegion": "Karamja"},
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
    # Fire giant's wiki page tags `leagueRegion = Karamja` (Brimhaven
    # Dungeon is the canonical fire-giant slayer site).
    "fire giant":                {"spawns": [
        {"anchor": "Waterfall Dungeon",    "region_hint": "Kandarin"},
        {"anchor": "Deep Wilderness Dungeon", "region_hint": "Wilderness"},
        {"anchor": "Mount Karuulm",  "region_hint": "Kourend"},
    ], "category": "monster", "leagueRegion": "Karamja"},
    "drake":                           {"anchor": "Mount Karuulm",              "category": "monster"},
    "hydra":                           {"anchor": "Mount Karuulm",              "category": "monster"},
    # Dark beasts live in the Iorwerth Dungeon (Tirannwn). The dungeon's
    # surface entry point is the Iorwerth Camp at (2198, 3253) — same
    # anchor used for Bloodveld/Kurask/Nechryael spawns inside the same
    # dungeon, so all five Iorwerth Dungeon slayer pins cluster correctly.
    # Lletya was the previous anchor; it sits in Isafdar but is *not*
    # the dungeon entrance (Lletya = (2338, 3171) ≈ 140 tiles east).
    "dark beast":                      {"anchor": "Iorwerth Camp",              "category": "monster",
                                        "leagueRegion": "Tirannwn"},
    # Same story for the Iorwerth Dungeon moss giants — wiki page
    # `Moss giant (Iorwerth Dungeon)` (linked from Iorwerth_Dungeon
    # gallery) is the only fightable Tirannwn moss giant.
    "moss giant (iorwerth dungeon)":   {"anchor": "Iorwerth Camp",              "category": "monster",
                                        "leagueRegion": "Tirannwn"},
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
    "jubster":                         {"anchor": "Tower of Life",              "category": "monster",
                                        "leagueRegion": "Kandarin"},
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
    # Canifis werewolves' wiki LocLines lack `leagueRegion`, so the
    # entity-level fallback wasn't being set. Force Morytania to match
    # how the wiki itself classifies the Canifis werewolf tasks.
    "werewolf":                        {"anchor": "Canifis",                    "category": "monster",
                                        "leagueRegion": "Morytania"},
    "snail":                           {"anchor": "Mort Myre Swamp",            "category": "monster"},
    "fiyr shade":                      {"anchor": "Shades of Mort'ton",         "category": "monster",
                                        "leagueRegion": "Morytania"},
    "urium shade":                     {"anchor": "Shades of Mort'ton",         "category": "monster",
                                        "leagueRegion": "Morytania"},
    "sarachnis":                       {"anchor": "Forthos Dungeon",            "category": "boss"},
    # Yama's Domain is accessed from the Chasm of Fire (Kourend, surface
    # entry at 1435, 3668). Slepe was a copy-paste from the Nightmare
    # entries above and put the pin in Morytania.
    "yama":                            {"anchor": "Chasm of Fire",              "category": "boss"},
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
    # Royal Titans wiki page: "The Royal Titans can be accessed in the
    # Asgarnian Ice Dungeon (fairy ring code AIQ)." Previous "Burthorpe"
    # anchor was both physically wrong (Burthorpe is ~400 tiles north of
    # the actual access point) AND broken — the Burthorpe wiki page now
    # renders its Map as {{Map|mtype=polygon|2811:3582,2939:3582,...}}
    # which the coord parser doesn't handle, so the curated entity was
    # silently dropped on the last scrape ("skipped 1 (unresolvable)").
    # Asgarnian_Ice_Dungeon Map = {{Map|x:3008,y:3150|mapID=0|...}},
    # leagueRegion = Asgarnia. That's the correct surface tile players
    # actually walk to (the trapdoor south of Falador).
    "royal titans":                    {"anchor": "Asgarnian Ice Dungeon",      "category": "boss",
                                        "leagueRegion": "Asgarnia"},

    # ───── Other high-value overrides ─────
    "shooting stars":             {"anchor": "Falador",                "category": "activity"},
    # Shooting Stars wiki page tags `leagueRegion = General` (cross-region
    # event). Falador anchor was inheriting Asgarnia.
    "shooting star":              {"anchor": "Falador",                "category": "activity",
                                   "leagueRegion": "General"},
    "shades of mort'ton":         {"anchor": "Shades of Mort'ton",     "category": "minigame"},
    "pyramid plunder":             {"anchor": "Pyramid Plunder",       "category": "minigame"},
    "mahogany homes":              {"anchor": "Mahogany Homes",        "category": "activity"},
    "tithe farm":                  {"anchor": "Tithe Farm",            "category": "minigame"},
    "aerial fishing":              {"anchor": "Lovakengj",             "category": "minigame"},
    "trouble brewing":             {"anchor": "Trouble Brewing",       "category": "minigame"},
    "hallowed sepulchre":          {"anchor": "Hallowed Sepulchre",    "category": "minigame"},
    # Wiki [[Guardians of the Rift]] infobox tags the minigame `leagueRegion = Desert`
    # despite the surface entrance being in Arceuus (Kourend). Per the rule
    # "follow the wiki, period", we override the anchor's inherited LR so the
    # pin's badge is Desert (matching the wiki's own classification of the activity).
    "guardians of the rift":       {"anchor": "Arceuus",               "category": "minigame",
                                    "leagueRegion": "Desert"},
    "barbarian assault":           {"anchor": "Barbarian Outpost",     "category": "minigame"},
    # Blast Furnace's wiki Map is `{{Map|2930,10197|mapID=10|...}}` — the
    # actual minigame floor inside Keldagrim, mapID > 0, dropped by the
    # surface-pin filter. Wiki page tags `leagueRegion = Fremennik` and
    # `location = Keldagrim`. Surface entry is the Keldagrim entrance cave
    # east of Rellekka (ANCHOR_COORD_OVERRIDES["Keldagrim entrance"] →
    # 2744, 3719), which is also where the Fremennik Mountain Troll, the
    # `keldagrim` landmark, and the fairy-ring DKS pin all sit. Without
    # this curated entry, every "Blast Furnace" task ("Smelt 100 X bars")
    # was text-scanning into the closest `furnace` entity — the Rellekka
    # furnace at (2617, 3667) — because the description literal "Blast
    # Furnace" survived the alias word-boundary check on "furnace".
    "blast furnace":               {"anchor": "Keldagrim entrance",    "category": "minigame",
                                    "leagueRegion": "Fremennik"},
    "mage training arena":         {"anchor": "Mage Training Arena",   "category": "minigame"},
    "barrows":                     {"anchor": "Barrows",               "category": "minigame"},
    "vale totems":                 {"anchor": "Auburnvale",            "category": "minigame"},
    "hunter rumours":              {"anchor": "Hunter Guild",          "category": "activity"},
    "mastering mixology":          {"anchor": "Aldarin",               "category": "minigame"},
    "hespori":                     {"anchor": "Farming Guild",         "category": "boss"},
    "slayer tower":                {"anchor": "Canifis",               "category": "dungeon"},
    # "god wars dungeon" is intentionally NOT a curated entity — it's
    # explicitly listed in SKIP_TITLES above ("we have gwd landmark").
    # Having it both as a SKIP and as a curated entity was the bug:
    # the curated copy produced an `entity:god wars dungeon` pin at
    # (2918, 3745) that visually competed with the `nex-lair` landmark
    # at (2915, 3745) — same physical entrance, two pins. Worse, all
    # the "Defeat Nex" tasks (wikiLinks: ["Nex","God Wars Dungeon"])
    # resolved to the GWD entity instead of the Nex landmark, and the
    # two "Wilderness God Wars Dungeon" tasks (168 / 652) text-scanned
    # into the *Asgarnia* GWD entity even though they belong in the
    # `wilderness-god-wars-dungeon` landmark. Generic GWD tasks
    # ("Defeat Any God Wars Dungeon Boss N Times") now match the
    # "god wars dungeon" alias on `nex-lair`.
    "waterbirth island dungeon":   {"anchor": "Waterbirth Island",     "category": "dungeon"},
    # Kraken / Kraken Cove are intentionally NOT curated entities — the
    # `kraken-cove` landmark already carries "kraken" / "cave kraken" /
    # "kraken cove" aliases AND every drop player goes there for
    # (Trident of the Seas, Kraken tentacle → Abyssal tentacle). Both
    # entity slugs (`kraken` and `kraken cove`) used to render at
    # essentially the same tile (~6 apart from the landmark), so leaving
    # either one in produced a visible double pin. Both listed in
    # SKIP_TITLES above. Same Phantom-Muspah / Nex / Sire dedup.
    # See note on "thermonuclear smoke devil" — the Smoke Devil Dungeon entity
    # is the Kandarin one (south-east of Castle Wars), not the Desert "Smoke
    # Dungeon" from DT1.
    "smoke devil dungeon":         {"anchor": "Smoke Devil Dungeon",   "category": "dungeon"},
    "lunar isle":                  {"anchor": "Lunar Isle",            "category": "city"},
    "ape atoll":                   {"anchor": "Ape Atoll",             "category": "city"},
    "piscatoris":                  {"anchor": "Piscatoris",            "category": "landmark"},
    "fight caves":                 {"anchor": "Mor Ul Rek",            "category": "minigame"},
    "the inferno":                 {"anchor": "Mor Ul Rek",            "category": "minigame"},
    "inferno":                     {"anchor": "Mor Ul Rek",            "category": "minigame"},

    # ───── Off-map / instanced leftovers ─────
    # Baby impling wiki LocLines all tag `leagueRegion = General`
    # (impetuous impulses spawns are cross-region). Draynor Village
    # anchor inherits Misthalin which is locked in Demonic Pacts and
    # would hide the entity entirely.
    "baby impling":                {"anchor": "Draynor Village",       "category": "monster",
                                    "leagueRegion": "General"},
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

# Canonical Demonic Pacts league regions. Used to validate every value the
# wiki scraper extracts from `leagueRegion=` parameters, `{{LeagueRegion|X}}`
# table flags, and curated overrides — so junk like "N" (truncated from
# "N/A"), "No" (literal sentinel value some wiki pages use to mean "not in
# any league area"), or stray free-text gets dropped instead of leaking
# into spawnRegions / leagueRegion fields and rendering as gibberish badges.
# "General" is included even though it isn't a player-locked region in the
# league — the wiki uses `leagueRegion = General` to mean "reachable from
# anywhere", which is a meaningful runtime signal we want to keep.
_VALID_LEAGUE_REGIONS = {
    "asgarnia", "desert", "fremennik", "karamja", "tirannwn",
    "wilderness", "varlamore", "kandarin", "kebos", "kourend",
    "morytania", "misthalin", "general",
}
# Sentinel values the wiki uses to mean "explicitly not in any league
# region" (Sailing / post-launch / dream-world content). Treated as None
# so we don't accidentally inherit them as a real region tag.
_LEAGUE_REGION_SENTINELS = {"n/a", "na", "n", "no", "none", "null", ""}


def _normalize_league_region(value: str | None) -> str | None:
    """Return a Title-Cased league region or None.

    Filters out empty / sentinel / unknown values so downstream code can
    trust that every non-None league region matches one of the canonical
    Demonic Pacts area names. Multi-region values (`Kandarin&Kourend` from
    Brimstone-key tertiary tables) collapse to None — we never want to
    invent a single-area pin from a compound conditional drop tag.
    """
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered in _LEAGUE_REGION_SENTINELS:
        return None
    if any(sep in cleaned for sep in (",", "&", "/", "|")):
        return None
    if lowered not in _VALID_LEAGUE_REGIONS:
        return None
    return lowered.title()

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

# Wikitable row delimiters and the leading wikilink in a row's first
# cell. Together these let us trace any Map template back to the
# location it represents (e.g. "Falador") on older-format Locations
# tables that pre-date the leagues-global-flag column. The runtime
# then resolves that location string against the entities dict to
# inherit a wiki-grounded leagueRegion — same data path as a
# `{{LeagueRegion|X}}` tag, just sourced from the row's location
# wikilink instead of a sibling cell.
_TABLE_ROW_DELIM_RE = re.compile(r"\n\|-")
_TABLE_ROW_LOCATION_LINK_RE = re.compile(
    r"\|\s*\[\[([^\]\|\n]+?)(?:\|[^\]\n]+)?\]\]"
)

# Detects a {{Map}} template whose preceding `leagues-global-flag` table
# cell carries a `{{LeagueRegion|X}}` tag. Wikitable-style "Locations"
# sections (Furnace, Anvil, Fairy rings, Port master, …) follow this
# layout for every row:
#   |class="leagues-global-flag"|{{LeagueRegion|Kandarin}}
#   |{{Map|type=maplink|mtype=pin|x=2342|y=3678|zoom=3}}
# Without pairing the two, the per-row leagueRegion is invisible to
# `parse_coords` (which only reads `leagueRegion=` parameters that live
# *inside* the Map/LocLine template body), and every Map coord ends up
# falling through to bbox classification — which mis-tags Piscatoris's
# furnace as "Fremennik", Edgeville's anvil as "Wilderness", etc.
# Pair-up is keyed on the {{Map}} template's start offset so we can
# attach the region downstream without re-walking the wikitext.
_LEAGUE_FLAG_THEN_MAP_RE = re.compile(
    r'class="leagues-global-flag"\|\s*\{\{LeagueRegion\|([A-Za-z][A-Za-z\' ]*)\}\}\s*\n[ \t]*\|\s*(\{\{Map\b[^{}]*?(?:\{\{[^{}]*\}\}[^{}]*?)*\}\})',
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

    # Pre-scan: build a `{{Map}} start offset → leagueRegion` map for
    # every wikitable row that pairs a `{{LeagueRegion|X}}` cell with a
    # following `{{Map|...}}` cell. The downstream attachment keeps the
    # per-row tag flowing through to spawnRegions even though the Map
    # template itself has no `leagueRegion=` parameter.
    flagged_template_regions: dict[int, str] = {}
    for tm in _LEAGUE_FLAG_THEN_MAP_RE.finditer(wt):
        flagged_template_regions[tm.start(2)] = tm.group(1).strip()

    # Pre-scan: build a `{{Map}} start offset → row location title` map
    # for older-format Locations tables that lack the leagues-global-
    # flag column. The location title is the FIRST wikilink in the
    # current table row (counted backward from the template to the
    # nearest `|-` delimiter). Resolved to a leagueRegion in a second
    # pass once all entities have been parsed — see
    # `apply_row_location_regions` below.
    row_delim_offsets = [m.end() for m in _TABLE_ROW_DELIM_RE.finditer(wt)]
    row_delim_offsets.insert(0, 0)

    def _row_location_for(template_start: int) -> str | None:
        last_delim = 0
        for off in row_delim_offsets:
            if off <= template_start:
                last_delim = off
            else:
                break
        row_segment = wt[last_delim:template_start]
        m = _TABLE_ROW_LOCATION_LINK_RE.search(row_segment)
        return m.group(1).strip() if m else None

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
        flagged_region: str | None = flagged_template_regions.get(m.start())
        row_location: str | None = (
            _row_location_for(m.start()) if kind == "map" else None
        )
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
                    # Stash raw value so the downstream "explicitly outside
                    # any league region" filter (`is_surface_pin` N/A check)
                    # still sees sentinels like "N/A" / "No"; normalization
                    # only happens when we actually need to *use* the value
                    # as a region tag.
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
        # Resolution priority for this template's effective region:
        #   1. Empty `leagues-global-flag` row    → forced "N/A"
        #      (drops Sailing / post-launch coords).
        #   2. Inline `leagueRegion=` parameter   → highest signal,
        #      author wrote it directly on the template.
        #   3. Adjacent `{{LeagueRegion|X}}` cell → wikitable row tag,
        #      paired by `_LEAGUE_FLAG_THEN_MAP_RE`. This is what
        #      rescues every multi-location wikitable (Furnace, Anvil,
        #      Fairy rings, Port master, …) from bbox-guessing.
        if is_empty_flag_tainted:
            effective_league_region = "N/A"
        elif league_region:
            effective_league_region = league_region
        else:
            effective_league_region = flagged_region
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
                # Carry the row's location wikilink so the post-pass
                # can resolve a leagueRegion for old-format tables.
                "rowLocation": row_location,
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
    return _normalize_league_region(m.group(1))


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
        # Keep per-spawn `leagueRegion` parallel to allSpawns so the runtime
        # can prefer the wiki's own per-LocLine region tag over the bbox
        # geometry guess. e.g. Kraken Cove's wiki LocLine sits at y=3611 —
        # outside the runtime Kandarin bbox (ymax=3580) — but the wiki tags
        # the page `leagueRegion = Kandarin`. Storing that tag here lets
        # the runtime trust the wiki instead of bbox-misclassifying the
        # spawn into Fremennik.
        all_surface_with_lr = [
            (c["x"], c["y"], c.get("leagueRegion"), c.get("rowLocation"))
            for c in coords if is_surface_pin(c)
        ]
        # de-dupe preserving order; on duplicate (x, y) the first
        # leagueRegion wins (LocLines list more specific entries first).
        seen_xy: set[tuple[int, int]] = set()
        all_spawns: list[list[int]] = []
        spawn_regions: list[str | None] = []
        spawn_row_locations: list[str | None] = []
        for (sx, sy, slr, srow) in all_surface_with_lr:
            if (sx, sy) in seen_xy:
                continue
            seen_xy.add((sx, sy))
            all_spawns.append([sx, sy])
            # Normalize so junk values that survived `is_surface_pin`'s
            # N/A/MISTHALIN gate (e.g. "N" truncated by the legacy regex,
            # "No" literal sentinel on Nightmare Zone, multi-region
            # compound tags from Brimstone-key tertiary tables) drop to
            # None instead of leaking into spawnRegions as gibberish.
            spawn_regions.append(_normalize_league_region(slr))
            spawn_row_locations.append(srow)
        entry = {
            "title": title,
            "resolvedTitle": resolved,
            "x": pick["x"],
            "y": pick["y"],
            "source": pick["kind"],
            "allSpawns": all_spawns,
            "category": infer_category(wt),
            "leagueRegion": extract_league_region(wt),
        }
        # Only emit `spawnRegions` when at least one spawn was tagged on
        # the wiki — keeps the JSON small for the long tail of entities
        # whose LocLines never use the leagueRegion parameter.
        if any(r is not None for r in spawn_regions):
            entry["spawnRegions"] = spawn_regions
        # Stash row-location strings transiently for the post-pass.
        # Stripped from the final JSON before emission.
        if any(loc is not None for loc in spawn_row_locations):
            entry["__spawnRowLocations"] = spawn_row_locations
        entities[title.lower()] = entry
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
    # Per-anchor `leagueRegion` from the anchor page's infobox. Used so
    # multi-anchor curated entities (e.g. Mountain Troll → Burthorpe +
    # Keldagrim entrance) get the right wiki-sourced region per spawn
    # instead of inheriting the entity-level leagueRegion or guessing
    # via bbox.
    anchor_league_region: dict[str, str | None] = {}
    unresolved_anchors: list[str] = []
    for anchor in anchor_list:
        resolved = resolved_map.get(anchor, anchor)
        wt = wt_by_title.get(resolved)
        if not wt:
            unresolved_anchors.append(anchor)
            continue
        coords = parse_coords(wt)
        anchor_all_coords[anchor] = coords
        anchor_league_region[anchor] = extract_league_region(wt)
        pick = pick_surface_coord(coords)
        if not pick:
            unresolved_anchors.append(anchor)
            continue
        anchor_coord[anchor] = (pick["x"], pick["y"])

    def resolve_anchor_coord(
        anchor: str, location_match: str | None,
    ) -> tuple[tuple[int, int], str | None] | None:
        """Return ((x, y), per-spawn leagueRegion) for an anchor.

        The second tuple element is the wiki's own per-LocLine
        `leagueRegion=` value — when the curated entry uses
        `location_match`, this comes from the matching LocLine and
        OVERRIDES the anchor page's infobox-level `leagueRegion`. For
        Brine Rat → Windswept tree, the Windswept tree page is tagged
        Misthalin overall, but its Brine Rat Cavern LocLine is tagged
        Fremennik — and Fremennik is what we want for the brine rat pin.
        Returns None for the leagueRegion slot when neither the LocLine
        nor an override carries one; downstream falls back to the
        anchor-page level via `anchor_league_region`.

        Order of resolution:
          1. ANCHOR_COORD_OVERRIDES (hand-curated surface coord — used
             when the wiki page only has an instanced/underground
             {{Map}}). Carries no per-LocLine region.
          2. Wiki-scraped coords filtered by `location_match`
             (sub-region) — uses that LocLine's leagueRegion.
          3. Wiki-scraped default coord for the anchor — no per-LocLine
             region.
        """
        if anchor in ANCHOR_COORD_OVERRIDES and not location_match:
            return (ANCHOR_COORD_OVERRIDES[anchor], None)
        if not location_match:
            xy = anchor_coord.get(anchor)
            return (xy, None) if xy else None
        coords = anchor_all_coords.get(anchor)
        if not coords:
            return None
        needle = location_match.lower()
        filtered = [c for c in coords if needle in c.get("location", "")]
        pick = pick_surface_coord(filtered)
        if not pick:
            return None
        return ((pick["x"], pick["y"]), _normalize_league_region(pick.get("leagueRegion")))

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
                hit = resolve_anchor_coord(s["anchor"], s.get("location_match"))
                if hit:
                    (xy, locline_lr) = hit
                    # Per-spawn note is JUST the anchor name (e.g. "Burthorpe",
                    # "Trollheim"). The "(region)" suffix is redundant — the
                    # popup already renders a region badge above the blurb,
                    # and worse: when the runtime split this into per-region
                    # locations it would render "Burthorpe (Asgarnia)" on the
                    # Fremennik Trollheim pin if the suffix was retained AND
                    # the entity-level note leaked.
                    # Per-spawn leagueRegion priority: matched LocLine wins
                    # (Brine Rat in Windswept tree's "Brine Rat Cavern"
                    # row → Fremennik), else fall back to the anchor's
                    # infobox-level region (which usually agrees but
                    # disagrees on multi-location pages).
                    # `region_hint` on a multi-anchor curated spawn is the
                    # hand-authored wiki-sourced region for THAT specific
                    # anchor (e.g. Black Dragon's Mynydd spawn → Tirannwn).
                    # It wins over the anchor page's own leagueRegion so a
                    # multi-spawn entity gets correct per-region pins even
                    # when the anchor page (Taverley Dungeon) has its own
                    # generic region tag.
                    resolved_spawns.append({
                        "x": xy[0], "y": xy[1],
                        "note": s["anchor"],
                        "leagueRegion": (
                            s.get("region_hint")
                            or locline_lr
                            or anchor_league_region.get(s["anchor"])
                        ),
                    })
        else:
            hit = resolve_anchor_coord(override["anchor"], override.get("location_match"))
            if hit:
                (xy, locline_lr) = hit
                resolved_spawns = [{
                    "x": xy[0], "y": xy[1],
                    "note": override["anchor"],
                    "leagueRegion": locline_lr or anchor_league_region.get(override["anchor"]),
                }]
            else:
                resolved_spawns = []
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
        spawn_regions: list[str | None] = []
        for s in resolved_spawns:
            xy = (s["x"], s["y"])
            if xy in seen_xy:
                continue
            seen_xy.add(xy)
            all_spawns.append([xy[0], xy[1]])
            spawn_notes.append(s.get("note") or None)
            spawn_regions.append(s.get("leagueRegion"))
        # For single-anchor curated entries the entity-level leagueRegion
        # already covers the lone spawn; for multi-anchor curated entries
        # (Mountain Troll → Burthorpe + Keldagrim entrance) each anchor
        # has its own leagueRegion, so we want the per-spawn array to
        # carry that distinction. Inherit from the existing wiki entry
        # if present (e.g. Kraken Cove → "Kandarin"), otherwise fall back
        # to the FIRST anchor's leagueRegion. The latter rescues cases
        # like the curated "kraken" boss entity, whose wiki page
        # (Kraken) has no `leagueRegion` field but whose Kraken Cove
        # anchor does — without this, the runtime would fall through to
        # bbox-guess and put the Kraken in Fremennik.
        # An explicit `leagueRegion` on the curated entry takes top
        # priority (e.g. Abyssal Sire → "General"): it overrides both
        # the entity-level region AND every per-spawn region, since
        # the wiki's own LocLine for that entity uses that tag.
        forced_lr = override.get("leagueRegion")
        is_multi_spawn = "spawns" in override
        if forced_lr:
            entity_lr = forced_lr
            # For SINGLE-anchor curated entries we force the spawn region
            # too (e.g. Abyssal Sire → "General" on its lone Abyss
            # spawn). For MULTI-anchor entries we MUST NOT clobber per-
            # spawn regions — each spawn carries its own correct region
            # via `region_hint` and the entity-level forced_lr is just
            # the page-wide fallback badge.
            if not is_multi_spawn:
                spawn_regions = [forced_lr] * len(spawn_regions)
        else:
            entity_lr = existing["leagueRegion"] if existing else None
            if not entity_lr:
                for s in resolved_spawns:
                    if s.get("leagueRegion"):
                        entity_lr = s["leagueRegion"]
                        break
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
            **({"spawnRegions": spawn_regions} if any(spawn_regions) else {}),
            "category": override.get("category") or (existing and existing.get("category")) or "landmark",
            "leagueRegion": entity_lr,
            "note": first.get("note", ""),
        }
        if existing:
            curated_applied += 1
        else:
            curated_added += 1
    print(f"\nCurated overrides: replaced {curated_applied}, added {curated_added} new entities, skipped {curated_skipped} (unresolvable).")

    # -------------------------------------------------------------------
    # Apply SUPPLEMENTAL_SPAWNS — append additional region anchors to
    # existing entities WITHOUT replacing their wiki-scraped data. Used
    # for entities whose wiki LocLines for a particular league region
    # are all underground (mapID > 0, dropped by the surface-coord filter)
    # so the auto-scrape leaves no candidate for "in <region>" tasks.
    # Unlike CURATED_ENTITIES with `spawns`, this preserves every other
    # region's existing pin coord. See patch-tirannwn-spawns.mjs for the
    # equivalent JSON-only patcher used outside the scrape pipeline.
    # -------------------------------------------------------------------
    supplemental_applied = 0
    for key, supplements in SUPPLEMENTAL_SPAWNS.items():
        ent = entities.get(key)
        if not ent:
            print(f"  WARN SUPPLEMENTAL_SPAWNS: no entity '{key}' to supplement; skipping")
            continue
        all_spawns = ent.setdefault("allSpawns", [])
        spawn_regions = ent.setdefault("spawnRegions", [None] * len(all_spawns))
        spawn_notes = ent.setdefault("spawnNotes", [None] * len(all_spawns))
        # Pad parallel arrays if upstream populated only some.
        while len(spawn_regions) < len(all_spawns):
            spawn_regions.append(None)
        while len(spawn_notes) < len(all_spawns):
            spawn_notes.append(None)
        for sup in supplements:
            region = sup["region"]
            if any((r or "").lower() == region.lower() for r in spawn_regions):
                continue  # already has a spawn in this region
            xy = ANCHOR_COORD_OVERRIDES.get(sup["anchor"]) or anchor_coord.get(sup["anchor"])
            if not xy:
                print(f"  WARN SUPPLEMENTAL_SPAWNS: anchor '{sup['anchor']}' unresolved for {key}; skipping")
                continue
            all_spawns.append([xy[0], xy[1]])
            spawn_regions.append(region)
            spawn_notes.append(sup.get("note") or sup["anchor"])
            supplemental_applied += 1
    print(f"Supplemental spawns applied: {supplemental_applied}")

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

    # -------------------------------------------------------------------
    # Post-pass: derive `spawnRegions[i]` for spawns that lacked a wiki
    # tag by looking up the row's location wikilink against the entities
    # we just built. Powers older-format Locations tables (Anvil, Fairy
    # rings, Port master, etc.) which list each row as `|[[Falador]]`
    # without the modern `{{LeagueRegion|X}}` cell. The lookup chain is
    # ENTIRELY wiki-sourced — we never fabricate a region — so a missing
    # location entry simply leaves the spawn untagged and falls through
    # to bbox in the runtime, same as before.
    # -------------------------------------------------------------------
    region_lookup: dict[str, str] = {}
    # Seed with self-named region pages: a wikilink named "Wilderness"
    # in a Locations row obviously IS the Wilderness region. Without
    # this seed the Wilderness wiki page itself contributes no
    # leagueRegion (no infobox) and the lookup falls through.
    for canonical_region in (
        "Misthalin", "Asgarnia", "Karamja", "Kandarin", "Fremennik",
        "Tirannwn", "Wilderness", "Morytania", "Kourend", "Varlamore",
        "Desert", "General",
    ):
        region_lookup[canonical_region.lower()] = canonical_region
    for key, ent in entities.items():
        lr = ent.get("leagueRegion")
        if lr:
            region_lookup[key] = lr
            resolved = (ent.get("resolvedTitle") or "").lower()
            if resolved and resolved not in region_lookup:
                region_lookup[resolved] = lr

    # First-resolve pass: fill from existing entities.
    def _resolve_row_locations() -> tuple[int, dict[str, int]]:
        filled = 0
        unresolved: dict[str, int] = {}
        for ent in entities.values():
            row_locs = ent.get("__spawnRowLocations")
            if not row_locs:
                continue
            spawn_regions = ent.get("spawnRegions") or [None] * len(row_locs)
            if len(spawn_regions) != len(row_locs):
                continue
            changed = False
            for i, loc in enumerate(row_locs):
                if spawn_regions[i] is not None or not loc:
                    continue
                lr = region_lookup.get(loc.lower())
                if lr:
                    spawn_regions[i] = lr
                    changed = True
                    filled += 1
                else:
                    unresolved[loc] = unresolved.get(loc, 0) + 1
            if changed and any(r is not None for r in spawn_regions):
                ent["spawnRegions"] = spawn_regions
        return filled, unresolved

    rowloc_filled, rowloc_unresolved = _resolve_row_locations()
    print(f"Row-location pass 1: filled {rowloc_filled} per-spawn regions from existing entities")

    # Second-resolve pass: fetch the wiki pages for any row-location
    # names we couldn't resolve from the entities dict (these are canon
    # location pages that aren't task-referenced themselves — Lovakengj,
    # Hemenster, Outer Fortis, …). Extract their infobox leagueRegion
    # and re-run the resolver. This closes the long tail without
    # introducing any guesswork.
    if rowloc_unresolved:
        unresolved_titles = sorted(
            t for t in rowloc_unresolved
            if t.lower() not in region_lookup and not should_skip(t)
        )
        print(f"  Fetching {len(unresolved_titles)} additional location pages...")
        loc_wt: dict[str, str] = {}
        loc_resolved_map: dict[str, str] = {}
        for i in range(0, len(unresolved_titles), BATCH_SIZE):
            batch = unresolved_titles[i:i + BATCH_SIZE]
            try:
                wt_by_resolved, orig_to_res, _missing = fetch_batch(batch)
            except Exception as e:
                print(f"    batch failed: {e}")
                continue
            loc_wt.update(wt_by_resolved)
            loc_resolved_map.update(orig_to_res)
            time.sleep(0.3)
        added = 0
        for orig in unresolved_titles:
            resolved = loc_resolved_map.get(orig, orig)
            wt = loc_wt.get(resolved)
            if not wt:
                continue
            lr = extract_league_region(wt)
            if lr:
                region_lookup[orig.lower()] = lr
                region_lookup[resolved.lower()] = lr
                added += 1
        print(f"  Recovered {added} additional location → region mappings")
        rowloc_filled2, rowloc_unresolved = _resolve_row_locations()
        print(f"Row-location pass 2: filled {rowloc_filled2} more per-spawn regions")

    if rowloc_unresolved:
        top = sorted(rowloc_unresolved.items(), key=lambda kv: -kv[1])[:15]
        print("  Final unresolved row locations:")
        for name, n in top:
            print(f"    {name}  × {n}")

    for ent in entities.values():
        ent.pop("__spawnRowLocations", None)

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
