import type L from "leaflet";

/**
 * Calibration between OSRS game tile coordinates and the world map raster.
 *
 * NOTE: this module is consumed by both the runtime (MapView) and the
 * Node-side build script (scripts/build-runtime-data.ts) via the
 * wikiEntities → calibration import chain. It MUST stay free of Leaflet
 * runtime imports — only `import type L` is allowed, otherwise the
 * Node script crashes with `ReferenceError: window is not defined`.
 *
 * The map is delivered to the browser as a Leaflet tile pyramid (see
 * scripts/tile-map-image.py) under `/map/tiles/{z}/{x}/{y}.webp`. The
 * deepest zoom level renders the world at native pixel density:
 *   z=0 → 256×189 px (1 tile)            … fit-to-world on phones
 *   z=1 → 512×378 px (4 tiles)           … fit-to-world on tablets
 *   z=2 → 1024×757 px (12 tiles)         … desktop fit-to-world
 *   z=3 → 2048×1515 px (48 tiles)
 *   z=4 → 4096×3030 px (192 tiles)
 *   z=5 → 8192×6059 px (768 tiles)       … native; max zoom
 *
 * The base CRS is `L.CRS.Simple` with the world coord system equal to
 * the deepest-zoom pixel grid, so:
 *   `map.unproject([px, py], MAP_IMAGE.maxNativeZoom)` → LatLng for a marker
 *   `map.project(latlng,    MAP_IMAGE.maxNativeZoom)` → pixel coords
 *
 * Markers live in OSRS game coords and get converted to image-pixel
 * coords via `gameToImagePixel(x, y)` at marker-build time.
 */
export const MAP_IMAGE = {
  /** Tile URL template consumed by `L.tileLayer`. */
  tileUrl: "/map/tiles/{z}/{x}/{y}.webp",
  /** Pixel size of each tile. Matches scripts/tile-map-image.py. */
  tileSize: 256,
  /**
   * Deepest pre-rendered zoom level. Going higher would force Leaflet
   * to upscale tiles client-side; previously rejected as "blurry af"
   * by the user, so we cap at native density. Computed as
   *   `log2(nativeWidthPx / tileSize)` from the tiling script.
   */
  maxNativeZoom: 5,
  /**
   * Native dimensions of the assembled image at `maxNativeZoom`. These
   * MUST match the tiling script's pre-distortion output, otherwise
   * markers will sit a fraction of a pixel off the map.
   */
  widthPx: 8192,
  heightPx: 6059,
  /**
   * Game-tile bounds the rendered image spans. The X axis is PIECEWISE
   * (see GAME_X_BASE_* below); these envelope bounds describe the
   * union of both segments. Used by `is_surface_pin` filters in
   * wikiEntities.ts to reject coords that fall outside any rendered
   * region.
   */
  gameXMin: 919,
  gameXMax: 4041,
  gameYMin: 1961,
  gameYMax: 4270,
} as const;

/**
 * Piecewise X-axis calibration.
 *
 * Why piecewise? The wiki world-map PNG is a STITCHED composite: the
 * western continent (Kourend + Varlamore + small islands like Aldarin —
 * game x ≲ 1900) is pasted in as a separate block from mainland
 * Gielinor (game x ≳ 2150), and the inter-continental ocean in the
 * PNG is wider than what a uniform game-tile-to-pixel projection
 * predicts. A single global linear fit averages the two scales, locks
 * onto the east (where most of our calibration landmarks live), and
 * pushes every western pin 150-250 native px (~50-80 game tiles) east
 * of where it should be.
 *
 * The fix: keep one slope (px-per-game-tile is the same across both
 * chunks — the wiki rendered them at one scale and just left a
 * wider-than-uniform empty ocean between), and use a different X
 * "origin" per segment. The western origin shifts gameXMin east by 44
 * game tiles, moving every western pin 44 tiles west on the rendered
 * image — the magnitude needed to cancel the inter-continental ocean's
 * extra width.
 *
 * History — first fit said 65 tiles, but that was based on imprecise
 * LANDMARK_TRUTH measurements (some truth coordinates were placed at
 * sub-region edges or 50+ src px south of label centers). After
 * re-measuring against the wiki PNG label-text centers — and adding
 * 5 more clear point landmarks in southern Varlamore where the user
 * spotted the regression — the corrected magnitude is 44 tiles. See
 * scripts/fit-calibration.py LANDMARK_TRUTH for the truth-position
 * rules and the per-landmark numbers.
 *
 * Derivation (reproducible):
 *   scripts/fit-calibration.py  → run with `--validate` to dump
 *   before/after overlay crops to /tmp/cal_debug/refit/. The script's
 *   header has the full methodology.
 *
 * Landmarks used for the western fit (n=11, source: locations.ts /
 * wiki-coords.json `wiki` field for game x; pixel positions read from
 * /tmp/osrs_worldmap.orig.png at 50-px-grid zoom against the printed
 * label-text center):
 *   Civitas illa Fortis, Hosidius, Auburnvale, Lovakengj, Aldarin,
 *   Hunter Guild, Cam Torum entrance, Wintertodt, Tlati Rainforest,
 *   Fortis Colosseum, Chambers of Xeric.
 *
 * Worst-case residuals after refit (in source-PNG src px / game tiles):
 *   west: 61 px / 21 tiles  (was 189 px / 64 tiles with the old single-
 *                            line fit — 3.1x improvement). The residual
 *                            ceiling reflects the wiki PNG's underlying
 *                            non-linearity, not the fit.
 *   east: 29 px / 10 tiles  (unchanged; eastern landmarks confirm the
 *                            existing single-line fit is correct on
 *                            mainland Gielinor / Tirannwn / Lunar Isle).
 *
 * STITCH_X = 2000 chosen because it falls in the genuinely empty
 * inter-continental ocean: the probe in fit-calibration.py shows the
 * source-PNG ocean spans src x ∈ [2660, 3605], and STITCH_X projects
 * to src x ≈ 3061 (west segment) / 3191 (east segment) — both inside
 * that empty range. The 130-src-px discontinuity at the stitch is
 * therefore invisible (no pixels there belong to any landmark; the
 * runtime `isOnMap` filter does not depend on this gap).
 *
 * All Tirannwn (Prifddinas at gx=2210, Lletya at gx=2330, Port Tyras
 * at gx=2150) and Lunar Isle (gx=2100) sit at game x ≥ STITCH_X, so
 * they continue to use the eastern segment that already places them
 * correctly. Only Kourend + Varlamore + Aldarin shift.
 */
