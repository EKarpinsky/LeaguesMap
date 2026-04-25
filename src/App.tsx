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
import { matchesFilter } from "./lib/filters";
import { ALL_PLACEMENTS, ALL_TASKS, getPlacement, getTask } from "./lib/taskIndex";
import { useCompletedTasks } from "./lib/useCompletedTasks";
import { usePersistedFilters } from "./lib/usePersistedFilters";
import { analytics } from "./lib/analytics";
import type { TaskSelectSource } from "./lib/analytics";
import { parseTasksTrackerExport } from "./lib/runeliteImport";
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
  // Filter state is persisted in localStorage (lm.filters.v1) so a
  // page reload, accidental Cmd+R, or tab discard doesn't wipe the
  // user's curated view (region selection, tier mix, "Hide completed",
  // skill mins). The `?q=` URL param still wins over any persisted
  // search on initial load so the schema.org SearchAction declared in
  // index.html (and any shared search URL) keeps working.
  const { filters, setFilters } = usePersistedFilters();
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
    replaceAll,
    resetAll,
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

  // ─────────────────── RuneLite sync dialog state ────────────────────
  // Workflow: user pastes (or file-picks) the JSON exported from the
  // RuneLite "Tasks Tracker" plugin. We decode the league task varps
  // with the same algorithm WikiSync uses (see runeliteImport.ts) and
  // REPLACE the local completion set — sync semantics are
  // "RuneLite is the source of truth", so re-importing the same file
  // is always idempotent. We never POST anywhere; the file is read
  // entirely client-side and never leaves the browser.
  type SyncStatus = "idle" | "previewing" | "applied" | "error";
  type SyncSource = "paste" | "file";
  interface SyncPreview {
    completedIds: Set<string>;
    displayName: string | null;
    matchedTasks: number;
    unknownIds: number;
    varpsCovered: number;
    varpsTotal: number;
    addedCount: number;
    removedCount: number;
    source: SyncSource;
  }
  // Two-layer state for the sync dialog:
  //
  //   1. `syncInput` / `syncInputSource` / `syncOpen` — the raw inputs.
  //   2. `syncOverride`                                — phases that
  //      aren't pure derivations of the input: a "the file picker
  //      itself failed before we ever got bytes" error, and the
  //      post-import "applied" state that lingers while the dialog
  //      animates closed.
  //
  // Everything else (the parsed preview, the parse-error message, the
  // headline status the UI keys off of) is *derived* from those inputs
  // via useMemo below — see syncDerived / syncStatus / syncError /
  // syncPreview. This is a pure function of state, so we don't need an
  // effect, which lets us avoid the cascading-render anti-pattern
  // ("Calling setState synchronously within an effect") and gives us
  // free re-derivation when the completion set changes underneath us
  // (e.g. user toggles a task in the sidebar with the dialog open —
  // the +/- diff numbers update instantly).
  type SyncOverride =
    | { kind: "none" }
    | { kind: "applied" }
    | { kind: "fileError"; error: string };
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncInput, setSyncInput] = useState("");
  const [syncInputSource, setSyncInputSource] = useState<SyncSource>("paste");
  const [syncOverride, setSyncOverride] = useState<SyncOverride>({
    kind: "none",
  });
  const syncTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const syncFileInputRef = useRef<HTMLInputElement | null>(null);

  const openSyncDialog = useCallback(() => {
    analytics.syncDialogOpened();
    setSyncOverride({ kind: "none" });
    setSyncOpen(true);
  }, []);
  const closeSyncDialog = useCallback(() => {
    setSyncOpen(false);
    // Wait for the modal close animation before resetting the form so
    // the user doesn't see fields blank out mid-transition.
    setTimeout(() => {
      setSyncInput("");
      setSyncInputSource("paste");
      setSyncOverride({ kind: "none" });
    }, 200);
  }, []);

  // Pure derivation of "what the parser would say about the current
  // input". Live re-runs on every keystroke; parse is ~1 ms even at
  // 1.6k tasks (single JSON.parse + 62 varp loops), so an explicit
  // "Preview" button would be busywork that also enables the "I
  // pasted the wrong thing and hit Apply" footgun.
  const syncDerived = useMemo(() => {
    if (!syncOpen) return null;
    const trimmed = syncInput.trim();
    if (!trimmed) return null;
    const result = parseTasksTrackerExport(trimmed);
    if (result.ok === false) {
      return { kind: "error" as const, error: result.error };
    }
    let added = 0;
    let removed = 0;
    for (const id of result.completedIds) if (!completed.has(id)) added += 1;
    for (const id of completed) if (!result.completedIds.has(id)) removed += 1;
    const preview: SyncPreview = {
      completedIds: result.completedIds,
      displayName: result.displayName,
      matchedTasks: result.stats.matchedTasks,
      unknownIds: result.stats.unknownIds,
      varpsCovered: result.stats.varpsCovered,
      varpsTotal: result.stats.varpsTotal,
      addedCount: added,
      removedCount: removed,
      source: syncInputSource,
    };
    return { kind: "preview" as const, preview };
  }, [syncInput, syncOpen, completed, syncInputSource]);

  // Override beats derivation: "applied" is sticky during the auto-close
  // window, and a file-read failure (where we never got bytes to feed
  // the parser) needs to surface even though `syncInput` is still
  // empty. Otherwise the headline status reflects whatever the parser
  // thinks of the current text.
  const syncStatus: SyncStatus =
    syncOverride.kind === "applied"
      ? "applied"
      : syncOverride.kind === "fileError"
        ? "error"
        : syncDerived?.kind === "error"
          ? "error"
          : syncDerived?.kind === "preview"
            ? "previewing"
            : "idle";
  const syncPreview: SyncPreview | null =
    syncDerived?.kind === "preview" ? syncDerived.preview : null;
  const syncError: string | null =
    syncOverride.kind === "fileError"
      ? syncOverride.error
      : syncDerived?.kind === "error"
        ? syncDerived.error
        : null;

  const onSyncFilePicked = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const text = await file.text();
        setSyncOverride({ kind: "none" });
        setSyncInputSource("file");
        setSyncInput(text);
      } catch {
        setSyncOverride({
          kind: "fileError",
          error: "Couldn't read that file. Try copy-paste instead.",
        });
      }
    },
    [],
  );

  const applySync = useCallback(() => {
    if (!syncPreview) return;
    const before = completed.size;
    replaceAll(syncPreview.completedIds);
    analytics.syncImportApplied({
      status: "success",
      completedCountBefore: before,
      completedCountAfter: syncPreview.completedIds.size,
      matchedTasks: syncPreview.matchedTasks,
      unknownIds: syncPreview.unknownIds,
      varpsCovered: syncPreview.varpsCovered,
      inputSource: syncPreview.source,
    });
    setSyncOverride({ kind: "applied" });
    setTimeout(() => closeSyncDialog(), 1200);
  }, [syncPreview, completed.size, replaceAll, closeSyncDialog]);

  // Modal a11y: autofocus the textarea on open + ESC closes. Mirrors
  // the bug-dialog contract.
  useEffect(() => {
    if (!syncOpen) return;
    const t = setTimeout(() => syncTextareaRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSyncDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [syncOpen, closeSyncDialog]);

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
          onResetProgress={handleResetProgress}
          onOpenSync={openSyncDialog}
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
        RuneLite sync dialog. Reuses the bug-dialog backdrop / shell
        styles + a few sync-specific extras (drop-zone, diff summary).
        Everything is processed in-browser — the file is read with
        FileReader and never POSTed anywhere.
      */}
      {syncOpen && (
        <div
          className="bug-dialog-backdrop"
          onMouseDown={closeSyncDialog}
          role="presentation"
        >
          <div
            className="bug-dialog sync-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-dialog-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="bug-dialog-head">
              <h2 id="sync-dialog-title">Sync from RuneLite</h2>
              <button
                type="button"
                className="bug-dialog-close"
                onClick={closeSyncDialog}
                aria-label="Close sync dialog"
              >
                ×
              </button>
            </header>
            {/*
              Header and footer stay pinned; everything in between
              scrolls inside this wrapper. Without it, the preview
              block + textarea + steps can push the action buttons
              below the dialog max-height (the .bug-dialog itself has
              overflow:hidden so a too-tall body just clips). Bug
              dialog doesn't need this because its body is fixed-size,
              but sync grows with both decoded preview AND error
              messages so we have to handle short viewports.
            */}
            <div className="sync-dialog-scroll">
            <div className="sync-dialog-blurb">
              <p>
                Import your league progress from the{" "}
                <a
                  href="https://runelite.net/plugin-hub/show/tasks-tracker"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tasks Tracker
                </a>{" "}
                RuneLite plugin.
              </p>
              <ol className="sync-steps">
                <li>
                  Install <strong>Tasks Tracker</strong> from RuneLite's
                  plugin hub and log into a Demonic Pacts world once so
                  your varps populate.
                </li>
                <li>
                  Open the plugin sidebar, click{" "}
                  <strong>Export</strong>, then <strong>Copy to clipboard</strong>{" "}
                  (or save the file).
                </li>
                <li>Paste below or pick the saved file.</li>
              </ol>
            </div>
            <div className="sync-dialog-input">
              <textarea
                ref={syncTextareaRef}
                className="bug-dialog-textarea sync-dialog-textarea"
                value={syncInput}
                onChange={(e) => {
                  // A previous file-read failure shouldn't keep showing
                  // its error after the user starts pasting fresh JSON.
                  if (syncOverride.kind === "fileError") {
                    setSyncOverride({ kind: "none" });
                  }
                  setSyncInputSource("paste");
                  setSyncInput(e.target.value);
                }}
                placeholder='Paste the JSON export here — looks like {"quests":{...},"varps":{...},"tasks":{...}}'
                rows={5}
                spellCheck={false}
                disabled={syncStatus === "applied"}
              />
              <div className="sync-dialog-or">or</div>
              <input
                ref={syncFileInputRef}
                type="file"
                accept=".json,application/json,text/plain"
                onChange={(e) => onSyncFilePicked(e.target.files?.[0] ?? null)}
                className="sync-dialog-file"
                disabled={syncStatus === "applied"}
              />
            </div>
            {syncStatus === "previewing" && syncPreview && (
              <div className="sync-dialog-preview" role="status">
                <div className="sync-dialog-preview-head">
                  Looks good
                  {syncPreview.displayName ? (
                    <>
                      {" — "}
                      <strong>{syncPreview.displayName}</strong>
                    </>
                  ) : null}
                </div>
                <ul className="sync-dialog-preview-list">
                  <li>
                    <span className="sync-dialog-num">
                      {syncPreview.matchedTasks.toLocaleString()}
                    </span>{" "}
                    tasks complete in your export
                  </li>
                  <li>
                    <span className="sync-dialog-num diff-add">
                      +{syncPreview.addedCount.toLocaleString()}
                    </span>{" "}
                    new on this map,{" "}
                    <span className="sync-dialog-num diff-rem">
                      −{syncPreview.removedCount.toLocaleString()}
                    </span>{" "}
                    will be unticked
                  </li>
                  <li className="sync-dialog-preview-meta">
                    Decoded {syncPreview.varpsCovered}/{syncPreview.varpsTotal}{" "}
                    league varps
                    {syncPreview.unknownIds > 0
                      ? ` · ${syncPreview.unknownIds} bits map to tasks not yet in this map (likely a recent Jagex update)`
                      : ""}
                  </li>
                </ul>
              </div>
            )}
            {syncStatus === "error" && syncError && (
              <p className="bug-dialog-error sync-dialog-error" role="alert">
                {syncError}
              </p>
            )}
            </div>
            <footer className="bug-dialog-foot sync-dialog-foot">
              <span className="sync-dialog-foot-note">
                {syncStatus === "applied"
                  ? "Applied!"
                  : "Importing replaces all current ticks."}
              </span>
              <div className="bug-dialog-actions">
                <button
                  type="button"
                  className="bug-dialog-btn ghost"
                  onClick={closeSyncDialog}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bug-dialog-btn primary"
                  onClick={applySync}
                  disabled={
                    syncStatus !== "previewing" || syncPreview === null
                  }
                >
                  {syncStatus === "applied"
                    ? "Imported ✓"
                    : syncPreview
                      ? `Import ${syncPreview.matchedTasks.toLocaleString()} tasks`
                      : "Import"}
                </button>
              </div>
            </footer>
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
