// Engine-private commands shared by the canvas session and browser probe.
import type { Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { baseKeymap, chainCommands, joinBackward, joinForward, selectNodeBackward, selectNodeForward, splitBlock } from 'prosemirror-commands';
import { closeHistory, undo, redo } from 'prosemirror-history';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';

export function structuralCommand(command: Command): Command {
  return (state, dispatch, view) => command(state, dispatch ? tr => dispatch(closeHistory(tr)) : undefined, view);
}

export function richTextKeys(schema: Schema): Record<string, Command> {
  const item = schema.nodes.list_item!;
  return {
    ...baseKeymap,
    Enter: structuralCommand(chainCommands(splitListItem(item), liftListItem(item), splitBlock)),
    'Shift-Enter': structuralCommand((state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break!.create(), true).scrollIntoView());
      return true;
    }),
    Tab: structuralCommand(sinkListItem(item)),
    'Shift-Tab': structuralCommand(liftListItem(item)),
    Backspace: structuralCommand(chainCommands(joinBackward, selectNodeBackward)),
    Delete: structuralCommand(chainCommands(joinForward, selectNodeForward)),
    'Mod-z': undo,
    'Mod-Shift-z': redo,
    'Mod-y': redo,
  };
}
