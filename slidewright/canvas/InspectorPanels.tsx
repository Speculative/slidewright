// Slidewright canvas — inspector panels (hierarchy + properties).
//
// Hierarchy lives in the bottom dock alongside optional source/notes.
// Properties lives in the right sidebar, alongside authoring controls.
//
// Hierarchy: read-only tree of the active slide's shapes, with
// two-way selection sync to the canvas.
//
// Properties: read-write key/value editor for the selected shape's
// slot fills. Edits commit via the same source-splicing mechanism
// gestures use, so they enter the unified canvas-side undo stack.
// Currently single-select only; multi-select shows a hint.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react';

import {
  isRenderableSlotType,
  type ShapeData,
  type SlideAstData,
} from '../runtime/loader.js';
import type { Component, SlotFill, Value } from '../runtime/ast.js';
import { emit } from '../runtime/emitter.js';
import { parse } from '../runtime/parser.js';
import type {
  ComponentMeta,
  ComponentRegistry,
  SlotType,
} from '../runtime/contract.js';
import { ColorPicker } from './ColorPicker.js';
import { ColorPopover, ColorPalette, readColorValueCss } from './ColorControls.js';
import { isLayoutAdapter } from './layout-adapter.js';
import type { SourceRange } from './host.js';
import {
  componentTarget,
  slideTarget,
  type SelectionTarget,
} from './selection-target.js';

// Small SVG icons rendered inline. Sized to match a 12px text
// baseline; stroke-only so they take on `currentColor` and play
// well with hover/disabled state changes. No external icon library
// — these two glyphs are all the inspector needs today.
function ArrowRightIcon(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 6h7" />
      <path d="M6 3l3 3-3 3" />
    </svg>
  );
}

function XIcon(): ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3l6 6" />
      <path d="M9 3l-6 6" />
    </svg>
  );
}

interface HierarchyPanelProps {
  shapes: ReadonlyMap<string, ShapeData>;
  activeIdx: number;
  // The active slide's AST + meta. Rendered as the first row of the
  // hierarchy with no indentation change — the slide is the
  // implicit container of everything below it, so it doesn't earn
  // an indent level. Falls back to null when the deck has no slides
  // (e.g., during partial loads). When null, the row is omitted.
  activeSlide: SlideAstData | null;
  selected: readonly SelectionTarget[];
  onSelect: (target: SelectionTarget, modifiers: { shift: boolean }) => void;
  onJumpToSource: (range: SourceRange) => void;
}

// Tree node carried through the recursive walker. Only canvas-
// registered components (those that resolve to ShapeData via
// spanKey) earn a node — non-selectable components are skipped,
// but the walker still recurses through them to find selectable
// descendants. `inList` flips on for items inside an array-typed
// fill; their slot label is omitted (the slot name is shared with
// siblings and would just repeat).
interface HierarchyNode {
  comp: Component;
  slotName: string | null;
  depth: number;
  inList: boolean;
}

