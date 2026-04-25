import { useEffect, useMemo, useRef, useState } from "react";
import { DIFFICULTIES, REGION_DISPLAY_ORDER } from "../types";
import type { Difficulty, Region } from "../types";
import { matchesFilter } from "../lib/filters";
import type { FilterState } from "../lib/filters";
import { ALL_PLACEMENTS, ALL_TASKS } from "../lib/taskIndex";
import type { ProgressStats } from "../lib/useCompletedTasks";
import { analytics } from "../lib/analytics";
import "./FilterSidebar.css";

// Render `⌘K` on macOS (where Cmd+K is muscle memory) and `Ctrl K` on every
// other platform — Windows users seeing a ⌘ glyph get a confusing "is this
// some control character?" moment, since the keyboard shortcut their browser
// actually responds to is Ctrl+K (the listener below already handles both
// metaKey and ctrlKey, so the hint just needs to advertise the right one).
//
// Mac detection uses navigator.platform first (still the most reliable signal
// for desktop UA, even though MDN marks it deprecated) with a userAgent
// fallback. iPadOS 13+ reports "MacIntel" via navigator.platform, but the
// CSS already hides .sb-kbd on `(hover: none)` and narrow viewports — so an
// iPad-as-Mac false positive never reaches the user.
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(
    navigator.platform || navigator.userAgent || "",
  );
const SHORTCUT_HINT = IS_MAC ? "⌘K" : "Ctrl K";

export interface FilterSidebarProps {
  filters: FilterState;
  setFilters: (updater: (prev: FilterState) => FilterState) => void;
  open: boolean;
  onToggle: () => void;
  /** Read-only completion set (drives the progress bar + facet recounts). */
  completed: ReadonlySet<string>;
  /** Aggregate progress stats — pre-computed in the parent hook. */
  progress: ProgressStats;
  /** Reset the entire completion set. Confirmed locally before firing. */
  onResetProgress: () => void;
  /**
   * Total tasks currently visible after filters apply (mappable +
   * unmappable). Threaded down only so the debounced search-tracking
   * effect can record "this query → N results" without re-deriving
   * the whole filter pipeline here.
   */
  visibleCount: number;
}

interface FacetCounts {
  regionCounts: Record<Region, number>;
  difficultyCounts: Record<Difficulty, number>;
}

/**
 * Leave-one-out counts: each number answers "how many tasks are in this
 * bucket if every other filter stays where it is". Lets users see the
 * impact of toggling a row without double-counting their current
 * selection on the same axis. With Hide Completed on, the count
 * reflects remaining (not-yet-done) tasks per bucket — matching what
 * the user actually sees in the task list / map.
 */
function useFacetCounts(
  filters: FilterState,
  completed: ReadonlySet<string>,
): FacetCounts {
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
      if (
        matchesFilter(t, p, regionsAllOn, completed) &&
        t.region in regionCounts
      ) {
        regionCounts[t.region as Region] += 1;
      }
      if (matchesFilter(t, p, diffAllOn, completed)) {
        difficultyCounts[t.difficulty] += 1;
      }
    }
    return { regionCounts, difficultyCounts };
  }, [filters, completed]);
}

