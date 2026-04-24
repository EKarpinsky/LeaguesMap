import { useMemo, useRef, useEffect } from "react";
import type { Task, TaskPlacement } from "../types";
import { getLocation, getPlacement } from "../lib/taskIndex";
import "./TaskList.css";

export interface TaskListProps {
  tasks: Task[];
  unmappableTasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onSelectLocation: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  /**
   * Set of task ids the user has marked complete. Lives in
   * `useCompletedTasks` (localStorage); we receive it read-only here so
   * the row can dim/strikethrough completed tasks and the header can
   * show a "X of Y done" sub-count for the currently visible bucket.
   */
  completed: ReadonlySet<string>;
  /** Toggle a task's completion state. Bound to the row checkbox. */
  onToggleComplete: (taskId: string) => void;
}

const DIFF_ORDER: Record<string, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
  Elite: 3,
  Master: 4,
};

export default function TaskList({
  tasks,
  unmappableTasks,
  selectedTaskId,
  onSelectTask,
  onSelectLocation,
  open,
  onToggle,
  completed,
  onToggleComplete,
}: TaskListProps) {
  // Sort with completed tasks pushed to the bottom of each difficulty
  // group. Players will scan the top of the list expecting "what to do
  // next" — leaving done tasks in their original alphabetical slot
  // dilutes that signal. They're still visible (until Hide Completed
  // is on) but out of the way.
  const mappableSorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ac = completed.has(a.id) ? 1 : 0;
      const bc = completed.has(b.id) ? 1 : 0;
      if (ac !== bc) return ac - bc;
      const d = DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty];
      if (d !== 0) return d;
      if (a.region !== b.region) return a.region.localeCompare(b.region);
      return a.name.localeCompare(b.name);
    });
  }, [tasks, completed]);

  const unmappableSorted = useMemo(() => {
    return [...unmappableTasks].sort((a, b) => {
      const ac = completed.has(a.id) ? 1 : 0;
      const bc = completed.has(b.id) ? 1 : 0;
      if (ac !== bc) return ac - bc;
      const d = DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty];
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
  }, [unmappableTasks, completed]);

  // Sub-count for the accordion header: "82 / 412" tells the player at
  // a glance how much of the currently-filtered slice they've finished.
  const visibleDone = useMemo(() => {
    let n = 0;
    for (const t of tasks) if (completed.has(t.id)) n += 1;
    for (const t of unmappableTasks) if (completed.has(t.id)) n += 1;
    return n;
  }, [tasks, unmappableTasks, completed]);
  const visibleTotal = tasks.length + unmappableTasks.length;

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !selectedTaskId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(selectedTaskId)}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedTaskId, open]);

  return (
    <section className={`tasks-region ${open ? "open" : "collapsed"}`}>
      <button
        type="button"
        className="accordion-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Chevron open={open} />
        <span className="accordion-title">Tasks</span>
        <span
          className="accordion-badge"
          title={`${visibleDone} done of ${visibleTotal} visible`}
        >
          {visibleDone > 0 ? (
            <>
              <span className="tabular">{visibleDone}</span>
              <span className="accordion-badge-sep">/</span>
              <span className="tabular">{visibleTotal}</span>
            </>
          ) : (
            <span className="tabular">{visibleTotal}</span>
          )}
        </span>
      </button>
      <div className="task-list-scroll" ref={listRef} hidden={!open}>
        {mappableSorted.map((t) => {
          const placement = getPlacement(t.id);
          return (
            <TaskRow
              key={t.id}
              task={t}
              placement={placement}
              selected={selectedTaskId === t.id}
              onSelectTask={onSelectTask}
              onSelectLocation={onSelectLocation}
              done={completed.has(t.id)}
              onToggleComplete={onToggleComplete}
            />
          );
        })}
        {mappableSorted.length === 0 && (
          <p className="empty">No tasks match the current filters.</p>
        )}

        {unmappableSorted.length > 0 && (
          <section className="unmappable-section">
            <h2>
              Non-spatial tasks{" "}
              <span className="count">{unmappableSorted.length}</span>
            </h2>
            <p className="hint">
              Skill-level, combat achievement, and collection log goals that
              don't live anywhere on the map.
            </p>
            {unmappableSorted.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                placement={undefined}
                selected={selectedTaskId === t.id}
                onSelectTask={onSelectTask}
                onSelectLocation={onSelectLocation}
                nonSpatial
                done={completed.has(t.id)}
                onToggleComplete={onToggleComplete}
              />
            ))}
          </section>
        )}
      </div>
    </section>
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

