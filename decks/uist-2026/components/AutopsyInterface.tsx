import type { CSSProperties } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: {
    x: { type: 'number', default: 110 }, y: { type: 'number', default: 240 },
    width: { type: 'number', default: 1700 }, height: { type: 'number', default: 700 },
    highlightVariables: { type: 'boolean', default: false },
    expandedColumns: { type: 'boolean', default: false },
  },
  editor: { inspector: ['x', 'y', 'width', 'height', 'highlightVariables', 'expandedColumns'] },
};
export const canvas = makeRectAdapter({ width: 1700, height: 700 });

// Same execution as the calculator slides: the ^ case incorrectly multiplies.
const logs = [
  { 'node.op': '^', left: 4, right: 2, result: 8 },
  { 'node.op': '*', left: 3, right: 8, result: 24 },
  { 'node.op': '+', left: 2, right: 24, result: 26 },
];
const captured = [
  ['node', 'BinOp'], ['node.op', '"^"'],
  ['node.left', 'Num(4)'], ['node.right', 'Num(2)'],
  ['left', '4'], ['right', '2'], ['result', '8'],
] as const;
const projected = ['left', 'right', 'result'];
const ink = 'var(--uist-ink, #000)';
const paper = 'var(--uist-paper, #fff)';
const blue = 'var(--uist-blue, #0000ff)';
const card: CSSProperties = { boxSizing: 'border-box', border: `4px solid ${ink}`, borderRadius: 0, boxShadow: `8px 8px 0 ${blue}`, overflow: 'hidden', background: paper };
const mono = 'var(--font-mono, monospace)';
const cell: CSSProperties = { padding: '28px 30px', borderBottom: `1px solid ${ink}`, textAlign: 'left' };

/** A fixed selected snapshot, with source-backed native build reveals. */
export default function AutopsyInterface({ params }: ComponentRenderProps) {
  const columns = (params.expandedColumns ? ['node.op', ...projected] : ['node.op']) as (keyof typeof logs[number])[];
  return <div data-demo-autopsy-interface style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width: Number(params.width), height: Number(params.height), display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr)', gap: 32, color: 'var(--uist-ink, #000)', fontFamily: 'var(--font-body, sans-serif)', fontSize: 30 }}>
    <section aria-label="Captured logs" style={card}>
      <div style={{ padding: '24px 30px', borderBottom: `1px solid ${ink}`, background: ink, color: paper }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Streams</div>
        <div style={{ marginTop: 12, fontFamily: mono, fontSize: 24 }}>evaluate(node) · log(node.op)</div>
      </div>
      <table aria-label="Logged values" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: mono, fontSize: 30 }}>
        <thead><tr>{columns.map(column => <th key={column} scope="col" style={{ ...cell, background: paper, color: ink, borderBottom: `2px solid ${ink}`, fontSize: 28 }}>{column}</th>)}</tr></thead>
        <tbody>{logs.map((log, index) => <tr key={log['node.op']} aria-selected={index === 0} style={{ background: index === 0 ? blue : paper }}>
          {columns.map(column => <td key={column} style={{ ...cell, color: index === 0 ? paper : ink }}>{log[column]}</td>)}
        </tr>)}</tbody>
      </table>
    </section>
    <section aria-label="Captured variables" style={card}>
      <div style={{ padding: '24px 28px', borderBottom: `1px solid ${ink}`, background: ink, color: paper }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Variables</div>
        <div style={{ marginTop: 12, fontFamily: mono, fontSize: 24 }}>evaluate(node) · log 1 of 3</div>
      </div>
      <dl style={{ margin: 0, padding: '20px 18px', fontFamily: mono, fontSize: 28 }}>
        {captured.map(([name, value]) => <div key={name} data-demo-captured-variable={name} data-highlighted={Boolean(params.highlightVariables) && projected.includes(name) || undefined} style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12, padding: '15px 12px', background: params.highlightVariables && projected.includes(name) ? blue : paper, color: params.highlightVariables && projected.includes(name) ? paper : ink }}>
          <dt>{name}</dt><dd style={{ margin: 0 }}>{value}</dd>
        </div>)}
      </dl>
    </section>
  </div>;
}
