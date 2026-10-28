import { Bold, Italic, Underline, Strikethrough, RemoveFormatting } from 'lucide-react';
import type { SlideColor } from '../InspectorPanels.js';
import { commitOnTextBlur } from './focus.js';
import { FloatingToolbar, type TextStyleControls } from './FloatingToolbar.js';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { TextFormattingState, FormattingValue } from './feedback.js';
import type { ParagraphField, ListStyle } from './commands.js';
import type { TextSessionHandle, TextStyleField } from './Editor.js';

// DOM selection can be cleared without a ProseMirror transaction. Input focus,
// however, temporarily owns the native selection while the draft range survives.
function useFloatingSelection() {
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    let dismissal: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (document.activeElement?.closest('[data-sw-text-formatting], .sw-text-session-actions')) return;
      const selection = window.getSelection();
      const editor = document.querySelector('.sw-rich-text-editor');
      setSelected(!!selection && !selection.isCollapsed && selection.rangeCount > 0 &&
        !!editor?.contains(selection.anchorNode) && !!editor.contains(selection.focusNode));
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.sw-rich-text-editor, .sw-floating-text-toolbar, .sw-text-color-popover')) {
        // Let a focused field blur/apply before removing its toolbar.
        clearTimeout(dismissal);
        dismissal = setTimeout(() => setSelected(false), 0);
      }
    };
    sync();
    document.addEventListener('selectionchange', sync);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      clearTimeout(dismissal);
      document.removeEventListener('selectionchange', sync);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, []);
  return selected;
}

// Controls keep the editor's draft selection while inputs own DOM focus.
// Applying a value changes authored marks, never the surrounding source.
export function FormattingToolbar({ session, state, colorTokens, slideColors }: { session: RefObject<TextSessionHandle | null>; state: TextFormattingState | null; colorTokens: Record<string, string>; slideColors: SlideColor[] }) {
  const selected = useFloatingSelection();
  const floating = selected && !!state && !state.caret;
  const [field, setField] = useState<TextStyleField>('size');
  const [value, setValue] = useState('');
  const [listStyle, setListStyle] = useState<ListStyle>('disc');
  const [listStart, setListStart] = useState('1');
  const [listMessage, setListMessage] = useState('');
  const [paragraphField, setParagraphField] = useState<ParagraphField>('align');
  const [paragraphValue, setParagraphValue] = useState('');
  const describe = (value: FormattingValue | undefined) => value?.mixed ? 'Mixed' : !value || value.value === null ? 'Inherited' : String(value.value);
  function applyParagraph() {
    const next = !paragraphValue.trim() ? null : paragraphField === 'align' ? paragraphValue : Number(paragraphValue);
    if (typeof next === 'number' && (!Number.isFinite(next) || paragraphField === 'lineHeight' && next <= 0)) return;
    if (paragraphField === 'align' && next !== null && !['left', 'center', 'right', 'justify'].includes(String(next))) return;
    session.current?.paragraph(paragraphField, next);
  }
  function apply() {
    if (!value.trim()) { session.current?.format(field, null); return; }
    const next = field === 'size' || field === 'letterSpacing' || field === 'strokeWidth' ? Number(value) : value;
    if (typeof next === 'number' && (!Number.isFinite(next) || (field === 'size' && next <= 0 || field === 'strokeWidth' && next < 0))) return;
    session.current?.format(field, next);
  }
  const buttons = <TextStyleButtons session={session} state={state} />;
  return <div className="sw-text-formatting" data-sw-text-formatting role="group" aria-label="Text formatting"
    onBlur={event => {
      commitOnTextBlur(event.relatedTarget, () => session.current?.finish('commit'));
    }}>
    <span aria-label="Formatting target">{state?.caret ? 'Typing at caret' : 'Selected range'}</span>
    <div style={{ visibility: floating ? 'hidden' : undefined }} aria-hidden={floating || undefined} inert={floating}>{buttons}</div>
    {floating && <FloatingToolbar session={session} state={state} colorTokens={colorTokens} slideColors={slideColors}>{buttons}</FloatingToolbar>}
    <label>Style <select aria-label="Text style" value={field} onChange={event => { setField(event.target.value as TextStyleField); setValue(''); }}>
      <option value="size">Font size</option><option value="font">Font family</option>
      <option value="weight">Font weight</option><option value="color">Color</option>
      <option value="strokeWidth">Stroke width</option><option value="strokeColor">Stroke color</option>
      <option value="letterSpacing">Letter spacing</option><option value="href">Link URL</option>
    </select></label>
    <output aria-label="Current text style">{describe(state?.inline[field])}</output>
    <input aria-label="Style value" value={value} placeholder="Empty removes style" onChange={event => setValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={apply}>Apply style</button>
    <label>Paragraph <select aria-label="Paragraph style" value={paragraphField} onChange={event => { setParagraphField(event.target.value as ParagraphField); setParagraphValue(''); }}>
      <option value="align">Alignment</option><option value="lineHeight">Line height</option>
      <option value="spaceBefore">Space before</option><option value="spaceAfter">Space after</option>
      <option value="indent">Left indent</option><option value="firstLineIndent">First line indent</option>
    </select></label>
    <output aria-label="Current paragraph style">{describe(state?.paragraph[paragraphField])}</output>
    <input aria-label="Paragraph value" value={paragraphValue} placeholder={paragraphField === 'align' ? 'left / center / right / justify' : 'Pixels; negative hangs first line'} onChange={event => setParagraphValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyParagraph(); } }} />
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={applyParagraph}>Apply paragraph</button>
    <output aria-label="Current list">{state?.list ? `${state.list.style}, start ${state.list.start}` : 'No list'}</output>
    <label>List <select aria-label="List style" value={listStyle} onChange={event => setListStyle(event.target.value as ListStyle)}>
      <option value="disc">Bullets</option><option value="circle">Circles</option><option value="square">Squares</option>
      <option value="decimal">Numbers</option><option value="lower-alpha">a, b, c</option><option value="upper-alpha">A, B, C</option>
      <option value="lower-roman">i, ii, iii</option><option value="upper-roman">I, II, III</option>
    </select></label>
    <label>Start <input aria-label="List start" type="number" min="1" step="1" value={listStart} onChange={event => setListStart(event.target.value)} /></label>
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => setListMessage(session.current?.list(listStyle, Number(listStart)) ? '' : 'Select paragraphs or items in one list.')}>Apply list</button>
    {([-1, 1] as const).map(direction => <button key={direction} type="button" onPointerDown={event => event.preventDefault()}
      onClick={() => setListMessage(session.current?.listDepth(direction) ? '' : 'Select list items that can move one level.')}>
      {direction < 0 ? 'Outdent item' : 'Indent item'}
    </button>)}
    {listMessage && <span role="status">{listMessage}</span>}
  </div>;
}

