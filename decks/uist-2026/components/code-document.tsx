import { Children, cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { RenderProps, Token } from 'prism-react-renderer';

interface TextElementProps {
  children?: ReactNode;
  tag?: string;
  style?: CSSProperties;
  attributes?: Record<string, unknown>;
}
export interface CodeLine { text: string; content: ReactNode }
const tag = (node: ReactElement<TextElementProps>) => typeof node.type === 'string' ? node.type : node.props.tag;
const block = (node: ReactNode) => isValidElement<TextElementProps>(node) && ['p', 'li'].includes(tag(node) ?? '');

/** Split a resolved text document into visual lines, retaining its authored
 * wrappers/marks. Opaque custom inline components remain intact as atoms. */
export function codeDocumentLines(content: ReactNode): CodeLine[] {
  const visit = (node: ReactNode): CodeLine[] => {
    if (typeof node === 'string' || typeof node === 'number') return String(node).split('\n').map(text => ({ text, content: text }));
    if (Array.isArray(node)) {
      const lines: CodeLine[] = [{ text: '', content: [] }];
      let previousBlock = false;
      let first = true;
      for (const child of Children.toArray(node)) {
        const isBlock = block(child);
        if (!first && (previousBlock || isBlock)) lines.push({ text: '', content: [] });
        const next = visit(child);
        const last = lines[lines.length - 1]!;
        last.text += next[0]!.text;
        last.content = [last.content, next[0]!.content];
        lines.push(...next.slice(1));
        previousBlock = isBlock;
        first = false;
      }
      return lines;
    }
    if (!isValidElement<TextElementProps>(node)) return [{ text: '', content: node }];
    if (tag(node) === 'br') return [{ text: '', content: '' }, { text: '', content: '' }];
    if (node.props.children === undefined) return [{ text: '\ufffc', content: node }];
    return visit(node.props.children).map((line, index) => {
      // Paragraph wrappers become inline inside a numbered line. Keep their
      // styles and source identity; block separation is represented above.
      const props: TextElementProps & { key: number } = { key: index };
      let element = node;
      if (block(node)) {
        const style = { ...node.props.style, display: 'inline' };
        if (typeof node.type === 'string') element = <span {...node.props} style={style} />;
        else { props.tag = 'span'; props.style = style; props.attributes = { ...node.props.attributes, style }; }
      }
      return { text: line.text, content: cloneElement(element, props, line.content) };
    });
  };
  return visit(content);
}

/** Decorate text leaves without replacing authored marks. An explicit authored
 * foreground wins over syntax color; other typography inherits normally. */
export function highlightedCodeLine(content: ReactNode, tokens: Token[], getTokenProps: RenderProps['getTokenProps']): ReactNode {
  let offset = 0;
  let start = 0;
  const spans = tokens.map(token => {
    const range = { token, from: start, to: start + token.content.length };
    start = range.to;
    return range;
  });
  const visit = (node: ReactNode, authoredColor = false): ReactNode => {
    if (typeof node === 'string' || typeof node === 'number') {
      const text = String(node), from = offset;
      offset += text.length;
      return spans.flatMap(({ token, from: tokenFrom, to }, index) => {
        const a = Math.max(from, tokenFrom), b = Math.min(offset, to);
        if (a >= b) return [];
        const props = getTokenProps({ token });
        return [<span key={index} {...props} style={{ ...props.style, ...(authoredColor ? { color: 'inherit' } : {}) }}>{text.slice(a - from, b - from)}</span>];
      });
    }
    if (Array.isArray(node)) return Children.toArray(node).map(child => visit(child, authoredColor));
    if (!isValidElement<TextElementProps>(node)) return node;
    if (node.props.children === undefined) { offset++; return node; }
    return cloneElement(node, {}, visit(node.props.children, authoredColor || !!node.props.style?.color));
  };
  return visit(content);
}
