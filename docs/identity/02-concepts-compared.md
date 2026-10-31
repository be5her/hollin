# Visual identity, step 2: four concepts compared

Four designers (agents) each pushed one mood into the same sheet (`docs/identity/01-ux-study.md`, "What a concept has to deliver"). Each concept lives in `design/concepts/<n>-<mood>/`: `README.md` (the sheet), `icon.svg` (1024 px master) and `concept.html` (wordmark, type, both palettes, mocks at 1890 × 1020). Full-page captures of the four pages are in `design/concepts/shots/` (`<n>-<mood>-NN.png`), so they can be compared without opening a browser.

## At a glance

| | 1 · Craft | 2 · Minimal | 3 · AI-native | 4 · Playful |
|---|---|---|---|---|
| **Name** | Hollin (also Penrow, Lindel) | Noli (also Mullion, Lintel) | Nolli (also Bothy, Aedis); assistant **Otto** | Cubby (also Snuggery, Doma); assistant **Cub** |
| **Idea** | Paper, ink walls, one terracotta mark; the plan as a drawing on a desk | Ink on white, hairlines, radius 0, true black at night; colour only for live state | Two authors, one plan: your edits in ink blue, Otto's in plum, signed in History | A home you make: coral for the home, teal for your hand, blueberry for the numbers |
| **Accent** | terracotta `#b9552f` / `#e07c50` | vermilion `#e8401c` / `#ff6a45` | ink blue `#2457d5` / `#6d9bff` + plum `#a0338e` / `#e07ad0` | teal `#0f8a7e` / `#3fc9b9` + coral `#f07a4a` + blueberry `#5b5fd8` |
| **Surfaces** | warm paper `#f6f1e8` / dark desk `#1d1a17` | white `#ffffff` / black `#000000` | cool graphite `#f5f6f8` / `#14171f` | cream `#fbf7f1` / warm charcoal `#221c1b` |
| **Type** | Alegreya Sans + IBM Plex Mono, Fraunces for the wordmark and hero headings | Geist + Geist Mono | Manrope + JetBrains Mono | Rubik + Spline Sans Mono |
| **Icon** | paper tile, two ink walls, terracotta door swing | white tile, one room with its door open, one vermilion square | ink tile, your white room beside Otto's plum room | coral tile, cream house, teal door |
| **Assistant** | quiet: a pen icon, terracotta Send | deliberately quiet: a filled square in the margin, no persona | a persona: mark, colour, canvas halo, signed History, status-bar dot | a persona: "Cub", coral round mark, quiet until asked |
| **Home cards** | plan on a paper tint; serif initials when empty | hairline grid cells, ink plans, an empty frame when there is no drawing | plan thumbnails, a "Start with Otto" composer card first | plan on cream, a coral plan doodle with a round initials badge when empty |

## What I saw in the pages

**Craft (Hollin).** The most complete and the most *coherent*: paper, ink, terracotta and the serif wordmark carry through the Home, the project window, the dark "desk lamp" theme, the empty project and About without a seam. The canvas looks like a drawing (graphite walls, a sage wash, indigo dimensions) and the dark theme is genuinely designed, warm not inverted. Numbers in Plex Mono feel at home. Weak points: the icon is abstract (an L of walls and a quarter circle) and at 16 px it is just an L; three bundled families is one more than necessary; terracotta is both the UI accent and the selection colour, so an AI colour would have to be added on top.

**Minimal (Noli).** The strongest single decision of the four: hairlines instead of panels, radius 0, two type weights, true black at night. The icon is the best of the four at every size. The Home as a hairline grid of ink plans is handsome. Weak points: it is the coldest for homeowners, the vermilion wash on a selected room reads pink against white, and nothing in it says "home" rather than "design tool". It is also the one that most resembles what the app is now, done better.

**AI-native (Nolli & Otto).** The best *product thinking*: Otto's edits carry a plum halo on the canvas and a tag that fades, History entries are signed and tinted, the status bar says what Otto is doing, the Home has a composer card, and the empty project offers a sentence to edit rather than a button. Those mechanics are worth keeping whichever mood wins. As an identity it is the weakest: cool grey surfaces and a blue accent are the current placeholder with a plum added, Manrope reads as any SaaS, and plum-on-graphite will date. The name collides with concept 2 (both designers reached for Nolli's map independently, which also means others will).

**Playful (Cubby).** The most memorable and the best app icon for a dock or a store: a house everyone reads at 16 px. Three colours with a job each (coral home, teal hand, blueberry numbers) is a disciplined idea and the Home cards are the friendliest. Rubik at 13 px still reads as a tool. Weak points: coral room fills make a busy plan loud, the teal elevator car and teal glass in 3D look like a toy, and the name "Cubby" was a LogMeIn product (dead since 2016, domain probably held).

## Recommendation

Pick **Craft (Hollin)** as the base and take two things from the others:

1. From **AI-native**: the mechanics of a second author. Reserve one colour for everything the assistant did (in Hollin's palette, indigo ink is already the dimension colour, so the AI colour would be a new one, say moss or a deep teal), tint and sign its History entries, and keep the composer card on Home and the "describe the room" line in the empty project.
2. From **Playful**: the icon's legibility. Hollin's mark should read as a room or a house at 16 px, not as an L.

Second choice: **Playful (Cubby)** with the canvas colours calmed (room fill as a pale tint, not coral; glass and elevator in the scene palette's warm greys). Minimal is the fallback if the owner wants the app to feel like a precise instrument first and a home tool second.

On names: Hollin, Noli/Nolli and Cubby all have mild collisions; none is clean enough to commit without the owner's own check (domains, app stores, a trademark search in the markets that matter). Penrow (craft) and Bothy (AI-native) came back clean in the agents' searches.
