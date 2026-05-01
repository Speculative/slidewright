import { slides, meta } from '../decks/ne-agents-day-2026/Deck.jsx';
import { DeckRoot, extractNotes } from './Slide.jsx';
import { TweaksPanel } from './TweaksPanel.jsx';

const notes = extractNotes(slides);

export function App() {
  return (
    <>
      <deck-stage width="1920" height="1080" id="stage">
        <DeckRoot {...meta}>{slides}</DeckRoot>
      </deck-stage>
      <TweaksPanel notes={notes} />
    </>
  );
}
