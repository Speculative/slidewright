// Slidewright lexer. Hand-rolled to match grammar.js (spec-of-record).
//
// Tokens carry source spans so parser-emitted diagnostics can point at
// the offending text. Whitespace is skipped between tokens; newlines
// are exposed as their own NEWLINE token (they're item separators
// inside `{}` and `[]` bodies). Comments are emitted as
// `line_comment` / `block_comment` tokens — the parser attaches them
// to adjacent AST nodes so they round-trip through the canonical
// emitter (v0.2.d).
//
// Adjacent simple-string concatenation is handled by the parser at
// value-parse time, not the lexer.

import type { Pos, Span } from './ast.js';
import type { Diagnostic } from './diagnostics.js';

export type TokenKind =
  | 'lbrace'
  | 'rbrace'
  | 'lbrack'
  | 'rbrack'
  | 'colon'
  | 'comma'
  | 'newline'
  | 'string'
  | 'triple_string'
  | 'number'
  | 'upper_ident'
  | 'lower_ident'
  | 'line_comment'
  | 'block_comment'
  | 'true'
  | 'false'
  | 'null'
  | 'omit'
  | 'eof';

export interface Token {
  kind: TokenKind;
  text: string;     // raw source text (including quotes for strings)
  value?: string;   // decoded value for strings
  span: Span;
}

const RESERVED: Record<string, TokenKind> = {
  true: 'true',
  false: 'false',
  null: 'null',
  omit: 'omit',
};

