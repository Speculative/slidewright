// Presentation-only source layout: keep authored text and offsets intact.
import { countColumn, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
export { sourceFolding, readSourceFoldingWork } from './source-folding.js';
import { tokenize, type Token } from '../runtime/lexer.js';

interface FoldRange { from: number; to: number }

// Reuse the DSL lexer so brackets inside strings, notes, and comments are
// never mistaken for structure. Incomplete source can still fold matched pairs.
export function sourceFoldRanges(source: string): FoldRange[] {
  const stack: Token[] = [];
  const ranges: FoldRange[] = [];
  for (const token of tokenize(source, '<editor>').tokens) {
    if (token.kind === 'lbrace' || token.kind === 'lbrack') stack.push(token);
    else if (token.kind === 'rbrace' || token.kind === 'rbrack') {
      const open = stack.at(-1);
      if (open?.kind !== (token.kind === 'rbrace' ? 'lbrace' : 'lbrack')) {
        stack.length = 0;
        continue;
      }
      stack.pop();
      if (token.span.start.line > open.span.end.line) {
        ranges.push({ from: open.span.end.offset, to: token.span.start.offset });
      }
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

export function continuationColumns(text: string, tabSize: number, source: boolean): number {
  const whitespace = /^[ \t]*/.exec(text)![0];
  // Align wrapped values with their property, including tabs. Other source
  // lines get one extra nesting step; prose keeps only its authored indent.
  const property = source ? /^[ \t]*[A-Za-z_][A-Za-z0-9_]*:[ \t]*/.exec(text)?.[0] : undefined;
  return property != null ? countColumn(property, tabSize)
    : countColumn(whitespace, tabSize) + (source ? 2 : 0);
}

export function hangingWrap(source: boolean): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    maxIndent = 0;
    destroyed = false;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
      this.measure(view);
    }
    measure(view: EditorView): void {
      view.requestMeasure({
        key: this,
        read: () => view.contentDOM.clientWidth * 0.4,
        write: (maxIndent) => {
          if (maxIndent === this.maxIndent) return;
          this.maxIndent = maxIndent;
          // Measurement writes run inside a view update. Publish decorations
          // just after it finishes, rather than dispatching a nested update.
          queueMicrotask(() => {
            if (this.destroyed) return;
            this.decorations = this.build(view);
            view.dispatch({});
          });
        },
      });
    }
    destroy(): void { this.destroyed = true; }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
      if (update.geometryChanged) this.measure(update.view);
    }
    build(view: EditorView): DecorationSet {
      const lines = new Set<number>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = view.state.doc.lineAt(from).from; pos <= to;) {
          const line = view.state.doc.lineAt(pos);
          lines.add(line.from);
          pos = line.to + 1;
        }
      }
      return Decoration.set([...lines].sort((a, b) => a - b).map((from) => {
        const columns = continuationColumns(view.state.doc.lineAt(from).text, view.state.tabSize, source);
        // Resolve the width cap during measurement. Percentage expressions in
        // text-indent survive getComputedStyle, but CodeMirror needs a numeric
        // indent to draw selection rectangles across visual line breaks.
        return Decoration.line({ attributes: {
          style: `padding-left: min(${columns}ch, ${this.maxIndent}px); text-indent: max(-${columns}ch, -${this.maxIndent}px)`,
        } }).range(from);
      }));
    }
  }, { decorations: (plugin) => plugin.decorations });
}
