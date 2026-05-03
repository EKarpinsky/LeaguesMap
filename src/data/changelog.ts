/**
 * In-app changelog. Newest entry first.
 *
 * Drives the auto-popup "What's new" modal in App.tsx. The modal opens
 * once per release the user hasn't seen, and the user can permanently
 * suppress it via a checkbox. Manual access via the header link
 * bypasses both gates so suppression only kills the auto-popup, not
 * access. See the App.tsx changelog block for the gating decision tree.
 *
 * To ship a release: prepend a new ChangelogEntry above the existing
 * entries. LATEST_VERSION is derived from the first entry, so the
 * modal will auto-pop for users who haven't seen the new version.
 */

export interface ChangelogEntry {
  /** ISO date (YYYY-MM-DD) the release shipped. */
  date: string;
  /** Human-facing version label, e.g. "v1.4". */
  version: string;
  /**
   * One-line summaries of user-visible fixes. Keep each line short
   * enough to read at a glance. Full context belongs in the commit.
   */
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-05-03",
    version: "v1.4",
    highlights: [
      "Wilderness: Black Chinchompa equip and catch tasks now share one orb at the Mage Arena hunting ground (no more split between the slayer cave and the chin hunting site).",
      "Wilderness: Wilderness Diary tasks now appear at Ferox Enclave (the Lesser Fanatic relocates here in Demonic Pacts since Misthalin is locked).",
      "Kandarin: Fishing Trawler and Equip a Full Angler's Outfit collapse onto a single Port Khazard orb.",
      "Kandarin: Tower of Life entries (quest start, creature dungeon, equip-while-dressed) merged onto one Tower of Life orb.",
      "Kandarin: Light a Pyre Ship and Equip a Dragon Full Helm now share the Ancient Cavern (Otto's Grotto) orb.",
      "Tirannwn: Prifddinas unbloated. Split into Tower of Voices, Trahaearn Mine, Singing Bowl (Ithell), Gauntlet (NW corner), Zalcano (SE Trahaearn), and a new Elven Rabbit Cave orb for the Crystal Grail.",
      "Kandarin: 'Reach Level 5 in Any Barbarian Assault Role' is now a real spatial task at Barbarian Outpost (was incorrectly flagged as non-spatial).",
    ],
  },
];

/**
 * The version the in-app changelog will treat as "current". Auto-popup
 * compares this against `lm.changelogSeenVersion` in localStorage to
 * decide whether to greet the user with the modal.
 */
export const LATEST_VERSION = CHANGELOG[0].version;
