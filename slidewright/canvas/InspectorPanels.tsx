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
import type { ReactElement } from 'react';

import type { ShapeData } from '../runtime/loader.js';
import type { SlotFill, Value } from '../runtime/ast.js';
import type { SourceRange } from './host.js';

interface HierarchyPanelProps {
  shapes: ReadonlyMap<string, ShapeData>;
  activeIdx: number;
  selected: readonly SourceRange[];
  onSelect: (range: SourceRange, modifiers: { shift: boolean }) => void;
  onJumpToSource: (range: SourceRange) => void;
}

export function HierarchyPanel({
  shapes,
  activeIdx,
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
    return selected.some((s) => s.start === start && s.end === end);
  };

  return (
    <div className="sw-inspector-panel sw-hierarchy-panel">
      <div className="sw-inspector-panel-header">Hierarchy</div>
      <div className="sw-inspector-panel-body">
        {items.length === 0 ? (
          <div className="sw-inspector-panel-empty">
            (no shapes on this slide)
          </div>
        ) : (
          <ul className="sw-hierarchy-tree" role="tree">
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
                  onClick={(e) =>
                    onSelect(range, { shift: e.shiftKey })
                  }
                  onDoubleClick={() => onJumpToSource(range)}
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
        )}
      </div>
    </div>
  );
}

interface PropertiesPanelProps {
  // Single-selected shape (when selection is exactly one shape that
  // resolves in the registry). null when nothing is selected; the
  // panel renders a placeholder. multiCount > 1 short-circuits to a
  // multi-select hint instead of rendering rows.
  shape: ShapeData | null;
  multiCount: number;
  source: string;
  onCommit: (newSource: string, newSelections?: SourceRange[]) => void;
}

export function PropertiesPanel({
  shape,
  multiCount,
  source,
  onCommit,
}: PropertiesPanelProps): ReactElement {
  const header = shape ? `${shape.comp.name} #${shape.childIdx}` : 'Properties';

  // Wrap commit to preserve selection on the same shape across the
  // edit. The edit happens inside this shape's body, so the shape's
  // start offset is unchanged and the end shifts by the source-
  // length delta. Without this, the subscribe handler treats the
  // commit as having no pending selection and clears.
  const wrappedCommit = shape
    ? (newSource: string): void => {
        const delta = newSource.length - source.length;
        const newRange: SourceRange = {
          start: shape.comp.span.start.offset,
          end: shape.comp.span.end.offset + delta,
        };
        onCommit(newSource, [newRange]);
      }
    : (newSource: string): void => onCommit(newSource);

  let body: ReactElement;
  if (multiCount > 1) {
    body = (
      <div className="sw-inspector-panel-empty">
        ({multiCount} selected — multi-edit not supported yet)
      </div>
    );
  } else if (!shape) {
    body = (
      <div className="sw-inspector-panel-empty">(no selection)</div>
    );
  } else if (shape.comp.fills.length === 0) {
    body = (
      <div className="sw-inspector-panel-empty">(no parameters)</div>
    );
  } else {
    body = (
      <div className="sw-properties-rows">
        {shape.comp.fills.map((fill) => (
          <PropertyRow
            // Keying on (slideIdx, childIdx, name) keeps the row's
            // local draft state across span shifts that follow a
            // commit on this same shape — without it, every commit
            // unmounts the input and the user loses focus mid-edit.
            key={`${shape.slideIdx}-${shape.childIdx}-${fill.name}`}
            fill={fill}
            source={source}
            onCommit={wrappedCommit}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="sw-inspector-panel sw-properties-panel">
      <div className="sw-inspector-panel-header">{header}</div>
      <div className="sw-inspector-panel-body">{body}</div>
    </div>
  );
}

// ─── Per-row editor ──────────────────────────────────────────────

interface PropertyRowProps {
  fill: SlotFill;
  source: string;
  onCommit: (newSource: string) => void;
}

function PropertyRow({
  fill,
  source,
  onCommit,
}: PropertyRowProps): ReactElement {
  const editable = isEditableValue(fill.value);
  const sourceText = readValueSource(fill.value, source);
  const [draft, setDraft] = useState<string>(sourceText);
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

  return (
    <label className="sw-property-row">
      <span className="sw-property-key">{fill.name}</span>
      {editable ? (
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
    </label>
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

function sliceReplace(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return source.slice(0, start) + replacement + source.slice(end);
}
