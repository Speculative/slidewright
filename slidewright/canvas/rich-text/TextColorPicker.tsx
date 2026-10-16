import { useMemo, useRef, useState, type RefObject } from 'react';
import { ColorPicker } from '../ColorPicker.js';
import { ColorPalette, ColorPopover, readColorValueCss } from '../ColorControls.js';
import { nameRef, stringLit } from '../../runtime/ast-builders.js';
import { parse } from '../../runtime/parser.js';
import type { SlideColor } from '../InspectorPanels.js';
import type { Value } from '../../runtime/ast.js';
import type { FormattingValue } from './feedback.js';
import type { TextStyleControls } from './FloatingToolbar.js';

export function TextColorPicker({ field, label, current, session, colorTokens, slideColors }: {
  field: 'color' | 'strokeColor'; label: string; current?: FormattingValue;
  session: RefObject<TextStyleControls | null>; colorTokens: Record<string, string>; slideColors: SlideColor[];
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const value = useMemo(() => {
    const text = String(current?.value ?? session.current?.selectionColor(field) ?? '');
    return Object.hasOwn(colorTokens, text) ? nameRef(text) : stringLit(text);
  }, [current, colorTokens, session, field]);
  const css = current?.mixed ? null : readColorValueCss(value, colorTokens);
  const sourceColor = (text: string): Value | null => {
    const result = parse(`Span { color: ${text} content: "" }`, '<text-color>');
    if (result.diagnostics.some(d => d.severity === 'error')) return null;
    const color = result.ast.items[0]?.fills.find(fill => fill.name === 'color')?.value;
    return color && ['color_oklch', 'name_ref', 'string'].includes(color.kind) ? color : null;
  };
  const apply = (text: string) => {
    const color = sourceColor(text);
    if (color) session.current?.formatColor(field, color);
  };
  return <>
    <button ref={anchor} type="button" className="sw-text-color-preview"
      aria-label={`${label} picker`} aria-expanded={open} aria-haspopup="dialog"
      title={current?.mixed ? 'Mixed colors' : css || 'Inherited color'}
      style={{ background: css || undefined }}
      onClick={() => setOpen(!open)}
      onKeyDown={event => {
        if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }} />
    {open && <ColorPopover anchorRef={anchor} textFormatting label={`${label} picker`}
      onRequestClose={reason => { setOpen(false); if (reason === 'escape') anchor.current?.focus(); }}>
      <ColorPicker value={value} colorTokens={colorTokens} onCommit={apply}
        onScrubBegin={() => session.current?.colorGesture('begin')}
        onScrubPreview={apply}
        onScrubEnd={text => {
          if (text !== null) apply(text);
          session.current?.colorGesture(text === null ? 'cancel' : 'commit');
        }} />
      <ColorPalette tokens={colorTokens} slideColors={slideColors} currentCss={css} onPick={apply} />
      <button type="button" onClick={() => session.current?.formatColor(field, null)}>Use inherited color</button>
    </ColorPopover>}
  </>;
}
