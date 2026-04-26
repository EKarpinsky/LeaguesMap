import type { WorldLocation, Region } from "../types";

/**
 * Approximate game-tile coordinates for the named places, NPCs, and
 * activity spots that Demonic Pacts League tasks refer to.
 *
 * Coordinates use OSRS surface-world tiles (x = east, y = north).
 * Underground locations are anchored to their surface entrance so they
 * render on the world map — the `blurb` usually notes the real location.
 *
 * When multiple locations are valid for a task (e.g. "Chop 100 willow
 * logs"), all are returned by the resolver. The first match in this list
 * is treated as the "best" primary pin unless noted.
 */
const L = (
  id: string,
  name: string,
  x: number,
  y: number,
  region: Region,
  category: WorldLocation["category"],
  aliases?: string[],
  blurb?: string,
): WorldLocation => ({ id, name, x, y, region, category, aliases, blurb });

export const LOCATIONS: WorldLocation[] = [
  // ───────────────────────────── Varlamore ─────────────────────────────
  L("civitas", "Civitas illa Fortis", 1725, 3128, "Varlamore", "city",
    ["civitas illa fortis", "civitas", "knight of varlamore",
     "fortis blacksmith", "fortis general store", "fortis spice stall", "outer fortis",
     "stolen cabbage", "fortis salute", "pet xolo in civitas", "oli", "achilka",
     "house key", "xolo",
     "stealing valuables", "steal valuables", "steal house key", "steal a blessed bone",
     "valuables", "a valuable",
     "at first light", "meat and greet", "death on the isle", "the final dawn"],
    "Capital of Varlamore (Valuables thieving, At First Light quest hub)"),
  // Yama's Lair entry portal in Civitas illa Fortis. The wiki Yama's_Lair
  // page tags the minigame `leagueRegion = General` and points the Map at
  // (1503, 10050) / (1503, 5603) — both mapID=-1 instance coords inside
  // the lair itself, with no surface tile players can actually walk to.
  // In Demonic Pacts, players reach Yama (and re-enter the lair) through
  // a glowing portal in Civitas illa Fortis (DP page: "players begin in
  // Yama's Lair with an exit to Civitas illa Fortis"). The base-game
  // route via the Chasm of Fire (Yama's Domain in Kourend) is not the
  // league access — pinning Yama tasks at the Chasm pin sends region-
  // locked players to a spot they can't use. This landmark sits in the
  // Civitas central plaza so all 6 Yama-related tasks (Defeat Yama,
  // Talk to the Voice of Yama, Scatter Ashes in Yama's Lair, Jump on
  // stepping stones, etc.) resolve to the actual portal players walk
  // to in DP. Region = Varlamore even though the wiki tags the underlying
  // Yama NPC `leagueRegion = Kourend`, because the DP-specific access
  // is wholly inside Varlamore — same Demonic-Pacts-portal precedent as
  // the `leviathan-lair` (Desert MTA portal) and `gotr` (Desert MTA
  // portal) landmarks.
  L("yamas-lair", "Yama's Lair", 1722, 3140, "Varlamore", "boss",
    ["yama's lair", "yamas lair", "yama", "voice of yama",
     "yama's stepping stones", "stepping stones in his league domain",
     "ashes in yama's lair", "yama's lair (location)"],
    "Demonic Pacts home arena. Glowing portal in Civitas illa Fortis re-enters the lair (also reachable via League Home Teleport)."),
  L("aldarin", "Aldarin", 1391, 2935, "Varlamore", "city",
    ["aldarin", "grape barrel", "foreman in aldarin", "fairy ring (ckq)",
     "statue of ates in aldarin", "andras"],
    "Fishing / farming town on the southern coast"),
  L("sunset-coast", "Sunset Coast", 1530, 2983, "Varlamore", "landmark",
    ["sunset coast", "bucket with sand", "hunter's crossbow"],
    "Beach south of Civitas"),
  L("cam-torum", "Cam Torum", 1421, 3114, "Varlamore", "city",
    ["cam torum", "calcified moth", "trim your beard in cam",
     "calcified deposits", "calcified rocks",
     "blessed bone shard", "blessed bone shards"],
    "Underground city (surface entrance shown). Cam Torum mine is the only source of calcified rocks, which drop blessed bone shards."),
  L("tal-teklan", "Tal Teklan", 1223, 3111, "Varlamore", "city",
    ["tal teklan", "arcuani", "tal teklan agility"],
    "Ancient city in Varlamore Part 3"),
  L("auburnvale", "Auburnvale", 1417, 3360, "Varlamore", "city",
    ["auburnvale", "auburn valley", "nemus retreat", "vale totems", "vale totems miniquest", "willow totem", "oak totem", "maple totem", "yew totem", "magic totem", "redwood totem", "greenman statue", "greenman carving", "greenman mask", "ent branches", "ent seed", "ent trail", "ent a haircut", "entling", "bowstring spool"],
    "Forestry town / Vale Totems hub"),
  L("fortis-colosseum", "Fortis Colosseum", 1824, 3107, "Varlamore", "minigame",
    ["fortis colosseum", "colosseum", "sol heredit",
     "glory in the fortis", "glory in the colosseum",
     "echo boots", "echo crystal",
     "wave 1 of fortis colosseum", "wave 12 of fortis colosseum",
     "tonalztics of ralos", "tecu salamander",
     "sunfire fanatic", "dizana", "dizana's quiver", "dizanas quiver",
     "pet renu"],
    "Gladiator PvM minigame (Sunfire Fanatic, Dizana's Quiver, Sol Heredit, Renu)"),
  L("hunter-guild", "Hunter Guild", 1559, 3048, "Varlamore", "minigame",
    ["hunter guild", "hunter rumour", "huntsman's kit", "guild hunter outfit",
     "quetzal whistle", "quetzal landing site", "quetzal transport",
     "calcified moth bare",
     "moonlight moth"],
    "Hunter Rumours / Quetzal network (Moonlight Moth, Quetzal Transport)"),
  L("tlati-rainforest", "Tlati Rainforest", 1327, 3090, "Varlamore", "landmark",
    ["tlati rainforest", "caique near the statue of ates", "pyre fox"],
    "Jungle west of Civitas"),
  L("avium-savannah", "Avium Savannah", 1635, 3010, "Varlamore", "landmark",
    ["avium savannah", "oryx in the avium savannah",
     "sunlight antelope", "moonlight antelope",
     "tecu salamander", "embertailed jerboa"],
    "Southern plains, hunter rumours, antelopes"),
  L("locus-oasis", "Locus Oasis", 1685, 2986, "Varlamore", "landmark",
    ["locus oasis",
     "marcellus", "marcellus's patch", "marcellus patch",
     "hardwood tree patch", "hardwood patch",
     "ribbiting tale", "lily pad labour dispute",
     "the ribbiting tale of a lily pad labour dispute",
     "cuthbert", "cuthbert lord of dread",
     "fairy ring (ajp)", "fairy ring ajp"],
    "Oasis in the centre of Avium Savannah (fairy ring AJP). Quest start for The Ribbiting Tale of a Lily Pad Labour Dispute."),
  L("mastering-mixology", "Mastering Mixology", 1389, 2918, "Varlamore", "minigame",
    ["mastering mixology", "mixology shop", "alchemists outfit", "alchemist labcoat", "reagents pouch", "chugging barrel"],
    "Herblore minigame in Aldarin"),
  // Shrine of Ralos at The Teomat — the iconic Varlamore religious hub.
  // There are five Shrines of Ralos scattered across Varlamore, but the
  // Teomat one is wiki-cited as the most-used shrine and is the only one
  // co-located with the Exposed Altar (where jugs of blessed sunfire wine
  // are made). One landmark covers two task families:
  //
  //   * Sunfire runes — created at any Shrine of Ralos. The "sunfire rune"
  //     alias here lets the same-region (Varlamore) resolver pass win
  //     before "fire rune" on the Desert `fire-altar` landmark gets
  //     matched via substring fallback (which was misrouting "Craft 1000
  //     Sunfire Runes" all the way out to Al Kharid).
  //   * Blessed sunfire wine — exposed altar at the summit of Ralos' Rise
  //     (1436, 3144), just south of the Teomat shrine. NOT made at the
  //     Stonecutter Outpost as the previous aliases implied.
  //
  // NOTE: blessed bone shard aliases deliberately live on `cam-torum`
  // instead, because the only blessed-bone-shard task in the dataset is
  // "Mine 250 Blessed Bone Shards" — the calcified rocks that drop them
  // are in the Cam Torum mine. If a "Offer N at the Libation Bowl" task
  // is ever added, route it here via wikiLinks/explicit alias.
  L("shrine-of-ralos", "Shrine of Ralos (The Teomat)", 1449, 3171, "Varlamore", "landmark",
    ["shrine of ralos", "the teomat", "teomat", "ralos rise", "ralos' rise",
     "sunfire rune", "sunfire runes", "craft sunfire",
     "exposed altar", "libation bowl",
     "sunfire wine", "blessed sunfire wine",
     "jug of sunfire wine", "jug of blessed sunfire wine"],
    "Shrine of Ralos at The Teomat (Ralos' Rise). Crafts sunfire runes; the adjacent Exposed Altar blesses jugs of sunfire wine."),
  L("hueycoatl-arena", "Hueycoatl Arena", 1341, 3080, "Varlamore", "boss",
    ["hueycoatl", "huey coatl"],
    "Hueycoatl battle arena in the Tombs of Amaxyathi"),
  L("amoxliatl-cave", "Amoxliatl's Cave", 1262, 3132, "Varlamore", "boss",
    ["amoxliatl"],
    "Ice boss in the Hunter Guild caves"),
  // Surface pin = Cam Torum entrance. Neypotzli (where the three Moons
  // are imprisoned) sits at the north end of Cam Torum, which itself is
  // beneath Ralos' Rise. The walk-in coord (1421, 3114) is the same one
  // we use for the cam-torum landmark; players reach Neypotzli by going
  // through Cam Torum. The previous coords (1460, 3284) put a phantom
  // pin nowhere near the actual entrance, and the previous label
  // ("Shrine of Ralos") is a different in-game location entirely.
  // NOTE: `moon key` and `varlamore moon chest` aliases used to live here
  // because the Moons of Peril is where the moon key DROPS. But every
  // moon-key task ("Open a chest with the moon key", "Open the Varlamore
  // Moon Chest") describes the chest itself, which lives in the Ruins of
  // Tapoyauik beneath the Twilight Temple — completely different pin.
  // Those aliases now live on the `twilight-temple` landmark below so the
  // chest tasks pin where players actually use the key, not where they
  // got it.
  L("moons-of-peril", "Neypotzli (Cam Torum)", 1421, 3114, "Varlamore", "boss",
    ["moons of peril", "blood moon", "blue moon", "eclipse moon",
     "blood moon armour", "blue moon armour", "eclipse moon armour",
     "sulphur blades", "neypotzli",
     "moon-lite", "moonlite"],
    "Perilous Moons minigame entrance (via Cam Torum, beneath Ralos' Rise)"),
  L("vale-totems", "Vale Totems", 1365, 3370, "Varlamore", "minigame",
    ["vale totems"],
    "Fletching minigame in Auburn Valley"),
  L("the-heart-dungeon", "The Heart of Darkness", 1435, 3009, "Varlamore", "quest",
    ["the heart of darkness", "frost crabs"],
    "Late-Varlamore quest area"),
  // Twilight Temple sits east of Civitas illa Fortis with the Ruins of
  // Tapoyauik dungeon directly underneath. Coord matches the wiki Map
  // template for Ruins of Tapoyauik (x:1693.5, y:3232) — the same
  // surface tile Amoxliatl's curated entity uses. Carries the moon-key
  // chest aliases so "Open a chest with the moon key inside the Ruins
  // of Tapoyauik" lands here instead of falling through to The Heart of
  // Darkness quest start (1435, 3009), ~250 game tiles west of the
  // actual dungeon.
  L("twilight-temple", "Twilight Temple", 1693, 3232, "Varlamore", "dungeon",
    ["twilight temple", "ruins of tapoyauik",
     "moon key", "chest (moon key)", "varlamore moon chest"],
    "Surface entrance to the Ruins of Tapoyauik (Amoxliatl, moon-key chest)"),
  L("salvager-overlook", "Salvager Overlook", 1625, 3295, "Varlamore", "landmark",
    ["salvager overlook", "green flame"],
    "Cliffside view east of Civitas"),
  // Surface entrance to the Crypt of Tonali → Ruins of Mokhaiotl, where
  // the Doom of Mokhaiotl is fought. The previous coord (1420, 3175) was
  // a hand-eyeballed approximation between Cam Torum and the Tlati
  // Rainforest — close to neither the cavern entrance nor the rendered
  // Mokhaiotl label on the world-map PNG. The wiki Tonali Cavern page
  // ({{Map|1309,3104|1305,3033|caption=Entrances to Tonali Cavern}}) lists
  // two ladder-down points; we pin to the northern one (1309, 3104) since
  // it's the tile players reach from the Mokhaiotl waystone arrival area.
  L("doom-mokhaiotl", "Doom of Mokhaiotl", 1309, 3104, "Varlamore", "boss",
    ["doom of mokhaiotl", "mokhaiotl", "delve level", "deep delve",
     "confliction gauntlets", "eye of ayak", "avernic treads",
     "earthbound tecpatl", "glacial temotli", "pendant of ates",
     "oathplate helm", "oathplate chest", "oathplate legs",
     "soulflame horn"],
    "Tonali Cavern entrance, Varlamore Part 3 delve boss (Earthbound/Glacial weapons, Pendant of Ates, Oathplate, Soulflame Horn)"),
  L("gemstone-crab", "Gemstone Crab", 1275, 3160, "Varlamore", "boss",
    ["gemstone crab"],
    "Coastal boss east of Sunset Coast"),
  L("stonecutter-outpost", "Stonecutter Outpost", 1740, 2963, "Varlamore", "resource",
    ["stonecutter outpost", "mine some coal from stonecutter", "mithril ore in the stonecutter"],
    "Coal & mithril mining north of Civitas"),
  L("custodia-pass", "Custodia Pass", 1271, 3349, "Varlamore", "dungeon",
    ["custodia pass", "antler guard", "shadows of custodia", "shadow of custodia"],
    "Slayer dungeon in Varlamore Part 3"),
  // Pinned to the VISIBLE CENTER of the Colossal Wyrm Remains crater
  // (under the label on the wiki world-map PNG) rather than the wiki's
  // canonical (1640, 2921), which is the NORTHERN RIM agility-course
  // entrance tile — physically correct for players walking to the course,
  // but puts the pin ~130 src-px north of where the label actually prints.
  // See scripts/fetch-wiki-entities.py ENTITY_COORD_OVERRIDES for the
  // matching override on the colossal-wyrm wiki-entity entries so wiki-
  // link resolution lands on the same spot.
  L("varlamore-agility", "Colossal Wyrm Agility", 1657, 2890, "Varlamore", "minigame",
    ["colossal wyrm", "varlamore agility", "termites"],
    "Colossal Wyrm Remains Agility course"),
  L("kastori", "Kastori", 1373, 3042, "Varlamore", "landmark",
    ["kastori", "caique near the statue of ates in kastori", "imp in the kastori basement"],
    "Kastori district north of Civitas"),
  L("quetzin-achilka", "Achilka's Boat", 1374, 3043, "Varlamore", "npc",
    ["achilka's boat", "river varla"],
    "River Varla ferry"),
  L("river-fortis", "Fortis River", 1672, 3145, "Varlamore", "landmark",
    ["sit down near a stolen cabbage", "stolen cabbage"],
    "Stolen cabbage path near Civitas"),

  // ───────────────────────────── Karamja ─────────────────────────────
  L("musa-point", "Musa Point", 2904, 3162, "Karamja", "city",
    ["musa point", "luthas at musa point", "crate with bananas", "pineapple on karamja"],
    "Karamja docks"),
  L("brimhaven", "Brimhaven", 2760, 3184, "Karamja", "city",
    ["brimhaven", "brimhaven agility arena", "brimhaven dungeon",
     "pirate jackie the fruit", "agility arena ticket", "pirate hook",
     "karamja achievement diary", "karamja diary",
     "spirit tree on karamja", "spirit tree (karamja)",
     "dragon platelegs", "dragon plateskirt",
     "smuggle", "ring of charos",
     "steel dragon on karamja"],
    "Western Karamja port / Karamja diary reward-giver (Brimhaven Dungeon, steel dragons)"),
  L("shilo-village", "Shilo Village", 2922, 3000, "Karamja", "city",
    ["shilo village", "paramaya inn", "stepping stones agility shortcut in shilo", "salmon on karamja"],
    "South Karamja village"),
  L("tai-bwo-wannai", "Tai Bwo Wannai", 2795, 3065, "Karamja", "city",
    ["tai bwo wannai", "tai bwo wannai villager", "hardwood grove", "tai bwo wannai cleanup",
     "gout tuber", "dense jungle", "karambwanji",
     "karambwan", "karambwans",
     "calquat", "calquat tree",
     "red topaz machete"],
    "Jungle village (Karambwan, Calquat trees, Red Topaz Machete)"),
  L("mor-ul-rek", "Mor Ul Rek (TzHaar City)", 2856, 3168, "Karamja", "city",
    ["mor ul rek", "tzhaar", "tzhaar-hur", "toktz-ket-xil", "toktz-xil-ak", "toktz-xil-ek",
     "obsidian cape", "obsidian armour", "fight cave", "inferno", "tzhaar-ket-rak",
     "onyx in mor ul rek", "mor ul rek in", "ore and gem store",
     "fire cape", "infernal cape"],
    "TzHaar volcanic city (Fight Cave, Inferno, Fire/Infernal cape)"),
  L("karamja-volcano", "Karamja Volcano", 2845, 3174, "Karamja", "landmark",
    ["karamja volcano"],
    "Volcano dungeon entrance to Mor Ul Rek"),
  L("karamja-nature-altar", "Nature Altar", 2868, 3018, "Karamja", "landmark",
    ["nature runes", "nature altar"],
    "Runecrafting altar in the jungle"),
  L("crandor", "Crandor", 2836, 3271, "Karamja", "dungeon",
    ["steel dragon on karamja", "black demon on karamja", "crandor"],
    "Crandor/Karamja dungeon zone"),

  // ───────────────────────────── Asgarnia ─────────────────────────────
  L("falador", "Falador", 3000, 3360, "Asgarnia", "city",
    ["falador", "falador square", "mining guild", "shooting star", "stardust", "mahogany homes", "rogues den", "pest control", "motherlode", "warriors' guild", "warriors guild", "white knight", "crafting guild",
     "falador achievement diary", "falador diary",
     "giant mole", "holy mole", "holy moley",
     "dragon defender",
     "carpenters outfit", "carpenter's outfit",
     "graceful", "recoloured graceful", "graceful gear"],
    "White Knight capital / Falador diary reward-giver (Giant Mole, Warriors' Guild)"),
  L("rimmington", "Rimmington", 2956, 3232, "Asgarnia", "city",
    ["rimmington", "witch's potion", "witchs potion"],
    "Small town south of Falador (Hetty, Witch's Potion start)"),
  L("draynor", "Draynor Village", 3103, 3259, "Misthalin", "city",
    ["draynor village", "draynor"],
    "Willow trees, wise old man"),
  L("port-sarim", "Port Sarim", 3029, 3221, "Asgarnia", "city",
    ["port sarim", "charter ship"],
    "Port south of Falador"),
  L("burthorpe", "Burthorpe", 2881, 3539, "Asgarnia", "city",
    ["burthorpe", "rogues' den", "rogue outfit", "rogue set", "rogue equipment",
     "rogue gear", "rogue top", "rogue trousers", "rogue mask", "rogue boots", "rogue gloves"],
    "Death Plateau town (Rogues' Den, Rogue outfit)"),
  L("taverley", "Taverley", 2910, 3451, "Asgarnia", "city",
    ["taverley", "heroes' guild",
     "a porcine of interest", "porcine of interest"],
    "Druidic town (Solly, A Porcine of Interest start)"),
  L("wizards-tower", "Wizards' Tower", 3109, 3160, "Misthalin", "landmark",
    ["wizards tower", "wizard's tower", "rune mysteries"],
    "Home of the Magic spells"),
  L("motherlode-mine", "Motherlode Mine", 3057, 3375, "Asgarnia", "minigame",
    ["motherlode mine", "gold nugget",
     "prospector", "prospector helmet", "prospector jacket", "prospector legs", "prospector boots",
     "golden prospector"],
    "Dwarven mining minigame (Prospector / Golden Prospector outfits)"),
  L("pest-control", "Pest Control", 2658, 2625, "Asgarnia", "minigame",
    ["pest control",
     "void knight", "void set", "void helm", "void top", "void robe", "void gloves",
     "elite void"],
    "Void Knight minigame (Void Knight set)"),
  L("barbarian-outpost", "Barbarian Outpost", 2549, 3558, "Kandarin", "minigame",
    ["barbarian assault", "barbarian outpost",
     "fighter torso", "fighter hat", "runner hat", "healer hat", "ranger hat",
     "penance"],
    "Barbarian Assault lobby (Fighter Torso / Penance gear)"),
  L("white-wolf-mtn", "White Wolf Mountain", 2845, 3483, "Asgarnia", "landmark",
    ["white wolf mountain", "dire wolf"],
    "Mountain pass"),
  // Royal Titans (Eldric the Ice King + Branda the Fire Queen) — fought
  // in an arena off the Asgarnian Ice Dungeon, NOT Burthorpe. The wiki
  // Royal_Titans page is explicit: "The Royal Titans can be accessed in
  // the Asgarnian Ice Dungeon (fairy ring code AIQ)." Surface entrance
  // is the trapdoor south of Falador at (3008, 3150) per the
  // Asgarnian_Ice_Dungeon wiki Map template — same tile the curated
  // `entity:royal titans` pin uses, so the two pins co-locate.
  L("royal-titans", "Royal Titans", 3008, 3150, "Asgarnia", "boss",
    ["royal titans", "eldric the ice king", "branda the fire queen",
     "giantsoul amulet",
     "twinflame staff", "mystic vigour", "deadeye"],
    "Royal Titans (Eldric + Branda) entrance, Asgarnian Ice Dungeon trapdoor south of Falador. Fairy ring AIQ. Drops the Twinflame Staff and the Giantsoul amulet."),

  // ───────────────────────────── Desert ─────────────────────────────
  L("al-kharid", "Al Kharid", 3290, 3185, "Desert", "city",
    ["al kharid", "al-kharid"],
    "Desert gateway"),
  L("pollnivneach", "Pollnivneach", 3358, 2974, "Desert", "city",
    ["pollnivneach"],
    "Central desert town"),
  L("nardah", "Nardah", 3427, 2911, "Desert", "city",
    ["nardah", "spirits of the elid",
     "desert achievement diary", "desert diary",
     "salmon in the desert", "salmon (desert)"],
    "Eastern desert town (Jarr, Desert diary reward-giver; River Elid salmon)"),
  L("sophanem", "Sophanem", 3297, 2783, "Desert", "city",
    ["sophanem", "menaphos", "beneath cursed sands"],
    "Desert necropolis (Beneath Cursed Sands start)"),
  L("toa", "Tombs of Amascut", 3345, 2725, "Desert", "raid",
    ["tombs of amascut", "tumeken's shadow",
     "elidinis' ward", "elidinis ward",
     "masori", "masori mask", "masori body", "masori chaps",
     "osmumten's fang", "osmumtens fang", "osmumten fang",
     "lightbearer"],
    "Desert raid"),
  L("duel-arena", "Duel Arena / Emir's Arena", 3360, 3233, "Desert", "landmark",
    ["emir's arena", "duel arena"],
    "Arena & Mage Training Arena"),
  L("kalphite-lair", "Kalphite Queen Lair", 3226, 3108, "Desert", "boss",
    ["kalphite queen", "drygore blowpipe"],
    "Queen & hive (anchored to hive entrance)"),
  L("mage-training-arena", "Mage Training Arena", 3364, 3312, "Desert", "minigame",
    ["mage training arena",
     "mage's book", "mages book", "master wand",
     "infinity robe", "infinity hat", "infinity top", "infinity bottoms",
     "infinity boots", "infinity gloves"],
    "Magic minigame near Al Kharid (source of Mage's book, Master wand, Infinity set)"),
  L("giants-foundry", "Giants' Foundry", 3360, 3151, "Desert", "minigame",
    ["giants foundry", "giants' foundry", "sleeping giants"],
    "Smithing minigame (near Al Kharid) / Sleeping Giants miniquest"),
  L("pyramid-plunder", "Pyramid Plunder", 3289, 2793, "Desert", "minigame",
    ["pyramid plunder", "mummy"],
    "Thieving minigame (Jaldraocht, mummies guard the chambers)"),
  // ─── DT2 boss arenas (one landmark per boss, with the ring/bow they drop) ───
  // These four landmarks replace the curated wiki-entities of the same
  // name (which all collapsed to placeholder coords — Vardorvis to a
  // Varlamore NPC tile, the other three all to Edgeville bank). Each
  // landmark pins to the SURFACE entrance the player actually walks to
  // for that boss, holds aliases for both the boss name and the unique
  // vestige ring it drops, and (for Leviathan only) the Venator Bow
  // pieces. Awakened/Sleeper variants don't need their own aliases —
  // the resolver's description-text scan picks them up via the base
  // name in "Defeat Awakened Vardorvis." etc.
  //
  // Each landmark also carries the SHARED DT2 drops (Virtus armour,
  // Soulreaper Axe, Desert Treasure II quest itself). All four bosses
  // drop hilt fragments / Virtus pieces, so a task like "Equip the
  // Soulreaper Axe" intentionally fans out to all four pins — the
  // player can hunt at whichever boss they prefer. The previous
  // implementation collapsed all of these onto one fake landmark at
  // (2666, 3691) in Fremennik Province, which is neither a boss nor
  // even in the right region.
  //
  // Rationale: each pin sits at the surface entrance the player actually
  // walks to, so the badge region matches that surface tile rather than
  // the league's task-region tag. Same pattern as Cerberus — tagged
  // Kourend by the league but pinned in Asgarnia where Taverley Dungeon
  // sits. All four canonical coords are pulled from the boss pages'
  // {{LocLine}} surface mapref on the OSRS Wiki.
  //
  // Wiki-confirmed Demonic Pacts league regions for each boss page:
  //   Vardorvis     → Varlamore  (The Stranglewood Ritual Site)
  //   Duke Sucellus → Fremennik  (Ghorrock Prison Asylum, via Weiss)
  //   The Leviathan → Desert     (The Scar, via Temple of the Eye)
  //   The Whisperer → Asgarnia   (Lassar Undercity Sunken Cathedral)
  // Pin badges intentionally show the SURFACE-entry region (per the
  // Cerberus convention) rather than the league-tag region, so e.g.
  // The Leviathan's pin badge says Kourend (its Temple-of-the-Eye
  // surface entrance) even though the league tags the boss as Desert.
  L("whisperer-lair", "The Whisperer", 3008, 3501, "Asgarnia", "boss",
    ["whisperer", "the whisperer",
     "bellator ring", "bellator vestige",
     "desert treasure ii", "the fallen empire",
     "soulreaper axe", "soul reaper axe",
     "virtus", "virtus top", "virtus mask", "virtus robe", "virtus robes"],
    "The Whisperer (Lassar Undercity Sunken Cathedral, accessed via the sinkhole north-west of the Ruins of Camdozaal beneath Ice Mountain). Drops the Bellator vestige and a shared DT2 hilt fragment (Soulreaper Axe / Virtus armour)."),
  // Stranglewood Ritual Site, south of Mount Quidamortem — Varlamore.
  L("vardorvis-arena", "Vardorvis", 1128, 3417, "Varlamore", "boss",
    ["vardorvis",
     "ultor ring", "ultor vestige",
     "desert treasure ii", "the fallen empire",
     "soulreaper axe", "soul reaper axe",
     "virtus", "virtus top", "virtus mask", "virtus robe", "virtus robes"],
    "Vardorvis (The Stranglewood Ritual Site, north-west of the forest south of Mount Quidamortem). Drops the Ultor vestige and a shared DT2 hilt fragment (Soulreaper Axe / Virtus armour)."),
  // Ghorrock Prison Asylum is reached via Ghorrock Dungeon under Weiss's
  // Salt Mine — surface entrance is in Fremennik, not deep Wilderness.
  L("duke-sucellus-lair", "Duke Sucellus", 2870, 3940, "Fremennik", "boss",
    ["duke sucellus",
     "magus ring", "magus vestige",
     "desert treasure ii", "the fallen empire",
     "soulreaper axe", "soul reaper axe",
     "virtus", "virtus top", "virtus mask", "virtus robe", "virtus robes"],
    "Duke Sucellus (Ghorrock Prison Asylum, accessed through Ghorrock Dungeon beneath Weiss's Salt Mine). Drops the Magus vestige and a shared DT2 hilt fragment (Soulreaper Axe / Virtus armour)."),
  // Both Leviathan and GotR pin to the *Demonic Pacts-specific* portal
  // Jagex placed next to the Mage Training Arena in the Kharidian Desert
  // (see https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Areas/Desert
  // — "A portal to Guardians of the Rift will be located near the Mage
  // Training Arena."). In live-game OSRS the only surface entry to GotR /
  // The Scar is the basement of the Wizards' Tower (Misthalin), but
  // Misthalin is a permanently-locked region in DP, so a Desert-only
  // player would have no walking route to either pin. The DP-only MTA
  // portal is the one route a Desert unlock actually opens up, which is
  // also why the wiki tags Temple of the Eye / The Leviathan / Amulet of
  // the Eye / Tarnished Locket all as `leagueRegion = Desert`.
  //
  // Both pins sit on the same Desert tile (3367, 3318) just outside the
  // MTA entrance — they cluster with the existing `mage-training-arena`
  // pin, which is the correct on-map relationship (the portal is "near"
  // the arena per the wiki). Region badge = Desert matches the task tag
  // and the player's actual access path.
  L("leviathan-lair", "The Leviathan", 3367, 3318, "Desert", "boss",
    ["leviathan", "the leviathan",
     "venator ring", "venator vestige",
     "venator bow",
     "desert treasure ii", "the fallen empire",
     "soulreaper axe", "soul reaper axe",
     "virtus", "virtus top", "virtus mask", "virtus robe", "virtus robes"],
    "The Leviathan (DT2 boss in The Scar). In Demonic Pacts the only Desert-accessible route is the GotR portal Jagex placed next to the Mage Training Arena: take the portal, then talk to the Catalytic Guardian inside the Temple of the Eye to travel into The Scar. Drops the Venator vestige, Venator Bow shards, and a shared DT2 hilt fragment (Soulreaper Axe / Virtus armour)."),
  L("gotr", "Guardians of the Rift", 3367, 3318, "Desert", "minigame",
    // The "Guardians of the Rift X Rifts closed" tasks wikilink to
    // [[Temple of the Eye (location)]] and have descriptions like
    // "Close the Rift in the Temple of the Eye 10 times." — no
    // mention of "Guardians of the Rift" in either the wikiLink OR
    // the description body, so the resolver's text-scan misses the
    // primary "guardians of the rift" alias entirely. Adding the
    // Temple-of-the-Eye aliases lets the wikilink hit, and "rift
    // closed" / "close the rift" / "the rift" guard against future
    // task description variants. The drop-tasks (Divine Rune pouch /
    // Abyssal Lantern / etc.) already match via their own aliases.
    ["guardians of the rift",
     "temple of the eye", "temple of the eye (location)",
     "close the rift", "rift closed", "rifts closed",
     "abyssal pearls", "wrath talisman",
     "divine rune pouch", "divine spirit shield",
     "abyssal needle", "abyssal lantern"],
    "Runecraft minigame in the Temple of the Eye. Demonic Pacts adds a dedicated portal next to the Mage Training Arena so Desert unlocks can reach it without going through the Wizards' Tower (Misthalin is locked). Source of the Colossal/Divine Rune pouch, Raiment of the Eye, and catalytic talismans."),
  // Doubles as the *generic* GWD entrance pin: the curated
  // `entity:god wars dungeon` was removed (see fetch-wiki-entities.py
  // — it produced a redundant pin ~3 tiles away that split Nex tasks
  // off from the landmark, and falsely attracted Wilderness GWD
  // tasks). The "god wars dungeon" / "godwars dungeon" / "gwd"
  // aliases below let generic tasks ("Defeat Any God Wars Dungeon
  // Boss N Times") and the bare-"Nex" tasks land here. Boss-specific
  // tasks (Defeat Kree'arra / Zilyana / Graardor / K'ril) still match
  // their own curated entities first via wiki-link, so they keep
  // their own boss pins at this same entrance — just like every
  // other GWD boss.
  L("nex-lair", "Nex (God Wars Dungeon)", 2915, 3745, "Asgarnia", "boss",
    ["nex", "zaryte", "nihil shards", "ancient godswords",
     "torva", "torva helm", "torva full helm", "torva platebody", "torva platelegs",
     "zaryte vambraces", "zaryte crossbow",
     "god wars dungeon", "godwars dungeon", "gwd"],
    "God Wars Dungeon entrance & Nex chamber (Torva, Zaryte drops)"),

  // ───────────────────────────── Fremennik ─────────────────────────────
  L("rellekka", "Rellekka", 2658, 3677, "Fremennik", "city",
    ["rellekka",
     "fremennik achievement diary", "fremennik diary",
     "fremennik trials", "fremennik lyre", "enchanted lyre", "lyre"],
    "Fremennik capital (Thorvald, Fremennik diary; Fremennik Trials lyre)"),
  // Surface pin = the Keldagrim entrance cave east of Rellekka (canonical
  // surface entry per the Keldagrim wiki page: "fairy ring code DKS to
  // teleport right next to the cave entrance to Keldagrim"). Keldagrim
  // itself sits underground at mapID=10 (~2879,10176) so it has no
  // walk-to surface coord — the previous pin (2923, 3536) was somewhere
  // near Heroes' Guild / Chaos Temple, miles south of any actual route
  // to the city. Same coord we use for the Fremennik Mountain Troll pin
  // (see ANCHOR_COORD_OVERRIDES["Keldagrim entrance"] in fetch-wiki-entities.py).
  L("keldagrim", "Keldagrim entrance", 2744, 3719, "Fremennik", "city",
    ["keldagrim",
     "crossbow stall", "wooden stock",
     "fairy ring (dks)", "dks"],
    "Surface entry to the dwarven underground city (cave east of Rellekka, fairy ring DKS). Keldagrim thieving stalls (Crossbow Stall, Wooden Stock) are inside the city."),
  L("miscellania", "Miscellania", 2560, 3870, "Fremennik", "city",
    ["miscellania", "etceteria", "royal trouble", "throne of miscellania"],
    "Offshore kingdom (Royal Trouble / Throne of Miscellania)"),
  L("neitiznot", "Neitiznot", 2331, 3802, "Fremennik", "city",
    ["neitiznot", "jatizso", "the fremennik isles",
     "yakhide", "yakhide armour", "yak-hide", "yak-hide armour"],
    "Fremennik isles (Fremennik Isles quest, Yak-hide Armour)"),
  L("waterbirth", "Waterbirth Island", 2525, 3743, "Fremennik", "dungeon",
    ["waterbirth"],
    "Dagannoth lair surface"),
  L("dagannoth-kings", "Dagannoth Kings (Waterbirth Island)", 2522, 3745, "Fremennik", "boss",
    ["dagannoth kings", "dagannoth rex", "dagannoth prime", "dagannoth supreme",
     "berserker ring", "warrior ring", "seer's ring", "seers ring", "archer's ring", "archers ring",
     "seercull",
     "dragonbone necklace", "rex matriarch",
     "dragon axe",
     "rockshell", "skeletal armour", "spined armour"],
    "DKs chamber (Berserker/Warrior/Seers/Archers rings, Seercull, Dragonbone necklace, Dragon axe)"),
  L("vorkath", "Vorkath", 2272, 4064, "Fremennik", "boss",
    ["vorkath", "ava's assembler", "vorkath's head",
     "dragon crossbow", "dragonfire ward", "dragonfire shield"],
    "Dragonkin boss on Ungael (Dragon crossbow, Dragonfire ward, Vorkath's head)"),
  L("fremennik-slayer-dungeon", "Fremennik Slayer Dungeon", 2797, 3616, "Fremennik", "dungeon",
    ["fremennik slayer dungeon",
     "brine sabre", "brine rat",
     "leaf-bladed battleaxe", "leaf-bladed spear", "leaf-bladed sword", "leaf bladed",
     "turoth", "kurask"],
    "Cave with brines/turoths/kurasks (Brine Sabre, Leaf-bladed weapons)"),
  // Wiki: Smoke Devil Dungeon entrance is at game (2412, 3061) — south-east
  // of Castle Wars in Kandarin (the previous Pollnivneach coord at 3310,2962
  // was a Desert mirage; both region AND coords were wrong).
  L("thermonuclear", "Thermonuclear Smoke Devil (Smoke Dungeon)", 2412, 3061, "Kandarin", "boss",
    ["thermonuclear smoke devil", "shadowflame", "devil's element",
     "occult necklace", "smoke devil"],
    "Smoke dungeon boss south-east of Castle Wars (Occult Necklace from Smoke Devils)"),
  L("god-wars", "God Wars Dungeon", 2918, 3745, "Asgarnia", "dungeon",
    ["god wars", "kree'arra", "commander zilyana", "general graardor", "k'ril tsutsaroth",
     "godsword", "armadyl godsword", "bandos godsword", "saradomin godsword", "zamorak godsword",
     "armadyl crossbow", "armadyl chestplate", "armadyl chainskirt", "armadyl helmet",
     "armadyl armour", "piece of the armadyl",
     "bandos chestplate", "bandos tassets", "bandos boots",
     "bandos armour", "piece of the bandos",
     "saradomin sword", "staff of the dead",
     "zamorakian spear", "zamorakian hasta",
     "ourg bone", "magic fang", "saradomin's light"],
    "GWD entrance atop Trollheim (Armadyl/Bandos/Sara/Zamorak drops)"),

  // ───────────────────────────── Kandarin ─────────────────────────────
  L("east-ardougne", "East Ardougne", 2570, 3300, "Kandarin", "city",
    ["ardougne", "east ardougne", "ardougne general store", "wrath talisman",
     "ardougne achievement diary", "ardougne diary",
     "monk's friend", "monks friend"],
    "Kandarin capital (Two-pints, Ardougne diary reward-giver)"),
  L("west-ardougne", "West Ardougne", 2500, 3305, "Kandarin", "city",
    ["west ardougne", "plague city"],
    "Plague-era west"),
  L("camelot", "Camelot", 2758, 3507, "Kandarin", "city",
    ["camelot", "seers village", "seers' village", "ranging guild",
     "kandarin achievement diary", "kandarin diary",
     "elemental workshop", "elemental workshop ii"],
    "Arthurian town (Kandarin diary reward-giver; Elemental Workshop in basement)"),
  L("catherby", "Catherby", 2814, 3443, "Kandarin", "city",
    ["catherby",
     "barehand", "barehanded catch", "barehanded"],
    "Fishing / farming village (Barehand fishing from Otto/Barbarian Assault; shark spot)"),
  L("yanille", "Yanille", 2577, 3090, "Kandarin", "city",
    ["yanille"],
    "Magic Guild town"),
  L("khazard", "Port Khazard", 2653, 3159, "Kandarin", "city",
    ["port khazard", "fight arena"],
    "Khazardian port"),
  L("gnome-stronghold", "Tree Gnome Stronghold", 2440, 3460, "Kandarin", "city",
    ["tree gnome stronghold", "grand tree", "path of glouphrie",
     "brimstail", "spirit tree", "spirit trees",
     "monkey madness",
     "ogre bow", "comp ogre bow",
     "warped sceptre"],
    "Gnome capital (Brimstail, Spirit Trees; Monkey Madness / Path of Glouphrie starts; Warped Sceptre unlock)"),
  L("mcgrubors", "McGrubor's Wood", 2652, 3485, "Kandarin", "landmark",
    ["mcgrubor"],
    "Wood north of Seers'"),
  L("sinclair-mansion", "Sinclair Mansion", 2743, 3555, "Kandarin", "landmark",
    ["sinclair"],
    "Murder Mystery house"),
  L("zul-andra", "Zul-Andra", 2193, 3060, "Tirannwn", "city",
    ["zul-andra", "zulrah", "toxic trident", "magic fang", "tanzanite fang", "serpentine",
     "toxic blowpipe", "blowpipe",
     "enhance a trident", "uncharged toxic trident", "trident of the swamp",
     "sacred eel"],
    "Zulrah's temple (Toxic Blowpipe, Trident enhancement via Magic Fang, Sacred Eels)"),
  L("fishing-guild", "Fishing Guild", 2609, 3424, "Kandarin", "landmark",
    ["fishing guild", "fishing contest"],
    "High-level fishing / Fishing Contest start (Hemenster is just south)"),
  L("witchaven", "Witchaven", 2720, 3287, "Kandarin", "city",
    ["witchaven", "sea slug"],
    "Coastal village (Caroline, Sea Slug start)"),
  L("ranging-guild", "Ranging Guild", 2667, 3446, "Kandarin", "landmark",
    ["ranging guild"],
    "Ranged skill guild"),
  L("castle-wars", "Castle Wars", 2407, 3105, "Kandarin", "minigame",
    ["castle wars"],
    "Capture-the-flag minigame"),
  L("chompy-hunting", "Chompy Bird Hunting", 2560, 2944, "Kandarin", "minigame",
    ["chompy bird",
     "chompy hat", "marksman chompy", "dragon archer chompy",
     "spottier cape", "spotted cape"],
    "Feldip Hills swamps (Chompy hats, Spotted/Spottier capes from Hunter)"),
  L("hespori", "Hespori", 1249, 3737, "Kourend", "boss",
    ["hespori", "nature's recurve"],
    "Farming boss"),

  // ───────────────────────────── Kourend ─────────────────────────────
  L("port-piscarilius", "Port Piscarilius", 1803, 3752, "Kourend", "city",
    ["port piscarilius", "piscarilius",
     "anglerfish"],
    "Fishing / docks (Anglerfish spots)"),
  L("hosidius", "Hosidius", 1762, 3598, "Kourend", "city",
    ["hosidius", "tithe farm", "farming guild", "woodcutting guild", "mess hall",
     "kourend & kebos diary", "kourend and kebos diary", "kourend diary", "kebos diary",
     "the garden of death", "garden of death",
     "redwood log", "redwood tree", "redwood arrow",
     "farmer's outfit", "farmers outfit",
     "juniper log", "juniper charcoal", "juniper tree",
     // Herb sack (and its silklined upgrade) is sold in Kourend by Farmer
     // Gricoller at the Tithe Farm in Hosidius for 250 Tithe Farm points
     // — the only Kourend vendor for both items. The silklined upgrade
     // itself is craft-anywhere (pristine spider silk on herb sack), but
     // the task is region-tagged Kourend, so anchoring it on the Hosidius
     // herb-sack vendor is the only defensible Kourend pin.
     "herb sack", "silklined herb sack"],
    "Farming district / Kourend & Kebos diary reward-giver (Redwood trees, Farmer's outfit, Garden of Death). Tithe Farm = Farmer Gricoller (herb sack vendor)."),
  L("lovakengj", "Lovakengj", 1505, 3801, "Kourend", "city",
    ["lovakengj", "lovakite", "blast mine",
     "dynamite", "volcanic sulphur", "saltpetre"],
    "Mining / smithing district (Dynamite, Volcanic Sulphur, Saltpetre)"),
  L("shayzien", "Shayzien", 1517, 3592, "Kourend", "city",
    ["shayzien", "shayzien combat",
     "lizardkicker", "protest banner", "zamorak's grape", "zamoraks grape",
     "lizardman shaman", "dragon warhammer"],
    "Military district (Shayzien protests, Lizardman shamans, Dragon Warhammer)"),
  L("arceuus", "Arceuus", 1700, 3800, "Kourend", "city",
    ["arceuus", "dark altar", "soul altar", "blood altar",
     "arceuus library",
     "inferior demonbane", "demonbane", "demonslaying", "inferior demonslaying",
     "degrime", "death charge", "rite of vile transference",
     "cursed amulet of magic", "amulet of the damned"],
    "Magic / runecrafting district (Arceuus spellbook, Library, altars)"),
  L("cox", "Chambers of Xeric", 1245, 3557, "Kourend", "raid",
    ["chambers of xeric", "cox", "twisted bow", "dragon hunter lance", "kodai",
     "arcane prayer", "dexterous prayer", "dragon claws", "olmlet",
     "ancestral", "ancestral hat", "ancestral robe", "ancestral top", "ancestral bottom",
     "elder maul", "twisted buckler", "dinh's bulwark", "dinhs bulwark",
     "dragon hunter crossbow", "dragon warhammer",
     "oathplate", "radiant oathplate",
     "xeric's talisman", "xerics talisman"],
    "Raid entrance on Mount Quidamortem (Ancestral, Elder Maul, Twisted Buckler, Bulwark, DHCB)"),
  L("mt-karuulm", "Mount Karuulm", 1311, 3807, "Kourend", "dungeon",
    ["mount karuulm", "karuulm slayer dungeon", "alchemical hydra",
     "dragon hunter lance", "ferocious gloves", "bonecrusher necklace", "hydra",
     "brimstone ring", "boots of brimstone"],
    "Slayer dungeon with Hydra (Brimstone Ring, Boots of Brimstone)"),
  L("darkmeyer-hallowed", "Hallowed Sepulchre (anchor)", 3654, 3387, "Morytania", "minigame",
    ["hallowed sepulchre", "hallowed tool",
     "ring of endurance", "strange old lockpick"],
    "Sepulchre is accessed from Darkmeyer (Ring of Endurance)"),
  L("dark-altar", "Dark Altar", 1716, 3883, "Kourend", "landmark",
    ["dark altar", "daeyalt essence"],
    "Arceuus necromancer altar"),
  L("tithe-farm", "Tithe Farm", 1796, 3505, "Kourend", "minigame",
    ["tithe farm"],
    "Farming minigame"),
  L("aerial-fishing", "Aerial Fishing", 1740, 3738, "Kourend", "minigame",
    ["aerial fishing", "molch pearls"],
    "Aerial fishing platform"),
  L("forthos", "Forthos Dungeon", 1690, 3570, "Kourend", "dungeon",
    ["forthos"],
    "Dungeon below Shayzien"),

  // ───────────────────────────── Morytania ─────────────────────────────
  L("canifis", "Canifis", 3493, 3488, "Morytania", "city",
    ["canifis", "canifis rooftop",
     "swampbark", "runescroll of swampbark"],
    "Werewolf town (Mort Myre swamp, Runescroll of Swampbark)"),
  L("port-phasmatys", "Port Phasmatys", 3679, 3486, "Morytania", "city",
    ["port phasmatys", "ectofuntus", "ghostspeak",
     "morytania achievement diary", "morytania diary"],
    "Ghost port (Le-Smert, Morytania diary reward-giver)"),
  L("morttown", "Mort'ton", 3487, 3288, "Morytania", "city",
    ["mort'ton", "shades of mort'ton", "sanctity", "pyre logs",
     "bronze chest", "steel chest", "black chest", "silver chest", "gold chest",
     "urium shade", "fiyr shade", "zealot's",
     "his faithful servants",
     "snelm", "snail shell"],
    "Shades minigame town (Snelms from swamp snails, His Faithful Servants)"),
  L("mos-leharmless", "Mos Le'Harmless", 3735, 2999, "Morytania", "city",
    ["mos le'harmless", "harmony island"],
    "Pirate island (accessible from Port Phasmatys)"),
  L("darkmeyer", "Darkmeyer", 3597, 3360, "Morytania", "city",
    ["darkmeyer", "vyre noble", "vyrewatch", "vyre", "blisterwood", "slepe", "blood altar",
     "amulet of blood fury", "sins of the father", "frank", "long rope shortcut",
     "bloodbark", "runescroll of bloodbark"],
    "Vampyre capital (Vyrewatch drop the Runescroll of Bloodbark)"),
  L("barrows", "Barrows", 3567, 3291, "Morytania", "minigame",
    ["barrows", "dharok", "ahrim", "karil", "guthan", "verac", "torag", "dharoks", "ahrims", "karils", "guthans", "veracs", "torags"],
    "Barrows minigame"),
  L("haunted-mine", "Haunted Mine", 3440, 3232, "Morytania", "dungeon",
    ["haunted mine", "lair of tarn", "tarn razorlor", "salve amulet (e)"],
    "Haunted quarry"),
  // Region is "General" (not "Wilderness") to match the wiki's own
  // `leagueRegion = General` LocLine for the Sire — the Abyss is
  // reachable via Mage of Zamorak teleport (Edgeville) or fairy ring
  // DIP without unlocking any region. Pinning the surface anchor in
  // low Wilderness is fine; the region tag is what drives badges.
  L("abyssal-nexus", "Abyssal Nexus / Sire", 3040, 3571, "General", "boss",
    ["abyssal sire", "abyssal nexus", "font of consumption", "unsired", "abyssal whip", "abyssal bludgeon", "abyssal dagger"],
    "Abyssal realm (Mage of Zamorak / fairy ring DIP, General access)"),
  L("slayer-tower", "Slayer Tower", 3428, 3538, "Morytania", "dungeon",
    ["slayer tower", "grotesque guardians", "dusk and dawn", "lithic sceptre",
     "guardian boots", "black tourmaline",
     "granite hammer", "granite ring",
     "abyssal demon", "abyssal whip", "abyssal dagger",
     "slayer helm", "slayer helmet", "assemble a slayer helm"],
    "Morytania slayer tower (Grotesque Guardians; Abyssal demons, whip; Slayer helmet)"),
  L("nightmare", "Sisterhood Sanctuary", 3681, 3373, "Morytania", "boss",
    ["the nightmare", "phosani's nightmare", "nightmare staff",
     "inquisitor", "harmonised", "eldritch", "volatile",
     "sanguinesti", "sanguinesti staff"],
    "Nightmare of Ashihama (Nightmare Staff, Inquisitor, Sanguinesti)"),
  L("spider-cave", "Morytania Spider Cave", 3657, 3407, "Morytania", "boss",
    ["araxxor", "morytania spider cave", "amulet of rancour", "noxious halberd", "aranea boots", "araxyte"],
    "Araxxor's lair"),
  L("temple-trekking", "Temple Trekking", 3480, 3240, "Morytania", "minigame",
    ["temple trek"],
    "Morytania escort minigame"),
  L("trouble-brewing", "Trouble Brewing", 3813, 2973, "Morytania", "minigame",
    ["trouble brewing"],
    "Mos Le'Harmless minigame"),
  L("taxidermist", "Canifis Taxidermist", 3479, 3484, "Morytania", "npc",
    ["taxidermist"],
    "Canifis stuffed-head vendor"),

  // ───────────────────────────── Tirannwn ─────────────────────────────
  // Prifddinas carries the "Soft Clay in Tirannwn" alias because the wiki
  // (Soft_clay page) says "The only place to mine soft clay directly is
  // in the Trahaearn mine" — and Trahaearn is the south-east district of
  // Prifddinas. Lletya has no clay rocks at all, so falling through to
  // it (the previous behaviour) parked the pin ~190 tiles south-east of
  // the actual mining spot.
  L("prifddinas", "Prifddinas", 2210, 3390, "Tirannwn", "city",
    ["prifddinas", "crystal shards", "song of the elves", "iorwerth",
     "crystal armour", "crystal bow", "crystal halberd", "crystal shield", "crystal helmet",
     "crystal helm", "crystal body", "crystal legs", "crystal chest",
     "bow of faerdhinen", "blade of saeldor",
     "trahaearn", "cadarn", "amlodd", "hefin", "ithell", "meilyr",
     "crystal grail", "crystal crown", "elven signet",
     "singing bowl", "eternal teleport crystal", "teleport crystal",
     "crystal tree",
     "dragonstone armour", "dragonstone amulet", "crystal impling",
     "dark bow", "dark beast", "mourner tunnels",
     "soft clay in tirannwn", "soft clay (tirannwn)"],
    "Elf capital (all crystal gear, Trahaearn soft-clay mine, Song of the Elves)"),
  // Lletya carries the Tirannwn anchor for "Leaf-bladed weapon in Tirannwn"
  // (equip-anywhere task — without this it falls back to the Fremennik
  // Slayer Dungeon's Kurask/Turoth drops) and the Whiteberry pick task.
  // Magic logs and Soft Clay used to live here too but moved to their
  // canonical wiki spots (Magic Trees grove, Prifddinas Trahaearn mine).
  L("lletya", "Lletya", 2338, 3171, "Tirannwn", "city",
    ["lletya", "roving elves",
     "whiteberry", "whiteberries",
     "leaf-bladed sword", "leaf-bladed battleaxe", "leaf-bladed spear",
     "leaf-bladed weapon", "leaf bladed"],
    "Elf outpost (Whiteberry bush, Leaf-bladed weapon equip)"),
  // Magic tree grove west of Lletya — the only surface magic-tree cluster
  // in Tirannwn (wiki Magic_tree LocLine "West of Lletya": x=2284..2286,
  // y=3137..3143). Carries the "Chop Magic Logs in Tirannwn" alias so the
  // resolver doesn't fall back to Lletya proper (~70 tiles east of the
  // actual trees) or a Kandarin grove (Seers' Village / Sorcerer's
  // Tower). Only the Tirannwn-scoped alias lives here — a bare "magic
  // log" alias would steal General tasks like "Burn Some Magic Logs".
  L("tirannwn-magic-trees", "Magic trees (Tirannwn)", 2284, 3137, "Tirannwn", "landmark",
    ["magic logs in tirannwn", "magic log in tirannwn"],
    "Surface magic-tree grove west of Lletya"),
  L("tirannwn-mynydd", "Mynydd", 2158, 3423, "Tirannwn", "landmark",
    ["mynydd"],
    "Wilderness of Tirannwn"),
  L("tirannwn-elven-coast", "Isafdar Forest", 2244, 3182, "Tirannwn", "landmark",
    ["isafdar"],
    "Elven forest"),
  L("corrupted-hunllef", "Corrupted Hunllef (Gauntlet)", 2210, 3415, "Tirannwn", "boss",
    ["corrupted hunllef", "crystal blessing", "gauntlet"],
    "The Corrupted Gauntlet"),
  L("zalcano", "Zalcano", 2209, 3396, "Tirannwn", "boss",
    ["zalcano"],
    "Prifddinas boss"),

  // ───────────────────────────── Wilderness ─────────────────────────────
  L("edgeville", "Edgeville", 3080, 3492, "Misthalin", "city",
    ["edgeville",
     "wilderness achievement diary", "wilderness diary"],
    "Wilderness gateway (Lesser Fanatic, Wilderness diary reward-giver)"),
  L("bh", "Mage Arena", 3095, 3955, "Wilderness", "minigame",
    ["mage arena", "mage bank",
     "god cape", "saradomin cape", "zamorak cape", "guthix cape",
     "imbued god cape", "imbued saradomin cape", "imbued zamorak cape", "imbued guthix cape",
     "imbue a god cape",
     "saradomin strike", "claws of guthix", "flames of zamorak"],
    "Mage Arena in deep wildy (God capes + imbue)"),
  L("king-black-dragon", "King Black Dragon (Lava Maze)", 3017, 3849, "Wilderness", "boss",
    ["king black dragon", "kbd", "king's barrage"],
    "KBD Lair (deep wildy lair)"),
  // Wilderness boss pins. Coords are the wiki LocLine `x:`/`y:` for each
  // boss (the surface-pin coord the wiki itself uses on each boss page),
  // NOT the area-page {{Map}} centroid — Bone Yard / Demonic Ruins /
  // Graveyard of Shadows are surface AREAS, not the boss spawn. Each
  // upper-tier boss gets its own canonical lair pin, and the three
  // singles-plus alts (Artio, Spindel, Calvar'ion) share a separate
  // dungeon — Hunter's End, ~150 tiles south-west — that needs its
  // own pin (it is NOT inside Callisto's Den despite the alt-Callisto
  // name). The matching curated entities (callisto/artio/venenatis/
  // spindel/vet'ion/calvar'ion/scorpia/chaos elemental) are dropped
  // from fetch-wiki-entities.py to stop them generating 2-3 visually
  // overlapping pins per lair (same Phantom-Muspah / Nex / Sire / GWD
  // pattern). Chaos Fanatic kept as its own pin (separate location at
  // Mage Arena hut, not a duplicate).
  L("chaos-ele", "Chaos Elemental", 3261, 3927, "Wilderness", "boss",
    ["chaos elemental",
     "dagon'hai", "dagon hai", "dagon'hai robe", "dagon hai robe",
     "elder chaos", "elder chaos hood", "elder chaos robe", "elder chaos top"],
    "West of Rogues' Castle (Dagon'hai, Elder Chaos robes)"),
  L("callisto", "Callisto's Den", 3291, 3849, "Wilderness", "boss",
    ["callisto", "callisto's den", "callistos den",
     "tyrannical ring",
     "ursine chainmace", "ursine", "claws of callisto",
     "voidwaker hilt"],
    "Callisto's Den, south of Demonic Ruins (Tyrannical Ring, Ursine Chainmace, Voidwaker hilt)"),
  L("venenatis", "Silk Chasm", 3319, 3798, "Wilderness", "boss",
    ["venenatis", "silk chasm",
     "treasonous ring",
     "webweaver", "webweaver bow", "fangs of venenatis",
     "voidwaker", "voidwaker blade"],
    "Silk Chasm, lair of Venenatis south-east of Bone Yard (Treasonous Ring, Webweaver, Voidwaker, hilt/blade/gem across all 3 wildy bosses)"),
  L("vetion", "Vet'ion's Rest", 3219, 3788, "Wilderness", "boss",
    ["vet'ion", "vetion", "vet'ion's rest", "vetions rest",
     "ring of the gods",
     "accursed sceptre", "skull of vet'ion",
     "voidwaker gem"],
    "Vet'ion's Rest, north of Bone Yard (Ring of the Gods, Accursed Sceptre, Voidwaker gem)"),
  // Hunter's End is the singles-plus dungeon NW of Ferox Enclave that
  // houses all three lower-tier alts (Artio, Spindel, Calvar'ion) —
  // it is a completely separate lair from each upper-tier boss's own
  // multi-combat den, despite sharing the same drop tables. Coord is
  // Artio's wiki LocLine (x:3116, y:3677); Spindel and Calvar'ion
  // have no LocLine of their own but the wiki Lesser Wilderness Bosses
  // map shows the three sharing this single entrance.
  L("hunters-end", "Hunter's End (lesser wildy bosses)", 3116, 3677, "Wilderness", "dungeon",
    ["hunter's end", "hunters end",
     "artio", "spindel", "calvar'ion", "calvarion",
     "lesser wilderness bosses", "singles plus boss", "singles+ boss"],
    "Singles-plus dungeon NW of Ferox Enclave housing Artio / Spindel / Calvar'ion (same drops as their multi-combat counterparts)"),
  L("scorpia", "Scorpia (Scorpion Pit)", 3232, 3938, "Wilderness", "boss",
    ["scorpia", "scorpion pit"],
    "Scorpion Pit cave entrance, north-east Wilderness"),
  L("chaos-altar", "Chaos Altar (Wilderness)", 3059, 3590, "Wilderness", "landmark",
    ["chaos altar"],
    "Prayer altar in wildy"),
  L("wilderness-slayer-cave", "Wilderness Slayer Cave", 3246, 3740, "Wilderness", "dungeon",
    ["wilderness slayer cave", "revenant",
     "black chinchompa", "black chinchompas",
     "dark crab", "dark crabs",
     "malediction ward", "odium ward",
     "enchanted slayer staff", "slayer staff"],
    "Lava Maze slayer cave (Black Chins, Dark Crabs at Resource Area, Warded shards)"),
  // Coords from the Wilderness God Wars Dungeon wiki page's own
  // {{Map}} (3016.5, 3739.5 — cave east of The Forgotten Cemetery,
  // level 28 Wilderness). Region is `Wilderness` per the page's
  // `leagueRegion` LocLine. Without this landmark the two
  // wildy-GWD tasks ("Enter the Wilderness God Wars Dungeon" /
  // "Obtain an Ecumenical Key") were text-scanning into the regular
  // (Asgarnia) GWD entity pin.
  L("wilderness-god-wars-dungeon", "Wilderness God Wars Dungeon", 3017, 3740, "Wilderness", "dungeon",
    ["wilderness god wars dungeon", "wildy gwd", "wildy god wars",
     "ecumenical key"],
    "Wildy GWD (Ecumenical Keys, alternate Bandos / Armadyl camp access)"),
  L("mage-bank", "Mage Bank", 3095, 3955, "Wilderness", "landmark",
    ["mage bank"],
    "Deep wildy bank"),
  L("rev-caves", "Revenant Caves", 3127, 3805, "Wilderness", "dungeon",
    ["revenant caves", "revenant", "ether", "ethereum", "bracelet of ethereum",
     "viggora", "craw", "thammaron",
     "looting bag"],
    "Revenant cave entrance (Ether, Bracelet of Ethereum, Viggora/Craw/Thammaron)"),
  L("wilderness-agility", "Wilderness Agility Course", 3005, 3931, "Wilderness", "minigame",
    ["wilderness agility"],
    "Deep-wildy course"),
  L("corporeal-beast", "Corporeal Beast", 3203, 3681, "Wilderness", "boss",
    ["corporeal beast", "corpbane", "spirit shield"],
    "Corporeal beast cave (wilderness)"),

  // ───────────────────────────── Resource / multi-spot anchors ─────────────────────────────
  // These are used by the resolver for tasks like "Chop 100 willow logs".
  // Wiki says Draynor Village = Misthalin (locked in DP) — these willows
  // are inaccessible this league; the resolver will fall back to
  // willows-catherby (Kandarin) for any "willow log" tasks.
  L("willows-draynor", "Willow Trees: Draynor", 3088, 3239, "Misthalin", "resource",
    ["willow log", "willow logs", "willow shortbow", "willow longbow"],
    "Draynor willow spot (Misthalin, locked in DP league)"),
  L("willows-catherby", "Willow Trees: Catherby", 2774, 3445, "Kandarin", "resource",
    ["willow log"],
    "Alt willow spot (Kandarin)"),
  L("maples-seers", "Maple Trees: Seers' Village", 2728, 3502, "Kandarin", "resource",
    ["maple log", "maple longbow", "maple shortbow"],
    "Best maple spot (Kandarin)"),
  // Wiki tags Edgeville as Misthalin (locked in DP league). The graveyard
  // yews sit south of the wilderness border at y=3475, so the wiki
  // classification holds. Yew tasks should fall back to yews-varlamore.
  L("yews-edgeville", "Yew Trees: Edgeville", 3087, 3475, "Misthalin", "resource",
    ["yew log", "yew longbow", "yew shortbow"],
    "Yews in Edgeville graveyard (Misthalin, locked in DP league)"),
  L("yews-varlamore", "Yew Trees: Quetzacalli Gorge", 1625, 2997, "Varlamore", "resource",
    ["yew log"],
    "Yews in Varlamore Avium Savannah"),
  // Coords (2710, 3488) anchor the Seers' Village magic-tree grove
  // (Kandarin per wiki). Previously labeled "Sorcerer's Garden" by mistake
  // — the actual Sorceress's Garden is at game (3322, 3137) in the Desert
  // and contains Sq'irk trees, not magic trees.
  L("magics-sorceress", "Magic Trees: Seers' Village", 2710, 3488, "Kandarin", "resource",
    ["magic log", "magic longbow", "magic shortbow", "magic shield"],
    "Magic trees south of Seers' Village (the wiki-canonical Kandarin grove)"),
  // East Auburn Valley magic-tree grove — wiki LocLine has two trees at
  // (1449, 3323) and (1452, 3320); the medoid below is the on-grove pin.
  // Previous coord (1293, 3073) was nowhere near Auburn Valley — it sat
  // in the Tlati Rainforest south of the Hunter Guild, presumably copy-
  // pasted from a different landmark and never verified.
  L("magics-auburn", "Magic Trees: Auburn Valley", 1450, 3322, "Varlamore", "resource",
    ["magic log", "magic logs in varlamore"],
    "Magic trees in the Auburn Valley (east of Auburnvale)"),
  L("iron-mine-dwarven", "Iron Rocks: Dwarven Mine", 3018, 3450, "Asgarnia", "resource",
    ["iron ore"],
    "Central iron mining (Falador)"),
  L("coal-mine-mining-guild", "Coal Rocks: Mining Guild", 3019, 3339, "Asgarnia", "resource",
    ["coal"],
    "Falador Mining Guild coal"),
  L("mithril-mining-guild", "Mithril Rocks: Mining Guild", 3019, 3339, "Asgarnia", "resource",
    ["mithril ore"],
    "Mithril in Mining Guild (anchor: guild entrance)"),
  L("adamantite-mining-guild", "Adamantite Rocks: Mining Guild", 3019, 3339, "Asgarnia", "resource",
    ["adamantite ore"],
    "Adamantite in Mining Guild"),
  L("runite-mining-guild", "Runite Rocks: Mining Guild", 3019, 3339, "Asgarnia", "resource",
    ["runite"],
    "Runite in expanded Mining Guild"),
  // Wilderness + Tirannwn runite rock anchors. The "Mine some Runite ore
  // in the Wilderness / Tirannwn" tasks were resolving to the Asgarnia
  // Mining Guild because no same-region runite landmark existed and the
  // landmark resolver fell through to the all-region scan, picking up
  // the Mining Guild's "runite" alias. Coords are the wiki LocLines on
  // [[Runite rocks]] for the iconic surface mines in each region.
  L("runite-lava-maze", "Runite Rocks: Lava Maze", 3059, 3885, "Wilderness", "resource",
    ["runite", "runite ore", "runite rocks"],
    "Lava Maze runite mine, level ~45 wildy (the canonical free-to-mine wildy rune rocks)"),
  L("runite-isafdar", "Runite Rocks: Isafdar", 2280, 3160, "Tirannwn", "resource",
    ["runite", "runite ore", "runite rocks"],
    "Isafdar surface runite rocks, west of the Lletya path"),
  L("silver-mine-crafting-guild", "Silver Rocks: Crafting Guild", 2932, 3281, "Asgarnia", "resource",
    ["silver ore"],
    "Crafting guild silver"),
  // Edgeville Dungeon (per wiki) is in Misthalin, not Wilderness — the
  // dungeon entrance ladder is south of the wildy line. Hill giants tasks
  // will resolve via wiki entity pins (multi-region) instead.
  L("hill-giants-edge", "Hill Giants: Edgeville Dungeon", 3097, 3469, "Misthalin", "resource",
    ["hill giant"],
    "Edgeville dungeon hill giants (Misthalin, locked in DP league)"),
  // Aliases include "seers' village agility" and "seers' village
  // rooftop" so the task-name-bonus in the resolver fires on
  // #922 "Complete the Seers' Village Agility Course" — otherwise
  // `camelot` wins via its "seers' village" alias even though the
  // course start is 230 tiles SW of the castle. The bare "rooftop
  // agility" alias used to live here too but it false-matched any
  // wiki link containing "Rooftop Agility Course" — including the
  // Ardougne course — so it's been dropped in favour of region-specific
  // phrases that can only match the Seers' Village course.
  L("seers-rooftop", "Seers' Rooftop Agility", 2729, 3486, "Kandarin", "minigame",
    ["seers' rooftop", "seers rooftop",
     "seers' village agility", "seers village agility",
     "seers' village rooftop", "seers village rooftop",
     "canifis rooftop", "werewolf agility", "marks of grace"],
    "Seers' village rooftop course"),
  L("tempoross", "Tempoross", 3035, 2850, "Desert", "boss",
    ["tempoross",
     "angler", "angler's outfit", "anglers outfit", "angler hat", "angler top", "angler waders", "angler boots",
     "spirit angler", "fish barrel"],
    "Fishing minigame boss (Angler's Outfit, Spirit Angler, Fish Barrel)"),
  L("wintertodt", "Wintertodt", 1630, 3981, "Kourend", "boss",
    ["wintertodt",
     "frozen cache", "warm gloves", "pyromancer"],
    "Firemaking boss in Shayzien (Frozen Caches, Pyromancer outfit)"),
  L("zanaris", "Zanaris (via Aldarin fairy ring)", 1651, 3010, "General", "landmark",
    ["zanaris", "cosmic altar", "cosmic rune", "aether rune"],
    "Zanaris + cosmic altar: reach via the Aldarin fairy ring (DJR). The canonical Lumbridge Swamp entrance is in Misthalin, which is locked this league."),
  L("puro-puro", "Puro-Puro (Ardougne crop circle)", 2669, 3316, "General", "minigame",
    ["puro-puro"],
    "Implings realm, enter via the Ardougne wheat-field crop circle (Lumbridge/Draynor wheat fields are in Misthalin and locked)."),
  L("abyss", "The Abyss", 3104, 3560, "Wilderness", "landmark",
    ["abyss", "abyssal area"],
    "Runecraft Abyss (anchor: Edgeville ditch)"),
  L("fairy-ring-ckq", "Fairy Ring CKQ", 1404, 2930, "Varlamore", "landmark",
    ["fairy ring (ckq)"],
    "Aldarin fairy ring"),

  // ─────────────── Runecrafting altars (accessible regions only) ───────────────
  // Air/Mind altars are in Misthalin and are skipped this league.
  // Blood/Soul altars are in Arceuus and already covered by the `arceuus`
  // landmark's aliases. Nature altar has its own entry above.
  L("fire-altar", "Fire Altar", 3313, 3256, "Desert", "landmark",
    ["fire altar", "fire rune", "lava rune", "smoke rune", "steam rune"],
    "Fire Altar ruin east of Al Kharid (source of fire/lava/smoke/steam runes)"),
  L("body-altar", "Body Altar", 2848, 3448, "Asgarnia", "landmark",
    ["body altar", "body rune"],
    "Body Altar ruin south of Taverley"),
  L("law-altar", "Law Altar", 2858, 3379, "Asgarnia", "landmark",
    ["law altar", "law rune"],
    "Law Altar ruin on Entrana (reached from Port Sarim)"),
  L("astral-altar", "Astral Altar (Lunar Isle)", 2156, 3864, "Fremennik", "landmark",
    ["astral altar", "astral rune",
     "lunar spellbook", "moonclan teleport", "lunar diplomacy",
     "fertile soil", "spellbook swap", "dream mentor",
     "moonclan armour", "lunar staff", "lunar helm"],
    "Astral Altar / Lunar Isle (Lunar spellbook, Moonclan teleport, Fertile Soil, Spellbook Swap)"),
  L("wrath-altar", "Wrath Altar", 2446, 2848, "Kandarin", "landmark",
    ["wrath altar", "wrath rune"],
    "Wrath Altar at the Myths' Guild basement"),
  L("death-altar", "Death Altar (Temple of Light)", 2208, 3255, "Tirannwn", "landmark",
    ["death altar", "death rune"],
    "Death Altar in the Temple of Light below Isafdar"),
  L("ourania-altar", "Ourania Altar (ZMI)", 2452, 3231, "Kandarin", "landmark",
    ["ourania altar", "zamorak magical institute", "zmi altar", "red salamander"],
    "ZMI altar west of West Ardougne"),

  // ─────────────── Raid bosses / high-level PvM ───────────────
  L("theatre-of-blood", "Theatre of Blood (Ver Sinhaza)", 3671, 3224, "Morytania", "raid",
    ["theatre of blood", "ver sinhaza", "tob",
     "ghrazi rapier", "avernic defender",
     "scythe of vitur",
     "justiciar", "justiciar faceguard", "justiciar chestguard", "justiciar legguards",
     "sanguine dust", "holy ornament kit"],
    "ToB raid (Ghrazi Rapier, Avernic Defender, Justiciar, Scythe)"),
  // Anchored at the Taverley Dungeon ladder (2884, 3398) per the wiki
  // {{Map|x=2884|y=3398}} on the Taverley Dungeon page — same tile as
  // the descend-to-Cerberus path through the hellhound area. Carries
  // BOTH the Cerberus boss/drops aliases AND the "taverley dungeon"
  // alias so that #167 "Enter the Taverley Dungeon", #717 "Unlock a
  // Gate in Taverley Dungeon", and the 5 Cerberus tasks all collapse
  // onto a single pin (the dungeon entry tile is the only meaningful
  // surface destination for any of them). Used to be at (2874, 3426);
  // moved to the canonical ladder so the dungeon-tagged tasks land on
  // the actual entry tile instead of the open Taverley pasture.
  L("cerberus", "Taverley Dungeon (Cerberus's Lair)", 2884, 3398, "Asgarnia", "dungeon",
    ["cerberus", "smouldering stone", "hellhound",
     "primordial boots", "pegasian boots", "eternal boots",
     "primordial crystal", "pegasian crystal", "eternal crystal",
     "taverley dungeon"],
    "Taverley Dungeon ladder, hellhound area descends to Cerberus's Lair (Primordial/Pegasian/Eternal Boots)"),
  L("camdozaal", "Ruins of Camdozaal", 2987, 3501, "Asgarnia", "dungeon",
    ["camdozaal", "below ice mountain", "ruins of camdozaal",
     "imcando hammer", "imcando pickaxe",
     "ornate lockbox", "camdozaal vault"],
    "Camdozaal under Ice Mountain (Imcando Hammer, Ornate Lockboxes)"),
  L("ape-atoll", "Ape Atoll", 2784, 2784, "Kandarin", "landmark",
    ["ape atoll", "monkey madness",
     "dragon scimitar",
     "monkey backpack", "karamja monkey backpack", "maniacal monkey backpack",
     "heavy ballista", "light ballista",
     "crash site cavern", "demonic gorilla",
     "zenyte shard", "zenyte jewelry"],
    "Monkey Madness island south of Karamja (Dragon Scimitar, Monkey backpacks, Ballistae, Zenyte)"),
  L("kraken-cove", "Kraken Cove", 2280, 3617, "Kandarin", "boss",
    ["kraken", "kraken cove", "cave kraken", "trident of the seas", "kraken tentacle",
     "abyssal tentacle"],
    "Kraken Cove north of Piscatoris (Trident of the Seas, Kraken tentacle → abyssal tentacle)"),
  L("ancient-cavern", "Ancient Cavern", 2513, 3513, "Kandarin", "dungeon",
    ["ancient cavern", "mithril dragon", "dragon full helm", "waterfall dungeon"],
    "Baxtorian Falls underground (Mithril Dragons, Dragon Full Helm)"),
  L("horror-lighthouse", "Lighthouse (Horror from the Deep)", 2510, 3640, "Fremennik", "quest",
    ["lighthouse", "horror from the deep",
     "god book", "damaged god book", "completed god book",
     "book of balance", "holy book", "book of darkness", "unholy book"],
    "Lighthouse north of Barbarian Outpost (God Books from Horror from the Deep)"),
  // Anchored at Weiss / Salt Mine entry (the actual surface entry the
  // player uses to reach the Muspah's chamber via Ghorrock Dungeon),
  // NOT the deep-Wilderness Ghorrock fortress proper. The fortress
  // coord (~2977, 3896) sits well outside the Fremennik area on the
  // map and visually splits the Muspah pin from where the player
  // actually walks in. Bare "ghorrock" and "ghorrock teleport" are
  // intentionally NOT in the alias list — they whole-word-matched
  // "Craft a Ghorrock Teleport Tablet" (wiki-tagged Desert) and put
  // a Desert-badged pin on a Fremennik landmark. The remaining
  // aliases catch every Muspah-related task (boss kills, CA, Ancient
  // Sceptre line, Mine Ancient Essence) on a single pin.
  L("ghorrock-dungeon", "Phantom Muspah", 2870, 3940, "Fremennik", "boss",
    ["ghorrock dungeon", "ancient essence", "phantom muspah",
     "ancient sceptre", "ice ancient sceptre", "shadow ancient sceptre"],
    "Phantom Muspah's lair, accessed via Weiss → Salt Mine → Ghorrock Dungeon (Ancient Sceptre, Ancient Essence)"),

  // ─────────────── Additional quest/activity anchors ───────────────
  L("sorceress-garden", "Sorceress's Garden", 3320, 3141, "Desert", "minigame",
    ["sorceress's garden", "sorceresses garden", "sorceress garden",
     "winter sq'irk", "autumn sq'irk", "spring sq'irk", "summer sq'irk",
     "sq'irk"],
    "Thieving minigame in Al Kharid palace"),
  L("uzer", "Uzer", 3419, 3159, "Desert", "landmark",
    ["uzer", "the golem"],
    "Ruined city east of the Kharidian Desert (The Golem quest)"),
  L("observatory", "Observatory", 2440, 3159, "Kandarin", "quest",
    ["observatory quest", "the observatory"],
    "Professor's observatory south-west of East Ardougne"),
  L("tower-of-life", "Tower of Life", 2648, 3213, "Kandarin", "dungeon",
    ["tower of life", "tower of life (building)",
     "frogeel", "newtroost", "spidine", "swordchick", "jubster"],
    "Tower of Life (Ardougne), creature-building basement"),
];

export const LOCATION_BY_ID: Record<string, WorldLocation> = Object.fromEntries(
  LOCATIONS.map((l) => [l.id, l]),
);
