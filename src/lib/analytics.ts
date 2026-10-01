/** Custom events are intentionally disabled. Cloudflare's beacon handles page analytics. */
type Props = Record<string, string | number | boolean | null>;

function send(name: string, props?: Props): void {
  void name;
  void props;
}

export type TaskSelectSource = "list" | "popup";

export type BugSubmitStatus = "success" | "error";

export type FilterKind =
  | "region"
  | "difficulty"
  | "pactOnly"
  | "hideCompleted"
  | "includeCentroidFallbacks"
  | "includeUnmappable";

export const analytics = {
  taskSelected(p: {
    taskId: string;
    region: string;
    tier: string;
    source: TaskSelectSource;
  }): void {
    send("task_selected", p);
  },

  taskCompletionToggled(p: {
    taskId: string;
    region: string;
    tier: string;
    completed: boolean;
    source: TaskSelectSource;
  }): void {
    send("task_completion_toggled", p);
  },

  progressReset(p: { completedCountBefore: number }): void {
    send("progress_reset", p);
  },

  pinClicked(p: {
    locationId: string;
    region: string;
    taskCount: number;
    remaining: number;
    hasPact: boolean;
  }): void {
    send("pin_clicked", p);
  },

  searchPerformed(p: {
    query: string;
    length: number;
    visibleCount: number;
  }): void {
    send("search_performed", p);
  },

  filterChanged(p: {
    kind: FilterKind;
    value: string;
    enabled: boolean | null;
  }): void {
    send("filter_changed", p);
  },

  bugDialogOpened(): void {
    send("bug_dialog_opened");
  },

  bugSubmitted(p: {
    status: BugSubmitStatus;
    messageLength: number;
  }): void {
    send("bug_submitted", p);
  },

  aboutDialogOpened(): void {
    send("about_dialog_opened");
  },

  syncDialogOpened(): void {
    send("sync_dialog_opened");
  },

  changelogOpened(p: { trigger: "auto" | "manual"; version: string }): void {
    send("changelog_opened", p);
  },

  changelogClosed(p: { version: string; suppressForever: boolean }): void {
    send("changelog_closed", p);
  },

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
