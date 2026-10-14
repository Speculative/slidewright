import { useState, type RefObject } from 'react';
import type { TextSessionHandle, TextStyleField } from './Editor.js';

// Controls keep the editor's draft selection while inputs own DOM focus.
// Applying a value changes authored marks, never the surrounding source.
export function FormattingToolbar({ session }: { session: RefObject<TextSessionHandle | null> }) {
  const [field, setField] = useState<TextStyleField>('size');
  const [value, setValue] = useState('');
  function apply() {
    if (!value.trim()) { session.current?.format(field, null); return; }
    const next = field === 'size' || field === 'letterSpacing' ? Number(value) : value;
    if (typeof next === 'number' && (!Number.isFinite(next) || field === 'size' && next <= 0)) return;
    session.current?.format(field, next);
  }
  return <div className="sw-text-formatting" data-sw-text-formatting role="group" aria-label="Text formatting"
    onBlur={event => {
      const next = event.relatedTarget;
      if (!(next instanceof Element) || !next.closest('.sw-text-session-actions, .sw-rich-text-editor')) session.current?.finish('commit');
    }}>
    <div className="sw-text-formatting-buttons">
      {(['weight', 'italic', 'underline'] as const).map((name, index) => <button key={name} type="button"
        onPointerDown={event => event.preventDefault()} onClick={() => session.current?.toggle(name)}>
        {['Bold', 'Italic', 'Underline'][index]}
      </button>)}
      <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => session.current?.clearFormatting()}>Clear formatting</button>
    </div>
    <label>Style <select aria-label="Text style" value={field} onChange={event => { setField(event.target.value as TextStyleField); setValue(''); }}>
      <option value="size">Font size</option><option value="font">Font family</option>
      <option value="weight">Font weight</option><option value="color">Color</option>
      <option value="letterSpacing">Letter spacing</option><option value="href">Link URL</option>
    </select></label>
    <input aria-label="Style value" value={value} placeholder="Empty removes style" onChange={event => setValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={apply}>Apply style</button>
  </div>;
}
