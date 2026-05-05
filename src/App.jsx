// v0.0 demo: render the Slidewright reference deck. The original
// React/JSX deck under decks/ne-agents-day-2026/ is preserved as a
// long-term reference target (per HANDOFF.md) but isn't wired into
// the dev server for v0.0.
import { slides, meta, notes } from '../decks/v0-reference/index.tsx';
import { Presentation } from './Presentation.jsx';

export function App() {
  return (
    <Presentation {...meta} notes={notes}>
      {slides}
    </Presentation>
  );
}
