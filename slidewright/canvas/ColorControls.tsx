import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { Value } from '../runtime/ast.js';
import type { SlideColor } from './InspectorPanels.js';

// Portaled popover host for the color picker + palette. Anchors
// to the color cell via `getBoundingClientRect`, follows scroll /
// resize. Lives in document.body so the inspector pane's overflow
// doesn't clip it. Closes on outside-click or Escape.
export function ColorPopover({
  anchorRef,
  onRequestClose,
  children,
  textFormatting = false,
  label,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onRequestClose: (reason?: 'escape' | 'outside') => void;
  textFormatting?: boolean;
  label?: string;
  children: React.ReactNode;
}): ReactElement | null {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const updatePosition = useRef<() => void>(() => {});
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    // Compute the desired position. Two passes converge: the first
    // call has the popover not yet mounted (popoverRef null), so it
    // places naïvely below the anchor. Once the popover is in the
    // DOM, the layout effect re-runs (rect change → useEffect on
    // popoverRef via ResizeObserver below), measures the popover's
    // actual height, and flips above the anchor if below would
    // overflow the viewport and above has more room.
    const update = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const popoverEl = popoverRef.current;
      const popoverH = popoverEl ? popoverEl.getBoundingClientRect().height : 0;
      const gap = 4;
      const spaceBelow = window.innerHeight - a.bottom - gap;
      const spaceAbove = a.top - gap;
      const flipAbove =
        popoverH > 0 && popoverH > spaceBelow && spaceAbove > spaceBelow;
      const top = flipAbove ? Math.max(gap, a.top - popoverH - gap) : a.bottom + gap;
      const left = Math.max(gap, Math.min(a.left, window.innerWidth - (popoverEl?.getBoundingClientRect().width ?? a.width) - gap));
      const clampedTop = Math.max(gap, Math.min(top, window.innerHeight - popoverH - gap));
      setRect((prev) => {
        if (
          prev &&
          prev.top === clampedTop &&
          prev.left === left &&
          prev.width === a.width
        ) {
          return prev;
        }
        return { top: clampedTop, left, width: a.width };
      });
    };
    updatePosition.current = update;
    update();
    // `capture: true` catches scroll on any ancestor (the inspector
    // pane scrolls independently of the document); resize handles
    // viewport / column-width changes. Passive listeners — we only
    // read layout.
    window.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update, { passive: true });
    // Watch the popover's own size — content changes (palette rows
    // appearing, picker hue change leaves layout stable but defensive)
    // can shift the flip decision. The observer fires once on mount
    // so the second-pass measurement happens reliably.
    const ro = new ResizeObserver(() => update());
    let observed: HTMLElement | null = null;
    const attach = (): void => {
      if (popoverRef.current && popoverRef.current !== observed) {
        if (observed) ro.unobserve(observed);
        ro.observe(popoverRef.current);
        observed = popoverRef.current;
      }
    };
    attach();
    // Re-attach after the popover mounts (when rect becomes
    // non-null and the popover element actually renders).
    const raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [anchorRef]);
  // The floating toolbar can move after selection/layout changes without a scroll.
  useLayoutEffect(() => updatePosition.current());

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (anchorRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      onRequestClose('outside');
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onRequestClose('escape');
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, onRequestClose]);

  if (!rect) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className={`sw-color-popover${textFormatting ? ' sw-text-session-actions sw-text-color-popover' : ''}`}
      data-sw-text-formatting={textFormatting || undefined}
      role={label ? 'dialog' : undefined} aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onRequestClose('escape'); } }}
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: textFormatting ? 'min(300px, calc(100vw - 16px))' : rect.width,
      }}
      // Keep the input focused across clicks within the popover —
      // prevents losing focus to body which would mid-scroll close.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

interface Swatch {
  sourceText: string;
  cssValue: string;
}

