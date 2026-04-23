#!/usr/bin/env python3
"""Pre-distort the OSRS world map PNG to match the calibrated game-tile
aspect ratio, then emit a compressed WebP.

Why pre-distort?
    The source PNG is 9216 x 6528 (ratio ~1.411) but the calibrated game
    bounds span 3122 x 2309 tiles (ratio ~1.352). Leaflet stretches the
    image to fill the bounds, so the browser does a ~4% vertical squish
    at runtime. Lighthouse flags that as a bad aspect ratio, and it also
    wastes CPU. By resizing the source to already match the target ratio,
    we hand Leaflet a pre-corrected image and the browser does a pure
    1:1 (or uniform scale) render.

Output is also downscaled and re-encoded as WebP, dropping the asset
from ~8.8 MB to roughly 300-500 KB.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC = Path("/tmp/osrs_worldmap.orig.png")
DST_WEBP = Path("public/map/osrs_worldmap.webp")

# Game-tile span baked into src/lib/calibration.ts. Keep in sync.
GAME_X_SPAN = 4041 - 919
GAME_Y_SPAN = 4270 - 1961
TARGET_RATIO = GAME_X_SPAN / GAME_Y_SPAN

# Match the source PNG width so we don't lose detail at the highest
# Leaflet zoom (z=3 -> ~25k css px wide). WebP compresses graphics
# vastly better than PNG, so the file size still drops 5-6x even at
# full resolution.
TARGET_WIDTH = 9216


def main() -> None:
    img = Image.open(SRC)
    print(f"source: {img.size}  ratio={img.width / img.height:.4f}")

    target_w = TARGET_WIDTH
    target_h = round(target_w / TARGET_RATIO)
    print(f"target: {target_w} x {target_h}  ratio={target_w / target_h:.4f}")

    resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)

    DST_WEBP.parent.mkdir(parents=True, exist_ok=True)
    resized.save(DST_WEBP, format="WEBP", quality=82, method=6)
    webp_kb = DST_WEBP.stat().st_size / 1024
    print(f"wrote {DST_WEBP}  {webp_kb:.0f} KB")


if __name__ == "__main__":
    main()
