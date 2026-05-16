// OKLCH color picker — 2D L × C plane with a hue slider, gamut
// boundary overlay, and L / C / H drag-to-scrub inputs. Mounted
// above the palette inside the focus-driven popover.
//
// The 2D plane is canvas-painted via Björn Ottosson's Oklab → linear
// sRGB inverse, then chroma-compressed at the sRGB gamut boundary
// for out-of-gamut points (matches the CSS Color 4 clamp behavior
// the browser applies to `oklch()` literals at display time). The
// boundary curve is drawn as an SVG overlay so the in-gamut region
// is unambiguous; out-of-gamut clicks still register, the literal
// is written to source, the browser clamps at render.
//
// Drag interactions on plane / slider / L-C-H labels feed the same
// scrub channel the rest of the inspector uses — a multi-frame drag
// becomes one undo entry, not N.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';

import type { Value } from '../runtime/ast.js';

interface ColorPickerProps {
  // Current fill value — drives the picker's initial L/C/H. Color
  // literals are unpacked directly; other kinds (name_ref / string)
  // fall back to a sane default since we can't read the resolved
  // RGB without rendering.
  value: Value;
  // Merged registry + source-declared color tokens (CSS color
  // strings keyed by name). Used by resolveToLCH so a name_ref
  // probes the *correct* CSS — source-declared tokens have no
  // matching `var(--name)`, so without this map their pickers
  // would open at the default blue.
  colorTokens: Record<string, string>;
  // Atomic commit — pushes one undo entry. Used by the text-input
  // Enter/blur path.
  onCommit: (text: string) => void;
  // Scrub channel — drag interactions begin a session, stream
  // previews (the host applies them without pushing undo), and end
  // with a single undo entry for the whole drag.
  onScrubBegin: () => void;
  onScrubPreview: (text: string) => void;
  onScrubEnd: (finalText: string | null) => void;
}

const DEFAULT_L = 0.7;
const DEFAULT_C = 0.15;
const DEFAULT_H = 240;

// X axis of the 2D plane spans C ∈ [0, C_MAX_DISPLAY]. Most
// in-gamut OKLCH chromas at any hue fall well within 0.4; going
// further just adds out-of-gamut whitespace.
const C_MAX_DISPLAY = 0.4;

// Canvas backing-store size for the LC plane. Independent of the
// element's CSS size — the browser bilinear-interpolates on display.
// 384 × 192 keeps the repaint at ~75k pixels (sub-10ms) while the
// gradient stays smooth even on HiDPI scaling.
const PLANE_W = 384;
const PLANE_H = 192;

// Boundary curve sample density. ~64 samples gives a smooth curve
// at the displayed plane size. Cached per hue (rounded to 1°).
const BOUNDARY_SAMPLES = 64;

