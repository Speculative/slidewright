import { useState, type RefObject } from 'react';
import type { ParagraphField } from './commands.js';
import type { TextSessionHandle, TextStyleField } from './Editor.js';

// Controls keep the editor's draft selection while inputs own DOM focus.
// Applying a value changes authored marks, never the surrounding source.
export function FormattingToolbar({ session }: { session: RefObject<TextSessionHandle | null> }) {
  const [field, setField] = useState<TextStyleField>('size');
  const [value, setValue] = useState('');
  const [paragraphField, setParagraphField] = useState<ParagraphField>('align');
  const [paragraphValue, setParagraphValue] = useState('');
  function applyParagraph() {
    const next = !paragraphValue.trim() ? null : paragraphField === 'align' ? paragraphValue : Number(paragraphValue);
    if (typeof next === 'number' && (!Number.isFinite(next) || paragraphField === 'lineHeight' && next <= 0)) return;
    if (paragraphField === 'align' && next !== null && !['left', 'center', 'right', 'justify'].includes(String(next))) return;
    session.current?.paragraph(paragraphField, next);
  }
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
    <label>Paragraph <select aria-label="Paragraph style" value={paragraphField} onChange={event => { setParagraphField(event.target.value as ParagraphField); setParagraphValue(''); }}>
      <option value="align">Alignment</option><option value="lineHeight">Line height</option>
      <option value="spaceBefore">Space before</option><option value="spaceAfter">Space after</option>
      <option value="indent">Left indent</option><option value="firstLineIndent">First line indent</option>
    </select></label>
    <input aria-label="Paragraph value" value={paragraphValue} placeholder={paragraphField === 'align' ? 'left / center / right / justify' : 'Pixels; negative hangs first line'} onChange={event => setParagraphValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyParagraph(); } }} />
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={applyParagraph}>Apply paragraph</button>
  </div>;
}
