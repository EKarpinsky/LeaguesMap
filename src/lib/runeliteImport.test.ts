import { describe, expect, it } from "vitest";
import fixture from "./fixtures/tasks-tracker.json";
import { parseTasksTrackerExport } from "./runeliteImport";

describe("Tasks Tracker import", () => {
  it("decodes a synthetic export, including signed bits and the final task", () => {
    const result = parseTasksTrackerExport(JSON.stringify(fixture));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect([...result.completedIds]).toEqual(["0", "2", "31", "33", "1568", "1591"]);
    expect(result.displayName).toBe("Test adventurer");
    expect(result.taskType).toBe("DEMONIC_PACTS_LEAGUE");
    expect(result.stats).toEqual({
      varpsCovered: 4,
      varpsTotal: 62,
      bitsSet: 7,
      matchedTasks: 6,
      unknownIds: 1,
    });
  });

  it.each(["", "{", "null", "{}", '{"varps":{}}', '{"varps":{"2616":0}}'])(
    "rejects unusable input: %s",
    (raw) => expect(parseTasksTrackerExport(raw).ok).toBe(false),
  );
});
