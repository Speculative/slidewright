import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

// The native select remains the focus, value and change-event owner. Only its
// popup is replaced, preserving inspector transactions and rich-text selection.
export function Select({ className = '', ref, onPointerDown, onKeyDown, onBlur, ...props }: ComponentPropsWithRef<'select'>) {
  const anchor = useRef<HTMLSelectElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const search = useRef({ text: '', time: 0 });
  const options = anchor.current ? Array.from(anchor.current.options) : [];
  const disabled = (option: HTMLOptionElement) => option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
  const enabledIndices = (items: HTMLOptionElement[]) => items.flatMap((option, index) => disabled(option) || option.hidden ? [] : [index]);
  const show = (index = anchor.current?.selectedIndex ?? -1) => {
    if (props.disabled) return;
    const available = enabledIndices(Array.from(anchor.current?.options ?? []));
    setActive(available.includes(index) ? index : available[0] ?? -1);
    setOpen(true);
  };
  const choose = (index: number) => {
    const select = anchor.current;
    const option = select?.options[index];
    if (!select || !option || disabled(option)) return;
    setOpen(false);
    if (select.selectedIndex === index) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const select = anchor.current;
      if (!select || !select.isConnected) { setOpen(false); return; }
      const rect = select.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const height = Math.min(menu.current?.scrollHeight ?? 280, 280);
      const flip = below < height && above > below;
      const maxHeight = Math.max(0, Math.min(280, flip ? above - 4 : below - 4));
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: flip ? Math.max(8, rect.top - Math.min(height, maxHeight) - 4) : rect.bottom + 4, width, maxHeight });
    };
    place();
    const observer = new ResizeObserver(place);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) place(); };
    window.addEventListener('scroll', scroll, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); };
  }, [open]);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);

  return <>
    <select {...props} ref={node => {
      anchor.current = node;
      if (typeof ref === 'function') return ref(node);
      if (ref) ref.current = node;
    }} className={`sp-select-control ${className}`}
      aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      onPointerDown={event => {
        onPointerDown?.(event);
        if (event.defaultPrevented || event.button !== 0 || props.disabled) return;
        event.preventDefault();
        event.currentTarget.focus();
        if (open) setOpen(false); else show();
      }}
      onBlur={event => { setOpen(false); onBlur?.(event); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const options = Array.from(event.currentTarget.options);
        const available = enabledIndices(options);
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape') {
          if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Enter' || event.key === ' ') { if (open) choose(active); else show(); return; }
          if (event.key === 'Home' || event.key === 'End') {
            setActive(available[event.key === 'Home' ? 0 : available.length - 1] ?? -1); setOpen(true); return;
          }
          if (!open) { show(); return; }
          const index = available.indexOf(active);
          setActive(available[Math.max(0, Math.min(available.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))] ?? -1);
          return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); event.stopPropagation();
          const now = Date.now();
          const text = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
          search.current = { text, time: now };
          const query = [...text].every(char => char === text[0]) ? text[0]! : text;
          const start = open ? active : event.currentTarget.selectedIndex;
          const ordered = [...available.filter(index => index > start), ...available.filter(index => index <= start)];
          const match = ordered.find(index => options[index]?.label.toLocaleLowerCase().startsWith(query));
          if (match !== undefined) { setActive(match); setOpen(true); }
        }
      }} />
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={props['aria-label'] ?? 'Options'}
      className="sp-select-menu sp-menu" data-sw-text-formatting style={{ position: 'fixed', ...position, visibility: position.width ? 'visible' : 'hidden' }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => event.stopPropagation()}>
      {options.map((option, index) => !option.hidden && <div key={index} id={`${id}-${index}`} role="option"
        aria-selected={anchor.current?.selectedIndex === index} aria-disabled={disabled(option) || undefined}
        data-option-index={index} className={`sp-select-option${active === index ? ' is-active' : ''}`}
        onPointerMove={() => { if (!disabled(option)) setActive(index); }}
        onClick={() => choose(index)}>
        <span className="sp-select-check" aria-hidden="true">{anchor.current?.selectedIndex === index && <Check size={14} strokeLinecap="square" strokeLinejoin="miter" />}</span>
        <span>{option.label}</span>
      </div>)}
    </div>, document.fullscreenElement ?? document.body)}
  </>;
}
