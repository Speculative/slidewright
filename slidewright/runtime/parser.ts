// Slidewright parser. Hand-rolled recursive descent over the token
// stream from lexer.ts. Produces an AST matching grammar.js
// (the spec-of-record).
//
// v0.0 bridge per slidewright/grammar/README.md — tree-sitter takes
// over once we need IDE-grade error recovery and the canonical formatter
// (v0.2+). Until then this is the source of truth for what's actually
// parsed.

import type {
  Comment,
  Component,
  ListLit,
  NameRef,
  SlotFill,
  SourceFile,
  Span,
  StringLit,
  Value,
} from './ast.js';
import type { Diagnostic } from './diagnostics.js';
import { tokenize, type Token } from './lexer.js';

export interface ParseResult {
  ast: SourceFile;
  diagnostics: Diagnostic[];
}

export function parse(source: string, file: string): ParseResult {
  const { tokens, diagnostics } = tokenize(source, file);
  const parser = new Parser(tokens, diagnostics, file);
  const ast = parser.parseSourceFile();
  return { ast, diagnostics: parser.diagnostics };
}

class Parser {
  pos = 0;
  diagnostics: Diagnostic[];
  // Comments seen since the last regular token was consumed. Drained
  // by takePendingLeading() when a node is entered (becomes its
  // leading comments) or at end-of-block (becomes the parent's
  // trailing comments).
  private pendingLeading: Comment[] = [];

  constructor(
    public tokens: Token[],
    diagnostics: Diagnostic[],
    public file: string,
  ) {
    this.diagnostics = diagnostics;
  }

  // ── token helpers ───────────────────────────────────────────────────

