/**
 * Final validation harness for the piecewise calibration.
 *
 * Loads the LIVE TypeScript module (so any drift between the design
 * intent in both fit scripts and the shipped implementation
 * surfaces here), runs the X label truths and Y segment truths through the
 * NEW pipeline and the BEFORE single-line fit, and prints a side-by-
 * side residual table. Also asserts that
 *    imagePixelToGame(gameToImagePixel(x, y)) == (x, y)  (within 1 tile)
 * for inputs on each segment + at the segment boundaries.
 *
 * Run:  npx tsx scripts/verify-calibration.ts
 */
import {
  MAP_IMAGE,
  gameToImagePixel,
  imagePixelToGame,
} from "../src/lib/calibration";

interface Landmark {
  name: string;
  gx: number;
  gy: number;
  truthSrcX: number;
  truthSrcY: number;
  side: "west" | "east";
}

// Same set as scripts/fit-calibration.py LANDMARK_TRUTH. Kept in sync
// by hand — both are short. Pixel positions are in source-PNG src px
// (the 9216x6528 frame); we rescale to native (8192x6059) below so we
// can compare against MAP_IMAGE.widthPx-relative outputs of
// gameToImagePixel.
const LANDMARKS: Landmark[] = [
  { name: "Civitas illa Fortis", gx: 1725, gy: 3128, truthSrcX: 2240, truthSrcY: 3270, side: "west" },
  { name: "Hosidius",            gx: 1762, gy: 3598, truthSrcX: 2305, truthSrcY: 1845, side: "west" },
  { name: "Auburnvale",          gx: 1417, gy: 3360, truthSrcX: 1322, truthSrcY: 2574, side: "west" },
  { name: "Lovakengj",           gx: 1505, gy: 3801, truthSrcX: 1543, truthSrcY: 1280, side: "west" },
  { name: "Aldarin",             gx: 1387, gy: 2918, truthSrcX: 1268, truthSrcY: 3838, side: "west" },
  { name: "Hunter Guild",        gx: 1559, gy: 3048, truthSrcX: 1820, truthSrcY: 3528, side: "west" },
  { name: "Cam Torum entrance",  gx: 1421, gy: 3114, truthSrcX: 1395, truthSrcY: 3290, side: "west" },
  { name: "Wintertodt",          gx: 1630, gy: 3981, truthSrcX: 1990, truthSrcY:  765, side: "west" },
  { name: "Tlati Rainforest",    gx: 1327, gy: 3090, truthSrcX: 1015, truthSrcY: 3340, side: "west" },
  { name: "Fortis Colosseum",    gx: 1824, gy: 3107, truthSrcX: 2587, truthSrcY: 3320, side: "west" },
  { name: "Chambers of Xeric",   gx: 1234, gy: 3578, truthSrcX:  810, truthSrcY: 1965, side: "west" },
  { name: "Falador",             gx: 3000, gy: 3360, truthSrcX: 6143, truthSrcY: 2580, side: "east" },
  { name: "Edgeville",           gx: 3080, gy: 3492, truthSrcX: 6395, truthSrcY: 2200, side: "east" },
  { name: "Camelot",             gx: 2758, gy: 3507, truthSrcX: 5400, truthSrcY: 2160, side: "east" },
  { name: "Port Phasmatys",      gx: 3679, gy: 3486, truthSrcX: 8147, truthSrcY: 2217, side: "east" },
  { name: "Yanille",             gx: 2611, gy: 3093, truthSrcX: 4985, truthSrcY: 3380, side: "east" },
  { name: "Lunar Isle",          gx: 2100, gy: 3920, truthSrcX: 3470, truthSrcY: 1010, side: "east" },
  { name: "Prifddinas",          gx: 2210, gy: 3390, truthSrcX: 3815, truthSrcY: 2625, side: "east" },
  { name: "Catherby",            gx: 2810, gy: 3447, truthSrcX: 5582, truthSrcY: 2327, side: "east" },
];

// Same feature-center truths as scripts/fit-east-y-calibration.py EAST_TRUTHS.
// Prifddinas is absent from that fit; its label-center Y is not a feature truth.
const EAST_Y_TRUTHS: [string, number, number, number][] = [
  ["Weiss salt mine",         2876, 3925,  870],
  ["Moonclan bank",           2112, 3915,  970],
  ["Jatizso throne",          2399, 3797, 1235],
  ["Neitiznot mayor",         2336, 3803, 1235],
  ["Rellekka longhall",       2659, 3679, 1670],
  ["Piscatoris fairy ring",   2415, 3526, 2010],
  ["Edgeville bank",          3094, 3491, 2200],
  ["Camelot teleport",        2758, 3478, 2230],
  ["Falador east bank",       3012, 3355, 2580],
  ["Varrock center",          3210, 3424, 2395],
  ["Port Phasmatys ectofntl", 3665, 3480, 2217],
  ["Catherby bank",           2808, 3441, 2320],
  ["Canifis center",          3492, 3476, 2255],
  ["Ardougne market",         2662, 3305, 2720],
  ["Al Kharid palace",        3293, 3180, 3075],
  ["Yanille magic guild",     2591, 3089, 3340],
  ["Port Khazard dock",       2660, 3145, 3178],
  ["Pollnivneach village",    3357, 2980, 3770],
  ["Shilo Mosol Rei",         2852, 2954, 3725],
  ["Nardah village",          3427, 2890, 3955],
];
const Y_LANDMARKS: Omit<Landmark, "truthSrcX">[] = [
  ...LANDMARKS.filter((lm) => lm.side === "west"),
  ...EAST_Y_TRUTHS.map(([name, gx, gy, truthSrcY]) => ({
    name, gx, gy, truthSrcY, side: "east" as const,
  })),
];

