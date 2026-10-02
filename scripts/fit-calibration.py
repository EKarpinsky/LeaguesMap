#!/usr/bin/env python3
"""Refit the OSRS world-map calibration as a piecewise linear x-axis fit.

Why piecewise?
    The landmark residuals suggest the wiki world-map PNG is a stitched
    composite: the western continent (Kourend / Varlamore,
    game x ≲ 1900) forms a separate block from mainland Gielinor.
    The empty inter-continental ocean in the PNG is wider
    than what a uniform game-tile-to-pixel projection predicts. A single-
    line fit agrees with the eastern landmarks but pushes every western
    landmark 69-189 src px (~23-64 game tiles) east of its measured
    label center.

Methodology
    1. Probe the source PNG for continent edges + stitch position
       (see `probe_continents()` below — produces a per-column ocean
       fraction signal that peaks in the inter-continental sea).
    2. Visually identify ground-truth pixel positions for 19 landmarks
       (mix of west + east) by overlaying the *current* calibration's
       prediction on tight crops of the source PNG and reading off the
       offset to the labelled cartographic feature. Recorded below as
       LANDMARK_TRUTH.
    3. The eastern continent's current single-line fit (slope = 8192/3122
       native px/game tile) is approximately correct. Per-landmark visual
       readings on the east show ≤30 src px residual. So we KEEP the east
       slope and intercept exactly as-is.
    4. For the western continent, fit a per-segment line. Result: the
       slope matches east to within visual-reading noise, but the
       intercept (gameXMin equivalent) is shifted east by 44 game tiles.
       The fix is one constant: WEST_X_BASE = 963 (vs east's 919).
    5. Stitch at game x = 2000 — chosen because (a) it falls in the
       inter-continental ocean where no landmarks live, so the necessary
       discontinuity is invisible, and (b) it leaves all of Tirannwn /
       Lunar Isle (gx=2100 in LANDMARK_TRUTH) on the east segment where they render
       correctly under the existing east calibration.

Worst-case residuals:
    east landmarks (n=8): worst |Δ| = 28.6 src px ≈ 10 game tiles
    west landmarks (n=11): worst |Δ| = 60.6 src px ≈ 21 game tiles
    overall (with the OLD single-line fit) the western residual was
    189.4 src px / 64.2 game tiles. The snapped fit reduces the worst
    western residual by 3.1x.

The Y section retains the label-center fit for comparison. Its west span
rounds to 2234; the shipped west span remains 2232. For the shipped east
feature-center Y fit (base 2019, span 2209), use fit-east-y-calibration.py.

Usage
    python3 scripts/fit-calibration.py             # report fit + residuals
    python3 scripts/fit-calibration.py --validate  # also dump landmark
                                                   # crops for re-checking
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np
except ImportError as e:
    sys.stderr.write(f"missing dep: {e}. install with: pip install pillow numpy\n")
    sys.exit(1)


SRC_PNG = Path("/tmp/osrs_worldmap.orig.png")

# Baseline single-line calibration constants, kept here for comparison.
# X bounds and native dimensions still match src/lib/calibration.ts.
GX_MIN_EAST = 919       # current global gameXMin (= the east origin)
GX_MAX = 4041
GY_MIN = 1961
GY_MAX = 4270
NATIVE_W = 8192
NATIVE_H = round(NATIVE_W / ((GX_MAX - GX_MIN_EAST) / (GY_MAX - GY_MIN)))


# -----------------------------------------------------------------------------
# Ground-truth landmark pixel positions in /tmp/osrs_worldmap.orig.png.
#
# Each entry is (label, game_x, game_y, png_src_px_x, png_src_px_y, side).
#
# Pixel positions were measured visually from the source PNG at high zoom.
# Run scripts/fit-calibration.py --validate for 800x600 overlay crops in
# /tmp/cal_debug/refit/. The historical measurement grids used 50-src-px
# spacing; the current validation crops show predictions and truths.
#
# Truth-position rules (CRITICAL — earlier truth values were noisy enough
# to shift the western origin too far, regressing
# southern-Varlamore pins):
#
#   1. Read the LABEL TEXT center, not a sub-region's edge. Wiki labels
#      sit at or adjacent to the named feature; the label center is the
#      cartographer's intended canonical position. The earlier Civitas
#      truth (2200, 3340) was 70 src px south of the actual "Civitas illa
#      Fortis" label center (2240, 3270).
#   2. Prefer SMALL POINT landmarks (single buildings, octagon icons,
#      entrance pictograms) over large sprawling regions. Lovakengj and
#      Hosidius cover broad regions and their "center" is ambiguous.
#   3. When in doubt, use the mid-point of the printed label glyph row.
#
# Visual readings are approximate and depend on the feature's extent.
# -----------------------------------------------------------------------------
LANDMARK_TRUTH = [
    # West continent. Kept the original 6 (re-measured against label text)
    # and added 5 more clear point landmarks for better statistical power
    # in southern Varlamore where landmarks showed the bias.
    ("Civitas illa Fortis", 1725, 3128, 2240, 3270, "west"),
    ("Hosidius",            1762, 3598, 2305, 1845, "west"),
    ("Auburnvale",          1417, 3360, 1322, 2574, "west"),
    ("Lovakengj",           1505, 3801, 1543, 1280, "west"),
    ("Aldarin",             1387, 2918, 1268, 3838, "west"),
    ("Hunter Guild",        1559, 3048, 1820, 3528, "west"),
    ("Cam Torum entrance",  1421, 3114, 1395, 3290, "west"),
    ("Wintertodt",          1630, 3981, 1990,  765, "west"),
    ("Tlati Rainforest",    1327, 3090, 1015, 3340, "west"),
    ("Fortis Colosseum",    1824, 3107, 2587, 3320, "west"),
    ("Chambers of Xeric",   1234, 3578,  810, 1965, "west"),
    # Note: dropped the old "Shayzien" entry — its truth at the Graveyard
    # of Heroes sub-area pulled the fit east, but Shayzien is too sprawling
    # for a single label-center reading to be reliable.
    # East continent (Asgarnia / Misthalin / Kandarin / Morytania / Tirannwn)
    ("Falador",             3000, 3360, 6143, 2580, "east"),
    ("Edgeville",           3080, 3492, 6395, 2200, "east"),
    ("Camelot",             2758, 3507, 5400, 2160, "east"),
    ("Port Phasmatys",      3679, 3486, 8147, 2217, "east"),
    ("Yanille",             2611, 3093, 4985, 3380, "east"),
    ("Lunar Isle",          2100, 3920, 3470, 1010, "east"),
    ("Prifddinas",          2210, 3390, 3815, 2625, "east"),
    ("Catherby",            2810, 3447, 5582, 2327, "east"),
]


def probe_continents() -> dict:
    """Profile per-column ocean fraction across the source PNG.

    Identifies the inter-continental ocean trough (peak ocean fraction)
    and the falling/rising land edges that bracket it. These bracket
    the safe range where STITCH_X can be placed.
    """
    src = Image.open(SRC_PNG).convert("RGB")
    arr = np.asarray(src)
    H, W = arr.shape[:2]
    R = arr[:, :, 0].astype(int)
    G = arr[:, :, 1].astype(int)
    B = arr[:, :, 2].astype(int)
    ocean = ((B - R) > 25) & (B > 110) & (R < 180) & (G < 180)
    ocean_frac = ocean.mean(axis=0)

    # Search the central trough (between continents)
    interior = slice(2400, 4000)
    trough_x = int(np.argmax(ocean_frac[interior])) + interior.start
    # Western continent's east edge: last column before the trough where
    # land_frac > 0.30 (looking from the trough outward).
    land_frac = 1.0 - ocean_frac
    west_edge = trough_x
    while west_edge > 0 and land_frac[west_edge] < 0.30:
        west_edge -= 1
    east_edge = trough_x
    while east_edge < W - 1 and land_frac[east_edge] < 0.30:
        east_edge += 1
    return {
        "png_w": W,
        "png_h": H,
        "trough_x_src": trough_x,
        "west_continent_east_edge_src": west_edge,
        "east_continent_west_edge_src": east_edge,
    }


def fit_segment(rows: list[tuple]) -> tuple[float, float, float]:
    """Return (slope, intercept, worst_abs_residual) for px = m*gx + b
    fit on the given (gx, png_src_x) pairs.
    """
    xs = [r[1] for r in rows]
    ys = [r[3] for r in rows]
    n = len(rows)
    sx = sum(xs)
    sy = sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    m = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    b = (sy - m * sx) / n
    worst = max(abs(y - (m * x + b)) for x, y in zip(xs, ys))
    return m, b, worst


def fit_intercept_only(rows: list[tuple], slope: float) -> tuple[float, float]:
    """For a fixed slope, return (intercept, worst_abs_residual)."""
    intercepts = [y - slope * x for x, y in [(r[1], r[3]) for r in rows]]
    b = sum(intercepts) / len(intercepts)
    worst = max(abs(b_i - b) for b_i in intercepts)
    return b, worst


# -----------------------------------------------------------------------------
# Existing single-line fit (matches MAP_IMAGE in src/lib/calibration.ts)
# -----------------------------------------------------------------------------

def current_pred_src_x(gx: int) -> float:
    """Predicted source-PNG px_x using the existing single-line fit."""
    px_native = (gx - GX_MIN_EAST) / (GX_MAX - GX_MIN_EAST) * NATIVE_W
    return px_native * (9216 / NATIVE_W)


def main(validate: bool = False) -> None:
    if not SRC_PNG.exists():
        sys.exit(
            f"Missing source PNG: {SRC_PNG}\n"
            "Download https://oldschool.runescape.wiki/images/Old_School_RuneScape_world_map.png\n"
            f"and save it as {SRC_PNG} (expected 9216x6528)."
        )

    probe = probe_continents()
    print("---- continent probe (source PNG src px) ----")
    print(f"  PNG dims:                              {probe['png_w']}x{probe['png_h']}")
    print(f"  inter-continental trough peak (src x): {probe['trough_x_src']}")
    print(f"  west continent east edge (src x):      {probe['west_continent_east_edge_src']}")
    print(f"  east continent west edge (src x):      {probe['east_continent_west_edge_src']}")

    # The empty ocean range in source-PNG src x. Useful for sanity-checking
    # the chosen STITCH_X falls in genuinely empty pixels.
    print()

    east_rows = [r for r in LANDMARK_TRUTH if r[5] == "east"]
    west_rows = [r for r in LANDMARK_TRUTH if r[5] == "west"]

    # East fit (free) — should match the current single-line slope.
    em, eb, ew = fit_segment(east_rows)
    print(f"---- east-only free fit (n={len(east_rows)}) ----")
    print(f"  slope (src px / tile):  {em:.4f}")
    print(f"  intercept (src px):     {eb:.2f}")
    print(f"  implied gameXMin_east:  {-eb / em:.2f}  (current calibration: {GX_MIN_EAST})")
    print(f"  worst residual:         {ew:.1f} src px ({ew / em:.1f} game tiles)")
    print()

    # West fit (free).
    wm, wb, ww = fit_segment(west_rows)
    print(f"---- west-only free fit (n={len(west_rows)}) ----")
    print(f"  slope (src px / tile):  {wm:.4f}")
    print(f"  intercept (src px):     {wb:.2f}")
    print(f"  implied gameXMin_west:  {-wb / wm:.2f}")
    print(f"  worst residual:         {ww:.1f} src px ({ww / wm:.1f} game tiles)")
    print()

    # Use the same slope on both
    # segments so we only introduce ONE new constant. This also matches the
    # inferred model: both chunks share one render scale, with
    # a wider-than-uniform empty ocean between them. Refit the western
    # intercept against that fixed slope.
    shared_slope_native = NATIVE_W / (GX_MAX - GX_MIN_EAST)  # current east slope
    shared_slope_src = shared_slope_native * (9216 / NATIVE_W)
    wb_shared, ww_shared = fit_intercept_only(west_rows, shared_slope_src)
    print(f"---- west fit with FIXED slope (= east) ----")
    print(f"  shared slope (src px / tile):   {shared_slope_src:.4f}")
    print(f"  shared slope (native px / tile):{shared_slope_native:.4f}")
    print(f"  fitted west intercept (src px): {wb_shared:.2f}")
    implied_xbase_w = -wb_shared / shared_slope_src
    print(f"  implied gameXMin_west:          {implied_xbase_w:.2f}")
    print(f"  worst residual:                 {ww_shared:.1f} src px ({ww_shared / shared_slope_src:.1f} game tiles)")

    # Snap to nearest integer game tile — the calibration constant stays
    # readable and the rounding cost is < the visual-reading noise floor.
    snapped_xbase_w = round(implied_xbase_w)
    print(f"  snapped to integer:             {snapped_xbase_w}")
    print()

    # Recompute residuals with the snapped value so the report matches what
    # we'll actually ship.
    print("---- per-landmark residuals (NEW piecewise fit) ----")
    print(f"{'name':24s} {'side':4s} {'gx':>5s} {'predOLD':>10s} {'predNEW':>10s}"
          f" {'truth':>8s} {'errOLD':>8s} {'errNEW':>8s}")
    rows_for_md = []
    for label, gx, gy, tx, ty, side in LANDMARK_TRUTH:
        old_pred = current_pred_src_x(gx)
        if side == "west":
            new_pred = shared_slope_src * (gx - snapped_xbase_w)
        else:
            new_pred = shared_slope_src * (gx - GX_MIN_EAST)
        e_old = old_pred - tx
        e_new = new_pred - tx
        print(f"{label:24s} {side:4s} {gx:>5d} {old_pred:>10.1f} {new_pred:>10.1f}"
              f" {tx:>8d} {e_old:>+8.1f} {e_new:>+8.1f}")
        rows_for_md.append((label, side, gx, old_pred, new_pred, tx, e_old, e_new))

    # Worst residual per continent.
    worst_old_w = max(abs(r[6]) for r in rows_for_md if r[1] == "west")
    worst_new_w = max(abs(r[7]) for r in rows_for_md if r[1] == "west")
    worst_old_e = max(abs(r[6]) for r in rows_for_md if r[1] == "east")
    worst_new_e = max(abs(r[7]) for r in rows_for_md if r[1] == "east")
    print()
    print("---- worst |residual| in src px (and game tiles) ----")
    print(f"  west: OLD={worst_old_w:6.1f} ({worst_old_w/shared_slope_src:5.1f} t)"
          f" → NEW={worst_new_w:6.1f} ({worst_new_w/shared_slope_src:5.1f} t)")
    print(f"  east: OLD={worst_old_e:6.1f} ({worst_old_e/shared_slope_src:5.1f} t)"
          f" → NEW={worst_new_e:6.1f} ({worst_new_e/shared_slope_src:5.1f} t)")

    # Stitch placement sanity check.
    STITCH_X = 2000
    px_west_at_stitch = shared_slope_src * (STITCH_X - snapped_xbase_w)
    px_east_at_stitch = shared_slope_src * (STITCH_X - GX_MIN_EAST)
    discontinuity = px_east_at_stitch - px_west_at_stitch
    print()
    print(f"---- STITCH_X = {STITCH_X} ----")
    print(f"  west segment maps STITCH_X to src px x = {px_west_at_stitch:.1f}")
    print(f"  east segment maps STITCH_X to src px x = {px_east_at_stitch:.1f}")
    print(f"  pixel discontinuity at stitch:           {discontinuity:.1f} src px")
    print(f"  inter-continental ocean (probe):         "
          f"src x ∈ [{probe['west_continent_east_edge_src']}, "
          f"{probe['east_continent_west_edge_src']}]")
    print(f"  → both segments hit pixels inside the empty ocean: "
          f"{probe['west_continent_east_edge_src']} < {px_west_at_stitch:.0f},"
          f" {px_east_at_stitch:.0f} < {probe['east_continent_west_edge_src']}")

    # Output the constants for the calibration module.
    print()
    print("---- recommended calibration constants ----")
    print(f"  GAME_X_MIN_EAST  = {GX_MIN_EAST}    // unchanged")
    print(f"  GAME_X_MIN_WEST  = {snapped_xbase_w}    // NEW: shifts west pins "
          f"{snapped_xbase_w - GX_MIN_EAST} game tiles west")
    print(f"  GAME_X_MAX       = {GX_MAX}   // unchanged")
    print(f"  STITCH_X         = {STITCH_X}   // game x where segments switch")

    # -------------------------------------------------------------------
    # Y-axis piecewise fit.
    # -------------------------------------------------------------------
    # East Y: this is the historical label-center comparison, not the
    # shipped feature-center fit. Five of eight labels are within 10 src px
    # of the old fit. Yanille is +52.4 and Prifddinas +137.1 src px south
    # of its prediction. Excluding Prifddinas alone leaves seven landmarks;
    # their free fit has a worst residual of 28.4 src px. For feature truths,
    # use fit-east-y-calibration.py.
    #
    # West Y: systematically steeper px-per-tile slope than east, making
    # both gy extremes drift inward of their labels. Free fit gives
    # slope ≈ -2.923 src-px/tile vs east's -2.827 (3.4% steeper). See the
    # header comment of src/lib/calibration.ts for the full rationale.
    print()
    print("---- Y-axis residuals (current single-line fit) ----")
    cur_y = lambda gy: 6528.0 - 2.8272 * (gy - GY_MIN)
    for label, gx, gy, tx, ty, side in LANDMARK_TRUTH:
        pred = cur_y(gy)
        print(f"  {label:24s} {side:4s} gy={gy:>5d} pred={pred:>7.1f} truth={ty:>6d}"
              f" err={ty - pred:>+7.1f}")

    east_y = [(r[2], r[4]) for r in LANDMARK_TRUTH if r[5] == "east"]
    west_y = [(r[2], r[4]) for r in LANDMARK_TRUTH if r[5] == "west"]
    # Prifddinas's ty=2625 at gy=3390 is an outlier (+137.1 src px); drop
    # it from the east Y fit since it represents a data-vs-render offset
    # rather than a calibration error.
    east_y_clean = [p for p in east_y if not (p[0] == 3390)]

    def fit_yxy(pairs):
        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        n = len(pairs)
        sx = sum(xs); sy = sum(ys)
        sxx = sum(x * x for x in xs)
        sxy = sum(x * y for x, y in zip(xs, ys))
        m = (n * sxy - sx * sy) / (n * sxx - sx * sx)
        b = (sy - m * sx) / n
        worst = max(abs(y - (m * x + b)) for x, y in pairs)
        return m, b, worst

    wm, wb, ww_y = fit_yxy(west_y)
    em, eb, ew_y = fit_yxy(east_y_clean)

    SRC_H = 6528
    # (1 - (y - YB)/YS) * SRC_H ⇒ slope = -SRC_H/YS, intercept = SRC_H + SRC_H*YB/YS
    ys_w = -SRC_H / wm
    yb_w = (wb - SRC_H) * ys_w / SRC_H
    print()
    print(f"---- west Y free fit (n={len(west_y)}) ----")
    print(f"  slope (src px/tile):  {wm:.4f}")
    print(f"  intercept (src px):   {wb:.2f}")
    print(f"  GAME_Y_BASE_WEST ≈ {yb_w:.2f}  (snapped: {round(yb_w)})")
    print(f"  GAME_Y_SPAN_WEST ≈ {ys_w:.2f}  (snapped: {round(ys_w)})")
    print(f"  worst residual:       {ww_y:.1f} src px ({ww_y / -wm:.1f} game tiles)")
    print()
    print(f"---- east Y free fit (n={len(east_y_clean)}, Prifddinas dropped) ----")
    print(f"  slope (src px/tile):  {em:.4f}")
    print(f"  intercept (src px):   {eb:.2f}")
    print(f"  worst residual:       {ew_y:.1f} src px ({ew_y / -em:.1f} game tiles)")
    print()
    print(f"  GAME_Y_BASE_WEST  = {round(yb_w)}    // NEW: west raster's Y origin")
    print(f"  GAME_Y_SPAN_WEST  = {round(ys_w)}   // NEW: west raster's Y span")
    print(f"  GAME_Y_BASE_EAST  = {GY_MIN}    // unchanged (matches MAP_IMAGE.gameYMin)")
    print(f"  GAME_Y_SPAN_EAST  = {GY_MAX - GY_MIN}   // unchanged (matches MAP_IMAGE.gameYMax - gameYMin)")

    if validate:
        print("\n---- writing validation crops ----")
        write_validation_crops(snapped_xbase_w, STITCH_X)


def write_validation_crops(xbase_w: int, stitch_x: int) -> None:
    """Render landmark crops with OLD red crosshair and NEW green crosshair
    for every landmark. Use to re-validate the fit visually after edits.
    """
    src = Image.open(SRC_PNG).convert("RGB")
    W, H = src.size
    out_dir = Path("/tmp/cal_debug/refit")
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except OSError:
        font = ImageFont.load_default()

    shared_slope_src = NATIVE_W / (GX_MAX - GX_MIN_EAST) * (9216 / NATIVE_W)
    py_native_per_tile = NATIVE_H / (GY_MAX - GY_MIN)
    py_src_per_tile = py_native_per_tile * (H / NATIVE_H)

    def gtsp_old(gx, gy):
        nx = (gx - GX_MIN_EAST) / (GX_MAX - GX_MIN_EAST) * NATIVE_W
        ny = (1 - (gy - GY_MIN) / (GY_MAX - GY_MIN)) * NATIVE_H
        return nx * (W / NATIVE_W), ny * (H / NATIVE_H)

    def gtsp_new(gx, gy):
        x_origin = xbase_w if gx < stitch_x else GX_MIN_EAST
        nx = (gx - x_origin) / (GX_MAX - GX_MIN_EAST) * NATIVE_W
        ny = (1 - (gy - GY_MIN) / (GY_MAX - GY_MIN)) * NATIVE_H
        return nx * (W / NATIVE_W), ny * (H / NATIVE_H)

    CW, CH = 800, 600
    for label, gx, gy, tx, ty, side in LANDMARK_TRUTH:
        ox, oy = gtsp_old(gx, gy)
        nx, ny = gtsp_new(gx, gy)
        cx0 = int(max(0, min(W - CW, round((tx + nx) / 2) - CW // 2)))
        cy0 = int(max(0, min(H - CH, round((ty + ny) / 2) - CH // 2)))
        crop = src.crop((cx0, cy0, cx0 + CW, cy0 + CH)).copy()
        d = ImageDraw.Draw(crop)
        # OLD prediction (red)
        opx, opy = ox - cx0, oy - cy0
        d.line((opx - 30, opy, opx + 30, opy), fill="red", width=3)
        d.line((opx, opy - 30, opx, opy + 30), fill="red", width=3)
        d.text((opx + 8, opy - 18), "OLD", fill="red", font=font)
        # NEW prediction (lime)
        npx, npy = nx - cx0, ny - cy0
        d.line((npx - 30, npy, npx + 30, npy), fill=(0, 255, 0), width=3)
        d.line((npx, npy - 30, npx, npy + 30), fill=(0, 255, 0), width=3)
        d.text((npx + 8, npy - 18), "NEW", fill=(0, 255, 0), font=font)
        # Truth (cyan diamond)
        tpx, tpy = tx - cx0, ty - cy0
        d.line((tpx - 16, tpy, tpx, tpy - 16), fill="cyan", width=3)
        d.line((tpx, tpy - 16, tpx + 16, tpy), fill="cyan", width=3)
        d.line((tpx + 16, tpy, tpx, tpy + 16), fill="cyan", width=3)
        d.line((tpx, tpy + 16, tpx - 16, tpy), fill="cyan", width=3)
        d.text((tpx + 18, tpy), f"truth ({tx},{ty})", fill="cyan", font=font)
        d.text((6, CH - 24), f"{label} ({side})  game=({gx},{gy})", fill="white",
               font=font)
        crop.save(out_dir / f"{label.replace(' ', '_')}.jpg", quality=88)
    print(f"  saved {len(LANDMARK_TRUTH)} crops to {out_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true",
                        help="also write before/after overlay crops to /tmp/cal_debug/refit")
    args = parser.parse_args()
    main(validate=args.validate)
