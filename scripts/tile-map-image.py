#!/usr/bin/env python3
"""Generate a Leaflet-compatible tile pyramid for the OSRS world map.

Why tiles?
    The world map is one giant raster (~9k × 7k pixels). Shipping it as a
    single image overlay forced every visitor to download ~6 MB before
    the LCP element could paint — Lighthouse mobile LCP was 34.9 s. With
    a tile pyramid, Leaflet only fetches the ~9–12 visible 256×256 tiles
    at the current zoom (each ~5–25 KB WebP), and lazy-fetches more as
    the user pans / zooms. Initial paint drops from 6 MB → ~150–300 KB.

Pyramid layout
    For each zoom level z in 0..MAX_NATIVE_ZOOM, the image is downsampled
    to (TILE × 2^z) wide and sliced into TILE × TILE chunks addressed
    `tiles/{z}/{x}/{y}.webp`. Edge tiles outside the image are simply
    not written (Leaflet handles the 404 gracefully when given `bounds`).

    z=MAX_NATIVE_ZOOM is sized at — and source-fits — the calibrated game
    aspect ratio so the deepest level is 1:1 with native pixels. We don't
    generate a zoom level past native: Lighthouse penalises upscaled
    rasters and the user explicitly called out blurriness when zooming
    past native in the previous iteration.

Source
    Reads `/tmp/osrs_worldmap.orig.png` (same convention as
    optimize-map-image.py). Drop the latest OSRS Wiki world map PNG there
    before running. Output is committed to the repo so Vercel can serve
    the tiles directly from the edge with no build-time generation.

Usage
    python3 scripts/tile-map-image.py
"""

from __future__ import annotations

import math
import shutil
from pathlib import Path

from PIL import Image

SRC = Path("/tmp/osrs_worldmap.orig.png")
DST = Path("public/map/tiles")

TILE = 256

# 2^MAX_NATIVE_ZOOM * TILE ≈ source width. With source at 9216 px wide:
#   z=5 → 8192 px (slight downsample, ~88% of native)
#   z=6 → 16384 px (1.78× upsample — visible smear, rejected)
# 5 is the right ceiling. Users reach pinpoint detail without seeing
# upscaled bilinear blur, matching the previous maxZoom cap behaviour.
MAX_NATIVE_ZOOM = 5

# Calibration aspect from src/lib/calibration.ts. Keep these in sync —
# the tile pyramid bakes this in, so changing the bounds requires a
# tile regen.
GAME_X_SPAN = 4041 - 919
GAME_Y_SPAN = 4270 - 1961
TARGET_RATIO = GAME_X_SPAN / GAME_Y_SPAN

NATIVE_W = TILE * (1 << MAX_NATIVE_ZOOM)  # 8192


def main() -> None:
    if not SRC.exists():
        raise SystemExit(
            f"missing source PNG at {SRC}. Drop the OSRS Wiki world map there first."
        )

    src = Image.open(SRC).convert("RGB")
    print(f"source: {src.size}  ratio={src.width / src.height:.4f}")

    # Pre-distort to the calibrated game aspect ratio so the tiled image
    # is a uniform scale of the game world (no per-axis squish at runtime).
    target_w = NATIVE_W
    target_h = round(target_w / TARGET_RATIO)
    print(
        f"native (z={MAX_NATIVE_ZOOM}): {target_w} × {target_h}  "
        f"ratio={target_w / target_h:.4f}"
    )
    base = src.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Wipe any previous pyramid so abandoned tiles from earlier configs
    # don't linger and bloat the deploy.
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)

    total_tiles = 0
    total_bytes = 0
    for z in range(MAX_NATIVE_ZOOM + 1):
        scale = 2 ** (z - MAX_NATIVE_ZOOM)
        zw = max(1, round(target_w * scale))
        zh = max(1, round(target_h * scale))
        if z == MAX_NATIVE_ZOOM:
            level = base
        else:
            level = base.resize((zw, zh), Image.Resampling.LANCZOS)

        cols = math.ceil(zw / TILE)
        rows = math.ceil(zh / TILE)
        zdir = DST / str(z)
        z_bytes = 0

        for x in range(cols):
            (zdir / str(x)).mkdir(parents=True, exist_ok=True)
            for y in range(rows):
                left = x * TILE
                top = y * TILE
                right = min(left + TILE, zw)
                bottom = min(top + TILE, zh)
                tile = level.crop((left, top, right, bottom))
                if tile.size != (TILE, TILE):
                    # Pad the partial right/bottom edge tiles to a full
                    # TILE×TILE square with black. Leaflet would otherwise
                    # render a gray gap at the seam.
                    canvas = Image.new("RGB", (TILE, TILE), (0, 0, 0))
                    canvas.paste(tile, (0, 0))
                    tile = canvas
                out = zdir / str(x) / f"{y}.webp"
                tile.save(out, format="WEBP", quality=80, method=6)
                z_bytes += out.stat().st_size
                total_tiles += 1
        total_bytes += z_bytes
        print(
            f"  z={z}: {cols}×{rows} = {cols * rows:>4} tiles, "
            f"{z_bytes / 1024:>7.0f} KB"
        )

    print(f"total: {total_tiles} tiles, {total_bytes / 1024 / 1024:.1f} MB on disk")


if __name__ == "__main__":
    main()
