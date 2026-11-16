// =============================================================================
//  «Взмах крыла» — a naturalist study of a hawk's wing in mid-downstroke.
//
//  Standalone build (no p5.js). The wing is modelled in its own flat frame
//  (x along the span, y along the chord), every feather is a parametric vane
//  around a curved rachis, and the whole wing is rotated about the body axis
//  and projected through an oblique camera. Two ghost phases (top of the
//  upstroke, bottom of the downstroke) are drawn as construction lines, the
//  main phase is painted feather by feather: watercolor vane, overlap shadow,
//  barring, barbs, rachis, pale fringe.
// =============================================================================

import * as brush from "../../dist/brush.esm.js";

const W = 1400, H = 900;
const PAPER = "#f2ead9";
const SEED = 7;

brush.createCanvas(W, H, {
  parent: document.body,
  pixelDensity: Math.min(2, window.devicePixelRatio || 1),
});
brush.scaleBrushes(4.2);
brush.angleMode(brush.RADIANS);
brush.seed(SEED);
brush.noiseSeed(SEED);

// Custom graphite and gouache-like brushes (absolute pixel weights)
brush.add("lead", {
  type: "default", weight: 1.6, scatter: 0.15, sharpness: 0.55, grain: 0.7,
  opacity: 190, spacing: 0.35, pressure: [1.15, 0.85], rotate: "natural",
});
brush.add("hair", {
  type: "default", weight: 0.9, scatter: 0.05, sharpness: 0.85, grain: 0.35,
  opacity: 150, spacing: 0.3, pressure: [1, 0.6], rotate: "natural",
});
brush.add("gouache", {
  type: "default", weight: 2.2, scatter: 0.04, sharpness: 0.9, grain: 0.2,
  opacity: 170, spacing: 0.25, pressure: [0.6, 1.2, 0.5], rotate: "natural",
});

// ── Tiny deterministic RNG for geometry jitter ──────────────────────────────
let _s = SEED * 9301 + 49297;
const rnd = (a = 0, b = 1) => {
  _s = (_s * 16807) % 2147483647;
  return a + ((_s - 1) / 2147483646) * (b - a);
};
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ── Camera: wing rotates about the body axis, viewed obliquely from above ───
const SHOULDER = [470, 450];
const TILT = 0.55; // camera elevation (radians)

function project(p, pose) {
  const [x, y] = p;
  // spanwise flex: distal hand lags behind the stroke
  const flex = pose.flex * Math.pow(Math.max(0, x - 260) / 300, 2) * 60;
  const X = x * Math.cos(pose.theta);
  const Z = x * Math.sin(pose.theta) + flex;
  const Y = y + pose.sweep * x * x * 0.0004;
  return [
    SHOULDER[0] + X * pose.scale,
    SHOULDER[1] + (Y * Math.cos(TILT) - Z * Math.sin(TILT)) * pose.scale,
  ];
}

// ── Wing skeleton (local frame) ─────────────────────────────────────────────
const SK = {
  shoulder: [0, 0],
  elbow: [150, 18],
  wrist: [300, -22],
  hand: [395, -18],
};
const along = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

// ── Feather model ───────────────────────────────────────────────────────────
// base, angle, length, width, outer-vane share, curvature, emargination
function makeFeather(o) {
  return {
    base: o.base,
    ang: o.ang,
    len: o.len,
    wid: o.wid,
    outer: o.outer ?? 0.42,
    bend: o.bend ?? 0.06,
    notch: o.notch ?? 0, // 0 = none, else depth of the inner-vane emargination
    notchAt: o.notchAt ?? 0.58,
    tip: o.tip ?? 0.72, // where the rounded tip starts
    kind: o.kind,
    tone: o.tone,
    bars: o.bars ?? [],
    fringe: o.fringe,
    i: o.i ?? 0,
  };
}

function rachisPoint(f, t) {
  const dx = Math.cos(f.ang), dy = Math.sin(f.ang);
  const nx = dy, ny = -dx; // points to the outer vane
  const s = f.len * t;
  const b = f.bend * f.len * t * t;
  return [f.base[0] + dx * s - nx * b, f.base[1] + dy * s - ny * b, nx, ny];
}

