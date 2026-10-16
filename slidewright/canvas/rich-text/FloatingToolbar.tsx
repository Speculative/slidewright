import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import type { SlideColor } from '../InspectorPanels.js';
import { commitOnTextBlur } from './focus.js';
import { TextColorPicker } from './TextColorPicker.js';
import { TEXT_PRESETS } from './presets.js';
import { FloatingSelectionToolbar } from '../FloatingSelectionToolbar.js';
import type { TextSessionHandle, TextStyleField } from './Editor.js';
import type { FormattingValue, TextFormattingState } from './feedback.js';

function StyleInput({ label, current, numeric, min, list, colorControl, apply }: {
  label: string; current?: FormattingValue; numeric?: boolean; min?: number; list?: string; colorControl?: ReactNode;
  apply(value: string | number | null): void;
}) {
  const authored = current?.value == null || current.mixed ? '' : String(current.value);
  const [value, setValue] = useState(authored);
  useLayoutEffect(() => setValue(authored), [authored]);
  const commit = () => {
    if (value === authored) return;
    const next = value.trim() === '' ? null : numeric ? Number(value) : value;
    if (typeof next === 'number' && (!Number.isFinite(next) || min !== undefined && next < min)) {
      setValue(authored); return;
    }
    apply(next);
  };
  return <div className="sw-floating-style-field"><span>{label}</span><span className="sw-text-style-input"><input aria-label={label} type={numeric ? 'number' : 'text'}
    min={min} step={numeric ? 'any' : undefined} list={list}
    value={value} placeholder={current?.mixed ? 'Mixed' : 'Inherited'}
    title="Enter to apply; empty restores inherited style"
    onChange={event => setValue(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />{colorControl}</span></div>;
}

export type TextStyleControls = Pick<TextSessionHandle, 'selectionBounds' | 'preset' | 'format' | 'toggle' | 'clearFormatting' | 'formatColor' | 'selectionColor' | 'colorGesture' | 'paragraph' | 'finish'>;

export function FloatingToolbar({ session, state, children, colorTokens, slideColors, label = 'Selection formatting' }: {
  session: RefObject<TextStyleControls | null>; label?: string; state: TextFormattingState | null; children: ReactNode; colorTokens: Record<string, string>; slideColors: SlideColor[];
}) {
  const inline = (field: TextStyleField, label: string, numeric = false, min?: number, list?: string) =>
    <StyleInput key={field} label={label} current={state?.inline[field]} numeric={numeric} min={min} list={list} colorControl={(field === 'color' || field === 'strokeColor') && <TextColorPicker field={field} label={label} current={state?.inline[field]} session={session} colorTokens={colorTokens} slideColors={slideColors} />}
      apply={value => session.current?.format(field, value)} />;
  return <FloatingSelectionToolbar bounds={() => session.current?.selectionBounds() ?? null} className="sw-floating-text-toolbar" data-sw-text-formatting
    aria-label={label}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); session.current?.finish('cancel'); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); session.current?.finish('commit'); }
    }}
    onBlur={event => {
      commitOnTextBlur(event.relatedTarget, () => session.current?.finish('commit'));
    }}>
    <div className="sw-floating-text-fields">
      <label>Text preset <select aria-label="Text preset" value={TEXT_PRESETS.find(preset =>
        (['font', 'size', 'weight'] as const).every(field => !state?.inline[field].mixed && String(state?.inline[field].value) === String(preset[field])))?.id ?? ''}
        onChange={event => {
          const preset = TEXT_PRESETS.find(preset => preset.id === event.target.value);
          if (preset) session.current?.preset(preset);
        }}>
        <option value="" disabled>Custom</option>
        {TEXT_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select></label>
      {inline('size', 'Font size', true, 1)}
      {inline('color', 'Foreground color')}
      {inline('strokeWidth', 'Stroke width', true, 0)}
      {inline('strokeColor', 'Stroke color')}
      <StyleInput label="Line height" current={state?.paragraph.lineHeight} numeric min={0.01}
        apply={value => session.current?.paragraph('lineHeight', value)} />
      {inline('letterSpacing', 'Letter spacing', true)}
    </div>
    {children}
  </FloatingSelectionToolbar>;
}
