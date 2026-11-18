# The Hollin course

A web tutorial that teaches the basics of home design while it teaches Hollin: **https://hollin-course.web.app**, in English and Arabic. Twenty-one lessons. Each one explains a design idea in plain words (why rooms have the sizes they do, where a door belongs, how a stair is sized), shows the tool that draws it, and gives numbered steps to do in the app. Part 1 practises on a small two-storey house; part 2 builds a real project from an empty page: two floors of two mirrored apartments round a shared stair; part 3 is a second project, a Saudi family villa planned round hospitality and privacy (a majlis by the guests' own entrance, the family's rooms behind a thick wall, the bedrooms upstairs). The reader works by hand throughout; Otto gets one note at the end.

It is for the people the app is for: homeowners and hobbyists, not engineers. A reader signs in with Google to keep their progress across devices; without an account it is kept in the browser.

## How it is built

Static files, no framework and no build step (`public/`), on Firebase Hosting:

```
public/index.html, styles.css     the page and its skin (Hollin's colours and fonts, light and dark, mirrored in Arabic)
public/js/boot.js                 language, direction and theme before the first paint
public/js/app.js                  the home page and one lesson at a time (#/lesson/<id>), from the content below
public/js/store.js                progress: localStorage, and Firestore when signed in
public/js/diagrams.js             the course's own drawings (inline SVG from millimetres; worded per language)
public/js/ui-text.js              the words of the page itself, both languages
public/content/course.js          the outline: parts, lesson order, minutes
public/content/en.js, ar.js       the lessons, as data: sections of blocks (text, pictures, drawings, tables, steps)
public/shots/<lang>/*.webp        pictures of the app, taken by the app (see below), with shots.json (sizes, numbered marks)
scripts/check.mjs                 both languages have the same shape, every picture exists and is used
scripts/serve.mjs                 a local server for looking at a change
firebase.json, firestore.rules    hosting, the Google sign-in provider, the database's rules
```

Nothing is installed: the page loads the Firebase web SDK (12.4.0: app, auth, firestore-lite) from Google's CDN, only on Firebase Hosting, and its fonts from Google Fonts (the same faces the app bundles). The Firebase configuration is not in the source either: Hosting serves it at `/__/firebase/init.json`. `firebase-tools` is run with `npx` at deploy time.

## The pictures are taken by the app

Every screenshot in a lesson comes from `src/main/smoke/course-shots.ts`. With `COURSE_SHOTS` set, the smoke launch draws the course's three projects instead of running the checks, once in English and once in Arabic, the way the lessons tell a reader to: lengths typed along a tracked direction, runs closed on their first point, walls started on endpoints, a door at a typed distance, the mirror of one apartment into the other with Shift+M and Ctrl. Each such step is checked against the document, so **a lesson step that stops working fails the run**. Furniture, finishes and lights go through commands.

```
COURSE_SHOTS=course/public/shots npm run smoke     # about eight minutes; needs the 1440 x 900 window, as the smoke does
COURSE_LANGS=en COURSE_PART=1 ...                  # one language, the practice house only: for working on the script
COURSE_LANGS=en COURSE_PART=13 ...                 # the practice house and the villa, without the apartments
```

The lessons and that script say the same thing twice, in words and in code: **change them together**. A length in a lesson (`3800`, `4700`) is a length in the script; a picture a lesson shows (`fig: 'b-mirror'`) is a `shots.take('b-mirror', ...)` there. After a change to the app's interface, run it again and look at the pictures.

Three things the app does that the lessons work around, found while writing them:

- The first click of a drawing lands where the pointer is (the grid is not snapped to by default), so a hand-drawn design never starts at 0,0. The lessons never use coordinates: every length is typed from the last point, and every later wall starts on a "stop", an endpoint made by drawing the outline in pieces.
- Walls do not make a floor. Without a slab there is no floor in 3D and nothing to walk on, so lesson 6 has the reader draw one (Rectangle, *Make: a slab*).
- A detected room is selected by a click near the point it was made from, not anywhere inside it. The lessons say so.

## The numbers were checked

The course is for homeowners, but its sizes must not clash with what building rules ask. They were checked against the UK's Approved Document K (stairs, landings, handrails, guarding), the Dubai Building Code 2021 (stairs, room sizes, door widths, daylight) and, second hand, the IRC and IBC stair rules that the Saudi Building Code follows, and the ACI 318 thickness guides for slabs. What follows from that, and has to stay true when a lesson changes:

- **Stairs**: risers of 170 mm at most and treads of 280 mm at least, set once in Settings > Rules (lesson 6), which a home's stair and a shared one both pass in all of them. Every stair has a clear landing at its foot and its top at least as long as the stair is wide. The script checks the riser count of each stair.
- **Windows**: every room people stay in has windows of a tenth of its floor area or more (lessons 12 and 21 do the sum), sills are 900 mm above the floor people stand on, and a window by a half-landing is measured from the landing.
- **Structure**: no slab spans more than 5.5 m between columns or load-bearing walls (the apartments' 18 columns, the villa's 12); the lessons say an engineer sizes them.
- **Light**: the lamps of every room add up to the rule of lesson 8 (100 to 150 lumens a square metre where people sit, about 300 where they cook or wash).

## Working on it

```
cd course
npm run check        # node scripts/check.mjs
npm run serve        # http://localhost:5050, no sign-in (no Firebase behind it)
npm run deploy       # the check, then firebase deploy (hosting, rules, sign-in provider)
```

`npm run deploy` needs the Firebase CLI logged in to the account that owns the project `hollin-course` (`.firebaserc`); add `-- --account <email>` when another account is the default. To try signing in locally: `npx firebase-tools emulators:start --only hosting`.

A lesson is an object in `content/en.js` and the same object in `content/ar.js`: `title`, `lead`, `card`, `learn`, and `sections` of a `kind` (`idea`, `app`, `do`, `check`, `more`). Interface names are written exactly as the app shows them in that language (they come from `packages/core/src/i18n`), keys as `<kbd>`, what the reader types as `<code>`. `scripts/check.mjs` fails when the two languages differ in shape.

## What it stores

Signed in, one Firestore document per reader, `users/<uid>`: the lessons done (with a date), the steps ticked, the last lesson opened, the language. No name, no email. Only that reader can read or write it (`firestore.rules`), and writes are checked for shape and size. Signed out, the same record lives in the browser's localStorage and nowhere else.

The Firebase project is the owner's (`hollin-course`: Hosting, Authentication with the Google provider, Firestore in `eur3`). Its console and its settings are the owner's, like the repository's.
