import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';

export const slidewright: ComponentMeta = {
  produces: 'text',
  slots: { content: { type: 'text', required: true } },
  params: { prefix: { type: 'string', default: '◆' } },
  inlineEditing: { mode: 'transparent', contentSlot: 'content' },
};
export default function InlineBadge({ slots, params }: ComponentRenderProps) {
  return <span style={{ border: '1px solid currentColor', borderRadius: 6, padding: '0 6px' }}>
    <span contentEditable={false}>{String(params.prefix ?? '◆')} </span>{slots.content}
  </span>;
}
