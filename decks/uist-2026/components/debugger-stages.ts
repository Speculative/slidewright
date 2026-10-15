import { execution as tr } from '../chart-data.js';
type Phase = 'code' | 'chart' | 'breakpoint' | 'print' | 'autopsy';
const COST_LINE_IDX = 2;
const FIRST_PRINT_LINE = tr.codeVariants.printV1.printLines[0]!;
const SECOND_PRINT_LINE = tr.codeVariants.printV2.printLines[1]!;
const printExecPathV1 = tr.traces.printV1.map(t => t.path);
const printExecPathV2 = tr.traces.printV2.map(t => t.path);
const stateVarNames = tr.stateVarNames;
const stateVarTargetY = stateVarNames.map((_, i) => 110 + i / (stateVarNames.length - 1) * 320);
const costValues = tr.costValues;
const costLabelTargetX = costValues.map((_, i) => 110 + i / Math.max(costValues.length - 1, 1) * 700);
const printDotsRow1 = tr.printDots.row1;
const printDotsRow2 = tr.printDots.row2;
const terminalLinesV1Iter0 = tr.traces.printV1[0]!.printOutputs.map(o => o.text);
const terminalLinesV1All = tr.traces.printV1.flatMap(t => t.printOutputs.map(o => o.text));
const terminalLinesV2Iter0 = tr.traces.printV2[0]!.printOutputs.map(o => o.text);
const terminalLinesV2All = tr.traces.printV2.flatMap(t => t.printOutputs.map(o => o.text));
const maxBpIter = Math.min(tr.breakpointXPositions.length, 8) - 1;
	export interface StepSnapshot {
		phase: Phase
		showHeading: boolean
		titleLabel: 'none' | 'state' | 'time'
		showAxisCode: boolean
		axisCodeHighlight: 'state-vars' | 'cost' | null
		showCostTerminal: boolean
		showStateVarLabels: boolean
		showCostLabels: boolean
		rightPanel: 'none' | 'variables' | 'terminal'
		stateTimeStep: number
		printCodeVersion: number
		bpDebuggerHighlightLine: number
		bpDebuggerIteration: number
		printDebuggerHighlightLine: number
		instantHighlight: boolean
		printDotsVisibleRow1: number
		printDotsVisibleRow2: number
		printTerminalLines: string[]
		unifiedAccentLines: number[]
		psLabel: { x: number; y: number; rotate: number; fontSize: number }
		tLabel: { x: number; y: number; rotate?: number; fontSize: number }
		axisFade: { codeOpacity: number; terminalOpacity: number; axisOpacity: number }
		stateVarLabelTargets: Array<{ x: number; y: number; opacity: number }>
		costLabelTargets: Array<{ x: number; y: number; rotate: number; opacity: number }>
		bpX: number
	}

	// Default tween positions
	const PS_AXIS = { x: 50, y: 250, rotate: -90, fontSize: 36 }
	const PS_TITLE = { x: 460, y: 60, rotate: 0, fontSize: 72 }
	const T_AXIS = { x: 460, y: 500, fontSize: 36 }
	const T_TITLE = { x: 460, y: 60, fontSize: 72 }
	const FADE_NORMAL = { codeOpacity: 0, terminalOpacity: 0, axisOpacity: 1 }
	const FADE_DIM = { codeOpacity: 0, terminalOpacity: 0, axisOpacity: 0.15 }
	const SVL_HIDDEN = stateVarNames.map(() => ({ x: 460, y: 250, opacity: 0 }))
	const SVL_VISIBLE = stateVarNames.map((_, i) => ({ x: 140, y: stateVarTargetY[i]!, opacity: 1 }))
	const CL_HIDDEN = costValues.map(() => ({ x: 460, y: 250, rotate: 0, opacity: 0 }))
	const CL_VISIBLE = costValues.map((_, i) => ({ x: costLabelTargetX[i]!, y: 430, rotate: -90, opacity: 1 }))

	const BASE: StepSnapshot = {
		phase: 'code', showHeading: true, titleLabel: 'none',
		showAxisCode: false, axisCodeHighlight: null, showCostTerminal: false,
		showStateVarLabels: false, showCostLabels: false,
		rightPanel: 'none', stateTimeStep: 0, printCodeVersion: 0,
		bpDebuggerHighlightLine: -1, bpDebuggerIteration: 0,
		printDebuggerHighlightLine: -1, instantHighlight: false,
		printDotsVisibleRow1: 0, printDotsVisibleRow2: 0,
		printTerminalLines: [], unifiedAccentLines: [],
		psLabel: PS_AXIS, tLabel: T_AXIS, axisFade: FADE_NORMAL,
		stateVarLabelTargets: SVL_HIDDEN, costLabelTargets: CL_HIDDEN,
		bpX: tr.breakpointXPositions[0] ?? 200,
	}

	function s(overrides: Partial<StepSnapshot>): StepSnapshot {
		return { ...BASE, ...overrides }
	}

	// Count dots in first iteration of print V1
	const v1Iter0Dots = printExecPathV1[0]!.filter(l => l === FIRST_PRINT_LINE).length
	// Count dots in first iteration of print V2
	const v2Iter0DotsR1 = printExecPathV2[0]!.filter(l => l === FIRST_PRINT_LINE).length
	const v2Iter0DotsR2 = printExecPathV2[0]!.filter(l => l === SECOND_PRINT_LINE).length

	export const STEPS: StepSnapshot[] = [
		// 0: code phase
		s({}),
		// 1: chart phase (axes appear)
		s({ phase: 'chart', showHeading: false }),
		// 2: "program state" flies to title
		s({ phase: 'chart', showHeading: false, titleLabel: 'state',
			psLabel: PS_TITLE, axisFade: FADE_DIM }),
		// 3: code overlay, state-vars highlighted
		s({ phase: 'chart', showHeading: false, titleLabel: 'state',
			psLabel: PS_TITLE, axisFade: { ...FADE_DIM, codeOpacity: 1 },
			showAxisCode: true, axisCodeHighlight: 'state-vars' }),
		// 4: state var labels distributed on Y-axis
		s({ phase: 'chart', showHeading: false, titleLabel: 'state',
			psLabel: PS_TITLE, axisFade: FADE_DIM,
			showStateVarLabels: true, stateVarLabelTargets: SVL_VISIBLE }),
		// 5: labels fade, "program state" back to axis
		s({ phase: 'chart', showHeading: false,
			showStateVarLabels: true, stateVarLabelTargets: SVL_HIDDEN }),
		// 6: "time" flies to title
		s({ phase: 'chart', showHeading: false, titleLabel: 'time',
			tLabel: T_TITLE, axisFade: FADE_DIM }),
		// 7: cost code + terminal overlay
		s({ phase: 'chart', showHeading: false, titleLabel: 'time',
			tLabel: T_TITLE, axisFade: { ...FADE_DIM, codeOpacity: 1, terminalOpacity: 1 },
			showAxisCode: true, axisCodeHighlight: 'cost', showCostTerminal: true }),
		// 8: cost labels distributed on X-axis
		s({ phase: 'chart', showHeading: false, titleLabel: 'time',
			tLabel: T_TITLE, axisFade: FADE_DIM,
			showCostLabels: true, costLabelTargets: CL_VISIBLE }),
		// 9: labels fade, "time" back to axis
		s({ phase: 'chart', showHeading: false,
			showCostLabels: true, costLabelTargets: CL_HIDDEN }),
		// 10: breakpoint mode
		s({ phase: 'breakpoint', showHeading: false, stateTimeStep: 1,
			rightPanel: 'variables', bpDebuggerHighlightLine: COST_LINE_IDX,
			bpDebuggerIteration: 0, bpX: tr.breakpointXPositions[0] ?? 200 }),
		// 11: one slow "Continue" (end state: iteration 1)
		s({ phase: 'breakpoint', showHeading: false, stateTimeStep: 1,
			rightPanel: 'variables', bpDebuggerHighlightLine: COST_LINE_IDX,
			bpDebuggerIteration: 1, bpX: tr.breakpointXPositions[1] ?? 420 }),
		// 12: fast-forward remaining iterations
		s({ phase: 'breakpoint', showHeading: false, stateTimeStep: 1,
			rightPanel: 'variables', bpDebuggerHighlightLine: COST_LINE_IDX,
			bpDebuggerIteration: maxBpIter, bpX: tr.breakpointXPositions[maxBpIter] ?? 700 }),
		// 13: transition to print
		s({ phase: 'print', showHeading: false, stateTimeStep: 2,
			rightPanel: 'terminal' }),
		// 14: add first print statement
		s({ phase: 'print', showHeading: false, stateTimeStep: 4,
			rightPanel: 'terminal', printCodeVersion: 1 }),
		// 15: V1 slow first iteration done
		s({ phase: 'print', showHeading: false, stateTimeStep: 5,
			rightPanel: 'terminal', printCodeVersion: 1,
			printDotsVisibleRow1: v1Iter0Dots,
			printTerminalLines: terminalLinesV1Iter0 }),
		// 16: V1 fast-forward done
		s({ phase: 'print', showHeading: false, stateTimeStep: 5,
			rightPanel: 'terminal', printCodeVersion: 1,
			printDotsVisibleRow1: printDotsRow1.length,
			printTerminalLines: terminalLinesV1All }),
		// 17: add second print, clear dots/terminal
		s({ phase: 'print', showHeading: false, stateTimeStep: 6,
			rightPanel: 'terminal', printCodeVersion: 2 }),
		// 18: V2 slow first iteration done
		s({ phase: 'print', showHeading: false, stateTimeStep: 7,
			rightPanel: 'terminal', printCodeVersion: 2,
			printDotsVisibleRow1: v2Iter0DotsR1, printDotsVisibleRow2: v2Iter0DotsR2,
			printTerminalLines: terminalLinesV2Iter0 }),
		// 19: V2 fast-forward done
		s({ phase: 'print', showHeading: false, stateTimeStep: 7,
			rightPanel: 'terminal', printCodeVersion: 2,
			printDotsVisibleRow1: printDotsRow1.length, printDotsVisibleRow2: printDotsRow2.length,
			printTerminalLines: terminalLinesV2All }),
		// 20: zigzag interleaved line
		s({ phase: 'print', showHeading: false, stateTimeStep: 10,
			rightPanel: 'terminal', printCodeVersion: 2,
			printDotsVisibleRow1: printDotsRow1.length, printDotsVisibleRow2: printDotsRow2.length,
			printTerminalLines: terminalLinesV2All }),
		// 21: autopsy — blue vertical bars
		s({ phase: 'autopsy', showHeading: false, stateTimeStep: 11 }),
	]