function widthProfile(f, t) {
  const rise = Math.pow(smooth(0, 0.16, t), 0.6);
  const end = t > f.tip ? Math.sqrt(Math.max(0, 1 - Math.pow((t - f.tip) / (1 - f.tip), 2))) : 1;
  return f.wid * (0.22 + 0.78 * rise) * end * (t >= 1 ? 0 : 1);
}

function edges(f, t0 = 0, t1 = 1, n = 22) {
  const outer = [], inner = [];
  for (let k = 0; k <= n; k++) {
    const t = lerp(t0, t1, k / n);
    const [cx, cy, nx, ny] = rachisPoint(f, t);
    const w = widthProfile(f, t);
    let wo = w * f.outer;
    let wi = w * (1 - f.outer);
    if (f.notch) {
      // emarginated "fingers": both vanes step in past the notch
      const s = smooth(f.notchAt - 0.06, f.notchAt + 0.05, t);
      wi *= 1 - f.notch * s;
      wo *= 1 - f.notch * 0.55 * s;
    }
    outer.push([cx + nx * wo, cy + ny * wo]);
    inner.push([cx - nx * wi, cy - ny * wi]);
  }
  return { outer, inner };
}

function outline(f, t0 = 0, t1 = 1, n) {
  const { outer, inner } = edges(f, t0, t1, n);
  return outer.concat(inner.reverse());
}

// ── Build the feather tracts ────────────────────────────────────────────────
const C = {
  prim: "#2f241b",
  primLight: "#5a4636",
  sec: "#4a382a",
  secBar: "#2a1f17",
  gc: "#6a4a33",
  mc: "#7b5739",
  lc: "#5c4130",
  marg: "#46322a",
  fringe: "#d8c4a2",
  shaft: "#e4d7bd",
  ink: "#1c1611",
};

