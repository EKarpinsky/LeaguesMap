import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { Task } from "../types";
import { REGION_PALETTE } from "../types";
import { IMAGE_BOUNDS, INITIAL_VIEW, MAP_IMAGE } from "../lib/calibration";
import { ALL_LOCATIONS, getLocation } from "../lib/taskIndex";
import "leaflet/dist/leaflet.css";
import "./MapView.css";

export interface MapViewProps {
  tasksByLocation: Map<string, Task[]>;
  selectedLocationId: string | null;
  onSelectLocation: (id: string | null) => void;
  onSelectTask: (id: string) => void;
}

function pinIcon(color: string, pact: boolean, count: number, selected: boolean) {
  const size = 28;
  const ring = pact ? "#ff5a00" : color;
  const border = selected ? "#fff" : "rgba(0,0,0,0.55)";
  const glow = selected ? "0 0 0 3px #fff, 0 0 0 5px rgba(255,90,0,0.9)" : "none";
  const badge =
    count > 1
      ? `<span class="pin-badge">${count > 99 ? "99+" : count}</span>`
      : "";
  const html = `
    <div class="pin-wrap" style="box-shadow:${glow}">
      <div class="pin-body" style="background:${color};border-color:${border}">
        <div class="pin-inner" style="background:${ring}"></div>
      </div>
      ${badge}
    </div>
  `;
  return L.divIcon({
    className: "osrs-pin",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function MapView({
  tasksByLocation,
  selectedLocationId,
  onSelectLocation,
  onSelectTask,
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
  useEffect(() => {
    onSelectLocationRef.current = onSelectLocation;
    onSelectTaskRef.current = onSelectTask;
  }, [onSelectLocation, onSelectTask]);

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
    L.imageOverlay(MAP_IMAGE.url, IMAGE_BOUNDS, {
      attribution:
        'Map © <a href="https://oldschool.runescape.wiki/w/World_map" target="_blank" rel="noreferrer">OSRS Wiki</a>',
      interactive: false,
    }).addTo(map);
    map.setMaxBounds(IMAGE_BOUNDS);
    map.fitBounds(IMAGE_BOUNDS, { animate: false });

    const group = L.layerGroup().addTo(map);
    markerLayerRef.current = group;
    mapRef.current = map;

    // Re-fit once the container has its final flex size.
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(mapEl.current);
    // Initial invalidate + re-fit next frame.
    requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      map.fitBounds(IMAGE_BOUNDS, { animate: false });
    });

    if (import.meta.env.DEV) {
      map.on("click", (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        console.log(`click: game x=${Math.round(lng)}, y=${Math.round(lat)}`);
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
   * task data). Deliberately does NOT depend on `selectedLocationId` —
   * rebuilding on selection would destroy the marker whose popup Leaflet
   * just opened, forcing a second click to see the tasks. Selection
   * highlighting + popup opening lives in the effect below.
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
      const marker = L.marker([loc.y, loc.x], {
        icon: pinIcon(color, hasPact, tasks.length, false),
        riseOnHover: true,
        riseOffset: 400,
        keyboard: false,
      });

      const popup = document.createElement("div");
      popup.className = "pin-popup";
      const regionSlug = loc.region.toLowerCase();
      const regionBadge =
        loc.region !== "General"
          ? `<img class="region-badge" src="/icons/region/${regionSlug}.png" alt="" width="12" height="18" />`
          : "";
      popup.innerHTML = `
        <div class="pin-popup-header">
          <div class="pin-popup-name">${escapeHtml(loc.name)}</div>
          <div class="pin-popup-meta">${regionBadge}<span>${loc.region} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}</span></div>
          ${loc.blurb ? `<div class="pin-popup-blurb">${escapeHtml(loc.blurb)}</div>` : ""}
        </div>
        <ul class="pin-popup-list"></ul>
      `;
      const list = popup.querySelector(".pin-popup-list") as HTMLUListElement;
      const sorted = [...tasks].sort((a, b) => {
        const diffOrder = DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty];
        if (diffOrder !== 0) return diffOrder;
        return a.name.localeCompare(b.name);
      });
      for (const t of sorted.slice(0, 30)) {
        const li = document.createElement("li");
        li.className = `task-line diff-${t.difficulty.toLowerCase()}`;
        const diffSlug = t.difficulty.toLowerCase();
        li.innerHTML = `
          <img class="diff-icon" src="/icons/difficulty/${diffSlug}.png" alt="${t.difficulty}" title="${t.difficulty}" width="16" height="16" />
          ${t.isDemonicPact ? '<span class="pact-tag" title="Earns a Demonic Pact">DP</span>' : ""}
          <span class="task-name">${escapeHtml(t.name)}</span>
        `;
        li.addEventListener("click", () => onSelectTaskRef.current(t.id));
        list.appendChild(li);
      }
      if (sorted.length > 30) {
        const more = document.createElement("li");
        more.className = "task-line more";
        more.textContent = `+ ${sorted.length - 30} more — use the task list`;
        list.appendChild(more);
      }

      // Stash loc/color/tasks on the marker so the selection effect can
      // rebuild the icon with the "selected" style without closing over
      // stale React props.
      (marker as MarkerWithMeta)._meta = {
        locationId: loc.id,
        color,
        hasPact,
        taskCount: tasks.length,
      };

      marker.bindPopup(popup, { maxWidth: 360, maxHeight: 420 });
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

    const prevId = highlightedIdRef.current;
    if (prevId && prevId !== selectedLocationId) {
      const prev = markersByIdRef.current.get(prevId);
      if (prev) {
        const meta = (prev as MarkerWithMeta)._meta;
        if (meta) {
          prev.setIcon(pinIcon(meta.color, meta.hasPact, meta.taskCount, false));
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
      next.setIcon(pinIcon(meta.color, meta.hasPact, meta.taskCount, true));
    }
    highlightedIdRef.current = selectedLocationId;

    // Always fly to the selected pin and zoom in enough to read the
    // surrounding landmarks. The map opens fit-to-world (zoom ≈ -2),
    // so without a floor here clicking a pin barely changes the view.
    // Preserving `map.getZoom()` means we never *zoom out* if the user
    // is already closer than FOCUS_ZOOM.
    const FOCUS_ZOOM = 2;
    map.flyTo([loc.y, loc.x], Math.max(map.getZoom(), FOCUS_ZOOM), {
      duration: 0.6,
    });

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
    taskCount: number;
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
