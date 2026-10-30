// CodeMirror 6 language support for the Slidewright brace-block DSL.
//
// This is deliberately a stream parser rather than a second AST parser. It
// only needs enough state to keep strings and block comments together across
// lines; the runtime lexer/parser remains the source of truth for validation.

import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StringStream,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

type Mode = 'normal' | 'string' | 'triple-string' | 'block-comment';

interface SlidewrightState {
  mode: Mode;
}

const reservedWords = new Set(['true', 'false', 'null', 'omit']);

function consumeDelimited(
  stream: StringStream,
  delimiter: string,
  state: SlidewrightState,
  mode: Mode,
): void {
  const end = stream.string.indexOf(delimiter, stream.pos);
  if (end < 0) {
    stream.skipToEnd();
    state.mode = mode;
    return;
  }
  stream.pos = end + delimiter.length;
  state.mode = 'normal';
}

function consumeString(stream: StringStream, state: SlidewrightState): void {
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '\\') {
      // Escaped quotes do not close a simple string. The runtime lexer
      // accepts the same one-character escape form.
      stream.next();
    } else if (ch === '"') {
      state.mode = 'normal';
      return;
    }
  }
  state.mode = 'string';
}

function tokenNormal(stream: StringStream, state: SlidewrightState): string | null {
  if (stream.eatSpace()) return null;

  if (stream.match('//')) {
    stream.skipToEnd();
    return 'lineComment';
  }
  if (stream.match('/*')) {
    consumeDelimited(stream, '*/', state, 'block-comment');
    return 'blockComment';
  }

  if (stream.match('"""')) {
    consumeDelimited(stream, '"""', state, 'triple-string');
    return 'string';
  }
  if (stream.eat('"')) {
    consumeString(stream, state);
    return 'string';
  }

  if (stream.match(/^-?(?:\d+(?:\.\d+)?)/)) return 'number';

  const identifier = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (identifier && identifier !== true) {
    const word = identifier[0]!;
    if (word === 'oklch' && stream.match(/^\(/, false)) {
      // Keep the whole color literal together. This mirrors the runtime
      // lexer, which treats oklch(...) as one token.
      const close = stream.string.indexOf(')', stream.pos);
      if (close < 0) stream.skipToEnd();
      else stream.pos = close + 1;
      return 'atom';
    }
    if (word === 'true' || word === 'false') return 'bool';
    if (reservedWords.has(word)) return 'atom';
    if (/^[A-Z]/.test(word)) return 'typeName';
    if (stream.match(/^\s*:/, false)) return 'propertyName';
    return 'variableName';
  }

  if (stream.eat(/[{}[\],:]/)) return 'punctuation';
  if (stream.eat(/[()]/)) return 'bracket';
  if (stream.eat(/[+*/=<>!-]/)) return 'operator';

  stream.next();
  return 'invalid';
}

export const slidewrightLanguage = StreamLanguage.define<SlidewrightState>({
  name: 'slidewright',
  startState: () => ({ mode: 'normal' }),
  token(stream, state): string | null {
    if (state.mode === 'block-comment') {
      consumeDelimited(stream, '*/', state, 'block-comment');
      return 'blockComment';
    }
    if (state.mode === 'triple-string') {
      consumeDelimited(stream, '"""', state, 'triple-string');
      return 'string';
    }
    if (state.mode === 'string') {
      consumeString(stream, state);
      return 'string';
    }
    return tokenNormal(stream, state);
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
});

export const slidewrightHighlighter = HighlightStyle.define([
  { tag: tags.typeName, color: 'var(--sw-ink)', fontWeight: '700' },
  { tag: [tags.propertyName, tags.variableName], color: 'var(--sw-ink)' },
  { tag: tags.keyword, color: 'var(--sw-ink)', fontWeight: '700' },
  { tag: [tags.atom, tags.bool, tags.number, tags.string], color: 'var(--sw-tag-1-text)' },
  { tag: tags.comment, color: 'var(--sw-ink-muted)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket, tags.operator], color: 'var(--sw-ink-muted)' },
  { tag: tags.invalid, color: 'var(--sw-danger)', textDecoration: 'underline' },
]);

export const slidewrightHighlighting = syntaxHighlighting(slidewrightHighlighter);