export default function FilterSidebar({
  filters,
  setFilters,
  open,
  onToggle,
  completed,
  progress,
  onResetProgress,
  visibleCount,
}: FilterSidebarProps) {
  const { regionCounts, difficultyCounts } = useFacetCounts(filters, completed);
  const [confirmReset, setConfirmReset] = useState(false);

  // Debounced search analytics. Wait until the user has stopped
  // typing for 800 ms so we don't ship one event per keystroke
  // (which would blow through the Vercel custom-event quota AND
  // produce a noisy dashboard of "vor", "vork", "vorka", "vorkat",
  // "vorkath"). Empty / cleared searches are skipped — a "search"
  // dashboard cluttered with empty-string entries is useless.
  // visibleCount lets us spot popular queries with zero results,
  // which surfaces gaps in wiki coverage worth fixing.
  useEffect(() => {
    const q = filters.search.trim();
    if (!q) return;
    const handle = window.setTimeout(() => {
      analytics.searchPerformed({
        // Lowercase + truncate keeps the value within Vercel's 255-char
        // property cap and buckets case variants together.
        query: q.toLowerCase().slice(0, 64),
        length: q.length,
        visibleCount,
      });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [filters.search, visibleCount]);
  // Manual JSON export/import was deliberately removed: nobody
  // hand-rolls JSON for their league progress. A future "Sync from
  // RuneLite" flow will hit the LeaguesSync community plugin's
  // public backend (api.osrsleaguetracker.com/player/{rsn}) and
  // diff the returned task IDs against the in-memory set.

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

  const toggleRegion = (r: Region) => {
    const enabled = !filters.regions.has(r);
    analytics.filterChanged({ kind: "region", value: r, enabled });
    setFilters((f) => {
      const next = new Set(f.regions);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return { ...f, regions: next };
    });
  };
  const toggleDifficulty = (d: Difficulty) => {
    const enabled = !filters.difficulties.has(d);
    analytics.filterChanged({ kind: "difficulty", value: d, enabled });
    setFilters((f) => {
      const next = new Set(f.difficulties);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return { ...f, difficulties: next };
    });
  };

  const allRegionsOn = filters.regions.size === REGION_DISPLAY_ORDER.length;
  const allDifficultiesOn = filters.difficulties.size === DIFFICULTIES.length;

  const toggleAllRegions = () => {
    analytics.filterChanged({
      kind: "region",
      value: allRegionsOn ? "none" : "all",
      enabled: null,
    });
    setFilters((f) => ({
      ...f,
      regions: allRegionsOn
        ? new Set<Region>()
        : new Set<Region>(REGION_DISPLAY_ORDER),
    }));
  };
  const toggleAllDifficulties = () => {
    analytics.filterChanged({
      kind: "difficulty",
      value: allDifficultiesOn ? "none" : "all",
      enabled: null,
    });
    setFilters((f) => ({
      ...f,
      difficulties: allDifficultiesOn
        ? new Set<Difficulty>()
        : new Set<Difficulty>(DIFFICULTIES),
    }));
  };

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
    (!filters.includeUnmappable ? 1 : 0) +
    (filters.hideCompleted ? 1 : 0);

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      // Cancel after a few seconds if the user doesn't follow through —
      // a stuck "Confirm reset?" button is a footgun if they walk away.
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    onResetProgress();
    setConfirmReset(false);
  };

  const pct =
    progress.totalCount > 0
      ? Math.round((progress.completedCount / progress.totalCount) * 100)
      : 0;
  const ptsPct =
    progress.totalPoints > 0
      ? Math.round((progress.completedPoints / progress.totalPoints) * 100)
      : 0;

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
      {/*
        Progress section. Lives at the top of the body because "where am
        I in the league" is the question players reach for first when
        they reopen the tab. Two bars (tasks done + points earned) keep
        both denominators legible at a glance, and the meta row spells
        out the per-difficulty breakdown so completionists can see which
        tier they're under-attacking.
      */}
      <section className="sect sect-progress">
        <div className="sect-head">
          <h2>
            Progress
            <span className="sect-meta tabular">
              {progress.completedCount} / {progress.totalCount} ({pct}%)
            </span>
          </h2>
        </div>
        <div
          className="prog-bar"
          role="progressbar"
          aria-label="Tasks completed"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="prog-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="prog-row">
          <span>Points</span>
          <span className="tabular">
            {progress.completedPoints.toLocaleString()} /{" "}
            {progress.totalPoints.toLocaleString()} ({ptsPct}%)
          </span>
        </div>
        <div className="prog-bar prog-bar-thin">
          <div className="prog-bar-fill" style={{ width: `${ptsPct}%` }} />
        </div>
        <div className="prog-tiers">
          {DIFFICULTIES.map((d) => {
            const done = progress.completedByDifficulty[d] ?? 0;
            const total = progress.totalByDifficulty[d] ?? 0;
            return (
              <span
                key={d}
                className={`prog-tier diff-${d.toLowerCase()}`}
                title={`${d}: ${done} of ${total} done`}
              >
                <img
                  src={`/icons/difficulty/${d.toLowerCase()}.png`}
                  alt={d}
                  width={14}
                  height={14}
                />
                <span className="tabular">
                  {done}/{total}
                </span>
              </span>
            );
          })}
        </div>
        <div className="prog-actions">
          <label
            className={`optrow optrow-inline ${filters.hideCompleted ? "on" : "off"}`}
          >
            <input
              type="checkbox"
              checked={filters.hideCompleted}
              onChange={(e) => {
                const enabled = e.target.checked;
                analytics.filterChanged({
                  kind: "hideCompleted",
                  value: String(enabled),
                  enabled,
                });
                setFilters((f) => ({ ...f, hideCompleted: enabled }));
              }}
            />
            <span className="optrow-check" aria-hidden />
            <span className="optrow-label">Hide completed</span>
          </label>
          <div className="prog-buttons">
            <button
              type="button"
              className={`prog-btn danger${confirmReset ? " confirming" : ""}`}
              onClick={handleReset}
              disabled={progress.completedCount === 0 && !confirmReset}
              title={
                confirmReset
                  ? "Click again to confirm — this can't be undone"
                  : "Mark every task as not done"
              }
              aria-label="Reset all progress"
            >
              {confirmReset ? "Confirm reset?" : "Reset progress"}
            </button>
          </div>
        </div>
      </section>

      <div className="sb">
        <SearchIcon />
        <input
          ref={searchRef}
          // Intentionally `type="text"` (not `"search"`): Chromium and Safari
          // render their own clear-on-hover "×" button on `type="search"`
          // inputs, which stacks on top of our custom `.sb-clear` button and
          // shows a second X next to it. `role="searchbox"` preserves the
          // a11y semantics without the native decoration.
          type="text"
          role="searchbox"
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
            {SHORTCUT_HINT}
          </kbd>
        )}
      </div>

      <section className="sect">
        <div className="sect-head">
          <h2>
            Region
            {!allRegionsOn && (
              <span className="sect-meta">
                {filters.regions.size} of {REGION_DISPLAY_ORDER.length}
              </span>
            )}
          </h2>
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
          <h2>
            Difficulty
            {!allDifficultiesOn && (
              <span className="sect-meta">
                {filters.difficulties.size} of {DIFFICULTIES.length}
              </span>
            )}
          </h2>
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
          <h2>Options</h2>
        </div>
        <OptRow
          checked={filters.pactOnly}
          label="Demonic Pact tasks only"
          hint="Hide tasks that aren't part of a pact"
          onChange={(v) => {
            analytics.filterChanged({
              kind: "pactOnly",
              value: String(v),
              enabled: v,
            });
            setFilters((f) => ({ ...f, pactOnly: v }));
          }}
        />
        <OptRow
          checked={filters.includeCentroidFallbacks}
          label="Region fallback pins"
          hint="Show pins at region centers when an exact location is unknown"
          onChange={(v) => {
            analytics.filterChanged({
              kind: "includeCentroidFallbacks",
              value: String(v),
              enabled: v,
            });
            setFilters((f) => ({ ...f, includeCentroidFallbacks: v }));
          }}
        />
        <OptRow
          checked={filters.includeUnmappable}
          label="Non-spatial tasks"
          hint="Include skill, achievement, and collection-log tasks"
          onChange={(v) => {
            analytics.filterChanged({
              kind: "includeUnmappable",
              value: String(v),
              enabled: v,
            });
            setFilters((f) => ({ ...f, includeUnmappable: v }));
          }}
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
