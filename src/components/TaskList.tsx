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
}: TaskListProps) {
  const mappableSorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const d = DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty];
      if (d !== 0) return d;
      if (a.region !== b.region) return a.region.localeCompare(b.region);
      return a.name.localeCompare(b.name);
    });
  }, [tasks]);

  const unmappableSorted = useMemo(() => {
    return [...unmappableTasks].sort((a, b) => {
      const d = DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty];
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
  }, [unmappableTasks]);

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
        <span className="accordion-badge">{mappableSorted.length}</span>
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
}

function TaskRow({
  task,
  placement,
  selected,
  onSelectTask,
  onSelectLocation,
  nonSpatial,
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

  return (
    <div
      className={`task-row diff-${task.difficulty.toLowerCase()}${selected && interactive ? " selected" : ""}${interactive ? "" : " non-spatial"}`}
      data-task-id={task.id}
      onClick={handleClick}
    >
      <div className="task-row-top">
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
