#!/usr/bin/env python3
"""Dump the top 6 interior-color buckets per region badge for inspection."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from PIL import Image

REGIONS = [
    "varlamore", "karamja", "asgarnia", "desert", "fremennik",
    "kandarin", "kourend", "morytania", "tirannwn", "wilderness",
    "misthalin",
]
BADGE_DIR = Path(__file__).parent.parent / "public" / "icons" / "region"


def inspect(path: Path) -> None:
    img = Image.open(path).convert("RGBA")
    buckets: Counter[tuple[int, int, int]] = Counter()
    means: dict[tuple[int, int, int], list[tuple[int, int, int]]] = {}
    for r, g, b, a in img.getdata():
        if a < 200:
            continue
        key = (r // 8, g // 8, b // 8)
        buckets[key] += 1
        means.setdefault(key, []).append((r, g, b))
    print(f"\n{path.stem}:")
    for key, count in buckets.most_common(6):
        px = means[key]
        mr = sum(p[0] for p in px) // len(px)
        mg = sum(p[1] for p in px) // len(px)
        mb = sum(p[2] for p in px) // len(px)
        brightness = (mr + mg + mb) / 3
        role = ""
        if brightness < 35:
            role = "(border/shadow)"
        elif brightness > 235 and abs(mr - mg) < 12 and abs(mg - mb) < 12:
            role = "(highlight)"
        print(f"  #{mr:02x}{mg:02x}{mb:02x}  count={count:3d}  {role}")


if __name__ == "__main__":
    for r in REGIONS:
        inspect(BADGE_DIR / f"{r}.png")
