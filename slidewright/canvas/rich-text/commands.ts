// Engine-private commands shared by the canvas session and browser probe.
import { Fragment, type Schema, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import { baseKeymap, chainCommands, deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward, splitBlock } from 'prosemirror-commands';
import { closeHistory, undo, redo } from 'prosemirror-history';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { STYLE_FIELDS } from './projection.js';
import type { Value } from '../../runtime/ast.js';
import type { PARAGRAPH_FIELDS } from '../../runtime/contract.js';

export type ListStyle = 'disc' | 'circle' | 'square' | 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman';
export function setListStyle(style: ListStyle, start = 1): Command {
  return (state, dispatch, view) => {
    if (!Number.isSafeInteger(start) || start < 1) return false;
    const ordered = !['disc', 'circle', 'square'].includes(style);
    const type = state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list']!;
    const { $from, to } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (!['bullet_list', 'ordered_list'].includes(node.type.name)) continue;
      // A list control changes the containing List owner, not its children.
      if (to > $from.end(depth)) return false;
      if (dispatch) dispatch(closeHistory(state.tr.setNodeMarkup($from.before(depth), type, { ...node.attrs, style, start })));
      return true;
    }
    const range = $from.blockRange(state.selection.$to);
    if (!range || range.depth !== 0) return false;
    const paragraphs: PMNode[] = [];
    for (let index = range.startIndex; index < range.endIndex; index++) {
      const node = range.parent.child(index);
      if (node.type.name !== 'paragraph') return false;
      paragraphs.push(node);
    }
    if (dispatch) {
      const list = type.create({ style, start }, paragraphs.map(paragraph => state.schema.nodes.list_item!.create(null, paragraph)));
      const tr = closeHistory(state.tr.replaceWith(range.start, range.end, list));
      const map = (position: number) => {
        let offset = range.start;
        for (let index = 0; index < paragraphs.length; index++) {
          if (position < offset + paragraphs[index]!.nodeSize) return position + 2 + index * 2;
          offset += paragraphs[index]!.nodeSize;
        }
        return tr.mapping.map(position);
      };
      dispatch(tr.setSelection(TextSelection.create(tr.doc, map(state.selection.anchor), map(state.selection.head))).scrollIntoView());
    }
    return true;
  };
}

export function changeListDepth(direction: -1 | 1): Command {
  return (state, dispatch, view) => structuralCommand((direction < 0 ? liftListItem : sinkListItem)(state.schema.nodes.list_item!))(state, dispatch, view);
}

export type ParagraphField = typeof PARAGRAPH_FIELDS[number];
export function setParagraphStyle(field: ParagraphField, value: string | number | null): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = closeHistory(state.tr);
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'paragraph') {
        const next = value ?? (field === 'align' || field === 'lineHeight' ? null : 0);
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [field]: next });
        return false;
      }
    });
    if (dispatch) dispatch(tr);
    return true;
  };
}

export function setTextStyle(field: typeof STYLE_FIELDS[number], value: string | number | boolean | null, options: { authored?: Value; historyGroup?: number } = {}): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[field]!;
    const { from, to, empty } = state.selection;
    if (dispatch) {
      // Mark steps have empty position maps, so time alone cannot group them.
      // The private history adapter uses a composition group for one color drag.
      const tr = options.historyGroup === undefined ? closeHistory(state.tr) : state.tr.setMeta('composition', options.historyGroup);
      if (empty) value === null ? tr.removeStoredMark(type) : tr.addStoredMark(type.create({ value, authored: options.authored ?? null }));
      else value === null ? tr.removeMark(from, to, type) : tr.addMark(from, to, type.create({ value, authored: options.authored ?? null }));
      dispatch(tr);
    }
    return true;
  };
}

// Apply related fields in one transaction so a preset is one draft undo step.
export function setTextStyles(styles: Partial<Record<typeof STYLE_FIELDS[number], string | number | boolean | null>>): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = closeHistory(state.tr);
      const { from, to, empty } = state.selection;
      for (const [field, value] of Object.entries(styles)) {
        const type = state.schema.marks[field]!;
        if (empty) value === null ? tr.removeStoredMark(type) : tr.addStoredMark(type.create({ value }));
        else value === null ? tr.removeMark(from, to, type) : tr.addMark(from, to, type.create({ value }));
      }
      dispatch(tr);
    }
    return true;
  };
}

export const clearTextStyles: Command = (state, dispatch) => {
  if (dispatch) {
    const { from, to, empty } = state.selection;
    const tr = closeHistory(state.tr);
    for (const field of STYLE_FIELDS) {
      const type = state.schema.marks[field]!;
      if (empty) tr.removeStoredMark(type); else tr.removeMark(from, to, type);
    }
    dispatch(tr);
  }
  return true;
};

