// Renders media/icon.png (128x128) and media/activity-icon.svg from one shape
// list, so the Marketplace icon and the activity-bar icon match. No image
// library: shapes are rings, dots, segments, and arcs on a 24-unit grid.
//
//   node scripts/make-icon.mjs                 # writes media/ with the default variant
//   node scripts/make-icon.mjs <variant> <dir> # preview a variant into <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";

const SIZE = 128;
const GRID = 24;
const SS = 3;

// Shapes: { ring, cx, cy, r } { dot, cx, cy, r } { seg, x1, y1, x2, y2 } { arc, cx, cy, r, a0, a1 }
// Angles in degrees, clockwise on screen (y down), a0 < a1.
const ring = (cx, cy, r) => ({ kind: "ring", cx, cy, r });
const dot = (cx, cy, r) => ({ kind: "dot", cx, cy, r });
const seg = (x1, y1, x2, y2) => ({ kind: "seg", x1, y1, x2, y2 });
const arc = (cx, cy, r, a0, a1) => ({ kind: "arc", cx, cy, r, a0, a1 });

// Lanes: three queued items on the left funnel into one line that ends in the merged commit.
const lanes = [
  ring(5, 6, 1.9),
  ring(5, 12, 1.9),
  ring(5, 18, 1.9),
  seg(7.4, 6, 9.5, 6),
  arc(9.5, 9, 3, -90, 0),
  seg(12.5, 9, 12.5, 12),
  seg(7.4, 18, 9.5, 18),
  arc(9.5, 15, 3, 0, 90),
  seg(12.5, 15, 12.5, 12),
  seg(7.4, 12, 16, 12),
  dot(18.6, 12, 2.6),
];

// Merge with a queue: the classic git-merge glyph, with the incoming branch drawn as queued dots.
const mergeQueue = [
  ring(7, 4.5, 2.1),
  seg(7, 7.1, 7, 17.4),
  ring(7, 19.5, 2.1),
  arc(10, 7.5, 3, 180, 270),
  seg(10, 4.5, 11, 4.5),
  dot(13.5, 4.5, 1.4),
  dot(17, 4.5, 1.4),
  seg(18.4, 4.5, 19, 4.5),
  arc(19, 7.5, 3, -90, 0),
  seg(22, 7.5, 22, 8),
  ring(19, 11.5, 2.1),
  seg(19, 13.6, 19, 14),
  arc(16, 14, 3, 0, 90),
  seg(16, 17, 10, 17),
].filter(Boolean);

// Stack: a column of three queued items that converge on a check-marked merge commit.
const stack = [
  seg(4, 6, 10, 6),
  seg(4, 12, 10, 12),
  seg(4, 18, 10, 18),
  dot(13, 6, 1.5),
  dot(13, 12, 1.5),
  dot(13, 18, 1.5),
  arc(13, 9, 3, -90, 0),
  arc(13, 15, 3, 0, 90),
  seg(16, 9, 16, 15),
  seg(16, 12, 17, 12),
  ring(19.5, 12, 2.5),
];

const VARIANTS = {
  1: { shapes: lanes, bg: [31, 111, 235], fg: [255, 255, 255], stroke: 1.8 },
  2: { shapes: lanes, bg: [36, 41, 47], fg: [63, 185, 80], stroke: 1.8 },
  3: { shapes: mergeQueue, bg: [36, 41, 47], fg: [255, 255, 255], stroke: 1.7 },
  4: { shapes: stack, bg: [130, 80, 223], fg: [255, 255, 255], stroke: 2.0 },
};
const DEFAULT_VARIANT = 1;

const [, , variantArg, outDirArg] = process.argv;
const variant = VARIANTS[variantArg ?? DEFAULT_VARIANT];
if (!variant) throw new Error(`unknown variant ${variantArg}`);
const outDir = outDirArg ?? new URL("../media/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

// --- raster ---------------------------------------------------------------
const rad = (deg) => (deg * Math.PI) / 180;
function distance(px, py, s) {
  switch (s.kind) {
    case "ring":
      return Math.abs(Math.hypot(px - s.cx, py - s.cy) - s.r);
    case "dot":
      return Math.max(0, Math.hypot(px - s.cx, py - s.cy) - s.r);
    case "seg": {
      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const len = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len));
      return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
    }
    case "arc": {
      const dx = px - s.cx;
      const dy = py - s.cy;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (a < s.a0) a += 360;
      if (a >= s.a0 && a <= s.a1) return Math.abs(Math.hypot(dx, dy) - s.r);
      const ends = [s.a0, s.a1].map((deg) => Math.hypot(px - (s.cx + s.r * Math.cos(rad(deg))), py - (s.cy + s.r * Math.sin(rad(deg)))));
      return Math.min(...ends);
    }
  }
}
function covered(px, py) {
  const half = (variant.stroke / 2) * (SIZE / GRID);
  for (const s of variant.shapes) {
    const d = distance(px / (SIZE / GRID), py / (SIZE / GRID), s) * (SIZE / GRID);
    if (s.kind === "dot" ? d <= 0.01 : d <= half) return 1;
  }
  return 0;
}
const CORNER = 26;
function inSquare(px, py) {
  const x = Math.max(CORNER - px, px - (SIZE - CORNER), 0);
  const y = Math.max(CORNER - py, py - (SIZE - CORNER), 0);
  return Math.hypot(x, y) <= CORNER ? 1 : 0;
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let bg = 0;
    let fg = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        bg += inSquare(px, py);
        fg += covered(px, py);
      }
    }
    bg /= SS * SS;
    fg /= SS * SS;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(variant.bg[c] * (1 - fg) + variant.fg[c] * fg);
    raw[o + 3] = Math.round(255 * bg);
  }
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(join(outDir, "icon.png"), png);

// --- svg ------------------------------------------------------------------
const f = (n) => Number(n.toFixed(2));
const svgShapes = variant.shapes.map((s) => {
  switch (s.kind) {
    case "ring":
      return `<circle cx="${f(s.cx)}" cy="${f(s.cy)}" r="${f(s.r)}"/>`;
    case "dot":
      return `<circle cx="${f(s.cx)}" cy="${f(s.cy)}" r="${f(s.r)}" fill="#424242" stroke="none"/>`;
    case "seg":
      return `<path d="M${f(s.x1)} ${f(s.y1)}L${f(s.x2)} ${f(s.y2)}"/>`;
    case "arc": {
      const sx = s.cx + s.r * Math.cos(rad(s.a0));
      const sy = s.cy + s.r * Math.sin(rad(s.a0));
      const ex = s.cx + s.r * Math.cos(rad(s.a1));
      const ey = s.cy + s.r * Math.sin(rad(s.a1));
      const large = s.a1 - s.a0 > 180 ? 1 : 0;
      return `<path d="M${f(sx)} ${f(sy)}A${f(s.r)} ${f(s.r)} 0 ${large} 1 ${f(ex)} ${f(ey)}"/>`;
    }
  }
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#424242" stroke-width="${variant.stroke}" stroke-linecap="round" stroke-linejoin="round">
  ${svgShapes.join("\n  ")}
</svg>
`;
writeFileSync(join(outDir, "activity-icon.svg"), svg);
console.log(`wrote icon.png and activity-icon.svg to ${outDir}`);
