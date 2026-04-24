import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import FilterSidebar from "./components/FilterSidebar";
import TaskList from "./components/TaskList";
import { defaultFilters, matchesFilter } from "./lib/filters";
import type { FilterState } from "./lib/filters";
import { ALL_PLACEMENTS, ALL_TASKS, getPlacement } from "./lib/taskIndex";
import { REGION_PALETTE } from "./types";
import type { Task } from "./types";
import "./App.css";

// Leaflet + MapView together are ~230 KB gz. Lazy-load them so the
// initial paint (title, filters, task list) doesn't wait on the map
// runtime. The `<link rel="preload">` in index.html kicks off the map
// image download in parallel, so visually the map still shows up fast.
const MapView = lazy(() => import("./components/MapView"));

/**
 * Push the region palette from `types.ts` onto `:root` as CSS custom
 * properties (`--region-karamja`, `--region-karamja-text`, …) so CSS files
 * can reference them without hard-coding hex codes. One TS source of
 * truth, consumed by both the map pins and every region-colored chip/tag.
 */
function applyRegionPalette(): void {
  const root = document.documentElement;
  for (const [region, { base, text }] of Object.entries(REGION_PALETTE)) {
    const slug = region.toLowerCase();
    root.style.setProperty(`--region-${slug}`, base);
    root.style.setProperty(`--region-${slug}-text`, text);
  }
}

function App() {
  useEffect(applyRegionPalette, []);

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null,
  );
  // On phones/iPads the sidebar is a bottom sheet floating over the map.
  // If both accordions start open the sheet eats ~70% of the screen and
  // hides the map — so on small viewports we default to collapsed and let
  // the user tap in. On desktop we keep both open so the content is
  // immediately visible without a discovery tax.
  const isMobileInitial =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 900px)").matches;
  const [filtersOpen, setFiltersOpen] = useState(!isMobileInitial);
  const [tasksOpen, setTasksOpen] = useState(!isMobileInitial);

  const { mappableTasks, unmappableTasks, tasksByLocation } = useMemo(() => {
    const mappable: Task[] = [];
    const unmappable: Task[] = [];
    const byLoc = new Map<string, Task[]>();
    for (const task of ALL_TASKS) {
      const placement = ALL_PLACEMENTS.find((p) => p.taskId === task.id)!;
      if (!matchesFilter(task, placement, filters)) continue;
      if (placement.unmappable) {
        unmappable.push(task);
      } else {
        mappable.push(task);
        // Pin the task at one place per task, not at every wiki-linked
        // entity. Without this, "Enter the Wizards' Guild in Yanille"
        // (wikiLinks: [Wizards' Guild, Yanille]) shows up at BOTH the
        // Wizards' Guild entity pin AND the Yanille landmark pin —
        // user-visible duplication. The resolver already picks the
        // best-fit primary (entity-name-in-task-name + same-region),
        // so we trust it and pin there.
        //
        // Exception: "General"-region tasks like "Pickpocket a Citizen"
        // are intentionally pinned in every region the entity spawns
        // in, so the player sees a marker in each league area they've
        // unlocked. For those we keep the full locations fan-out.
        const ids =
          task.region === "General"
            ? placement.locations
            : [placement.primary ?? placement.locations[0]];
        for (const locId of ids) {
          if (!locId) continue;
          const arr = byLoc.get(locId) ?? [];
          arr.push(task);
          byLoc.set(locId, arr);
        }
      }
    }
    return {
      mappableTasks: mappable,
      unmappableTasks: unmappable,
      tasksByLocation: byLoc,
    };
  }, [filters]);


  const handleSelectTask = useCallback((id: string) => {
    setSelectedTaskId(id);
    const placement = getPlacement(id);
    if (placement && placement.locations.length > 0) {
      setSelectedLocationId(placement.primary ?? placement.locations[0]);
    }
    // On the mobile bottom-sheet layout, the sidebar is floating over the
    // map. If we leave the accordions expanded after a task tap, the user
    // never sees the pin they just selected because the sheet covers it.
    // Collapse both so the sheet shrinks to its peek state and the map
    // (with the now-open popup) is visible behind.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
    ) {
      setFiltersOpen(false);
      setTasksOpen(false);
    }
  }, []);

  const handleSelectLocation = useCallback((id: string | null) => {
    setSelectedLocationId(id);
  }, []);

  // On the mobile bottom sheet we treat Filters and Tasks as mutually
  // exclusive: opening one closes the other and the open section takes
  // the full sheet height. Desktop keeps both open at once, since
  // there's plenty of vertical room in the fixed left column.
  const isMobileNow = useCallback(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches,
    [],
  );
  const toggleFilters = useCallback(() => {
    setFiltersOpen((v) => {
      const next = !v;
      if (next && isMobileNow()) setTasksOpen(false);
      return next;
    });
  }, [isMobileNow]);
  const toggleTasks = useCallback(() => {
    setTasksOpen((v) => {
      const next = !v;
      if (next && isMobileNow()) setFiltersOpen(false);
      return next;
    });
  }, [isMobileNow]);

  const panelClass = [
    "left-panel",
    filtersOpen ? "" : "filters-collapsed",
    tasksOpen ? "" : "tasks-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-shell">
      <aside className={panelClass}>
        <header className="app-title">
          <h1>Demonic Pacts Tasks Map</h1>
        </header>
        <FilterSidebar
          filters={filters}
          setFilters={setFilters}
          open={filtersOpen}
          onToggle={toggleFilters}
        />
        <TaskList
          tasks={mappableTasks}
          unmappableTasks={unmappableTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelectTask}
          onSelectLocation={handleSelectLocation}
          open={tasksOpen}
          onToggle={toggleTasks}
        />
      </aside>
      <main className="app-map">
        <Suspense fallback={<div className="map-fallback" aria-hidden />}>
          <MapView
            tasksByLocation={tasksByLocation}
            selectedLocationId={selectedLocationId}
            onSelectLocation={handleSelectLocation}
            onSelectTask={handleSelectTask}
          />
        </Suspense>
      </main>
    </div>
  );
}

export default App;
