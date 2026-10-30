import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { useContext, type ReactNode } from 'react';
import { TextDocumentEditorContext } from '../../../slidewright/canvas/text-document-context.js';
import { useComponentEditing } from '../../../slidewright/runtime/component-editing.js';
import { codeDocumentLines } from './code-document.js';

/** Reusable, source-backed terminal transcript. */
export const slidewright: ComponentMeta = {
  produces: 'block', slots: { content: { type: 'text-document' } },
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 590 },
    height: { type: 'number', default: 320 },
    title: { type: 'string', default: 'Terminal' },
    fontSize: { type: 'number', default: 28 },
  },
  editor: { inspector: ['x', 'y', 'width', 'height', 'content', 'title', 'fontSize'] },
  editing: { params: ['title'], text: { mode: 'lines' } },
};

export const canvas = makeRectAdapter({ width: 590, height: 320 });

export default function TerminalDisplay({ params, slots, slotsState }: ComponentRenderProps) {
  const editor = useContext(TextDocumentEditorContext);
  const editing = useComponentEditing();
  const lines = codeDocumentLines(slotsState.content === 'filled' ? slots.content as ReactNode : '');
  return <div data-sw-terminal-display style={{
    position: 'absolute', left: Number(params.x), top: Number(params.y),
    width: Number(params.width), height: Number(params.height), display: 'flex',
    fontFamily: 'var(--font-mono, monospace)', fontSize: Number(params.fontSize), lineHeight: 1.625,
  }}>
    <div aria-label="Demo terminal" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: 16, borderRadius: 12, background: 'var(--uist-surface, #111827)', color: 'var(--uist-ink, #4ade80)' }}>
      {params.title ? <strong>{String(params.title)}</strong> : null}
      <div data-sw-text-document style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: '1.625em' }}>{editor ?? lines.map((line, index) => <div key={index} data-sw-terminal-line style={{ minHeight: '1.625em' }}>{line.content}</div>)}</div>
    </div>
    {editing?.editText && <button type="button" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); editing.editText?.(); }} style={{ position: 'absolute', top: 8, right: 12, fontSize: 18 }}>Edit output</button>}
  </div>;
}
