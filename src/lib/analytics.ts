import { track as vercelTrack } from "@vercel/analytics";

/**
 * Vercel Web Analytics custom-event wrapper.
 *
 * Why a wrapper instead of importing `track` everywhere:
 *
 *   1. Hostname gate. The `<Analytics />` component in App.tsx is
 *      already gated to `leagues-map.karpinsky.io`, but `track()` will
 *      enqueue events even when the loader script never injected. We
 *      gate every send here so dev / `vite preview` / Lighthouse runs
 *      / *.vercel.app previews never call into a missing endpoint
 *      (which logs noisy `[Vercel Web Analytics] track is not loaded`
 *      warnings) AND never count toward the production event quota.
 *
 *   2. Type safety. Each event is exposed as its own function with a
 *      strictly-typed props bag. Callers get autocomplete, the event
 *      catalogue lives in exactly one place, and the analytics
 *      dashboard's event-name column can never drift from the code.
 *
 *   3. Failure isolation. A botched analytics call must never break a
 *      user interaction (pin click, completion toggle, etc.). Every
 *      send is wrapped in a try/catch that silently swallows.
 *
 * Vercel's per-event constraints (as of v2):
 *   - Event name ≤ 50 chars.
 *   - ≤ 10 properties per event.
 *   - Property values ≤ 255 chars; only string | number | boolean | null.
 *   - Roughly 10 events/sec/session before the SDK starts dropping.
 *
 * Cost note: free tier = 2,500 custom events / month / project. A
 * single "mark every task complete" session can fire ~1,200 toggle
 * events. If we ever exceed quota, the cheapest dial-back is to skip
 * `taskCompletionToggled` (the highest-volume event by far).
 */

const PROD_HOST = "leagues-map.karpinsky.io";

/**
 * Master kill-switch for `track()` calls.
 *
 * Vercel Web Analytics gates `track()` (custom events) behind the Pro
 * plan. Hobby projects only get automatic page-view + Web Vitals
 * tracking via the `<Analytics />` component (kept enabled in
 * App.tsx). On Pro, `track()` ships every event in the typed
 * `analytics.*` catalogue below; the host gate in `send()` still
 * keeps dev / `vite preview` / Lighthouse runs / *.vercel.app
 * previews from polluting prod metrics.
 *
 * If we ever downgrade off Pro, flip this back to `false` to avoid
 * the `[Vercel Web Analytics] track is not loaded` warnings.
 */
const CUSTOM_EVENTS_ENABLED = true;

const isAnalyticsHost = (): boolean =>
  typeof window !== "undefined" && window.location.hostname === PROD_HOST;

type Props = Record<string, string | number | boolean | null>;

function send(name: string, props?: Props): void {
  if (!CUSTOM_EVENTS_ENABLED) return;
  if (!isAnalyticsHost()) return;
  try {
    if (props) vercelTrack(name, props);
    else vercelTrack(name);
  } catch {
    // Analytics is best-effort. Never let it surface to the user.
  }
}

/** Source of a task selection — sidebar list vs map-pin popup list. */
export type TaskSelectSource = "list" | "popup";

/** Outcome of the bug-report dialog submission. */
export type BugSubmitStatus = "success" | "error";

/**
 * Filter axes we report on. Kept narrow on purpose — adding a new
 * filter type means a deliberate edit here, which keeps the dashboard
 * legend honest.
 */
export type FilterKind =
  | "region"
  | "difficulty"
  | "pactOnly"
  | "hideCompleted"
  | "includeCentroidFallbacks"
  | "includeUnmappable";

export const analytics = {
  /**
   * User clicked a task row in the sidebar list, or a task line inside
   * an open map popup. Tells us which tasks are most-clicked-into and
   * whether players prefer the textual list or the spatial pin popup.
   */
  taskSelected(p: {
    taskId: string;
    region: string;
    tier: string;
    source: TaskSelectSource;
  }): void {
    send("task_selected", p);
  },

  /**
   * User toggled the completion checkbox on a task (in the list, the
   * popup, or via the row click). `completed` reflects the NEW state.
   * High-volume — see cost note above.
   */
  taskCompletionToggled(p: {
    taskId: string;
    region: string;
    tier: string;
    completed: boolean;
    source: TaskSelectSource;
  }): void {
    send("task_completion_toggled", p);
  },

  /**
   * User confirmed "Reset progress" in the sidebar. We capture the
   * pre-reset count so we can see how invested users were when they
   * decided to wipe (e.g. league restart vs. accidental new tab).
   */
  progressReset(p: { completedCountBefore: number }): void {
    send("progress_reset", p);
  },

  /**
   * Real user click on a map pin (NOT programmatic popup-opens that
   * happen when the sidebar selects a task). Tells us which pins the
   * map alone — without any sidebar nudge — pulls users to.
   */
  pinClicked(p: {
    locationId: string;
    region: string;
    taskCount: number;
    remaining: number;
    hasPact: boolean;
  }): void {
    send("pin_clicked", p);
  },

  /**
   * Search input has settled (debounced ~800 ms after the last
   * keystroke). We send the lowercased query truncated to 64 chars —
   * OSRS task searches are entity names ("vorkath", "blue dragon",
   * "rune scimitar"), not personal data. `visibleCount` lets us spot
   * "popular query → zero results" gaps in the wiki coverage.
   */
  searchPerformed(p: {
    query: string;
    length: number;
    visibleCount: number;
  }): void {
    send("search_performed", p);
  },

  /**
   * A single facet/filter change. `value` is the specific bucket
   * touched (e.g. "Karamja", "Master", or "all"/"none" for the bulk
   * toggles). `enabled` is the new state for boolean filters; null for
   * bulk operations where the concept doesn't apply.
   */
  filterChanged(p: {
    kind: FilterKind;
    value: string;
    enabled: boolean | null;
  }): void {
    send("filter_changed", p);
  },

  /** "Report a bug" button clicked. */
  bugDialogOpened(): void {
    send("bug_dialog_opened");
  },

  /**
   * Bug-report POST resolved. `messageLength` lets us tell short
   * "doesn't work" reports apart from detailed walkthroughs without
   * exposing the message contents themselves.
   */
  bugSubmitted(p: {
    status: BugSubmitStatus;
    messageLength: number;
  }): void {
    send("bug_submitted", p);
  },

  /** "About" link clicked (opens Jagex Fan Content disclosure modal). */
  aboutDialogOpened(): void {
    send("about_dialog_opened");
  },

  /** "Sync from RuneLite" button clicked (opens the import dialog). */
  syncDialogOpened(): void {
    send("sync_dialog_opened");
  },

  /**
   * RuneLite Tasks Tracker import resolved. We capture both the parser
   * outcome and (on success) the bit-decoded task count so the dashboard
   * can surface "average completion at sync time" without us ever
   * sending the actual RSN or task IDs. `unknownIds` flags exports that
   * reference task bits we don't have in our manifest — a real-world
   * canary for "Jagex shipped a weekly content drop and we haven't
   * re-scraped yet."
   */
  syncImportApplied(p: {
    status: "success" | "parse_error" | "decode_error";
    completedCountBefore: number;
    completedCountAfter: number;
    matchedTasks: number;
    unknownIds: number;
    varpsCovered: number;
    inputSource: "paste" | "file";
  }): void {
    send("sync_import_applied", p);
  },
};
