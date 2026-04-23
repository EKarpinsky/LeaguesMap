import { useEffect, useMemo, useRef } from "react";
import { DIFFICULTIES, REGION_DISPLAY_ORDER } from "../types";
import type { Difficulty, Region } from "../types";
import { matchesFilter } from "../lib/filters";
import type { FilterState } from "../lib/filters";
import { ALL_PLACEMENTS, ALL_TASKS } from "../lib/taskIndex";
import "./FilterSidebar.css";

export interface FilterSidebarProps {
  filters: FilterState;
  setFilters: (updater: (prev: FilterState) => FilterState) => void;
  open: boolean;
  onToggle: () => void;
}

interface FacetCounts {
  regionCounts: Record<Region, number>;
  difficultyCounts: Record<Difficulty, number>;
}

/**
 * Leave-one-out counts: each number answers "how many tasks are in this
 * bucket if every other filter stays where it is". Lets users see the
 * impact of toggling a row without double-counting their current
 * selection on the same axis.
 */
function useFacetCounts(filters: FilterState): FacetCounts {
  return useMemo(() => {
    const regionCounts = Object.fromEntries(
      REGION_DISPLAY_ORDER.map((r) => [r, 0]),
    ) as Record<Region, number>;
    const difficultyCounts = Object.fromEntries(
      DIFFICULTIES.map((d) => [d, 0]),
    ) as Record<Difficulty, number>;

    const regionsAllOn: FilterState = {
      ...filters,
      regions: new Set<Region>(REGION_DISPLAY_ORDER),
    };
    const diffAllOn: FilterState = {
      ...filters,
      difficulties: new Set<Difficulty>(DIFFICULTIES),
    };

    for (let i = 0; i < ALL_TASKS.length; i++) {
      const t = ALL_TASKS[i];
      const p = ALL_PLACEMENTS[i];
      if (matchesFilter(t, p, regionsAllOn) && t.region in regionCounts) {
        regionCounts[t.region as Region] += 1;
      }
      if (matchesFilter(t, p, diffAllOn)) {
        difficultyCounts[t.difficulty] += 1;
      }
    }
    return { regionCounts, difficultyCounts };
  }, [filters]);
}

