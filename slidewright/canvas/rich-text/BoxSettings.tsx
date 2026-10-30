import { Button, Select } from '../design-system/Controls.js';
import { textBoxSizing } from '../textbox-adapter.js';
import { useState } from 'react';
export type TextBoxDefault = 'font' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'align' | 'color' | 'wrap' | 'shrinkToFit' | 'sizing' | 'width' | 'height';
export type TextBoxDefaults = Partial<Record<TextBoxDefault, string | number | boolean>>;
export function BoxSettings({ onApply, current }: { current: Record<string, unknown>; onApply(field: TextBoxDefault, value: string | number | boolean): void }) {
  const [field, setField] = useState<TextBoxDefault>('fontSize');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  function apply() {
    const numeric = ['fontSize', 'lineHeight', 'letterSpacing'].includes(field);
    const boolean = field === 'wrap' || field === 'shrinkToFit';
    const next = numeric ? Number(value) : boolean ? value === 'true' : value.trim();
    if (!value.trim() || numeric && (!Number.isFinite(next) || field !== 'letterSpacing' && Number(next) <= 0) || boolean && !['true', 'false'].includes(value) || field === 'align' && !['left', 'center', 'right', 'justify'].includes(String(next))) {
      setError('Enter a valid value for this setting.'); return;
    }
    setError(''); onApply(field, next);
  }
  return <div data-sw-text-formatting className="sw-text-formatting" role="group" aria-label="TextBox defaults">
    <label>Text sizing <Select aria-label="Text sizing" value={textBoxSizing(current)} onChange={event => onApply('sizing', event.target.value)}>
      <option value="auto-width">Auto width</option><option value="auto-height">Auto height</option><option value="fixed">Fixed size</option>
    </Select></label>
    <label>Whole text box <Select aria-label="TextBox setting" value={field} onChange={event => { setField(event.target.value as TextBoxDefault); setValue(''); setError(''); }}>
      <option value="fontSize">Font size</option><option value="font">Font family</option><option value="fontWeight">Font weight</option>
      <option value="lineHeight">Line height</option><option value="letterSpacing">Letter spacing</option><option value="align">Alignment</option>
      <option value="color">Color</option><option value="wrap">Wrap</option><option value="shrinkToFit">Shrink to fit</option>
    </Select></label>
    <output aria-label="Current TextBox setting">{String(current[field] ?? 'Default')}</output>
    <input aria-label="TextBox setting value" placeholder={field === 'wrap' || field === 'shrinkToFit' ? 'true / false' : 'Value'} value={value} onChange={event => setValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
    <Button type="button" onPointerDown={event => event.preventDefault()} onClick={apply}>Apply box setting</Button>
    {error && <span role="status">{error}</span>}
  </div>;
}