const GAME_X_BASE_EAST = MAP_IMAGE.gameXMin; // 919 — unchanged
const GAME_X_BASE_WEST = 963; // = 919 + 44; shifts west pins 44 tiles west on the image
const STITCH_X = 2000;

/**
 * Piecewise Y-axis calibration.
 *
 * Both continents use a separate (base, span) Y fit because each was
 * composited into the wiki PNG at a slightly different Y scale. The
 * east historically used MAP_IMAGE.gameYMin / heightPx directly, but
 * that fit was derived against wiki LABEL-TEXT centers — which sit
 * 20-60 src-px above the actual teleport/feature pixels that every
 * pin in wikiEntities.json references. The bias is small at mid
 * latitudes and grows at the extremes, producing the "plane squished
 * vertically" symptom: extreme-north pins (Jatizso / Neitiznot / Lunar
 * Isle / Weiss) sit south of their features, and extreme-south pins
 * (Nardah / Pollnivneach / Shilo) sit north of theirs.
 *
 * The east Y refit uses 20 canonical feature pixels measured directly
 * off /tmp/osrs_worldmap.orig.png — castle centers, bank sprites, town
 * cluster centroids, teleport landing spots — NOT label text. Free
 * least-squares fit → slope = -2.9553 src-px/tile (vs previous
 * -2.8272), intercept ≈ 12494.7 src px. Converted to the (base, span)
 * form and snapped:
 *
 *   GAME_Y_BASE_EAST = 2019   (was 1961; +58-tile shift of Y origin)
 *   GAME_Y_SPAN_EAST = 2209   (was 2309; 4.3% tighter span)
 *
 * Worst residual drops from 123 → 82 src-px; RMS from 54 → 34 src-px.
 * Before/after overlay crops: /tmp/cal_debug/yfit/ (red = old, green =
 * new, cyan diamond = measured truth). Every mid-latitude landmark
 * (Edgeville, Camelot, Falador, Varrock, Catherby, Canifis, Port
 * Phasmatys) moves ≤10 src-px; the fix is almost entirely at the
 * extremes, matching the user-reported symptom.
 *
 * The west Y fit was validated against the same method (Wintertodt,
 * Aldarin, Hunter Guild, Arceuus, Hosidius) and found acceptable
 * (±30-50 src-px worst) — west labels are drawn closer to features,
 * so the label-vs-feature bias is smaller. Left untouched.
 *
 * Segment split reuses STITCH_X = 2000 from the X calibration above.
 */
const GAME_Y_BASE_EAST = 2019;
const GAME_Y_SPAN_EAST = 2209;
const GAME_Y_BASE_WEST = 2007;
const GAME_Y_SPAN_WEST = 2232;

/**
 * Game-x span used by BOTH segments as the per-tile pixel scale's
 * denominator. Holding this constant across segments is what gives
 * them identical slopes (= same px-per-game-tile) — the only thing
 * that varies between segments is the X origin (`GAME_X_BASE_*`).
 */
const GAME_X_SPAN = MAP_IMAGE.gameXMax - GAME_X_BASE_EAST;

