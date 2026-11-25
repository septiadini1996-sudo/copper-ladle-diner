// Shared constants for The Copper Ladle: the logical stage every screen is drawn on, the
// campaign shape, and the warm lamp-lit palette the whole scene is shaded from. One light
// logic governs the art: everything is lit from above by the hanging lamps and from the
// right by the brick oven, so highlights lean warm and shadows fall low and to the left.

export const STAGE = { width: 1280, height: 800 };

/** The loan Rosa must clear, in dollars: the twelve day goals sum to exactly this. */
export const LOAN_TOTAL = 4390;

/** Seconds of service in a day, before upgrades. */
export const DAY_SECONDS = 95;

/** Seats at the counter: at most this many customers wait at once. */
export const SEATS = 3;

/** Screen identifiers the state machine and renderer share. */
export const SCREEN = {
  TITLE: 'title',
  INTRO: 'intro',
  SERVICE: 'service',
  PAUSE: 'pause',
  SUMMARY: 'summary',
  SHOP: 'shop',
  OVER: 'over',
  WIN: 'win',
};

/** The palette. Warm darks for the room, copper and cream for the light. */
export const INK = {
  wallTop: '#4a2c33',
  wallBottom: '#2e1a22',
  wainscot: '#5d3a26',
  wainscotDark: '#3c2417',
  woodLight: '#a06a3c',
  wood: '#7c4c26',
  woodDark: '#54331a',
  counterTop: '#c98d54',
  counterFace: '#6e4525',
  counterShadow: '#41260f',
  cream: '#f6e7c8',
  paper: '#efe0bd',
  ink: '#2b1a12',
  copper: '#c97b4a',
  copperLight: '#eda96e',
  copperDark: '#8a4f27',
  brass: '#d9a441',
  gold: '#f2b63c',
  good: '#7fb069',
  warn: '#e8a13a',
  bad: '#d95f4b',
  night: '#1d1420',
};