export function TextStyleButtons({ session, state, keyframe }: { session: RefObject<TextStyleControls | null>; state: TextFormattingState | null; keyframe?(field: string): ReactNode }) {
  function pressed(field: 'weight' | 'italic' | 'underline' | 'strikethrough'): boolean | 'mixed' {
    const current = state?.inline[field];
    return current?.mixed ? 'mixed' : field === 'weight' ? String(current?.value) === '700' : current?.value === true;
  }
  return <div className="sw-text-formatting-buttons">
      {([['weight', 'Bold', Bold, 'Ctrl/Cmd+B'], ['italic', 'Italic', Italic, 'Ctrl/Cmd+I'],
        ['underline', 'Underline', Underline, 'Ctrl/Cmd+U'], ['strikethrough', 'Strikethrough', Strikethrough, 'Ctrl/Cmd+Shift+X']] as const).map(([name, label, Icon, shortcut]) => <span key={name} className="sw-formatting-button-key"><button type="button" className="sw-icon-button" aria-label={label} title={`${label} (${shortcut})`}
        aria-pressed={pressed(name)} onPointerDown={event => { if (!(document.activeElement instanceof HTMLInputElement)) event.preventDefault(); }} onClick={() => session.current?.toggle(name)}>
        <Icon size={18} aria-hidden="true" focusable="false" />
      </button>{keyframe?.(name)}</span>)}
      <button type="button" className="sw-icon-button" aria-label="Clear formatting" title="Clear formatting" onPointerDown={event => { if (!(document.activeElement instanceof HTMLInputElement)) event.preventDefault(); }} onClick={() => session.current?.clearFormatting()}><RemoveFormatting size={18} aria-hidden="true" focusable="false" /></button>
    </div>;
}
