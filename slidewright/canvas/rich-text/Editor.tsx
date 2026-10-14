import { useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EditorState, TextSelection, Selection } from 'prosemirror-state';
import { EditorView, type NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { history, closeHistory } from 'prosemirror-history';
import type { Component, Value } from '../../runtime/ast.js';
import type { ComponentRegistry, OwnedInlineEditorMount } from '../../runtime/contract.js';
import type { Scope } from '../../runtime/scope.js';
import { renderEditorInline } from '../../runtime/loader.js';
import { STYLE_FIELDS, TextProjection } from './projection.js';
import { richTextKeys, setTextStyle, clearTextStyles } from './commands.js';
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
}
export type TextStyleField = typeof STYLE_FIELDS[number];

export interface TextSessionHandle {
  finish(intent: 'commit' | 'cancel'): void;
  range(): TextRange | null;
  format(field: TextStyleField, value: string | number | boolean | null): void;
  toggle(field: 'weight' | 'italic' | 'underline'): void;
  clearFormatting(): void;
}

function semanticDocument(doc: PMNode): string {
  return JSON.stringify(doc.toJSON(), (key, value) => {
    if (key === 'origin' || key === 'span' || key === 'bodySpan') return undefined;
    if (key === 'marks' && Array.isArray(value)) return value.filter(mark => mark.type !== 'source');
    return value;
  });
}

export function RichTextEditor({ snapshot, registry, onReady, onFinish }: {
  snapshot: TextEditorSnapshot;
  registry: ComponentRegistry;
  onReady(handle: TextSessionHandle | null): void;
  onFinish(intent: 'commit' | 'cancel', value: Value | undefined, changed: boolean): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onFinish });
  callbacks.current = { onReady, onFinish };
  useLayoutEffect(() => {
    const mount = container.current;
    if (!mount) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const start = () => {
      const projection = new TextProjection({ content: snapshot.content, registry, scope: snapshot.scope, colorTokens: snapshot.colorTokens });
      let closed = false;
      let composing = false;
      let pending: 'commit' | null = null;
      let compositionTimer: ReturnType<typeof setTimeout> | null = null;
      let view: EditorView;
      const finish = (intent: 'commit' | 'cancel') => {
        if (closed) return;
        if (intent === 'commit' && (composing || view.composing)) { pending = 'commit'; return; }
        closed = true;
        const changed = semanticDocument(view.state.doc) !== semanticDocument(projection.doc);
        const value = intent === 'commit' && changed ? projection.lower(view.state.doc) : undefined;
        callbacks.current.onFinish(intent, value, changed && value !== snapshot.content);
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
        state: EditorState.create({ doc: projection.doc, plugins: [history(), leafIdentityPlugin(), keymap(keys)] }), nodeViews,
        attributes: { role: 'textbox', 'aria-label': 'Edit text', 'aria-multiline': 'true' },
        dispatchTransaction(tr) { if (!closed) view.updateState(view.state.applyTransaction(tr).state); },
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
      const format = (field: TextStyleField, value: string | number | boolean | null) => {
        if (closed) return;
        setTextStyle(field, value)(view.state, tr => view.dispatch(tr));
      };
      callbacks.current.onReady({ finish,
        range: () => textRange(view.state.doc, view.state.selection.anchor, view.state.selection.head),
        format,
        toggle(field) {
          if (closed) return;
          keys[field === 'weight' ? 'Mod-b' : field === 'italic' ? 'Mod-i' : 'Mod-u']!(view.state, tr => view.dispatch(closeHistory(tr)), view);
          view.focus();
        },
        clearFormatting() { if (closed) return; clearTextStyles(view.state, tr => view.dispatch(tr)); view.focus(); },
      });
      return () => {
        closed = true;
        if (compositionTimer) clearTimeout(compositionTimer);
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
