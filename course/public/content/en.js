/**
 * The lessons in English. Each lesson: a title, a lead, what it teaches, then sections of a kind
 * (`idea`: the design idea, `app`: how Hollin does it, `do`: steps to tick, `check`, `more`) made of
 * blocks (js/app.js turns them into HTML). Interface names are written as the app shows them, keys as
 * <kbd>, what the reader types as <code>. Every length and every step here is what
 * src/main/smoke/course-shots.ts does in the app when it takes the pictures: change them together.
 */
const ui = (s) => `<b class="ui">${s}</b>`;
const k = (s) => `<kbd>${s}</kbd>`;
const n = (s) => `<code>${s}</code>`;

const parts = {
  basics: {
    title: 'The basics of design',
    lead: 'Eight ideas every home rests on. You practise each one on a small two-storey house that grows from lesson to lesson.',
  },
  project: {
    title: 'The project: four apartments',
    lead: 'A real building from an empty page: two floors, two apartments on each, a shared stair. You draw one apartment well, then let the building repeat it.',
  },
  villa: {
    title: 'A second project: a Saudi family villa',
    lead: 'A home shaped by hospitality and privacy: a majlis for guests by an entrance of its own, the family\'s rooms out of sight, the bedrooms upstairs. You draw it faster, with what you know.',
  },
  after: {
    title: 'After the course',
    lead: 'Where to take your new skill, and a word about Otto.',
  },
};

