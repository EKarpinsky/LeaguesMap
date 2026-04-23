import { useState } from "react";
import { DIFFICULTIES, REGION_DISPLAY_ORDER } from "../types";
import type { Difficulty, Region } from "../types";
import type { FilterState } from "../lib/filters";
import "./FilterSidebar.css";

export interface FilterSidebarProps {
  filters: FilterState;
  setFilters: (updater: (prev: FilterState) => FilterState) => void;
  totalCount: number;
  visibleCount: number;
  unmappableCount: number;
}

export default function FilterSidebar({
  filters,
  setFilters,
  totalCount,
  visibleCount,
  unmappableCount,
}: FilterSidebarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const toggleRegion = (r: Region) => {
    setFilters((f) => {
      const next = new Set(f.regions);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return { ...f, regions: next };
    });
  };
  const toggleDifficulty = (d: Difficulty) => {
    setFilters((f) => {
      const next = new Set(f.difficulties);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return { ...f, difficulties: next };
    });
  };

  const allRegionsOn =
    filters.regions.size === REGION_DISPLAY_ORDER.length;
  const allDifficultiesOn = filters.difficulties.size === DIFFICULTIES.length;

  return (
    <div className="filters-region">
      <header className="panel-hero">
        <h1>LeaguesMap</h1>
        <p>Demonic Pacts, pinned to the world.</p>
      </header>

      <div className="filter-block filter-search-block">
        <input
          type="search"
          placeholder="Search tasks…"
          value={filters.search}
          onChange={(e) =>
            setFilters((f) => ({ ...f, search: e.target.value }))
          }
        />
      </div>

      <div className="filter-block">
        <div className="block-header">
          <h2>Region</h2>
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              setFilters((f) => ({
                ...f,
                regions: allRegionsOn
                  ? new Set<Region>()
                  : new Set<Region>(REGION_DISPLAY_ORDER),
              }))
            }
          >
            {allRegionsOn ? "Select none" : "Select all"}
          </button>
        </div>
        <div className="chip-row">
          {REGION_DISPLAY_ORDER.map((r) => {
            const active = filters.regions.has(r);
            // "General" is a pseudo-region with no OSRS area badge; all
            // other regions render the authentic wiki badge.
            const hasBadge = r !== "General";
            return (
              <button
                key={r}
                type="button"
                className={`chip region-chip region-${r.toLowerCase()} ${active ? "on" : "off"}`}
                onClick={() => toggleRegion(r)}
              >
                {hasBadge && (
                  <img
                    className="region-badge"
                    src={`/icons/region/${r.toLowerCase()}.png`}
                    alt=""
                    aria-hidden
                    width={14}
                    height={21}
                  />
                )}
                {r}
              </button>
            );
          })}
        </div>
      </div>

      <div className="filter-block">
        <div className="block-header">
          <h2>Difficulty</h2>
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              setFilters((f) => ({
                ...f,
                difficulties: allDifficultiesOn
                  ? new Set<Difficulty>()
                  : new Set<Difficulty>(DIFFICULTIES),
              }))
            }
          >
            {allDifficultiesOn ? "Select none" : "Select all"}
          </button>
        </div>
        <div className="chip-row">
          {DIFFICULTIES.map((d) => {
            const active = filters.difficulties.has(d);
            return (
              <button
                key={d}
                type="button"
                className={`chip diff-chip diff-${d.toLowerCase()} ${active ? "on" : "off"}`}
                onClick={() => toggleDifficulty(d)}
              >
                <img
                  className="diff-icon"
                  src={`/icons/difficulty/${d.toLowerCase()}.png`}
                  alt=""
                  aria-hidden
                  width={16}
                  height={16}
                />
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div className="filter-block advanced">
        <button
          type="button"
          className={`advanced-toggle ${advancedOpen ? "open" : ""}`}
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M2 3l3 3 3-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Advanced
          {(filters.pactOnly ||
            filters.includeCentroidFallbacks === false ||
            filters.includeUnmappable === false) && (
            <span className="advanced-dot" aria-hidden />
          )}
        </button>
        {advancedOpen && (
          <div className="advanced-body">
            <label className="toggle">
              <input
                type="checkbox"
                checked={filters.pactOnly}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, pactOnly: e.target.checked }))
                }
              />
              <span>Demonic Pact tasks only</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={filters.includeCentroidFallbacks}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    includeCentroidFallbacks: e.target.checked,
                  }))
                }
              />
              <span>
                Show region fallbacks{" "}
                <em>(tasks whose exact spot isn't mapped yet)</em>
              </span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={filters.includeUnmappable}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    includeUnmappable: e.target.checked,
                  }))
                }
              />
              <span>
                Show non-spatial tasks{" "}
                <em>(skill totals, combat achievements, collection log)</em>
              </span>
            </label>
          </div>
        )}
      </div>

      <footer className="panel-stats">
        <div>
          <span className="num">{visibleCount.toLocaleString()}</span>
          <span className="lbl">showing</span>
        </div>
        <div>
          <span className="num">{totalCount.toLocaleString()}</span>
          <span className="lbl">total</span>
        </div>
        <div>
          <span className="num">{unmappableCount.toLocaleString()}</span>
          <span className="lbl">non-spatial</span>
        </div>
      </footer>
    </div>
  );
}
