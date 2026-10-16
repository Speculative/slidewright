import type { EditorState } from 'prosemirror-state';
import { PARAGRAPH_FIELDS } from '../../runtime/contract.js';
import { STYLE_FIELDS } from './projection.js';

export interface FormattingValue { mixed: boolean; value: string | number | boolean | null }
export interface TextFormattingState {
  caret: boolean;
  inline: Record<typeof STYLE_FIELDS[number], FormattingValue>;
  paragraph: Record<typeof PARAGRAPH_FIELDS[number], FormattingValue>;
  list: { style: string; start: number } | null;
}
const common = (values: FormattingValue['value'][]): FormattingValue => ({
  mixed: values.some(value => value !== values[0]), value: values[0] ?? null,
});

// Positions and marks stay private; consumers receive authored style values.
export function formattingState(state: EditorState, defaults: Record<string, unknown> = {}): TextFormattingState {
  const { from, to, empty, $from } = state.selection;
  const marks = empty ? [state.storedMarks ?? $from.marks()] : [];
  const paragraphs: Record<string, unknown>[] = [];
  state.doc.nodesBetween(from, to, node => {
    if (node.isInline && !empty) marks.push(node.marks);
    if (node.type.name === 'paragraph') paragraphs.push(node.attrs);
  });
  const inline = Object.fromEntries(STYLE_FIELDS.map(field => [field, common((marks.length ? marks : [[]]).map(group => {
    const mark = group.find(mark => mark.type.name === field);
    const authored = mark?.attrs.authored;
    return authored?.kind === 'name_ref' ? authored.name : mark?.attrs.value ?? (defaults[field] as FormattingValue['value']) ?? null;
  }))])) as TextFormattingState['inline'];
  const paragraph = Object.fromEntries(PARAGRAPH_FIELDS.map(field => [field, common(paragraphs.map(attrs => (attrs[field] ?? defaults[field]) as FormattingValue['value']))])) as TextFormattingState['paragraph'];
  let list: TextFormattingState['list'] = null;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (['bullet_list', 'ordered_list'].includes(node.type.name)) { list = { style: node.attrs.style, start: node.attrs.start }; break; }
  }
  return { caret: empty, inline, paragraph, list };
}
