/**
 * The rules engine: the Warnings panel and the warnings themselves. A warning (core's `rules/check.ts`)
 * and a connector's broken limit (`geometry/connectors.ts`) keep their key and parameters as a `Phrase`;
 * their English `message`, which agents read, is made from these texts, so they stay exactly as written.
 */
export const rules = {
  'rules.title': 'Warnings',
  'rules.panel.warnings': 'Warnings',
  'rules.none': 'No warnings',
  'rules.noneHint': 'Stairs, ramps, elevators, openings and rooms are within the rules in Settings.',
  'rules.count': { one: '{count} warning', other: '{count} warnings' },
  /** The group of warnings about the whole building, and a level that has no name. */
  'rules.group.building': 'Building',
  'rules.group.level': 'Level',

  // ---------- a connector's warning: its name, then what it breaks ----------
  'rules.connector': '{name}: {detail}',
  /** A connector without a name of its own, as a warning names it. */
  'rules.kind.stair': 'Stair',
  'rules.kind.ladder': 'Ladder',
  'rules.kind.ramp': 'Ramp',
  'rules.kind.elevator': 'Elevator',
  'rules.kind.escalator': 'Escalator',
  'rules.break.inverted': 'Its top is not above its bottom (it rises {rise}).',
  'rules.break.tooFewRisers': '{risers} risers are too few for {flights} flights.',
  'rules.break.riserHigh': 'Risers of {height} are higher than {limit}.',
  'rules.break.riserLow': 'Risers of {height} are lower than {limit}.',
  'rules.break.treadShort': 'Treads of {depth} are shallower than {limit}.',
  'rules.break.comfort': '2 × riser + tread is {step}, outside {range}.',
  'rules.break.tooNarrow': 'It is {width} wide, narrower than {limit}.',
  'rules.break.straightTurns': 'A straight stair runs along one straight line, but its walk line turns.',
  'rules.break.lTurns': 'An L stair turns once, but its walk line turns {count} times.',
  'rules.break.uTurns': 'A U stair turns back on itself in two corners.',
  'rules.break.winderCorner': 'A winder stair needs a corner to wind around.',
  'rules.break.curvedStraight': 'A curved stair follows an arc, but its walk line is straight.',
  'rules.break.spiralStraight': 'A spiral stair follows an arc, but its walk line is straight.',
  'rules.break.walkCrosses': 'Its walk line crosses itself.',
  'rules.break.tooSteep': 'Its slope of {slope} % is steeper than {limit} %.',
  'rules.break.axisCrosses': 'Its axis crosses itself.',
  'rules.break.stopOffStack': 'It stops at "{level}", a mezzanine that is not on the level stack.',
  'rules.break.stopsSameElevation': 'Two of its stops are at the same elevation ({elevation}).',
  'rules.break.carTooBig': 'Its car ({carW} × {carD}) does not fit its shaft ({shaftW} × {shaftD}).',

  // ---------- a level's warnings ----------
  'rules.misfit.door': 'Door does not fit its wall on {level}',
  'rules.misfit.window': 'Window does not fit its wall on {level}',
  'rules.misfit.opening': 'Opening does not fit its wall on {level}',
  'rules.crosses': '{type} crosses itself on {level}',
  'rules.crossesNamed': '{type} "{name}" crosses itself on {level}',
  /** What crosses itself, as "{type} crosses itself" names it. */
  'rules.type.wall': 'Wall',
  'rules.type.shape': 'Shape',
  'rules.type.separator': 'Room divider',
  'rules.type.slab': 'Slab',
  'rules.type.room': 'Room',
  'rules.type.void': 'Void',
  'rules.type.shaft': 'Shaft',
  'rules.type.outline': 'Outline',
  'rules.roomOpen': 'Room "{name}" on {level} is not enclosed',
  'rules.uncovered': '{name} passes through {level} outside its slab',
  'rules.noSlab': '{name} passes through {level}, which has no slab',
} as const;
