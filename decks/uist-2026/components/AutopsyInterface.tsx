import type { CSSProperties } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: {
    x: { type: 'number', default: 110 }, y: { type: 'number', default: 240 },
    width: { type: 'number', default: 1700 }, height: { type: 'number', default: 700 },
    sequence: { type: 'number', default: -1 },
    stacked: { type: 'boolean', default: false },
    scale: { type: 'number', default: 1 },
    highlightVariables: { type: 'boolean', default: false },
    expandedColumns: { type: 'boolean', default: false },
    tableOnly: { type: 'boolean', default: false },
    resultColumn: { type: 'boolean', default: false },
    draggingResult: { type: 'boolean', default: false },
  },
  editor: { inspector: ['sequence', 'x', 'y', 'width', 'height', 'scale', 'stacked', 'highlightVariables', 'expandedColumns', 'tableOnly', 'resultColumn', 'draggingResult'] },
};
export const canvas = makeRectAdapter({ width: 1700, height: 700 });

// Same execution as the calculator slides: the ^ case incorrectly multiplies.
const logs = [
  { 'node.op': '^', left: 4, right: 2, result: 8 },
  { 'node.op': '*', left: 3, right: 8, result: 24 },
  { 'node.op': '+', left: 2, right: 24, result: 26 },
];
const captured = [
  ['node', 'BinOp'],
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
  const scale = Math.max(0.1, Number(params.scale) || 1);
  const step = Number(params.sequence ?? -1);
  const sequence = step >= 0;
  const showVariables = sequence ? step >= 3 : !params.tableOnly;
  const selected = sequence ? step >= 3 : true;
  const highlighted = sequence ? step >= 4 : Boolean(params.highlightVariables);
  const stacked = Boolean(params.stacked) && !params.tableOnly;
  const cellStyle = stacked ? { ...cell, padding: '12px 24px' } : cell;
  const headerStyle: CSSProperties = stacked
    ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '16px 24px', borderBottom: `1px solid ${ink}`, background: ink, color: paper }
    : { padding: '24px 30px', borderBottom: `1px solid ${ink}`, background: ink, color: paper };
  const columns = ((sequence ? step >= 6 : params.expandedColumns) ? ['node.op', ...projected] : params.resultColumn ? ['node.op', 'result'] : ['node.op']) as (keyof typeof logs[number])[];
  return <div data-demo-autopsy-interface style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width: Number(params.width), height: Number(params.height), }}><div style={{ width: Number(params.width) / scale, height: Number(params.height) / scale, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'grid', gridTemplateColumns: params.tableOnly || stacked ? '1fr' : 'minmax(0, 1.8fr) minmax(0, 1fr)', gridTemplateRows: sequence ? '340px 1fr' : stacked ? 'auto 1fr' : undefined, gap: stacked ? 24 : 32, color: 'var(--uist-ink, #000)', fontFamily: 'var(--font-body, sans-serif)', fontSize: 30 }}>
    <section aria-label="Captured logs" style={card}>
      <div style={headerStyle}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Streams</div>
        <div style={{ marginTop: stacked ? 0 : 12, fontFamily: mono, fontSize: 24 }}>{sequence ? 'evaluate(node)' : 'evaluate(node) · log(node.op)'}</div>
      </div>
      <table aria-label="Logged values" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: mono, fontSize: 30 }}>
        <thead><tr>{(!sequence || step >= 2) && columns.map(column => <th key={column} scope="col" style={{ ...cellStyle, background: paper, color: ink, borderBottom: `2px solid ${ink}`, fontSize: 28 }}>{column}</th>)}</tr></thead>
        <tbody>{(!sequence || step >= 2) && logs.map((log, index) => <tr key={log['node.op']} aria-selected={selected && index === 0} style={{ background: selected && index === 0 ? blue : paper }}>
          {columns.map(column => <td key={column} style={{ ...cellStyle, color: selected && index === 0 ? paper : ink }}>{log[column]}</td>)}
        </tr>)}</tbody>
      </table>
    </section>
    {showVariables && <section aria-label="Captured variables" style={card}>
      <div style={headerStyle}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>Variables</div>
        <div style={{ marginTop: stacked ? 0 : 12, fontFamily: mono, fontSize: 24 }}>{sequence ? 'evaluate(node) · invocation 1 of 3' : 'evaluate(node) · log 1 of 3'}</div>
      </div>
      <dl style={{ margin: 0, padding: '20px 18px', fontFamily: mono, fontSize: 28 }}>
        {captured.map(([name, value]) => <div key={name} data-demo-captured-variable={name} data-highlighted={highlighted && projected.includes(name) || undefined} style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 12, padding: stacked ? '10px 12px' : '15px 12px', background: highlighted && projected.includes(name) ? blue : paper, color: highlighted && projected.includes(name) ? paper : ink }}>
          <dt>{name}</dt><dd style={{ margin: 0 }}>{value}</dd>
        </div>)}
      </dl>
    </section>}
    {sequence && [1, 3, 4, 5].includes(step) && <svg data-demo-autopsy-gesture aria-label={step === 1 ? 'Drag node.op from line 6 to Streams' : step === 3 ? 'Click the first row' : step === 4 ? 'Select left, right, result' : 'Drag left, right, result to Streams'}
      width="1708" height="780" viewBox="-828 0 1708 780" style={{ position: 'absolute', left: -828, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {step === 1 && <>
        <rect x="-600" y="348" width="130" height="42" fill={blue} opacity="0.18" />
        <path d="M -535 370 C -250 370, -170 140, 140 140" fill="none" stroke={blue} strokeWidth="5" strokeDasharray="12 10" />
      </>}
      {step === 5 && <path d="M 240 615 C 40 560, 30 210, 360 140" fill="none" stroke={blue} strokeWidth="5" strokeDasharray="12 10" />}
      {step === 3 && <circle cx="140" cy="164" r="25" fill="none" stroke={blue} strokeWidth="4" />}
      {step === 4 && <rect x="20" y="511" width="840" height="153" fill="none" stroke={blue} strokeWidth="3" strokeDasharray="8 6" />}
      <g transform={`translate(${step === 1 ? '140 140' : step === 3 ? '140 164' : step === 4 ? '170 615' : '360 140'})`}>
        <path d="M 0 0 L 0 42 L 12 31 L 23 52 L 33 47 L 22 27 L 39 25 Z" fill={ink} stroke={paper} strokeWidth="3" />
        {(step === 1 || step === 5) && <>
          <rect x="44" y="16" width={step === 1 ? 160 : 360} height="54" fill={blue} />
          <text x="61" y="53" fill={paper} fontFamily={mono} fontSize="28">{step === 1 ? 'node.op' : 'left, right, result'}</text>
        </>}
      </g>
    </svg>}
    {Boolean(params.draggingResult) && <svg aria-label="Drag result from line 11 into the table" width="1460" height="600" viewBox="-700 0 1460 600"
      style={{ position: 'absolute', left: -700, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <path d="M -610 510 C -390 540, -140 260, 350 210" fill="none" stroke={blue} strokeWidth="5" strokeDasharray="12 10" />
      <circle cx="-610" cy="510" r="12" fill={paper} stroke={blue} strokeWidth="4" />
      <g transform="translate(350 210)">
        <path d="M 0 0 L 0 42 L 12 31 L 23 52 L 33 47 L 22 27 L 39 25 Z" fill={ink} stroke={paper} strokeWidth="3" />
        <rect x="44" y="16" width="146" height="54" fill={blue} />
        <text x="61" y="53" fill={paper} fontFamily={mono} fontSize="28">result</text>
      </g>
    </svg>}
  </div></div>;
}