export function tokenize(
  source: string,
  file: string,
): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];

  let offset = 0;
  let line = 1;
  let column = 1;

  const here = (): Pos => ({ offset, line, column });

  const advance = (n: number): void => {
    for (let i = 0; i < n; i++) {
      if (source[offset] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      offset += 1;
    }
  };

  const emit = (
    kind: TokenKind,
    start: Pos,
    text: string,
    value?: string,
  ): void => {
    tokens.push({
      kind,
      text,
      value,
      span: { start, end: here() },
    });
  };

  const error = (
    start: Pos,
    message: string,
    hint?: string,
  ): void => {
    diagnostics.push({
      kind: 'lex',
      severity: 'error',
      message,
      hint,
      file,
      span: { start, end: here() },
    });
  };

  while (offset < source.length) {
    const ch = source[offset]!;
    const start = here();

    // Whitespace (not newline)
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance(1);
      continue;
    }

    // Newline — significant (item separator at the body level).
    if (ch === '\n') {
      advance(1);
      // Coalesce a run of newlines into one NEWLINE token.
      while (source[offset] === '\n' || source[offset] === '\r' || source[offset] === ' ' || source[offset] === '\t') {
        advance(1);
      }
      emit('newline', start, source.slice(start.offset, offset));
      continue;
    }

    // Line comment
    if (ch === '/' && source[offset + 1] === '/') {
      while (offset < source.length && source[offset] !== '\n') advance(1);
      emit('line_comment', start, source.slice(start.offset, offset));
      continue;
    }

    // Block comment
    if (ch === '/' && source[offset + 1] === '*') {
      advance(2);
      while (
        offset < source.length &&
        !(source[offset] === '*' && source[offset + 1] === '/')
      ) {
        advance(1);
      }
      if (offset >= source.length) {
        error(start, 'unterminated block comment', 'expected `*/` to close');
      } else {
        advance(2);
      }
      emit('block_comment', start, source.slice(start.offset, offset));
      continue;
    }

    // Punctuation
    if (ch === '{') { advance(1); emit('lbrace', start, '{'); continue; }
    if (ch === '}') { advance(1); emit('rbrace', start, '}'); continue; }
    if (ch === '[') { advance(1); emit('lbrack', start, '['); continue; }
    if (ch === ']') { advance(1); emit('rbrack', start, ']'); continue; }
    if (ch === ':') { advance(1); emit('colon', start, ':'); continue; }
    if (ch === ',') { advance(1); emit('comma', start, ','); continue; }

    // Triple-quoted string
    if (
      ch === '"' &&
      source[offset + 1] === '"' &&
      source[offset + 2] === '"'
    ) {
      advance(3);
      const valueStart = offset;
      while (
        offset < source.length &&
        !(
          source[offset] === '"' &&
          source[offset + 1] === '"' &&
          source[offset + 2] === '"'
        )
      ) {
        advance(1);
      }
      if (offset >= source.length) {
        error(start, 'unterminated triple-quoted string', 'expected `"""` to close');
        emit('triple_string', start, source.slice(start.offset), '');
        continue;
      }
      const raw = source.slice(valueStart, offset);
      advance(3);
      emit(
        'triple_string',
        start,
        source.slice(start.offset, offset),
        dedent(raw),
      );
      continue;
    }

    // Simple string
    if (ch === '"') {
      advance(1);
      let value = '';
      while (offset < source.length && source[offset] !== '"') {
        if (source[offset] === '\n') {
          error(start, 'unterminated string', 'use `"""..."""` for multi-line strings');
          break;
        }
        if (source[offset] === '\\') {
          const esc = source[offset + 1];
          if (esc === 'n') value += '\n';
          else if (esc === 't') value += '\t';
          else if (esc === 'r') value += '\r';
          else if (esc === '\\') value += '\\';
          else if (esc === '"') value += '"';
          else if (esc === '0') value += '\0';
          else value += esc ?? '';
          advance(2);
        } else {
          value += source[offset];
          advance(1);
        }
      }
      if (source[offset] === '"') advance(1);
      emit('string', start, source.slice(start.offset, offset), value);
      continue;
    }

    // Number
    if ((ch >= '0' && ch <= '9') || (ch === '-' && /\d/.test(source[offset + 1] ?? ''))) {
      advance(1);
      while (offset < source.length && /\d/.test(source[offset]!)) advance(1);
      if (source[offset] === '.' && /\d/.test(source[offset + 1] ?? '')) {
        advance(1);
        while (offset < source.length && /\d/.test(source[offset]!)) advance(1);
      }
      const text = source.slice(start.offset, offset);
      emit('number', start, text);
      continue;
    }

    // Identifier (upper_ident or lower_ident, or reserved word)
    if (/[A-Za-z_]/.test(ch)) {
      advance(1);
      while (offset < source.length && /[A-Za-z0-9_]/.test(source[offset]!)) {
        advance(1);
      }
      const text = source.slice(start.offset, offset);
      const reserved = RESERVED[text];
      if (reserved) {
        emit(reserved, start, text);
      } else if (/^[A-Z]/.test(text)) {
        emit('upper_ident', start, text);
      } else {
        emit('lower_ident', start, text);
      }
      continue;
    }

    // Unknown character
    error(start, `unexpected character ${JSON.stringify(ch)}`);
    advance(1);
  }

  tokens.push({
    kind: 'eof',
    text: '',
    span: { start: here(), end: here() },
  });

  return { tokens, diagnostics };
}

// Python-style triple-string dedent: strip the common leading whitespace
// from non-blank lines, plus the leading and trailing blank line if any.
function dedent(raw: string): string {
  // Drop a single leading newline so `"""\n  body\n  """` starts at "body".
  let s = raw;
  if (s.startsWith('\n')) s = s.slice(1);
  else if (s.startsWith('\r\n')) s = s.slice(2);

  const lines = s.split('\n');
  // Find min indent across non-blank lines.
  let min = Infinity;
  for (const ln of lines) {
    if (ln.trim().length === 0) continue;
    const m = ln.match(/^[ \t]*/);
    const len = m ? m[0].length : 0;
    if (len < min) min = len;
  }
  if (!isFinite(min)) min = 0;
  const trimmed = lines.map((ln) =>
    ln.length >= min ? ln.slice(min) : ln,
  );
  // Drop trailing blank line so `"""\n  body\n  """` ends at "body".
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === '') {
    trimmed.pop();
  }
  return trimmed.join('\n');
}
