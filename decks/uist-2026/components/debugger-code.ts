export type CodeAnnotation = 'state-vars' | 'cost' | null;
export interface CodePart { text: string; highlighted: boolean }

// These are the expressions highlighted by the original axis explanation.
// Keep all surrounding whitespace and punctuation, including call parentheses.
export function annotateCodeLine(line: string, mode: CodeAnnotation, example: 'cart' | 'calculator' = 'cart'): CodePart[] {
  if (!mode) return [{ text: line, highlighted: false }];
  const expressions = example === 'calculator' ? /\b(?:node\.(?:value|left|right|op)|node|left|right|result)(?![\w.])/g : /\b(?:item\.total\(\)|item\.free_shipping|item\.price|item\.qty|item|cart)(?![\w.])/g;
  const parts: CodePart[] = [];
  let start = 0;
  for (const match of line.matchAll(expressions)) {
    if (match.index > start) parts.push({ text: line.slice(start, match.index), highlighted: false });
    parts.push({ text: match[0], highlighted: mode === 'state-vars' || (example === 'calculator' ? ['node.op'] : ['item.price', 'item.total()']).includes(match[0]) });
    start = match.index + match[0].length;
  }
  if (start < line.length || !parts.length) parts.push({ text: line.slice(start), highlighted: false });
  return parts;
}
