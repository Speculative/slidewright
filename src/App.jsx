import { slides, meta } from '../decks/ne-agents-day-2026/Deck.jsx';
import { Presentation } from './Presentation.jsx';
import { extractNotes } from './Slide.jsx';

const notes = extractNotes(slides);

export function App() {
  return (
    <Presentation {...meta} notes={notes}>
      {slides}
    </Presentation>
  );
}
