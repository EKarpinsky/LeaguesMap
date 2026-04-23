import { LOCATIONS } from "../src/data/locations";

const bounds = { xMin: 1024, xMax: 3904, yMin: 2496, yMax: 4544 };
const out = LOCATIONS.filter(
  (l) =>
    l.x < bounds.xMin ||
    l.x > bounds.xMax ||
    l.y < bounds.yMin ||
    l.y > bounds.yMax,
);
console.log(`Total locations: ${LOCATIONS.length}`);
console.log(`Out-of-bounds: ${out.length}`);
for (const l of out) {
  console.log(`  ${l.id}  ${l.name}  (x=${l.x}, y=${l.y}, region=${l.region})`);
}