/**
 * Threshold in IMAGE-PIXEL space that decides which X segment
 * `imagePixelToGame` should invert through. Computed as the western
 * segment's pixel position for STITCH_X — any pixel west of this came
 * from the western segment, anything east of it from the eastern
 * segment. The narrow ambiguous strip in between (the stitch
 * discontinuity) maps to "east" by convention; the strip lies in
 * empty ocean so the choice is cosmetic.
 */
const STITCH_PX_WEST =
  ((STITCH_X - GAME_X_BASE_WEST) / GAME_X_SPAN) * MAP_IMAGE.widthPx;

/**
 * Convert an OSRS `(x, y)` game tile coordinate to an `[x, y]` pixel
 * coordinate on the deepest-zoom image. Y is flipped because game-y
 * grows northward while image-y grows southward. X uses the piecewise
 * fit documented above.
 *
 * Pair with `map.unproject(...)` to get a `LatLng` for marker placement.
 */
export function gameToImagePixel(x: number, y: number): [number, number] {
  const isWest = x < STITCH_X;
  const xBase = isWest ? GAME_X_BASE_WEST : GAME_X_BASE_EAST;
  const yBase = isWest ? GAME_Y_BASE_WEST : GAME_Y_BASE_EAST;
  const ySpan = isWest ? GAME_Y_SPAN_WEST : GAME_Y_SPAN_EAST;
  const px = ((x - xBase) / GAME_X_SPAN) * MAP_IMAGE.widthPx;
  const py = (1 - (y - yBase) / ySpan) * MAP_IMAGE.heightPx;
  return [px, py];
}

/**
 * Inverse of `gameToImagePixel` — used by the dev-only click logger
 * so we can read game coords off the map for adding new pin anchors.
 * Splits on `STITCH_PX_WEST` so a click on the western continent
 * inverts through the western segment and a click anywhere east of
 * the inter-continental ocean inverts through the eastern segment.
 */
export function imagePixelToGame(px: number, py: number): { x: number; y: number } {
  const isWest = px < STITCH_PX_WEST;
  const xBase = isWest ? GAME_X_BASE_WEST : GAME_X_BASE_EAST;
  const yBase = isWest ? GAME_Y_BASE_WEST : GAME_Y_BASE_EAST;
  const ySpan = isWest ? GAME_Y_SPAN_WEST : GAME_Y_SPAN_EAST;
  const x = xBase + (px / MAP_IMAGE.widthPx) * GAME_X_SPAN;
  const y = yBase + (1 - py / MAP_IMAGE.heightPx) * ySpan;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Unproject the native-image corners to LatLng for use as the map's
 * `maxBounds` and the tile layer's `bounds`. Returned as a tuple so
 * callers can pass it through `L.latLngBounds` without this module
 * depending on the Leaflet runtime (see header comment).
 */
export function imageCorners(map: L.Map): {
  sw: L.LatLng;
  ne: L.LatLng;
} {
  return {
    sw: map.unproject([0, MAP_IMAGE.heightPx], MAP_IMAGE.maxNativeZoom),
    ne: map.unproject([MAP_IMAGE.widthPx, 0], MAP_IMAGE.maxNativeZoom),
  };
}

/**
 * Convert game coords to a `LatLng` for the given map. Wraps the
 * `gameToImagePixel` + `unproject` combo callers always need.
 */
export function gameToLatLng(map: L.Map, x: number, y: number): L.LatLng {
  const [px, py] = gameToImagePixel(x, y);
  return map.unproject([px, py], MAP_IMAGE.maxNativeZoom);
}

export const INITIAL_VIEW = {
  /**
   * Whole-map fit at z=0 (256×189 px). Smaller would force Leaflet to
   * downscale a 1-tile image further; not useful.
   */
  minZoom: 0,
  /** Native pixel density. See `maxNativeZoom`. */
  maxZoom: MAP_IMAGE.maxNativeZoom,
  /**
   * Drop the user into Civitas illa Fortis (Varlamore's capital) on
   * page load. This is the league's home region — the Demonic Pacts
   * starting area, hosting Yama's Lair, the Colosseum, the Hunter
   * Guild, and the densest cluster of pact tasks. Fit-to-world was
   * accurate but felt empty; landing on Civitas immediately shows
   * pins the user is most likely looking for, and they can zoom out
   * to see the rest of Gielinor with a single pinch / scroll.
   */
  centerGame: { x: 1725, y: 3128 },
  /**
   * Matches `FOCUS_ZOOM` in MapView's pin-flyTo logic so the initial
   * landing zoom is identical to what users see when they click a
   * sidebar task. ~4096 px wide image — wide enough to see Civitas,
   * Avium Savannah, and Yama's Lair in one frame on a 1024 viewport.
   */
  zoom: 4,
};