export function ColorPalette({
  tokens,
  slideColors,
  currentCss,
  onPick,
}: {
  tokens: Record<string, string>;
  slideColors: SlideColor[];
  currentCss: string | null;
  onPick: (sourceText: string) => void;
}): ReactElement {
  // Build the two candidate lists. Resolution + dedup happens after
  // mount so the resolved RGBs are available via the browser's CSS
  // engine (CSS variable aliases like `accent → blue` aren't
  // observable from source alone).
  const tokenCandidates = useMemo<Swatch[]>(
    () =>
      Object.entries(tokens).map(([name, cssValue]) => ({
        sourceText: name,
        // Map values are pre-resolved CSS color strings — `var(--<n>)`
        // for registry tokens (the CSS-variable cascade does the
        // real work), `oklch(...)` / hex / etc. for source-declared
        // ones. The palette swatch just paints whatever's here.
        cssValue,
      })),
    [tokens],
  );
  const slideCandidates = useMemo<Swatch[]>(
    () =>
      slideColors.map((sc) => ({
        sourceText: sc.sourceText,
        cssValue: sc.cssValue,
      })),
    [slideColors],
  );
  const dedup = useResolvedDedup(tokenCandidates, slideCandidates);

  return (
    <div className="sw-color-palette">
      <div
        className="sw-color-palette-row"
        role="group"
        aria-label="global colors"
      >
        {dedup.globals.map((sw) => (
          <SwatchButton
            key={`tok-${sw.sourceText}`}
            swatch={sw}
            isCurrent={currentCss === sw.cssValue}
            onPick={onPick}
          />
        ))}
      </div>
      {dedup.slide.length > 0 ? (
        <div
          className="sw-color-palette-row sw-color-palette-slide"
          role="group"
          aria-label="colors used on this slide"
        >
          {dedup.slide.map((sw) => (
            <SwatchButton
              key={`slide-${sw.sourceText}`}
              swatch={sw}
              isCurrent={currentCss === sw.cssValue}
              onPick={onPick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SwatchButton({
  swatch,
  isCurrent,
  onPick,
}: {
  swatch: Swatch;
  isCurrent: boolean;
  onPick: (sourceText: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={'sw-color-swatch' + (isCurrent ? ' current' : '')}
      style={{ background: swatch.cssValue }}
      title={swatch.sourceText}
      aria-label={swatch.sourceText}
      aria-pressed={isCurrent}
      // Keep the parent input focused so the popover stays open
      // across rapid swatch clicks (mousedown blurs whatever's
      // focused otherwise).
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(swatch.sourceText)}
    />
  );
}

// Resolve each candidate's CSS value to a concrete RGB via an
// offscreen probe element (CSS-variable aliases like `accent → blue`
// are only resolvable via the browser's engine). Keep the first
// occurrence per RGB across both rows so global swatches own the
// canonical position and per-slide echoes drop out.
//
// Returns the original ordering with duplicates removed. The first
// render before the layout effect fires shows the un-deduped list —
// a single frame of "extra swatches" that disappear once resolution
// completes. Acceptable; resolution runs once per palette mount.
function useResolvedDedup(
  globals: readonly Swatch[],
  slide: readonly Swatch[],
): { globals: Swatch[]; slide: Swatch[] } {
  type Resolved = { globals: number[]; slide: number[]; globalInput: readonly Swatch[]; slideInput: readonly Swatch[] };
  const [keep, setKeep] = useState<Resolved | null>(null);
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    const resolve = (css: string): string => {
      probe.style.background = '';
      probe.style.background = css;
      return getComputedStyle(probe).backgroundColor || css;
    };
    const seen = new Set<string>();
    const globalsKeep: number[] = [];
    const slideKeep: number[] = [];
    for (let i = 0; i < globals.length; i++) {
      const rgb = resolve(globals[i]!.cssValue);
      if (!seen.has(rgb)) {
        seen.add(rgb);
        globalsKeep.push(i);
      }
    }
    for (let i = 0; i < slide.length; i++) {
      const rgb = resolve(slide[i]!.cssValue);
      if (!seen.has(rgb)) {
        seen.add(rgb);
        slideKeep.push(i);
      }
    }
    probe.remove();
    setKeep({ globals: globalsKeep, slide: slideKeep, globalInput: globals, slideInput: slide });
  }, [globals, slide]);
  // Source previews and cancellation can replace or shrink the candidates.
  // Previous indices belong only to the arrays resolved by that effect.
  if (!keep || keep.globalInput !== globals || keep.slideInput !== slide) {
    return { globals: [...globals], slide: [...slide] };
  }
  return {
    globals: keep.globals.map((i) => globals[i]!),
    slide: keep.slide.map((i) => slide[i]!),
  };
}

// Map a fill's Value to the CSS color string it resolves to (used
// to drive the "current" swatch indicator). Mirrors the loader's
// readColorValue path but doesn't error on unsupported kinds —
// returns null for those.
// Render-time CSS for a fill value — drives the preview swatch and
// the "current" indicator dot in the palette. Mirrors the loader's
// `readColorValue` resolution: name_refs consult the merged
// (registry + source-declared) token map first, only falling back
// to `var(--name)` when the name isn't in the map. Without this
// lookup, source-declared tokens would paint as `var(--brand)`,
// which doesn't resolve to anything (no matching CSS variable).
export function readColorValueCss(
  v: Value,
  tokens: Record<string, string>,
): string | null {
  if (v.kind === 'name_ref') return tokens[v.name] ?? `var(--${v.name})`;
  if (v.kind === 'color_oklch') return `oklch(${v.l} ${v.c} ${v.h})`;
  if (v.kind === 'string') return v.value;
  return null;
}
