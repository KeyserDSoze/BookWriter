/** Synthetic manuscript: no text, names or plot taken from a real book. */
export const syntheticNarrarium: Record<string, string> = {
  "book.md": `---
type: book
id: book:porto-sintetico
title: Il porto di prova
language: it-IT
canon: canon
genre: mistero
---

# Premessa

Un manoscritto sintetico per i test.
`,
  "chapters/001-arrivo/chapter.md": `---
type: chapter
id: chapter:arrivo
number: 1
title: Arrivo
canon: canon
pov: character:mara
---

# Obiettivo narrativo

Presentare il porto.
`,
  "chapters/001-arrivo/001-il-molo.md": `---
type: scene
id: scene:arrivo:molo
chapter: chapter:arrivo
number: 1
title: Il molo
canon: canon
pov: character:mara
characters:
  - character:mara
locations: [location:porto]
factions: []
custom_label: 'Scritto a mano'
---

Mara osserva il porto. «È qui», dice. 🌊

Il vento si ferma.
`,
  "characters/mara.md": `---
type: character
id: character:mara
name: Mara
canon: canon
---

# Profilo

Una navigatrice.
`,
  "locations/porto.md": `---
type: location
id: location:porto
name: Porto
canon: canon
---

Un porto immaginario.
`,
  "timeline/events.md": "# Cronologia\n\n- Primo giorno: l'arrivo.\n",
  "state/current.md": "# Stato\n\nLa nave è al porto.\n",
  "guidelines/style.md": "Scrivere con chiarezza.\n",
  "reviews/sinossi-autore.md": "# Sinossi analitica\n\nUna nota privata dell'autore da conservare.\n",
};
