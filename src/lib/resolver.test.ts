import { describe, expect, it } from "vitest";
import { REGION_DISPLAY_ORDER } from "../types";
import { resolveTask } from "./resolver";
import { ALL_TASKS, getLocation, getPlacement, getTask } from "./taskIndex";

describe("league task placements", () => {
  it.each([
    ["301", "Equip a Yew Shortbow", "yews-varlamore"],
    ["325", "Fletch 50 Willow longbow (u)", "willows-catherby"],
    ["326", "Fletch a Willow Shortbow (u)", "willows-catherby"],
    ["796", "Fletch 50 Yew longbow (u)", "yews-varlamore"],
  ])("pins %s (%s) in a selectable league region", (id, _name, locationId) => {
    const placement = resolveTask(getTask(id)!);
    expect(placement).toMatchObject({
      primary: locationId,
      locations: [locationId],
      unmappable: false,
    });
    expect(getPlacement(id)).toEqual(placement);
    expect(REGION_DISPLAY_ORDER).toContain(getLocation(locationId)?.region);
  });

  it("gives every General mappable task a pin in a selectable region", () => {
    const inaccessible = ALL_TASKS.filter((task) => {
      const placement = getPlacement(task.id)!;
      return task.region === "General" && !placement.unmappable &&
        !placement.locations.some((id) => {
          const location = getLocation(id);
          return location && REGION_DISPLAY_ORDER.includes(location.region);
        });
    });
    expect(inaccessible.map((task) => task.name)).toEqual([]);
  });
});
