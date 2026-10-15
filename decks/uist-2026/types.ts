/** A single cart item used as input to the traced code. */
export interface CartItem {
	name: string
	qty: number
	price: number
	free_shipping: boolean
}

/** Snapshot of all relevant variables at a point during execution. */
export interface VarSnapshot {
	[key: string]: string
}

/** Output of a print statement during one iteration. */
export interface PrintOutput {
	line: number
	text: string
}

/** Trace of a single loop iteration for a given code variant. */
export interface IterationTrace {
	index: number
	item: CartItem
	path: number[]
	snapshots: VarSnapshot[]
	printOutputs: PrintOutput[]
}

/** A code variant (base, with one print, with two prints). */
export interface CodeVariant {
	id: string
	lines: string[]
	printLines: number[]
}

/** Full result of tracing the code across all iterations. */
export interface TraceResult {
	items: CartItem[]

	codeVariants: {
		base: CodeVariant
		printV1: CodeVariant
		printV2: CodeVariant
	}

	traces: {
		base: IterationTrace[]
		printV1: IterationTrace[]
		printV2: IterationTrace[]
	}

	/** Variable state at the breakpoint line (item.price *= 0.9) per iteration. */
	breakpointSnapshots: VarSnapshot[]

	/** Terminal output: [label, value] tuples for "Price" print. */
	terminalLines: string[][]
	/** Terminal output: [label, value, extra] tuples for expanded print. */
	terminalLinesExpanded: string[][]
	/** Extracted price values for the X-axis labels on the state×time chart. */
	costValues: string[]

	/** State variable names for the Y-axis labels. */
	stateVarNames: string[]

	/** SVG dot coordinates for print debugging rows. */
	printDots: {
		row1: [number, number][]
		row2: [number, number][]
		/** Iteration indices corresponding to each row1 dot. */
		row1Indices: number[]
		/** Iteration indices corresponding to each row2 dot. */
		row2Indices: number[]
	}

	/** SVG X positions for breakpoint bar stops. */
	breakpointXPositions: number[]
	/** SVG X positions for autopsy full-height bars. */
	autopsySliceXPositions: number[]
}
