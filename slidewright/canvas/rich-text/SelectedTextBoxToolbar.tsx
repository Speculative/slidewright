import { useMemo, useRef } from 'react';
import { AllSelection, EditorState, type Command } from 'prosemirror-state';
import type { Component, Value } from '../../runtime/ast.js';
import type { ComponentRegistry } from '../../runtime/contract.js';
import type { Scope } from '../../runtime/scope.js';
import type { SlideColor } from '../InspectorPanels.js';
import { measureLayoutSnapshot } from '../layout-measurement.js';
import { readColorValueCss } from '../ColorControls.js';
import { TextProjection } from './projection.js';
import { formattingState } from './feedback.js';
import { clearTextStyles, setParagraphStyle, setTextStyle } from './commands.js';
import { FloatingToolbar, type TextStyleControls } from './FloatingToolbar.js';
import { TextStyleButtons } from './FormattingToolbar.js';
import type { TextStyleField } from './Editor.js';

const defaults = { font: 'font', size: 'fontSize', weight: 'fontWeight', color: 'color', letterSpacing: 'letterSpacing' } as const;
export type WholeTextChange = { content: Value; field?: string; value?: string | number | boolean | Value | null };

// Reuse the private projection without mounting an editable DOM island. A
// whole-box command selects every block and lowers through the same origins
// as a text session, preserving custom inline ownership and authored content.
export function SelectedTextBoxToolbar({ component, params, scope, registry, colorTokens, slideColors, onChange, onColorGesture }: {
  component: Component; params: Record<string, unknown>; scope: Scope; registry: ComponentRegistry;
  colorTokens: Record<string, string>; slideColors: SlideColor[];
  onChange(change: WholeTextChange, preview: boolean): void;
  onColorGesture(phase: 'begin' | 'commit' | 'cancel'): void;
}) {
  const projection = useMemo(() => new TextProjection({ content: component.fills.find(fill => fill.name === 'content')?.value, scope, registry, colorTokens }), [component, scope, registry, colorTokens]);
  const state = EditorState.create({ schema: projection.schema, doc: projection.doc, selection: new AllSelection(projection.doc) });
  const color = component.fills.find(fill => fill.name === 'color')?.value;
  const feedback = formattingState(state, { ...Object.fromEntries(Object.entries(defaults).map(([field, name]) => [field, params[name]])), color: color?.kind === 'name_ref' ? color.name : params.color, lineHeight: params.lineHeight, align: params.align });
  const gesture = useRef(false);
  const session = useRef<TextStyleControls | null>(null);
  function apply(command: Command, field?: string, value?: WholeTextChange['value']) {
    command(state, tr => onChange({ content: projection.lower(state.apply(tr).doc), field, value }, gesture.current));
  }
  function format(field: TextStyleField, value: string | number | boolean | null) {
    const name = defaults[field as keyof typeof defaults];
    // Box defaults also style empty paragraphs and future typing. Remove
    // inline overrides for this field so every existing run follows them.
    apply(setTextStyle(field, name ? null : value), name, value);
  }
  session.current = {
    selectionBounds: () => measureLayoutSnapshot({ start: component.span.start.offset, end: component.span.end.offset })?.layoutEl.getBoundingClientRect() ?? null,
    finish() {},
    format,
    toggle(field) {
      const current = feedback.inline[field];
      const enabled = !current.mixed && (field === 'weight' ? String(current.value) === '700' : current.value === true);
      format(field, field === 'weight' ? enabled ? '400' : '700' : !enabled);
    },
    clearFormatting: () => apply(clearTextStyles),
    paragraph(field, value) {
      apply(setParagraphStyle(field, field === 'lineHeight' ? null : value), field === 'lineHeight' ? field : undefined, value);
    },
    selectionColor: field => String(feedback.inline[field].value ?? params.color ?? ''),
    formatColor(field, value) {
      const css = value === null ? null : readColorValueCss(value, colorTokens);
      if (value !== null && css === null) return;
      apply(setTextStyle(field, field === 'color' ? null : css, value ? { authored: value } : {}), field === 'color' ? field : undefined, value);
    },
    colorGesture(phase) {
      gesture.current = phase === 'begin';
      onColorGesture(phase);
    },
  };
  return <FloatingToolbar session={session} state={feedback} colorTokens={colorTokens} slideColors={slideColors} label="TextBox formatting">
    <span aria-label="Formatting target">Whole text box</span>
    <TextStyleButtons session={session} state={feedback} />
  </FloatingToolbar>;
}