export function ColorPicker({
  value,
  colorTokens,
  onCommit,
  onScrubBegin,
  onScrubPreview,
  onScrubEnd,
}: ColorPickerProps): ReactElement {
  // Initial L/C/H from the current value when it's a color literal;
  // otherwise a neutral mid-saturation blue. Once the user starts
  // interacting, the picker tracks its own state — but external
  // commits do reset it (via the effect below), so the picker
  // stays in sync when the user picks via the palette while it's
  // open.
  const [{ l, c, h }, setLch] = useState(() => initLCH(value));
  // Resolve the value's actual displayed color into L/C/H. For
  // `color_oklch` literals this is a direct unpack; for `name_ref`
  // (e.g. `amber` or a source-declared `brand`) we look up the
  // resolved CSS in `colorTokens` first, then probe the browser
  // to convert it through to OKLab. Done in useLayoutEffect so
  // the resolution happens before paint — opening the picker on
  // an amber fill shows amber, not the default blue.
  useLayoutEffect(() => {
    setLch(resolveToLCH(value, colorTokens));
  }, [value, colorTokens]);

  const emitText = (nl: number, nc: number, nh: number): string =>
    `oklch(${fmt(nl)} ${fmt(nc)} ${fmt(nh)})`;

  // Atomic commit used by text-input Enter/blur. Drag paths use
  // the scrub channel directly.
  const commit = (nl: number, nc: number, nh: number): void => {
    setLch({ l: nl, c: nc, h: nh });
    onCommit(emitText(nl, nc, nh));
  };

  // Gamut boundary curve for the current hue. Recomputed only when
  // the hue changes — cached behind a memo.
  const { boundaryPath, maxChromaByL } = useMemo(
    () => buildBoundary(h),
    [h],
  );

  return (
    <div className="sw-color-picker">
      <LCPlane
        l={l}
        c={c}
        h={h}
        maxChromaByL={maxChromaByL}
        boundaryPath={boundaryPath}
        setLch={setLch}
        emitText={emitText}
        onScrubBegin={onScrubBegin}
        onScrubPreview={onScrubPreview}
        onScrubEnd={onScrubEnd}
      />
      <HueSlider
        l={l}
        c={c}
        h={h}
        setLch={setLch}
        emitText={emitText}
        onScrubBegin={onScrubBegin}
        onScrubPreview={onScrubPreview}
        onScrubEnd={onScrubEnd}
      />
      <div className="sw-color-picker-fields">
        <NumberField
          label="L"
          value={l}
          step={0.001}
          min={0}
          max={1}
          scale={0.002}
          commit={(v) => commit(clamp(v, 0, 1), c, h)}
          onScrub={(getV) => ({
            begin: () => onScrubBegin(),
            preview: (v) => {
              const nv = clamp(v, 0, 1);
              setLch({ l: nv, c, h });
              onScrubPreview(emitText(nv, c, h));
            },
            end: (v) => {
              const nv = v === null ? null : clamp(v, 0, 1);
              onScrubEnd(nv === null ? null : emitText(nv, c, h));
              if (nv !== null) setLch({ l: nv, c, h });
            },
          })}
        />
        <NumberField
          label="C"
          value={c}
          step={0.001}
          min={0}
          max={0.5}
          scale={0.002}
          commit={(v) => commit(l, Math.max(0, v), h)}
          onScrub={(getV) => ({
            begin: () => onScrubBegin(),
            preview: (v) => {
              const nv = Math.max(0, v);
              setLch({ l, c: nv, h });
              onScrubPreview(emitText(l, nv, h));
            },
            end: (v) => {
              const nv = v === null ? null : Math.max(0, v);
              onScrubEnd(nv === null ? null : emitText(l, nv, h));
              if (nv !== null) setLch({ l, c: nv, h });
            },
          })}
        />
        <NumberField
          label="H"
          value={h}
          step={1}
          min={0}
          max={360}
          scale={1}
          commit={(v) => commit(l, c, wrapHue(v))}
          onScrub={(getV) => ({
            begin: () => onScrubBegin(),
            preview: (v) => {
              const nv = wrapHue(v);
              setLch({ l, c, h: nv });
              onScrubPreview(emitText(l, c, nv));
            },
            end: (v) => {
              const nv = v === null ? null : wrapHue(v);
              onScrubEnd(nv === null ? null : emitText(l, c, nv));
              if (nv !== null) setLch({ l, c, h: nv });
            },
          })}
        />
      </div>
    </div>
  );
}

// ── 2D L × C plane ────────────────────────────────────────────────

function LCPlane({
  l,
  c,
  h,
  maxChromaByL,
  boundaryPath,
  setLch,
  emitText,
  onScrubBegin,
  onScrubPreview,
  onScrubEnd,
}: {
  l: number;
  c: number;
  h: number;
  maxChromaByL: readonly number[];
  boundaryPath: string;
  setLch: (s: { l: number; c: number; h: number }) => void;
  emitText: (l: number, c: number, h: number) => string;
  onScrubBegin: () => void;
  onScrubPreview: (text: string) => void;
  onScrubEnd: (finalText: string | null) => void;
}): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Repaint the canvas whenever the hue changes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintLCPlane(canvas, h);
  }, [h]);

  // Pointer-to-(L, C) mapping. X spans [0, C_MAX_DISPLAY], Y spans
  // [1, 0] (top is full lightness). Clamps to bounds.
  const pickFromEvent = (e: PointerEvent | ReactPointerEvent): { l: number; c: number } => {
    const el = wrapRef.current!;
    const rect = el.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    return { l: 1 - y, c: x * C_MAX_DISPLAY };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Drop focus from whatever was active (typically a stale L/C/H
    // number-field input) so its focus ring doesn't visually persist
    // during the drag, AND so any pending draft text commits via
    // the input's onBlur before our scrub updates the value.
    blurActive();
    const startEl = e.currentTarget;
    onScrubBegin();
    const initial = pickFromEvent(e);
    setLch({ l: initial.l, c: initial.c, h });
    onScrubPreview(emitText(initial.l, initial.c, h));

    let last = initial;
    const onMove = (ev: PointerEvent): void => {
      last = pickFromEvent(ev);
      setLch({ l: last.l, c: last.c, h });
      onScrubPreview(emitText(last.l, last.c, h));
    };
    const cleanup = (committed: boolean): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      onScrubEnd(committed ? emitText(last.l, last.c, h) : null);
    };
    const onUp = (): void => cleanup(true);
    const onCancel = (): void => cleanup(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    void startEl;
  };

  const indicatorX = clamp(c / C_MAX_DISPLAY, 0, 1) * 100;
  const indicatorY = (1 - clamp(l, 0, 1)) * 100;

  return (
    <div
      ref={wrapRef}
      className="sw-color-picker-plane"
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        className="sw-color-picker-canvas"
        width={PLANE_W}
        height={PLANE_H}
      />
      {/* sRGB gamut boundary — to the LEFT of the curve is
        * displayable at this hue; to the right, chroma is
        * compressed at display. */}
      <svg
        className="sw-color-picker-boundary"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path d={boundaryPath} />
      </svg>
      <div
        className="sw-color-picker-indicator"
        style={{ left: `${indicatorX}%`, top: `${indicatorY}%` }}
      />
      {void maxChromaByL}
    </div>
  );
}

