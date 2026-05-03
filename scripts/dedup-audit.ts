import placementsData from "../src/data/generated/placements.json" with { type: "json" };
import locationsData from "../src/data/generated/locations.json" with { type: "json" };
import tasks from "../src/data/tasks.json" with { type: "json" };

interface Placement {
  taskId: string;
  primary: string | null;
  locations: string[];
}

const placements = placementsData as unknown as Placement[];
const locations = locationsData as unknown as Array<{
  id: string;
  name: string;
  x: number;
  y: number;
  region?: string;
}>;
const taskMap = new Map(
  (tasks as unknown as Array<{ id: string; name: string }>).map((t) => [
    t.id,
    t.name,
  ])
);
const locById = new Map(locations.map((l) => [l.id, l]));
const placementByTask = new Map(placements.map((p) => [p.taskId, p]));

interface Group {
  label: string;
  taskIds: string[];
}

const GROUPS: Group[] = [
  {
    label: "Black Chinchompas (Wilderness)",
    taskIds: ["888", "1042", "1043", "1416"],
  },
  {
    label: "Wilderness Diary",
    taskIds: ["503", "513", "918", "1365"],
  },
  {
    label: "Fishing Trawler / Angler's Outfit",
    taskIds: ["489" /* trawler game */],
  },
  {
    label: "Tower of Life cluster",
    taskIds: ["487", "547", "557", "561", "564", "1008"],
  },
  {
    label: "Funeral Pyre / Dragon Full Helm",
    taskIds: ["640", "1574"],
  },
  {
    label: "Gauntlet / Corrupted Hunllef",
    taskIds: ["909", "910", "1355", "1356", "1357", "1510"],
  },
  {
    label: "Zalcano",
    taskIds: ["998", "999", "1174", "1406", "1526", "1527"],
  },
  {
    label: "Prifddinas (Tower of Voices)",
    taskIds: ["909", "910"], // expected to land on corrupted-hunllef, NOT prifddinas
  },
  {
    label: "BA role level (was unmappable)",
    taskIds: ["1533"],
  },
  {
    label: "Crystal Grail (Elven Rabbit Cave)",
    taskIds: ["1428"],
  },
  {
    label: "Singing Bowl (Ithell)",
    taskIds: ["930", "931"],
  },
  {
    label: "Soft Clay (Tirannwn)",
    taskIds: ["1130"],
  },
];

let failed = false;
for (const group of GROUPS) {
  console.log(`\n=== ${group.label} ===`);
  const ids = new Set<string>();
  for (const tid of group.taskIds) {
    const p = placementByTask.get(tid);
    const tname = taskMap.get(tid) ?? "??";
    if (!p) {
      console.log(`  #${tid} ${tname}\n     ⚠ NO PLACEMENT`);
      continue;
    }
    const primary = p.primary ?? "(none)";
    const loc = primary === "(none)" ? null : locById.get(primary);
    console.log(
      `  #${tid} ${tname}\n     primary=${primary}` +
        (loc ? ` @ (${loc.x},${loc.y}) [${loc.name}]` : "")
    );
    if (p.primary) ids.add(p.primary);
  }
  if (ids.size > 1) {
    failed = true;
    console.log(`  ❌ ${ids.size} distinct primary location ids — DUP PINS!`);
  } else if (ids.size === 1) {
    console.log(`  ✓ all share one primary location id`);
  }
}

console.log(`\n${failed ? "❌ AUDIT FAILED" : "✅ AUDIT PASSED"}`);
process.exit(failed ? 1 : 0);