interface TaskRowProps {
  task: Task;
  placement?: TaskPlacement;
  selected: boolean;
  onSelectTask: (id: string) => void;
  onSelectLocation: (id: string) => void;
  nonSpatial?: boolean;
  done: boolean;
  onToggleComplete: (taskId: string) => void;
}

function TaskRow({
  task,
  placement,
  selected,
  onSelectTask,
  onSelectLocation,
  nonSpatial,
  done,
  onToggleComplete,
}: TaskRowProps) {
  const primaryLoc = placement?.primary
    ? getLocation(placement.primary)
    : placement?.locations[0]
      ? getLocation(placement.locations[0])
      : undefined;

  // Non-spatial tasks have no pin to jump to. Clicking them would only
  // highlight the already-visible row and do nothing on the map, so we
  // render them as plain, non-interactive cards. `onSelectTask` /
  // `onSelectLocation` remain opt-in for the mappable rows below.
  const interactive = !nonSpatial;
  const handleClick = interactive
    ? () => {
        onSelectTask(task.id);
        if (placement?.locations[0]) {
          onSelectLocation(placement.primary ?? placement.locations[0]);
        }
      }
    : undefined;

  // Stop propagation so toggling completion never doubles as a row-click
  // (which would re-open the popup / fly-to the pin every time).
  const handleCheckboxClick = (e: React.MouseEvent) => e.stopPropagation();
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onToggleComplete(task.id);
  };

  return (
    <div
      className={`task-row diff-${task.difficulty.toLowerCase()}${selected && interactive ? " selected" : ""}${interactive ? "" : " non-spatial"}${done ? " done" : ""}`}
      data-task-id={task.id}
      onClick={handleClick}
    >
      <div className="task-row-top">
        <label
          className="task-row-check"
          onClick={handleCheckboxClick}
          title={done ? "Mark as incomplete" : "Mark as complete"}
        >
          <input
            type="checkbox"
            checked={done}
            onChange={handleCheckboxChange}
            aria-label={
              done
                ? `Mark "${task.name}" as incomplete`
                : `Mark "${task.name}" as complete`
            }
          />
          <span className="task-row-check-box" aria-hidden>
            <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
              <path
                d="M3 8.4l3 3 7-7.4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
        <img
          className="diff-icon"
          src={`/icons/difficulty/${task.difficulty.toLowerCase()}.png`}
          alt={task.difficulty}
          title={task.difficulty}
          width={18}
          height={18}
        />
        {task.isDemonicPact && (
          <span className="pact-tag" title="Earns a Demonic Pact">
            DP
          </span>
        )}
        <span className="task-row-name">{task.name}</span>
        <span className="task-row-pts">{task.points}</span>
      </div>
      <div className="task-row-desc">{task.descriptionClean}</div>
      <div className="task-row-meta">
        <span className={`region-tag region-${task.region.toLowerCase()}`}>
          {task.region !== "General" && (
            <img
              className="region-badge"
              src={`/icons/region/${task.region.toLowerCase()}.png`}
              alt=""
              aria-hidden
              width={10}
              height={15}
            />
          )}
          {task.region}
        </span>
        {primaryLoc && (
          <span className="loc-tag">
            {placement?.matchMethod === "region-fallback" ? (
              <em>~ {task.region} area</em>
            ) : (
              primaryLoc.name
            )}
          </span>
        )}
        {task.skillRequirements.map((r) => (
          <span
            key={r.skill}
            className="req-chip"
            title={`${r.skill} ${r.level}`}
          >
            <img
              className="req-icon"
              src={`/icons/skill/${r.skill.toLowerCase()}.png`}
              alt={r.skill}
              width={13}
              height={13}
            />
            <span className="req-level tabular">{r.level}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
