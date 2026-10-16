// Engine-private typing shortcuts for structured TextBox documents.
import { Plugin, PluginKey } from 'prosemirror-state';
import { findWrapping } from 'prosemirror-transform';
import { closeHistory } from 'prosemirror-history';

export function listInputPlugin(): Plugin {
  const key = new PluginKey<number | null>('listInput');
  return new Plugin({
    key,
    state: {
      init: () => null,
      apply(tr, pending) {
        const next = tr.getMeta(key);
        if (next !== undefined) return next;
        return tr.docChanged || tr.selectionSet ? null : pending;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (view.composing) return false;
        const { state } = view;
        // Accept the customary space after a marker even though conversion
        // already happened as soon as the marker was complete.
        if (key.getState(state) === from && from === to && text === ' ') {
          view.dispatch(state.tr.setMeta(key, null));
          return true;
        }
        const $from = state.doc.resolve(from);
        // Only ordinary document paragraphs own this shortcut. Inline
        // components and existing list items retain their own content.
        if ($from.depth !== 1 || $from.parent.type.name !== 'paragraph' || !$from.sameParent(state.doc.resolve(to))) return false;
        const prefix = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc') + text;
        const match = /^(\*|\d+\.)( ?)$/.exec(prefix);
        if (!match) return false;
        const start = match[1] === '*' ? 1 : Number(match[1]!.slice(0, -1));
        if (!Number.isSafeInteger(start) || start < 1) return false;
        const type = state.schema.nodes[match[1] === '*' ? 'bullet_list' : 'ordered_list']!;
        const tr = state.tr.delete($from.start(), to);
        const range = tr.selection.$from.blockRange();
        const wrapping = range && findWrapping(range, type, { start });
        if (!range || !wrapping) return false;
        tr.wrap(range, wrapping);
        if (!match[2]) tr.setMeta(key, tr.selection.from);
        view.dispatch(closeHistory(tr).scrollIntoView());
        return true;
      },
    },
  });
}
