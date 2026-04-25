import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { Task } from "../types";
import { REGION_PALETTE } from "../types";
import {
  INITIAL_VIEW,
  MAP_IMAGE,
  gameToLatLng,
  imageCorners,
  imagePixelToGame,
} from "../lib/calibration";
import { ALL_LOCATIONS, getLocation } from "../lib/taskIndex";
import "leaflet/dist/leaflet.css";
import "./MapView.css";

export interface MapViewProps {
  tasksByLocation: Map<string, Task[]>;
  selectedLocationId: string | null;
  onSelectLocation: (id: string | null) => void;
  onSelectTask: (id: string) => void;
  /**
   * Set of task ids the user has marked complete. Threaded through so
   * pin badges show REMAINING tasks, fully-done pins can dim out, and
   * popup checkboxes render with the right initial state.
   */
  completed: ReadonlySet<string>;
  /** Toggle a single task's completion state (bound to popup checkboxes). */
  onToggleComplete: (taskId: string) => void;
}

/**
 * Build the inner HTML for a pin icon. Split out from `pinIcon` so the
 * completion-update effect can patch a marker's existing icon DOM in
 * place (avoiding `setIcon`, which detaches the popup anchor and
 * causes Leaflet to close any open popup on the marker).
 *
 * @param remaining  Tasks still to do at this pin (controls badge count).
 * @param total      Total tasks at this pin (used to detect "all done").
 */
function pinIconHtml(
  color: string,
  pact: boolean,
  remaining: number,
  total: number,
  selected: boolean,
): string {
  const ring = pact && remaining > 0 ? "#ff5a00" : color;
  const border = selected ? "#fff" : "rgba(0,0,0,0.55)";
  const glow = selected ? "0 0 0 3px #fff, 0 0 0 5px rgba(255,90,0,0.9)" : "none";
  const allDone = total > 0 && remaining === 0;
  // When the player has finished every task at a pin we keep the pin
  // visible (in case they want to revisit it) but desaturate hard so
  // it visually drops behind the active pins. A small ✓ replaces the
  // count badge to make the "done" state explicit.
  const wrapClass = "pin-wrap" + (allDone ? " all-done" : "");
  const badge =
    allDone
      ? `<span class="pin-badge done" aria-label="all complete">✓</span>`
      : remaining > 1
        ? `<span class="pin-badge">${remaining > 99 ? "99+" : remaining}</span>`
        : "";
  return `
    <div class="${wrapClass}" style="box-shadow:${glow}">
      <div class="pin-body" style="background:${color};border-color:${border}">
        <div class="pin-inner" style="background:${ring}"></div>
      </div>
      ${badge}
    </div>
  `;
}

