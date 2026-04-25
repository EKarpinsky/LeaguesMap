import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Analytics } from "@vercel/analytics/react";
import FilterSidebar from "./components/FilterSidebar";
import TaskList from "./components/TaskList";
import { defaultFilters, matchesFilter } from "./lib/filters";
import type { FilterState } from "./lib/filters";
import { ALL_PLACEMENTS, ALL_TASKS, getPlacement, getTask } from "./lib/taskIndex";
import { useCompletedTasks } from "./lib/useCompletedTasks";
import { analytics } from "./lib/analytics";
import type { TaskSelectSource } from "./lib/analytics";
import type { Task } from "./types";
import "./App.css";

// Bug-report dialog states. Discriminated string union so renderers can
// switch exhaustively without bool soup.
type BugStatus = "idle" | "sending" | "sent" | "error";

const BUG_MIN_LEN = 5;
const BUG_MAX_LEN = 5000;

// Leaflet + MapView together are ~230 KB gz. Lazy-load them so the
// initial paint (title, filters, task list) doesn't wait on the map
// runtime. Tile fetches kick off the moment MapView mounts, so the
// map still shows up within the same paint window on most networks.
const MapView = lazy(() => import("./components/MapView"));

function App() {
  // Initial filter state honors `?q=…` from the URL so the schema.org
  // SearchAction (declared in index.html) actually does something — Google
  // can route sitelink-searchbox queries here, and any user with a search
  // URL (bookmark, Discord share, etc.) lands on a pre-filtered view.
  const [filters, setFilters] = useState<FilterState>(() => {
    const base = defaultFilters();
    if (typeof window === "undefined") return base;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q && q.trim()) base.search = q.trim().slice(0, 200);
    return base;
  });
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

  // Completion state lives in localStorage and drives both the
  // "Hide completed" filter and the visual state of every task row /
  // pin / popup. Owned at App-level so the sidebar's progress bar and
  // the map's pin badges all see the same source of truth without
  // needing to thread a context.
  const {
    completed,
    toggleTask,
    resetAll,
    stats: progressStats,
  } = useCompletedTasks();

  // Track every completion toggle. Wrapping the raw mutator (rather
  // than instrumenting it inside the hook) keeps `useCompletedTasks`
  // analytics-free and lets us pass a `source` discriminator from the
  // call site — sidebar list vs. map-popup checkbox.
  const handleToggleComplete = useCallback(
    (id: string, source: TaskSelectSource = "list") => {
      const wasDone = completed.has(id);
      const t = getTask(id);
      if (t) {
        analytics.taskCompletionToggled({
          taskId: id,
          region: t.region,
          tier: t.difficulty,
          completed: !wasDone,
          source,
        });
      }
      toggleTask(id);
    },
    [completed, toggleTask],
  );

  const handleResetProgress = useCallback(() => {
    analytics.progressReset({ completedCountBefore: completed.size });
    resetAll();
  }, [completed.size, resetAll]);

  // Only forward `completed` into matchesFilter when the user actually
  // turned on "Hide completed". Otherwise the filter ignores it anyway,
  // and mixing it into the dep list rebuilds tasksByLocation (and thus
  // MapView's `entries` reference) on every checkbox tick — which
  // destroys & recreates every marker, slamming open popups shut.
  const completedForFilter = filters.hideCompleted ? completed : undefined;
  const { mappableTasks, unmappableTasks, tasksByLocation } = useMemo(() => {
    const mappable: Task[] = [];
    const unmappable: Task[] = [];
    const byLoc = new Map<string, Task[]>();
    for (const task of ALL_TASKS) {
      const placement = ALL_PLACEMENTS.find((p) => p.taskId === task.id)!;
      if (!matchesFilter(task, placement, filters, completedForFilter)) continue;
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
  }, [filters, completedForFilter]);


  const handleSelectTask = useCallback((id: string, source: TaskSelectSource = "list") => {
    setSelectedTaskId(id);
    const placement = getPlacement(id);
    if (placement && placement.locations.length > 0) {
      setSelectedLocationId(placement.primary ?? placement.locations[0]);
    }
    const t = getTask(id);
    if (t) {
      analytics.taskSelected({
        taskId: id,
        region: t.region,
        tier: t.difficulty,
        source,
      });
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

  // ─────────────────── Bug-report dialog state ────────────────────────
  // POSTs to /api/report-bug (Vercel Edge Function) which forwards to
  // eli@karpinsky.io via Resend. Kept inline here rather than a new
  // component because (a) it owns no reusable logic and (b) the project
  // rule is to prefer existing files over new ones.
  const [aboutOpen, setAboutOpen] = useState(false);
  const openAboutDialog = useCallback(() => {
    analytics.aboutDialogOpened();
    setAboutOpen(true);
  }, []);
  const closeAboutDialog = useCallback(() => setAboutOpen(false), []);
  // Global Escape close for the About modal mirrors the bug dialog's
  // a11y contract — the listener only attaches while the modal is open
  // so we don't intercept Escape elsewhere in the app.
  useEffect(() => {
    if (!aboutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAboutDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aboutOpen, closeAboutDialog]);

  const [bugOpen, setBugOpen] = useState(false);
  const [bugMessage, setBugMessage] = useState("");
  const [bugStatus, setBugStatus] = useState<BugStatus>("idle");
  const [bugError, setBugError] = useState<string | null>(null);
  // Honeypot — bots fill hidden inputs reflexively. We never read this
  // for content; we just send its value to the server which silently
  // 200s when it's non-empty, so the bot thinks it got through.
  const [bugHoneypot, setBugHoneypot] = useState("");
  const bugTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const openBugDialog = useCallback(() => {
    analytics.bugDialogOpened();
    setBugStatus("idle");
    setBugError(null);
    setBugOpen(true);
  }, []);
  const closeBugDialog = useCallback(() => {
    setBugOpen(false);
    // Clear after the close transition so the next open is clean.
    setTimeout(() => {
      setBugMessage("");
      setBugStatus("idle");
      setBugError(null);
      setBugHoneypot("");
    }, 200);
  }, []);

  // Autofocus the textarea + close on Escape — the standard modal a11y
  // contract. ESC handler is global so it works even if focus drifted.
  useEffect(() => {
    if (!bugOpen) return;
    const t = setTimeout(() => bugTextareaRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBugDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [bugOpen, closeBugDialog]);

  const submitBug = useCallback(async () => {
    const trimmed = bugMessage.trim();
    if (trimmed.length < BUG_MIN_LEN) return;
    setBugStatus("sending");
    setBugError(null);
    // Capture context at submit time, not at mount, so multi-tasking
    // users who resized / navigated mid-session report the actual
    // state they're looking at.
    const context = [
      `URL: ${window.location.href}`,
      `Viewport: ${window.innerWidth}×${window.innerHeight}`,
      `Language: ${navigator.language}`,
      `UA: ${navigator.userAgent}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n");
    try {
      const res = await fetch("/api/report-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          context,
          website: bugHoneypot,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          data.error ?? `Server returned ${res.status}. Please try again.`,
        );
      }
      setBugStatus("sent");
      analytics.bugSubmitted({ status: "success", messageLength: trimmed.length });
      // Auto-close after a moment so the user gets a clear receipt.
      setTimeout(() => closeBugDialog(), 1400);
    } catch (err) {
      setBugStatus("error");
      setBugError(
        err instanceof Error
          ? err.message
          : "Couldn't send the report — please try again.",
      );
      analytics.bugSubmitted({ status: "error", messageLength: trimmed.length });
    }
  }, [bugMessage, bugHoneypot, closeBugDialog]);

  const bugCharCount = bugMessage.trim().length;
  const bugCanSubmit =
    bugStatus !== "sending" &&
    bugCharCount >= BUG_MIN_LEN &&
    bugCharCount <= BUG_MAX_LEN;

  return (
    <div className="app-shell">
      <aside className={panelClass}>
        <header className="app-title">
          <div className="app-title-text">
            <h1>Demonic Pacts Tasks Map</h1>
            <a
              className="app-title-byline"
              href="https://karpinsky.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              By Karpinsky
            </a>
          </div>
          {/*
            Header utility links — both styled as low-contrast ghost links
            so they never compete with the page title or the filters
            underneath. "About" opens a modal carrying the Jagex Fan
            Content Guidelines non-affiliation notice + trademark
            attribution; "Report a bug" opens the bug-report dialog
            (POSTs to /api/report-bug → Resend → eli@karpinsky.io).
          */}
          <div className="app-title-actions">
            <button
              type="button"
              className="bug-report-link"
              onClick={openAboutDialog}
            >
              About
            </button>
            <button
              type="button"
              className="bug-report-link"
              onClick={openBugDialog}
              title="Send a bug report to eli@karpinsky.io"
            >
              Report a bug
            </button>
          </div>
        </header>
        <FilterSidebar
          filters={filters}
          setFilters={setFilters}
          open={filtersOpen}
          onToggle={toggleFilters}
          completed={completed}
          progress={progressStats}
          onResetProgress={handleResetProgress}
          visibleCount={mappableTasks.length + unmappableTasks.length}
        />
        <TaskList
          tasks={mappableTasks}
          unmappableTasks={unmappableTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelectTask}
          onSelectLocation={handleSelectLocation}
          open={tasksOpen}
          onToggle={toggleTasks}
          completed={completed}
          onToggleComplete={handleToggleComplete}
        />
      </aside>
      <main className="app-map">
        <Suspense fallback={<div className="map-fallback" aria-hidden />}>
          <MapView
            tasksByLocation={tasksByLocation}
            selectedLocationId={selectedLocationId}
            onSelectLocation={handleSelectLocation}
            onSelectTask={handleSelectTask}
            completed={completed}
            onToggleComplete={handleToggleComplete}
          />
        </Suspense>
      </main>
      {/*
        Vercel Web Analytics. We gate on hostname (not import.meta.env.PROD)
        because `vite preview` and Lighthouse's audit of it run a
        production build locally — `PROD` is true there too, so a PROD-only
        gate still 404s on /_vercel/insights/script.js (the script only
        exists when served from Vercel's edge). Hostname-gating skips
        localhost and the *.vercel.app preview deployments where the
        script also isn't injected, leaving only the canonical production
        domain to load it. In SSR/Node the typeof check trivially fails
        and we render nothing.
      */}
      {typeof window !== "undefined" &&
        window.location.hostname === "leagues-map.karpinsky.io" && <Analytics />}
      {/*
        About modal. Carries the Jagex Fan Content Policy required
        non-affiliation notice + trademark attribution. Reuses the
        bug-dialog backdrop / shell styles so we don't duplicate modal
        CSS — the body content is small enough to inline.
      */}
      {aboutOpen && (
        <div
          className="bug-dialog-backdrop"
          onMouseDown={closeAboutDialog}
          role="presentation"
        >
          <div
            className="bug-dialog about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-dialog-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="bug-dialog-head">
              <h2 id="about-dialog-title">About this map</h2>
              <button
                type="button"
                className="bug-dialog-close"
                onClick={closeAboutDialog}
                aria-label="Close about dialog"
              >
                ×
              </button>
            </header>
            <div className="about-dialog-body">
              <p>
                A community-built tile map of every Old School RuneScape
                Demonic Pacts League task, by{" "}
                <a
                  href="https://karpinsky.io"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Karpinsky
                </a>
                . Source data scraped from the OSRS Wiki.
              </p>
              <p>
                This is an unofficial fan project published under the{" "}
                <a
                  href="https://legal.jagex.com/docs/policies/fan-content-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Jagex Fan Content Policy
                </a>
                . It is not endorsed by, sponsored by, or affiliated with
                Jagex Ltd in any way.
              </p>
              <p>
                <em>
                  RuneScape and Old School RuneScape are the trademarks of
                  Jagex Ltd and are used here in accordance with the Fan
                  Content Policy. All in-game artwork, icons, and map
                  imagery shown on this site remain the property of Jagex
                  Ltd.
                </em>
              </p>
            </div>
          </div>
        </div>
      )}
      {/*
        Bug-report dialog. Rendered conditionally so the textarea isn't
        in the tab order when closed. Backdrop click and Escape both
        dismiss; clicks inside the panel stop propagation so dragging
        a selection out of the textarea doesn't accidentally close it.
      */}
      {bugOpen && (
        <div
          className="bug-dialog-backdrop"
          onMouseDown={closeBugDialog}
          role="presentation"
        >
          <div
            className="bug-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-dialog-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="bug-dialog-head">
              <h2 id="bug-dialog-title">Report a bug</h2>
              <button
                type="button"
                className="bug-dialog-close"
                onClick={closeBugDialog}
                aria-label="Close bug report dialog"
              >
                ×
              </button>
            </header>
            <p className="bug-dialog-blurb">
              What went wrong? A sentence or two is plenty — your URL,
              viewport, and browser get attached automatically.
            </p>
            <textarea
              ref={bugTextareaRef}
              className="bug-dialog-textarea"
              value={bugMessage}
              onChange={(e) => setBugMessage(e.target.value)}
              placeholder="e.g. ‘King Sand Crab pin is in the wrong place — should be on the Hosidius beach not the town centre.'"
              maxLength={BUG_MAX_LEN}
              rows={5}
              disabled={bugStatus === "sending" || bugStatus === "sent"}
            />
            {/*
              Honeypot: positioned off-screen + tabIndex=-1 + autocomplete=off
              so real users never see or land on it. Bots fill all visible
              inputs they find via DOM walks; the server silently 200s when
              this is non-empty so the bot believes its submission worked.
            */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={bugHoneypot}
              onChange={(e) => setBugHoneypot(e.target.value)}
              aria-hidden="true"
              className="bug-dialog-honeypot"
            />
            <footer className="bug-dialog-foot">
              <span
                className={
                  "bug-dialog-count" +
                  (bugCharCount > BUG_MAX_LEN ? " over" : "")
                }
              >
                {bugCharCount}/{BUG_MAX_LEN}
              </span>
              <div className="bug-dialog-actions">
                <button
                  type="button"
                  className="bug-dialog-btn ghost"
                  onClick={closeBugDialog}
                  disabled={bugStatus === "sending"}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bug-dialog-btn primary"
                  onClick={submitBug}
                  disabled={!bugCanSubmit}
                >
                  {bugStatus === "sending"
                    ? "Sending…"
                    : bugStatus === "sent"
                      ? "Sent ✓"
                      : "Send report"}
                </button>
              </div>
            </footer>
            {bugStatus === "error" && (
              <p className="bug-dialog-error" role="alert">
                {bugError ?? "Couldn't send the report."} You can also
                email{" "}
                <a href="mailto:eli@karpinsky.io">eli@karpinsky.io</a>{" "}
                directly.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
