import { useLayoutEffect, useRef, useState } from 'react';
import type { Value } from '../runtime/ast.js';
import { nameRef, numberLit, stringLit } from '../runtime/ast-builders.js';
import { parse } from '../runtime/parser.js';
import type { ShapeData } from '../runtime/loader.js';
import { shapeStyleParam, type ShapeStyleField } from './shape-formatting.js';
import type { SlideColor } from './InspectorPanels.js';
import { ColorPalette, ColorPopover, readColorValueCss } from './ColorControls.js';
import { ColorPicker } from './ColorPicker.js';
import { FloatingSelectionToolbar } from './FloatingSelectionToolbar.js';
import { measureLayoutSnapshot } from './layout-measurement.js';

type Change = (field: ShapeStyleField, value: Value, preview: boolean) => void;

function ShapeColor({ label, value, mixed, colorTokens, slideColors, onChange, onGesture }: {
  label: string; value: Value; mixed: boolean; colorTokens: Record<string, string>; slideColors: SlideColor[];
  onChange(value: Value, preview: boolean): void;
  onGesture(phase: 'begin' | 'commit' | 'cancel'): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const gesture = useRef(false);
  // Pointer listeners outlive individual renders. Use current callbacks when
  // previewing locally and committing the final color at gesture end.
  const callbacks = useRef({ onChange, onGesture });
  callbacks.current = { onChange, onGesture };
  const authored = mixed ? '' : value.kind === 'name_ref' ? value.name : readColorValueCss(value, colorTokens) ?? '';
  useLayoutEffect(() => setDraft(authored), [authored]);
  const css = mixed ? null : readColorValueCss(value, colorTokens);
  const apply = (text: string) => {
    // Bare CSS strings and palette token references retain their source form.
    const result = parse(`Box { fill: ${text} }`, '<shape-color>');
    const color = result.ast.items[0]?.fills[0]?.value;
    if (!result.diagnostics.some(d => d.severity === 'error') && color &&
      ['color_oklch', 'name_ref', 'string'].includes(color.kind) &&
      (color.kind !== 'name_ref' || Object.hasOwn(colorTokens, color.name))) {
      callbacks.current.onChange(color, gesture.current);
    } else if (CSS.supports('color', text)) callbacks.current.onChange(stringLit(text), gesture.current);
    else setDraft(authored);
  };
  const commit = () => {
    if (!draft.trim()) setDraft(authored);
    else if (draft !== authored) apply(draft.trim());
  };
  return <div className="sw-floating-style-field"><span>{label}</span><span className="sw-text-style-input">
    <input aria-label={label} value={draft} placeholder={mixed ? 'Mixed' : undefined} spellCheck={false} onChange={event => setDraft(event.target.value)}
      onBlur={commit} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(authored); }
      }} />
    <button ref={anchor} type="button" className="sw-text-color-preview" aria-label={`${label} picker`}
      title={mixed ? 'Mixed colors' : css ?? undefined} aria-haspopup="dialog" aria-expanded={open} style={css ? { background: css } : undefined}
      onClick={() => setOpen(!open)} />
  </span>
    {open && <ColorPopover anchorRef={anchor} textFormatting label={`${label} picker`}
      onRequestClose={reason => { setOpen(false); if (reason === 'escape') anchor.current?.focus(); }}>
      <ColorPicker value={value} colorTokens={colorTokens} onCommit={apply}
        onScrubBegin={() => { gesture.current = true; callbacks.current.onGesture('begin'); }} onScrubPreview={apply}
        onScrubEnd={text => {
          if (text !== null) apply(text);
          gesture.current = false;
          callbacks.current.onGesture(text === null ? 'cancel' : 'commit');
        }} />
      <ColorPalette tokens={colorTokens} slideColors={slideColors} currentCss={css} onPick={apply} />
      <button type="button" onClick={() => onChange(stringLit('transparent'), false)}>No color</button>
    </ColorPopover>}
  </div>;
}

function StrokeWidth({ value, onChange }: { value: number | null; onChange(value: Value): void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useLayoutEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const commit = () => {
    if (value === null && draft.trim() === '') return;
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(next) || next < 0) { setDraft(value === null ? '' : String(value)); return; }
    if (next !== value) onChange(numberLit(next));
  };
  return <label>Stroke width<input type="number" aria-label="Stroke width" min={0} step="any" value={draft} placeholder={value === null ? 'Mixed' : undefined}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(value === null ? '' : String(value)); }
    }} /></label>;
}

