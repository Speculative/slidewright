import { useMemo, useRef } from 'react';
import { AllSelection, EditorState, type Command } from 'prosemirror-state';
import type { Value } from '../../runtime/ast.js';
import type { ShapeData } from '../../runtime/loader.js';
import type { SourceRange } from '../host.js';
import type { ComponentRegistry } from '../../runtime/contract.js';
import type { Scope } from '../../runtime/scope.js';
import type { SlideColor } from '../InspectorPanels.js';
import { measureLayoutSnapshot } from '../layout-measurement.js';
import { readColorValueCss } from '../ColorControls.js';
import { TextProjection } from './projection.js';
import { formattingState, type FormattingValue, type TextFormattingState } from './feedback.js';
import { clearTextStyles, setParagraphStyle, setTextStyle, setTextStyles } from './commands.js';
import { FloatingToolbar, type TextStyleControls } from './FloatingToolbar.js';
import { TextStyleButtons } from './FormattingToolbar.js';
import { BuildFormattingKeyframe, BuildFormattingScope } from '../build-inspector.js';
import type { TextStyleField } from './Editor.js';

const defaults = { font: 'font', size: 'fontSize', weight: 'fontWeight', color: 'color', letterSpacing: 'letterSpacing' } as const;
const inlineProperties: Record<string, string> = Object.fromEntries(Object.entries(defaults).map(([style, property]) => [property, style]));

/** Remove only the inline override owned by a whole-box property. Reuse the
 * projection contract so opaque/custom inline values retain their ownership. */
export function clearWholeTextProperty(content: Value | undefined, property: string,
  input: { scope: Scope; registry: ComponentRegistry; colorTokens: Record<string, string> }): Value | undefined {
  if (!content) return content;
  const projection = new TextProjection({ content, ...input });
  const state = EditorState.create({ schema: projection.schema, doc: projection.doc, selection: new AllSelection(projection.doc) });
  const style = inlineProperties[property];
  const command = style ? setTextStyle(style as TextStyleField, null)
    : property === 'lineHeight' ? setParagraphStyle('lineHeight', null) : null;
  let value = content;
  command?.(state, tr => { value = projection.lower(state.apply(tr).doc); });
  return value;
}
export type WholeTextChange = { target: SourceRange; content: Value; defaults?: Record<string, string | number>; field?: string; value?: string | number | boolean | Value | null };

// Reuse the private projection without mounting an editable DOM island. A
// whole-box command selects every block and lowers through the same origins
// as a text session, preserving custom inline ownership and authored content.
export function SelectedTextBoxToolbar({ shapes, scope, registry, colorTokens, slideColors, onChange, onColorGesture }: {
  shapes: ShapeData[]; scope: Scope; registry: ComponentRegistry;
  colorTokens: Record<string, string>; slideColors: SlideColor[];
  onChange(changes: WholeTextChange[], preview: boolean): void;
  onColorGesture(phase: 'begin' | 'commit' | 'cancel'): void;
}) {
  const boxes = useMemo(() => shapes.map(({ comp: component, params }) => {
    const projection = new TextProjection({ content: component.fills.find(fill => fill.name === 'content')?.value, scope, registry, colorTokens });
    const state = EditorState.create({ schema: projection.schema, doc: projection.doc, selection: new AllSelection(projection.doc) });
    const color = component.fills.find(fill => fill.name === 'color')?.value;
    const feedback = formattingState(state, { ...Object.fromEntries(Object.entries(defaults).map(([field, name]) => [field, params[name]])), color: color?.kind === 'name_ref' ? color.name : params.color, lineHeight: params.lineHeight, align: params.align });
    return { component, projection, state, feedback };
  }), [shapes, scope, registry, colorTokens]);
  const combine = (values: FormattingValue[]): FormattingValue => ({
    value: values[0]!.value,
    mixed: values.some(value => value.mixed || value.value !== values[0]!.value),
  });
  const merge = <K extends keyof TextFormattingState['inline'] | keyof TextFormattingState['paragraph']>(
    fields: Record<K, FormattingValue>, read: (box: typeof boxes[number], field: K) => FormattingValue,
  ) => Object.fromEntries((Object.keys(fields) as K[]).map(field => [field, combine(boxes.map(box => read(box, field)))])) as Record<K, FormattingValue>;
  const feedback: TextFormattingState = {
    caret: false,
    inline: merge(boxes[0]!.feedback.inline, (box, field) => box.feedback.inline[field]),
    paragraph: merge(boxes[0]!.feedback.paragraph, (box, field) => box.feedback.paragraph[field]),
    list: null,
  };
  const gesture = useRef(false);
  const session = useRef<TextStyleControls | null>(null);
  function apply(command: Command, field?: string, value?: WholeTextChange['value'], boxDefaults?: WholeTextChange['defaults']) {
    const changes: WholeTextChange[] = [];
    for (const { component, state, projection } of boxes) {
      command(state, tr => changes.push({
        target: { start: component.span.start.offset, end: component.span.end.offset },
        content: projection.lower(state.apply(tr).doc), field, value, defaults: boxDefaults,
      }));
    }
    if (changes.length) onChange(changes, gesture.current);
  }
  function format(field: TextStyleField, value: string | number | boolean | null) {
    const name = defaults[field as keyof typeof defaults];
    // Box defaults also style empty paragraphs and future typing. Remove
    // inline overrides for this field so every existing run follows them.
    apply(setTextStyle(field, name ? null : value), name, value);
  }
  session.current = {
    selectionBounds() {
      const rects = boxes.map(({ component }) => measureLayoutSnapshot({ start: component.span.start.offset, end: component.span.end.offset })?.layoutEl.getBoundingClientRect());
      if (rects.some(rect => !rect)) return null;
      return { left: Math.min(...rects.map(rect => rect!.left)), right: Math.max(...rects.map(rect => rect!.right)),
        top: Math.min(...rects.map(rect => rect!.top)), bottom: Math.max(...rects.map(rect => rect!.bottom)) };
    },
    finish() {},
    format,
    preset({ font, size, weight }) {
      apply(setTextStyles({ font: null, size: null, weight: null }), undefined, undefined, { font, fontSize: size, fontWeight: weight });
    },
    toggle(field) {
      const current = feedback.inline[field];
      const enabled = !current.mixed && (field === 'weight' ? String(current.value) === '700' : current.value === true);
      format(field, field === 'weight' ? enabled ? '400' : '700' : !enabled);
    },
    clearFormatting: () => apply(clearTextStyles),
    paragraph(field, value) {
      apply(setParagraphStyle(field, field === 'lineHeight' ? null : value), field === 'lineHeight' ? field : undefined, value);
    },
    selectionColor: field => String(feedback.inline[field].value ?? ''),
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
  const owners = shapes.map(shape => shape.comp);
  const keyframe = (field: string) => {
    const property = field === 'lineHeight' ? field : defaults[field as keyof typeof defaults];
    return property ? <BuildFormattingKeyframe owners={owners} property={property} label={field} /> : null;
  };
  return <FloatingToolbar session={session} state={feedback} colorTokens={colorTokens} slideColors={slideColors} label="TextBox formatting" keyframe={keyframe}>
    <span aria-label="Formatting target">{shapes.length === 1 ? 'Whole text box' : `${shapes.length} text boxes`}</span>
    <BuildFormattingScope />
    <TextStyleButtons session={session} state={feedback} keyframe={keyframe} />
    <BuildFormattingKeyframe owners={owners} property="content" label="content" caption="Text & inline styles" />
  </FloatingToolbar>;
}