function buildWing() {
  const F = { prim: [], sec: [], tert: [], gc: [], pgc: [], mc: [], lc: [], marg: [], alula: [] };

  // Primaries: P10 (outermost) .. P1. Fanned from the hand.
  for (let i = 0; i < 10; i++) {
    const k = i / 9; // 0 = P1 (inner), 1 = P10 (outer)
    const base = along(SK.wrist, SK.hand, 0.15 + 0.85 * Math.pow(k, 0.8));
    const ang = lerp(1.18, -0.06, Math.pow(k, 0.92)) + rnd(-0.015, 0.015);
    const len = lerp(205, 330, Math.sin(Math.min(1, k * 1.12) * Math.PI * 0.5)) - (i === 9 ? 38 : 0);
    F.prim.push(
      makeFeather({
        kind: "prim", i: i + 1, base, ang, len,
        wid: lerp(44, 30, k),
        outer: lerp(0.4, 0.22, k),
        bend: lerp(0.03, 0.085, k),
        notch: i >= 5 ? lerp(0.3, 0.52, (i - 5) / 4) : 0,
        notchAt: lerp(0.62, 0.5, k),
        tip: lerp(0.7, 0.78, k),
        tone: C.prim,
        bars: [0.28, 0.42, 0.56],
        fringe: false,
      }),
    );
  }

  // Secondaries: S1 at the wrist .. S13 at the elbow, then tertials.
  const NS = 13;
  for (let i = 0; i < NS; i++) {
    const k = i / (NS - 1);
    const base = along(SK.wrist, SK.elbow, 0.03 + k * 0.97);
    F.sec.push(
      makeFeather({
        kind: "sec", i: i + 1, base,
        ang: lerp(1.36, 1.62, k) + rnd(-0.03, 0.03),
        len: lerp(178, 168, k) + rnd(-4, 4),
        wid: 40 + rnd(-2, 2),
        outer: 0.4,
        bend: -0.03,
        tip: 0.8,
        tone: C.sec,
        bars: [0.3, 0.5, 0.7],
        fringe: true,
      }),
    );
  }
  for (let i = 0; i < 4; i++) {
    const k = i / 3;
    F.tert.push(
      makeFeather({
        kind: "tert", i, base: along(SK.elbow, SK.shoulder, 0.08 + k * 0.6),
        ang: lerp(1.7, 1.95, k), len: lerp(150, 110, k), wid: 46,
        outer: 0.45, bend: -0.05, tip: 0.74, tone: "#5b4332",
        bars: [0.4, 0.68], fringe: true,
      }),
    );
  }

  // Greater coverts over the secondaries, primary coverts over the primaries.
  for (let i = 0; i < 15; i++) {
    const k = i / 14;
    const base = along(SK.wrist, SK.shoulder, 0.02 + k * 0.62);
    base[1] -= 6;
    F.gc.push(
      makeFeather({
        kind: "gc", i, base, ang: lerp(1.32, 1.7, k) + rnd(-0.04, 0.04),
        len: 82 + rnd(-5, 5), wid: 34, outer: 0.42, bend: -0.04, tip: 0.62,
        tone: C.gc, fringe: true,
      }),
    );
  }
  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const base = along(SK.wrist, SK.hand, 0.05 + k * 0.85);
    base[1] -= 4;
    F.pgc.push(
      makeFeather({
        kind: "pgc", i, base, ang: lerp(1.05, 0.12, k), len: lerp(96, 112, k),
        wid: 30, outer: 0.3, bend: 0.05, tip: 0.66, tone: "#3d2e22", fringe: false,
      }),
    );
  }
  // Median coverts — two staggered rows, pale-edged.
  for (let r = 0; r < 2; r++) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const k = (i + r * 0.5) / n;
      const base = along(SK.wrist, SK.shoulder, 0.0 + k * 0.7);
      base[1] -= 22 + r * 12;
      F.mc.push(
        makeFeather({
          kind: "mc", i, base, ang: lerp(1.2, 1.7, k) + rnd(-0.08, 0.08),
          len: 52 - r * 8 + rnd(-4, 4), wid: 26, outer: 0.45, bend: -0.02, tip: 0.55,
          tone: r ? "#6f4d33" : C.mc, fringe: true,
        }),
      );
    }
  }
  // Lesser coverts: small, many, scale-like
  for (let r = 0; r < 3; r++) {
    const n = 15 - r * 2;
    for (let i = 0; i < n; i++) {
      const k = (i + (r % 2) * 0.5) / n;
      const p = along(SK.hand, SK.shoulder, 0.18 + k * 0.78);
      p[1] -= 44 + r * 10 + Math.sin(k * Math.PI) * 6;
      F.lc.push(
        makeFeather({
          kind: "lc", i, base: p, ang: lerp(1.0, 1.65, k) + rnd(-0.1, 0.1),
          len: 40 - r * 5 + rnd(-3, 3), wid: 28 - r * 3, outer: 0.48, bend: 0, tip: 0.5,
          tone: C.lc, fringe: true,
        }),
      );
    }
  }
  // Marginal coverts along the leading edge
  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    const p = along(SK.hand, SK.shoulder, 0.05 + k * 0.95);
    p[1] -= 70 + Math.sin(k * Math.PI) * 4;
    F.marg.push(
      makeFeather({
        kind: "marg", i, base: p, ang: lerp(0.7, 1.4, k) + rnd(-0.1, 0.1),
        len: 30 + rnd(-3, 3), wid: 22, outer: 0.5, bend: 0, tip: 0.5, tone: C.marg,
      }),
    );
  }
  // Alula — the "bastard wing" at the wrist
  for (let i = 0; i < 3; i++) {
    F.alula.push(
      makeFeather({
        kind: "alula", i, base: [SK.wrist[0] - 4, SK.wrist[1] - 70 + i * 3],
        ang: -0.32 + i * 0.12, len: 92 - i * 18, wid: 20, outer: 0.25, bend: 0.06,
        tip: 0.7, tone: "#33261c",
      }),
    );
  }
  return F;
}

const WING = buildWing();

// Draw order from the tip inward and from the trailing edge forward,
// so every feather lands on the one it overlaps in life.
const paintOrder = () => [
  ...[...WING.prim].reverse(),
  ...WING.sec,
  ...WING.tert,
  ...[...WING.pgc].reverse(),
  ...WING.gc,
  ...WING.mc,
  ...WING.lc,
  ...WING.marg,
  ...WING.alula,
];

// ── Painting a feather ──────────────────────────────────────────────────────
const P = (pts, pose) => pts.map((p) => project(p, pose));

