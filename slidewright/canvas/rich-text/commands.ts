// Engine-private commands shared by the canvas session and browser probe.
import { Fragment, type Schema, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import { baseKeymap, chainCommands, deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward, splitBlock } from 'prosemirror-commands';
import { closeHistory, undo, redo } from 'prosemirror-history';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { STYLE_FIELDS } from './projection.js';

export function setTextStyle(field: typeof STYLE_FIELDS[number], value: string | number | boolean | null): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[field]!;
    const { from, to, empty } = state.selection;
    if (dispatch) {
      const tr = closeHistory(state.tr);
      if (empty) value === null ? tr.removeStoredMark(type) : tr.addStoredMark(type.create({ value }));
      else value === null ? tr.removeMark(from, to, type) : tr.addMark(from, to, type.create({ value }));
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
  const toggle = (name: 'weight' | 'italic' | 'underline', value: string | boolean): Command => (state, dispatch) => {
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
    Backspace: structuralCommand(chainCommands(deleteSelection, mergeListItems(-1), joinBackward, selectNodeBackward)),
    Delete: structuralCommand(chainCommands(deleteSelection, mergeListItems(1), joinForward, selectNodeForward)),
    'Mod-z': undo,
    'Mod-Shift-z': redo,
    'Mod-y': redo,
    'Mod-b': toggle('weight', '700'),
    'Mod-i': toggle('italic', true),
    'Mod-u': toggle('underline', true),
  };
}
