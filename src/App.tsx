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
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);

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
        for (const locId of placement.locations) {
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
  }, []);

  const handleSelectLocation = useCallback((id: string | null) => {
    setSelectedLocationId(id);
  }, []);

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
          onToggle={() => setFiltersOpen((v) => !v)}
        />
        <TaskList
          tasks={mappableTasks}
          unmappableTasks={unmappableTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelectTask}
          onSelectLocation={handleSelectLocation}
          open={tasksOpen}
          onToggle={() => setTasksOpen((v) => !v)}
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