const SRC_W = 9216;
const SRC_H = 6528;
const SRC_TO_NATIVE_X = MAP_IMAGE.widthPx / SRC_W; // 8192/9216
const SRC_TO_NATIVE_Y = MAP_IMAGE.heightPx / SRC_H; // 6059/6528

// Old single-line fit prediction (for the BEFORE column). Mirrors
// the pre-refactor src/lib/calibration.ts exactly.
function oldGameToImagePixel(x: number, y: number): [number, number] {
  const gxSpan = MAP_IMAGE.gameXMax - MAP_IMAGE.gameXMin;
  const gySpan = MAP_IMAGE.gameYMax - MAP_IMAGE.gameYMin;
  const px = ((x - MAP_IMAGE.gameXMin) / gxSpan) * MAP_IMAGE.widthPx;
  const py = (1 - (y - MAP_IMAGE.gameYMin) / gySpan) * MAP_IMAGE.heightPx;
  return [px, py];
}

console.log("---- per-landmark validation (X axis) ----");
console.log(
  [
    "name".padEnd(22),
    "side".padEnd(5),
    "  gx ",
    "  gy ",
    "  oldPx ",
    "  newPx ",
    "  truthPx",
    "  |errOld|",
    "  |errNew|",
  ].join(" "),
);

let worstWestOldX = 0;
let worstWestNewX = 0;
let worstEastOldX = 0;
let worstEastNewX = 0;

for (const lm of LANDMARKS) {
  const [oldNx] = oldGameToImagePixel(lm.gx, lm.gy);
  const [newNx] = gameToImagePixel(lm.gx, lm.gy);
  const truthNx = lm.truthSrcX * SRC_TO_NATIVE_X;
  const errOld = Math.abs(oldNx - truthNx);
  const errNew = Math.abs(newNx - truthNx);
  if (lm.side === "west") {
    worstWestOldX = Math.max(worstWestOldX, errOld);
    worstWestNewX = Math.max(worstWestNewX, errNew);
  } else {
    worstEastOldX = Math.max(worstEastOldX, errOld);
    worstEastNewX = Math.max(worstEastNewX, errNew);
  }
  console.log(
    [
      lm.name.padEnd(22),
      lm.side.padEnd(5),
      lm.gx.toString().padStart(5),
      lm.gy.toString().padStart(5),
      oldNx.toFixed(1).padStart(8),
      newNx.toFixed(1).padStart(8),
      truthNx.toFixed(1).padStart(9),
      errOld.toFixed(1).padStart(10),
      errNew.toFixed(1).padStart(10),
    ].join(" "),
  );
}

console.log();
console.log("---- per-landmark validation (Y axis) ----");
console.log(
  [
    "name".padEnd(22),
    "side".padEnd(5),
    "  gx ",
    "  gy ",
    "  oldPy ",
    "  newPy ",
    "  truthPy",
    "  |errOld|",
    "  |errNew|",
  ].join(" "),
);

let worstWestOldY = 0;
let worstWestNewY = 0;
let worstEastOldY = 0;
let worstEastNewY = 0;

for (const lm of Y_LANDMARKS) {
  const [, oldNy] = oldGameToImagePixel(lm.gx, lm.gy);
  const [, newNy] = gameToImagePixel(lm.gx, lm.gy);
  const truthNy = lm.truthSrcY * SRC_TO_NATIVE_Y;
  const errOld = Math.abs(oldNy - truthNy);
  const errNew = Math.abs(newNy - truthNy);
  if (lm.side === "west") {
    worstWestOldY = Math.max(worstWestOldY, errOld);
    worstWestNewY = Math.max(worstWestNewY, errNew);
  } else {
    worstEastOldY = Math.max(worstEastOldY, errOld);
    worstEastNewY = Math.max(worstEastNewY, errNew);
  }
  console.log(
    [
      lm.name.padEnd(22),
      lm.side.padEnd(5),
      lm.gx.toString().padStart(5),
      lm.gy.toString().padStart(5),
      oldNy.toFixed(1).padStart(8),
      newNy.toFixed(1).padStart(8),
      truthNy.toFixed(1).padStart(9),
      errOld.toFixed(1).padStart(10),
      errNew.toFixed(1).padStart(10),
    ].join(" "),
  );
}

