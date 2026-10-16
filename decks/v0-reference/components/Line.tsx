// Lines share Arrow's rendering and endpoint gestures; only defaults differ.
import Arrow, { lineMetadata } from './Arrow.js';
import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';

export const slidewright = lineMetadata('Line');
export { canvas } from './Arrow.js';

export default function Line(props: ComponentRenderProps) {
  return <Arrow {...props} params={{ endHead: 'none', ...props.params }} />;
}
