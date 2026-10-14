import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { slotFill, stringLit } from '../../../slidewright/runtime/ast-builders.js';

export const slidewright: ComponentMeta = {
  produces: 'text',
  slots: {},
  params: { expression: { type: 'string', default: 'x + y' } },
  inlineEditing: {
    mode: 'owned',
    mount(container, context) {
      let component = context.component;
      const input = document.createElement('input');
      input.type = 'text'; input.setAttribute('aria-label', 'Formula expression');
      input.style.font = 'inherit'; input.style.width = '180px';
      const value = component.fills.find(f => f.name === 'expression')?.value;
      input.value = value?.kind === 'string' ? value.value : 'x + y';
      const apply = document.createElement('button');
      apply.type = 'button'; apply.textContent = 'Apply formula';
      function accept(direction: -1 | 1 = 1) {
        const prior = component.fills.find(f => f.name === 'expression');
        context.onChange({ ...component, fills: prior ? component.fills.map(f => f === prior ? { ...f, value: stringLit(input.value) } : f) : [...component.fills, slotFill('expression', stringLit(input.value))] });
        context.exit(direction);
      }
      const click = () => accept();
      apply.addEventListener('click', click);
      const key = (event: KeyboardEvent) => {
        if (event.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); accept(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); context.exit(1); }
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && input.selectionStart === input.selectionEnd) {
          if (event.key === 'ArrowLeft' && input.selectionStart === 0) { event.preventDefault(); event.stopPropagation(); accept(-1); }
          if (event.key === 'ArrowRight' && input.selectionStart === input.value.length) { event.preventDefault(); event.stopPropagation(); accept(1); }
        }
      };
      input.addEventListener('keydown', key);
      container.append(input, apply);
      input.focus(); input.select();
      return {
        update(next) { component = next; },
        destroy() { input.removeEventListener('keydown', key); apply.removeEventListener('click', click); container.replaceChildren(); },
      };
    },
  },
};
export default function InlineFormula({ params }: ComponentRenderProps) {
  return <code style={{ padding: '0 4px', background: '#eef', borderRadius: 4 }}>{String(params.expression ?? 'x + y')}</code>;
}
