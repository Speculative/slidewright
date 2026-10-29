import { useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EditorState, TextSelection, Selection } from 'prosemirror-state';
import { EditorView, type NodeView } from 'prosemirror-view';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { history, closeHistory } from 'prosemirror-history';
import { buildTextStyle, type TextStyleProperty } from '../../runtime/text-builds.js';
import { isBuildAppearance, objectId, type BuildDirection } from '../../runtime/builds.js';
import { textRunId } from '../../runtime/text-runs.js';
import type { TextBuildDraft } from '../../runtime/text-build-edit.js';
import type { Component, Value } from '../../runtime/ast.js';
import type { ComponentRegistry, OwnedInlineEditorMount } from '../../runtime/contract.js';
import type { Scope } from '../../runtime/scope.js';
import { readColorValueCss } from '../ColorControls.js';
import { renderEditorInline } from '../../runtime/loader.js';
import { STYLE_FIELDS, TextProjection } from './projection.js';
import { richTextKeys, setTextStyle, setTextStyles, clearTextStyles, setParagraphStyle, type ParagraphField, setListStyle, changeListDepth, type ListStyle } from './commands.js';
import { listInputPlugin } from './input.js';
import type { TextPreset } from './presets.js';
import { formattingState, type TextFormattingState } from './feedback.js';
import { leafIdentityPlugin, textRange } from './selection.js';
import type { TextRange } from './bindings.js';
import 'prosemirror-view/style/prosemirror.css';

export interface TextEditorSnapshot {
  component: Component;
  content?: Value;
  source: string;
  slideIdx: number;
  scope: Scope;
  colorTokens: Record<string, string>;
  clientX: number;
  clientY: number;
  persistentRuns?: boolean;
  buildStyle?: { slide: Component; index: number; direction: BuildDirection };
  reservedRunIds?: readonly string[];
}
export type TextStyleField = typeof STYLE_FIELDS[number];

export interface TextSessionHandle {
  finish(intent: 'commit' | 'cancel'): void;
  range(): TextRange | null;
  selectionBounds(): { left: number; right: number; top: number; bottom: number } | null;
  format(field: TextStyleField, value: string | number | boolean | null): void;
  preset(preset: TextPreset): void;
  toggle(field: 'weight' | 'italic' | 'underline' | 'strikethrough'): void;
  clearFormatting(): void;
  keyframe(field: TextStyleField, pinned: boolean): void;
  formatColor(field: 'color' | 'strokeColor', value: Value | null): void;
  selectionColor(field: 'color' | 'strokeColor'): string;
  colorGesture(phase: 'begin' | 'commit' | 'cancel'): void;
  list(style: ListStyle, start: number): boolean;
  listDepth(direction: -1 | 1): boolean;
  paragraph(field: ParagraphField, value: string | number | null): void;
}

function semanticDocument(doc: PMNode, withoutStyles = false): string {
  if (withoutStyles) {
    const strip = (node: PMNode): PMNode => {
      const marks = node.marks.filter(mark => !['source', 'build_pin'].includes(mark.type.name) && !STYLE_FIELDS.includes(mark.type.name as TextStyleField));
      if (node.isText) return node.mark(marks);
      const children: PMNode[] = [];
      node.forEach(child => children.push(strip(child)));
      // Removing marks can rejoin adjacent text nodes. That segmentation is
      // formatting, not a wording or document-structure change.
      return node.copy(Fragment.fromArray(children)).mark(marks);
    };
    doc = strip(doc);
  }
  return JSON.stringify(doc.toJSON(), (key, value) => {
    if (key === 'origin' || key === 'span' || key === 'bodySpan') return undefined;
    if (key === 'marks' && Array.isArray(value)) return value.filter(mark => mark.type !== 'source' && !(withoutStyles && STYLE_FIELDS.includes(mark.type)));
    return value;
  });
}