function paintFeather(f, pose) {
  const big = f.kind === "prim" || f.kind === "sec" || f.kind === "tert";
  const shape = P(outline(f, 0, 1, big ? 30 : 14), pose);

  // 1 · base vane, wet watercolor
  brush.noStroke();
  brush.noHatch();
  brush.fill(f.tone, big ? 175 : 165);
  brush.fillBleed(big ? 0.05 : 0.07, "out", null, 0.12);
  brush.fillTexture(0.55, 0.45, true, 0.2);
  brush.polygon(shape);

  // 2 · inner vane lies in the shadow of the next feather
  if (big || f.kind === "gc" || f.kind === "pgc") {
    const { inner } = edges(f, 0.05, 0.94, 18);
    const rach = [];
    for (let k = 18; k >= 0; k--) {
      const t = lerp(0.05, 0.94, k / 18);
      const [cx, cy, nx, ny] = rachisPoint(f, t);
      rach.push([cx - nx * 2, cy - ny * 2]);
    }
    brush.fill(C.ink, 70);
    brush.fillBleed(0.04, "in");
    brush.fillTexture(0.4, 0.2, false, 0.1);
    brush.polygon(P(inner.concat(rach), pose));
  }

  // 3 · darker distal third on flight feathers (sooty tips)
  if (f.kind === "prim") {
    brush.fill("#140f0b", 120);
    brush.fillBleed(0.05, "in");
    brush.fillTexture(0.5, 0.5, true, 0.1);
    brush.polygon(P(outline(f, 0.64, 1, 16), pose));
  }

  // 4 · transverse barring
  for (const b of f.bars) {
    const t0 = b + rnd(-0.02, 0.02);
    brush.fill(f.kind === "prim" ? "#0f0b08" : C.secBar, f.kind === "prim" ? 70 : 105);
    brush.fillBleed(0.08, "out");
    brush.fillTexture(0.6, 0.3, false, 0.15);
    brush.polygon(P(outline(f, t0, t0 + 0.055, 6), pose));
  }

  // 5 · barbs: fine hairlines running out from the shaft toward the tip
  const nb = Math.round(f.len / (big ? 5.5 : 7));
  for (let k = 1; k < nb; k++) {
    const t = (k / nb) * 0.96;
    const [cx, cy, nx, ny] = rachisPoint(f, t);
    const dx = Math.cos(f.ang), dy = Math.sin(f.ang);
    const { outer, inner } = edges(f, t, t, 1);
    const reachO = Math.hypot(outer[0][0] - cx, outer[0][1] - cy);
    const reachI = Math.hypot(inner[0][0] - cx, inner[0][1] - cy);
    const lean = 0.55; // barbs sweep toward the tip
    const light = rnd() < 0.18;
    brush.set("hair", light ? "#b9a27f" : "#120d0a", big ? 0.9 : 0.7);
    if (reachO > 2) {
      const e = [cx + (nx + dx * lean) * reachO * 0.92, cy + (ny + dy * lean) * reachO * 0.92];
      const a = project([cx, cy], pose), b = project(e, pose);
      brush.line(a[0], a[1], b[0], b[1]);
    }
    if (reachI > 2 && rnd() < 0.8) {
      const e = [cx + (-nx + dx * lean) * reachI * 0.9, cy + (-ny + dy * lean) * reachI * 0.9];
      const a = project([cx, cy], pose), b = project(e, pose);
      brush.line(a[0], a[1], b[0], b[1]);
    }
  }

  // occasional split in the vane — real feathers are never perfect
  if (big && rnd() < 0.45) {
    const t = rnd(0.35, 0.75);
    const [cx, cy, nx, ny] = rachisPoint(f, t);
    const side = rnd() < 0.5 ? 1 : -1;
    const w = widthProfile(f, t) * (side > 0 ? f.outer : 1 - f.outer);
    const dx = Math.cos(f.ang), dy = Math.sin(f.ang);
    const e = [cx + (side * nx + dx * 0.6) * w, cy + (side * ny + dy * 0.6) * w];
    const a = project([cx, cy], pose), b = project(e, pose);
    brush.set("gouache", PAPER, 0.7);
    brush.line(a[0], a[1], b[0], b[1]);
  }

  // 6 · rachis: pale shaft with a dark lower edge
  const shaft = [], shadow = [];
  for (let k = 0; k <= 12; k++) {
    const t = (k / 12) * 0.97;
    const [cx, cy, nx, ny] = rachisPoint(f, t);
    const pr = lerp(1.25, 0.35, t);
    shaft.push([...project([cx, cy], pose), pr]);
    shadow.push([...project([cx - nx * 1.4, cy - ny * 1.4], pose), pr]);
  }
  if (big || f.kind === "gc" || f.kind === "pgc" || f.kind === "alula") {
    brush.set("lead", C.ink, big ? 0.8 : 0.6);
    brush.spline(shadow, 0.5);
    brush.set("gouache", C.shaft, big ? 0.8 : 0.55);
    brush.spline(shaft, 0.5);
  }

  // 7 · pale fringe along the distal edge (coverts and secondaries)
  if (f.fringe) {
    const { outer, inner } = edges(f, 0.58, 1, 10);
    const rim = outer.concat(inner.reverse()).map((p) => [...project(p, pose), 0.9]);
    brush.set("gouache", C.fringe, big ? 1.1 : 0.9);
    brush.spline(rim, 0.6);
  }

  // 8 · crisp contour, broken here and there like a real pencil line
  const { outer, inner } = edges(f, 0, 1, big ? 26 : 12);
  brush.set("lead", C.ink, big ? 0.75 : 0.55);
  brush.spline(P(outer, pose).map((p, k, a) => [...p, 0.6 + 0.5 * Math.sin((k / a.length) * Math.PI)]), 0.5);
  if (big) {
    brush.set("lead", "#3a2c21", 0.5);
    brush.spline(P(inner, pose).map((p, k, a) => [...p, 0.4 + 0.5 * Math.sin((k / a.length) * Math.PI)]), 0.5);
  }
}

