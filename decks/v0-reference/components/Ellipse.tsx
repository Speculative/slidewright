// Ellipses use the same bounding rectangle and gestures as Box.
import { renderBox, slidewright as boxMeta } from './Box.js';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeComponent } from '../../../slidewright/runtime/ast-builders.js';

const { radius: _radius, ...params } = boxMeta.params!;
export const slidewright: ComponentMeta = {
  ...boxMeta,
  params,
  description: 'Absolutely-positioned ellipse.',
  insertion: {
    ...boxMeta.insertion!,
    shortcut: 'O',
    modalPreview: 'ellipse',
    stub(ctx) {
      const box = boxMeta.insertion!.stub(ctx);
      return box ? makeComponent('Ellipse', box.fills) : null;
    },
  },
};
export { canvas } from './Box.js';

export default function Ellipse(props: ComponentRenderProps) {
  return renderBox(props.params, true);
}
