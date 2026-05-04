// Syntax-highlighted code block. Wraps prism-react-renderer's <Highlight>
// with a theme that maps Prism token types to our deck palette:
//   keyword  → purple   (top-contrast emphasis)
//   string   → magenta
//   number   → amber
//   builtin  → blue (accent)
//   function → blue
//   comment  → muted italic
//
// Visual treatment matches `pre.code` in styles.css: thick black border,
// light-grey paper background. Pass `dark` for the inverted variant.
import { Highlight } from 'prism-react-renderer';

const baseStyles = [
  { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#4a4a4a', fontStyle: 'italic' } },
  { types: ['keyword', 'control', 'directive'], style: { color: '#B026FF', fontWeight: 700 } },
  { types: ['builtin', 'class-name', 'maybe-class-name'], style: { color: '#0000FF' } },
  { types: ['function'], style: { color: '#0000FF' } },
  { types: ['string', 'char', 'attr-value', 'inserted'], style: { color: '#FF0080' } },
  { types: ['number', 'boolean'], style: { color: '#FFA500' } },
  { types: ['operator', 'punctuation', 'symbol'], style: { color: '#000000' } },
  { types: ['variable', 'parameter', 'tag', 'attr-name'], style: { color: '#000000' } },
  { types: ['decorator', 'annotation'], style: { color: '#FF3333' } },
];

const lightTheme = {
  plain: { color: '#000000', backgroundColor: '#f4f4f4' },
  styles: baseStyles,
};

const darkTheme = {
  plain: { color: '#f4f4f4', backgroundColor: '#111111' },
  styles: baseStyles,
};

export function CodeBlock({
  code,
  language = 'python',
  fontSize = 28,
  dark = false,
  style,
}) {
  return (
    <Highlight code={code.trim()} language={language} theme={dark ? darkTheme : lightTheme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize,
            lineHeight: 1.45,
            background: dark ? '#111' : '#f4f4f4',
            border: dark ? '3px solid #111' : '3px solid var(--fg)',
            padding: '24px 28px',
            margin: 0,
            whiteSpace: 'pre',
            overflow: 'hidden',
            ...style,
          }}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