// Construction-line ghost of a wing phase
function ghostWing(pose, col, weight) {
  const list = [...WING.prim, ...WING.sec, ...WING.tert];
  for (const f of list) {
    const { outer, inner } = edges(f, 0.35, 1, 14);
    const pts = outer.concat(inner.reverse());
    brush.set("lead", col, weight);
    brush.spline(P(pts, pose).map((p) => [...p, 0.8]), 0.5);
  }
  // leading edge
  const lead = [SK.shoulder, [80, -62], [200, -60], SK.wrist.map((v, i) => v - (i ? 58 : 0)), [400, -78]];
  brush.set("lead", col, weight * 1.5);
  brush.spline(P(lead, pose).map((p) => [...p, 1]), 0.6);
}

// ── Body: a half-finished study — washed back, pencil head ────────────────
function body() {
  const [sx, sy] = SHOULDER;
  const shapeFill = (pts, col, op, bleed = 0.12, tex = 0.5) => {
    brush.noStroke();
    brush.fill(col, op);
    brush.fillBleed(bleed, "out", null, 0.5);
    brush.fillTexture(tex, 0.35, true, 0.2);
    brush.beginShape(0.6);
    for (const [x, y] of pts) brush.vertex(sx + x, sy + y);
    brush.endShape(true);
  };
  // whole body silhouette, then the darker mantle, then the pale throat
  shapeFill([[30, -44], [-50, -62], [-140, -50], [-210, -6], [-240, 50], [-222, 100], [-150, 132],
             [-60, 134], [10, 112], [48, 60]], "#86664a", 165, 0.14, 0.6);
  shapeFill([[24, -40], [-50, -56], [-130, -44], [-190, -6], [-170, 30], [-110, 52], [-40, 50], [20, 20]],
            "#4f3828", 160, 0.1, 0.6);
  shapeFill([[10, -40], [-60, -54], [-150, -36], [-205, 10], [-226, 60], [-200, 96], [-120, 120], [-40, 116], [20, 70]],
            "#6a4c34", 120, 0.08, 0.7);
  // short contour strokes following the form of the body plumage
  for (let i = 0; i < 140; i++) {
    const u = rnd(), v = rnd();
    const x = sx + lerp(-215, 20, u), y = sy + lerp(-40, 115, v) + Math.sin(u * Math.PI) * -10;
    const a = 0.25 + (v - 0.5) * 0.9;
    const l = rnd(8, 16);
    brush.set("hair", rnd() < 0.75 ? "#2a1e15" : "#cdb690", 0.9);
    brush.spline([[x, y, 0.4], [x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5 + 1.5, 1], [x + Math.cos(a) * l, y + Math.sin(a) * l, 0.3]], 0.7);
  }
  shapeFill([[-214, 70], [-180, 104], [-120, 124], [-60, 122], [-90, 100], [-160, 84]], "#c8b08c", 90, 0.15, 0.4);
  // scapulars: overlapping feather shapes over the shoulder
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 5 - r; i++) {
      const f = makeFeather({
        kind: "scap", base: [-160 + i * 32 + r * 16, -36 + r * 22], ang: 0.25 + rnd(-0.08, 0.08),
        len: 78 - r * 8, wid: 40, outer: 0.45, bend: 0, tip: 0.55, tone: r ? "#5e4431" : "#6d4f37",
        fringe: true,
      });
      paintFeather(f, { theta: 0, flex: 0, sweep: 0, scale: 1 });
    }
  }
  // contour of the back and belly
  brush.set("lead", "#4a3d31", 1.1);
  brush.spline([[sx - 212, sy + 6, 0.3], [sx - 150, sy - 34, 1], [sx - 60, sy - 60, 1.1], [sx + 20, sy - 50, 0.6]], 0.7);
  brush.set("lead", "#6e5e4c", 1.0);
  brush.spline([[sx - 222, sy + 100, 0.3], [sx - 130, sy + 134, 1], [sx - 30, sy + 128, 0.9], [sx + 40, sy + 84, 0.4]], 0.7);
  // head
  shapeFill([[-200, 4], [-250, 14], [-288, 48], [-296, 84], [-272, 108], [-232, 106], [-210, 80]], "#6e5038", 160, 0.06, 0.5);
  shapeFill([[-292, 84], [-276, 106], [-240, 108], [-226, 92], [-262, 90]], "#d9c6a3", 120, 0.05, 0.3);
  shapeFill([[-282, 54], [-250, 50], [-226, 64], [-250, 72], [-276, 70]], "#3b2a1e", 110, 0.08, 0.5);
  brush.set("lead", "#3d3127", 1.1);
  brush.spline([[sx - 205, sy + 8, 0.4], [sx - 252, sy + 16, 1], [sx - 290, sy + 50, 1.1], [sx - 298, sy + 80, 0.9]], 0.7);
  brush.set("lead", "#4d4034", 0.9);
  brush.spline([[sx - 288, sy + 98, 0.4], [sx - 268, sy + 110, 0.9], [sx - 236, sy + 108, 0.8], [sx - 214, sy + 98, 0.4]], 0.7);
  // hooked beak with cere
  brush.noStroke();
  brush.fill("#d9a93a", 200);
  brush.fillBleed(0.04);
  brush.polygon([[sx - 292, sy + 72], [sx - 300, sy + 70], [sx - 304, sy + 82], [sx - 294, sy + 86]]);
  brush.fill("#2b2018", 220);
  brush.fillTexture(0.3, 0.6, false, 0);
  brush.polygon([[sx - 302, sy + 70], [sx - 318, sy + 76], [sx - 328, sy + 92], [sx - 322, sy + 104], [sx - 318, sy + 94], [sx - 304, sy + 90]]);
  brush.set("lead", "#16110d", 1.0);
  brush.spline([[sx - 302, sy + 70, 0.6], [sx - 318, sy + 76, 1], [sx - 328, sy + 92, 0.9], [sx - 322, sy + 104, 0.6]], 0.6);
  // eye: iris, pupil, brow shadow, catchlight
  brush.noStroke();
  brush.fill("#8a5a1c", 200);
  brush.fillBleed(0.03);
  brush.fillTexture(0.3, 0.7);
  brush.circle(sx - 268, sy + 62, 7, 0.05);
  brush.fill("#0d0a08", 240);
  brush.fillTexture(0.1, 0.2);
  brush.circle(sx - 268, sy + 62, 3.4, 0.02);
  brush.set("lead", "#1b1511", 1.2);
  brush.arc(sx - 268, sy + 62, 8, Math.PI * 1.0, Math.PI * 2.0);
  brush.set("gouache", "#fbf6ea", 0.8);
  brush.line(sx - 270, sy + 60, sx - 269, sy + 59);
  brush.set("charcoal", "#2a211a", 0.9);
  brush.spline([[sx - 284, sy + 52, 0.4], [sx - 266, sy + 50, 1], [sx - 250, sy + 56, 0.5]], 0.6);
  // hatching for volume under the body
  brush.set("lead", "#86765f", 0.7);
  for (let i = 0; i < 26; i++) {
    const x = sx - 220 + i * 9;
    const y = sy + 120 + Math.sin(i / 25 * Math.PI) * 12;
    brush.line(x, y, x + 18, y - 22);
  }
}

