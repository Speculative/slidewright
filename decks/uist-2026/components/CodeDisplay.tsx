import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { InitialDebuggerCode } from './InitialDebuggerCode.js';
import { useComponentEditing } from '../../../slidewright/runtime/component-editing.js';
import { useContext, useState } from 'react';
import { TextDocumentEditorContext } from '../../../slidewright/canvas/text-document-context.js';
import { codeDocumentLines } from './code-document.js';

/** Source-backed Python panel; line emphasis uses one-based displayed numbers. */
export const slidewright: ComponentMeta = {
  produces: 'block', slots: { content: { type: 'text-document' } },
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 1720 },
    height: { type: 'number', default: 740 },
    code: { type: 'string', default: '' },
    fontSize: { type: 'number', default: 40 },
    highlightedLines: { type: 'array<number>', default: [] },
  },
  editor: { inspector: ['x', 'y', 'width', 'height', 'content', 'fontSize', 'highlightedLines'] },
  editing: { params: ['highlightedLines'], text: { fallbackParam: 'code', mode: 'lines' } },
};

export const canvas = makeRectAdapter({ width: 1720, height: 740 });

export default function CodeDisplay({ params, slots, slotsState }: ComponentRenderProps) {
  const editing = useComponentEditing();
  const editor = useContext(TextDocumentEditorContext);
  const [error, setError] = useState('');
  const document = slotsState.content === 'filled' ? codeDocumentLines(slots.content) : undefined;
  const lines = document ? document.map(line => line.text) : String(params.code).split('\n');
  const highlightedLines = (params.highlightedLines as number[]).map(line => line - 1);
  const width = Number(params.width), height = Number(params.height);
  // Fit independently of neighboring panels so the object can be narrowed
  // for a terminal/inspector without changing the authored code or font size.
  const fontSize = Math.max(1, Math.min(Number(params.fontSize),
    (width - 64) / (Math.max(1, ...lines.map(line => line.length)) + String(lines.length).length + 1) / .62,
    (height - 56) / lines.length / 1.625));
  return <div data-sw-code-display aria-label="Python code" style={{
    position: 'absolute', left: Number(params.x), top: Number(params.y), width, height,
    boxSizing: 'border-box', padding: '28px 32px', overflow: 'auto',
    border: '1px solid var(--uist-rule, #ddd)', borderRadius: 12,
    background: 'var(--uist-surface, #f9fafb)',
    fontFamily: 'var(--font-mono, monospace)', fontSize, lineHeight: 1.625,
  }}>
    <div data-sw-text-document style={{ whiteSpace: 'pre', overflowWrap: 'normal', minHeight: '1.625em' }}>
      {editor ?? <InitialDebuggerCode lines={lines} lineContent={document?.map(line => line.content)} highlightedLines={highlightedLines} colorfulSyntax onToggleLine={editing ? line => {
        const result = editing.updateParams(current => {
          const selected = current.highlightedLines as readonly number[];
          return { highlightedLines: selected.includes(line) ? selected.filter(value => value !== line) : [...selected, line].sort((a, b) => a - b) };
        });
        setError(result.status === 'rejected' ? result.reason : '');
      } : undefined} />}
    </div>
    {editing?.editText && <button type="button" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); editing.editText?.(); }} style={{ position: 'absolute', top: 8, right: 12, fontSize: 18 }}>Edit code</button>}
    {error && <div role="alert" style={{ fontSize: 18 }}>{error}</div>}
  </div>;
}
