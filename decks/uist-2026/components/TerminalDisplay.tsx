import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { DemoTerminal } from './DemoTerminal.js';
import { PanelTextEditor } from './PanelTextEditor.js';

/** Reusable, source-backed terminal transcript. */
export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 590 },
    height: { type: 'number', default: 320 },
    content: { type: 'string', default: '' },
    title: { type: 'string', default: 'Terminal' },
    fontSize: { type: 'number', default: 28 },
  },
  editor: { inspector: ['x', 'y', 'width', 'height', 'content', 'title', 'fontSize'] },
  editing: { params: ['content'] },
};

export const canvas = makeRectAdapter({ width: 590, height: 320 });

export default function TerminalDisplay({ params }: ComponentRenderProps) {
  return <div data-sw-terminal-display style={{
    position: 'absolute', left: Number(params.x), top: Number(params.y),
    width: Number(params.width), height: Number(params.height), display: 'flex',
    fontFamily: 'var(--font-mono, monospace)', fontSize: Number(params.fontSize), lineHeight: 1.625,
  }}>
    <PanelTextEditor field="content" value={String(params.content)} label="output">
      <DemoTerminal lines={String(params.content).split('\n')} title={String(params.title)} fontSize={Number(params.fontSize)} />
    </PanelTextEditor>
  </div>;
}
