import L from "leaflet";

/**
 * Calibration between OSRS game tile coordinates and the world map PNG.
 *
 * The PNG (9216 × 6528 px) is a render of the full Gielinor surface. In
 * Leaflet we treat it as a `L.CRS.Simple` image overlay where
 *   latitude  = game_y  (positive = north)
 *   longitude = game_x  (positive = east)
 *
 * These bounds describe the game area the image spans. If pin placements
 * look consistently offset, tweak these four numbers — a 2-landmark
 * calibration is sufficient (pick a landmark's real in-game coord and
 * the map-click coord the dev overlay reports, then solve).
 */
export const MAP_IMAGE = {
  url: "/map/osrs_worldmap.webp",
  // Asset is pre-distorted (9216 × 6816) to match the calibrated game-tile
  // aspect ratio below, so Leaflet does a uniform scale instead of a 4%
  // squish. See scripts/optimize-map-image.py. The ORIGINAL source PNG was
  // 9216 × 6528 with non-square tile density (2.95 vs 2.83 px/tile), which
  // the bounds below absorbed via different x/y scales. We keep the full
  // source width in the WebP because the max-zoom view stretches the image
  // to ~24k CSS px wide; a smaller base would need 3x+ browser upscaling
  // and look smeared.
  widthPx: 9216,
  heightPx: 6816,
  // Bounds obtained by least-squares fit over 11 landmark
  // (game_tile, png_pixel) pairs measured directly in the PNG.
  // Central Gielinor: Lumbridge, Varrock Palace, Falador WK, Camelot,
  // Catherby, Al Kharid, Ardougne castles.
  // Morytania (added so the fit doesn't drift on the east side of the map):
  // Canifis, Port Phasmatys, Ectofuntus, Burgh de Rott.
  // Worst residual ≈ 90 px (~30 tiles) on the source PNG. The OSRS wiki
  // world map PNG has some genuine non-linearity from tile stitching, so
  // any linear fit is necessarily a compromise; this version balances
  // accuracy across the whole map instead of being locally perfect in the
  // center and way off in Morytania. See /tmp/cal/fit2.py for the
  // computation.
  gameXMin: 919,
  gameXMax: 4041,
  gameYMin: 1961,
  gameYMax: 4270,
} as const;

export const IMAGE_BOUNDS: L.LatLngBoundsExpression = [
  [MAP_IMAGE.gameYMin, MAP_IMAGE.gameXMin],
  [MAP_IMAGE.gameYMax, MAP_IMAGE.gameXMax],
];

export function gameToLatLng(x: number, y: number): [number, number] {
  return [y, x];
}

export function latLngToGame(latlng: L.LatLng): { x: number; y: number } {
  return { x: Math.round(latlng.lng), y: Math.round(latlng.lat) };
}

/** Zoom bounds for the map. Actual center/zoom is set via fitBounds. */
export const INITIAL_VIEW = {
  center: gameToLatLng(2500, 3300) as L.LatLngExpression,
  zoom: -2,
  minZoom: -3,
  // Cap at 2 so the image is never upscaled more than ~1.4x over its
  // native 9216-wide resolution. Going to z=3 would stretch the source
  // 2.7x and introduce visible bilinear smear. Users can still zoom far
  // enough at z=2 to read any in-map label.
  maxZoom: 2,
};