export function structuralCommand(command: Command): Command {
  return (state, dispatch, view) => command(state, dispatch ? tr => dispatch(closeHistory(tr)) : undefined, view);
}

// Generic joining wraps a paragraph after a list in a new ListItem. An
// empty paragraph should instead disappear, with the caret at the end of
// the preceding item (including its deepest nested child).
export const deleteEmptyParagraphAfterList: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false;
  const start = $from.before();
  const previous = state.doc.resolve(start).nodeBefore;
  if (!previous || !['bullet_list', 'ordered_list'].includes(previous.type.name)) return false;
  if (dispatch) {
    const tr = state.tr.delete(start, $from.after());
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(start), -1)).scrollIntoView());
  }
  return true;
};

// Generic block joining prefers wrapping a constrained ListItem into a
// nested list. Text items instead merge at the preceding text endpoint,
// preserving both lists when that endpoint is a nested item.
export function mergeListItems(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph' || $from.depth < 3) return false;
    const depth = $from.depth - 1;
    const current = $from.node(depth);
    if (current.type.name !== 'list_item' || $from.index(depth) !== 0 || $from.parentOffset !== (direction < 0 ? 0 : $from.parent.content.size)) return false;
    const list = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    if (direction < 0 && index === 0 || direction > 0 && (index + 1 === list.childCount || current.childCount > 1)) return false;
    const before = direction < 0 ? list.child(index - 1) : current;
    const after = direction < 0 ? current : list.child(index + 1);
    const start = direction < 0 ? $from.before(depth) - before.nodeSize : $from.before(depth);
    let cursor = start + 2 + before.firstChild!.content.size;
    function combine(item: PMNode, pos: number): PMNode {
      if (item.childCount === 1) {
        cursor = pos + 2 + item.firstChild!.content.size;
        return item.copy(Fragment.from([item.firstChild!.copy(item.firstChild!.content.append(after.firstChild!.content)), ...(after.childCount > 1 ? [after.child(1)] : [])]));
      }
      const children = item.child(1);
      let lastPos = pos + 1 + item.firstChild!.nodeSize + 1;
      const items: PMNode[] = [];
      children.forEach((child, offset, childIndex) => items.push(childIndex === children.childCount - 1 ? combine(child, lastPos + offset) : child));
      return item.copy(Fragment.from([item.firstChild!, children.copy(Fragment.from(items))]));
    }
    const merged = combine(before, start);
    if (dispatch) {
      const tr = state.tr.replaceWith(start, start + before.nodeSize + after.nodeSize, merged);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, cursor)).scrollIntoView());
    }
    return true;
  };
}

export function richTextKeys(schema: Schema): Record<string, Command> {
  const item = schema.nodes.list_item!;
  const toggle = (name: 'weight' | 'italic' | 'underline' | 'strikethrough', value: string | boolean): Command => (state, dispatch) => {
    const type = schema.marks[name]!;
    const { from, to, empty, $from } = state.selection;
    let active = type.isInSet(state.storedMarks ?? $from.marks())?.attrs.value === value;
    if (!empty) {
      active = true;
      state.doc.nodesBetween(from, to, node => { if (node.isInline && type.isInSet(node.marks)?.attrs.value !== value) active = false; });
    }
    if (dispatch) {
      const tr = state.tr;
      if (empty) active ? tr.removeStoredMark(type) : tr.addStoredMark(type.create({ value }));
      else active ? tr.removeMark(from, to, type) : tr.addMark(from, to, type.create({ value }));
      dispatch(tr);
    }
    return true;
  };
  return {
    ...baseKeymap,
    Enter: structuralCommand(chainCommands(splitListItem(item), liftListItem(item), splitBlock)),
    'Shift-Enter': structuralCommand((state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break!.create(), true).scrollIntoView());
      return true;
    }),
    Tab: structuralCommand(sinkListItem(item)),
    'Shift-Tab': structuralCommand(liftListItem(item)),
    Backspace: structuralCommand(chainCommands(deleteSelection, deleteEmptyParagraphAfterList, mergeListItems(-1), joinBackward, selectNodeBackward)),
    Delete: structuralCommand(chainCommands(deleteSelection, mergeListItems(1), joinForward, selectNodeForward)),
    'Mod-z': undo,
    'Mod-Shift-z': redo,
    'Mod-y': redo,
    'Mod-b': toggle('weight', '700'),
    'Mod-i': toggle('italic', true),
    'Mod-u': toggle('underline', true),
    'Mod-Shift-x': toggle('strikethrough', true),
  };
}
