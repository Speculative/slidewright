import { useId } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: {
    kind: { type: 'string', default: 'print' },
    x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 },
    width: { type: 'number', default: 547 }, height: { type: 'number', default: 574 },
  },
  editor: { inspector: ['x', 'y', 'width', 'height', 'kind'] },
};
export const canvas = makeRectAdapter({ width: 547, height: 574 });

const causes = [[115, 240], [230, 110], [345, 275]] as const;
const blue = 'var(--uist-blue, #0000ff)';

/** A source-backed, independently movable Place–Time diagram. */
export default function PlaceTimeDiagram({ params }: ComponentRenderProps) {
  const kind = String(params.kind);
  const arrowId = `whyline-cause-${useId().replace(/:/g, '')}`;
  return <div data-demo-place-time-diagram={kind} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width: Number(params.width), height: Number(params.height), color: '#000', fontFamily: 'var(--font-body, sans-serif)' }}>
      <svg data-demo-comparison={kind} viewBox="0 0 450 400" role="img" aria-label={`${kind}: Place over Time`} style={{ width: '100%', height: '100%' }}>
        {kind === 'whyline' && <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={blue} /></marker></defs>}
        <path d="M60 30 V330 H410" fill="none" stroke="currentColor" strokeWidth="2" />
        <polygon points="60,24 55,36 65,36" fill="currentColor" /><polygon points="416,330 404,325 404,335" fill="currentColor" />
        <text transform="translate(20 180) rotate(-90)" textAnchor="middle" fontSize="28" fill="currentColor">Place</text>
        <text x="235" y="375" textAnchor="middle" fontSize="28" fill="currentColor">Time</text>
        {kind === 'print' && <g fill={blue} stroke={blue}>
          <line x1="115" y1="260" x2="345" y2="260" strokeWidth="2.5" />
          {[115, 230, 345].map(x => <circle key={x} data-demo-comparison-dot cx={x} cy="260" r="7" />)}
        </g>}
        {kind === 'breakpoint' && <rect data-demo-comparison-bar x="224" y="30" width="12" height="300" fill={blue} />}
        {kind === 'whyline' && <g>
          {causes.slice(1).map(([x, y], index) => {
            const [causeX, causeY] = causes[index]!;
            const distance = Math.hypot(x - causeX, y - causeY);
            const dx = (x - causeX) / distance * 10, dy = (y - causeY) / distance * 10;
            return <line key={index} data-demo-causal-link x1={x - dx} y1={y - dy} x2={causeX + dx} y2={causeY + dy} stroke={blue} strokeWidth="2.5" markerEnd={`url(#${arrowId})`} />;
          })}
          {causes.map(([x, y]) => <circle key={x} data-demo-comparison-dot cx={x} cy={y} r="7" fill={blue} />)}
        </g>}
      </svg>
  </div>;
}