// ── Motion: wingtip trajectory and air curling off the trailing edge ────────
function motionLines(poses) {
  const tipLocal = [WING.prim[8].base[0] + Math.cos(WING.prim[8].ang) * WING.prim[8].len,
                    WING.prim[8].base[1] + Math.sin(WING.prim[8].ang) * WING.prim[8].len];
  const path = [];
  for (let k = 0; k <= 16; k++) {
    const th = lerp(poses.up.theta, poses.down.theta, k / 16);
    const fl = lerp(poses.up.flex, poses.down.flex, k / 16);
    const sw = lerp(poses.up.sweep, poses.down.sweep, k / 16);
    const p = project(tipLocal, { theta: th, flex: fl, sweep: sw, scale: 1 });
    path.push([p[0] + 14, p[1], 0.6 + 0.6 * Math.sin((k / 16) * Math.PI)]);
  }
  brush.set("lead", "#5d4d3d", 1.1);
  brush.spline(path, 0.6);
  // arrowhead at the bottom of the stroke
  const a = path[path.length - 2], b = path[path.length - 1];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  brush.set("lead", "#5d4d3d", 1.1);
  for (const s of [-1, 1]) {
    brush.line(b[0], b[1], b[0] - Math.cos(ang + s * 0.45) * 16, b[1] - Math.sin(ang + s * 0.45) * 16);
  }
  // second, fainter echo
  brush.set("lead", "#8f7f6c", 0.8);
  brush.spline(path.map(([x, y, p]) => [x + 26, y + 6, p * 0.7]), 0.6);

  // turbulence curling off the trailing edge
  brush.set("lead", "#8f7f6c", 0.7);
  for (let i = 0; i < 7; i++) {
    const s = 70 + i * 55;
    const base = project([s, 200 + rnd(-6, 6)], poses.main);
    const pts = [];
    for (let k = 0; k < 9; k++) {
      const t = k / 8;
      pts.push([base[0] - 10 + t * 60 + Math.sin(t * 5 + i) * 8, base[1] + 14 + t * 30 + Math.cos(t * 4 + i) * 6, 0.9 - t * 0.6]);
    }
    brush.spline(pts, 0.8);
  }
}

