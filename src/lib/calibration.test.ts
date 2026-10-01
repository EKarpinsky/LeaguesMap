import { describe, expect, it } from "vitest";
import { gameToImagePixel, imagePixelToGame, MAP_IMAGE } from "./calibration";

describe("map calibration", () => {
  // Hand-measured source pixels from scripts/verify-calibration.ts.
  // The empirical fit is approximate; 25 native pixels covers these landmarks.
  it.each([
    ["Civitas illa Fortis", 1725, 3128, 2240, 3270],
    ["Falador", 3000, 3360, 6143, 2580],
  ] as const)("places %s within 25 pixels of its reference", (_name, x, y, sx, sy) => {
    const [px, py] = gameToImagePixel(x, y);
    expect(Math.abs(px - sx * MAP_IMAGE.widthPx / 9216)).toBeLessThan(25);
    expect(Math.abs(py - sy * MAP_IMAGE.heightPx / 6528)).toBeLessThan(25);
  });

  it.each([[1725, 3128], [1999, 3000], [2000, 3000], [3000, 3360]])(
    "round-trips (%i, %i), including both sides of the stitch",
    (x, y) => {
      const back = imagePixelToGame(...gameToImagePixel(x, y));
      expect(Math.abs(back.x - x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - y)).toBeLessThanOrEqual(1);
    },
  );
});
