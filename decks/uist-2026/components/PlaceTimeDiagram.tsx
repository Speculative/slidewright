import { useId } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: {
    kind: { type: 'string', default: 'print' },
    muted: { type: 'boolean', default: false },
    queryOutlines: { type: 'boolean', default: false },
    capturedMoments: { type: 'number', default: 3 },
    showLocals: { type: 'boolean', default: false },
    timeOutline: { type: 'string', default: 'logged' },
    emphasis: { type: 'string', default: 'all' },
    expandedPlaces: { type: 'boolean', default: false },
    focusedTime: { type: 'boolean', default: false },
    x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 },
    width: { type: 'number', default: 547 }, height: { type: 'number', default: 574 },
  },
  editor: { inspector: ['x', 'y', 'width', 'height', 'kind', 'muted', 'queryOutlines', 'capturedMoments', 'showLocals', 'timeOutline', 'emphasis', 'expandedPlaces', 'focusedTime'] },
};
export const canvas = makeRectAdapter({ width: 547, height: 574 });

const causes = [[115, 240], [230, 110], [345, 275]] as const;
const blue = 'var(--uist-blue, #0000ff)';
const grey = 'var(--uist-grey, #a3a3a3)';

/** A source-backed, independently movable Place–Time diagram. */
export default function PlaceTimeDiagram({ params }: ComponentRenderProps) {
  const kind = String(params.kind);
  const dotXs = [115, 230, 345].slice(0, kind === 'autopsy' ? Number(params.capturedMoments ?? 3) : 3);
  const dotY = kind === 'autopsy' ? 180 : 260;
  const emphasis = kind === 'autopsy' ? String(params.emphasis ?? 'all') : 'all';
  const momentColor = (x: number) => emphasis === 'locals' || emphasis === 'left' || (emphasis === 'later' && x === dotXs[0]) ? grey : blue;
  const localColor = (x: number, label: string) => (emphasis === 'later' && x === dotXs[0]) || (emphasis === 'left' && label !== 'left') ? grey : blue;
  const arrowId = `whyline-cause-${useId().replace(/:/g, '')}`;
  return <div data-demo-place-time-diagram={kind} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width: Number(params.width), height: Number(params.height), color: '#000', filter: params.muted ? 'grayscale(1)' : undefined, opacity: params.muted ? 0.35 : 1, fontFamily: 'var(--font-body, sans-serif)' }}>
      {kind === 'transformations' ? <TransformationChart expanded={Boolean(params.expandedPlaces)} focused={Boolean(params.focusedTime)} /> : <svg data-demo-comparison={kind} viewBox="0 0 450 400" role="img" aria-label={`${kind}: Place over Time`} style={{ width: '100%', height: '100%' }}>
        {(kind === 'whyline' || kind === 'future') && <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill={blue} /></marker></defs>}
        <path d="M60 30 V330 H410" fill="none" stroke="currentColor" strokeWidth="2" />
        <polygon points="60,24 55,36 65,36" fill="currentColor" /><polygon points="416,330 404,325 404,335" fill="currentColor" />
        <text transform="translate(20 180) rotate(-90)" textAnchor="middle" fontSize="28" fill="var(--uist-cyan, #00a8e8)">Place</text>
        <text x="235" y="375" textAnchor="middle" fontSize="28" fill="var(--uist-pink, #ff3d8b)">Time</text>
        {kind === 'autopsy' && <g fill="none" stroke={blue} strokeWidth="2" strokeDasharray="7 6">
          {dotXs.length > 1 && params.timeOutline !== 'none' && <rect data-demo-autopsy-time x="80" y={(params.timeOutline === 'left' ? 230 : dotY) - 18} width="300" height="36" />}
          {dotXs.map(x => <rect key={x} data-demo-autopsy-place stroke={momentColor(x)} x={x - 15} y="50" width="30" height="260" />)}
        </g>}
        {(kind === 'print' || kind === 'autopsy') && <g fill={blue} stroke={blue}>
          {dotXs.length > 1 && <line x1={dotXs[0]} y1={dotY} x2={dotXs.at(-1)} y2={dotY} strokeWidth="2.5" stroke={emphasis === 'left' ? grey : blue} />}
          {dotXs.map(x => <circle key={x} data-demo-comparison-dot fill={momentColor(x)} stroke={momentColor(x)} cx={x} cy={dotY} r="7" />)}
        </g>}
        {kind === 'autopsy' && Boolean(params.showLocals) && dotXs.length > 0 && <g>
          {dotXs.flatMap(x => ['left', 'right'].map((label, index) => <g key={`${x}-${label}`} data-demo-autopsy-local={label}>
            <circle cx={x} cy={230 + index * 45} r="7" fill="none" stroke={localColor(x, label)} strokeWidth="2" strokeDasharray="3 2" />
            {x === dotXs[0] && <text x={x + 25} y={230 + index * 45} dominantBaseline="middle" fontSize="20" fill={localColor(x, label) === grey ? grey : 'currentColor'}>{label}</text>}
          </g>))}
        </g>}
        {(kind === 'breakpoint' || kind === 'query-place') && <rect data-demo-comparison-bar x="224" y="30" width="12" height="300" fill={blue} />}
        {kind === 'query-time' && <rect data-query-time-bar x="60" y="174" width="350" height="12" fill={blue} />}
        {kind === 'query-point' && <circle data-query-point cx="230" cy="180" r="7" fill={blue} />}
        {kind === 'query-grid' && <g fill={blue}>
          {[115, 190, 345].flatMap(x => [80, 205, 260].map(y => <circle key={`${x}-${y}`} data-query-grid-dot cx={x} cy={y} r="7" />))}
        </g>}
        {/* Center the full query arrangement on the axes' plot area (235, 180). */}
        {kind === 'future' && <g transform="translate(27.5 0)">
          <g fill="none" stroke={blue} strokeWidth="2" strokeDasharray="7 6">
            {[110, 260].map(y => <rect key={y} data-future-time x={115 - 30} y={y - 15} width={300 - 115 + 2 * 30} height="30" />)}
            {[160, 300, 115, 255].map(x => <rect key={x} data-future-place x={x - 12} y="50" width="24" height="260" />)}
          </g>
          <g stroke={blue} strokeWidth="2.5">
            <line x1="160" y1="110" x2="300" y2="110" />
            <line x1="115" y1="260" x2="255" y2="260" />
            {[[160, 110, 115, 260], [300, 110, 255, 260]].map(([x1, y1, x2, y2], index) => {
              const length = Math.hypot(x2! - x1!, y2! - y1!);
              const dx = (x2! - x1!) / length * 14, dy = (y2! - y1!) / length * 14;
              return <line key={index} data-future-query x1={x1! + dx} y1={y1! + dy} x2={x2! - dx} y2={y2! - dy} markerStart={`url(#${arrowId})`} markerEnd={`url(#${arrowId})`} />;
            })}
          </g>
          {[[160, 110], [300, 110], [115, 260], [255, 260]].map(([x, y]) => <circle key={x} data-demo-comparison-dot cx={x} cy={y} r="7" fill={blue} />)}
        </g>}
        {kind === 'whyline' && <g>
          {Boolean(params.queryOutlines) && <g data-whyline-query-outlines fill="none" stroke={grey} strokeWidth="2" strokeDasharray="7 6">
            {causes.map(([x, y]) => <g key={x}>
              <rect data-whyline-time-outline x="80" y={y - 15} width="300" height="30" />
              <rect data-whyline-place-outline x={x - 12} y="50" width="24" height="260" />
            </g>)}
          </g>}
          {causes.slice(1).map(([x, y], index) => {
            const [causeX, causeY] = causes[index]!;
            const distance = Math.hypot(x - causeX, y - causeY);
            const dx = (x - causeX) / distance * 10, dy = (y - causeY) / distance * 10;
            return <line key={index} data-demo-causal-link x1={x - dx} y1={y - dy} x2={causeX + dx} y2={causeY + dy} stroke={blue} strokeWidth="2.5" markerEnd={`url(#${arrowId})`} />;
          })}
          {causes.map(([x, y]) => <circle key={x} data-demo-comparison-dot cx={x} cy={y} r="7" fill={blue} />)}
        </g>}
      </svg>}
  </div>;
}