// ── Compose ─────────────────────────────────────────────────────────────────
const POSES = {
  up: { theta: 0.95, flex: -0.6, sweep: 0.15, scale: 1 },
  down: { theta: -0.62, flex: 0.9, sweep: -0.1, scale: 1 },
  main: { theta: 0.12, flex: 0.55, sweep: 0, scale: 1 },
};

function paperTooth() {
  // faint grain and stains so the paper is not a flat colour
  brush.noStroke();
  for (let i = 0; i < 6; i++) {
    brush.fill(i % 2 ? "#e6d9bf" : "#efe3cb", 28);
    brush.fillBleed(0.35, "out", null, 0.9);
    brush.fillTexture(0.8, 0.15, true, 0.1);
    brush.circle(rnd(0, W), rnd(0, H), rnd(140, 260), 0.8);
  }
}

function draw() {
  brush.clear(PAPER);
  brush.push();
  brush.translate(-W / 2, -H / 2);

  paperTooth();
  ghostWing(POSES.up, "#8a7a68", 0.9);
  ghostWing(POSES.down, "#988978", 0.8);
  motionLines(POSES);
  body();
  const order = paintOrder();
  const firstCovert = order.findIndex((f) => f.kind === "pgc");
  order.slice(0, firstCovert).forEach((f) => paintFeather(f, POSES.main));
  // patagium: the skin fold of the leading edge, washed in before the coverts
  brush.noStroke();
  brush.fill("#5b412e", 150);
  brush.fillBleed(0.08, "out");
  brush.fillTexture(0.5, 0.3, true, 0.2);
  brush.polygon(P([[-10, -40], [90, -82], [210, -84], [300, -102], [395, -94], [420, -60], [330, 40], [200, 60], [90, 70], [-10, 50]], POSES.main));
  order.slice(firstCovert).forEach((f) => paintFeather(f, POSES.main));

  // wrist highlight & leading-edge shadow
  brush.set("charcoal", "#1e1712", 0.7);
  const lead = [[-10, -46], [90, -86], [210, -90], [300, -106], [392, -98]].map((p) => [...project(p, POSES.main), 1]);
  brush.spline(lead, 0.6);

  brush.pop();
  brush.render();
  window.__done = true;
}

draw();