// ── Hue slider ────────────────────────────────────────────────────

function HueSlider({
  l,
  c,
  h,
  setLch,
  emitText,
  onScrubBegin,
  onScrubPreview,
  onScrubEnd,
}: {
  l: number;
  c: number;
  h: number;
  setLch: (s: { l: number; c: number; h: number }) => void;
  emitText: (l: number, c: number, h: number) => string;
  onScrubBegin: () => void;
  onScrubPreview: (text: string) => void;
  onScrubEnd: (finalText: string | null) => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const hueFromEvent = (e: PointerEvent | ReactPointerEvent): number => {
    const rect = ref.current!.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    return x * 360;
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    blurActive();
    onScrubBegin();
    let lastH = hueFromEvent(e);
    setLch({ l, c, h: lastH });
    onScrubPreview(emitText(l, c, lastH));
    const onMove = (ev: PointerEvent): void => {
      lastH = hueFromEvent(ev);
      setLch({ l, c, h: lastH });
      onScrubPreview(emitText(l, c, lastH));
    };
    const cleanup = (committed: boolean): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      onScrubEnd(committed ? emitText(l, c, lastH) : null);
    };
    const onUp = (): void => cleanup(true);
    const onCancel = (): void => cleanup(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  };

  const indicatorX = (clamp(h, 0, 360) / 360) * 100;
  return (
    <div
      ref={ref}
      className="sw-color-picker-hue"
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="sw-color-picker-indicator" style={{ left: `${indicatorX}%` }} />
    </div>
  );
}

// ── Drag-to-scrub numeric field ──────────────────────────────────

interface ScrubSession {
  begin: () => void;
  preview: (newValue: number) => void;
  end: (finalValue: number | null) => void;
}

function NumberField({
  label,
  value,
  step,
  scale,
  commit,
  onScrub,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  // Pixels-per-unit for the scrub gesture. e.g. scale = 0.002 means
  // 500 px of drag = 1 unit. Shift × 10, alt × 0.1 (cumulative).
  scale: number;
  commit: (v: number) => void;
  onScrub: (getValue: () => number) => ScrubSession;
}): ReactElement {
  const [draft, setDraft] = useState(fmt(value));
  const focusedRef = useRef(false);
  const formatted = fmt(value);
  useEffect(() => {
    if (!focusedRef.current) setDraft(formatted);
  }, [formatted]);

  const onLabelPointerDown = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Same as plane/slider — drop focus from any stale input so
    // its draft commits and its focus ring goes away.
    blurActive();
    const startVal = value;
    let accum = 0;
    document.body.classList.add('sw-scrubbing');
    const target = e.currentTarget;
    const isAutomated =
      typeof navigator !== 'undefined' && navigator.webdriver === true;
    if (!isAutomated && target.requestPointerLock) {
      target.requestPointerLock();
    }
    let last: number = startVal;
    const session = onScrub(() => last);
    session.begin();

    const onMove = (ev: PointerEvent): void => {
      const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      accum += ev.movementX * scale * factor;
      const raw = startVal + accum;
      const stepped = Math.round(raw / step) * step;
      last = stepped;
      session.preview(stepped);
    };
    const cleanup = (committed: boolean): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement) document.exitPointerLock?.();
      document.body.classList.remove('sw-scrubbing');
      session.end(committed ? last : null);
    };
    const onUp = (): void => cleanup(true);
    const onCancel = (): void => cleanup(false);
    const onLockChange = (): void => {
      if (!document.pointerLockElement) cleanup(true);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('pointerlockchange', onLockChange);
  };

  return (
    // `<div>` not `<label>` — a label wrapping a form control
    // auto-focuses the control on any click within the label,
    // which would steal focus to the L/C/H input whenever the
    // user clicked the label span to start a scrub. Without the
    // label association the input is only focused via direct
    // click / Tab.
    <div className="sw-color-picker-field">
      <span
        className="sw-color-picker-field-label sw-property-key-scrub"
        onPointerDown={onLabelPointerDown}
        title="drag to scrub · shift = 10× · alt = 0.1×"
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        spellCheck={false}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          focusedRef.current = false;
          const n = parseFloat(draft);
          if (!Number.isFinite(n)) {
            setDraft(fmt(value));
            return;
          }
          commit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(fmt(value));
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

// ── OKLCH math + canvas painting ─────────────────────────────────
//
// Oklab → linear sRGB via the forward matrices Björn Ottosson
// published — but inverted numerically at module init rather than
// using his pre-computed inverse constants. The published inverses
// are truncated to 10 digits, which leaves the G-row coefficients
// summing to -1.4e-4 instead of 0 (sub-percent off the true inverse
// in some cells). For most use that's invisible, but achromatic
// grays evaluate as `(R, G, B) ≈ (L³, -tiny, L³)` — channel-clamping
// the slightly-negative G to 0 turns every gray into magenta, and
// the gamut-search binary then collapses to Cmax = 0, painting the
// whole plane that way. Computing the inverse in double precision
// at startup is two cofactor expansions of fixed 3×3 matrices, sub-
// microsecond and one-shot.

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

function invert3x3(M: Mat3): Mat3 {
  const a = M[0][0], b = M[0][1], c = M[0][2];
  const d = M[1][0], e = M[1][1], f = M[1][2];
  const g = M[2][0], h = M[2][1], i = M[2][2];
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function applyMat3(M: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

// linear sRGB → LMS (forward, from Ottosson).
const M1: Mat3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
// (LMS)^(1/3) → Oklab (forward, from Ottosson).
const M2: Mat3 = [
  [0.2104542553, 0.7936177850, -0.0040720468],
  [1.9779984951, -2.4285922050, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.8086757660],
];
const M1_INV = invert3x3(M1);
const M2_INV = invert3x3(M2);

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const [l_, m_, s_] = applyMat3(M2_INV, [L, a, b]);
  const lms: [number, number, number] = [l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_];
  return applyMat3(M1_INV, lms);
}

function oklchInGamut(L: number, C: number, hDeg: number): boolean {
  const hRad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const [r, g, bl] = oklabToLinearSrgb(L, a, b);
  // Tight epsilon — the matrix error floor with double-precision
  // inverses is sub-1e-10 in any channel. 1e-6 lets the binary
  // search converge cleanly without falsely admitting near-boundary
  // out-of-gamut colors.
  const eps = 1e-6;
  return (
    r >= -eps && r <= 1 + eps &&
    g >= -eps && g <= 1 + eps &&
    bl >= -eps && bl <= 1 + eps
  );
}

// Binary search the maximum in-gamut chroma at a given L, H. ~14
// iters → precision ~3e-5 over the [0, 0.5] search range.
function maxChromaForLH(L: number, hDeg: number): number {
  if (L <= 0 || L >= 1) return 0;
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (oklchInGamut(L, mid, hDeg)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Build a per-L row of Cmax samples AND a closed SVG path tracing
// the boundary curve. The Cmax table feeds canvas painting (for
// chroma-compressed out-of-gamut points); the SVG path is the
// visible overlay.
function buildBoundary(hDeg: number): {
  boundaryPath: string;
  maxChromaByL: number[];
} {
  const max: number[] = new Array(BOUNDARY_SAMPLES + 1);
  const points: string[] = [];
  for (let i = 0; i <= BOUNDARY_SAMPLES; i++) {
    const L = i / BOUNDARY_SAMPLES;
    const C = maxChromaForLH(L, hDeg);
    max[i] = C;
    const x = (C / C_MAX_DISPLAY) * 100;
    const y = (1 - L) * 100;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return {
    boundaryPath: `M ${points.join(' L ')}`,
    maxChromaByL: max,
  };
}

// Standard sRGB gamma encode (CSS Color 4).
function srgbGamma(x: number): number {
  if (x <= 0.0031308) return 12.92 * x;
  return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// Paint the L × C plane at a given hue into a canvas. For each
// pixel: derive (L, C), if out-of-gamut compress C to the row's
// boundary (so the displayed color stays at the same hue and
// lightness, matching what CSS Color 4 does at render time).
function paintLCPlane(canvas: HTMLCanvasElement, hDeg: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const image = ctx.createImageData(w, h);
  const data = image.data;
  const hRad = (hDeg * Math.PI) / 180;
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);
  for (let y = 0; y < h; y++) {
    const L = 1 - (y + 0.5) / h;
    const Cmax = maxChromaForLH(L, hDeg);
    for (let x = 0; x < w; x++) {
      let C = ((x + 0.5) / w) * C_MAX_DISPLAY;
      if (C > Cmax) C = Cmax;
      const a = C * cosH;
      const b = C * sinH;
      const [r, g, bl] = oklabToLinearSrgb(L, a, b);
      const i = (y * w + x) * 4;
      data[i] = Math.round(srgbGamma(clamp(r, 0, 1)) * 255);
      data[i + 1] = Math.round(srgbGamma(clamp(g, 0, 1)) * 255);
      data[i + 2] = Math.round(srgbGamma(clamp(bl, 0, 1)) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// ── helpers ──────────────────────────────────────────────────────

function initLCH(v: Value): { l: number; c: number; h: number } {
  if (v.kind === 'color_oklch') return { l: v.l, c: v.c, h: v.h };
  return { l: DEFAULT_L, c: DEFAULT_C, h: DEFAULT_H };
}

// Resolve a fill value to L/C/H by probing the browser's CSS engine.
// `color_oklch` literals unpack directly; `name_ref` and `string`
// fills get an offscreen probe whose `background-color` is set to
// the equivalent CSS, then we read the computed RGB and convert
// sRGB → OKLab. Falls back to defaults for unsupported / unresolved
// kinds (lists, components, etc.).
function resolveToLCH(
  v: Value,
  tokens: Record<string, string>,
): { l: number; c: number; h: number } {
  if (v.kind === 'color_oklch') return { l: v.l, c: v.c, h: v.h };
  let css: string | null = null;
  if (v.kind === 'name_ref') css = tokens[v.name] ?? `var(--${v.name})`;
  else if (v.kind === 'string') css = v.value;
  if (css === null) return { l: DEFAULT_L, c: DEFAULT_C, h: DEFAULT_H };
  // Fast path: the source value (or a source-declared token) is
  // already an `oklch(L C H)` literal — skip the DOM round-trip
  // and parse directly. Both saves a probe + avoids the form-
  // dependent parsing below.
  const directOklch = parseOklchString(css);
  if (directOklch) return directOklch;
  if (typeof document === 'undefined') {
    return { l: DEFAULT_L, c: DEFAULT_C, h: DEFAULT_H };
  }
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.backgroundColor = css;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  // Chrome preserves the original color space in getComputedStyle —
  // an oklch() background reads back as `oklch(L C H)`, an rgb()
  // background reads back as `rgb(R, G, B)`, etc. Try OKLCH first
  // (more direct, no precision loss), then RGB.
  const probedOklch = parseOklchString(computed);
  if (probedOklch) return probedOklch;
  const rgb = parseRgbString(computed);
  if (rgb) return srgbToOklch(rgb);
  return { l: DEFAULT_L, c: DEFAULT_C, h: DEFAULT_H };
}

function parseOklchString(s: string): { l: number; c: number; h: number } | null {
  const m = s.match(/^oklch\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  if (!m) return null;
  return {
    l: parseFloat(m[1]!),
    c: parseFloat(m[2]!),
    h: parseFloat(m[3]!),
  };
}

// Parse `rgb(R, G, B)` or `rgba(R, G, B, A)` (the form
// getComputedStyle returns for resolved colors) into [R, G, B] in
// [0, 255]. Returns null for any other form (e.g. `none`).
function parseRgbString(s: string): [number, number, number] | null {
  const m = s.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/);
  if (!m) return null;
  return [parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!)];
}

// Standard sRGB inverse-gamma: gamma-encoded channel ∈ [0, 255] →
// linear ∈ [0, 1].
function srgbInverseGamma(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbToOklch(rgb255: readonly [number, number, number]): {
  l: number;
  c: number;
  h: number;
} {
  const linRGB: [number, number, number] = [
    srgbInverseGamma(rgb255[0]),
    srgbInverseGamma(rgb255[1]),
    srgbInverseGamma(rgb255[2]),
  ];
  const lms = applyMat3(M1, linRGB);
  const lms_: [number, number, number] = [
    Math.cbrt(lms[0]),
    Math.cbrt(lms[1]),
    Math.cbrt(lms[2]),
  ];
  const [L, a, b] = applyMat3(M2, lms_);
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: H };
}

function blurActive(): void {
  const a = document.activeElement;
  if (a && a instanceof HTMLElement) a.blur();
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function wrapHue(h: number): number {
  const w = ((h % 360) + 360) % 360;
  return w;
}

// Round to 4 sig figs and drop trailing zeros — keeps the source
// readable and stable across small numeric changes.
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}
