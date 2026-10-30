import { useEffect, useState, type ReactNode } from 'react';
import { useComponentEditing, type ComponentEditing } from '../../../slidewright/runtime/component-editing.js';

/** A consumer of generic parameter write-back; no host/source-engine access. */
export function PanelTextEditor({ field, value, label, children }: {
  field: string; value: string; label: string; children: ReactNode;
}) {
  const editing = useComponentEditing();
  const [draft, setDraft] = useState<{ value: string; editor: ComponentEditing } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(null);
    setError('');
  }, [editing?.contextId]);
  const begin = () => {
    if (!editing) return;
    setError('');
    setDraft({ value, editor: editing });
  };
  const finish = () => {
    if (!draft) return;
    const result = draft.editor.updateParams({ [field]: draft.value });
    if (result.status === 'rejected') { setError(result.reason); return; }
    setDraft(null);
  };
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return <>
    {children}
    {editing && !draft && <button type="button" onPointerDown={stop} onDoubleClick={stop}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); begin(); }}
      style={{ position: 'absolute', right: 12, top: 12, fontSize: 18 }}>
      Edit {label}
    </button>}
    {draft && editing && <div data-sw-panel-editor onPointerDown={stop} onDoubleClick={stop} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish(); }
    }} style={{ position: 'absolute', inset: 0, zIndex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--uist-surface, #f9fafb)', borderRadius: 12 }}>
      <textarea autoFocus aria-label={`Edit ${label}`} value={draft.value} spellCheck={false}
        onChange={event => setDraft({ ...draft, value: event.currentTarget.value })}
        style={{ flex: 1, minHeight: 0, minWidth: 0, resize: 'none', font: 'inherit', color: 'inherit', whiteSpace: 'pre', overflow: 'auto' }} />
      <div style={{ display: 'flex', gap: 8, fontSize: 18 }}>
        <button type="button" onClick={finish}>Save {label}</button>
        <button type="button" onClick={() => { setError(''); setDraft(null); }}>Cancel</button>
      </div>
      {error && <div role="alert" style={{ fontSize: 18 }}>{error}</div>}
    </div>}
  </>;
}
