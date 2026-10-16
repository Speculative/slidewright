import { useBuildStep } from '../../../slidewright/runtime/presentation.js';
import { useEffect, useId, useState } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { execution, printDots, shipping, shippingY, totalY, stepSequence } from '../chart-data.js';

export const chartModes = ['collection', 'streams', 'stepping', 'computed', 'filtering'] as const;
export type ChartMode = typeof chartModes[number];
export const slidewright: ComponentMeta = {
  produces: 'block', slots: {},
  params: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, width: { type: 'number', default: 1200 }, height: { type: 'number', default: 740 }, mode: { type: 'string', default: 'collection' } },
  editor: { inspector: ['x', 'y', 'width', 'height', 'mode'] },
};
export const canvas = makeRectAdapter({ width: 1200, height: 740 });
export function chartStepCount(mode: ChartMode): number { return mode === 'streams' ? 2 : mode === 'stepping' ? stepSequence.length : 3; }
export default function StateTimeChart({ params }: ComponentRenderProps) {
  const mode: ChartMode = chartModes.includes(params.mode as ChartMode) ? params.mode as ChartMode : 'collection';
  const arrowId = `chart-arrow-${useId().replace(/:/g, '')}`;
  const { step, setStep, presenting } = useBuildStep(chartStepCount(mode));
  const [playing, setPlaying] = useState(false);
  const count = chartStepCount(mode);
  useEffect(() => { setStep(0); setPlaying(false); }, [mode]);
  useEffect(() => {
    if (!playing || presenting) return;
    const timer = setInterval(() => setStep(value => { if (value >= count - 1) { setPlaying(false); return value; } return value + 1; }), mode === 'stepping' ? 400 : 1200);
    return () => clearInterval(timer);
  }, [playing, count, mode, presenting]);
  const bars = mode !== 'filtering' && mode !== 'stepping' && (mode !== 'collection' || step === 2);
  const dots = mode !== 'filtering' && (mode !== 'collection' || step >= 1);
  const streams = ['computed'].includes(mode) || mode === 'streams' && step > 0;
  const filtered = shipping.filter(dot => dot.isTrue);
  const middle = Math.floor(execution.printDots.row1.length / 2);
  const blue = '#1E40AF', red = '#991B1B';
  const appear = (duration: number, delay = 0) => ({ animation: `sw-chart-appear ${duration}ms ease-out ${delay}ms both` });
  const printReveal = mode === 'collection' && step === 1;
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return <div data-sw-chart={mode} data-step={step} style={{ position: 'absolute', left: Number(params.x), top: Number(params.y), width: Number(params.width), height: Number(params.height), display: 'flex', flexDirection: 'column', background: 'white', color: 'black' }}>
    <svg viewBox="0 0 900 520" role="img" aria-label={`${mode} state and time chart`} style={{ width: '100%', height: 'calc(100% - 45px)', fontFamily: 'var(--font-body, sans-serif)' }}>
      <style>{`@keyframes sw-chart-appear { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sw-chart-disappear { from { opacity: 1; } to { opacity: 0; } }`}</style>
      <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill={blue} /></marker></defs>
      <rect x="100" y="40" width="720" height="420" fill="white" stroke="#e5e7eb" />
      {bars && execution.autopsySliceXPositions.map((x, index) => <rect key={index} data-chart-slice x={x - 12} y="40" width="24" height="420" rx="4" fill={blue} fillOpacity=".2" style={mode === 'collection' ? appear(150, index * 60) : undefined} />)}
      {mode === 'collection' && step < 2 && <rect key={`breakpoint-${step}`} data-chart-breakpoint x={execution.breakpointXPositions[3]! - 12} y="40" width="24" height="420" fill={blue} style={step === 1 ? { animation: 'sw-chart-disappear 400ms ease-out both' } : undefined} />}
      {mode === 'stepping' && <rect data-chart-cursor x={printDots[stepSequence[step]!]![0] - 12} y="40" width="24" height="420" rx="4" fill={blue} fillOpacity=".2" style={{ transition: 'x .2s ease' }} />}
      {streams && [execution.printDots.row1[0]![1], shippingY].map((y, index) => <rect key={y} data-chart-stream x="100" y={y - 12} width="720" height="24" fill={red} fillOpacity=".2" rx="4" style={mode === 'streams' ? appear(150, index * 60) : undefined} />)}
      {dots && <>
        {printDots.map(([cx, cy], index) => <g key={index}>
          {index > 0 && <line x1={printDots[index - 1]![0]} y1={printDots[index - 1]![1]} x2={cx} y2={cy} stroke={red} strokeWidth="2.5" strokeLinecap="round" style={printReveal ? appear(100, index * 30) : undefined} />}
          <circle data-chart-dot cx={cx} cy={cy} r={mode === 'stepping' && index === stepSequence[step] ? 10 : 6} fill={red} style={printReveal ? appear(100, index * 30) : { transition: 'r .2s ease' }} />
        </g>)}
        <text x={execution.printDots.row1[0]![0]} y={execution.printDots.row1[0]![1] + 28} fontSize="20" fill={red} style={printReveal ? appear(300) : undefined}>price</text>
        <text x={execution.printDots.row2[0]![0]} y={shippingY - 14} fontSize="20" fill={red} style={printReveal ? appear(300) : undefined}>free_shipping</text>
      </>}
      {mode === 'computed' && step > 0 && <>
        {step === 2 && <rect x="100" y={totalY - 12} width="720" height="24" fill={red} fillOpacity=".2" rx="4" style={appear(300)} />}
        <circle data-chart-price-highlight cx={execution.printDots.row1[middle]![0]} cy={execution.printDots.row1[middle]![1]} r="12" fill="none" stroke={red} strokeWidth="2" style={appear(300)} />
        {execution.printDots.row1.map(([x, y], index) => step === 2 || index === middle ? <g key={index} data-chart-total>
          <line x1={x} y1={y + (index === middle ? 12 : 8)} x2={x} y2={totalY - 8} stroke={blue} strokeWidth="2" strokeDasharray="4 3" markerEnd={`url(#${arrowId})`} style={appear(index === middle ? 300 : 200, index === middle ? 200 : index * 40)} />
          <circle cx={x} cy={totalY} r="6" fill={blue} style={appear(index === middle ? 300 : 200, index === middle ? 300 : index * 40 + 100)} />
        </g> : null)}
        <text key={`total-label-${step}`} style={appear(300, step === 1 ? 400 : 0)} x={execution.printDots.row1[step === 1 ? middle : 0]![0]} y={totalY + 28} fontSize="20" fill={blue}>total()</text>
      </>}
      {mode === 'filtering' && <>
        <line key={`filter-line-${step === 2}`} data-chart-filter-line style={step === 2 ? appear(300, 400) : undefined} x1={(step === 2 ? filtered : shipping)[0]!.x} x2={(step === 2 ? filtered : shipping).at(-1)!.x} y1={shippingY} y2={shippingY} stroke={red} strokeWidth="2.5" />
        {shipping.map((dot, index) => {
          const selected = step > 0 && dot.isTrue;
          const filteredIndex = filtered.indexOf(dot);
          const x = step === 2 && dot.isTrue ? filtered[0]!.x + filteredIndex / Math.max(filtered.length - 1, 1) * (filtered.at(-1)!.x - filtered[0]!.x) : dot.x;
          return <g key={index} data-chart-shipping data-included={dot.isTrue} style={{ opacity: step === 2 && !dot.isTrue ? 0 : 1, transformOrigin: `${dot.x}px ${shippingY}px`, transform: step === 2 && !dot.isTrue ? 'translateY(80px) scale(.3)' : 'none', transition: 'opacity .4s ease-out, transform .4s ease-out' }}>
            <circle cx={x} cy={shippingY} r={selected ? 10 : 8} fill={dot.isTrue ? blue : '#EA580C'} stroke={selected ? blue : 'none'} strokeWidth={selected ? 3 : 0} style={{ transition: 'cx .6s ease-out, r .3s ease-out' }} />
            {selected && step === 1 && <circle cx={x} cy={shippingY} data-chart-selection r="16" fill="none" stroke={blue} strokeWidth="2" strokeDasharray="4 3" style={appear(300, index * 30)} />}
          </g>;
        })}
        <text x="110" y={shippingY + 32} fontSize="20" fill={red}>free_shipping</text>
        <circle cx="620" cy="70" r="8" fill={blue} /><text x="636" y="76" fontSize="18" fill={blue}>True</text><circle cx="710" cy="70" r="8" fill="#EA580C" /><text x="726" y="76" fontSize="18" fill="#EA580C">False</text>
      </>}
      <path d="M100 40 V460 H836" fill="none" stroke="black" strokeWidth="2.5" />
      <polygon points="100,33 94,47 106,47" /><polygon points="843,460 829,454 829,466" />
      <text x="50" y="250" textAnchor="middle" transform="rotate(-90 50 250)" fontSize="28">program state</text>
      <text x="460" y="500" textAnchor="middle" fontSize="28">time</text>
      {mode === 'collection' && step === 1 && <text x="460" y="25" textAnchor="middle" fontSize="28" fontWeight="bold" fill={blue} style={{ animation: 'sw-chart-disappear 400ms ease-out both' }}>breakpoint debugger</text>}
      <text key={`title-${step}`} style={mode === 'collection' && step > 0 ? appear(500, step === 1 ? 300 : 0) : undefined} fontWeight="bold" x="460" y="25" textAnchor="middle" fontSize="28" fill={mode === 'collection' && step === 1 ? red : blue}>{mode === 'collection' ? ['breakpoint debugger', 'print debugging', 'autopsy'][step] : 'autopsy'}</text>
    </svg>
    {!presenting && <div role="group" aria-label="Chart playback" onPointerDown={stop} onDoubleClick={stop} onKeyDown={stop} style={{ display: 'flex', gap: 10, justifyContent: 'center', height: 45, fontSize: 20 }}>
      <button type="button" disabled={step === 0} onClick={() => { setPlaying(false); setStep(value => value - 1); }}>Previous step</button>
      <span aria-live="polite">{step + 1} / {count}</span>
      <button type="button" disabled={step === count - 1} onClick={() => { setPlaying(false); setStep(value => value + 1); }}>Next step</button>
      <button type="button" onClick={() => { if (step === count - 1) setStep(0); setPlaying(value => !value); }}>{playing ? 'Pause chart' : 'Play chart'}</button>
      <button type="button" onClick={() => { setPlaying(false); setStep(0); }}>Reset chart</button>
    </div>}
  </div>;
}