export function RichTextEditor({ snapshot, registry, onReady, onFinish, onFormatting }: {
  snapshot: TextEditorSnapshot;
  registry: ComponentRegistry;
  onFormatting?(state: TextFormattingState): void;
  onReady(handle: TextSessionHandle | null): void;
  onFinish(intent: 'commit' | 'cancel', value: Value | undefined, changed: boolean, draft?: TextBuildDraft): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onFinish, onFormatting });
  callbacks.current = { onReady, onFinish, onFormatting };
  useLayoutEffect(() => {
    const mount = container.current;
    if (!mount) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const start = () => {
      const projection = new TextProjection({ content: snapshot.content, registry, scope: snapshot.scope, colorTokens: snapshot.colorTokens,
        persistentRuns: snapshot.persistentRuns, reservedRunIds: snapshot.reservedRunIds });
      let closed = false;
      let composing = false;
      let pending: 'commit' | null = null;
      let compositionTimer: ReturnType<typeof setTimeout> | null = null;
      let view: EditorView;
      let syncingSelection = false;
      const runTarget = (node: PMNode): string | undefined => {
        const source = node.marks.find(mark => mark.type.name === 'source');
        for (const id of [...(source?.attrs.ancestry ?? [])].reverse()) {
          const value = projection.origins.get(id)?.value;
          const run = value?.kind === 'component' && textRunId(value);
          if (run) return run;
        }
        return undefined;
      };
      const selectedLeaves = () => {
        const entries: { node: PMNode; from: number; to: number }[] = [];
        const { from, to, empty } = view.state.selection;
        if (!empty) view.state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isInline && (node.isText || node.isAtom)) entries.push({ node, from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize) });
        });
        return entries.filter(entry => entry.from < entry.to);
      };
      const reportFormatting = () => {
        const state = formattingState(view.state);
        const build = snapshot.buildStyle;
        const owner = objectId(snapshot.component);
        if (build && owner) {
          const leaves = selectedLeaves();
          state.keyframes = Object.fromEntries(STYLE_FIELDS.map(property => {
            const pins = leaves.map(({ node }) => {
              const target = runTarget(node);
              if (!target) return false;
              const staged = node.marks.find(mark => mark.type.name === 'build_pin')?.attrs.fields[property];
              if (staged !== undefined) return staged as boolean;
              const source = node.marks.find(mark => mark.type.name === 'source');
              const bound = projection.origins.get(source?.attrs.authoredId ?? source?.attrs.id);
              const current = node.marks.find(mark => mark.type.name === property)?.attrs.value;
              const before = bound?.styles?.[property]?.value;
              return current !== before || buildTextStyle(build.slide, build.index, owner, target, property, registry).keyframed;
            });
            return [property, { pinned: pins.some(Boolean) && !pins.every(Boolean) ? 'mixed' : pins.length > 0 && pins.every(Boolean),
              available: leaves.length > 0 && leaves.every(({ node }) => !!runTarget(node)), initial: build.index === 0,
              appearance: isBuildAppearance(build.slide, build.index, owner) }];
          }));
        }
        callbacks.current.onFormatting?.(state);
      };
      const clearOwnedSelection = () => {
        const selection = window.getSelection();
        if (selection && (mount.contains(selection.anchorNode) || mount.contains(selection.focusNode))) selection.removeAllRanges();
      };
      const finish = (intent: 'commit' | 'cancel') => {
        if (closed) return;
        if (intent === 'commit' && (composing || view.composing)) { pending = 'commit'; return; }
        closed = true;
        const changed = semanticDocument(view.state.doc) !== semanticDocument(projection.doc);
        const value = intent === 'commit' && changed ? projection.lower(view.state.doc) : undefined;
        clearOwnedSelection();
        callbacks.current.onFinish(intent, value, changed && value !== snapshot.content, {
          preparedContent: projection.preparedContent, runChanges: projection.runChanges, pins: projection.runPins,
          styleOnly: semanticDocument(view.state.doc, true) === semanticDocument(projection.doc, true),
        });
      };
      const nodeViews: Record<string, (node: PMNode, view: EditorView, getPos: () => number | undefined) => NodeView> = {};
      for (const type of Object.keys(projection.schema.nodes).filter(name => name.startsWith('inline_') || name === 'opaque_inline')) {
        nodeViews[type] = (initial, editor, getPos) => {
          let node = initial;
          let root: Root | null = null;
          let owned: ReturnType<OwnedInlineEditorMount> | null = null;
          const dom = document.createElement('span');
          const component = node.attrs.value as Component;
          const contract = registry[component.name]?.meta.inlineEditing;
          const transparent = contract?.mode === 'transparent';
          dom.dataset.swInlineType = component.name;
          if (!transparent) dom.contentEditable = 'false';
          const display = document.createElement('span');
          dom.append(display);
          let contentDOM: HTMLElement | undefined;
          function render() {
            const comp = node.attrs.value as Component;
            if (!registry[comp.name]) { display.textContent = comp.name; return; }
            root ??= createRoot(display);
            const hole = transparent ? <span ref={(element) => { if (element) contentDOM = element; }} /> : undefined;
            flushSync(() => root!.render(renderEditorInline({ component: comp, components: registry, scope: snapshot.scope, colorTokens: snapshot.colorTokens,
              ...(transparent ? { contentSlot: contract.contentSlot, content: hole } : {}),
            })));
            if (transparent && !contentDOM) throw new Error(`${comp.name} did not render its declared transparent content slot`);
          }
          // Editor setup runs after the parent's commit, so custom React
          // views can synchronously supply their ProseMirror content hole.
          render();
          const ownedHost = document.createElement('span');
          function exit(direction: -1 | 1) {
            owned?.destroy(); owned = null; ownedHost.remove();
            const pos = getPos();
            if (pos !== undefined) editor.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(direction < 0 ? pos : pos + node.nodeSize), direction)));
            editor.focus();
          }
          const activate = (event: MouseEvent) => {
            if (contract?.mode !== 'owned' || !contract.mount || owned) return;
            event.preventDefault(); event.stopPropagation();
            dom.append(ownedHost);
            owned = contract.mount(ownedHost, {
              component: structuredClone(node.attrs.value), exit,
              onChange(next) {
                if (next.name !== component.name) throw new Error('Owned editor must retain its component type');
                const pos = getPos();
                if (pos !== undefined) editor.dispatch(closeHistory(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: next })));
              },
            });
          };
          dom.addEventListener('dblclick', activate);
          return {
            dom, ...(transparent ? { contentDOM } : {}),
            update(next) {
              if (next.type !== node.type) return false;
              const changed = next.attrs.value !== node.attrs.value;
              node = next;
              if (changed) { render(); owned?.update?.(structuredClone(node.attrs.value)); }
              return true;
            },
            stopEvent(event) { return !!owned && ownedHost.contains(event.target as Node); },
            ignoreMutation(mutation) { return !transparent || (mutation.type !== 'selection' && !contentDOM?.contains(mutation.target)); },
            destroy() {
              dom.removeEventListener('dblclick', activate);
              owned?.destroy();
              // React forbids unmounting a nested root during the parent's
              // commit; the detached display can be cleaned next microtask.
              const oldRoot = root;
              queueMicrotask(() => oldRoot?.unmount());
            },
          };
        };
      }
      const keys = richTextKeys(projection.schema);
      keys['Mod-Enter'] = () => { finish('commit'); return true; };
      keys.Escape = () => { finish('cancel'); return true; };
      view = new EditorView(mount, {
        state: EditorState.create({ doc: projection.doc, plugins: [history(), leafIdentityPlugin(), listInputPlugin(), keymap(keys)] }), nodeViews,
        attributes: { role: 'textbox', 'aria-label': 'Edit text', 'aria-multiline': 'true' },
        dispatchTransaction(tr) {
          if (closed) return;
          const native = window.getSelection();
          const focused = document.activeElement;
          // ProseMirror intentionally leaves DOM selection alone when blurred.
          // Formatting can replace the selected text's mark wrappers, leaving
          // that live browser range expanded or collapsed on the old wrapper.
          const restore = tr.docChanged && !syncingSelection && !view.hasFocus() && native &&
            view.dom.contains(native.anchorNode) && view.dom.contains(native.focusNode);
          view.updateState(view.state.applyTransaction(tr).state);
          if (restore) {
            syncingSelection = true;
            try {
              const { anchor, head } = view.state.selection;
              const start = view.domAtPos(anchor), end = view.domAtPos(head);
              native.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
              // Some browsers focus contenteditable when its selection moves.
              if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
            } finally { syncingSelection = false; }
          }
          reportFormatting();
        },
        handleDOMEvents: {
          blur(_view, event) {
            const next = (event as FocusEvent).relatedTarget;
            if (!(next instanceof Node) || (!mount.contains(next) && !(next instanceof Element && next.closest('[data-sw-text-formatting]')))) finish('commit');
            return false;
          },
          compositionstart() { composing = true; return false; },
          compositionend() {
            composing = false;
            if (pending) compositionTimer = setTimeout(() => { pending = null; finish('commit'); }, 60);
            return false;
          },
        },
      });
      // Retain the source styling on the surrounding TextBox. ProseMirror
      // owns only the editable island and inherits those defaults.
      view.dom.style.minHeight = '1em';
      view.dom.style.outline = 'none';
      const caret = view.posAtCoords({ left: snapshot.clientX, top: snapshot.clientY });
      if (caret) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(caret.pos))));
      view.focus();
      reportFormatting();
      let colorGesture: { before: EditorState; group: number } | null = null;
      let nextColorGroup = Date.now();
      const format = (field: TextStyleField, value: string | number | boolean | null) => {
        if (closed) return;
        setTextStyle(field, value)(view.state, tr => view.dispatch(tr));
      };
      callbacks.current.onReady({ finish,
        preset({ font, size, weight }) {
          if (!closed) setTextStyles({ font, size, weight })(view.state, tr => view.dispatch(tr));
        },
        selectionColor(field) {
          if (closed) return '';
          const node = view.domAtPos(view.state.selection.from).node;
          const element = node instanceof Element ? node : node.parentElement;
          if (!element) return '';
          return getComputedStyle(element).getPropertyValue(field === 'color' ? 'color' : '-webkit-text-stroke-color');
        },
        formatColor(field, value) {
          if (closed) return;
          const css = value === null ? null : readColorValueCss(value, snapshot.colorTokens);
          if (value !== null && css === null) return;
          setTextStyle(field, css, { ...(value ? { authored: value } : {}), ...(colorGesture ? { historyGroup: colorGesture.group } : {}) })(view.state, tr => view.dispatch(tr));
        },
        colorGesture(phase) {
          if (closed) return;
          if (phase === 'begin') {
            colorGesture = { before: view.state, group: ++nextColorGroup };
            view.dispatch(closeHistory(view.state.tr));
          } else {
            if (phase === 'cancel' && colorGesture) {
              view.updateState(colorGesture.before);
              reportFormatting();
            } else view.dispatch(closeHistory(view.state.tr));
            colorGesture = null;
          }
        },
        selectionBounds() {
          if (closed) return null;
          const { from, to } = view.state.selection;
          const start = view.coordsAtPos(from), end = view.coordsAtPos(to);
          return { left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
        },
        range: () => textRange(view.state.doc, view.state.selection.anchor, view.state.selection.head),
        format,
        list(style, start) { return !closed && setListStyle(style, start)(view.state, tr => view.dispatch(tr), view); },
        listDepth(direction) { if (closed) return false; const changed = changeListDepth(direction)(view.state, tr => view.dispatch(tr), view); view.focus(); return changed; },
        paragraph(field, value) { if (!closed) setParagraphStyle(field, value)(view.state, tr => view.dispatch(tr)); },
        toggle(field) {
          if (closed) return;
          keys[field === 'weight' ? 'Mod-b' : field === 'italic' ? 'Mod-i' : field === 'underline' ? 'Mod-u' : 'Mod-Shift-x']!(view.state, tr => view.dispatch(closeHistory(tr)), view);
          view.focus();
        },
        keyframe(field, pinned) {
          if (closed || !snapshot.buildStyle || snapshot.buildStyle.index === 0) return;
          const owner = objectId(snapshot.component);
          if (!owner) return;
          let tr = closeHistory(view.state.tr);
          for (const { node, from, to } of selectedLeaves()) {
            const run = runTarget(node);
            if (!run) continue;
            const fields = { ...node.marks.find(mark => mark.type.name === 'build_pin')?.attrs.fields, [field]: pinned };
            if (!pinned) {
              const inherited = buildTextStyle(snapshot.buildStyle.slide, snapshot.buildStyle.index - 1, owner, run, field, registry).value;
              tr = tr.removeMark(from, to, projection.schema.marks[field]);
              if (inherited) {
                const value = field === 'color' || field === 'strokeColor' ? readColorValueCss(inherited, snapshot.colorTokens)
                  : inherited.kind === 'name_ref' ? inherited.name
                  : inherited.kind === 'string' || inherited.kind === 'number' || inherited.kind === 'boolean' ? inherited.value : null;
                if (value !== null) tr = tr.addMark(from, to, projection.schema.marks[field]!.create({ value, authored: inherited }));
              }
            }
            tr = tr.addMark(from, to, projection.schema.marks.build_pin!.create({ fields }));
          }
          view.dispatch(tr);
        },
        clearFormatting() { if (closed) return; clearTextStyles(view.state, tr => view.dispatch(tr)); view.focus(); },
      });
      return () => {
        closed = true;
        if (compositionTimer) clearTimeout(compositionTimer);
        clearOwnedSelection();
        view.destroy();
        callbacks.current.onReady(null);
      };
    };
    // Finish React's commit before synchronous custom-node rendering.
    // This also makes StrictMode's discarded setup a harmless no-op.
    queueMicrotask(() => {
      if (disposed) return;
      try { cleanup = start(); }
      catch { callbacks.current.onFinish('cancel', undefined, false); }
    });
    return () => { disposed = true; cleanup?.(); };
  }, [snapshot, registry]);
  return <div ref={container} className="sw-rich-text-editor"
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} />;
}
