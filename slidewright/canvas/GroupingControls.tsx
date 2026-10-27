import type { SourceChange } from '../runtime/document.js';
import { Group, Ungroup } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ShapeData } from '../runtime/loader.js';
import type { SelectionTarget } from './selection-target.js';
import type { SourceRange } from './host.js';
import { editGrouping, groupingAvailability } from './grouping.js';
import { spanKey } from './gesture-context.js';
import { isLayoutAdapter } from './layout-adapter.js';

export function GroupingControls({ source, selected, shapes, disabled, onCommit }: {
  source: string;
  selected: readonly SelectionTarget[];
  shapes: ReadonlyMap<string, ShapeData>;
  disabled: boolean;
  onCommit(source: string, selections?: SourceRange[], changes?: readonly SourceChange[]): void;
}) {
  const availability = useMemo(() => {
    const result = groupingAvailability(source, selected);
    const movable = selected.every(target => {
      const data = target.kind === 'component' && shapes.get(spanKey(target.span));
      return data && data.canvas && !isLayoutAdapter(data.canvas);
    });
    return { group: result.group && movable, ungroup: result.ungroup };
  }, [source, selected, shapes]);
  const [message, setMessage] = useState('');
  useEffect(() => setMessage(''), [source, selected]);
  function apply(ungroup: boolean) {
    if (disabled || !(ungroup ? availability.ungroup : availability.group)) return;
    const result = editGrouping(source, selected, shapes, ungroup);
    if (!result) { setMessage('Grouping requires directly editable positions on freely positioned siblings.'); return; }
    onCommit(result.newSource, result.newSelections, result.changes);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'g') return;
      if (target?.isContentEditable || target?.closest('input, textarea, select, .sw-rich-text-editor, .sw-text-session-actions')) return;
      event.preventDefault();
      apply(event.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!selected.some(target => target.kind === 'component')) return null;
  return <section className="sw-alignment" aria-label="Grouping">
    <div className="sw-distribute-buttons">
      <button type="button" className="sw-icon-button" aria-label="Group" disabled={disabled || !availability.group} title="Group (Ctrl/Cmd+G)" onClick={() => apply(false)}><Group size={20} aria-hidden="true" focusable="false" /></button>
      <button type="button" className="sw-icon-button" aria-label="Ungroup" disabled={disabled || !availability.ungroup} title="Ungroup (Ctrl/Cmd+Shift+G)" onClick={() => apply(true)}><Ungroup size={20} aria-hidden="true" focusable="false" /></button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
