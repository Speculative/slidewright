// Slidewright canvas — inspector panels (hierarchy + properties).
//
// Lives in App's bottom strip alongside the optional bottomExtra
// slot (the standalone fills it with EditorPane). Three-column
// layout mirrors browser DevTools: DOM tree | computed styles |
// source.
//
// Hierarchy: read-only tree of the active slide's shapes, with
// two-way selection sync to the canvas.
//
// Properties: read-write key/value editor for the selected shape's
// slot fills. Edits commit via the same source-splicing mechanism
// gestures use, so they enter the unified canvas-side undo stack.
// Currently single-select only; multi-select shows a hint.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import {
  isRenderableSlotType,
  type ShapeData,
  type SlideAstData,
} from '../runtime/loader.js';
import type { SlotFill, Value } from '../runtime/ast.js';
import type { ComponentMeta, SlotType } from '../runtime/contract.js';
import type { SourceRange } from './host.js';
import {
  componentTarget,
  slideTarget,
  type SelectionTarget,
} from './selection-target.js';

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

export function HierarchyPanel({
  shapes,
  activeIdx,
  activeSlide,
  selected,
  onSelect,
  onJumpToSource,
}: HierarchyPanelProps): ReactElement {
  // Active slide's shapes, ordered by childIdx so the tree matches
  // source / render order in the Freeform.
  const items = useMemo(() => {
    const list: ShapeData[] = [];
    for (const data of shapes.values()) {
      if (data.slideIdx === activeIdx) list.push(data);
    }
    list.sort((a, b) => a.childIdx - b.childIdx);
    return list;
  }, [shapes, activeIdx]);

  const isSelected = (data: ShapeData): boolean => {
    const start = data.comp.span.start.offset;
    const end = data.comp.span.end.offset;
    return selected.some(
      (s) =>
        s.kind === 'component' &&
        s.span.start === start &&
        s.span.end === end,
    );
  };

  const slideSelected = selected.some((s) => s.kind === 'slide');
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
          {items.length === 0 ? (
            <li className="sw-inspector-panel-empty">
              (no shapes on this slide)
            </li>
          ) : null}
          {items.map((data) => {
            const range: SourceRange = {
              start: data.comp.span.start.offset,
              end: data.comp.span.end.offset,
            };
            const sel = isSelected(data);
            return (
              <li
                key={`${range.start}-${range.end}`}
                className={
                  'sw-hierarchy-node' + (sel ? ' selected' : '')
                }
                role="treeitem"
                aria-selected={sel}
                data-sw-span-start={range.start}
                data-sw-span-end={range.end}
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
                <span className="sw-hierarchy-node-name">
                  {data.comp.name}
                </span>
                <span className="sw-hierarchy-node-meta">
                  #{data.childIdx}
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
  // Materialize an empty text slot's fill: write `slotName: "<value>"`
  // into the parent component's body, commit the new source. Used
  // by the empty-slot inspector view's text input.
  onMaterializeTextSlot: (
    parentSpan: SourceRange,
    slotName: string,
    value: string,
  ) => void;
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
  onMaterializeTextSlot,
}: PropertiesPanelProps): ReactElement {
  if (multiCount > 1) {
    return (
      <PanelFrame header="Properties">
        <div className="sw-inspector-panel-empty">
          ({multiCount} selected — multi-edit not supported yet)
        </div>
      </PanelFrame>
    );
  }
  if (slotInfo) {
    return <SlotPropertiesView slotInfo={slotInfo} source={source} onCommit={onCommit} />;
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
    return <ComponentPropertiesView shape={componentShape} source={source} onCommit={onCommit} />;
  }
  // No specific selection — fall through to the slide. This makes
  // "nothing selected" mean "I'm editing the slide", which matches
  // how users think about the inspector when they've just dismissed
  // a shape selection.
  if (activeSlide) {
    return <SlidePropertiesView slide={activeSlide} source={source} onCommit={onCommit} />;
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

function ComponentPropertiesView({
  shape,
  source,
  onCommit,
}: {
  shape: ShapeData;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
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
  if (shape.comp.fills.length === 0) {
    return (
      <PanelFrame header={header}>
        <div className="sw-inspector-panel-empty">(no parameters)</div>
      </PanelFrame>
    );
  }
  return (
    <PanelFrame header={header}>
      <div className="sw-properties-rows">
        {shape.comp.fills.map((fill) => (
          <PropertyRow
            key={`${shape.slideIdx}-${shape.childIdx}-${fill.name}`}
            fill={fill}
            source={source}
            onCommit={wrappedCommit}
            omitType={omitSlotType(shape.meta, fill.name)}
          />
        ))}
      </div>
    </PanelFrame>
  );
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
    case 'image':
    default:
      return '""';
  }
}

function SlidePropertiesView({
  slide,
  source,
  onCommit,
}: {
  slide: SlideAstData;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
}): ReactElement {
  const label = readSlideLabel(slide);
  const header = label ? `${slide.comp.name} · ${label}` : slide.comp.name;
  // Preserve the slide selection across edits — the slide kind has
  // no span identity, so we pass an empty newSelections to mean
  // "keep current". The wrapper-commit-shape-range trick used for
  // ComponentPropertiesView doesn't apply here.
  const wrappedCommit = (newSource: string): void => onCommit(newSource);
  if (slide.comp.fills.length === 0) {
    return (
      <PanelFrame header={header}>
        <div className="sw-inspector-panel-empty">(no parameters)</div>
      </PanelFrame>
    );
  }
  return (
    <PanelFrame header={header}>
      <div className="sw-properties-rows">
        {slide.comp.fills.map((fill) => (
          <PropertyRow
            key={`slide-${fill.name}`}
            fill={fill}
            source={source}
            onCommit={wrappedCommit}
            omitType={omitSlotType(slide.meta, fill.name)}
          />
        ))}
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
  const isText = slotType === 'text';
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
}: {
  slotInfo: SlotInfo;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
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
          omitType={omitSlotType(parentShape.meta, slotName)}
        />
      </div>
    </PanelFrame>
  );
}

// ─── Per-row editor ──────────────────────────────────────────────

interface PropertyRowProps {
  fill: SlotFill;
  source: string;
  onCommit: (newSource: string) => void;
  // The fill's declared slot type when this row is omit-eligible
  // (renderable slot in `meta.slots`); null for params and non-
  // renderable slots (image, scalars). When non-null the omit
  // toggle renders, and the un-omit splice picks a type-shaped
  // default via `unOmitDefault`.
  omitType: SlotType | null;
}

function PropertyRow({
  fill,
  source,
  onCommit,
  omitType,
}: PropertyRowProps): ReactElement {
  const isOmit = fill.value.kind === 'omit';
  const isNumber = fill.value.kind === 'number';
  const editable = !isOmit && isEditableValue(fill.value);
  const sourceText = readValueSource(fill.value, source);
  const [draft, setDraft] = useState<string>(sourceText);
  // Active drag-to-scrub state (numeric rows only). When non-null,
  // the input shows `current` instead of `draft` and the row is in
  // scrubbing mode. Pointer events live on the key span (the
  // dedicated scrub handle), not the input — clicking into the
  // input still focuses for typed edits.
  const [scrub, setScrub] = useState<
    { startX: number; startVal: number; current: number } | null
  >(null);
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

  // Drag-to-scrub the value of a numeric row. Pointerdown on the
  // key arms scrub mode; pointermove updates `scrub.current` and
  // re-renders so the input shows the live value; pointerup commits
  // once (so the undo stack gets one entry per drag, not per pixel)
  // and clears scrub state. A no-op click (pointerdown / pointerup
  // at the same x) commits nothing — the row stays unchanged. shift
  // = 10x per pixel (coarser), alt = 0.1x per pixel (finer).
  //
  // The scrub handle is the key span (not the input) so clicking
  // into the input still focuses for typed edits. Pointer capture
  // keeps tracking the move even after the cursor leaves the key.
  const onKeyPointerDown = (e: ReactPointerEvent): void => {
    if (!isNumber) return;
    if (e.button !== 0) return;
    const startVal = (fill.value as { value: number }).value;
    setScrub({ startX: e.clientX, startVal, current: startVal });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onKeyPointerMove = (e: ReactPointerEvent): void => {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    const scale = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const raw = scrub.startVal + dx * scale;
    // Round to integers in default + coarse mode; to 0.1 in fine
    // mode. Keeps the displayed value clean rather than showing
    // floating-point drift across a long drag.
    const rounded = e.altKey ? Math.round(raw * 10) / 10 : Math.round(raw);
    if (rounded !== scrub.current) {
      setScrub({ ...scrub, current: rounded });
    }
  };
  const onKeyPointerUp = (e: ReactPointerEvent): void => {
    if (!scrub) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (scrub.current !== scrub.startVal) {
      const replacement = String(scrub.current);
      const next = sliceReplace(
        source,
        fill.value.span.start.offset,
        fill.value.span.end.offset,
        replacement,
      );
      onCommit(next);
    }
    setScrub(null);
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

  const displayValue =
    scrub !== null ? String(scrub.current) : draft;

  return (
    <div className="sw-property-row">
      <span
        className={
          'sw-property-key' + (isNumber ? ' sw-property-key-scrub' : '')
        }
        onPointerDown={isNumber ? onKeyPointerDown : undefined}
        onPointerMove={isNumber ? onKeyPointerMove : undefined}
        onPointerUp={isNumber ? onKeyPointerUp : undefined}
        title={isNumber ? 'drag to scrub · shift = 10× · alt = 0.1×' : undefined}
      >
        {fill.name}
      </span>
      {isOmit ? (
        <input
          className="sw-property-value"
          type="text"
          value="omit"
          disabled
          readOnly
        />
      ) : editable ? (
        <input
          className="sw-property-value"
          type="text"
          value={displayValue}
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
      {omitType !== null ? (
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
