/** The course's shape, the same in every language: three parts, their lessons in order, and how long each takes. */
export const PARTS = [
  { id: 'basics', lessons: ['plan', 'walls', 'openings', 'rooms', 'zones', 'floors', 'furniture', 'finishes'] },
  { id: 'project', lessons: ['brief', 'partitions', 'apartment-openings', 'apartment-rooms', 'interior', 'mirror', 'upstairs', 'review', 'share'] },
  { id: 'after', lessons: ['next'] },
];

/** Minutes a lesson takes, reading and doing. */
export const MINUTES = {
  plan: 15,
  walls: 25,
  openings: 20,
  rooms: 15,
  zones: 15,
  floors: 30,
  furniture: 20,
  finishes: 20,
  brief: 25,
  partitions: 25,
  'apartment-openings': 25,
  'apartment-rooms': 10,
  interior: 35,
  mirror: 20,
  upstairs: 25,
  review: 20,
  share: 15,
  next: 5,
};

export const ORDER = PARTS.flatMap((p) => p.lessons);
export const TOTAL_MINUTES = ORDER.reduce((sum, id) => sum + MINUTES[id], 0);
export const RELEASES = 'https://github.com/be5her/hollin/releases';
export const SOURCE = 'https://github.com/be5her/hollin';