function shapeBounds({ comp: component, params }: ShapeData): DOMRect | null {
  const span = { start: component.span.start.offset, end: component.span.end.offset };
  if (component.name !== 'Line' && component.name !== 'Arrow') {
    return measureLayoutSnapshot(span)?.layoutEl.getBoundingClientRect() ?? null;
  }
  // Line SVGs fill their parent; anchor to the endpoints rather than the SVG viewport.
  const svg = document.querySelector<SVGSVGElement>(`.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"] > svg`);
  const canvas = document.querySelector('.sw-canvas-stage .presentation-canvas');
  if (!svg || !canvas) return null;
  const frame = svg.getBoundingClientRect();
  const scale = canvas.getBoundingClientRect().width / 1920;
  const x1 = Number(params.x1 ?? 0), x2 = Number(params.x2 ?? 200);
  const y1 = Number(params.y1 ?? 0), y2 = Number(params.y2 ?? 200);
  return new DOMRect(frame.left + Math.min(x1, x2) * scale, frame.top + Math.min(y1, y2) * scale,
    Math.abs(x2 - x1) * scale, Math.abs(y2 - y1) * scale);
}

export function SelectedShapeToolbar({ shapes, colorTokens, slideColors, onChange, onColorGesture }: {
  shapes: ShapeData[]; colorTokens: Record<string, string>; slideColors: SlideColor[];
  onChange: Change; onColorGesture(phase: 'begin' | 'commit' | 'cancel'): void;
}) {
  const common = (field: ShapeStyleField) => shapes.every(shape => shapeStyleParam(shape, field) !== null);
  const colorField = (field: 'fill' | 'strokeColor', label: string, fallback: string) => {
    const colors = shapes.map(shape => {
      const param = shapeStyleParam(shape, field)!;
      return shape.comp.fills.find(fill => fill.name === param)?.value ??
        (Object.hasOwn(colorTokens, fallback) ? nameRef(fallback) : stringLit(String(shape.params[param] ?? `var(--${fallback})`)));
    });
    const key = (value: Value) => value.kind === 'name_ref' ? `token:${value.name}` : readColorValueCss(value, colorTokens);
    return <ShapeColor key={field} label={label} value={colors[0]!} mixed={colors.some(color => key(color) !== key(colors[0]!))}
      colorTokens={colorTokens} slideColors={slideColors}
      onChange={(value, preview) => onChange(field, value, preview)} onGesture={onColorGesture} />;
  };
  const widths = shapes.map(shape => Number(shape.params[shapeStyleParam(shape, 'strokeWidth')!] ?? 4));
  const bounds = () => {
    const rects = shapes.map(shapeBounds).filter((rect): rect is DOMRect => rect !== null);
    if (rects.length !== shapes.length) return null;
    return { left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)),
      top: Math.min(...rects.map(rect => rect.top)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
  };
  return <FloatingSelectionToolbar className="sw-floating-shape-toolbar" aria-label="Shape formatting"
    bounds={bounds} onKeyDown={event => event.stopPropagation()}>
    {shapes.length > 1 && <span aria-label="Formatting target">{shapes.length} shapes</span>}
    <div className="sw-floating-text-fields">
      {common('fill') && colorField('fill', 'Fill color', 'accent')}
      {common('strokeColor') && colorField('strokeColor', 'Stroke color', 'fg')}
      {common('strokeWidth') && <StrokeWidth value={widths.every(width => width === widths[0]) ? widths[0]! : null}
        onChange={value => onChange('strokeWidth', value, false)} />}
      {(['startHead', 'endHead'] as const).filter(common).map(field => {
        const heads = shapes.map(shape => String(shape.params[field] ?? (field === 'endHead' && shape.comp.name === 'Arrow' ? 'arrow' : 'none')));
        const mixed = heads.some(head => head !== heads[0]);
        return <label key={field}>{field === 'startHead' ? 'Start head' : 'End head'}
          <select aria-label={field === 'startHead' ? 'Start head' : 'End head'} value={mixed ? '' : heads[0]}
            onChange={event => onChange(field, stringLit(event.target.value), false)}>
            {mixed && <option value="" disabled>Mixed</option>}
            <option value="none">None</option><option value="arrow">Arrow</option><option value="circle">Circle</option>
          </select></label>;
      })}
    </div>
  </FloatingSelectionToolbar>;
}