  // Walks the token stream past comment tokens (collecting them into
  // pendingLeading) so they're invisible to the rest of the parser.
  // Must be called before any token-position read.
  private absorbComments(): void {
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (t.kind === 'line_comment' || t.kind === 'block_comment') {
        this.pendingLeading.push({
          kind: t.kind === 'line_comment' ? 'line' : 'block',
          text: t.text,
          span: t.span,
        });
        this.pos += 1;
      } else {
        return;
      }
    }
  }

  private peek(skipNewlines = false): Token {
    this.absorbComments();
    let p = this.pos;
    if (skipNewlines) {
      while (p < this.tokens.length) {
        const t = this.tokens[p]!;
        if (t.kind === 'newline') {
          p++;
        } else if (t.kind === 'line_comment' || t.kind === 'block_comment') {
          // peek-with-skip shouldn't have side-effects on the buffer,
          // so don't absorb here — just skip past for the lookahead.
          p++;
        } else {
          break;
        }
      }
    }
    return this.tokens[p] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    this.absorbComments();
    const t = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) this.pos += 1;
    return t;
  }

  private skipNewlines(): void {
    while (this.peek().kind === 'newline') this.advance();
  }

  // Consume one or more separators (newline | comma). Returns true if
  // any were consumed.
  private skipSeparators(): boolean {
    let consumed = false;
    while (this.peek().kind === 'newline' || this.peek().kind === 'comma') {
      this.advance();
      consumed = true;
    }
    return consumed;
  }

  private takePendingLeading(): Comment[] | undefined {
    if (this.pendingLeading.length === 0) return undefined;
    const c = this.pendingLeading;
    this.pendingLeading = [];
    return c;
  }

  private error(span: Span, message: string, hint?: string): void {
    this.diagnostics.push({
      kind: 'parse',
      severity: 'error',
      message,
      hint,
      span,
      file: this.file,
    });
  }

  // ── productions ─────────────────────────────────────────────────────

  parseSourceFile(): SourceFile {
    const startTok = this.tokens[0]!;
    const items: Component[] = [];
    this.skipSeparators();
    // Comments at the very top of the file (before the first item)
    // become leading comments on the SourceFile. They migrate onto
    // the first item once we enter parseComponent — see below.
    const fileLeading = this.takePendingLeading();
    while (this.peek().kind !== 'eof') {
      const t = this.peek();
      if (t.kind !== 'upper_ident') {
        this.error(
          t.span,
          `expected a component invocation at the top level, got ${describe(t)}`,
          'top-level items must be component invocations like `Deck { ... }`',
        );
        // Recovery: drop tokens until we see an upper_ident or EOF.
        while (
          this.peek().kind !== 'upper_ident' &&
          this.peek().kind !== 'eof'
        ) {
          this.advance();
        }
        continue;
      }
      const comp = this.parseComponent();
      // Hoist file-leading comments onto the first item rather than
      // stranding them on the SourceFile — keeps them adjacent in
      // emit and matches author intent ("these comments describe the
      // first thing in the file").
      if (items.length === 0 && fileLeading) {
        comp.leadingComments = [
          ...fileLeading,
          ...(comp.leadingComments ?? []),
        ];
      }
      items.push(comp);
      // Allow optional separator after each top-level item.
      this.skipSeparators();
    }
    // Anything left in pendingLeading after the last item → trailing
    // of the SourceFile (end-of-file comments).
    const fileTrailing = this.takePendingLeading();
    const endTok = this.tokens[this.tokens.length - 1]!;
    const file: SourceFile = {
      kind: 'source_file',
      items,
      span: { start: startTok.span.start, end: endTok.span.end },
    };
    if (fileTrailing) file.trailingComments = fileTrailing;
    return file;
  }

  parseComponent(): Component {
    const leading = this.takePendingLeading();
    const nameTok = this.advance(); // upper_ident, already verified
    const lbrace = this.peek();
    if (lbrace.kind !== 'lbrace') {
      this.error(
        lbrace.span,
        `expected \`{\` after component name \`${nameTok.text}\``,
        'component invocations always use brace bodies, even when empty: `Foo {}`',
      );
      // Recovery: synthesize an empty body.
      return {
        kind: 'component',
        name: nameTok.text,
        fills: [],
        implicitChildren: [],
        span: { start: nameTok.span.start, end: nameTok.span.end },
        bodySpan: { start: nameTok.span.end, end: nameTok.span.end },
      };
    }
    const lbraceTok = this.advance();
    const fills: SlotFill[] = [];
    const bareComponents: Component[] = [];
    this.skipSeparators();
    while (this.peek().kind !== 'rbrace' && this.peek().kind !== 'eof') {
      const t = this.peek();
      if (t.kind === 'lower_ident') {
        // Slot fill: must be followed by `:`. (Single lower_ident in a
        // brace body without `:` is not a valid item — slot fills
        // require a value.)
        const lookahead = this.tokens[this.pos + 1];
        if (lookahead?.kind !== 'colon') {
          this.error(
            t.span,
            `expected \`:\` after slot name \`${t.text}\``,
            'slot fills have the form `name: value`',
          );
          // Recovery: skip the token.
          this.advance();
          this.skipSeparators();
          continue;
        }
        const fill = this.parseSlotFill();
        if (fill) fills.push(fill);
      } else if (t.kind === 'upper_ident') {
        // Bare component invocation — implicit children candidate.
        const comp = this.parseComponent();
        bareComponents.push(comp);
      } else {
        this.error(
          t.span,
          `unexpected ${describe(t)} inside component body`,
          'expected a slot fill (`name: value`) or a component invocation (`Name { ... }`)',
        );
        this.advance();
      }
      // Require a separator (newline or comma) before the next item, unless
      // we're at the close brace. Be lenient: if a separator is missing
      // between a slot value and the next slot name on the same line, the
      // next iteration's structural cue (lower_ident-colon or upper_ident)
      // already disambiguates, so just skip whatever separators are there.
      this.skipSeparators();
    }
    // Anything left in pendingLeading at this point came after the
    // last item in the body but before `}` — those are end-of-block
    // comments, attached as trailingComments on the parent.
    const trailing = this.takePendingLeading();
    const rbrace = this.peek();
    if (rbrace.kind !== 'rbrace') {
      this.error(
        rbrace.span,
        `expected \`}\` to close component body for \`${nameTok.text}\``,
      );
    } else {
      this.advance();
    }

    // Classify body: implicit children or slot fills?
    let implicitChildren: Component[] = [];
    if (fills.length === 0 && bareComponents.length > 0) {
      implicitChildren = bareComponents;
    } else if (fills.length > 0 && bareComponents.length > 0) {
      // Per SLIDEWRIGHT.md: implicit children only when NO slot is filled
      // in the same invocation. Mixed bodies are a structural error;
      // the author should write `children: [...]` explicitly.
      for (const comp of bareComponents) {
        this.error(
          comp.span,
          `bare component \`${comp.name}\` is not allowed alongside slot fills`,
          'implicit children only apply when the body contains *only* component invocations; otherwise use an explicit `children: [...]` slot',
        );
      }
    }

    const endPos = (rbrace.kind === 'rbrace' ? rbrace.span.end : (this.tokens[this.pos - 1]?.span.end ?? nameTok.span.end));
    const comp: Component = {
      kind: 'component',
      name: nameTok.text,
      fills,
      implicitChildren,
      span: { start: nameTok.span.start, end: endPos },
      bodySpan: { start: lbraceTok.span.start, end: endPos },
    };
    if (leading) comp.leadingComments = leading;
    if (trailing) comp.trailingComments = trailing;
    return comp;
  }

  parseSlotFill(): SlotFill | null {
    const leading = this.takePendingLeading();
    const nameTok = this.advance(); // lower_ident
    this.advance(); // colon
    const value = this.parseValue();
    if (!value) return null;
    const fill: SlotFill = {
      kind: 'slot_fill',
      name: nameTok.text,
      value,
      span: { start: nameTok.span.start, end: value.span.end },
    };
    if (leading) fill.leadingComments = leading;
    return fill;
  }

  parseValue(): Value | null {
    const t = this.peek();
    switch (t.kind) {
      case 'string':
        return this.parseStringWithAdjacency(false);
      case 'triple_string':
        return this.parseStringWithAdjacency(true);
      case 'number':
        this.advance();
        return {
          kind: 'number',
          value: parseFloat(t.text),
          span: t.span,
        };
      case 'true':
        this.advance();
        return { kind: 'boolean', value: true, span: t.span };
      case 'false':
        this.advance();
        return { kind: 'boolean', value: false, span: t.span };
      case 'null':
        this.advance();
        return { kind: 'null', span: t.span };
      case 'lbrack':
        return this.parseList();
      case 'upper_ident':
        return this.parseComponent();
      case 'lower_ident': {
        this.advance();
        const ref: NameRef = {
          kind: 'name_ref',
          name: t.text,
          span: t.span,
        };
        return ref;
      }
      default:
        this.error(
          t.span,
          `expected a value, got ${describe(t)}`,
          'values are literals (strings, numbers, true/false, null), names, lists, or component invocations',
        );
        return null;
    }
  }

  // STRING followed by additional STRINGs (skipping intervening newlines
  // and trivia) concatenates per the Python adjacency rule, but only for
  // simple strings — triple-quoted strings do not adjacency-join, per
  // SLIDEWRIGHT.md / Form.
  parseStringWithAdjacency(isTriple: boolean): StringLit {
    if (isTriple) {
      const t = this.advance();
      return {
        kind: 'string',
        value: t.value ?? '',
        multiline: true,
        span: t.span,
      };
    }
    const first = this.advance();
    let value = first.value ?? '';
    let endSpan = first.span;
    while (true) {
      const next = this.peek(true);
      if (next.kind !== 'string') break;
      // Accept the adjacent string: skip any intervening newlines.
      this.skipNewlines();
      const more = this.advance();
      value += more.value ?? '';
      endSpan = more.span;
    }
    return {
      kind: 'string',
      value,
      multiline: false,
      span: { start: first.span.start, end: endSpan.end },
    };
  }

  parseList(): ListLit {
    const lbrack = this.advance();
    const items: Value[] = [];
    this.skipSeparators();
    while (this.peek().kind !== 'rbrack' && this.peek().kind !== 'eof') {
      const v = this.parseValue();
      if (v) items.push(v);
      this.skipSeparators();
    }
    const rbrack = this.peek();
    if (rbrack.kind !== 'rbrack') {
      this.error(rbrack.span, 'expected `]` to close list');
    } else {
      this.advance();
    }
    return {
      kind: 'list',
      items,
      span: {
        start: lbrack.span.start,
        end: rbrack.kind === 'rbrack' ? rbrack.span.end : lbrack.span.end,
      },
    };
  }
}

function describe(t: Token): string {
  switch (t.kind) {
    case 'eof':
      return 'end of file';
    case 'newline':
      return 'newline';
    case 'string':
    case 'triple_string':
      return 'string';
    case 'number':
      return 'number';
    case 'upper_ident':
    case 'lower_ident':
      return `\`${t.text}\``;
    default:
      return `\`${t.text}\``;
  }
}
