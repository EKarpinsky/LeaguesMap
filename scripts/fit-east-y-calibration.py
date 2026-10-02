"""Y-axis refit for the EASTERN continent using feature-center truths.

Why a second fit script? ``scripts/fit-calibration.py`` calibrated the east
against wiki LABEL-TEXT centers because that's what's easiest to measure
visually. Wiki labels can be offset from the actual teleport/feature
pixel, so they are a different reference from the features targeted by
pins. The runtime pipeline feeds pin positions from
``wiki-coords.json``'s teleport/NPC game coords, so the pin lives at the
FEATURE. Under the label-center fit,
extreme-north pins sit south of their buildings, extreme-south
pins sit north of theirs.

This script refits east-Y against 20 feature-center truths measured off
``/tmp/osrs_worldmap.orig.png`` (castle centers, bank sprites, town cluster
centroids, teleport landing spots). Free least-squares over (gy, src_py)
gives slope/intercept, then converts to the (base, span) form used in
``src/lib/calibration.ts``. Worst residual drops from 123 → 82 src-px; RMS
from 54 → 34 src-px. Mid-latitude movement includes Edgeville at 24.4
src-px and Camelot at 22.7 src-px; their new residuals are 22.0 and 13.6
src-px. The largest correction is at Weiss (80.0 src-px).

Usage::

    python3 scripts/fit-east-y-calibration.py
    # or, with validation crops to eyeball the before/after:
    python3 scripts/fit-east-y-calibration.py --validate

Writes before/after overlay crops (red = old, green = new, cyan diamond =
measured truth) to ``/tmp/cal_debug/yfit/``.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path("/tmp/osrs_worldmap.orig.png")
OUT = Path("/tmp/cal_debug/yfit")

# Source-PNG dimensions (the canonical wiki render the calibration is fit
# against; the tiled native output at src/lib/calibration.ts:MAP_IMAGE is
# a downscaled copy of this).
SRC_W = 9216
SRC_H = 6528

# OLD calibration constants — here only so the script can render red "old"
# crosshairs on the validation crops. Keep in sync with calibration.ts
# ONLY if you want the overlay to match what SHIPPED before the refit.
GX_MIN_EAST = 919
GX_MAX = 4041
GY_MIN_OLD = 1961
GY_MAX_OLD = 4270

# East-Y truths: (label, gx, gy, truth_src_py). Each truth_src_py was read
# off SRC at the CANONICAL FEATURE pixel — castle center, bank sprite,
# town cluster centroid, teleport landing — NOT the label text. Truth
# positions are approximate visual measurements.
# Every landmark sits east of STITCH_X=2000.
EAST_TRUTHS: list[tuple[str, int, int, int]] = [
    # Far north
    ("Weiss salt mine",         2876, 3925,  870),
    ("Moonclan bank",           2112, 3915,  970),
    ("Jatizso throne",          2399, 3797, 1235),
    ("Neitiznot mayor",         2336, 3803, 1235),
    ("Rellekka longhall",       2659, 3679, 1670),
    ("Piscatoris fairy ring",   2415, 3526, 2010),
    # Mid latitudes
    ("Edgeville bank",          3094, 3491, 2200),
    ("Camelot teleport",        2758, 3478, 2230),
    ("Falador east bank",       3012, 3355, 2580),
    ("Varrock center",          3210, 3424, 2395),
    ("Port Phasmatys ectofntl", 3665, 3480, 2217),
    ("Catherby bank",           2808, 3441, 2320),
    ("Canifis center",          3492, 3476, 2255),
    # Mid-south
    ("Ardougne market",         2662, 3305, 2720),
    ("Al Kharid palace",        3293, 3180, 3075),
    ("Yanille magic guild",     2591, 3089, 3340),
    ("Port Khazard dock",       2660, 3145, 3178),
    # Far south
    ("Pollnivneach village",    3357, 2980, 3770),
    ("Shilo Mosol Rei",         2852, 2954, 3725),
    ("Nardah village",          3427, 2890, 3955),
]


def fit_line(pairs: list[tuple[int, int]]) -> tuple[float, float, float]:
    """Least-squares (slope, intercept, worst |residual|)."""
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    n = len(pairs)
    sx = sum(xs)
    sy = sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    m = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    b = (sy - m * sx) / n
    worst = max(abs(y - (m * x + b)) for x, y in pairs)
    return m, b, worst


def main(validate: bool) -> None:
    if validate and not SRC.exists():
        sys.exit(
            f"Missing source PNG: {SRC}\n"
            "Download https://oldschool.runescape.wiki/images/Old_School_RuneScape_world_map.png\n"
            f"and save it as {SRC} (expected 9216x6528)."
        )

    east_pairs = [(r[2], r[3]) for r in EAST_TRUTHS]
    m, b, worst = fit_line(east_pairs)
    print(f"East-Y free fit (n={len(east_pairs)}):")
    print(f"  slope     = {m:.4f} src-px/tile  (old: -2.8272)")
    print(f"  intercept = {b:.2f} src-px         (old: {SRC_H + 2.8272 * GY_MIN_OLD:.1f})")
    y_span = -SRC_H / m
    y_base = (b - SRC_H) * y_span / SRC_H
    yb_new = round(y_base)
    ys_new = round(y_span)
    print(f"  GAME_Y_BASE_EAST = {yb_new}   (∆ from old: {yb_new - GY_MIN_OLD:+d})")
    print(f"  GAME_Y_SPAN_EAST = {ys_new}   (∆ from old: {ys_new - (GY_MAX_OLD - GY_MIN_OLD):+d})")
    print(f"  worst |residual| = {worst:.1f} src-px ≈ {worst / -m:.1f} game tiles")

    def cur_py(gy: int) -> float:
        return SRC_H - SRC_H * (gy - GY_MIN_OLD) / (GY_MAX_OLD - GY_MIN_OLD)

    def new_py(gy: int) -> float:
        return SRC_H - SRC_H * (gy - yb_new) / ys_new

    print()
    print(f"{'Landmark':28s} {'gy':>5s} {'truth':>6s} {'old':>6s} {'new':>6s} {'err_old':>8s} {'err_new':>8s}")
    errs_old = []
    errs_new = []
    for label, _gx, gy, ty in EAST_TRUTHS:
        pc = cur_py(gy)
        pn = new_py(gy)
        eo = ty - pc
        en = ty - pn
        errs_old.append(eo)
        errs_new.append(en)
        print(f"{label:28s} {gy:>5d} {ty:>6d} {pc:>6.1f} {pn:>6.1f} {eo:>+8.1f} {en:>+8.1f}")

    def rms(a: list[float]) -> float:
        return (sum(x * x for x in a) / len(a)) ** 0.5

    print()
    print("Aggregate residuals (src-px):")
    print(f"  old:  worst |err| = {max(abs(e) for e in errs_old):6.1f},  RMS = {rms(errs_old):6.1f}")
    print(f"  new:  worst |err| = {max(abs(e) for e in errs_new):6.1f},  RMS = {rms(errs_new):6.1f}")

    if not validate:
        return

    # Render before/after crops: OLD (red) vs NEW (green) vs truth (cyan diamond)
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
    except OSError:
        font = ImageFont.load_default()
    src = Image.open(SRC).convert("RGB")
    CW, CH = 900, 700
    for label, gx, gy, ty in EAST_TRUTHS:
        px = (gx - GX_MIN_EAST) / (GX_MAX - GX_MIN_EAST) * SRC_W
        cpy = cur_py(gy)
        npy = new_py(gy)
        cy_center = (cpy + npy + ty) / 3
        cx0 = int(max(0, min(SRC_W - CW, round(px) - CW // 2)))
        cy0 = int(max(0, min(SRC_H - CH, round(cy_center) - CH // 2)))
        crop = src.crop((cx0, cy0, cx0 + CW, cy0 + CH)).copy()
        d = ImageDraw.Draw(crop)
        for y in range(-(cy0 % 50), CH, 50):
            col = (255, 140, 0) if (y + cy0) % 100 == 0 else (255, 230, 80)
            d.line((0, y, CW, y), fill=col, width=1 if (y + cy0) % 100 else 2)
        rx = px - cx0
        oy = cpy - cy0
        d.line((rx - 30, oy, rx + 30, oy), fill=(255, 0, 0), width=3)
        d.line((rx, oy - 30, rx, oy + 30), fill=(255, 0, 0), width=3)
        d.text((rx + 6, oy - 20), f"OLD ({cpy:.0f})", fill=(255, 0, 0), font=font)
        ny = npy - cy0
        d.line((rx - 30, ny, rx + 30, ny), fill=(0, 255, 0), width=3)
        d.line((rx, ny - 30, rx, ny + 30), fill=(0, 255, 0), width=3)
        d.text((rx + 6, ny + 8), f"NEW ({npy:.0f})", fill=(0, 255, 0), font=font)
        tx_ = rx
        tyc = ty - cy0
        d.line((tx_ - 18, tyc, tx_, tyc - 18), fill=(0, 220, 255), width=3)
        d.line((tx_, tyc - 18, tx_ + 18, tyc), fill=(0, 220, 255), width=3)
        d.line((tx_ + 18, tyc, tx_, tyc + 18), fill=(0, 220, 255), width=3)
        d.line((tx_, tyc + 18, tx_ - 18, tyc), fill=(0, 220, 255), width=3)
        d.text((tx_ + 20, tyc), f"truth ({ty})", fill=(0, 220, 255), font=font)
        d.rectangle((0, 0, CW, 30), fill=(0, 0, 0))
        d.text((6, 6), f"{label}  gx={gx} gy={gy}", fill=(255, 255, 255), font=font)
        safe = label.replace(" ", "_").replace("/", "_")
        crop.save(OUT / f"y{gy:04d}_{safe}.png")
    print(f"\nWrote {len(EAST_TRUTHS)} before/after crops to {OUT}/")


if __name__ == "__main__":
    main(validate="--validate" in sys.argv[1:])
