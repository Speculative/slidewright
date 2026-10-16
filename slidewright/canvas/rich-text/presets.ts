// Presets write ordinary source-backed styles; manual edits remain independent.
export const TEXT_PRESETS = [
  { id: 'title', label: 'Title', font: 'body', size: 100, weight: '700' },
  { id: 'header', label: 'Header', font: 'body', size: 76, weight: '700' },
  { id: 'body', label: 'Body', font: 'body', size: 38, weight: '400' },
] as const;
export type TextPreset = typeof TEXT_PRESETS[number];
