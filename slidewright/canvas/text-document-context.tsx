import { createContext } from 'react';
import type { ReactElement } from 'react';
import type { SourceRange } from './host.js';

// Hosts activate an editor at a source component. Components see only a
// React island, keeping the engine outside their render/metadata contract.
export const TextDocumentSessionContext = createContext<{
  span: SourceRange;
  editor: ReactElement;
} | null>(null);
export const TextDocumentEditorContext = createContext<ReactElement | null>(null);
