import type {
	CartItem,
	CodeVariant,
	IterationTrace,
	PrintOutput,
	TraceResult,
	VarSnapshot,
} from './types.js'

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────

function mulberry32(seed: number): () => number {
	let s = seed | 0
	return () => {
		s = (s + 0x6d2b79f5) | 0
		let t = Math.imul(s ^ (s >>> 15), 1 | s)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function randInt(rng: () => number, min: number, max: number): number {
	return Math.floor(rng() * (max - min + 1)) + min
}

function randFloat(rng: () => number, min: number, max: number, decimals = 2): number {
	const v = rng() * (max - min) + min
	return parseFloat(v.toFixed(decimals))
}

// ── Item name pool ────────────────────────────────────────────────────────

const ITEM_NAMES = [
	'Widget', 'Gadget', 'Sprocket', 'Bolt', 'Washer',
	'Bracket', 'Clip', 'Pin', 'Screw', 'Nut',
	'Rivet', 'Dowel', 'Cap', 'Plug', 'Seal',
	'Ring', 'Flange', 'Sleeve', 'Bushing', 'Shim',
]

// ── Cart item generation ──────────────────────────────────────────────────

function generateCartItems(rng: () => number, count: number): CartItem[] {
	const items: CartItem[] = []
	for (let i = 0; i < count; i++) {
		items.push({
			name: ITEM_NAMES[i % ITEM_NAMES.length]!,
			qty: randInt(rng, 1, 15),
			price: randFloat(rng, 2.0, 15.0),
			free_shipping: false,
		})
	}
	return items
}

// ── Code variant definitions ──────────────────────────────────────────────

function makeCodeVariants() {
	const base: CodeVariant = {
		id: 'base',
		lines: [
			'for item in cart:',
			'    if item.qty >= 10:',
			'        item.price *= 0.9',
			'    ...',
			'    if item.total() > 35:',
			'        item.free_shipping = True',
		],
		printLines: [],
	}

	const printV1: CodeVariant = {
		id: 'print-v1',
		lines: [
			'for item in cart:',
			'    if item.qty >= 10:',
			'        item.price *= 0.9',
			'        print("Price", item.price)',
			'    ...',
			'    if item.total() > 35:',
			'        item.free_shipping = True',
		],
		printLines: [3],
	}

	const printV2: CodeVariant = {
		id: 'print-v2',
		lines: [
			'for item in cart:',
			'    if item.qty >= 10:',
			'        item.price *= 0.9',
			'        print("Price", item.price)',
			'    ...',
			'    if item.total() > 35:',
			'        item.free_shipping = True',
			'        print("Free", item.free_shipping)',
		],
		printLines: [3, 7],
	}

	return { base, printV1, printV2 }
}

// ── Execution tracer ──────────────────────────────────────────────────────

/** Simulate execution of the cart pricing code for one item, recording line visits.
 *  Line indices refer to the variant's `lines` array. */
function traceItem(
	variant: CodeVariant,
	item: CartItem,
	index: number,
): IterationTrace {
	// Work on a copy so mutations don't leak between variants
	const it = { ...item }
	const path: number[] = []
	const snapshots: VarSnapshot[] = []
	const printOutputs: PrintOutput[] = []

	function snap(): VarSnapshot {
		return {
			item: `Item(name='${it.name}', qty=${it.qty}, price=${it.price.toFixed(2)})`,
			cart: '[...]',
			'item.qty': String(it.qty),
			'item.price': it.price.toFixed(2),
			'item.total()': (it.qty * it.price).toFixed(2),
			...(it.free_shipping ? { 'item.free_shipping': 'True' } : {}),
		}
	}

	function visit(line: number) {
		path.push(line)
		snapshots.push(snap())
	}

	// The logic depends on which variant we're running.
	// All variants share the same semantic structure, just with different line offsets.
	if (variant.id === 'base') {
		// line 0: for item in cart:
		visit(0)
		// line 1: if item.qty >= 10:
		visit(1)
		if (it.qty >= 10) {
			// line 2: item.price *= 0.9
			it.price = parseFloat((it.price * 0.9).toFixed(2))
			visit(2)
		}
		// line 3: ...
		visit(3)
		// line 4: if item.total() > 35:
		visit(4)
		if (it.qty * it.price > 35) {
			// line 5: item.free_shipping = True
			it.free_shipping = true
			visit(5)
		}
	} else if (variant.id === 'print-v1') {
		visit(0) // for
		visit(1) // if qty >= 10
		if (it.qty >= 10) {
			it.price = parseFloat((it.price * 0.9).toFixed(2))
			visit(2) // price *= 0.9
			visit(3) // print("Price", item.price)
			printOutputs.push({ line: 3, text: `Price ${it.price.toFixed(2)}` })
		}
		visit(4) // ...
		visit(5) // if total() > 35
		if (it.qty * it.price > 35) {
			it.free_shipping = true
			visit(6) // free_shipping = True
		}
	} else if (variant.id === 'print-v2') {
		visit(0) // for
		visit(1) // if qty >= 10
		if (it.qty >= 10) {
			it.price = parseFloat((it.price * 0.9).toFixed(2))
			visit(2) // price *= 0.9
			visit(3) // print("Price", item.price)
			printOutputs.push({ line: 3, text: `Price ${it.price.toFixed(2)}` })
		}
		visit(4) // ...
		visit(5) // if total() > 35
		if (it.qty * it.price > 35) {
			it.free_shipping = true
			visit(6) // free_shipping = True
			visit(7) // print("Free", item.free_shipping)
			printOutputs.push({ line: 7, text: `Free True` })
		}
	}

	// Update the original item with mutations (price change, free_shipping)
	item.price = it.price
	item.free_shipping = it.free_shipping

	return { index, item: { ...it }, path, snapshots, printOutputs }
}

function executeVariant(variant: CodeVariant, items: CartItem[]): IterationTrace[] {
	// Deep-copy items so each variant traces independently
	const copies = items.map((it) => ({ ...it }))
	return copies.map((item, i) => traceItem(variant, item, i))
}

// ── Chart geometry helpers ────────────────────────────────────────────────

const PLOT_LEFT = 140
const PLOT_RIGHT = 780
const PLOT_TOP = 80
const PLOT_BOTTOM = 420

export function iterToX(idx: number, total: number): number {
	if (total <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2
	return PLOT_LEFT + (idx / (total - 1)) * (PLOT_RIGHT - PLOT_LEFT)
}

function printRowToY(rowIdx: number, totalRows: number): number {
	const step = (PLOT_BOTTOM - PLOT_TOP) / (totalRows + 1)
	// Row 0 is lower (closer to X-axis), higher rows go up
	return PLOT_BOTTOM - step * (rowIdx + 1)
}

// ── Main entry point ──────────────────────────────────────────────────────

export function trace(seed: number, itemCount: number): TraceResult {
	const rng = mulberry32(seed)
	const items = generateCartItems(rng, itemCount)

	const codeVariants = makeCodeVariants()

	// Execute each variant independently
	const baseTraces = executeVariant(codeVariants.base, items)
	const v1Traces = executeVariant(codeVariants.printV1, items)
	const v2Traces = executeVariant(codeVariants.printV2, items)

	// ── Breakpoint snapshots: variable state at the price line per iteration ──
	// In the base variant, line 2 is `item.price *= 0.9`.
	// We want a snapshot for each iteration, taken after executing the price line
	// (or at the start if the price line wasn't visited).
	const breakpointSnapshots: VarSnapshot[] = baseTraces.map((t) => {
		// Find the snapshot at the price line (line 2), or use the last snapshot
		const priceLineIdx = t.path.indexOf(2)
		if (priceLineIdx >= 0) {
			return t.snapshots[priceLineIdx]!
		}
		return t.snapshots[t.snapshots.length - 1]!
	})

	// ── Terminal output: "Price X.XX" lines from V1 traces ──
	const terminalLines: string[][] = []
	for (const t of v1Traces) {
		for (const p of t.printOutputs) {
			const parts = p.text.split(' ')
			terminalLines.push([parts[0]!, parts.slice(1).join(' ')])
		}
	}

	// ── Expanded terminal: "Price X.XX QTY" from V2-like expanded view ──
	const terminalLinesExpanded: string[][] = []
	for (const t of v2Traces) {
		for (const p of t.printOutputs) {
			const parts = p.text.split(' ')
			if (parts[0] === 'Price') {
				terminalLinesExpanded.push([parts[0]!, parts.slice(1).join(' '), String(t.item.qty)])
			} else {
				terminalLinesExpanded.push([parts[0]!, parts.slice(1).join(' ')])
			}
		}
	}

	// ── Cost values for X-axis labels ──
	const costValues = terminalLines.map(([, v]) => v!)

	// ── State variable names for Y-axis ──
	const stateVarNames = ['item', 'cart', 'item.qty', 'item.price', 'item.total()', 'item.free_shipping']

	// ── Print dot positions ──
	// X position is based on the iteration's index in the full input (not the filtered index),
	// so dots from different rows align vertically for the same iteration.
	// Row 1: one dot per iteration that hits printV1's first print line
	const row1Iters = v1Traces.filter((t) => t.printOutputs.some((p) => p.line === codeVariants.printV1.printLines[0]))
	const row1Y = printRowToY(0, 2)
	const row1Dots: [number, number][] = row1Iters.map((t) => [
		iterToX(t.index, itemCount),
		row1Y,
	])

	// Row 2: one dot per iteration that hits printV2's second print line
	const row2Iters = v2Traces.filter((t) => t.printOutputs.some((p) => p.line === codeVariants.printV2.printLines[1]))
	const row2Y = printRowToY(1, 2)
	const row2Dots: [number, number][] = row2Iters.map((t) => [
		iterToX(t.index, itemCount),
		row2Y,
	])

	// ── Breakpoint X positions (one per iteration) ──
	const breakpointXPositions = baseTraces.map((_, i) => iterToX(i, itemCount))

	// ── Autopsy slice positions (one per input, evenly spaced) ──
	const autopsySliceXPositions = Array.from({ length: itemCount }, (_, i) =>
		iterToX(i, itemCount),
	)

	return {
		items,
		codeVariants,
		traces: { base: baseTraces, printV1: v1Traces, printV2: v2Traces },
		breakpointSnapshots,
		terminalLines,
		terminalLinesExpanded,
		costValues,
		stateVarNames,
		printDots: {
			row1: row1Dots, row2: row2Dots,
			row1Indices: row1Iters.map((t) => t.index),
			row2Indices: row2Iters.map((t) => t.index),
		},
		breakpointXPositions,
		autopsySliceXPositions,
	}
}