function TransformationChart({ expanded, focused }: { expanded: boolean; focused: boolean }) {
  const moments = [360, 560, 760];
  const places = [{ label: 'right', y: 140 }, { label: 'left', y: 250 }, { label: 'node.op', y: 360 }];
  return <svg data-demo-transformations data-expanded-places={expanded} data-focused-time={focused} viewBox="0 0 900 520" role="img" aria-label={`${expanded ? 'node.op, left, and right' : 'node.op'} ${focused ? 'at the ^ moment' : 'across time'}`} style={{ width: '100%', height: '100%' }}>
    <path d="M100 40 V460 H836" fill="none" stroke="currentColor" strokeWidth="2.5" />
    <polygon points="100,33 94,47 106,47" fill="currentColor" /><polygon points="843,460 829,454 829,466" fill="currentColor" />
    <text transform="translate(50 250) rotate(-90)" textAnchor="middle" fontSize="36" fill="var(--uist-cyan, #00a8e8)">Place</text>
    <text x="460" y="510" textAnchor="middle" fontSize="36" fill="var(--uist-pink, #ff3d8b)">Time</text>
    <rect data-transformation-region x="340" y={expanded ? 115 : 335} width={focused ? 40 : 440} height={expanded ? 270 : 50} fill={blue} fillOpacity="0.12" stroke={blue} strokeWidth="2.5" />
    {places.map(({ label, y }) => {
      const active = expanded || label === 'node.op';
      return <g key={label} data-transformation-place={label}>
        <text x="305" y={y} dominantBaseline="middle" textAnchor="end" fontSize="28" fill={active ? 'currentColor' : grey}>{label}</text>
        <line x1="360" y1={y} x2="760" y2={y} stroke={active && !focused ? blue : grey} strokeWidth="2.5" />
        {moments.map((x, index) => <circle key={x} data-transformation-point data-selected={active && (!focused || index === 0)} cx={x} cy={y} r="7" fill={active && (!focused || index === 0) ? blue : grey} />)}
      </g>;
    })}
    {['^', '*', '+'].map((op, index) => <text key={op} x={moments[index]} y="430" textAnchor="middle" fontSize="32" fill={!focused || index === 0 ? 'currentColor' : grey}>{op}</text>)}
  </svg>;
}