function pinIcon(
  color: string,
  pact: boolean,
  remaining: number,
  total: number,
  selected: boolean,
) {
  const size = 28;
  return L.divIcon({
    className: "osrs-pin",
    html: pinIconHtml(color, pact, remaining, total, selected),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Build the popup body for a pin. Returns an HTMLElement so we can
 * attach event listeners directly to the checkbox / task line — much
 * simpler than re-parsing innerHTML on every popupopen.
 */
function buildPopupContent(
  loc: { name: string; region: string; blurb?: string },
  tasks: Task[],
  completed: ReadonlySet<string>,
  onSelectTask: (id: string) => void,
  onToggleComplete: (id: string) => void,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin-popup";
  const regionSlug = loc.region.toLowerCase();
  const regionBadge =
    loc.region !== "General"
      ? `<img class="region-badge" src="/icons/region/${regionSlug}.png" alt="" width="12" height="18" />`
      : "";
  const remaining = tasks.reduce(
    (n, t) => (completed.has(t.id) ? n : n + 1),
    0,
  );
  const countLabel =
    remaining === tasks.length
      ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}`
      : `${remaining} of ${tasks.length} remaining`;
  el.innerHTML = `
    <div class="pin-popup-header">
      <div class="pin-popup-name">${escapeHtml(loc.name)}</div>
      <div class="pin-popup-meta">${regionBadge}<span>${escapeHtml(loc.region)} · ${countLabel}</span></div>
      ${loc.blurb ? `<div class="pin-popup-blurb">${escapeHtml(loc.blurb)}</div>` : ""}
    </div>
    <ul class="pin-popup-list"></ul>
  `;
  const list = el.querySelector(".pin-popup-list") as HTMLUListElement;
  const sorted = [...tasks].sort((a, b) => {
    const ac = completed.has(a.id) ? 1 : 0;
    const bc = completed.has(b.id) ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const diffOrder = DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty];
    if (diffOrder !== 0) return diffOrder;
    return a.name.localeCompare(b.name);
  });
  for (const t of sorted.slice(0, 30)) {
    const li = document.createElement("li");
    const done = completed.has(t.id);
    li.className =
      `task-line diff-${t.difficulty.toLowerCase()}` + (done ? " done" : "");
    li.dataset.taskId = t.id;
    const diffSlug = t.difficulty.toLowerCase();
    li.innerHTML = `
      <label class="task-line-check" title="${done ? "Mark as incomplete" : "Mark as complete"}">
        <input type="checkbox" ${done ? "checked" : ""} aria-label="${done ? "Mark as incomplete" : "Mark as complete"}: ${escapeHtml(t.name)}" />
        <span class="task-line-check-box" aria-hidden>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 8.4l3 3 7-7.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </span>
      </label>
      <img class="diff-icon" src="/icons/difficulty/${diffSlug}.png" alt="${t.difficulty}" title="${t.difficulty}" width="16" height="16" />
      ${t.isDemonicPact ? '<span class="pact-tag" title="Earns a Demonic Pact">DP</span>' : ""}
      <span class="task-name">${escapeHtml(t.name)}</span>
    `;
    const checkbox = li.querySelector("input[type=checkbox]") as HTMLInputElement;
    const checkLabel = li.querySelector(".task-line-check") as HTMLLabelElement;
    // Stop label/checkbox interactions from bubbling up to the li click
    // handler (which would jump to the task instead of toggling).
    checkLabel.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      onToggleComplete(t.id);
    });
    li.addEventListener("click", (e) => {
      // Only treat clicks outside the checkbox as a "jump to task".
      const target = e.target as HTMLElement;
      if (target.closest(".task-line-check")) return;
      onSelectTask(t.id);
    });
    list.appendChild(li);
  }
  if (sorted.length > 30) {
    const more = document.createElement("li");
    more.className = "task-line more";
    more.textContent = `+ ${sorted.length - 30} more — use the task list`;
    list.appendChild(more);
  }
  return el;
}

export default function MapView({
  tasksByLocation,
  selectedLocationId,
  onSelectLocation,
  onSelectTask,
  completed,
  onToggleComplete,
}: MapViewProps) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  /**
   * All live markers keyed by their locationId. Maintained by the
   * marker-rebuild effect; consumed by the selection effect so that
   * flipping the selected pin (highlight + popup + flyTo) never needs
   * to tear down the whole layer. If we did rebuild on every selection
   * change, clicking a pin would destroy the marker whose popup Leaflet
   * just opened — requiring a second click to see the tasks.
   */
  const markersByIdRef = useRef<Map<string, L.Marker>>(new Map());
  /**
   * The id of the pin whose icon currently reflects the "selected" style.
   * Tracked separately from React state so the selection effect can diff
   * old-vs-new without re-running when `selectedLocationId` changes only
   * at the React layer (e.g. during sidebar clicks).
   */
  const highlightedIdRef = useRef<string | null>(null);
  /**
   * Latest callback refs. We pipe them through refs so the marker-rebuild
   * effect can depend purely on `visibleEntries` — if a parent passes a
   * fresh-identity `onSelectTask` arrow on every render, we must NOT
   * rebuild the marker layer (which would destroy any open popup and
   * break switching between tasks that share a pin). See bug: clicking
   * task B after task A at the same pin used to silently close the popup
   * because the layer was being torn down on every App re-render.
   */
  const onSelectLocationRef = useRef(onSelectLocation);
  const onSelectTaskRef = useRef(onSelectTask);
  const onToggleCompleteRef = useRef(onToggleComplete);
  // We thread `completed` through a ref so the marker-rebuild effect
  // can read the current set when binding popup builders WITHOUT having
  // to depend on `completed` itself (which would tear down every marker
  // on every checkbox toggle and slam any open popup shut).
  const completedRef = useRef(completed);
  useEffect(() => {
    onSelectLocationRef.current = onSelectLocation;
    onSelectTaskRef.current = onSelectTask;
    onToggleCompleteRef.current = onToggleComplete;
    completedRef.current = completed;
  }, [onSelectLocation, onSelectTask, onToggleComplete, completed]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      crs: L.CRS.Simple,
      minZoom: INITIAL_VIEW.minZoom,
      maxZoom: INITIAL_VIEW.maxZoom,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      attributionControl: true,
      maxBoundsViscosity: 1,
    });

    const { sw, ne } = imageCorners(map);
    const bounds = L.latLngBounds(sw, ne);

    // Tile pyramid generated by scripts/tile-map-image.py. Leaflet only
    // requests the ~9–12 tiles in the current viewport at the active
    // zoom (≈ 30–400 KB) instead of the old single-overlay 6 MB raster,
    // which dropped Lighthouse mobile LCP from ~35 s to <2 s. Bounds
    // are passed so Leaflet doesn't ask for off-map tiles at the edges.
    L.tileLayer(MAP_IMAGE.tileUrl, {
      tileSize: MAP_IMAGE.tileSize,
      minZoom: INITIAL_VIEW.minZoom,
      maxZoom: INITIAL_VIEW.maxZoom,
      maxNativeZoom: MAP_IMAGE.maxNativeZoom,
      noWrap: true,
      bounds,
      attribution:
        'Map © <a href="https://oldschool.runescape.wiki/w/World_map" target="_blank" rel="noopener noreferrer">OSRS Wiki</a>',
      // Keep tiles around briefly while panning so scroll-back doesn't
      // re-fetch the same images. Two extra rings is enough to cover
      // most momentum scrolls without bloating memory on low-RAM phones.
      keepBuffer: 2,
      // `detectRetina: true` would silence the Best Practices
      // `image-size-responsive` warning on mobile (LCP map fills the
      // viewport so a 256 px tile gets stretched on 2x+ DPR screens),
      // but it quadruples LCP-path bytes (z+1 tiles, 4× more of them)
      // and dropped Lighthouse mobile Perf from 80 → 68. The visual
      // softness at fit-to-world is barely perceptible on real
      // phones, and as soon as the user zooms in they see native
      // density. Trading 4 BP points for 12 Perf points isn't worth
      // it — leave retina-detect off.
    }).addTo(map);
    map.setMaxBounds(bounds);

    // Land on Civitas illa Fortis (the league's home region) at the
    // same focus zoom pin-clicks use, instead of fit-to-world. The
    // user always opens the page wanting to find tasks; centering on
    // the densest pact-task cluster cuts the time-to-first-useful-pin
    // by a big margin, and panning out to the rest of Gielinor is
    // one pinch away.
    map.setView(
      gameToLatLng(map, INITIAL_VIEW.centerGame.x, INITIAL_VIEW.centerGame.y),
      INITIAL_VIEW.zoom,
      { animate: false },
    );

    const group = L.layerGroup().addTo(map);
    markerLayerRef.current = group;
    mapRef.current = map;

    // Tell Leaflet about the container's final flex size whenever it
    // changes (window resize, sidebar accordion toggle on mobile).
    // We don't re-recenter on resize — once the user has navigated
    // away from Civitas we shouldn't yank them back.
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(mapEl.current);
    requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
    });

    if (import.meta.env.DEV) {
      map.on("click", (e: L.LeafletMouseEvent) => {
        // Convert through pixel space because the lat/lng axis no
        // longer matches game coords (we use a pixel-based CRS now).
        const px = map.project(e.latlng, MAP_IMAGE.maxNativeZoom);
        const { x, y } = imagePixelToGame(px.x, px.y);
        console.log(`click: game x=${x}, y=${y}`);
      });
    }

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  // Redraw markers whenever the visible set changes.
  const visibleEntries = useMemo(() => {
    return ALL_LOCATIONS.filter((loc) => {
      const tasks = tasksByLocation.get(loc.id);
      return tasks && tasks.length > 0;
    }).map((loc) => ({
      loc,
      tasks: tasksByLocation.get(loc.id)!,
    }));
  }, [tasksByLocation]);

  /**
   * Rebuild the marker layer whenever the visible set changes (filters,
   * task data). Deliberately does NOT depend on `selectedLocationId` or
   * `completed` — rebuilding on either would destroy the marker whose
   * popup Leaflet just opened, forcing a second click to see the tasks.
   * Selection highlighting + popup opening lives in the effect below;
   * completion-driven icon refresh in the one after.
   */
  useEffect(() => {
    const group = markerLayerRef.current;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();
    markersByIdRef.current.clear();
    highlightedIdRef.current = null;

    for (const { loc, tasks } of visibleEntries) {
      const hasPact = tasks.some((t) => t.isDemonicPact);
      const color = REGION_PALETTE[loc.region]?.base ?? "#888";
      const remaining = tasks.reduce(
        (n, t) => (completedRef.current.has(t.id) ? n : n + 1),
        0,
      );
      const marker = L.marker(gameToLatLng(map, loc.x, loc.y), {
        icon: pinIcon(color, hasPact, remaining, tasks.length, false),
        riseOnHover: true,
        riseOffset: 400,
        keyboard: false,
      });

      // Stash loc/color/tasks on the marker so the selection &
      // completion effects can rebuild the icon and popup contents
      // without re-running this whole rebuild.
      (marker as MarkerWithMeta)._meta = {
        locationId: loc.id,
        color,
        hasPact,
        tasks,
      };

      // bindPopup with a function so each open builds a fresh DOM tree
      // reflecting the CURRENT completion set (read via ref). This is
      // why the rebuild effect doesn't need to depend on `completed`.
      marker.bindPopup(
        () =>
          buildPopupContent(
            loc,
            tasks,
            completedRef.current,
            (id) => onSelectTaskRef.current(id),
            (id) => onToggleCompleteRef.current(id),
          ),
        {
          maxWidth: 360,
          maxHeight: 420,
          autoPanPaddingTopLeft: L.point(24, 24),
          autoPanPaddingBottomRight: L.point(24, 200),
        },
      );
      marker.on("popupopen", () => onSelectLocationRef.current(loc.id));
      marker.on("popupclose", () => {
        // Only deselect on close if this pin is still the selected one
        // (avoids races when the user closes one popup while another
        // selection is already in-flight from the sidebar).
        if (highlightedIdRef.current === loc.id) {
          onSelectLocationRef.current(null);
        }
      });
      group.addLayer(marker);
      markersByIdRef.current.set(loc.id, marker);
    }
  }, [visibleEntries]);

  /**
   * React to completion-set changes. For each marker we recompute its
   * remaining-task count and either:
   *   • patch the icon's DOM in place (when the marker's icon element
   *     is already on screen) — this avoids `setIcon`, which destroys
   *     the icon node and closes any open popup anchored to it; or
   *   • call `setIcon` (the icon hasn't been rendered yet, so there's
   *     nothing to patch and no popup to lose).
   *
   * Either way we then refresh the popup body via `setPopupContent`
   * for the marker whose popup is open, so the freshly-toggled task
   * line shows its new strike-through and the header's "X of N
   * remaining" updates immediately.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, marker] of markersByIdRef.current.entries()) {
      const meta = (marker as MarkerWithMeta)._meta;
      if (!meta) continue;
      const remaining = meta.tasks.reduce(
        (n, t) => (completed.has(t.id) ? n : n + 1),
        0,
      );
      const html = pinIconHtml(
        meta.color,
        meta.hasPact,
        remaining,
        meta.tasks.length,
        highlightedIdRef.current === id,
      );
      const iconEl = (marker as L.Marker & { _icon?: HTMLElement })._icon;
      if (iconEl) {
        // In-place patch — keeps the popup's anchor element alive.
        iconEl.innerHTML = html;
      } else {
        marker.setIcon(
          pinIcon(
            meta.color,
            meta.hasPact,
            remaining,
            meta.tasks.length,
            highlightedIdRef.current === id,
          ),
        );
      }
      if (marker.isPopupOpen()) {
        const loc = getLocation(id);
        if (loc) {
          marker.setPopupContent(
            buildPopupContent(
              loc,
              meta.tasks,
              completed,
              (tid) => onSelectTaskRef.current(tid),
              (tid) => onToggleCompleteRef.current(tid),
            ),
          );
        }
      }
    }
  }, [completed]);

  /**
   * React to selection changes (from either a pin click or the sidebar):
   *   1. Swap the previous selected pin's icon back to the default.
   *   2. Swap the new pin's icon to the "selected" highlight.
   *   3. flyTo the new pin if it isn't already visible in the viewport
   *      (so sidebar clicks always pan to the target, but clicking a
   *      pin that's already on screen doesn't yank the map around).
   *   4. Open the new pin's popup if it isn't already open.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const computeRemaining = (tasks: Task[]) =>
      tasks.reduce(
        (n, t) => (completedRef.current.has(t.id) ? n : n + 1),
        0,
      );

    const prevId = highlightedIdRef.current;
    if (prevId && prevId !== selectedLocationId) {
      const prev = markersByIdRef.current.get(prevId);
      if (prev) {
        const meta = (prev as MarkerWithMeta)._meta;
        if (meta) {
          prev.setIcon(
            pinIcon(
              meta.color,
              meta.hasPact,
              computeRemaining(meta.tasks),
              meta.tasks.length,
              false,
            ),
          );
        }
      }
    }

    if (!selectedLocationId) {
      highlightedIdRef.current = null;
      return;
    }

    const next = markersByIdRef.current.get(selectedLocationId);
    const loc = getLocation(selectedLocationId);
    if (!next || !loc) {
      highlightedIdRef.current = null;
      return;
    }

    const meta = (next as MarkerWithMeta)._meta;
    if (meta) {
      next.setIcon(
        pinIcon(
          meta.color,
          meta.hasPact,
          computeRemaining(meta.tasks),
          meta.tasks.length,
          true,
        ),
      );
    }
    highlightedIdRef.current = selectedLocationId;

    // Always fly to the selected pin and zoom in enough to read the
    // surrounding landmarks. The map opens fit-to-world (zoom 0–2
    // depending on viewport), so without a floor here clicking a pin
    // barely changes the view. Preserving `map.getZoom()` means we
    // never *zoom out* if the user is already closer than FOCUS_ZOOM.
    // FOCUS_ZOOM=4 in the new pyramid renders the map at 4096 px wide,
    // roughly equivalent to the previous z=2 cap.
    const FOCUS_ZOOM = 4;
    map.flyTo(
      gameToLatLng(map, loc.x, loc.y),
      Math.max(map.getZoom(), FOCUS_ZOOM),
      { duration: 0.6 },
    );

    // Open the popup after the fly animation settles. Opening it
    // immediately works, but Leaflet's auto-pan can fight the flyTo
    // animation and leave the popup clipped at the viewport edge.
    if (!next.isPopupOpen()) {
      next.openPopup();
    }
  }, [selectedLocationId]);

  return <div ref={mapEl} className="map-root" />;
}

const DIFF_ORDER: Record<string, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
  Elite: 3,
  Master: 4,
};

/**
 * Leaflet marker carrying the minimum metadata the selection effect needs
 * to re-render its icon. Stashing this on the marker itself avoids a stale
 * closure over React props when the effect later swaps icons.
 */
type MarkerWithMeta = L.Marker & {
  _meta?: {
    locationId: string;
    color: string;
    hasPact: boolean;
    /**
     * Full task list for this pin (not just count). The completion
     * effect needs the ids to recompute remaining-task badges, and the
     * popup-refresh path needs the tasks themselves to rebuild content
     * without a `tasksByLocation` lookup.
     */
    tasks: Task[];
  };
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