export default function FilterSidebar({
  filters,
  setFilters,
  open,
  onToggle,
}: FilterSidebarProps) {
  const { regionCounts, difficultyCounts } = useFacetCounts(filters);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) onToggle();
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  const toggleRegion = (r: Region) =>
    setFilters((f) => {
      const next = new Set(f.regions);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return { ...f, regions: next };
    });
  const toggleDifficulty = (d: Difficulty) =>
    setFilters((f) => {
      const next = new Set(f.difficulties);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return { ...f, difficulties: next };
    });

  const allRegionsOn = filters.regions.size === REGION_DISPLAY_ORDER.length;
  const allDifficultiesOn = filters.difficulties.size === DIFFICULTIES.length;

  const toggleAllRegions = () =>
    setFilters((f) => ({
      ...f,
      regions: allRegionsOn
        ? new Set<Region>()
        : new Set<Region>(REGION_DISPLAY_ORDER),
    }));
  const toggleAllDifficulties = () =>
    setFilters((f) => ({
      ...f,
      difficulties: allDifficultiesOn
        ? new Set<Difficulty>()
        : new Set<Difficulty>(DIFFICULTIES),
    }));

  const activeCount =
    (filters.regions.size < REGION_DISPLAY_ORDER.length
      ? REGION_DISPLAY_ORDER.length - filters.regions.size
      : 0) +
    (filters.difficulties.size < DIFFICULTIES.length
      ? DIFFICULTIES.length - filters.difficulties.size
      : 0) +
    (filters.search ? 1 : 0) +
    (filters.pactOnly ? 1 : 0) +
    (!filters.includeCentroidFallbacks ? 1 : 0) +
    (!filters.includeUnmappable ? 1 : 0);

  return (
    <div className={`filters-region ${open ? "open" : "collapsed"}`}>
      <button
        type="button"
        className="accordion-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Chevron open={open} />
        <span className="accordion-title">Filters</span>
        {activeCount > 0 && (
          <span className="accordion-badge">{activeCount}</span>
        )}
      </button>
      <div className="filters-body" hidden={!open}>
      <div className="sb">
        <SearchIcon />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search tasks"
          value={filters.search}
          onChange={(e) =>
            setFilters((f) => ({ ...f, search: e.target.value }))
          }
        />
        {filters.search ? (
          <button
            className="sb-clear"
            type="button"
            onClick={() => setFilters((f) => ({ ...f, search: "" }))}
            aria-label="Clear search"
          >
            ×
          </button>
        ) : (
          <kbd className="sb-kbd" aria-hidden>
            ⌘K
          </kbd>
        )}
      </div>

      <section className="sect">
        <div className="sect-head">
          <h3>
            Region
            {!allRegionsOn && (
              <span className="sect-meta">
                {filters.regions.size} of {REGION_DISPLAY_ORDER.length}
              </span>
            )}
          </h3>
          <button type="button" onClick={toggleAllRegions}>
            {allRegionsOn ? "None" : "All"}
          </button>
        </div>

        <div className="rgrid">
          {REGION_DISPLAY_ORDER.map((r) => {
            const active = filters.regions.has(r);
            const hasBadge = r !== "General";
            return (
              <button
                key={r}
                type="button"
                className={`rtile region-${r.toLowerCase()} ${active ? "on" : "off"}`}
                onClick={() => toggleRegion(r)}
                aria-pressed={active}
              >
                <span className="rtile-icon">
                  {hasBadge ? (
                    <img
                      src={`/icons/region/${r.toLowerCase()}.png`}
                      alt=""
                      width={22}
                      height={33}
                    />
                  ) : (
                    <span className="rtile-dot" aria-hidden />
                  )}
                </span>
                <span className="rtile-name">{r}</span>
                <span className="rtile-count tabular">
                  {regionCounts[r] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="sect">
        <div className="sect-head">
          <h3>
            Difficulty
            {!allDifficultiesOn && (
              <span className="sect-meta">
                {filters.difficulties.size} of {DIFFICULTIES.length}
              </span>
            )}
          </h3>
          <button type="button" onClick={toggleAllDifficulties}>
            {allDifficultiesOn ? "None" : "All"}
          </button>
        </div>

        <div className="dseg">
          {DIFFICULTIES.map((d) => {
            const active = filters.difficulties.has(d);
            return (
              <button
                key={d}
                type="button"
                className={`dcell diff-${d.toLowerCase()} ${active ? "on" : "off"}`}
                onClick={() => toggleDifficulty(d)}
                aria-pressed={active}
              >
                <img
                  src={`/icons/difficulty/${d.toLowerCase()}.png`}
                  alt=""
                  width={22}
                  height={22}
                />
                <span className="dcell-name">{d}</span>
                <span className="dcell-count tabular">
                  {difficultyCounts[d] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="sect sect-opts">
        <div className="sect-head">
          <h3>Options</h3>
        </div>
        <OptRow
          checked={filters.pactOnly}
          label="Demonic Pact tasks only"
          hint="Hide tasks that aren't part of a pact"
          onChange={(v) => setFilters((f) => ({ ...f, pactOnly: v }))}
        />
        <OptRow
          checked={filters.includeCentroidFallbacks}
          label="Region fallback pins"
          hint="Show pins at region centers when an exact location is unknown"
          onChange={(v) =>
            setFilters((f) => ({ ...f, includeCentroidFallbacks: v }))
          }
        />
        <OptRow
          checked={filters.includeUnmappable}
          label="Non-spatial tasks"
          hint="Include skill, achievement, and collection-log tasks"
          onChange={(v) =>
            setFilters((f) => ({ ...f, includeUnmappable: v }))
          }
        />
      </section>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chevron ${open ? "open" : ""}`}
      viewBox="0 0 16 16"
      width={12}
      height={12}
      aria-hidden
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OptRow({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`optrow ${checked ? "on" : "off"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="optrow-check" aria-hidden />
      <span className="optrow-body">
        <span className="optrow-label">{label}</span>
        {hint ? <span className="optrow-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

function SearchIcon() {
  return (
    <svg
      className="sb-icon"
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden
    >
      <circle
        cx={6.75}
        cy={6.75}
        r={4.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d="M10.25 10.25 L14 14"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