export function HierarchyPanel({
  shapes,
  activeIdx,
  activeSlide,
  selected,
  onSelect,
  onJumpToSource,
}: HierarchyPanelProps): ReactElement {
  // Build the tree by walking the active slide's AST. The Slide
  // itself is the implicit root (rendered as its own row above the
  // tree); recursion starts at Slide.content. Only components with
  // a registered ShapeData entry are emitted, but the walker
  // recurses through non-canvas components too — a hypothetical
  // CustomLayout without an adapter shouldn't hide its CardRow
  // children.
  const unified = activeSlide
    ? unifiedSlideContent(activeSlide, shapes)
    : null;
  const unifiedKey = unified
    ? `${unified.comp.span.start.offset}-${unified.comp.span.end.offset}`
    : null;

  const nodes = useMemo(() => {
    if (!activeSlide) return [];
    const out: HierarchyNode[] = [];
    const visit = (
      comp: Component,
      slotName: string | null,
      depth: number,
      inList: boolean,
    ): void => {
      const key = `${comp.span.start.offset}-${comp.span.end.offset}`;
      // The unified slide-content component is folded into the
      // Slide row (see unifiedSlideContent) — no row of its own;
      // its children surface at the top level.
      const hasShape = shapes.has(key) && key !== unifiedKey;
      let childDepth = depth;
      if (hasShape) {
        out.push({ comp, slotName, depth, inList });
        childDepth = depth + 1;
      }
      // Explicit fills, in source order.
      for (const fill of comp.fills) {
        if (fill.value.kind === 'component') {
          visit(fill.value, fill.name, childDepth, false);
        } else if (fill.value.kind === 'list') {
          for (const item of fill.value.items) {
            if (item.kind === 'component') {
              visit(item, fill.name, childDepth, true);
            }
          }
        }
      }
      // Implicit children fill the `children` slot.
      for (const child of comp.implicitChildren) {
        visit(child, 'children', childDepth, true);
      }
    };
    // Slide is the root. Recurse into Slide.content if it's a
    // component (typical case: a slide-content component or
    // Freeform); list-typed Slide.content isn't a supported shape
    // today but the walker handles it generically.
    for (const fill of activeSlide.comp.fills) {
      if (fill.name !== 'content') continue;
      if (fill.value.kind === 'component') {
        visit(fill.value, 'content', 0, false);
      } else if (fill.value.kind === 'list') {
        for (const item of fill.value.items) {
          if (item.kind === 'component') {
            visit(item, 'content', 0, true);
          }
        }
      }
    }
    return out;
  }, [activeSlide, shapes, unifiedKey]);

  const isSelected = (comp: Component): boolean => {
    const start = comp.span.start.offset;
    const end = comp.span.end.offset;
    return selected.some(
      (s) =>
        s.kind === 'component' &&
        s.span.start === start &&
        s.span.end === end,
    );
  };

  // The slide row also reads as selected when the unified content
  // component is what's actually selected (canvas drill chain) —
  // the two are one surface in the inspector.
  const slideSelected = selected.some(
    (s) =>
      s.kind === 'slide' ||
      (unified !== null &&
        s.kind === 'component' &&
        s.span.start === unified.comp.span.start.offset &&
        s.span.end === unified.comp.span.end.offset),
  );
  const slideLabel = activeSlide ? readSlideLabel(activeSlide) : null;

  return (
    <div className="sw-inspector-panel sw-hierarchy-panel">
      <div className="sw-inspector-panel-header">Hierarchy</div>
      <div className="sw-inspector-panel-body">
        <ul className="sw-hierarchy-tree" role="tree">
          {activeSlide ? (
            <li
              key="slide"
              className={
                'sw-hierarchy-slide-row' + (slideSelected ? ' selected' : '')
              }
              role="treeitem"
              aria-selected={slideSelected}
              data-sw-slide-row="true"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  onJumpToSource({
                    start: activeSlide.comp.span.start.offset,
                    end: activeSlide.comp.span.end.offset,
                  });
                  return;
                }
                onSelect(slideTarget(), { shift: e.shiftKey });
              }}
            >
              <span className="sw-hierarchy-slide-name">
                {activeSlide.comp.name}
              </span>
              {slideLabel ? (
                <span className="sw-hierarchy-slide-meta">· {slideLabel}</span>
              ) : (
                <span className="sw-hierarchy-slide-meta">#{activeIdx + 1}</span>
              )}
            </li>
          ) : null}
          {nodes.length === 0 ? (
            <li className="sw-inspector-panel-empty">
              (no shapes on this slide)
            </li>
          ) : null}
          {nodes.map((node) => {
            const range: SourceRange = {
              start: node.comp.span.start.offset,
              end: node.comp.span.end.offset,
            };
            const sel = isSelected(node.comp);
            // Slot prefix appears only when this row fills a
            // named, single-component slot (not when it's an item
            // inside an array-typed fill — sharing siblings would
            // just repeat the slot name).
            const showSlot = node.slotName && !node.inList;
            const data = shapes.get(`${range.start}-${range.end}`);
            const adapterKind = data
              ? isLayoutAdapter(data.canvas)
                ? 'layout'
                : 'shape'
              : 'other';
            return (
              <li
                key={`${range.start}-${range.end}`}
                className={
                  'sw-hierarchy-node' + (sel ? ' selected' : '')
                }
                role="treeitem"
                aria-selected={sel}
                aria-level={node.depth + 1}
                data-sw-component={node.comp.name}
                data-sw-adapter-kind={adapterKind}
                data-sw-span-start={range.start}
                data-sw-span-end={range.end}
                style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                onClick={(e) => {
                  // Ctrl/Cmd+click jumps the editor cursor to the
                  // shape's source span (VS Code "go to
                  // definition" mental model). Plain click is
                  // selection.
                  if (e.ctrlKey || e.metaKey) {
                    onJumpToSource(range);
                    return;
                  }
                  onSelect(componentTarget(range), { shift: e.shiftKey });
                }}
              >
                {showSlot ? (
                  <span className="sw-hierarchy-node-slot">
                    {node.slotName} ·{' '}
                  </span>
                ) : null}
                <span className="sw-hierarchy-node-name">
                  {node.comp.name}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

interface PropertiesPanelProps {
  // Resolved single-selected component shape — null for slot
  // selections, non-component targets, or no selection.
  componentShape: ShapeData | null;
  // Resolved slot context — non-null when the single-selected
  // target is a slot. Includes the slot's fill (for value
  // rendering / editing) and the parent shape (for header context).
  slotInfo: SlotInfo | null;
  // Resolved empty-slot context — non-null when the single-selected
  // target is an empty slot (no fill in source). For text slots,
  // the inspector shows an input that materializes a fill on
  // commit; for non-text slots, a "(empty)" hint pending the slot-
  // targeted insertion-gestures milestone.
  emptySlotInfo: EmptySlotInfo | null;
  // The active slide's AST + meta. Used when the single-selected
  // target has kind 'slide' OR when nothing is selected (the
  // default panel state is "showing the slide"). Null when there's
  // no slide to display.
  activeSlide: SlideAstData | null;
  // Count of all selected items. > 1 short-circuits to a multi-
  // select hint regardless of kind.
  multiCount: number;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
  // Drag-to-scrub session lifecycle. PropertyRow calls onScrubBegin
  // when the user pointerdowns on a numeric key, onScrubPreview on
  // each pointermove (intermediate source that the host applies
  // without pushing undo), and onScrubEnd on pointerup. The end
  // callback receives the final source (commit) or null (cancel);
  // the App is responsible for pushing one undo entry per scrub
  // session.
  onScrubBegin: () => void;
  onScrubPreview: (newSource: string) => void;
  onScrubEnd: (finalSource: string | null) => void;
  // Materialize an empty text slot's fill: write `slotName: "<value>"`
  // into the parent component's body, commit the new source. Used
  // by the empty-slot inspector view's text input.
  onMaterializeTextSlot: (
    parentSpan: SourceRange,
    slotName: string,
    value: string,
  ) => void;
  // Navigate selection to a nested component referenced from inside
  // the property panel. Used by the drill button on component-
  // typed slot rows ("→" arrow next to a `content: ContentSlide`
  // value, e.g.) — clicking drills the canvas + inspector into
  // that component's properties.
  onSelectComponent: (range: SourceRange) => void;
  // Remove an item from a list-typed slot fill — invoked from the
  // × button on each array-row item in the inspector. App handles
  // the AST mutation (removing the item from its containing list)
  // via commitSourceEdit. Range is the item's full source span.
  onRemoveListItem: (range: SourceRange) => void;
  // Loader's shapes registry. SlidePropertiesView reads it to look
  // up the slide-content component's meta when unifying Slide +
  // content rows into a single panel (see SLIDEWRIGHT.md /
  // Implementation notes / Inspector and source surfaces).
  shapes: ReadonlyMap<string, ShapeData>;
  // Deck-scope color tokens (`accent`, `magenta`, …). Rendered as
  // the global swatch row above any color-typed PropertyRow editor.
  // Click → splices the bare token name into the slot's value span.
  colorTokens: Record<string, string>;
  // Distinct color values literally appearing in the active slide's
  // source (token name_refs + oklch literals, deduped against
  // `colorTokens` so the per-slide row doesn't echo global swatches).
  // Walked once per render in App.tsx.
  slideColors: SlideColor[];
}

// One per-slide color swatch. `sourceText` is what gets spliced into
// the target value span on click — `amber` for a name_ref, `oklch(L
// C H)` for a literal. `cssValue` is what the swatch should be
// painted as (`var(--amber)` / `oklch(L C H)` respectively).
export interface SlideColor {
  sourceText: string;
  cssValue: string;
}

export interface SlotInfo {
  slotName: string;
  fill: SlotFill;
  parentShape: ShapeData;
}

export interface EmptySlotInfo {
  slotName: string;
  slotType: SlotType;
  parentShape: ShapeData;
}

export function PropertiesPanel({
  componentShape,
  slotInfo,
  emptySlotInfo,
  activeSlide,
  multiCount,
  source,
  onCommit,
  onScrubBegin,
  onScrubPreview,
  onScrubEnd,
  onMaterializeTextSlot,
  onSelectComponent,
  onRemoveListItem,
  shapes,
  colorTokens,
  slideColors,
}: PropertiesPanelProps): ReactElement {
  const scrubProps = { onScrubBegin, onScrubPreview, onScrubEnd };
  const paletteProps: PaletteProps = { colorTokens, slideColors };
  if (multiCount > 1) {
    return (
      <PanelFrame header="Properties">
        <div className="sw-inspector-panel-empty">
          Select one element to edit its properties.
        </div>
      </PanelFrame>
    );
  }
  const selectedSlot = slotInfo ?? emptySlotInfo;
  if (selectedSlot?.parentShape.meta.editor && !selectedSlot.parentShape.meta.editor.inspector.includes(selectedSlot.slotName)) {
    return <ComponentPropertiesView shape={selectedSlot.parentShape} source={source} onCommit={onCommit}
      scrubProps={scrubProps} paletteProps={paletteProps} onSelectComponent={onSelectComponent} onRemoveListItem={onRemoveListItem} />;
  }
  if (slotInfo) {
    return (
      <SlotPropertiesView
        slotInfo={slotInfo}
        source={source}
        onCommit={onCommit}
        scrubProps={scrubProps}
        paletteProps={paletteProps}
        onSelectComponent={onSelectComponent}
        onRemoveListItem={onRemoveListItem}
      />
    );
  }
  if (emptySlotInfo) {
    return (
      <EmptySlotPropertiesView
        info={emptySlotInfo}
        onMaterializeTextSlot={onMaterializeTextSlot}
      />
    );
  }
  if (componentShape) {
    // A slide-content component that unifies with the Slide row has
    // no panel of its own — selecting it on the canvas (drill chain)
    // lands on the same unified panel as the slide row, so both
    // routes show one surface.
    const unified = activeSlide
      ? unifiedSlideContent(activeSlide, shapes)
      : null;
    if (
      unified &&
      activeSlide &&
      unified.comp.span.start.offset ===
        componentShape.comp.span.start.offset &&
      unified.comp.span.end.offset === componentShape.comp.span.end.offset
    ) {
      return (
        <SlidePropertiesView
          slide={activeSlide}
          source={source}
          onCommit={onCommit}
          scrubProps={scrubProps}
          paletteProps={paletteProps}
          onSelectComponent={onSelectComponent}
          onRemoveListItem={onRemoveListItem}
          shapes={shapes}
        />
      );
    }
    return (
      <ComponentPropertiesView
        shape={componentShape}
        source={source}
        onCommit={onCommit}
        scrubProps={scrubProps}
        paletteProps={paletteProps}
        onSelectComponent={onSelectComponent}
        onRemoveListItem={onRemoveListItem}
      />
    );
  }
  // No specific selection — fall through to the slide. This makes
  // "nothing selected" mean "I'm editing the slide", which matches
  // how users think about the inspector when they've just dismissed
  // a shape selection.
  if (activeSlide) {
    return (
      <SlidePropertiesView
        slide={activeSlide}
        source={source}
        onCommit={onCommit}
        scrubProps={scrubProps}
        paletteProps={paletteProps}
        onSelectComponent={onSelectComponent}
        onRemoveListItem={onRemoveListItem}
        shapes={shapes}
      />
    );
  }
  return (
    <PanelFrame header="Properties">
      <div className="sw-inspector-panel-empty">(no selection)</div>
    </PanelFrame>
  );
}

function PanelFrame({
  header,
  children,
}: {
  header: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="sw-inspector-panel sw-properties-panel">
      <div className="sw-inspector-panel-header">{header}</div>
      <div className="sw-inspector-panel-body">{children}</div>
    </div>
  );
}

interface ScrubProps {
  onScrubBegin: () => void;
  onScrubPreview: (newSource: string) => void;
  onScrubEnd: (finalSource: string | null) => void;
}

interface PaletteProps {
  colorTokens: Record<string, string>;
  slideColors: SlideColor[];
}

function ComponentPropertiesView({
  shape,
  source,
  onCommit,
  scrubProps,
  paletteProps,
  onSelectComponent,
  onRemoveListItem,
}: {
  shape: ShapeData;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
  scrubProps: ScrubProps;
  paletteProps: PaletteProps;
  onSelectComponent: (range: SourceRange) => void;
  onRemoveListItem: (range: SourceRange) => void;
}): ReactElement {
  const header = `${shape.comp.name} #${shape.childIdx}`;
  // Wrap commit to preserve selection on the same shape across the
  // edit. The edit happens inside this shape's body, so the shape's
  // start offset is unchanged and the end shifts by the source-
  // length delta. Without this, the subscribe handler treats the
  // commit as having no pending selection and clears.
  const wrappedCommit = (newSource: string): void => {
    const delta = newSource.length - source.length;
    const newRange: SourceRange = {
      start: shape.comp.span.start.offset,
      end: shape.comp.span.end.offset + delta,
    };
    onCommit(newSource, [newRange]);
  };
  const rows = buildPropertyRowDescriptors(shape.comp, shape.meta);
  if (rows.length === 0) {
    return (
      <PanelFrame header={header}>
        <div className="sw-inspector-panel-empty">(no parameters)</div>
      </PanelFrame>
    );
  }
  return (
    <PanelFrame header={header}>
      <div className="sw-properties-rows">
        {rows.map((row) =>
          row.kind === 'filled' ? (
            <PropertyRow
              key={`${shape.slideIdx}-${shape.childIdx}-${row.fill.name}`}
              fill={row.fill}
              choices={row.choices}
              source={source}
              onCommit={wrappedCommit}
              slotType={fillSlotType(shape.meta, row.fill.name)}
              omitType={omitSlotType(shape.meta, row.fill.name)}
              paletteProps={paletteProps}
              onSelectComponent={onSelectComponent}
              onRemoveListItem={onRemoveListItem}
              {...scrubProps}
            />
          ) : (
            <MissingPropertyRow
              key={`missing-${shape.slideIdx}-${shape.childIdx}-${row.name}`}
              name={row.name}
              choices={row.choices}
              slotType={row.slotType}
              defaultValue={row.defaultValue}
              owner={row.owner}
              source={source}
              onCommit={wrappedCommit}
            />
          ),
        )}
      </div>
    </PanelFrame>
  );
}

// Row descriptor for the property panel — either a filled slot (an
// actual SlotFill) or a declared-but-missing slot/param (no fill in
// source). Filled rows render today's PropertyRow; missing rows
// render a placeholder so the user sees every slot the component
// declares, not just the ones they happen to have authored. `owner`
// tracks which Component this row's data came from — used by the
// unified Slide+content panel to route metaFor lookups and keep
// React keys unique across merged sources.
type PropertyRowDescriptor = (
  | { kind: 'filled'; fill: SlotFill; owner: Component }
  | {
      kind: 'missing';
      name: string;
      slotType: SlotType;
      defaultValue?: unknown;
      owner: Component;
    }
) & { choices?: readonly string[] };

function buildPropertyRowDescriptors(
  comp: Component,
  meta: ComponentMeta,
): PropertyRowDescriptor[] {
  const filled = new Set(comp.fills.map((f) => f.name));
  const rows: PropertyRowDescriptor[] = [];
  // Filled rows first, in source order — preserves the existing
  // visual ordering the user is used to.
  for (const fill of comp.fills) {
    rows.push({ kind: 'filled', fill, owner: comp, choices: meta.params?.[fill.name]?.choices });
  }
  // Missing slots, then missing params. Within each group, follow
  // the meta's declaration order (Object.entries on the schema —
  // stable insertion order in modern JS).
  for (const [name, schema] of Object.entries(meta.slots)) {
    if (!filled.has(name)) {
      rows.push({ kind: 'missing', name, slotType: schema.type, owner: comp });
    }
  }
  for (const [name, schema] of Object.entries(meta.params ?? {})) {
    if (!filled.has(name)) {
      rows.push({
        kind: 'missing',
        name,
        slotType: schema.type,
        defaultValue: schema.default,
        choices: schema.choices,
        owner: comp,
      });
    }
  }
  return meta.editor ? rows.filter(row => meta.editor!.inspector.includes(row.kind === 'filled' ? row.fill.name : row.name)) : rows;
}

function rowBelongsTo(
  row: PropertyRowDescriptor,
  comp: Component,
): boolean {
  return row.owner === comp;
}

function MissingPropertyRow({
  name,
  choices,
  slotType,
  defaultValue,
  owner,
  source,
  onCommit,
}: {
  name: string;
  choices?: readonly string[];
  slotType: SlotType;
  defaultValue?: unknown;
  owner: Component;
  source: string;
  onCommit: (newSource: string) => void;
}): ReactElement {
  const editable =
    !slotType.startsWith('array<') &&
    !['block', 'slide', 'slide-content'].includes(slotType);
  const initial = missingValueSource(slotType, defaultValue);
  const [draft, setDraft] = useState(initial);
  const canceledRef = useRef(false);
  const commit = (candidate = draft): void => {
    if (canceledRef.current) {
      canceledRef.current = false;
      return;
    }
    if (!editable || candidate.length === 0) return;
    // Parse the candidate value through the real grammar, then graft that
    // AST node into the real component and canonical-emit the whole deck.
    // This rejects malformed inspector text without ever creating a second
    // value parser or storing presentation-only state.
    const probe = parse(`Probe { value: ${candidate} }`, '<inspector-value>');
    const probeFill = probe.ast.items[0]?.fills[0];
    if (
      !probeFill ||
      probe.diagnostics.some((d) => d.severity === 'error') ||
      !valueMatchesSlotType(probeFill.value, slotType)
    ) {
      setDraft(initial);
      return;
    }
    const parsed = parse(source, '<inspector-materialize>');
    if (parsed.diagnostics.some((d) => d.severity === 'error')) return;
    const target = findComponentByExactSpan(parsed.ast.items, owner);
    if (!target || target.fills.some((fill) => fill.name === name)) return;
    target.fills.push({ ...probeFill, name });
    onCommit(emit(parsed.ast));
  };
  return (
    <div className="sw-property-row sw-property-row-missing">
      <span className="sw-property-key">{name}</span>
      {choices ? (
        <select className="sw-property-value" aria-label={name}
          value={typeof defaultValue === 'string' ? defaultValue : ''} onChange={event => commit(JSON.stringify(event.currentTarget.value))}>
          {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      ) : editable ? (
        <input
          className="sw-property-value sw-property-value-missing"
          value={draft}
          spellCheck={false}
          aria-label={`${name} (default)`}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              canceledRef.current = true;
              setDraft(initial);
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="sw-property-value sw-property-value-readonly sw-property-value-missing">
          (empty)
        </span>
      )}
      <span className="sw-property-row-type" title={`slot type: ${slotType}`}>
        {slotType}
      </span>
    </div>
  );
}

function valueMatchesSlotType(value: Value, type: SlotType): boolean {
  if (type === 'number') return value.kind === 'number';
  if (type === 'boolean') return value.kind === 'boolean';
  if (type === 'text' || type === 'text-document') {
    return (
      value.kind === 'string' ||
      value.kind === 'list' ||
      value.kind === 'name_ref'
    );
  }
  if (type === 'string' || type === 'image') {
    return value.kind === 'string' || value.kind === 'name_ref';
  }
  if (type === 'color-token') {
    return (
      value.kind === 'string' ||
      value.kind === 'name_ref' ||
      value.kind === 'color_oklch'
    );
  }
  if (type === 'font-token' || type === 'spacing-token') {
    return value.kind === 'string' || value.kind === 'name_ref';
  }
  return false;
}

function missingValueSource(type: SlotType, value: unknown): string {
  if (type === 'number') return String(typeof value === 'number' ? value : 0);
  if (type === 'boolean') {
    return String(typeof value === 'boolean' ? value : false);
  }
  if (type.startsWith('array<')) return '[]';
  if (type === 'block' || type === 'slide' || type === 'slide-content') return '';
  return JSON.stringify(typeof value === 'string' ? value : '');
}

function findComponentByExactSpan(
  roots: readonly Component[],
  needle: Component,
): Component | null {
  let found: Component | null = null;
  const visitValue = (value: Value): void => {
    if (found) return;
    if (value.kind === 'component') visit(value);
    else if (value.kind === 'list') value.items.forEach(visitValue);
  };
  const visit = (comp: Component): void => {
    if (
      comp.span.start.offset === needle.span.start.offset &&
      comp.span.end.offset === needle.span.end.offset
    ) {
      found = comp;
      return;
    }
    comp.fills.forEach((fill) => visitValue(fill.value));
    comp.implicitChildren.forEach(visit);
  };
  roots.forEach(visit);
  return found;
}

// Returns the slot type of a fill — looking in both `slots` and
// `params` (params drive most color-typed surfaces today: Box.fill,
// TextBox.color, Arrow.color, TitleSlide.accentColor). Returns null
// when the meta declares neither. Used by PropertyRow to decide
// whether to render the color palette / picker.
function fillSlotType(meta: ComponentMeta, fillName: string): SlotType | null {
  return meta.slots[fillName]?.type
    ?? meta.params?.[fillName]?.type
    ?? null;
}

// Walk the active slide's AST and collect every value that fills a
// `color-token`-typed slot or param. Deduped by source-text form
// (`amber` vs `oklch(0.7 0.15 240)` are distinct entries) and
// against the global token row (so a name_ref already covered by a
// global swatch doesn't appear twice). Output order is insertion
// order — first appearance in slide source. Used by App.tsx to
// build the per-slide swatch row.
export function collectSlideColors(
  slide: Component,
  registry: ComponentRegistry,
  globalTokens: Record<string, string>,
): SlideColor[] {
  const seen = new Set<string>();
  const out: SlideColor[] = [];
  const visit = (node: Component): void => {
    const meta = registry[node.name]?.meta;
    for (const fill of node.fills) {
      if (meta && fillSlotType(meta, fill.name) === 'color-token') {
        const swatch = colorFillToSwatch(fill, globalTokens);
        if (swatch && !seen.has(swatch.sourceText)) {
          // Skip name_refs that the global row already covers.
          if (
            !(
              fill.value.kind === 'name_ref' &&
              fill.value.name in globalTokens
            )
          ) {
            seen.add(swatch.sourceText);
            out.push(swatch);
          }
        }
      }
      // Recurse into nested components (e.g., a `content: Foo {}`
      // slot value), list items, and Span runs inside text slots.
      visitValue(fill.value);
    }
    for (const child of node.implicitChildren) visit(child);
  };
  const visitValue = (v: Value): void => {
    if (v.kind === 'component') visit(v);
    else if (v.kind === 'list') {
      for (const item of v.items) visitValue(item);
    }
  };
  visit(slide);
  return out;
}

function colorFillToSwatch(
  fill: SlotFill,
  globalTokens: Record<string, string>,
): SlideColor | null {
  const v = fill.value;
  if (v.kind === 'name_ref') {
    // Look up the actual CSS from the merged token map. Falls back
    // to `var(--name)` for unknown names (resolves via styles.css's
    // cascade if a CSS variable exists; transparent otherwise).
    const cssValue = globalTokens[v.name] ?? `var(--${v.name})`;
    return { sourceText: v.name, cssValue };
  }
  if (v.kind === 'color_oklch') {
    const text = `oklch(${v.l} ${v.c} ${v.h})`;
    return { sourceText: text, cssValue: text };
  }
  if (v.kind === 'string') {
    return { sourceText: JSON.stringify(v.value), cssValue: v.value };
  }
  return null;
}

// Returns the slot's type when this fill is omit-eligible — i.e.,
// it names a slot (not a param) AND the slot's type is renderable
// (text / block / slide / array of those). Renderable slots are
// the ones the loader generates placeholders for, and `omit`
// exists to suppress that placeholder. Params have defaults
// already — `omit` would be source noise. Returns null when the
// fill is not omit-eligible (so PropertyRow can decide to hide
// the toggle without needing to know why).
function omitSlotType(meta: ComponentMeta, fillName: string): SlotType | null {
  const slot = meta.slots[fillName];
  if (!slot) return null;
  if (!isRenderableSlotType(slot.type)) return null;
  return slot.type;
}

// Source text to splice into the value span when the user toggles
// `omit` OFF. Type-shaped so the un-omit'd fill is at least
// well-typed at the slot's declared schema. The prior value isn't
// preserved across the toggle (would need a history channel) —
// undo (Cmd-Z) gets it back if the user wanted it. Block / slide /
// list slots un-omit into stubs the user then drills into to edit;
// scalar / text slots un-omit into editable primitives that the
// user can type into directly via the same row's input.
function unOmitDefault(type: SlotType): string {
  if (type.startsWith('array<')) return '[]';
  switch (type) {
    case 'text-document':
      return '[]';
    case 'text':
    case 'string':
    case 'color-token':
    case 'spacing-token':
    case 'font-token':
      return '""';
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'block':
      // Box has all-defaulted params and is in the v0 reference
      // registry — a working empty block stub the user replaces.
      return 'Box { }';
    case 'slide':
    case 'slide-content':
    case 'image':
    default:
      return '""';
  }
}

// The slide's content component when it unifies with the Slide row:
// a sole `content` fill holding a `produces: 'slide'` component with
// a registered meta (i.e., it has a `canvas` export). Three surfaces
// key off this — the slide property panel merges its rows in, the
// hierarchy suppresses its row, and PropertiesPanel redirects a
// direct selection of it to the unified panel. See SLIDEWRIGHT.md /
// Implementation notes / Inspector and source surfaces. When
// content is a plain block (Freeform, VStack, …) or missing,
// returns null and every surface keeps the two-row behavior.
function unifiedSlideContent(
  slide: SlideAstData,
  shapes: ReadonlyMap<string, ShapeData>,
): { comp: Component; meta: ComponentMeta } | null {
  const contentFill = slide.comp.fills.find((f) => f.name === 'content');
  if (contentFill?.value.kind !== 'component') return null;
  const comp = contentFill.value;
  const meta = shapes.get(
    `${comp.span.start.offset}-${comp.span.end.offset}`,
  )?.meta;
  if (meta?.produces !== 'slide') return null;
  return { comp, meta };
}

function SlidePropertiesView({
  slide,
  source,
  onCommit,
  scrubProps,
  paletteProps,
  onSelectComponent,
  onRemoveListItem,
  shapes,
}: {
  slide: SlideAstData;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
  scrubProps: ScrubProps;
  paletteProps: PaletteProps;
  onSelectComponent: (range: SourceRange) => void;
  onRemoveListItem: (range: SourceRange) => void;
  shapes: ReadonlyMap<string, ShapeData>;
}): ReactElement {
  const label = readSlideLabel(slide);
  const unified = unifiedSlideContent(slide, shapes);
  const contentComp = unified?.comp ?? null;
  const contentMeta = unified?.meta ?? null;
  const unify = unified !== null;
  const displayName = unify && contentComp ? contentComp.name : slide.comp.name;
  const header = label ? `${displayName} · ${label}` : displayName;
  // Preserve the slide selection across edits — the slide kind has
  // no span identity, so we pass an empty newSelections to mean
  // "keep current". The wrapper-commit-shape-range trick used for
  // ComponentPropertiesView doesn't apply here.
  const wrappedCommit = (newSource: string): void => onCommit(newSource);
  const rowName = (r: PropertyRowDescriptor): string =>
    r.kind === 'filled' ? r.fill.name : r.name;
  // Speaker notes are deliberately absent from the inspector — a
  // dedicated Notes mode in EditorPane edits their source literal.
  let rows = buildPropertyRowDescriptors(slide.comp, slide.meta).filter(
    (r) => rowName(r) !== 'notes',
  );
  if (unify && contentComp && contentMeta) {
    // Hide the `content` row itself — it's redundant now that
    // we're rendering the content component's rows below.
    rows = rows.filter((r) => rowName(r) !== 'content');
    rows = [
      ...rows,
      ...buildPropertyRowDescriptors(contentComp, contentMeta),
    ];
  }
  // Tag each row with the parent context so duplicate slot names
  // across Slide + content component get unique React keys.
  const rowKeyPrefix = (row: PropertyRowDescriptor): string =>
    unify && contentComp && rowBelongsTo(row, contentComp)
      ? `content-${contentComp.span.start.offset}`
      : 'slide';
  if (rows.length === 0) {
    return (
      <PanelFrame header={header}>
        <div className="sw-inspector-panel-empty">(no parameters)</div>
      </PanelFrame>
    );
  }
  // Determine which meta governs a given row for slotType /
  // omitType lookups — content rows use the content component's
  // meta, slide rows use the slide's.
  const metaFor = (row: PropertyRowDescriptor): ComponentMeta =>
    unify && contentComp && rowBelongsTo(row, contentComp)
      ? contentMeta!
      : slide.meta;
  return (
    <PanelFrame header={header}>
      <div className="sw-properties-rows">
        {rows.map((row) =>
          row.kind === 'filled' ? (
            <PropertyRow
              key={`${rowKeyPrefix(row)}-${row.fill.name}`}
              fill={row.fill}
              choices={row.choices}
              source={source}
              onCommit={wrappedCommit}
              slotType={fillSlotType(metaFor(row), row.fill.name)}
              omitType={omitSlotType(metaFor(row), row.fill.name)}
              paletteProps={paletteProps}
              onSelectComponent={onSelectComponent}
              onRemoveListItem={onRemoveListItem}
              {...scrubProps}
            />
          ) : (
            <MissingPropertyRow
              key={`missing-${rowKeyPrefix(row)}-${row.name}`}
              name={row.name}
              choices={row.choices}
              slotType={row.slotType}
              defaultValue={row.defaultValue}
              owner={row.owner}
              source={source}
              onCommit={wrappedCommit}
            />
          ),
        )}
      </div>
    </PanelFrame>
  );
}

function EmptySlotPropertiesView({
  info,
  onMaterializeTextSlot,
}: {
  info: EmptySlotInfo;
  onMaterializeTextSlot: (
    parentSpan: SourceRange,
    slotName: string,
    value: string,
  ) => void;
}): ReactElement {
  const { slotName, slotType, parentShape } = info;
  const header = `Slot: ${slotName} (empty)`;
  const isText = slotType === 'text' || slotType === 'text-document';
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const setDraftSync = (v: string): void => {
    draftRef.current = v;
    setDraft(v);
  };
  const commit = (): void => {
    const value = draftRef.current;
    if (value.length === 0) return;
    const parentSpan: SourceRange = {
      start: parentShape.comp.span.start.offset,
      end: parentShape.comp.span.end.offset,
    };
    onMaterializeTextSlot(parentSpan, slotName, value);
    setDraftSync('');
  };
  return (
    <PanelFrame header={header}>
      <div className="sw-properties-rows">
        <div className="sw-property-row sw-property-row-meta">
          <span className="sw-property-key">in</span>
          <span className="sw-property-value sw-property-value-readonly">
            {parentShape.comp.name} #{parentShape.childIdx}
          </span>
        </div>
        <div className="sw-property-row sw-property-row-meta">
          <span className="sw-property-key">type</span>
          <span className="sw-property-value sw-property-value-readonly">
            {slotType}
          </span>
        </div>
        {isText ? (
          <label className="sw-property-row">
            <span className="sw-property-key">fill</span>
            <input
              className="sw-property-value"
              type="text"
              value={draft}
              spellCheck={false}
              placeholder="type a value…"
              onChange={(e) => setDraftSync(e.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setDraftSync('');
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        ) : (
          <div className="sw-inspector-panel-empty">
            (insertion not yet supported for {slotType} slots)
          </div>
        )}
      </div>
    </PanelFrame>
  );
}

function SlotPropertiesView({
  slotInfo,
  source,
  onCommit,
  scrubProps,
  paletteProps,
  onSelectComponent,
  onRemoveListItem,
}: {
  slotInfo: SlotInfo;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
  scrubProps: ScrubProps;
  paletteProps: PaletteProps;
  onSelectComponent: (range: SourceRange) => void;
  onRemoveListItem: (range: SourceRange) => void;
}): ReactElement {
  const { slotName, fill, parentShape } = slotInfo;
  const header = `Slot: ${slotName}`;
  // Slot-target selection-preservation across commit not yet
  // wired (would need to recompute the SlotFill's post-emit span
  // from the parent's new AST). For now, commit drops slot
  // selection — same behavior as a delete on a slot. Acceptable
  // since the only slot-level edits today are inline string /
  // primitive edits via PropertyRow, where focus survives on its
  // own.
  const wrappedCommit = (newSource: string): void => onCommit(newSource);
  return (
    <PanelFrame header={header}>
      <div className="sw-properties-rows">
        <div className="sw-property-row sw-property-row-meta">
          <span className="sw-property-key">in</span>
          <span className="sw-property-value sw-property-value-readonly">
            {parentShape.comp.name} #{parentShape.childIdx}
          </span>
        </div>
        <PropertyRow
          key={`${parentShape.slideIdx}-${parentShape.childIdx}-${slotName}`}
          fill={fill}
          source={source}
          onCommit={wrappedCommit}
          slotType={fillSlotType(parentShape.meta, slotName)}
          omitType={omitSlotType(parentShape.meta, slotName)}
          paletteProps={paletteProps}
          onSelectComponent={onSelectComponent}
          onRemoveListItem={onRemoveListItem}
          {...scrubProps}
        />
      </div>
    </PanelFrame>
  );
}

// ─── Per-row editor ──────────────────────────────────────────────

interface PropertyRowProps {
  choices?: readonly string[];
  fill: SlotFill;
  source: string;
  onCommit: (newSource: string) => void;
  // The fill's declared slot type from `meta.slots` OR `meta.params`,
  // whichever applies. Null when neither declares it (legacy /
  // unknown slot). Drives the color palette branch and any future
  // type-specific editor (not the omit toggle — that's `omitType`).
  slotType: SlotType | null;
  // The fill's declared slot type when this row is omit-eligible
  // (renderable slot in `meta.slots`); null for params and non-
  // renderable slots (image, scalars). When non-null the omit
  // toggle renders, and the un-omit splice picks a type-shaped
  // default via `unOmitDefault`.
  omitType: SlotType | null;
  paletteProps: PaletteProps;
  // Drill into a component-typed value: invoked when the user
  // clicks the drill arrow on a row whose value is a nested
  // Component. Routes the selection to that component's span so
  // the canvas + inspector switch focus into it.
  onSelectComponent: (range: SourceRange) => void;
  // Remove an item from a list-typed value. Range is the item's
  // own span; the App resolves which list it belongs to via the
  // existing removeShapeAtSpan AST walker.
  onRemoveListItem: (range: SourceRange) => void;
  // Drag-to-scrub session lifecycle. PropertyRow drives these on
  // numeric rows; the App pushes one undo entry per session and
  // applies intermediate previews without polluting the undo
  // stack.
  onScrubBegin: () => void;
  onScrubPreview: (newSource: string) => void;
  onScrubEnd: (finalSource: string | null) => void;
}

function PropertyRow({
  fill,
  choices,
  source,
  onCommit,
  slotType,
  omitType,
  paletteProps,
  onSelectComponent,
  onRemoveListItem,
  onScrubBegin,
  onScrubPreview,
  onScrubEnd,
}: PropertyRowProps): ReactElement {
  const isOmit = fill.value.kind === 'omit';
  const isNumber = fill.value.kind === 'number';
  const isColor = slotType === 'color-token' && !isOmit;
  const isComponent = fill.value.kind === 'component';
  const isList = fill.value.kind === 'list';
  const editable = !isOmit && isEditableValue(fill.value);
  const sourceText = readValueSource(fill.value, source);
  const [draft, setDraft] = useState<string>(sourceText);
  // Active drag-to-scrub session. Ref instead of state because we
  // don't need a re-render on pointermove — each preview commit
  // round-trips through the host and re-renders this row with the
  // updated source. The display value comes from the synced draft,
  // not from local scrub state. `accum` is the running delta in
  // value-units since pointerdown, scaled by the current modifier
  // (shift / alt). We accumulate `e.movementX` rather than reading
  // `clientX - startX` so the drag works with Pointer Lock active
  // (clientX is frozen, but movementX is the real per-event delta).
  const scrubRef = useRef<{ startVal: number; accum: number } | null>(null);
  // Mirror of `draft` readable synchronously. blur() fires commit
  // before React flushes setDraft, so commit() reads from this ref
  // instead — otherwise an Escape that resets the draft would still
  // commit the typed-but-canceled value.
  const draftRef = useRef(draft);
  const setDraftSync = (v: string): void => {
    draftRef.current = v;
    setDraft(v);
  };
  // Reset the draft to the source text whenever the underlying
  // value changes from the outside (external edit, undo / redo,
  // gesture commit). Without this, the input would keep stale
  // typing across host-driven source changes.
  const lastSourceText = useRef(sourceText);
  useEffect(() => {
    if (sourceText !== lastSourceText.current) {
      setDraftSync(sourceText);
      lastSourceText.current = sourceText;
    }
    // setDraftSync is stable; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText]);

  const commit = (): void => {
    if (draftRef.current === sourceText) return;
    const next = sliceReplace(
      source,
      fill.value.span.start.offset,
      fill.value.span.end.offset,
      draftRef.current,
    );
    onCommit(next);
  };

  // Refs holding the latest `source` and `fill` so the document-
  // level pointermove handler (set up once at scrub start) can
  // splice into the most recent source without being re-created
  // each render. React-level handlers would be re-attached each
  // render; document-level listeners survive reconciles and keep
  // firing through hover transitions over other UI.
  const sourceRef = useRef(source);
  const fillRef = useRef(fill);
  const sourceTextRef = useRef(sourceText);
  useEffect(() => {
    sourceRef.current = source;
    fillRef.current = fill;
    sourceTextRef.current = sourceText;
  });

  // Drag-to-scrub the value of a numeric row. Pointerdown arms
  // the session, requests Pointer Lock (so the cursor disappears
  // and the browser surfaces its native "press Esc to release"
  // notice — Figma's behavior), and attaches *document-level*
  // pointermove / pointerup / pointerlockchange listeners. These
  // listeners outlive React re-renders and fire regardless of
  // which DOM element the cursor (notional, under lock) is over.
  // movementX deltas accumulate into `accum`; each move splices
  // the current source (via refs) and calls onScrubPreview.
  // pointerup releases the lock + tears down listeners + commits.
  // pointerlockchange catches the Esc-released case and ends the
  // session gracefully (no rollback — committed previews stay,
  // Cmd-Z restores pre-scrub via the single undo entry).
  //
  // shift = 10× per pixel (coarser), alt = 0.1× (finer). Under
  // automation (Playwright) we skip the lock — its synthetic
  // mouse simulation reports a spurious movementX on the first
  // event after lock engages, which corrupts the accumulator.
  // The CSS `sw-scrubbing` body class still hides the cursor and
  // neutralizes hierarchy interactivity, so the test path gets
  // the same end-effect as the production lock path.
  const onKeyPointerDown = (e: ReactPointerEvent): void => {
    if (!isNumber) return;
    if (e.button !== 0) return;
    const startVal = (fill.value as { value: number }).value;
    scrubRef.current = { startVal, accum: 0 };
    document.body.classList.add('sw-scrubbing');
    e.preventDefault();
    onScrubBegin();

    const target = e.currentTarget;
    const isAutomated =
      typeof navigator !== 'undefined' && navigator.webdriver === true;
    if (!isAutomated && target.requestPointerLock) {
      target.requestPointerLock();
    }

    const onMove = (ev: PointerEvent): void => {
      if (!scrubRef.current) return;
      const scale = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      scrubRef.current.accum += ev.movementX * scale;
      const raw = scrubRef.current.startVal + scrubRef.current.accum;
      const rounded = ev.altKey
        ? Math.round(raw * 10) / 10
        : Math.round(raw);
      if (sourceTextRef.current === String(rounded)) return;
      const currentFill = fillRef.current;
      const next = sliceReplace(
        sourceRef.current,
        currentFill.value.span.start.offset,
        currentFill.value.span.end.offset,
        String(rounded),
      );
      onScrubPreview(next);
    };

    const cleanup = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      document.body.classList.remove('sw-scrubbing');
      scrubRef.current = null;
    };

    const onUp = (): void => {
      const finalSource = sourceRef.current;
      cleanup();
      onScrubEnd(finalSource);
    };

    const onLockChange = (): void => {
      // Lock released externally (Esc) mid-drag — end the session
      // at the current value, same as a normal pointerup.
      if (!document.pointerLockElement && scrubRef.current) {
        onUp();
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('pointerlockchange', onLockChange);
  };

  // Toggle the slot between its current value and the `omit` sigil.
  // ON: replace the value span with `omit`. OFF: replace `omit` with
  // a type-shaped default via `unOmitDefault` — `""` for text /
  // scalars, `0` / `false` for numerics / booleans, `Box { }` for
  // block, `[]` for array, etc. The prior value isn't preserved
  // here — undo (Cmd-Z) gets it back if the user wanted it.
  const toggleOmit = (): void => {
    const replacement = isOmit
      ? omitType
        ? unOmitDefault(omitType)
        : '""'
      : 'omit';
    const next = sliceReplace(
      source,
      fill.value.span.start.offset,
      fill.value.span.end.offset,
      replacement,
    );
    onCommit(next);
  };

  // Splice a swatch value (`amber` / `oklch(...)` / `"#ff0080"`) into
  // the current value span. Same path as a text-input commit; the
  // wrapping component preserves selection across the source round-
  // trip.
  const commitColorValue = (sourceText: string): void => {
    const next = sliceReplace(
      source,
      fill.value.span.start.offset,
      fill.value.span.end.offset,
      sourceText,
    );
    onCommit(next);
  };

  // Current color value rendered as a CSS string — drives the
  // "current" indicator border on the matching swatch.
  const currentCss = isColor
    ? readColorValueCss(fill.value, paletteProps.colorTokens)
    : null;

  // Picker open state — true while the color popover should render.
  // Set on cell focus; cleared by ColorPopover's outside-click /
  // Escape handlers (which know about the portaled popover too).
  const [pickerOpen, setPickerOpen] = useState(false);
  const onColorBlurCapture = (e: ReactFocusEvent<HTMLDivElement>): void => {
    // Closing on blur is unreliable now that the popover lives in a
    // portal — clicks inside the portaled popover would fire blur
    // here with relatedTarget outside this element. ColorPopover
    // handles all of close via document listeners instead.
    void e;
  };
  const previewInputRef = useRef<HTMLInputElement | null>(null);
  const colorCellRef = useRef<HTMLDivElement | null>(null);
  // Splice a fragment of source-text into the current value's span.
  // Used to translate a picker-emitted `oklch(...)` text into the
  // newSource shape the scrub channel expects.
  const spliceValueText = (text: string): string =>
    sliceReplace(
      source,
      fill.value.span.start.offset,
      fill.value.span.end.offset,
      text,
    );

  return (
    <div className="sw-property-row">
      <span
        className={
          'sw-property-key' + (isNumber ? ' sw-property-key-scrub' : '')
        }
        onPointerDown={isNumber ? onKeyPointerDown : undefined}
        title={isNumber ? 'drag to scrub · shift = 10× · alt = 0.1×' : undefined}
      >
        {fill.name}
      </span>
      {choices && fill.value.kind === 'string' ? (
        <select className="sw-property-value" aria-label={fill.name}
          value={fill.value.value} onChange={event => onCommit(spliceValueText(JSON.stringify(event.currentTarget.value)))}>
          {!choices.includes(fill.value.value) && <option value={fill.value.value}>{fill.value.value}</option>}
          {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      ) : isColor ? (
        <div
          ref={colorCellRef}
          className={
            'sw-color-cell' + (pickerOpen ? ' open' : '')
          }
          onFocus={() => setPickerOpen(true)}
          onBlur={onColorBlurCapture}
        >
          <button
            type="button"
            className="sw-color-preview"
            style={{ background: currentCss ?? 'transparent' }}
            title="open color picker"
            aria-label="open color picker"
            // Don't blur the input on mousedown (we want focus to
            // land on the input via the click handler instead). If
            // the input is already focused, this is a no-op.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => previewInputRef.current?.focus()}
          />
          <input
            ref={previewInputRef}
            className="sw-property-value"
            type="text"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraftSync(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraftSync(sourceText);
                e.currentTarget.blur();
              }
            }}
          />
          {pickerOpen ? (
            <ColorPopover
              anchorRef={colorCellRef}
              onRequestClose={() => setPickerOpen(false)}
            >
              <ColorPicker
                value={fill.value}
                colorTokens={paletteProps.colorTokens}
                onCommit={commitColorValue}
                onScrubBegin={onScrubBegin}
                onScrubPreview={(text) =>
                  onScrubPreview(spliceValueText(text))
                }
                onScrubEnd={(finalText) =>
                  onScrubEnd(
                    finalText === null ? null : spliceValueText(finalText),
                  )
                }
              />
              <ColorPalette
                tokens={paletteProps.colorTokens}
                slideColors={paletteProps.slideColors}
                currentCss={currentCss}
                onPick={commitColorValue}
              />
            </ColorPopover>
          ) : null}
        </div>
      ) : isOmit ? (
        <input
          className="sw-property-value"
          type="text"
          value="omit"
          disabled
          readOnly
        />
      ) : isComponent && fill.value.kind === 'component' ? (
        // Component-typed value: show the nested component's name
        // and a drill arrow that selects it. Replacing the value
        // with a different component is deferred (lean scope).
        <div className="sw-property-component-cell">
          <span className="sw-property-value sw-property-component-name">
            {fill.value.name}
          </span>
          <button
            type="button"
            className="sw-property-drill"
            title={`select ${fill.value.name}`}
            aria-label={`select ${fill.value.name}`}
            onClick={() => {
              if (fill.value.kind !== 'component') return;
              onSelectComponent({
                start: fill.value.span.start.offset,
                end: fill.value.span.end.offset,
              });
            }}
          >
            <ArrowRightIcon />
          </button>
        </div>
      ) : isList && fill.value.kind === 'list' ? (
        // Array-typed value: enumerate the items. Each item shows
        // its component name (or a short literal preview for
        // primitives) + a drill button (component items only) + a
        // remove (×) button. Lean scope: no add, no reorder —
        // those live in the canvas/toolbar already.
        <div className="sw-property-list-cell">
          {fill.value.items.length === 0 ? (
            <span className="sw-property-value sw-property-value-readonly">
              (empty)
            </span>
          ) : (
            <ul className="sw-property-list-items">
              {fill.value.items.map((item, i) => {
                const itemRange: SourceRange = {
                  start: item.span.start.offset,
                  end: item.span.end.offset,
                };
                const itemLabel =
                  item.kind === 'component'
                    ? item.name
                    : source.slice(itemRange.start, itemRange.end);
                return (
                  <li
                    key={`${itemRange.start}-${itemRange.end}-${i}`}
                    className="sw-property-list-item"
                  >
                    {item.kind !== 'component' && isEditableValue(item) ? (
                      <ListItemEditor
                        item={item}
                        source={source}
                        onCommit={onCommit}
                      />
                    ) : (
                      <span className="sw-property-list-item-name">
                        {itemLabel}
                      </span>
                    )}
                    {item.kind === 'component' ? (
                      <button
                        type="button"
                        className="sw-property-drill"
                        title={`select ${item.name}`}
                        aria-label={`select ${item.name}`}
                        onClick={() => onSelectComponent(itemRange)}
                      >
                        <ArrowRightIcon />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="sw-property-list-remove"
                      title="remove item"
                      aria-label="remove item"
                      onClick={() => onRemoveListItem(itemRange)}
                    >
                      <XIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : editable ? (
        <input
          className="sw-property-value"
          type="text"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraftSync(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraftSync(sourceText);
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="sw-property-value sw-property-value-readonly">
          {sourceText}
        </span>
      )}
      {omitType !== null && !isColor ? (
        <button
          type="button"
          className={
            'sw-property-omit-toggle' + (isOmit ? ' active' : '')
          }
          title={
            isOmit
              ? 'unmark this slot as intentionally empty'
              : 'mark this slot as intentionally empty'
          }
          aria-pressed={isOmit}
          onClick={toggleOmit}
        >
          omit
        </button>
      ) : null}
    </div>
  );
}

function ListItemEditor({
  item,
  source,
  onCommit,
}: {
  item: Value;
  source: string;
  onCommit: (newSource: string) => void;
}): ReactElement {
  const sourceText = readValueSource(item, source);
  const [draft, setDraft] = useState(sourceText);
  const canceledRef = useRef(false);
  useEffect(() => setDraft(sourceText), [sourceText]);
  const commit = (): void => {
    if (canceledRef.current) {
      canceledRef.current = false;
      return;
    }
    if (draft === sourceText) return;
    const probe = parse(`Probe { value: ${draft} }`, '<list-item-value>');
    const candidate = probe.ast.items[0]?.fills[0]?.value;
    if (
      !candidate ||
      probe.diagnostics.some((d) => d.severity === 'error') ||
      candidate.kind !== item.kind
    ) {
      setDraft(sourceText);
      return;
    }
    onCommit(
      sliceReplace(source, item.span.start.offset, item.span.end.offset, draft),
    );
  };
  return (
    <input
      className="sw-property-list-item-name sw-property-list-item-input"
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          canceledRef.current = true;
          setDraft(sourceText);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// Editable when the value is a primitive whose source form is a
// single token we can splice without rewriting the whole node.
// Component (nested), ListLit, NullLit aren't surface-friendly to
// edit as text; readers see them but can't edit (yet).
function isEditableValue(v: Value): boolean {
  return (
    v.kind === 'string' ||
    v.kind === 'number' ||
    v.kind === 'boolean' ||
    v.kind === 'name_ref'
  );
}

function readValueSource(v: Value, source: string): string {
  return source.slice(v.span.start.offset, v.span.end.offset);
}

// Pull the slide's `label` slot/param fill out of source, if any,
// and return its decoded string value for display in the hierarchy.
// Returns null when there's no label or the label isn't a string
// literal (the inspector's display channel can't represent name_refs
// / components meaningfully in this one-line context).
function readSlideLabel(slide: SlideAstData): string | null {
  const fill = slide.comp.fills.find((f) => f.name === 'label');
  if (!fill) return null;
  if (fill.value.kind !== 'string') return null;
  return fill.value.value;
}

function sliceReplace(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return source.slice(0, start) + replacement + source.slice(end);
}