export interface ExecutionFrame { line: number; iteration: number; terminal: string[]; row1: number; row2: number }
export function executionFrames(step: number): ExecutionFrame[] {
  if (step === 11 || step === 12) {
    const iterations = step === 11 ? [0, 1] : [1, 2, 3, 4, 5, 6, 7];
    return iterations.flatMap(iteration => tr.traces.base[iteration]!.path.map(line => ({ line, iteration, terminal: [], row1: 0, row2: 0 })));
  }
  if (![15, 16, 18, 19].includes(step)) return [];
  const v2 = step >= 18;
  const traces = v2 ? tr.traces.printV2 : tr.traces.printV1;
  const terminal: string[] = [];
  let row1 = 0, row2 = 0;
  const firstPrint = (v2 ? tr.codeVariants.printV2 : tr.codeVariants.printV1).printLines[0]!;
  const secondPrint = tr.codeVariants.printV2.printLines[1]!;
  return (step === 15 || step === 18 ? traces.slice(0, 1) : traces).flatMap(iteration => iteration.path.flatMap(line => {
    const output = iteration.printOutputs.find(output => output.line === line);
    if (output) { terminal.push(output.text); if (line === firstPrint) row1++; if (line === secondPrint) row2++; }
    return [16, 19].includes(step) && iteration.index === 0 ? [] : [{ line, iteration: iteration.index, terminal: [...terminal], row1, row2 }];
  }));
}
