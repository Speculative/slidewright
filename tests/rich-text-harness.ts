// A browser probe of the private adapter before canvas integration.
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history } from 'prosemirror-history';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import { TextProjection } from '../slidewright/canvas/rich-text/projection';
import { richTextKeys } from '../slidewright/canvas/rich-text/commands';
import { listInputPlugin } from '../slidewright/canvas/rich-text/input';
import { parse } from '../slidewright/runtime/parser';
import { emit } from '../slidewright/runtime/emitter';
import { buildRegistry } from '../slidewright/runtime/contract';
import { slotFill } from '../slidewright/runtime/ast-builders';
import 'prosemirror-view/style/prosemirror.css';

const original = parse(`Document { content: [
  Paragraph { content: ["abc" Span { content: "DEF" weight: "700" color: accent } "ghi"] }
  List { style: "decimal" start: 3 items: [ListItem { content: ["first"] } ListItem { content: ["second"] }] }
  Paragraph { content: [Pill { content: ["pill"] } Formula { expression: "x + y" } term] }
] }`, 'probe.sw').ast;
const registry = buildRegistry({
  Pill: { slidewright: { produces: 'text', slots: { content: { type: 'text' } }, inlineEditing: { mode: 'transparent', contentSlot: 'content' } }, default: () => null },
  Formula: { slidewright: { produces: 'text', slots: {}, inlineEditing: { mode: 'owned' } }, default: () => null },
});
const projection = new TextProjection({ content: original.items[0]!.fills[0]!.value, registry, scope: { bindings: { term: 'shared term' } } });
const state = EditorState.create({ doc: projection.doc, plugins: [history(), listInputPlugin(), keymap(richTextKeys(projection.schema))] });
const output = document.querySelector('#source')!;
function update() {
  const value = projection.lower(view.state.doc);
  const comp = original.items[0]!;
  output.textContent = emit({ ...original, items: [{ ...comp, fills: [slotFill('content', value)] }] });
}
const view = new EditorView(document.querySelector('#editor'), { state,
  attributes: { role: 'textbox', 'aria-label': 'Rich text' },
  dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); update(); },
});
document.querySelector('#editor')!.setAttribute('style', 'width:800px;font-size:24px;line-height:1.4');
document.body.style.setProperty('--accent', '#0000ff');
update();
(window as unknown as { richTextProbe: unknown }).richTextProbe = {
  select(from: number, to = from) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))); view.focus(); },
  find(text: string, offset = 0) {
    let result = -1;
    view.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) result = pos + offset; });
    return result;
  },
  caret() { return view.state.selection.from; },
  clipboardRoundTrip() {
    const container = document.createElement('div');
    container.append(DOMSerializer.fromSchema(projection.schema).serializeFragment(view.state.doc.content));
    const doc = DOMParser.fromSchema(projection.schema).parse(container);
    return emit({ ...original, items: [{ ...original.items[0]!, fills: [slotFill('content', projection.lower(doc))] }] });
  },
};
