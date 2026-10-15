// Registry-driven insertion search. Tool state and placement live in App.
import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';

export type Tool = string;
export const SELECT_TOOL = 'select';
export interface ToolEntry {
  id: string;
  label: string;
  description?: string;
  category?: string;
  gestures: ('drag' | 'modal')[];
}
interface Props {
  placing?: boolean;
  tools: ToolEntry[];
  onSelect(tool: Tool): void;
  onDragStart?(tool: Tool, event: PointerEvent): void;
}

export function ToolPalette({ placing, tools, onSelect, onDragStart }: Props): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const normalizedQuery = query.toLowerCase().trim();
  const words = normalizedQuery.split(/\s+/);
  function matchRank(tool: ToolEntry): number {
    const label = tool.label.toLowerCase();
    if (!normalizedQuery || label === normalizedQuery) return 0;
    if (label.startsWith(normalizedQuery)) return 1;
    if (label.includes(normalizedQuery)) return 2;
    // Prefer names over incidental description/category matches. Multi-word
    // queries rank entries with more matching words in their name first.
    return 3 + words.filter(word => !label.includes(word)).length;
  }
  const matches = tools.filter(tool => words.every(word =>
    `${tool.label} ${tool.description ?? ''} ${tool.category ?? 'Other'}`.toLowerCase().includes(word)))
    .sort((a, b) => matchRank(a) - matchRank(b));
  const current = Math.min(index, Math.max(0, matches.length - 1));

  function close(restoreFocus = true) {
    setOpen(false);
    input.current?.blur();
    if (restoreFocus) returnFocus.current?.focus();
  }
  function confirm(tool: Tool) {
    close(false);
    setQuery('');
    setIndex(0);
    onSelect(tool);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
          target?.isContentEditable || target?.closest('input, textarea, select')) return;
      if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        if (document.querySelector('.sw-presenting')) return;
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setQuery('');
        setIndex(0);
        setOpen(true);
      }
    };
    const outside = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('pointerup', outside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('pointerup', outside);
    };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (placing) { setOpen(false); input.current?.blur(); } }, [placing]);
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, query, open]);

  if (!open) return null;
  return <div ref={root} className="sw-tool-palette" role="dialog" aria-label="Insert element"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="sw-picker-heading">Insert element</div>
    <input ref={input} type="search" className="sw-tool-search" placeholder="Search elements…"
      aria-label="Insert element" role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls="sw-insert-results" aria-activedescendant={open && matches.length ? `sw-insert-${matches[current]!.id}` : undefined}
      value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setIndex((current + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % (matches.length || 1));
        }
        if (event.key === 'Enter') { event.preventDefault(); if (matches[current]) confirm(matches[current]!.id); }
        if (event.key === 'Tab') { event.preventDefault(); close(); }
      }} />
    <div className="sw-command-results" id="sw-insert-results" role="listbox" aria-label="Elements">
      {matches.map((tool, i) => <div key={tool.id}>
        {(i === 0 || tool.category !== matches[i - 1]?.category) && <div className="sw-tool-section-header">{tool.category ?? 'Other'}</div>}
        <button type="button" tabIndex={-1} id={`sw-insert-${tool.id}`} role="option" aria-selected={current === i}
          className="sw-tool" title={tool.description} onMouseMove={() => setIndex(i)}
          onClick={() => confirm(tool.id)} onPointerDown={event => {
            if (tool.gestures.includes('drag') && onDragStart) onDragStart(tool.id, event);
          }}>{tool.label}</button>
      </div>)}
      {!matches.length && <div className="sw-tool-empty" role="status">No matching elements</div>}
      <div className="sw-command-help">↑↓ Choose · Enter Insert · Esc Close</div>
    </div>
  </div>;
}