const lessons = {
  // ------------------------------------------------------------------ 1
  plan: {
    title: 'Reading a plan',
    lead: 'A floor plan is a home seen from above with its roof lifted off. Learn to read one, then open Hollin and find your way around.',
    card: 'What a plan shows, real sizes, and a tour of the Hollin window.',
    learn: ['What the lines on a plan mean', 'Why everything is drawn in real sizes', 'How to start a project and move around the drawing'],
    sections: [
      {
        kind: 'idea',
        title: 'A slice through the house',
        blocks: [
          'Imagine cutting a house flat, about 1.2 m above the floor, lifting the top away and looking straight down. What you see is a <b>floor plan</b>. The cut passes through the walls, the doors and the windows, so those are what a plan draws best.',
          { draw: 'slice', words: { side: 'Seen from the side', above: 'Seen from above: the plan', cut: 'the cut, 1.2 m up', door: 'door', window: 'window', wall: 'wall' }, cap: 'The same wall twice. On the plan a wall is a thick band, a door is a gap with the arc its leaf sweeps, a window is thin lines inside the wall.' },
          {
            ul: [
              '<b>Walls</b> are thick dark bands. Outer walls are thicker than the walls between rooms.',
              '<b>Doors</b> are gaps with a quarter circle: the space the door needs to open. Nothing can stand there.',
              '<b>Windows</b> are thin lines in the thickness of the wall.',
              '<b>Stairs</b> are a row of steps with an arrow that points up.',
            ],
          },
          { h: 'Real sizes, always' },
          'A plan is not a sketch. Every line has its true length, so that a bed that fits on the plan fits in the room. Hollin measures in <b>millimetres</b>, as builders do: a door is 900, a bed is 2000 long, a room might be 4000 by 3500. You never calculate a scale; you type the real number.',
          { rule: 'Get a feel for sizes with your own body and home. A door is about 90 cm wide and 210 cm high. A bed is 2 m long. A corridor you can pass someone in is 1.2 m wide. Measure one room you know well: it becomes your ruler for every plan you read.' },
        ],
      },
      {
        kind: 'app',
        title: 'The Hollin window',
        blocks: [
          `Hollin opens on your projects. The first time, the page is empty and offers ${ui('New project')}.`,
          { fig: 'home-first', cap: `The first launch. ${ui('New project')} starts a design; your projects stay in a folder on your own computer.`, legend: [`${ui('New project')}: give it a name and you are in.`] },
          'A project opens in its own tab. Everything you need sits around the drawing:',
          {
            fig: 'tour',
            cap: 'A new, empty project.',
            legend: [
              'The project\'s name. Next to it, Hollin tells you it has saved: it saves by itself, all the time.',
              `${ui('Levels')}: the floors of the building. Below it, the numbers of the floor you are on, and its ${ui('Layers')}.`,
              'The tools: walls, doors, windows, rooms, stairs, furniture and more. Rest the pointer on one to read its name and its key.',
              `${ui('Plan')}, ${ui('Section')} and ${ui('3D')}: three ways of looking at the same building.`,
              `The panels: ${ui('Properties')} of what you selected, the furniture ${ui('Catalog')}, ${ui('History')}, ${ui('Warnings')} and the ${ui('Project')}.`,
              'The hint line. It always says what the tool in your hand expects next. When in doubt, read it.',
              `Undo and redo (${k('Ctrl')}+${k('Z')}). Nothing you do in this course is final.`,
              `${ui('Search commands')} (${k('Ctrl')}+${k('K')}) finds any command by name.`,
            ],
          },
          { h: 'Moving around the drawing' },
          {
            keys: [
              ['Mouse wheel', 'Zoom in and out, at the pointer.'],
              [`Middle button, or ${k('Space')} + drag`, 'Slide the drawing.'],
              [k('Home'), 'Show the whole drawing.'],
              [k('Esc'), 'Stop what you are doing; press again to put the tool down.'],
              [`${k('Ctrl')}+${k('Z')}`, 'Undo. As many times as you like.'],
            ],
          },
          { tip: `Hollin speaks English and Arabic. Change it with the gear at the top: ${ui('Settings')}, ${ui('Appearance')}, ${ui('Language')}. The Arabic interface needs Hollin 0.3 or newer. Lengths are shown in millimetres; ${ui('Settings')}, ${ui('Units')} changes that.` },
        ],
      },
      {
        kind: 'do',
        title: 'Start your first project',
        blocks: [
          {
            steps: [
              `Open Hollin and click ${ui('New project')}.`,
              { t: `Name it ${n('My first plan')} and click ${ui('Create')}.`, fig: 'new-project', size: 'medium', cap: 'A name is all a project needs.' },
              'Roll the mouse wheel forwards and backwards over the drawing. Watch the grid: each square is a real size, and the zoom is written at the top right of the plan, such as 1:50.',
              `Hold the middle mouse button (or ${k('Space')}) and drag to slide the drawing. Press ${k('Home')} to come back.`,
              'Rest the pointer on each tool in the toolbar and read its name. Notice that most have a single letter: that key picks the tool.',
              `Press ${k('W')}. The hint line at the bottom now asks for the start of a wall. Press ${k('Esc')}: you are back to the pointer.`,
            ],
          },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['You can say what a thick band, a quarter circle and a thin double line mean on a plan.', 'You know where the hint line is, and that it tells you what to do next.', 'You can zoom, slide the drawing and come back with Home.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 2
  walls: {
    title: 'Walls: the outline of a home',
    lead: 'Walls decide what is inside and what is outside, and they divide the inside into rooms. Draw your first house by typing its real lengths.',
    card: 'Outer and inner walls, and drawing by typing real lengths.',
    learn: ['Why outer walls are thick and inner walls thin', 'Drawing walls by pointing a direction and typing a length', 'Stopping where another wall will meet, so everything joins exactly'],
    sections: [
      {
        kind: 'idea',
        title: 'Thick outside, thin inside',
        blocks: [
          'A house has two kinds of wall. The <b>outer walls</b> keep the weather out and, in a small house like the one you are about to draw, carry the floors and the roof as well, so they are thick: about 200 mm, often more. The <b>inner walls</b> of this house only divide the space, so they can be thin: about 100 mm.',
          'That is the simple case, and you should know it is not the only one. In many buildings some inner walls carry weight too, and in most larger ones a frame of <b>columns and beams</b> carries everything while the walls only fill in between. You will place columns in part 2. Which wall or column carries what, and how thick it must be, is for an engineer to calculate, never to guess.',
          'A design begins with the outline: the shape of the house on the ground. Simple shapes are best. A rectangle is the cheapest shape to build, the easiest to roof and the easiest to furnish. Every corner you add costs money, so add one only when it earns its place.',
          { rule: 'Use round numbers. A wall of 4500 is easier to build, to measure and to remember than one of 4470. Keep corners at right angles unless you have a reason.' },
          'One more habit will save you hours: <b>measure to the middle of the walls</b>. In this course a "7500 wall" runs from the middle of one wall to the middle of the next. The room inside is a little smaller: you lose half of each wall\'s thickness. Hollin works this way unless you tell it otherwise, and it shows you the real room size later.',
        ],
      },
      {
        kind: 'app',
        title: 'The Wall tool',
        blocks: [
          `Press ${k('W')} or pick ${ui('Wall')} in the toolbar. A bar appears under the tools with the wall's ${ui('Thickness')}. Then:`,
          {
            ol: [
              'Click where the wall starts.',
              'Move the pointer in the direction the wall goes. A dashed guide appears when you are level or upright, and holds you there.',
              `Type the length and press ${k('Enter')}. You do not need to click in any box first: just type.`,
              'The next wall starts where that one ended. Move, type, Enter, again and again.',
              `Click the first point to close the outline, or press ${k('Enter')} to end where you are.`,
            ],
          },
          { fig: 'wall-typing', cap: 'The second wall of the outline: the pointer was moved to the right, 2000 was typed. Enter draws it exactly that long.' },
          { h: 'Stops: marking where walls will meet' },
          'Here is the trick that makes everything in this course exact. When you draw the outline, <b>stop at every place where an inner wall will meet it</b>. Instead of one wall of 9500, you type 7500 and then 2000. The house looks the same, but there is now a point 7500 along that you can click later, and Hollin will catch it exactly: a small square appears and the hint line says <i>Endpoint</i>.',
          { tip: `Hollin remembers the thickness you last used, even in another project. Before you draw, glance at ${ui('Thickness')} in the bar.` },
          {
            keys: [
              [k('W'), 'The Wall tool.'],
              ['A number, then ' + k('Enter'), 'A wall of that length, the way the pointer points.'],
              [k('Enter'), 'End the run of walls here.'],
              [k('Esc'), 'Drop the unfinished wall; again to put the tool down.'],
              [k('V'), 'The pointer, to select things.'],
              [k('Delete'), 'Delete what is selected.'],
              [k('Shift'), 'Held while drawing: keep to 45° steps.'],
              [k('Alt'), 'Held while drawing: do not catch nearby points.'],
            ],
          },
        ],
      },
      {
        kind: 'do',
        title: 'Draw the house',
        blocks: [
          'The practice house is 9.5 m by 4.5 m, with a bathroom across its right-hand end. Follow the numbers on the drawing: start at the dot, go round against the clock.',
          { draw: 'house-outline', words: { start: 'start here', close: 'click the start to close', later: 'the bathroom wall, next' }, cap: 'The outline in one run. The circles are stops: the two on the long sides are where the bathroom wall will stand.' },
          {
            steps: [
              `Press ${k('W')}. In the bar under the tools, check that ${ui('Thickness')} says 200 mm. If not, click it, type ${n('200')} and press ${k('Enter')}.`,
              'Click once in the lower left part of the drawing. That is the first corner of the house.',
              { t: 'Move the pointer to the right, away from the corner. Type the length of the first piece and press Enter. Leave the pointer where it is, type the second piece and press Enter.', typed: ['7500', '2000'], sub: 'You stopped at 7500 because the bathroom wall will start there.' },
              { t: 'Move the pointer up. Type and press Enter.', typed: ['4500'] },
              { t: 'Move the pointer to the left. Two pieces again: the stop for the bathroom wall, then the rest.', typed: ['2000', '7500'] },
              { t: 'Move the pointer down to the very first corner. When the small square appears on it, click. The outline closes. Press <kbd>Esc</kbd>.', fig: 'walls-outline', cap: 'Six walls, joined at their corners. The joints at the stops are invisible, but they are there.' },
              `Now the bathroom wall, a thin one. Press ${k('W')}, click ${ui('Thickness')}, type ${n('100')} and press ${k('Enter')}.`,
              `Move to the stop on the bottom wall, 7500 from the left. When the square appears, click. Move straight up to the stop on the top wall, and click when its square appears. Press ${k('Enter')} to end the run, then ${k('Esc')}.`,
              { t: `Click the new wall. The ${ui('Properties')} panel on the right shows its numbers: thickness 100, length 4500. You can change any of them there.`, fig: 'wall-properties', cap: 'A selected wall and its numbers. The little squares on it are grips: drag one to move that end.' },
              `Set the thickness back for next time: press ${k('W')}, type ${n('200')} in ${ui('Thickness')}, ${k('Enter')}, then ${k('Esc')}.`,
            ],
          },
          { warn: `Made a mistake? ${k('Ctrl')}+${k('Z')} takes back one step at a time. To remove a wall, press ${k('V')}, click it and press ${k('Delete')}.` },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Your house is a closed rectangle with one thin wall across it.', 'Clicking the thin wall shows a length of exactly 4500 mm.', 'You can explain why you typed 7500 and 2000 instead of 9500.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 3
  openings: {
    title: 'Doors and windows',
    lead: 'A door decides how you move through a room; a window decides how it feels. Place both with care, then with a click.',
    card: 'Where doors and windows belong, their sizes, and placing them exactly.',
    learn: ['Where a door should stand in a wall, and which way it should open', 'Door and window sizes that work', 'Placing openings by eye or at a typed distance'],
    sections: [
      {
        kind: 'idea',
        title: 'Doors: the way through',
        blocks: [
          'A door is more than a hole in a wall. It needs room to swing, and it starts a path that people will walk every day. Both take space that furniture cannot use.',
          { draw: 'door-place', words: { middle: 'Door in the middle', corner: 'Door by the corner', middleNote: 'two short walls, a path through the centre', cornerNote: 'one long wall free, the path along the edge' }, cap: 'The same room, the same door. By the corner it leaves whole walls for a bed, a sofa or a wardrobe.' },
          {
            ul: ['Put a door <b>near a corner</b>, about 10 to 20 cm from the side wall, so the leaf folds back against that wall.', 'A door opens <b>into the room</b> it serves, not into a corridor where it would hit people passing.', 'A front door opens <b>inwards</b>.', 'Two doors should not hit each other, and no door should hide a light switch or block a wardrobe.'],
          },
          { table: { head: ['Door', 'Width', 'Why'], rows: [['Front door', '<span class="num">1000 mm</span>', 'Furniture and guests come through it'], ['Room door', '<span class="num">900 mm</span>', 'Comfortable, and wide enough for a wheelchair'], ['Bathroom door', '<span class="num">800 mm</span>', 'A small room, but people still have to pass'], ['Every door', '<span class="num">2100 mm high</span>', 'The usual height']] } },
          { h: 'Windows: light, air and a view' },
          'A room without a window feels like a cupboard. Every room people stay in needs daylight and fresh air; only corridors, stores and some bathrooms can do without.',
          {
            ul: [
              'The <b>sill</b> is the height of the bottom of the window above the floor. 900 mm lets a table or a bed stand under it. A bathroom window sits high, at 1500 mm or more, for privacy.',
              'The living room gets the largest window. Bedrooms get enough to read by.',
              'Think about what the window looks at, and who can look in.',
              'Windows on two sides of a home let air blow through it on a hot evening.',
              'A bathroom or a store with no window needs a fan that pulls its air out. Note it on your plan.',
            ],
          },
          { rule: 'For enough daylight, the windows of a room should add up to at least one tenth of its floor area, and more is better, because the frame takes part of every window. A 12 m² bedroom wants 1.2 m² of glass: a window of 1200 by 1200 is 1.44 m² with its frame, which is just enough.' },
        ],
      },
      {
        kind: 'app',
        title: 'The Door and Window tools',
        blocks: [
          `Press ${k('D')} for a door or ${k('N')} for a window, then move the pointer over a wall. A preview follows the pointer along the wall and a small label says how far it is from the wall's start.`,
          { fig: 'door-tool', cap: `The Door tool over the front wall. The bar gives the door's ${ui('Width')} and ${ui('Height')}; the label says where it will land.` },
          {
            ul: [
              'Click to place it where the preview is.',
              `Or type a distance and press ${k('Enter')}: the middle of the door lands exactly that far from the start of that piece of wall. The start is the end you drew it from. A minus sign measures from the other end.`,
              `Before you click, ${k('F')} flips the side the door opens to and ${k('H')} moves the hinge to the other edge.`,
              `Sizes are in the bar under the tools: ${ui('Width')} and ${ui('Height')}, and for a window its ${ui('Sill')}.`,
            ],
          },
          `Changed your mind? Press ${k('V')}, click the door or window, and edit it in ${ui('Properties')}: its ${ui('Width')}, its ${ui('Hinge')}, the side it ${ui('Opens to')}. Or drag it along the wall.`,
        ],
      },
      {
        kind: 'do',
        title: 'Open up the house',
        blocks: [
          {
            steps: [
              `Press ${k('D')}. In the bar, check that ${ui('Width')} is 900 mm.`,
              { t: 'Move the pointer over the bottom wall, on its long piece. Type the distance and press Enter: the front door lands 3500 from the left corner.', typed: ['3500'], sub: `If its arc is outside the house, press ${k('Ctrl')}+${k('Z')}, press ${k('F')} and type the distance again.` },
              `The bathroom door is narrower: click ${ui('Width')}, type ${n('800')}, ${k('Enter')}. Move over the middle of the thin bathroom wall. Press ${k('F')} until the arc is on the bathroom side, then click.`,
              `Now windows: press ${k('N')}. Click on the bottom wall, about halfway between the left corner and the front door. Click again on the same wall, about 2 m to the right of the door: the kitchen sink will stand under that one.`,
              'Click in the middle of the left wall. Three windows so far.',
              { t: `The bathroom gets a small, high window. In the bar set ${ui('Width')} to ${n('600')}, ${ui('Height')} to ${n('600')} and ${ui('Sill')} to ${n('1500')} (press ${k('Enter')} after each). Click the middle of the right-hand wall.`, sub: `Then put the bar back to 1200, 1200 and 900 for the next window you draw.` },
              { t: `Press ${k('Esc')}. Your house now looks like this.`, fig: 'openings', cap: 'A front door, a bathroom door, three windows and a small high one. The top wall is left free on purpose: a stair will run along it.' },
              { t: `Click the front door. In ${ui('Properties')}, try ${ui('Opens to')} and ${ui('Hinge')}, and watch the arc move. Leave it opening into the house.`, fig: 'door-properties', cap: 'A selected door. Everything about it can be changed here, or by dragging it along its wall.' },
            ],
          },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Both doors open into a room, not out of the house.', 'The bathroom window is smaller and higher than the others.', 'You know what F and H do while you place a door.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 4
  rooms: {
    title: 'Rooms: size and proportion',
    lead: 'A room is a space with a name and a job. Learn the sizes that work, and let Hollin measure yours.',
    card: 'How big rooms should be, and measuring them in the app.',
    learn: ['Comfortable sizes for each kind of room', 'Why the shape of a room matters as much as its area', 'Naming rooms, reading their area and adding dimensions'],
    sections: [
      {
        kind: 'idea',
        title: 'Big enough, and the right shape',
        blocks: [
          'How big should a room be? Big enough for its furniture, plus the space to walk around it. Not much bigger: every extra square metre must be built, paid for, cleaned, heated and cooled.',
          {
            table: {
              head: ['Room', 'Comfortable area', 'Narrowest side'],
              rows: [
                ['Living room', '<span class="num">16 to 28 m²</span>', '<span class="num">3.6 m</span>'],
                ['Kitchen with a table', '<span class="num">10 to 20 m²</span>', '<span class="num">2.7 m</span>'],
                ['Main bedroom', '<span class="num">12 to 16 m²</span>', '<span class="num">3.0 m</span>'],
                ['Bedroom for one', '<span class="num">10.5 to 12 m²</span>', '<span class="num">3.0 m</span>'],
                ['Bathroom', '<span class="num">4 to 6 m²</span>', '<span class="num">1.6 m</span>'],
                ['Corridor or hall', 'as little as possible', '<span class="num">1.0 to 1.2 m</span>'],
              ],
            },
          },
          'Area is only half the story. A room of 3 by 4 m and a room of 2 by 6 m are both 12 m², but the first takes a bed, a wardrobe and a desk, and the second is a corridor with a bed in it.',
          { rule: 'Keep rooms between a square and one and a half times as long as they are wide. A room 3 m wide works well up to about 4.5 m long.' },
          'These are comfortable sizes, not legal ones. Building rules set smallest sizes of their own, and they differ from country to country; the figures in this table are at or above the ones the course was checked against.',
          'The height of a room matters too: 2.7 to 3 m from floor to ceiling feels generous in a home. You will set that in the lesson on floors.',
        ],
      },
      {
        kind: 'app',
        title: 'The Room tool',
        blocks: [
          `Walls alone are just lines. Press ${k('R')} and move the pointer into a space the walls close: it lights up and shows its area. Click, and the space becomes a room with a name.`,
          { fig: 'room-tool', cap: 'The Room tool over the big space: it lights up with its area before you click.' },
          {
            ul: [
              `A room follows its walls. Move a wall and the room's area changes by itself.`,
              `The area is the real floor inside the walls, the number that matters when you buy tiles.`,
              `To rename a room, press ${k('V')}, click the room near the spot where you made it, and type in ${ui('Name')} in ${ui('Properties')}.`,
              `The Dimension tool (${k('L')}) writes a length on the drawing: click two points, then click where the line should sit.`,
            ],
          },
          { warn: 'Click a room to select it; do not drag. A drag moves the marker the room grows from, and the room may jump to another space.' },
        ],
      },
      {
        kind: 'do',
        title: 'Name and measure the rooms',
        blocks: [
          {
            steps: [
              `Press ${k('R')}. Move into the big space, towards its left half, and click.`,
              `Press ${k('V')} and click the room close to where you just clicked. In ${ui('Properties')}, type ${n('Living')} in ${ui('Name')} and press ${k('Enter')}. It should say about 32 m².`,
              `Press ${k('R')} again and click inside the bathroom. Name it ${n('Bathroom')} the same way: about 8 m².`,
              `Now write the sizes on the drawing. Press ${k('L')}. Click the bottom left corner of the house, then the stop where the bathroom wall meets the bottom wall, then click a little below the house. A dimension of 7500 appears.`,
              'Do the same for the bathroom: the stop, the bottom right corner, then below. And once up the right-hand side: bottom right corner, top right corner, then to the right of the house.',
              { t: `Press ${k('Esc')}, then click the living room.`, fig: 'rooms', cap: 'Two named rooms with their areas, three dimensions, and the living room\'s numbers on the right.' },
            ],
          },
          'Compare with the table above. A room of 32 m² is more than a living room needs: in the next lesson part of it becomes the kitchen. A bathroom of 8 m² is generous: there will be room for a shower, and for a washing machine one day.',
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Both rooms have a name and an area on the plan.', 'You can say why 3 by 4 m is a better bedroom than 2 by 6 m.', 'The dimensions read 7500, 2000 and 4500.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 5
  zones: {
    title: 'Zones and flow',
    lead: 'A good home is quiet where you sleep, lively where you gather, and easy to walk through. That comes from where the rooms sit, not from how big they are.',
    card: 'Day, night and wet zones; short paths; open-plan spaces.',
    learn: ['The three zones of every home', 'How people move through a home, and how to keep paths short', 'Dividing an open space into zones without building a wall'],
    sections: [
      {
        kind: 'idea',
        title: 'Three zones',
        blocks: [
          'Sort the rooms of any home into three groups:',
          {
            ul: [
              '<b>The day zone</b>: the entrance, the living room, the dining table, the kitchen. Lively, open to guests.',
              '<b>The night zone</b>: the bedrooms. Quiet and private.',
              '<b>The wet rooms</b>: the kitchen, the bathrooms, the laundry. Everything with water pipes and drains.',
            ],
          },
          { draw: 'zones', words: { entrance: 'Entrance', living: 'Living room', kitchen: 'Kitchen', hall: 'Hall', bedroom: 'Bedroom', bathroom: 'Bathroom', day: 'day zone', night: 'night zone', dayWet: 'day zone, wet', wet: 'wet room' }, cap: 'A bubble diagram of the apartment you will build in part 2. Designers draw this before any wall: rooms as bubbles, lines for the ways between them.' },
          'Then follow four simple rules:',
          {
            ol: [
              '<b>The entrance leads to the day zone.</b> A guest should reach the living room without passing a bedroom.',
              '<b>The night zone sits behind a door.</b> One small hall, with its own door, serves the bedrooms and the bathroom. Guests in the living room see a closed door, not your unmade bed.',
              '<b>Wet rooms keep together.</b> A bathroom next to a kitchen, or above another bathroom, shares its pipes. Pipes are the dearest thing to move.',
              '<b>Paths are short.</b> Corridors cost as much to build as rooms and nobody lives in them. Under a tenth of the floor is a good target.',
            ],
          },
          { rule: 'Trace the daily paths on your plan with a finger: from the front door to the kitchen with shopping bags, from the bedroom to the bathroom at night, from the kitchen to the table with a hot pot. A path that crosses the middle of the seating, or runs through another room, is a sign to move a door.' },
          { h: 'Open plan' },
          'Not every zone needs walls. A kitchen that opens to the living room makes both feel bigger and lets the cook join the talk. The zones are still there: you mark them with a counter, a change of floor, a rug or a ceiling light.',
        ],
      },
      {
        kind: 'app',
        title: 'The Room divider',
        blocks: [
          `Hollin has a line for exactly this: the ${ui('Room divider')} (${k('S')}). It is not a wall. You cannot see it in 3D and you can walk through it. But on the plan it splits one space into two rooms, each with its own name, its own area and its own floor finish.`,
          { fig: 'divider-tool', cap: 'Drawing a divider: a click on one wall, a click on the wall opposite, then Enter. Start and end on the walls themselves, so the line leaves no gap.' },
          `To plan zones before any wall exists, draw them as bubbles: the ${ui('Rectangle')} (${k('K')}) and ${ui('Circle')} (${k('O')}) tools make plain shapes, and ${ui('Label')} (${k('T')}) writes a word on the drawing. Shapes mean nothing to the building; they are your sketch paper.`,
        ],
      },
      {
        kind: 'do',
        title: 'Make a kitchen zone',
        blocks: [
          'The big room of the practice house will be a living room and a kitchen in one. Which end gets the kitchen? The end next to the bathroom: the pipes are already there.',
          {
            steps: [
              `Press ${k('S')}. Click on the bottom wall itself, on its dark band, just to the right of the front door.`,
              `Move straight up (the dashed guide holds you upright) to the top wall and click on its dark band. Press ${k('Enter')}, then ${k('Esc')}.`,
              'Look at the room: the left part is still called Living, now about 17 m². The right part, about 15 m², has no name yet.',
              { t: `Press ${k('R')} and click in the right part. Press ${k('V')}, click it again and name it ${n('Kitchen')}.`, sub: 'If the names ended up the other way round, just rename both.' },
              { t: `Press ${k('Esc')}.`, fig: 'zones', cap: 'One open space, two zones. The kitchen sits against the bathroom wall, where the water is.' },
            ],
          },
          { tip: `Want to try a bubble diagram? In a new project, press ${k('O')}, draw three circles, and label them with ${k('T')}: day, night, wet. Move them around until the paths between them are short. Then draw walls around them.` },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['You can name the three zones and sort the rooms of your own home into them.', 'The plan shows Living, Kitchen and Bathroom, all with an area.', 'You can say why the kitchen went on the bathroom side.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 6
  floors: {
    title: 'Floors and stairs',
    lead: 'A building is floors stacked one on another, with a stair between. Give the house its floor, a second storey and the stair that joins them.',
    card: 'Slabs, floor heights, how a stair is sized, and seeing the building in section and 3D.',
    learn: ['What a slab is and how high a floor should be', 'The riser and the tread: sizing a stair you can climb comfortably', 'Adding a floor, drawing a stair, and looking at the result in section and in 3D'],
    sections: [
      {
        kind: 'idea',
        title: 'Stacking floors',
        blocks: [
          'Each floor of a building stands on a <b>slab</b>: the thick plate of concrete you walk on, which is also the ceiling of the floor below. The distance from the top of one slab to the top of the next is the <b>floor-to-floor height</b>. In a home 3 m is usual: about 2.7 m of room, and the rest is slab and floor finish.',
          'A slab cannot bridge any distance. As a first guide, a concrete slab 200 mm thick wants a support about every 5 to 6 m: a wall that carries weight, or a beam on columns. The practice house is 4.5 m deep, so its long outer walls can carry its floor. The building of part 2 is 10 m deep, and you will give it columns.',
          {
            ul: ['<b>Walls stand on walls, columns on columns.</b> The upper floor repeats the supports of the lower one, so the weight goes straight down.', '<b>Wet rooms stack.</b> A bathroom upstairs sits over the bathroom or the kitchen downstairs: one pipe serves both.', '<b>The stair comes first.</b> It takes more room than people expect, and it must be in the same place on both floors.'],
          },
          { h: 'A stair you can climb' },
          'Every step has a <b>riser</b>, its height, and a <b>tread</b>, the depth you put your foot on. Steep stairs have high risers and shallow treads; they save space and tire your legs.',
          { draw: 'stair', words: { riser: 'riser', tread: 'tread', rise: '3000 mm: one floor', formula: '2 × riser + tread = 60 to 65 cm' }, cap: 'A stair from the side. The rule under it is the length of a human stride.' },
          { rule: 'A comfortable, safe stair has risers of 15 to 17 cm and treads of 28 to 30 cm, and twice the riser plus the tread comes to between 60 and 65 cm. To climb 3 m you need 18 risers. In a straight line that stair is nearly 5 m long and 1 m wide, and it needs a clear <b>landing</b> at its foot and at its top, each at least as long as the stair is wide: plan that space before anything else.' },
          'Building rules set the limits, and they differ. Inside one home some countries accept risers of 19 or even 22 cm and treads of 22 to 25 cm; for a stair shared by several homes nearly all of them stop at 17 or 18 cm and ask for 28 cm of tread. This course uses 17 and 28 for every stair: what passes the stricter rule passes the others. Check the rule where you build.',
          'Two more things keep a stair safe. A <b>handrail</b> 90 to 100 cm above the steps. And a <b>guard</b>, a railing or a low wall at least 90 cm high (1.1 m in a shared building), wherever someone could fall: along the open side of the stair and round the edge of the hole upstairs.',
          `The stair also needs a hole in the slab above, the <b>stairwell</b>. Hollin works out the steps, cuts the hole and gives the stair its handrails (${ui('Handrails')} in its ${ui('Properties')}): you draw where the stair goes, it does the arithmetic. The railing round the stairwell is not drawn: it is yours to remember.`,
        ],
      },
      {
        kind: 'app',
        title: 'Slabs, levels and the Stair tool',
        blocks: [
          { h: 'The floor' },
          `Walls do not make a floor. You draw the slab yourself, as a rectangle: press ${k('K')}, set ${ui('Make')} to ${ui('a slab')} in the bar, and click two opposite corners of the house.`,
          { fig: 'slab-tool', cap: `The ${ui('Rectangle')} tool set to make a slab, stretched from one corner of the house to the other.` },
          { h: 'The levels' },
          `The ${ui('Levels')} panel on the left lists the floors, the top one first. Under the list are the numbers of the floor you are on: its ${ui('Floor to floor')} height (3000 mm) and its ${ui('Slab')} (200 mm). The two small buttons below them are ${ui('Duplicate level')}, a copy of this floor stacked above it, and ${ui('Add a level above')}, an empty one.`,
          { fig: 'levels', size: 'narrow', cap: 'Two floors. Click one to work on it; double-click its name to rename it.' },
          { h: 'The limits' },
          `Hollin checks every stair against limits that you set once, for all your projects: the gear at the top of the window opens ${ui('Settings')}, and ${ui('Rules')} is near the bottom. ${ui('Highest riser')} and ${ui('Shallowest tread')} are the two that matter. Hollin also uses them to work out the steps of a new stair.`,
          { fig: 'rules-settings', size: 'medium', cap: `${ui('Settings')}, ${ui('Rules')}, with the limits of this course: risers of 170 mm at most, treads of 280 mm at least.` },
          { h: 'The stair' },
          `Press ${k('Shift')}+${k('S')} for the ${ui('Stair')} tool. The bar offers its ${ui('Shape')}, its ${ui('Width')}, and the floors it joins: ${ui('From')} and ${ui('To')}. Click the foot of the stair, then its top, or type a length. Hollin shows the steps as you go and writes the number of risers on the hint line.`,
          { tip: `If a stair is too steep or too narrow, Hollin draws it in a warning colour and explains why in the ${ui('Warnings')} panel. Make it longer and the warning goes.` },
        ],
      },
      {
        kind: 'do',
        title: 'A second floor and a stair',
        blocks: [
          {
            steps: [
              `Press ${k('K')}. In the bar, open ${ui('Make')} and choose ${ui('a slab')}. Click the bottom left corner of the house, then the top right corner. The house has a floor.`,
              `Put the tool back for later: choose ${ui('a free shape')} in ${ui('Make')}, then press ${k('Esc')}.`,
              `In the ${ui('Levels')} panel on the left, click the first small button under the level's numbers: ${ui('Duplicate level')}. A copy of the ground floor appears above it, 3000 mm up.`,
              `Double-click the name of the new level in the list, type ${n('First floor')} and press ${k('Enter')}.`,
              { t: `You are now upstairs, in a copy of downstairs. It needs three small changes. Click the front door; in ${ui('Properties')} change ${ui('Kind')} to ${ui('Window')}, then set ${ui('Sill')} to ${n('900')} and ${ui('Height')} to ${n('1200')}. Nobody walks out of an upstairs wall.`, sub: 'Click the divider line and press Delete. Click the Kitchen room (near where its copy was made) and press Delete. Then rename Living to Bedroom.' },
              `Go back down: click ${ui('Ground floor')} in the ${ui('Levels')} panel.`,
              `Set the limits first. Click the gear at the top of the window, ${ui('Settings')}, and scroll down to ${ui('Rules')}. Type ${n('170')} in ${ui('Highest riser')} and press ${k('Enter')}; type ${n('280')} in ${ui('Shallowest tread')} and press ${k('Enter')}. Then click your project's tab to come back to the drawing.`,
              `Press ${k('Shift')}+${k('S')}. In the bar: ${ui('Shape')} ${ui('straight')}, ${ui('Width')} ${n('1000')}. ${ui('From')} and ${ui('To')} already say Ground floor and First floor.`,
              { t: 'Click inside the kitchen, near its top right corner: about 1.3 m to the left of the bathroom wall and half a metre below the top wall. That is the foot of the stair. Move the pointer to the left, along the top wall, type the length and press Enter.', typed: ['4760'], fig: 'stair-tool', cap: 'A click at the foot, the pointer moved left, 4760 typed: seventeen treads of 280 mm.' },
              { t: `Press ${k('V')} and click the stair. If it overlaps the top wall or stands away from it, nudge it with the arrow keys: each press moves it 100 mm. Keep at least 1 m of clear floor between its foot and the bathroom wall, and between its top and the left wall: those are its landings.`, fig: 'stair-plan', cap: 'The stair along the back wall. The arrow shows the way up; the zigzag is where the plan cuts through it.' },
              { t: `Click ${ui('Section')} above the drawing.`, fig: 'section', cap: 'The building from the side: two floors of 3 m, each on its slab, and the stair.' },
              { t: `Click ${ui('3D')}. Drag to turn the house, roll the wheel to come closer.`, fig: 'view-3d', cap: 'Two storeys. The top is open so you can look in.' },
              { t: `In the bar of the 3D view, click ${ui('Cutaway')} and choose ${ui('First floor')} in the list beside it.`, fig: 'view-3d-cut', cap: 'The first floor cut open at 1.2 m, like a plan you can turn. The stair arrives through the hole Hollin cut in the slab.' },
              `Click ${ui('All')}, then ${ui('Plan')}, to go back to the drawing.`,
            ],
          },
          { tip: 'Why 4760? Eighteen risers need seventeen treads, and 17 × 280 mm = 4760 mm. Try a shorter stair and watch the warning appear.' },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['The Levels panel shows First floor above Ground floor.', 'The stair shows 18 risers and no warning colour, with a metre of floor at each end.', 'In 3D you can see the stair coming up through the first floor.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 7
  furniture: {
    title: 'Furniture and the human scale',
    lead: 'A room is only as big as what fits in it with space to walk. Furnish the plan before anyone builds it.',
    card: 'The clearances people need, and placing furniture from the catalog.',
    learn: ['The space people need around furniture', 'Testing a plan by furnishing it', 'Placing, turning and moving furniture from the catalog'],
    sections: [
      {
        kind: 'idea',
        title: 'Furniture plus room to move',
        blocks: [
          'An empty room on a plan always looks big. The test is to put the furniture in. Then you see whether the door can open, whether you can reach the window, whether two people can pass.',
          'Furniture needs its own size <b>plus the space to use it</b>. A wardrobe is 60 cm deep, but you need another 90 cm in front of it to open the doors and stand there.',
          {
            table: {
              head: ['Where', 'Clear space', 'For'],
              rows: [
                ['A path people walk', '<span class="num">90 cm</span>', 'walking without turning sideways'],
                ['Beside a bed', '<span class="num">60 to 70 cm</span>', 'getting in, making the bed'],
                ['In front of a wardrobe', '<span class="num">90 cm</span>', 'opening doors and drawers'],
                ['Sofa to coffee table', '<span class="num">40 to 45 cm</span>', 'legs, and reaching your cup'],
                ['Behind a dining chair', '<span class="num">75 cm</span>', 'pulling the chair out'],
                ['In front of a kitchen counter', '<span class="num">100 to 120 cm</span>', 'working, opening the oven'],
                ['In front of a toilet or basin', '<span class="num">60 cm</span>', 'standing there'],
              ],
            },
          },
          { rule: 'Furnish against the walls first and keep the middle open. Put the largest piece (the bed, the sofa) on the longest wall with no door in it. That is why the last lessons kept doors near corners.' },
          'Sizes worth remembering: a double bed is 1600 by 2000, a single 1000 by 2000, a three-seat sofa 2200 by 900, a wardrobe 600 deep, a kitchen counter 600 deep, a dining table for four 1200 by 800.',
        ],
      },
      {
        kind: 'app',
        title: 'The Catalog',
        blocks: [
          `Open the ${ui('Catalog')} panel on the right. ${ui('Furniture')} lists sofas, beds, kitchen units, bathroom fittings and lamps, each drawn at its real size. The chips above (${ui('Living')}, ${ui('Kitchen')}, ${ui('Bathroom')}…) narrow the list, and ${ui('Search')} finds a piece by name.`,
          { fig: 'catalog', cap: 'A sofa picked in the Catalog follows the pointer as a dashed outline. Here it has been turned with R before the click.' },
          {
            ul: [
              'Click a piece in the catalog: it sticks to the pointer.',
              `Press ${k('R')} to turn it by 15°; six presses make a quarter turn. ${k('Shift')}+${k('R')} turns it back.`,
              'Click on the plan to put it down. The same piece is still in your hand for another; ' + k('Esc') + ' lets go.',
              `Later, press ${k('V')} and drag a piece to move it, or drag its round grip to turn it. ${ui('Properties')} shows its place, its ${ui('Turn')} and its size.`,
            ],
          },
          { tip: 'The short line inside each piece marks its front: the side you sit on, or open, or stand at. Fronts face the room, backs go to the wall.' },
        ],
      },
      {
        kind: 'do',
        title: 'Furnish the ground floor',
        blocks: [
          {
            steps: [
              `Make sure you are on ${ui('Ground floor')}. Click ${ui('Catalog')} in the right panel, then the chip ${ui('Living')}.`,
              `Click ${ui('Sofa, 2 seats')}. Move over the plan and press ${k('R')} six times, so its back is to the left wall. Click by the left wall, under the window. Press ${k('Esc')}.`,
              `Click ${ui('Coffee table')}, turn it the same way and put it in front of the sofa, a hand's width away. Click ${ui('Armchair')} and put it near the front window, turned to face the table.`,
              `Click ${ui('Floor lamp')}. In the bar, keep ${ui('With its light')} ticked, so the lamp will really light the room at night. Put it in the corner beside the sofa.`,
              `Now the chip ${ui('Kitchen')}. Along the bottom wall, from the divider to the bathroom wall, place a ${ui('Fridge freezer')}, a ${ui('Sink unit')} under the window, a ${ui('Cooker')} and a ${ui('Base cabinet')}, side by side. Turn each with ${k('R')} twelve times first, so its front faces the room. The cabinet is the worktop beside the cooker: a hot pan needs somewhere to land.`,
              `The chip ${ui('Bathroom')}: a ${ui('Toilet')} and a ${ui('Washbasin')} against the right-hand wall, fronts to the room, and a ${ui('Shower')} in the top right corner.`,
              { t: `Press ${k('Esc')}, open ${ui('Properties')} and click the sofa.`, fig: 'furnished', cap: 'The ground floor furnished. A selected piece shows where it stands, its turn and its size, all of which you can type.' },
              'Check the plan like a designer. Can the front door open fully? Is there 90 cm from the door to the stair? Can you stand at the sink with the fridge door open? Move what is in the way.',
            ],
          },
          { tip: 'Your turn alone: go to the first floor and furnish the bedroom. A double bed, two nightstands, a wardrobe. Keep 60 cm beside the bed and 90 cm in front of the wardrobe.' },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Every door on the plan can swing without hitting furniture.', 'There is a clear path from the front door to the stair and to the bathroom.', 'You can turn a piece before placing it and move it afterwards.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 8
  finishes: {
    title: 'Materials, colour and light',
    lead: 'The same room can feel cold or warm, cramped or airy, with nothing moved but its surfaces and its lamps.',
    card: 'Choosing floors and colours, lighting a room, and seeing it by day and night.',
    learn: ['Which floor goes where, and how colour changes the size of a room', 'The three kinds of light every room needs', 'Painting surfaces, placing lights and walking through the result'],
    sections: [
      {
        kind: 'idea',
        title: 'Surfaces',
        blocks: [
          {
            ul: [
              '<b>Floors follow the use.</b> Timber or laminate where you live and sleep: warm underfoot and quiet. Tiles where there is water: kitchens, bathrooms, entrances.',
              '<b>Light colours make a room larger.</b> White and pale walls bounce daylight deep into a room. Dark colours pull the walls in; keep them for one wall, or for a large room.',
              '<b>Three colours are enough.</b> One main colour for most of the walls, a second for the big furniture, and a strong one in small amounts: a single wall, the cushions.',
              '<b>Fewer floor changes, calmer home.</b> The same floor through the living room, the hall and the bedrooms makes a small home feel like one space.',
            ],
          },
          { h: 'Light' },
          'Daylight comes first: that was the job of the windows. After dark a room needs three kinds of light, not one bright bulb in the middle of the ceiling:',
          {
            ol: ['<b>General light</b> to see the whole room: a ceiling lamp.', '<b>Working light</b> where hands are busy: over the kitchen counter, at the desk, by the mirror.', '<b>Soft light</b> for the evening: a floor lamp by the sofa, a lamp by the bed.'],
          },
          { rule: 'Light is measured in lumens. An ordinary household bulb gives about 800; a ceiling fitting with several bulbs, or an LED panel, gives 2000 or more. A living room or bedroom wants 100 to 150 lumens for each square metre, a hall or a stair about 100, a kitchen or bathroom about 300. So a 12 m² bedroom wants 1200 to 1800 lumens and a 12 m² kitchen about 3600. Add up the lamps of each room and compare.' },
        ],
      },
      {
        kind: 'app',
        title: 'Paint, lights, day and night',
        blocks: [
          `In the ${ui('Catalog')}, the second tab is ${ui('Materials')}: paints, timber, tiles, stone, brick. Click one and the pointer becomes a brush.`,
          { fig: 'materials', cap: 'Oak floorboards on the brush. On the plan, a click gives the material to the floor of the room under the pointer, or to the face of a wall.' },
          {
            ul: [
              'On the plan: click inside a room to cover its floor, or click the edge of a wall to paint that face.',
              `In ${ui('3D')}: click any wall, floor or ceiling you can see. Often the easier way.`,
              `Or select a room and use ${ui('Finishes')} in ${ui('Properties')}: ${ui('Floor')}, ${ui('Walls')} and ${ui('Ceiling')}, each with its own list. ${ui('Walls')} paints every wall of the room at once.`,
              `Lights: press ${k('G')}. The bar sets the kind of light, its height above the floor and its ${ui('Lumens')}. Click where it hangs.`,
            ],
          },
          `In the ${ui('3D')} view, ${ui('Day')} and ${ui('Night')} switch between the sun and your own lamps. ${ui('Cutaway')} slices the top off the floor you are on, so you look into the rooms like a doll's house.`,
          { tip: `To walk through your design, double-click a floor in the 3D view. ${k('W')} ${k('A')} ${k('S')} ${k('D')} or the arrow keys walk, a drag looks around, ${k('Esc')} flies back out. You walk through doors and up stairs, never through walls.` },
        ],
      },
      {
        kind: 'do',
        title: 'Finish the ground floor',
        blocks: [
          {
            steps: [
              `In the ${ui('Catalog')} panel, click the tab ${ui('Materials')}, then ${ui('Oak floorboards')}. Click on the floor of the Living zone.`,
              `Click ${ui('Large grey tiles')} and then the floor of the Kitchen zone. Click ${ui('White tiles')} and then the bathroom floor. Press ${k('Esc')}.`,
              `Walls next. Press ${k('V')}, click the Bathroom room, and in ${ui('Properties')} under ${ui('Finishes')} set ${ui('Walls')} to ${ui('Subway tiles')}.`,
              `Click the Living room and set its ${ui('Walls')} to ${ui('Warm grey paint')}. Click the Kitchen and give its walls ${ui('Sage paint')}: the two zones share the space, so the last one you choose colours the walls they share.`,
              { t: `Lights, by the rule. Press ${k('G')}. The living zone is about 17 m² and has its floor lamp of 1200 lumens: type ${n('1200')} in ${ui('Lumens')} and click in the middle of the zone. That makes 2400.`, sub: `The kitchen zone is about 15 m² and wants about 4500: type ${n('2200')}, click in the middle of the kitchen, then click again over the counter, where hands work. The bathroom is 8 m² and wants about 2400: ${n('1600')} in the middle, then ${n('800')} over the washbasin. Press ${k('Esc')}.` },
              { t: `Click ${ui('3D')}, then ${ui('Cutaway')} with ${ui('Ground floor')} in the list.`, fig: 'finishes-3d', cap: 'The ground floor by day: timber, tiles, a painted wall, and the lower steps of the stair.' },
              { t: `Click ${ui('Night')}.`, fig: 'night-3d', cap: 'The same rooms lit only by the lights you placed. Dark corners show at once where a lamp is missing.' },
              `Click ${ui('Day')} and ${ui('All')}. Then double-click the living room floor and walk around your house. ${k('Esc')} when you have seen enough.`,
            ],
          },
          'That is the whole method, on a small house: outline, walls, openings, rooms, zones, floors and a stair, furniture, finishes and light. In part 2 you use it, in the same order, on a real building.',
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Each room has a floor finish that suits its use.', 'At night every room has light, and its lamps add up to what the rule asks.', 'You have walked from the front door up the stair.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 9
  brief: {
    title: 'The brief and the outline',
    lead: 'Every building starts as a short list of needs. Write yours, turn it into a diagram, and set out the outline of a 21 m building in one run.',
    card: 'What we are building and why, then its outline in one run of walls.',
    learn: ['Writing a brief: who lives here and what they need', 'How the ideas of part 1 shape the plan of an apartment', 'Setting out a large outline with every stop it needs'],
    sections: [
      {
        kind: 'idea',
        title: 'The brief',
        blocks: [
          'A <b>brief</b> is what a designer writes down before drawing a line: who the building is for, what it must hold, and what limits it. Ours is short:',
          {
            ul: ['A plot that allows a building <b>21 m wide and 10 m deep</b>.', '<b>Two floors</b>, with <b>two apartments on each</b>: four homes for four families.', 'Each apartment: a living room, a kitchen with a dining table, <b>two bedrooms</b>, a bathroom.', 'One shared entrance and one shared stair.'],
          },
          'Now apply what you learnt. Each decision below comes straight from a lesson of part 1:',
          {
            table: {
              head: ['Decision', 'Why'],
              rows: [
                ['The stair hall stands in the middle, 3 m wide, with an apartment on each side.', 'One stair serves all four homes. The two apartments are mirror images, so they are designed once.'],
                ['The living room and the kitchen are at the front, by the apartment\'s door.', 'The entrance leads to the day zone.'],
                ['The bedrooms are at the back, behind a small hall with a door.', 'The night zone is private and quiet.'],
                ['The bathroom is in the middle of the back, between the bedrooms.', 'Close to both bedrooms; one above the other on the two floors.'],
                ['Every room except the small hall touches an outer wall.', 'Every room gets a window.'],
                ['Long walls run straight through the apartment.', 'Simple to build, and walls stand on walls between the floors.'],
                ['Columns stand where the main walls cross, never more than 5.5 m apart.', 'A 200 mm slab cannot bridge an apartment 9 m wide. The floors need supports.'],
              ],
            },
          },
          { draw: 'program', words: { kitchen: 'Kitchen', living: 'Living room', bed1: 'Bedroom 1', bed2: 'Bedroom 2', bath: 'Bath', hallway: 'Hall', hall: 'Stair hall', stair: 'stair', flatA: 'Apartment A', flatB: 'Apartment B: its mirror image' }, cap: 'One floor of the building. Warm tint: the day zone. Green: the night zone. The dashed line is the mirror between the two apartments.' },
          'Each apartment comes to about 84 m² of floor: a comfortable home for a family of four. Check the rooms against the table of lesson 4: the living room is 27 m², the bedrooms 16 and 14 m², the hall only 2.5 m².',
        ],
      },
      {
        kind: 'app',
        title: 'Setting out',
        blocks: [
          'You will draw the outline exactly as you drew the practice house: one run of walls, typed lengths, a stop wherever another wall will meet it. This building has more stops, because more walls arrive at the outline.',
          { draw: 'building-outline', words: { start: 'start here', close: 'click the start to close' }, cap: 'The outline with its eleven stops. On the left half they mark the walls of apartment A and the stair hall. The right half has almost none: apartment B will be made by a mirror.' },
          { tip: 'The building is 21 m wide: zoom out before you start. If you run out of screen while drawing, roll the wheel or slide the drawing with the middle button. The run of walls waits for you.' },
        ],
      },
      {
        kind: 'do',
        title: 'Draw the outline',
        blocks: [
          {
            steps: [
              `Go to the projects page (the house icon at the top), click ${ui('New project')} and name it ${n('Four apartments')}.`,
              'Roll the wheel back until the zoom at the top right of the plan reads about 1:150.',
              `Press ${k('W')} and check that ${ui('Thickness')} is 200 mm. Click in the lower left of the drawing: the first corner.`,
              { t: 'Move the pointer to the right. Four pieces along the bottom:', typed: ['3800', '5200', '3000', '9000'], sub: 'The kitchen wall, the stair hall\'s two walls, then the whole width of apartment B.' },
              { t: 'Move the pointer up. One piece:', typed: ['10000'], fig: 'b-outline-typing', cap: 'Going up the right-hand side: the bottom wall is done, 10000 is typed.' },
              { t: 'Move the pointer to the left. Five pieces along the top:', typed: ['9000', '3000', '3300', '1900', '3800'], sub: 'Apartment B, the stair hall, then bedroom 2, the bathroom and bedroom 1 of apartment A.' },
              { t: 'Move the pointer down. One piece, then click the first corner (wait for its small square) to close the outline.', typed: ['4500'] },
              { t: `Press ${k('Esc')}, then ${k('Home')} to see it all.`, fig: 'b-outline', cap: 'Twelve walls, 21 m by 10 m.' },
            ],
          },
          { warn: `If the outline does not close on the first corner, a length was mistyped. Press ${k('Ctrl')}+${k('Z')} back to the wrong piece and type on from there.` },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['The outline is closed and the plan shows a single rectangle.', 'Clicking the bottom wall near its left end selects a piece 3800 long.', 'You can point to where the stair hall will be.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 10
  partitions: {
    title: 'The walls of the first apartment',
    lead: 'Five runs of walls turn the left half of the outline into a home. Every one starts and ends on a point you can click.',
    card: 'The stair hall wall and the inner walls of apartment A.',
    learn: ['Which walls are thick and which are thin, and why', 'Drawing inner walls from stop to stop', 'Leaving the second apartment for the mirror'],
    sections: [
      {
        kind: 'idea',
        title: 'Two kinds of inner wall',
        blocks: [
          'The wall between an apartment and the stair hall is not an ordinary inner wall. It separates a family from their neighbours and from everyone on the stair, so it must stop noise and fire. It is as thick as an outer wall: <b>200 mm</b>. The walls between the rooms of one home stay thin: <b>100 mm</b>.',
          'None of these walls holds the building up. Columns will: you place them in lesson 15, on the points where the main walls meet, and that is one more reason to keep those walls straight and in line.',
          'Notice how few walls the apartment needs: one long wall from front to back, one from side to side, and two short ones round the bathroom. Long straight walls are quick to build and easy to furnish against. A plan full of short walls and corners is usually a plan that was not thought through.',
          { rule: 'Draw one apartment and get it right. Everything you add to it now (doors, furniture, lights) will be copied three times by the end of the course. So will every mistake.' },
        ],
      },
      {
        kind: 'app',
        title: 'From stop to stop',
        blocks: [
          'No new tool here: only the Wall tool, used with care. Each run begins with a click on a stop of the outline. The small square and the word <i>Endpoint</i> on the hint line tell you Hollin has caught it. Where a run meets a wall you drew a moment ago, its corners are endpoints too.',
          { draw: 'partitions', words: { kitchen: 'Kitchen', living: 'Living room', bed1: 'Bedroom 1', bed2: 'Bedroom 2', bath: 'Bath', hall: 'Stair hall' }, cap: 'The five runs, in order. Numbers beside a wall are lengths to type; where there is none, the wall ends on a point you click.' },
        ],
      },
      {
        kind: 'do',
        title: 'Five runs',
        blocks: [
          {
            steps: [
              { t: `<b>Run 1, the stair hall wall (200).</b> Press ${k('W')}, thickness 200. Click the stop on the bottom wall that is 9000 from the left corner: the second one. Move up, type the length and press Enter.`, typed: ['5500'], sub: `Then click the stop on the top wall straight above, and press ${k('Enter')} to end the run. Do not draw the other wall of the stair hall: the mirror will.` },
              `Change to thin walls: click ${ui('Thickness')}, type ${n('100')}, ${k('Enter')}.`,
              { t: '<b>Run 2, the long wall.</b> Click the first stop on the bottom wall, 3800 from the left corner. Move up and type two pieces:', typed: ['5500', '1500'], sub: `Then click the stop on the top wall straight above, and press ${k('Enter')}.` },
              { t: `<b>Run 3, the cross wall.</b> Click the stop on the left wall. Click the corner on the long wall (5500 up it). Move right and type:`, typed: ['1900'], sub: `Then click the corner on the stair hall wall, and press ${k('Enter')}.` },
              { t: '<b>Run 4, the bedroom wall.</b> Click the end of the 1900 piece you just drew. Move up and type:', typed: ['1500'], sub: `Then click the stop on the top wall above it, and press ${k('Enter')}.` },
              `<b>Run 5, the bathroom wall.</b> Click the corner on the long wall, 1500 above the cross wall. Click the corner opposite it on the bedroom wall. Press ${k('Enter')}, then ${k('Esc')}.`,
              { t: `Set the thickness back: ${k('W')}, ${n('200')} in ${ui('Thickness')}, ${k('Enter')}, ${k('Esc')}.`, fig: 'b-inner', cap: 'Apartment A: six spaces from five runs of walls. The stair hall beside it is still open on its right.' },
            ],
          },
          { warn: `If a click lands beside a stop instead of on it, the wall will be a few millimetres off and a room may not close. Zoom in when you are unsure, and wait for the small square before you click.` },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['You can count six closed spaces in the apartment.', 'The wall beside the stair hall is as thick as the outer walls; the others are thin.', 'Every inner wall ends exactly on another wall, with no gap and no overshoot.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 11
  'apartment-openings': {
    title: 'Doors and windows of the apartment',
    lead: 'Seven doors and seven windows, each placed for a reason. This is where the plan starts to work as a home.',
    card: 'Placing every door and window of apartment A, with the reason for each.',
    learn: ['Reading a plan for its paths before placing doors', 'Giving each door the right width and the right swing', 'Sizing windows to their rooms'],
    sections: [
      {
        kind: 'idea',
        title: 'Think first, then place',
        blocks: [
          'Before you place a door, walk the plan in your head.',
          {
            ul: [
              'You come in from the stair hall into the <b>living room</b>, at its back corner. The seating can fill the front of the room, by the big window, and nobody walks through it.',
              'From that same corner a door leads to the <b>small hall</b>, and from the hall to both bedrooms and the bathroom. The way from the front door to bed never crosses the sofa.',
              'The <b>kitchen</b> opens from the living room: food travels a few steps to the table and guests are not shown the washing up.',
              'Each bedroom door opens <b>into the bedroom</b>, against a wall. The hall is too small for doors to open into it.',
            ],
          },
          'Windows follow the rooms and the one-tenth rule of lesson 3: 3 m of window for the 27 m² living room, 1.8 m for each bedroom, two ordinary windows for the long kitchen, a small high one for the bathroom.',
          'The stair hall gets a window too: a dark stair is an unsafe stair. That window sits high. The half-landing of the stair will stand against its wall, 1.5 m above the floor, and a window must start about 90 cm above the floor people stand on. So its sill is at 2400, and it is a wide, low strip of glass.',
          { table: { head: ['Opening', 'Width', 'Note'], rows: [['Building entrance', '<span class="num">1200</span>', 'everything and everyone enters here'], ['Apartment entrance', '<span class="num">1000</span>', 'sofas must pass'], ['Room doors', '<span class="num">900</span>', ''], ['Bathroom door', '<span class="num">800</span>', ''], ['Living room window', '<span class="num">3000</span>', 'the main view'], ['Bedroom windows', '<span class="num">1800</span>', 'sill at 900'], ['Kitchen windows', '<span class="num">1200</span>', 'two of them, sill at 900'], ['Bathroom window', '<span class="num">600 × 600</span>', 'sill at 1500'], ['Stair hall window', '<span class="num">2000 × 400</span>', 'sill at 2400, above the landing']] } },
        ],
      },
      {
        kind: 'app',
        title: 'Placing by typed distance',
        blocks: [
          `You know the tools: ${k('D')} for doors, ${k('N')} for windows. The typed distance is the fast way here, because each wall is in pieces of known length. The number you type is measured from the start of the piece under the pointer to the middle of the door: half the piece's length puts the door in its middle.`,
          { fig: 'b-door-tool', cap: 'The apartment\'s entrance about to land on the stair hall wall, 4700 from its lower end: near the cross wall, in the back corner of the living room.' },
          { tip: `Before you press ${k('Enter')}, look at the preview arc. ${k('F')} flips it to the other side of the wall, ${k('H')} moves the hinge to the other edge. If a door lands wrongly anyway, select it and use ${ui('Opens to')} and ${ui('Hinge')} in ${ui('Properties')}.` },
        ],
      },
      {
        kind: 'do',
        title: 'Seven doors, seven windows',
        blocks: [
          { h: 'Doors' },
          {
            steps: [
              { t: `Press ${k('D')} and set ${ui('Width')} to ${n('1200')}. Move over the bottom wall, on the 3000 piece of the stair hall. Type the distance: the building's entrance, in the middle. It opens inwards.`, typed: ['1500'] },
              { t: `Set ${ui('Width')} to ${n('1000')}. Move over the stair hall wall, on its lower piece. Type the distance: the apartment's entrance. It opens into the living room, with its hinge on the upper side, so the leaf rests against the cross wall.`, typed: ['4700'] },
              { t: `Set ${ui('Width')} to ${n('900')}. Kitchen door: on the lower piece of the long wall, opening into the kitchen.`, typed: ['2750'] },
              { t: 'Hall door: on the 1900 piece of the cross wall, opening into the living room.', typed: ['950'] },
              { t: 'Bedroom 1: on the 1500 piece of the long wall, opening into the bedroom on the left. Bedroom 2: on the 1500 piece opposite, opening into the bedroom on the right. The same number for both.', typed: ['750'] },
              { t: `Set ${ui('Width')} to ${n('800')}. Bathroom door: on the short bathroom wall, opening into the bathroom.`, typed: ['950'], sub: `Then put ${ui('Width')} back to 900.` },
            ],
          },
          { h: 'Windows' },
          {
            steps: [
              { t: `Press ${k('N')}. The bar should say 1200, 1200 and a sill of 900. Kitchen: on the first piece of the bottom wall (3800 long), in its middle.`, typed: ['1900'] },
              'One more for the kitchen, by eye: the middle of the left wall beside it.',
              `Bedrooms: set ${ui('Width')} to ${n('1800')}. Click the middle of the left wall beside bedroom 1, and the middle of the top wall above bedroom 2 (the 3300 piece).`,
              { t: `Living room: set ${ui('Width')} to ${n('3000')}. On the 5200 piece of the bottom wall, in its middle.`, typed: ['2600'] },
              `Bathroom: set ${ui('Width')} ${n('600')}, ${ui('Height')} ${n('600')}, ${ui('Sill')} ${n('1500')}. Click the middle of the 1900 piece of the top wall.`,
              { t: `The stair hall: set ${ui('Width')} ${n('2000')}, ${ui('Height')} ${n('400')}, ${ui('Sill')} ${n('2400')}. On the 3000 piece of the top wall, in its middle.`, typed: ['1500'], sub: 'Then put the bar back to 1200, 1200 and 900.' },
              { t: `Press ${k('Esc')}.`, fig: 'b-openings', cap: 'Apartment A with its doors and windows. Every room but the small hall has daylight. On the plan the stair hall\'s window looks like the others; in 3D you see it high in its wall.' },
            ],
          },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['No door opens into the small hall.', 'You can trace the way from the building entrance to each bedroom without crossing a room you would not want a guest to cross.', 'The living room has the widest window.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 12
  'apartment-rooms': {
    title: 'Name the rooms, check the brief',
    lead: 'Six clicks give the apartment its rooms and their areas. Then comes the designer\'s habit: compare what you drew with what you set out to build.',
    card: 'Rooms and areas for apartment A, checked against the brief.',
    learn: ['Making and naming rooms quickly', 'Checking areas and proportions against the brief', 'Judging how much of a home is circulation'],
    sections: [
      {
        kind: 'idea',
        title: 'Does the plan keep its promise?',
        blocks: [
          'A brief is a promise, and the areas tell you whether the plan keeps it. Designers check three things:',
          {
            ol: ['<b>Each room against its purpose.</b> Is the bedroom big enough for a double bed, and wide enough?', '<b>The balance between zones.</b> A home that is all bedrooms with a tiny living room is uncomfortable; so is the opposite.', '<b>Circulation.</b> Halls and corridors should be a small share of the whole.'],
          },
          'When a number is wrong, this is the moment to move a wall: before the furniture, before the second apartment, before the first floor.',
        ],
      },
      {
        kind: 'do',
        title: 'Six rooms',
        blocks: [
          {
            steps: [
              `Press ${k('R')}. Click in the middle of each of the six spaces of the apartment. Leave the stair hall alone for now: it is still open on its right side.`,
              { t: `Press ${k('V')}. Click each room in turn, near its middle, and type its name in ${ui('Name')}:`, sub: `${n('Kitchen')}, ${n('Living room')}, ${n('Bedroom 1')} (the larger one, on the left), ${n('Hall')}, ${n('Bathroom')}, ${n('Bedroom 2')}.` },
              { t: 'Click the living room and read its numbers.', fig: 'b-rooms', cap: 'Six named rooms. Properties shows the selected room\'s area and the length of its walls.' },
            ],
          },
          'Compare your areas with these. A few hundredths more or less is rounding.',
          {
            table: {
              head: ['Room', 'Area', 'Inside size', 'Verdict'],
              rows: [
                ['Living room', '<span class="num">27.0 m²</span>', '<span class="num">5.05 × 5.35 m</span>', 'Generous, almost square'],
                ['Kitchen', '<span class="num">19.5 m²</span>', '<span class="num">3.65 × 5.35 m</span>', 'Room for a table for four'],
                ['Bedroom 1', '<span class="num">15.9 m²</span>', '<span class="num">3.65 × 4.35 m</span>', 'A double bed and a wardrobe'],
                ['Bedroom 2', '<span class="num">13.7 m²</span>', '<span class="num">3.15 × 4.35 m</span>', 'Two single beds and a desk'],
                ['Bathroom', '<span class="num">5.1 m²</span>', '<span class="num">1.80 × 2.85 m</span>', 'A bath, a basin, a toilet'],
                ['Hall', '<span class="num">2.5 m²</span>', '<span class="num">1.80 × 1.40 m</span>', 'Only 3% of the home'],
                ['<b>Total</b>', '<b class="num">83.7 m²</b>', '', ''],
              ],
            },
          },
          'The day zone (living room and kitchen) is 46.5 m², a little more than half. The night zone is 37 m². The hall is tiny: nearly every square metre is a room someone lives in.',
          'Check the daylight too, with the rule of lesson 3. The living room has 3.6 m² of window for 27 m² of floor: 13%. Bedroom 1 has 2.2 m² for 15.9 m²: 14%. Bedroom 2 has 2.2 m² for 13.7 m²: 16%. The kitchen\'s two windows make 2.9 m² for 19.5 m²: 15%. Every room is above one tenth, with something to spare for the frames. The plan keeps its promise.',
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Six rooms carry a name and an area.', 'Your total is close to 84 m².', 'No room says it is not enclosed. If one does, a wall missed its stop: zoom in on its corners.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 13
  interior: {
    title: 'Furnish, finish and light the apartment',
    lead: 'One apartment, done properly: every piece of furniture, every floor, every lamp. It is the longest lesson, and the last time you will do this work by hand.',
    card: 'Furniture, floors, wall colours and lights for apartment A.',
    learn: ['Furnishing a whole home room by room', 'Keeping the clearances of lesson 7 in every room', 'Choosing a small, calm set of finishes'],
    sections: [
      {
        kind: 'idea',
        title: 'A plan you could live in',
        blocks: [
          'Furnish each room the way you would live in it, and let the door and the window lead you. The sofa looks at the television and has the window to its side, not behind the screen. The bed has its head against a wall without a door. The desk gets daylight from the side.',
          'Choose few finishes: oak floors through the living room, the hall and both bedrooms; large grey tiles in the kitchen; white tiles in the bathroom. Two wall colours, both pale. The home reads as one place.',
          { rule: 'Work in this order in every room: the biggest piece first, on the best wall. Then what goes with it. Then check the door, the window and a 90 cm path. Only then the lamps.' },
        ],
      },
      {
        kind: 'do',
        title: 'Room by room',
        blocks: [
          `Open ${ui('Catalog')}, ${ui('Furniture')}. Remember: ${k('R')} turns a piece before you place it, and the short line inside it is its front.`,
          { h: 'Furniture' },
          {
            steps: [
              `<b>Living room.</b> ${ui('TV unit')} against the stair hall wall, in the front half of the room. ${ui('Sofa, 3 seats')} facing it, about 2.5 m away. ${ui('Coffee table')} between them. ${ui('Armchair')} at the back, turned to the table. ${ui('Floor lamp')} (with its light) behind the sofa's end, and a ${ui('Potted plant')} in the front corner.`,
              `<b>Kitchen.</b> Along the left wall, from the front: ${ui('Kitchen counter, 2.4 m')}, ${ui('Sink unit')}, ${ui('Cooker')}, ${ui('Fridge freezer')}, all facing into the room. In the front half, a ${ui('Dining table, 4 seats')} with four ${ui('Dining chair')}s, clear of the door's swing. A ${ui('Pendant lamp')} (with its light) over the table.`,
              `<b>Bedroom 1.</b> ${ui('Double bed')} with its head on the back wall, in the middle. A ${ui('Nightstand')} on each side. ${ui('Wardrobe')} on the wall opposite, clear of the door.`,
              `<b>Bedroom 2.</b> Two ${ui('Single bed')}s, heads on the back wall, a ${ui('Nightstand')} between them. ${ui('Desk')} and ${ui('Office chair')} on the wall by the hall. ${ui('Wardrobe')} on the stair hall wall.`,
              { t: `<b>Bathroom.</b> ${ui('Bathtub')} across the back wall, under the window. ${ui('Toilet')} on the left wall, ${ui('Washbasin')} on the right, both clear of the door.`, fig: 'b-furnished', cap: 'Apartment A furnished. Compare the gaps with the table of clearances in lesson 7.' },
            ],
          },
          { h: 'Finishes' },
          {
            steps: [
              `${ui('Catalog')}, ${ui('Materials')}. Click ${ui('Oak floorboards')}, then click the floors of the living room, the hall and both bedrooms.`,
              `${ui('Large grey tiles')} on the kitchen floor. ${ui('White tiles')} on the bathroom floor. Press ${k('Esc')}.`,
              `Select the bathroom and set ${ui('Walls')} to ${ui('Subway tiles')} in ${ui('Properties')}. Living room walls: ${ui('Warm grey paint')}. Bedroom 1 walls: ${ui('Sage paint')}.`,
            ],
          },
          { h: 'Lights' },
          {
            steps: [
              { t: `Press ${k('G')} and light each room by the rule of lesson 8: its area times 100 to 150 lumens where people sit or sleep, times 300 where they cook or wash. Type the ${ui('Lumens')} in the bar before each click:`, sub: `Living room (27 m²): two lights of ${n('1200')}, which with the floor lamp make 3600. Kitchen (19.5 m²): two of ${n('2500')}, one in the middle and one over the counter, which with the pendant make 5800. Bedroom 1: ${n('2000')}. Bedroom 2: ${n('1600')}. Bathroom: ${n('1000')} in the middle and ${n('600')} over the washbasin. Hall: ${n('400')}.` },
              `Click ${ui('3D')}, ${ui('Cutaway')}, then ${ui('Night')}. Is any corner dark where someone would sit or work? Add a lamp. Then back to ${ui('Day')} and ${ui('Plan')}.`,
            ],
          },
          { tip: 'Your apartment does not have to match the pictures piece for piece. If you prefer the sofa on the other wall, put it there, and check the paths again. That is designing.' },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Every door swings free of furniture.', 'Each bed can be reached from at least one long side with 60 cm to spare.', 'Every room has a floor finish, and its lamps add up to what the rule of lesson 8 asks.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 14
  mirror: {
    title: 'Mirror: the second apartment',
    lead: 'One drag, one key, two clicks: the whole apartment appears again on the other side of the stair hall, turned over like a page.',
    card: 'Selecting a whole apartment and mirroring it across the stair hall.',
    learn: ['Why apartment buildings repeat and mirror their plans', 'Selecting many things with a box', 'Mirroring a selection and keeping the original'],
    sections: [
      {
        kind: 'idea',
        title: 'Repeat what works',
        blocks: [
          'Look at any apartment building and you will find one or two plans, repeated. That is good design, not laziness:',
          {
            ul: ['A plan you have checked once is right every time it is repeated.', 'The builders learn it on the first apartment and are fast on the rest.', 'Kitchens and bathrooms line up, so pipes run straight.', 'A <b>mirrored</b> pair shares its stair and its entrance, and puts the two living rooms on the two outer corners, each with its own light and view.'],
          },
          'The mirror line runs down the middle of the stair hall. Everything in apartment A has a twin at the same distance on the other side.',
        ],
      },
      {
        kind: 'app',
        title: 'A box, then Shift+M',
        blocks: [
          { h: 'Selecting with a box' },
          `With the pointer (${k('V')}), press on empty floor and drag. The direction matters:`,
          {
            ul: ['Dragging <b>to the right</b> takes only what lies <b>completely inside</b> the box.', 'Dragging <b>to the left</b> takes everything the box <b>touches</b>. Its outline is dashed.'],
          },
          'You want the second kind: a box that touches every inner wall of the apartment but stops short of the outer walls.',
          { fig: 'b-select', cap: 'A box dragged from the empty stair hall to the far corner of the kitchen. It touches everything in the apartment and none of the outer walls.' },
          { h: 'Mirroring' },
          `With things selected, ${k('Shift')}+${k('M')} starts a mirror. Click two points: they are the mirror line. Hold ${k('Ctrl')} on the second click and Hollin <b>keeps the original</b> and adds its mirror image; without Ctrl it flips the original over.`,
          { fig: 'b-mirror', cap: 'After the first click on the middle of the top wall: the mirror image follows the pointer. Ctrl and a click on the middle of the bottom wall make it real.' },
          { tip: 'Hollin catches the middle of a wall as it catches its ends: a small triangle appears and the hint line says <i>Midpoint</i>. The middle of the stair hall\'s top wall is exactly on the mirror line.' },
        ],
      },
      {
        kind: 'do',
        title: 'Make apartment B',
        blocks: [
          {
            steps: [
              `Press ${k('V')}, then ${k('Home')} to see the whole building.`,
              { t: 'Put the pointer in the empty stair hall, near its top left: just to the right of the stair hall wall and a little below the top wall. Press, and drag down and to the left, to a point inside the kitchen near its bottom left corner. Stay inside the outer walls. Let go.', sub: 'The hint line now counts about 70 things selected. If an outer wall is highlighted, press Esc and drag again, staying further inside.' },
              `Press ${k('Shift')}+${k('M')}. The hint line asks for the first point of the mirror line.`,
              'Move to the middle of the top wall of the stair hall: the 3000 piece. When the small triangle appears, click.',
              `Move straight down to the middle of the bottom wall, at the entrance door. The second apartment appears as a preview. Hold ${k('Ctrl')} and click.`,
              { t: `Press ${k('Esc')}. Apartment B is there: its walls, its doors, its rooms with their names, its furniture, its lights. The mirror also built the second wall of the stair hall, with apartment B's entrance in it.`, sub: `If the original vanished instead, you clicked without Ctrl: press ${k('Ctrl')}+${k('Z')} and do the last two steps again.` },
              { t: `The windows of apartment B sit in outer walls that were not copied. Press ${k('N')} and place them, opposite those of apartment A. On the long piece of the bottom wall (it starts at the stair hall): set ${ui('Width')} ${n('3000')} for the living room, then back to ${n('1200')} for the kitchen.`, typed: ['2600', '7100'] },
              { t: `On the right-hand wall (it starts at the bottom): the kitchen, then bedroom 1 with ${ui('Width')} ${n('1800')}.`, typed: ['2750', '7750'] },
              { t: `On the long piece of the top wall (it starts at the right-hand corner): bedroom 2, still 1800 wide. Then the bathroom's small window, with ${ui('Width')} ${n('600')}, ${ui('Height')} ${n('600')}, ${ui('Sill')} ${n('1500')}.`, typed: ['7350', '4750'], sub: 'Put the bar back to 1200, 1200 and 900 afterwards.' },
              { t: `The stair hall is closed now. Press ${k('R')}, click in it, and name it ${n('Entrance hall')}. Give its floor ${ui('Polished concrete')} from ${ui('Materials')}. It is 27 m² and wants about 100 lumens for each: place two lights of ${n('1500')} with ${k('G')}, one near the entrance and one halfway down the hall.`, fig: 'b-mirrored', cap: 'One floor, two homes. Thirteen rooms, and you drew six of them.' },
            ],
          },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Apartment B is the mirror image of A: its kitchen is at the far right.', 'Both apartments have an entrance from the stair hall.', 'Every room of apartment B has its window.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 15
  upstairs: {
    title: 'The first floor and the stair',
    lead: 'Give the building its columns, copy the floor, change two things, and join the two with a stair that turns back on itself.',
    card: 'Columns, a slab, a second floor by duplication, and a U-shaped stair.',
    learn: ['What carries the floors, and where columns go', 'Why the upper floor repeats the lower one', 'Fitting a U-shaped stair into the stair hall'],
    sections: [
      {
        kind: 'idea',
        title: 'Columns, and a stair that turns',
        blocks: [
          'Before the floor goes on, the building needs something to carry it. A slab 200 mm thick should not bridge more than about 5 to 6 m, and each apartment is 9 m wide and 10 m deep. So the building gets <b>columns</b>: one wherever the main wall lines cross, six lines along the building and three across. No slab then spans more than 5.5 m. The columns stand in the same places on every floor, and beams inside the walls and the slab join them. How big they must be is for the engineer to calculate; your part is to give them a regular grid and to keep it.',
          'The first floor is the ground floor again. Columns stand on columns, walls on walls, bathrooms on bathrooms, and the stair hall is the one place that joins the floors. Only two things differ upstairs: nobody comes in from the street, and the hall is a landing.',
          'The stair hall is 2.8 m wide inside and the floor is 3 m up. A straight stair would need 5 m and would deliver you to the back wall. So the stair <b>turns</b>: nine risers up to a <b>half-landing</b> against the back wall, then nine more back towards the front, arriving on the first floor right above where you started. This is the <b>U-shaped stair</b> of nearly every apartment building.',
          { rule: 'A U stair with flights 1.2 m wide needs a space about 2.4 m wide and 3.6 m long, plus room to step on and off. A stair shared by several homes should be at least 1.2 m wide, so that two people can pass and a bed can be carried up, and it must be gentle: risers of 17 cm at most, treads of 28 cm at least. Those are the limits you set in lesson 6, so Hollin lays this stair out correctly by itself.' },
        ],
      },
      {
        kind: 'app',
        title: 'Snapshots, columns and the U stair',
        blocks: [
          `The ${ui('Column')} tool (${k('C')}) stands a column where you click. On the end of a wall it catches the point exactly, as the Wall tool does. The bar gives its shape and its size: the 300 by 300 mm it starts with is a fair first guess for two floors.`,
          `Before a big step, save a <b>snapshot</b>: a named copy of the design you can return to. It is in the ${ui('Project')} panel on the right, under ${ui('Snapshots')}.`,
          { fig: 'b-snapshots', size: 'narrow', cap: `The ${ui('Project')} panel. A snapshot costs one click and can save an evening.` },
          `The Stair tool (${k('Shift')}+${k('S')}) draws a U stair from two clicks: where it starts, and which way the first flight goes. Hollin lays out both flights and the landing from the height of the floor. ${ui('Turn')} chooses whether it comes back on the left or on the right.`,
          { fig: 'b-stair-tool', cap: 'The U stair after its first click, in the bar: shape U, width 1200, turning right. The preview shows the whole stair before the second click.' },
        ],
      },
      {
        kind: 'do',
        title: 'Build upwards',
        blocks: [
          {
            steps: [
              `Open the ${ui('Project')} panel on the right. Under ${ui('Snapshots')}, save one named ${n('Before the first floor')}. Then go back to ${ui('Properties')}.`,
              { t: `The columns. Press ${k('C')} and click eighteen points, waiting for the small square each time. Six along the bottom wall: the left corner, the kitchen wall, the two walls of the stair hall, the kitchen wall of apartment B, the right corner. The same six along the top wall. And the six between them, on the line of the cross walls. Press ${k('Esc')}.`, fig: 'b-columns', cap: 'Eighteen columns: six lines along the building, three across. The longest span is 5.5 m.' },
              `The floor slab: press ${k('K')}, set ${ui('Make')} to ${ui('a slab')}, click the bottom left corner of the building and then the top right corner. Set ${ui('Make')} back to ${ui('a free shape')} and press ${k('Esc')}.`,
              `In the ${ui('Levels')} panel click ${ui('Duplicate level')}. Double-click the new level's name and call it ${n('First floor')}.`,
              { t: `You are on the first floor. Click the entrance door in the bottom wall and, in ${ui('Properties')}, change ${ui('Kind')} to ${ui('Window')}, ${ui('Sill')} ${n('900')}, ${ui('Height')} ${n('1200')}.`, fig: 'b-window-props', cap: 'Upstairs, the street door becomes a window that lights the landing.' },
              `Still upstairs: click the Entrance hall room and rename it ${n('Landing')}.`,
              `Click ${ui('Ground floor')} in the ${ui('Levels')} panel. Press ${k('Shift')}+${k('S')}. In the bar: ${ui('Shape')} ${ui('U')}, ${ui('Width')} ${n('1200')}, ${ui('Turn')} ${ui('right')}.`,
              'Click in the stair hall, close to its left wall and about 90 cm above the line of the cross walls. Move the pointer straight up. The preview shows two flights and the landing; click anywhere above: Hollin gives the flights the length their steps need.',
              { t: `Press ${k('V')}, click the stair, and nudge it with the arrow keys until it sits between the two walls with its landing against the top wall.`, fig: 'b-stair-plan', cap: 'The stair in its hall: nine risers up on the left, the half-landing below the high window, nine more down the right to the first floor.' },
              { t: `Click ${ui('First floor')} in the ${ui('Levels')} panel.`, fig: 'b-first-plan', cap: 'The first floor. The stair arrives with its arrow pointing down, in the hole Hollin cut through the slab.' },
              { t: `Click ${ui('Section')}.`, fig: 'b-section', cap: 'Two floors and the stair between them.' },
            ],
          },
          { tip: `Something went badly wrong? ${ui('Project')}, ${ui('Snapshots')}, ${ui('Restore')} puts the design back as it was. Hollin keeps what you had as another snapshot, so even that can be undone.` },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['The Levels panel shows two floors, each with thirteen rooms.', 'Eighteen columns stand in the same places on both floors.', 'The stair has 18 risers in two flights and no warning colour.', 'Upstairs, the stair hall has a window where the entrance door is downstairs.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 16
  review: {
    title: 'Walk through and review',
    lead: 'The drawing is finished; the design is not, until you have looked at it the way its future neighbours will. Check it, walk it, and dress it.',
    card: 'Warnings, 3D views, a walk through the rooms, and the façade.',
    learn: ['Reviewing a design in a fixed order', 'Using the 3D views to see what a plan hides', 'Walking through the building at eye level'],
    sections: [
      {
        kind: 'idea',
        title: 'The review',
        blocks: [
          'Designers never trust a plan they have not reviewed. Go through this list for every design you make:',
          {
            ol: [
              '<b>The rules.</b> Is any stair too steep, any door too wide for its wall, any room open?',
              '<b>Daylight.</b> Does every room where people stay have windows of a tenth of its floor or more?',
              '<b>Safety.</b> Has every stair a landing at its foot and at its top, a handrail, and a guard round its stairwell? Is every window sill at least 90 cm above the floor people stand on beside it?',
              '<b>Paths.</b> From the street to each front door, from each front door to each bed: short, clear, and through no private room.',
              '<b>Privacy.</b> Standing at the apartment\'s door, can you see into a bedroom or the bathroom? You should not.',
              '<b>Furniture.</b> Does every door swing free? Is there space to walk?',
              '<b>Night.</b> Is every room lit as the rule of lesson 8 asks, and the stair?',
              '<b>Outside.</b> Does the building look calm from the street: windows in line, one above the other?',
            ],
          },
          'A plan answers the first few. For the rest you have to stand inside.',
        ],
      },
      {
        kind: 'app',
        title: 'Seeing in three dimensions',
        blocks: [
          {
            ul: [
              `${ui('Warnings')}, in the right panel, lists everything that breaks a rule. Click a warning and the plan shows you the culprit.`,
              `In ${ui('3D')}: ${ui('3/4')}, ${ui('Top')}, ${ui('Front')} and ${ui('Side')} are ready-made views. ${ui('All')} shows the whole building, ${ui('Isolate')} one floor alone, ${ui('Cutaway')} the floor you choose sliced open with the floors below it.`,
              `${ui('Explode')} lifts the floors apart so you can look into each.`,
              `${ui('Day')} and ${ui('Night')} change the light.`,
              'A double click on any floor puts you inside, at eye height.',
            ],
          },
          { fig: 'b-warnings', cap: `${ui('Warnings')} with nothing to report. This is what you want to see before you show a design to anyone.` },
        ],
      },
      {
        kind: 'do',
        title: 'Review your building',
        blocks: [
          {
            steps: [
              `Click ${ui('Warnings')} in the right panel. It should say ${ui('No warnings')}. If it lists something, click the line and fix what the plan shows.`,
              { t: `Click ${ui('3D')}, then ${ui('3/4')}. Drag to walk round the building. Are the windows of the two floors in line?`, fig: 'b-3d', cap: 'The whole building from its front left corner.' },
              { t: `Drag the ${ui('Explode')} slider to the right.`, fig: 'b-explode', cap: 'The floors lifted apart: four homes, two and two.' },
              { t: `Slide it back. Click ${ui('Cutaway')} and choose ${ui('Ground floor')}.`, fig: 'b-cutaway', cap: 'The ground floor open to the sky: both apartments, the entrance hall and the foot of the stair.' },
              { t: `Click ${ui('Night')}.`, fig: 'b-night', cap: 'The same floor after dark. Hollin switches on the sixteen lamps nearest to you, so in a building this size come closer to judge a far room.' },
              { t: `Click ${ui('Day')}. Double-click the floor of a living room. Walk with ${k('W')} ${k('A')} ${k('S')} ${k('D')}, look round by dragging. Go through the hall door, into a bedroom, back out, out of the apartment and up the stair. ${k('Esc')} when you are done.`, fig: 'b-walk', cap: 'Standing in the living room: the kitchen through one door, the hall through the other.' },
              `Dress the outside, if you like: ${ui('Catalog')}, ${ui('Materials')}, ${ui('White brick')}, then in ${ui('3D')} with ${ui('All')} chosen, click each piece of the outer walls. ${k('Esc')} when done.`,
              `Found something to improve? Go back to ${ui('Plan')} and change it. Remember that the first floor is a copy: a change on one floor has to be made on the other too.`,
            ],
          },
          { fig: 'b-render', cap: 'The finished building, with a white brick face.' },
          { fig: 'b-render-night', cap: 'And the first floor after dark, cut open: every home lit by its own lamps.' },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['Warnings is empty.', 'You have walked from a living room up to the first floor.', 'You went through the review list and can name one thing you would improve.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 17
  share: {
    title: 'Dimensions, drawings and sharing',
    lead: 'A design lives in other people\'s hands: a builder, an engineer, your family. Put the sizes on it and send it out.',
    card: 'Dimensions, PDF drawings, pictures, and passing the project on.',
    learn: ['What a builder needs to read on a drawing', 'Exporting plans to print, and pictures to show', 'Keeping and sharing the project itself'],
    sections: [
      {
        kind: 'idea',
        title: 'A drawing is a message',
        blocks: [
          'A plan without sizes is a picture. A plan with sizes is an instruction. Dimensions go in <b>chains</b> outside the building: one line with each piece, and a second line further out with the total, so the reader can check one against the other.',
          {
            ul: ['Printed plans carry a <b>scale</b>. At 1:100, one centimetre on paper is one metre of building: the usual scale for a house.', 'Every sheet says what it is: the project, the floor, the scale, the date.', 'People who do not read plans read <b>pictures</b>. A 3D view of the cut-open floor explains a home faster than any plan.'],
          },
          { warn: 'This course teaches design, not engineering. Its sizes are sound starting points, checked against published building rules, but rules differ from country to country and a structure has to be calculated. Before anything is built, a qualified architect or engineer must check the structure (the slabs, the beams, the columns and what they stand on), the stairs and their railings, fire safety and your local building rules. Your drawing is the best possible start for that conversation.' },
        ],
      },
      {
        kind: 'app',
        title: 'Export',
        blocks: [
          `${ui('Export…')}, above the drawing, makes files other programs and people can open:`,
          {
            table: {
              head: ['Format', 'What it is', 'For'],
              rows: [
                ['<b>PDF</b>', 'The plans on paper sheets, to scale, with a title block', 'Printing, sending to anyone'],
                ['<b>PNG</b>', 'A picture of a plan or of the building in 3D', 'Showing family, a message, a presentation'],
                ['<b>SVG</b> and <b>DXF</b>', 'The plan as lines', 'A print shop, an architect\'s CAD program'],
                ['<b>glTF</b>', 'The building as a 3D model', 'Other 3D programs'],
              ],
            },
          },
          { fig: 'b-export', cap: `${ui('Export…')}: choose the format, the floors, the paper and the scale. ${ui('Fit to page')} picks the largest standard scale that fits.` },
          `The project itself can travel too. ${ui('Export project…')}, at the top of the project, writes everything into one file you can back up or send to someone who has Hollin; ${ui('Import…')} on the projects page opens it.`,
        ],
      },
      {
        kind: 'do',
        title: 'Finish the drawing',
        blocks: [
          {
            steps: [
              `On the ${ui('Ground floor')}, in ${ui('Plan')}, press ${k('L')}. Along the bottom, click the left corner and the first stop, then click a little below the building: 3800. Go on from stop to stop: 5200, 3000, 9000.`,
              'Add the total: click the bottom left corner, the bottom right corner, then further below. 21000.',
              { t: `The same up the left side: 5500 and 4500, then 10000 further out. Press ${k('Esc')}.`, fig: 'b-dimensions', cap: 'Two chains of dimensions: the pieces, and the totals outside them.' },
              `Click ${ui('Export…')}. Choose ${ui('PDF')}, ${ui('All levels')}, page ${ui('A3')}, ${ui('Landscape')}, ${ui('Fit to page')}. Click ${ui('Export…')} and choose where to save. Open the file: two sheets, one for each floor.`,
              { t: `Click ${ui('Export…')} again and choose ${ui('PNG')}. Export the plan, then the building in 3D.`, fig: 'b-plan-export', cap: 'The ground floor as a picture, ready to send.' },
              { t: 'For the 3D picture, try it cut open: the view everyone understands.', fig: 'b-render-cutaway', cap: 'The ground floor from above, exported as a picture.' },
              `Click ${ui('Export project…')} at the top and save the project file somewhere safe. That is your backup.`,
              { t: 'Go back to the projects page.', fig: 'home-projects', cap: 'Your two projects, each with a picture of its ground floor.' },
            ],
          },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['The plan carries its dimensions in two chains.', 'You have a PDF with one sheet per floor.', 'You have a file of the project you could give to someone else.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 18
  'villa-brief': {
    title: 'Guests and family: the brief of a villa',
    lead: 'In a Saudi home, hospitality and privacy shape the plan before any wall is drawn. Write the brief of a family villa, read its zones, and draw its walls.',
    card: 'The majlis, the two entrances and the family zone; then the walls of the villa in six runs.',
    learn: ['How hospitality and privacy shape a Saudi home', 'Planning a guest zone and a family zone that do not cross', 'Drawing a whole floor of walls from one diagram'],
    sections: [
      {
        kind: 'idea',
        title: 'A home with two faces',
        blocks: [
          'The apartments of part 2 could stand almost anywhere. A family villa in Saudi Arabia starts from two ideas that are much older than concrete: a guest is honoured, and the family is not on show. The plan has to do both at once.',
          {
            ul: [
              '<b>The majlis.</b> The room where guests are received, often the best room of the house. It sits at the front, beside the entrance, so that a visitor reaches it without seeing the rest of the home.',
              '<b>One entrance for guests, another for the family.</b> Guests come in at the front. The family comes and goes by a door of its own, at the side, straight into its part of the house.',
              '<b>A washroom for guests.</b> Next to the majlis, with a basin for washing hands before and after a meal. A guest never has to be led through the family\'s rooms.',
              '<b>The family\'s rooms out of sight.</b> The family living room, the kitchen and the stair lie behind the guest rooms. From the guests\' door nobody should see into them, even when a door stands open.',
              '<b>A back way for the coffee.</b> Coffee, dates and dinner travel from the kitchen to the majlis without crossing the family living room.',
              '<b>The bedrooms upstairs.</b> The whole first floor is the night zone. No visitor climbs the stair.',
            ],
          },
          'This is lesson 5 with one more zone. There are four now: <b>guests</b>, <b>family</b>, <b>night</b> and <b>wet</b>. The new rule is that the guest zone and the family zone meet at as few doors as possible.',
          { draw: 'villa-program', words: { majlis: 'Majlis', entry: 'Guest\nentrance', wash: 'Guest\nwashroom', kitchen: 'Kitchen', living: 'Family living', stairHall: 'Stair hall', guests: 'guests come in here', family: 'the family\'s door', garden: 'the garden side', street: 'the street side' }, cap: 'The ground floor. Warm tint: the guest zone. Green: the family zone. Mauve: the washroom. The thick wall between the majlis and the family living room has a single door.' },
          { h: 'The brief' },
          {
            ul: [
              'A plot that allows a house <b>12 m wide and 10 m deep</b>, on two floors, with a garden behind it and a wall round the plot.',
              'Ground floor: a <b>majlis</b> for about twelve guests, a guest entrance and washroom, a kitchen big enough for the family\'s table, a family living room, and a stair hall with the family\'s door.',
              'First floor: a master bedroom with its own bathroom, two more bedrooms, a second bathroom, a small lounge.',
            ],
          },
          {
            table: {
              head: ['Decision', 'Why'],
              rows: [
                ['The majlis is at the front left, 5 m by 5.5 m, and the guests\' entrance is beside it.', 'Guests arrive, turn once and are seated.'],
                ['The guests\' washroom stands behind their entrance hall.', 'It closes the view from the front door into the house.'],
                ['The wall between the guest rooms and the family living room is 200 mm thick, with one door at the far end of the majlis.', 'Voices should not carry. The host comes and goes by that door.'],
                ['The kitchen is at the front right, with a door to the guests\' entrance hall.', 'A tray goes from the kitchen to the majlis in a few steps.'],
                ['The family living room is at the back, with its windows on the garden.', 'The most private side of the plot.'],
                ['The family\'s door is in the side wall and opens on the stair hall.', 'Shopping reaches the kitchen and children reach the stair, and no guest sees either.'],
              ],
            },
          },
          { rule: 'Test privacy with a straight line. Stand at each entrance on your plan and draw lines through every door as if it stood open. If a line from the guests\' door reaches one of the family\'s rooms, move a door or put a room in the way.' },
          'Two more things belong in this brief. The sun: windows that face west take the afternoon heat, so keep them modest and shade them. And the rules: in Saudi Arabia the Saudi Building Code says what a house must meet, and an architect licensed there checks your design against it.',
        ],
      },
      {
        kind: 'app',
        title: 'Reading the diagram',
        blocks: [
          'There is no new tool in this lesson: you know them all. So the steps are shorter. You get one diagram with the lengths and the order of the runs, the way a designer would sketch it for a colleague.',
          { draw: 'villa-walls', words: { start: 'start here', majlis: 'Majlis', entry: 'Entrance', wash: 'Washroom', kitchen: 'Kitchen', living: 'Family living', stairHall: 'Stair hall' }, cap: 'The outline with its six stops, then five runs of inner walls. Run 1 is the thick wall between the guests and the family.' },
          { tip: 'Two of the points are for later. The stop in the middle of the back wall and the point 3500 along run 1 are the two ends of a wall you will build upstairs.' },
        ],
      },
      {
        kind: 'do',
        title: 'Draw the walls of the ground floor',
        blocks: [
          {
            steps: [
              `Go to the projects page, click ${ui('New project')} and name it ${n('Family villa')}. Roll the wheel back to about 1:100.`,
              { t: `Press ${k('W')}, ${ui('Thickness')} 200. Click the first corner in the lower left. Move right and type three pieces:`, typed: ['5000', '2000', '5000'], sub: 'The majlis, the guests\' entrance, the kitchen.' },
              { t: 'Move up, two pieces:', typed: ['5500', '4500'] },
              { t: 'Move left, three pieces:', typed: ['5000', '3500', '3500'] },
              { t: 'Move down, one piece, then click the first corner to close the outline.', typed: ['4500'] },
              { t: `<b>Run 1, the thick wall (200).</b> Press ${k('W')} again. Click the stop on the left wall, move right and type three pieces. Press ${k('Enter')}.`, typed: ['3500', '1500', '2000'] },
              { t: `<b>Run 2, the long wall.</b> Set ${ui('Thickness')} to ${n('100')}. Click the second stop on the bottom wall, 7000 from the left corner. Move up and type one piece. Then click the end of run 1, then the stop on the top wall straight above. Press ${k('Enter')}.`, typed: ['2500'] },
              { t: `<b>Run 3, the majlis wall.</b> Click the first stop on the bottom wall, 5000 from the left corner. Move up and type one piece. Then click the point on run 1 straight above, and press ${k('Enter')}.`, typed: ['2500'] },
              `<b>Run 4.</b> Click the end of the 2500 piece of run 3, then the point opposite it on run 2. Press ${k('Enter')}.`,
              { t: `<b>Run 5.</b> Click the end of run 1, where it meets run 2, then the stop on the right-hand wall. Press ${k('Enter')}, then ${k('Esc')}. Set ${ui('Thickness')} back to 200.`, fig: 'v-walls', cap: 'The ground floor: six spaces. Below the thick wall, the guests. Above it and to the right, the family.' },
            ],
          },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['The plan shows six closed spaces.', 'One inner wall is as thick as the outer walls: the one between the majlis and the family living room.', 'You can point to the two entrances and say who uses each.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 19
  'villa-floors': {
    title: 'Doors, columns and the family\'s floor',
    lead: 'Place every door with privacy in mind and give the villa its columns. Then copy the floor and turn the copy into the bedrooms.',
    card: 'The doors and windows of the ground floor, the columns, a first floor made by copying and adapting, and the stair.',
    learn: ['Placing doors so that no line of sight runs from the guests to the family', 'Setting out columns before the floor goes on', 'Adapting a copied floor instead of drawing it again'],
    sections: [
      {
        kind: 'idea',
        title: 'Doors that keep the house private',
        blocks: [
          'Every door of this plan was placed with the straight-line test of the last lesson.',
          {
            ul: [
              'The <b>guests\' door</b> opens on a small hall. On the left is the majlis. Straight ahead is the washroom door, and behind that a solid wall.',
              'The <b>majlis</b> has two doors: the guests\' one, from their hall, and the host\'s one at its far corner, into the family living room. That one stays shut while guests are in.',
              'The <b>kitchen</b> has a door to the guests\' hall, for the trays, and one to the stair hall, for the family.',
              'The <b>family\'s door</b>, in the side wall, opens on the stair hall. From there: the kitchen, the living room, the stair.',
            ],
          },
          'Count the doors between the two zones: two, the host\'s door and the kitchen\'s. Both are opened from the family\'s side.',
          {
            table: {
              head: ['Opening', 'Width', 'Note'],
              rows: [
                ['Guests\' entrance', '<span class="num">1200</span>', 'in the middle of its wall'],
                ['Majlis door, family entrance, stair hall to living room', '<span class="num">1000</span>', ''],
                ['Other doors', '<span class="num">900</span>', ''],
                ['Washroom door', '<span class="num">800</span>', ''],
                ['Windows of the majlis, the living room and the front of the kitchen', '<span class="num">1800</span>', 'sill at 900'],
                ['Windows of the kitchen\'s side and of the stair hall', '<span class="num">1200</span>', 'sill at 900'],
              ],
            },
          },
          { h: 'What holds it up' },
          'The villa is 12 m by 10 m: far too much for a slab alone. Its columns stand at the four corners, at the six stops of the outline, and at the two points where runs 2 and 3 meet the thick wall. That makes twelve, and none is more than 5.5 m from the next.',
          { h: 'A floor that is copied, then adapted' },
          'Upstairs repeats the walls of the ground floor, because walls and columns stand on each other. But the rooms change their job. The majlis becomes the master bedroom. The guests\' hall and washroom become two bathrooms, one beside the other so that they share their pipes. The kitchen becomes a bedroom. The family living room is divided into a third bedroom and a lounge.',
          'So you copy the floor <b>before</b> it has rooms and furniture, and then change only what differs: the two outside doors become windows, two inner doors go, one wall and two doors are added.',
          { draw: 'villa-upper', words: { master: 'Master\nbedroom', masterBath: 'Master\nbath', bath: 'Bathroom', bed2: 'Bedroom 2', bed3: 'Bedroom 3', lounge: 'Lounge', landing: 'Landing', newWall: 'the new wall' }, cap: 'The first floor, on the walls of the ground floor. Green: the bedrooms. Mauve: the bathrooms. Warm tint: the lounge and the landing. The dashed line is the one wall that is new.' },
        ],
      },
      {
        kind: 'do',
        title: 'Doors, windows and the first floor',
        blocks: [
          { h: 'Doors' },
          {
            steps: [
              { t: `Press ${k('D')}, ${ui('Width')} ${n('1200')}. Move over the 2000 piece of the bottom wall and type the distance: the guests' entrance, opening inwards.`, typed: ['1000'] },
              { t: `${ui('Width')} ${n('1000')}. The majlis door: on the lower piece of run 3, opening into the majlis.`, typed: ['1250'] },
              { t: `${ui('Width')} ${n('900')}. The kitchen's door to the guests' hall: on the lower piece of run 2, opening into the kitchen. The same number.`, typed: ['1250'] },
              { t: `${ui('Width')} ${n('800')}. The washroom door: on run 4, in its middle, opening into the washroom.`, typed: ['1000'] },
              { t: `${ui('Width')} ${n('900')}. The host's door: on the 1500 piece of run 1, opening into the family living room.`, typed: ['750'] },
              { t: 'The kitchen\'s door to the stair hall: on run 5, near its left end, opening into the kitchen.', typed: ['700'] },
              { t: `${ui('Width')} ${n('1000')}. Two doors with the same number: on the upper piece of run 2, from the stair hall into the living room; and on the upper piece of the right-hand wall, the family's entrance, opening inwards.`, typed: ['800'], sub: `Then put ${ui('Width')} back to 900.` },
            ],
          },
          { h: 'Windows' },
          {
            steps: [
              { t: `Press ${k('N')}, ${ui('Width')} ${n('1800')}. Six windows, each in the middle of its piece: the bottom wall of the majlis and of the kitchen, the left wall beside the majlis and beside the living room, and the two pieces of the top wall above the living room.`, sub: 'By eye, or type half the length of the piece.' },
              { t: `${ui('Width')} ${n('1200')}. The middle of the right-hand wall beside the kitchen. Then the stair hall: on the 5000 piece of the top wall, which starts at the right-hand corner.`, typed: ['2750', '4200'], sub: 'The stair will run along that wall. The window stands clear of it, at the end where the stair arrives upstairs.', fig: 'v-openings', cap: 'Eight doors and eight windows. The guests\' washroom has no outside wall: it gets a fan.' },
            ],
          },
          { h: 'Columns, the slab and the first floor' },
          {
            steps: [
              { t: `Press ${k('C')}. Click the four corners of the house, the six stops of its outline, and the two points where runs 2 and 3 meet the thick wall. Press ${k('Esc')}.`, fig: 'v-columns', cap: 'Twelve columns, placed before the floor goes on.' },
              `Press ${k('K')}, set ${ui('Make')} to ${ui('a slab')}, click the bottom left corner of the house and then the top right. Set ${ui('Make')} back to ${ui('a free shape')} and press ${k('Esc')}.`,
              `In ${ui('Levels')}, click ${ui('Duplicate level')} and name the copy ${n('First floor')}. You are upstairs now.`,
              `Click the door in the bottom wall. In ${ui('Properties')}: ${ui('Kind')} ${ui('Window')}, ${ui('Width')} ${n('600')}, ${ui('Height')} ${n('600')}, ${ui('Sill')} ${n('1500')}. It is the window of the master bathroom now. Then click the family's door in the right-hand wall and make it a window too: ${ui('Kind')} ${ui('Window')}, ${ui('Sill')} ${n('900')}, ${ui('Height')} ${n('1200')}. Nobody walks out of an upstairs wall.`,
              `Click the door on the right of that small room, the one that led to the kitchen, and press ${k('Delete')}. Click the door at the back of the small room and press ${k('Delete')}: two bathrooms do not open into each other.`,
              `Press ${k('W')}, ${ui('Thickness')} ${n('100')}. Click the stop in the middle of the top wall, then the point on the thick wall straight below it. ${k('Enter')}, ${k('Esc')}. Set ${ui('Thickness')} back to 200.`,
              { t: `Press ${k('D')}. Bedroom 3's door: on the new wall, near its lower end, opening into the room on the left. Then ${ui('Width')} ${n('800')} for the bathroom: on the 2000 piece of the thick wall, in its middle, opening into the bathroom.`, typed: ['3800', '1000'], sub: 'The new wall starts at the top, so 3800 along it is 700 from its lower end.' },
              `Click ${ui('Ground floor')} in ${ui('Levels')}. Press ${k('Shift')}+${k('S')}: ${ui('Shape')} ${ui('U')}, ${ui('Width')} ${n('1000')}, ${ui('Turn')} ${ui('left')}. Click in the stair hall, 1.5 m from its left wall and 1.5 m below the top wall. Move the pointer to the right and click.`,
              `Press ${k('V')}, click the stair and nudge it with the arrow keys until its two flights lie along the top wall and its landing touches the right-hand wall.`,
              { t: `Name the rooms of the ground floor with ${k('R')} and ${k('V')}: ${n('Majlis')}, ${n('Guest entrance')}, ${n('Guest washroom')}, ${n('Kitchen')}, ${n('Family living')}, ${n('Stair hall')}.`, fig: 'v-rooms', cap: 'The ground floor with its rooms, its columns and the stair. The majlis is selected.' },
              { t: `And those of the first floor: ${n('Master bedroom')} over the majlis, ${n('Master bathroom')} and ${n('Bathroom')} behind it, ${n('Bedroom 2')}, ${n('Bedroom 3')}, ${n('Lounge')}, ${n('Landing')}.`, fig: 'v-first-plan', cap: 'The first floor: three bedrooms round a lounge, two bathrooms side by side, and the stair arriving on the landing.' },
            ],
          },
          'Compare your areas with these.',
          {
            table: {
              head: ['Ground floor', 'Area', 'First floor', 'Area'],
              rows: [
                ['Majlis', '<span class="num">25.7 m²</span>', 'Master bedroom', '<span class="num">25.7 m²</span>'],
                ['Guest entrance', '<span class="num">4.5 m²</span>', 'Master bathroom', '<span class="num">4.5 m²</span>'],
                ['Guest washroom', '<span class="num">5.4 m²</span>', 'Bathroom', '<span class="num">5.4 m²</span>'],
                ['Kitchen', '<span class="num">25.9 m²</span>', 'Bedroom 2', '<span class="num">25.9 m²</span>'],
                ['Family living', '<span class="num">29.4 m²</span>', 'Bedroom 3 and Lounge', '<span class="num">14.4 and 14.6 m²</span>'],
                ['Stair hall', '<span class="num">21.1 m²</span>', 'Landing', '<span class="num">21.1 m²</span>'],
              ],
            },
          },
          'The stair has a metre and a half of floor at its foot and where it arrives, its half-landing stands against a wall without a window, and the hall\'s window is clear of both. The inner bathroom upstairs has no window: like the guests\' washroom under it, it needs a fan.',
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['From the guests\' door, no straight line through open doors reaches the family living room or the stair.', 'Twelve columns stand in the same places on both floors.', 'The stair has 18 risers and no warning colour.', 'Upstairs, every bedroom opens on the lounge or the landing, never on another bedroom.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 20
  'villa-interior': {
    title: 'The majlis, the light and the roof',
    lead: 'Furnish the majlis the way guests are received, light every room by the numbers, close the house with a roof and look at what you made.',
    card: 'Furnishing a majlis, lighting by the rule, a roof level, and the finished villa.',
    learn: ['Furnishing a majlis: seats along the walls', 'Checking daylight and lamps against the rules of part 1', 'Closing a building with a roof level'],
    sections: [
      {
        kind: 'idea',
        title: 'A room for sitting together',
        blocks: [
          'A living room is arranged round a screen or a view. A majlis is arranged round its guests. The seats run along the walls, so that everyone faces everyone and nobody sits with their back to another; the middle stays open for the coffee, the dates and the people who serve them.',
          {
            ul: [
              'Seats on at least three walls, low tables in front of them, the middle clear.',
              'A carpet underfoot: the majlis is the softest and quietest floor of the house.',
              'Even, warm light from more than one lamp: no dark corner and no glare.',
              'The door near a corner, so that it opens onto the room and not onto a guest.',
            ],
          },
          'The rest of the ground floor follows part 1: the kitchen works along one wall and feeds the family at its own table, and the family living room looks at the garden.',
          { h: 'The roof' },
          'Every building so far in this course was left open to the sky, so that you could look in. A real house ends with a roof slab. In Hollin a roof is one more level with a slab on it. A flat roof that people use also needs a wall or a railing round its edge, at least 90 cm high, and a stair of its own: two good exercises for after this lesson.',
        ],
      },
      {
        kind: 'do',
        title: 'Furnish, light and close the villa',
        blocks: [
          {
            steps: [
              `<b>Majlis.</b> On the ${ui('Ground floor')}, from the ${ui('Catalog')}: four ${ui('Sofa, 3 seats')} along the walls, two on the left wall, one on the back wall, one under the front window. Two ${ui('Armchair')}s on the wall by the door. Two ${ui('Coffee table')}s in a line down the middle, and a ${ui('Potted plant')} in the corner.`,
              `<b>Guests' entrance and washroom.</b> Leave the small hall empty: three doors open on it. In the washroom, a ${ui('Washbasin')} on the right-hand wall, where a guest sees it first, and a ${ui('Toilet')} at the back.`,
              `<b>Kitchen.</b> Along the right-hand wall, from the front: ${ui('Fridge freezer')}, ${ui('Sink unit')}, ${ui('Kitchen counter, 2.4 m')} under the window, ${ui('Cooker')}. In the room, a ${ui('Dining table, 6 seats')} with six ${ui('Dining chair')}s and a ${ui('Pendant lamp')} (with its light) over it. Keep the door from the guests' hall clear.`,
              { t: `<b>Family living.</b> ${ui('TV unit')} on the thick wall. A ${ui('Sofa, 3 seats')} facing it, with the garden windows behind. A ${ui('Sofa, 2 seats')} under the side window, an ${ui('Armchair')}, a ${ui('Coffee table')}, a ${ui('Floor lamp')} (with its light) in the corner and a ${ui('Bookshelf')} beside the stair hall door.`, fig: 'v-furnished', cap: 'The ground floor furnished. In the majlis the seats follow the walls; in the living room they face the screen.' },
              `${ui('Materials')}: ${ui('Beige carpet')} on the floor of the majlis and ${ui('Warm grey paint')} on its walls. ${ui('Marble')} in the guests' entrance, the family living room and the stair hall. ${ui('Large grey tiles')} in the kitchen. ${ui('White tiles')} and ${ui('Subway tiles')} in the washroom.`,
              { t: `Press ${k('G')} and light each room by the rule of lesson 8:`, sub: `Majlis (25.7 m²): two lights of ${n('1600')}. Guests' entrance: ${n('500')}. Washroom: ${n('1000')} in the middle and ${n('600')} over the basin. Kitchen (25.9 m²): ${n('2500')} over the counter, then ${n('2500')} and ${n('2000')} over the rest of the room, which with the pendant make 7800. Family living (29.4 m²): two of ${n('1200')}, which with the floor lamp make 3600. Stair hall: two of ${n('1000')}.` },
              { t: `The roof. In ${ui('Levels')}, click the plus above the list and choose ${ui('Level on top')}. Double-click the new level and name it ${n('Roof')}. Press ${k('K')}, set ${ui('Make')} to ${ui('a slab')}, and click two opposite corners of the house: the floor below shows through. Set ${ui('Make')} back and press ${k('Esc')}.`, fig: 'v-levels', size: 'narrow', cap: 'Three levels: two floors and the roof.' },
              { t: `Click ${ui('Ground floor')}, then ${ui('Section')}.`, fig: 'v-section', cap: 'The levels from the side: two floors, the stair between them, and the roof, whose slab closes the house at 6 m.' },
              `Open ${ui('Warnings')}: it should say ${ui('No warnings')}. Then ${ui('3D')}: the house is closed now. ${ui('Cutaway')} with ${ui('Ground floor')} opens it again, by ${ui('Day')} and by ${ui('Night')}.`,
            ],
          },
          { fig: 'v-render', cap: 'The finished villa from the street. The guests\' door is in the middle of the front; the family\'s door is round the corner on the right.' },
          { fig: 'v-render-cutaway', cap: 'The ground floor cut open: the majlis at the front, the kitchen beside it, the family living room and the stair behind.' },
          { fig: 'v-render-night', cap: 'The same floor after dark, lit by the lamps you placed.' },
          'Check the daylight as you did for the apartment. The majlis has 4.3 m² of window for 25.7 m² of floor: 17%. The kitchen has 3.6 m² for 25.9 m²: 14%. The family living room has 6.5 m² for 29.4 m²: 22%.',
          { tip: 'Your turn alone: the first floor is empty. Furnish the three bedrooms and the lounge, fit out the two bathrooms, and light every room by the rule. Then add the low wall round the roof.' },
        ],
      },
      {
        kind: 'check',
        blocks: [{ check: ['The majlis seats its guests along the walls and its middle is clear.', 'The lamps of every room add up to what the rule asks.', 'The Levels panel shows Roof above First floor, and the 3D view shows a closed house.'] }],
      },
    ],
  },

  // ------------------------------------------------------------------ 21
  next: {
    title: 'Where to go from here',
    lead: 'You started with a single wall and finished with four apartments and a villa. Here is what you now know, what to try next, and a word about Otto.',
    card: 'What you learnt, ideas for your next design, and a note on Otto.',
    sections: [
      {
        kind: 'idea',
        title: 'What you can do now',
        blocks: [
          'You can read a plan, and you can make one. More than that, you know <b>why</b> a plan is good:',
          {
            check: [
              'Walls: a simple outline, thick outside, thin inside, round numbers.',
              'Doors by the corner, opening into the room; a window for every room.',
              'Rooms sized for their furniture, not too long for their width.',
              'Day, night and wet zones, and short paths between them.',
              'Floors that stack on columns set out on a grid, and a stair sized for a human stride, with its landings, handrail and guard.',
              'Furniture with room to move around it.',
              'Few materials, pale colours, three kinds of light.',
              'One good plan, mirrored and repeated.',
              'A guest zone and a family zone, each with its own door.',
              'A review before anyone sees it, and dimensions before anyone builds it.',
            ],
          },
        ],
      },
      {
        kind: 'more',
        title: 'Things to try',
        blocks: [
          {
            ul: [
              '<b>Draw your own home.</b> Take a tape measure, start with one room, and grow from there. Nothing teaches proportions faster than a place you know.',
              '<b>Improve the apartment.</b> Give the kitchen a second door to the hall. Try three bedrooms. Swap the kitchen and a bedroom and see what happens to the paths.',
              '<b>Give the apartments a roof</b>, the way you gave the villa one, and a low wall round its edge.',
              '<b>Add a third floor.</b> Duplicate the first floor, then draw a second stair from the first floor to the new one, right above the first.',
              `<b>Explore the other tools.</b> Ramps, elevators, curved walls (press ${k('A')} while drawing a wall), balconies drawn as slabs.`,
            ],
          },
          { h: 'The keys worth remembering' },
          {
            keys: [
              [k('V'), 'Pointer: select, move, edit'],
              [k('W'), 'Wall'],
              [`${k('D')} ${k('N')}`, 'Door, window'],
              [`${k('R')} ${k('S')}`, 'Room, room divider'],
              [`${k('Shift')}+${k('S')}`, 'Stair'],
              [k('C'), 'Column'],
              [`${k('K')} ${k('L')} ${k('T')}`, 'Rectangle (and slab), dimension, label'],
              [k('G'), 'Light'],
              [`${k('Shift')}+${k('M')}`, 'Mirror the selection (Ctrl keeps the original)'],
              [`${k('Ctrl')}+${k('D')}`, 'Duplicate the selection'],
              [`${k('Ctrl')}+${k('Z')}`, 'Undo'],
              [k('Home'), 'Show everything'],
              [`${k('Ctrl')}+${k('K')}`, 'Find any command'],
            ],
          },
        ],
      },
      {
        kind: 'more',
        title: 'A word about Otto',
        blocks: [
          { otto: 'Hollin has an assistant called <b>Otto</b>. You have seen its name in the corner of the window all along. Otto can draw beside you: describe a place in a sentence and it drafts the walls, the rooms and the doors, in the same millimetres you have been typing; it can furnish a room, and it asks before it deletes anything. It needs a little setting up first, in <b class="ui">Settings</b>, <b class="ui">Assistant</b>.' },
          'This course left Otto out on purpose. An assistant is most useful to someone who can check its work, and now you can: you know what a good plan looks like, where a door belongs and when a stair is too steep. Everything Otto draws is an ordinary wall or room, and you know how to move every one of them.',
          'Draw something of your own first. Then let Otto help.',
        ],
      },
    ],
  },
};

export default { parts, lessons };