console.log();
console.log("---- worst-case |error| in NATIVE px (and game tiles) ----");
const tilePx = MAP_IMAGE.widthPx / (MAP_IMAGE.gameXMax - MAP_IMAGE.gameXMin);
const fmt = (px: number) => `${px.toFixed(1).padStart(7)} (${(px / tilePx).toFixed(1)} t)`;
console.log(`  X west: OLD=${fmt(worstWestOldX)} → NEW=${fmt(worstWestNewX)}`);
console.log(`  X east: OLD=${fmt(worstEastOldX)} → NEW=${fmt(worstEastNewX)}`);
console.log(`  Y west: OLD=${fmt(worstWestOldY)} → NEW=${fmt(worstWestNewY)}`);
console.log(`  Y east: OLD=${fmt(worstEastOldY)} → NEW=${fmt(worstEastNewY)}  (Prifddinas excluded)`);

// Round-trip assertions. Sample on each segment + boundaries.
console.log();
console.log("---- round-trip imagePixelToGame(gameToImagePixel(x, y)) ----");
const samples: [number, number, string][] = [
  [919, 1961, "SW corner"],
  [1387, 2918, "Aldarin (west)"],
  [1505, 3801, "Lovakengj (west)"],
  [1725, 3128, "Civitas (west)"],
  [1999, 3000, "STITCH-1 (west)"],
  [2000, 3000, "STITCH (east)"],
  [2100, 3920, "Lunar Isle (east)"],
  [2210, 3390, "Prifddinas (east)"],
  [3000, 3360, "Falador (east)"],
  [4041, 4270, "NE corner"],
];
let maxRoundTripErr = 0;
for (const [gx, gy, label] of samples) {
  const [px, py] = gameToImagePixel(gx, gy);
  const back = imagePixelToGame(px, py);
  const dx = back.x - gx;
  const dy = back.y - gy;
  const err = Math.max(Math.abs(dx), Math.abs(dy));
  maxRoundTripErr = Math.max(maxRoundTripErr, err);
  const ok = err <= 1 ? "OK " : "BAD";
  console.log(
    `  ${ok} ${label.padEnd(20)} (${gx},${gy}) → px=(${px.toFixed(1)},${py.toFixed(1)}) → (${back.x},${back.y}) Δ=(${dx},${dy})`,
  );
}
console.log(`  max round-trip |Δ|: ${maxRoundTripErr} game tile(s)`);

// Stitch continuity check: two pixels straddling STITCH_X but only one game
// tile apart should still invert close to each other.
console.log();
console.log("---- stitch-boundary discontinuity ----");
const [pxJustWest] = gameToImagePixel(1999, 3000);
const [pxAtStitch] = gameToImagePixel(2000, 3000);
console.log(`  gx=1999 → px=${pxJustWest.toFixed(2)} (west segment)`);
console.log(`  gx=2000 → px=${pxAtStitch.toFixed(2)} (east segment)`);
console.log(
  `  pixel jump between adjacent game tiles at the stitch: ${(pxAtStitch - pxJustWest).toFixed(2)} native px`,
);
console.log(
  "  (this jump lives entirely inside the inter-continental ocean, so no marker can sit at a position the discontinuity would render incorrectly.)",
);

if (maxRoundTripErr > 1) {
  console.error("FAIL: round-trip exceeded 1 game tile.");
  process.exit(1);
}
if (worstWestNewX > worstWestOldX) {
  console.error("FAIL: new west X residual is worse than old.");
  process.exit(1);
}
if (worstWestNewY > worstWestOldY) {
  console.error("FAIL: new west Y residual is worse than old.");
  process.exit(1);
}
// The X refit leaves the east X fit untouched.
if (worstEastNewX > worstEastOldX + 0.01) {
  console.error("FAIL: east X residual regressed.");
  process.exit(1);
}
// The shipped east Y fit peaks at 81.9 source px (76.0 native px).
// Allow 1.1 source px of headroom; the old fit's 122.9 source px fails.
const EAST_Y_MAX_RESIDUAL_SRC_PX = 83;
const worstEastNewYSrc = worstEastNewY / SRC_TO_NATIVE_Y;
console.log(`  east Y feature residual: ${worstEastNewYSrc.toFixed(1)} source px; limit: ${EAST_Y_MAX_RESIDUAL_SRC_PX} source px`);
if (!Number.isFinite(worstEastNewYSrc) || worstEastNewYSrc > EAST_Y_MAX_RESIDUAL_SRC_PX) {
  console.error("FAIL: east Y residual regressed.");
  process.exit(1);
}
console.log();
console.log("PASS — calibration validated.");
