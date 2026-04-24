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
   * Game-tile bounds the rendered image spans. Derived by least-squares
   * fit over 11 landmark `(game_tile, png_pixel)` pairs measured in
   * the source PNG. Worst residual ≈ 90 px (~30 game tiles) — the
   * wiki PNG has genuine non-linearities from tile stitching, so any
   * linear fit is a compromise between local accuracy and global
   * stability. This balance keeps Morytania pins in their districts
   * without blowing up the central Gielinor placements.
   *
   * Used by `gameToImagePixel` and by `is_surface_pin` (wikiEntities).
   */
  gameXMin: 919,
  gameXMax: 4041,
  gameYMin: 1961,
  gameYMax: 4270,
} as const;

const GAME_X_SPAN = MAP_IMAGE.gameXMax - MAP_IMAGE.gameXMin;
const GAME_Y_SPAN = MAP_IMAGE.gameYMax - MAP_IMAGE.gameYMin;

/**
 * Convert an OSRS `(x, y)` game tile coordinate to an `[x, y]` pixel
 * coordinate on the deepest-zoom image. Y is flipped because game-y
 * grows northward while image-y grows southward.
 *
 * Pair with `map.unproject(...)` to get a `LatLng` for marker placement.
 */
export function gameToImagePixel(x: number, y: number): [number, number] {
  const px = ((x - MAP_IMAGE.gameXMin) / GAME_X_SPAN) * MAP_IMAGE.widthPx;
  const py = (1 - (y - MAP_IMAGE.gameYMin) / GAME_Y_SPAN) * MAP_IMAGE.heightPx;
  return [px, py];
}

/**
 * Inverse of `gameToImagePixel` — used by the dev-only click logger
 * so we can read game coords off the map for adding new pin anchors.
 */
export function imagePixelToGame(px: number, py: number): { x: number; y: number } {
  const x = MAP_IMAGE.gameXMin + (px / MAP_IMAGE.widthPx) * GAME_X_SPAN;
  const y = MAP_IMAGE.gameYMin + (1 - py / MAP_IMAGE.heightPx) * GAME_Y_SPAN;
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
