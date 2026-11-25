// All of the game's content, as plain data: the pantry, the recipes Rosa cooks, the six
// kinds of customer who visit, the eight upgrades in the night shop, and the twelve days
// of the campaign. Rendering reads colours and shapes from here; the kitchen logic reads
// processes, prices and patience. Nothing in this file touches the DOM or the clock.
//
// A recipe step is [ingredientId, process] where process is one of:
//   'none' — straight from the pantry to the plate
//   'chop' — the prep board, 'grill' — the grill, 'fry' — the fryer,
//   'boil' — the stove pot,  'bake' — the brick oven
// A dish's `kind` decides how its layers are drawn: 'stack' piles layers on a plate,
// 'bowl' fills a bowl, 'plate' arranges items on a dinner plate, 'flat' spreads them
// over a flatbread or pancake stack, 'taco' folds them into two shells.

export const PROCESSES = {
  none: { label: 'Pantry', station: null, seconds: 0 },
  chop: { label: 'Chop', station: 'prep', seconds: 3.2 },
  grill: { label: 'Grill', station: 'grill', seconds: 5.2 },
  fry: { label: 'Fry', station: 'fryer', seconds: 4.6 },
  boil: { label: 'Boil', station: 'stove', seconds: 5.8 },
  bake: { label: 'Bake', station: 'oven', seconds: 6.4 },
};

export const STATIONS = {
  prep: { name: 'Prep Board', slots: 2 },
  grill: { name: 'Grill', slots: 2 },
  fryer: { name: 'Fryer', slots: 2 },
  stove: { name: 'Stove Pot', slots: 2 },
  oven: { name: 'Brick Oven', slots: 2 },
};

/** Pantry ingredients: drawing colours (base / light / dark) live beside the name. */
export const INGREDIENTS = {
  bun: { name: 'Bun', base: '#e0a558', light: '#f4c87e', dark: '#b57e35' },
  bread: { name: 'Bread', base: '#dcb06a', light: '#f0cd8d', dark: '#b8894a' },
  dough: { name: 'Dough', base: '#ecd9ae', light: '#f8ecc9', dark: '#cbb27f' },
  tortilla: { name: 'Tortilla', base: '#e8cf96', light: '#f6e3b3', dark: '#c4a566' },
  patty: { name: 'Patty', base: '#7c4a2d', light: '#9c6540', dark: '#54301b' },
  steak: { name: 'Steak', base: '#8e3b2f', light: '#b5573f', dark: '#5f271e' },
  chicken: { name: 'Chicken', base: '#e8b06a', light: '#f7cd8f', dark: '#c08340' },
  salmon: { name: 'Salmon', base: '#ef8f6b', light: '#ffb494', dark: '#c96a45' },
  bacon: { name: 'Bacon', base: '#b5503c', light: '#d97a5f', dark: '#83382a' },
  egg: { name: 'Egg', base: '#f6e8c8', light: '#fff6dd', dark: '#f2b63c' },
  potato: { name: 'Potato', base: '#d9b878', light: '#eed49c', dark: '#b08d4e' },
  noodles: { name: 'Noodles', base: '#f0d488', light: '#faE7a8', dark: '#c9a854' },
  rice: { name: 'Rice', base: '#f4eedd', light: '#fffdf2', dark: '#d8cdb2' },
  corn: { name: 'Corn', base: '#f4c33c', light: '#ffda66', dark: '#cf9a24' },
  cheese: { name: 'Cheese', base: '#f6b73c', light: '#ffd166', dark: '#d1922a' },
  lettuce: { name: 'Lettuce', base: '#7fb069', light: '#a5cc8a', dark: '#588a44' },
  tomato: { name: 'Tomato', base: '#d94f3d', light: '#f2765f', dark: '#a83626' },
  onion: { name: 'Onion', base: '#e8d8ee', light: '#f8f0fb', dark: '#bfa8cc' },
  mushroom: { name: 'Mushroom', base: '#c9a37e', light: '#e3c39c', dark: '#9c7852' },
  carrot: { name: 'Carrot', base: '#ef8f3c', light: '#ffae5e', dark: '#c96d24' },
  pepper: { name: 'Pepper', base: '#4f9e4d', light: '#74bc6e', dark: '#35702f' },
  cucumber: { name: 'Cucumber', base: '#5da75d', light: '#86c482', dark: '#3d7a3c' },
  garlic: { name: 'Garlic', base: '#f2ead8', light: '#fffaf0', dark: '#cfc2a4' },
  basil: { name: 'Basil', base: '#3f8f4f', light: '#63b374', dark: '#2a6836' },
  apple: { name: 'Apple', base: '#c93b31', light: '#e85f52', dark: '#96281f' },
  berries: { name: 'Berries', base: '#5d4a9e', light: '#8374bd', dark: '#40316e' },
  cream: { name: 'Cream', base: '#fbf4e2', light: '#ffffff', dark: '#e0d2ae' },
  honey: { name: 'Honey', base: '#eda52c', light: '#ffc94f', dark: '#bd7f16' },
  sauce: { name: 'Sauce', base: '#a83c2a', light: '#c9553c', dark: '#7c2a1c' },
};

export const RECIPES = [
  { id: 'copper-burger', name: 'Copper Burger', price: 13, kind: 'stack', unlock: 1,
    steps: [['bun', 'none'], ['patty', 'grill'], ['cheese', 'none'], ['tomato', 'chop'], ['bun', 'none']] },
  { id: 'garden-salad', name: "Rosa's Garden Salad", price: 10, kind: 'bowl', unlock: 1,
    steps: [['lettuce', 'chop'], ['tomato', 'chop'], ['cucumber', 'chop'], ['carrot', 'chop'], ['sauce', 'none']] },
  { id: 'sunrise', name: 'Sunrise Breakfast', price: 14, kind: 'plate', unlock: 1,
    steps: [['egg', 'fry'], ['bacon', 'fry'], ['bread', 'bake'], ['tomato', 'chop']] },
  { id: 'berry-pancakes', name: 'Berry Pancakes', price: 12, kind: 'flat', unlock: 1,
    steps: [['dough', 'bake'], ['berries', 'none'], ['cream', 'none'], ['honey', 'none']] },
  { id: 'potato-soup', name: 'Copper Potato Soup', price: 11, kind: 'bowl', unlock: 1,
    steps: [['potato', 'boil'], ['onion', 'chop'], ['cream', 'none'], ['bacon', 'fry']] },
  { id: 'mushroom-melt', name: 'Mushroom Melt', price: 13, kind: 'stack', unlock: 2,
    steps: [['bread', 'none'], ['mushroom', 'grill'], ['cheese', 'none'], ['garlic', 'chop'], ['bread', 'none']] },
  { id: 'chicken-basket', name: 'Chicken Basket', price: 15, kind: 'plate', unlock: 2,
    steps: [['chicken', 'fry'], ['potato', 'fry'], ['corn', 'boil']] },
  { id: 'garden-flatbread', name: 'Garden Flatbread', price: 13, kind: 'flat', unlock: 2,
    steps: [['dough', 'bake'], ['tomato', 'chop'], ['cheese', 'none'], ['basil', 'none']] },
  { id: 'corn-chowder', name: 'Corn Chowder', price: 12, kind: 'bowl', unlock: 3,
    steps: [['corn', 'boil'], ['potato', 'boil'], ['cream', 'none'], ['carrot', 'chop']] },
  { id: 'veggie-tacos', name: 'Veggie Tacos', price: 12, kind: 'taco', unlock: 3,
    steps: [['tortilla', 'none'], ['pepper', 'chop'], ['onion', 'chop'], ['corn', 'boil'], ['cheese', 'none']] },
  { id: 'lantern-noodles', name: 'Lantern Noodles', price: 14, kind: 'bowl', unlock: 3,
    steps: [['noodles', 'boil'], ['egg', 'boil'], ['carrot', 'chop'], ['basil', 'none']] },
  { id: 'cheese-flatbread', name: 'Golden Cheese Flatbread', price: 12, kind: 'flat', unlock: 4,
    steps: [['dough', 'bake'], ['cheese', 'none'], ['garlic', 'chop'], ['honey', 'none']] },
  { id: 'beef-tacos', name: 'Ember Beef Tacos', price: 14, kind: 'taco', unlock: 4,
    steps: [['tortilla', 'none'], ['steak', 'grill'], ['onion', 'chop'], ['lettuce', 'chop'], ['sauce', 'none']] },
  { id: 'salmon-supper', name: 'Salmon Supper', price: 19, kind: 'plate', unlock: 4,
    steps: [['salmon', 'grill'], ['rice', 'boil'], ['carrot', 'chop'], ['basil', 'none']] },
  { id: 'pepper-noodles', name: 'Pepper Noodles', price: 15, kind: 'bowl', unlock: 5,
    steps: [['noodles', 'boil'], ['pepper', 'chop'], ['chicken', 'grill'], ['garlic', 'chop']] },
  { id: 'double-stack', name: 'Double Stack', price: 18, kind: 'stack', unlock: 5,
    steps: [['bun', 'none'], ['patty', 'grill'], ['cheese', 'none'], ['patty', 'grill'], ['bacon', 'fry'], ['bun', 'none']] },
  { id: 'apple-crumble', name: 'Apple Crumble', price: 11, kind: 'bowl', unlock: 5,
    steps: [['apple', 'chop'], ['dough', 'bake'], ['cream', 'none']] },
  { id: 'ember-steak', name: 'Ember Steak Plate', price: 21, kind: 'plate', unlock: 6,
    steps: [['steak', 'grill'], ['potato', 'fry'], ['mushroom', 'grill'], ['sauce', 'none']] },
  { id: 'honey-chicken', name: 'Honey-Glazed Chicken', price: 17, kind: 'plate', unlock: 6,
    steps: [['chicken', 'grill'], ['honey', 'none'], ['rice', 'boil'], ['pepper', 'chop']] },
  { id: 'club-sandwich', name: 'Ladle Club Sandwich', price: 15, kind: 'stack', unlock: 7,
    steps: [['bread', 'none'], ['chicken', 'grill'], ['bacon', 'fry'], ['lettuce', 'none'], ['tomato', 'chop'], ['bread', 'none']] },
  { id: 'garden-wrap', name: 'Garden Wrap', price: 12, kind: 'taco', unlock: 7,
    steps: [['tortilla', 'none'], ['lettuce', 'none'], ['chicken', 'grill'], ['cucumber', 'chop'], ['sauce', 'none']] },
  { id: 'loaded-fries', name: 'Loaded Copper Fries', price: 11, kind: 'bowl', unlock: 8,
    steps: [['potato', 'fry'], ['cheese', 'none'], ['bacon', 'fry'], ['sauce', 'none']] },
  { id: 'mushroom-rice', name: 'Mushroom Rice Bowl', price: 13, kind: 'bowl', unlock: 8,
    steps: [['rice', 'boil'], ['mushroom', 'grill'], ['onion', 'chop'], ['egg', 'fry']] },
  { id: 'garlic-salmon', name: 'Garlic Butter Salmon', price: 20, kind: 'plate', unlock: 9,
    steps: [['salmon', 'bake'], ['garlic', 'chop'], ['cream', 'none'], ['basil', 'none']] },
  { id: 'steak-eggs', name: 'Steak & Eggs', price: 20, kind: 'plate', unlock: 10,
    steps: [['steak', 'grill'], ['egg', 'fry'], ['potato', 'fry']] },
  { id: 'ladle-feast', name: 'The Ladle Feast', price: 24, kind: 'plate', unlock: 11,
    steps: [['steak', 'grill'], ['salmon', 'grill'], ['potato', 'fry'], ['mushroom', 'grill'], ['sauce', 'none']] },
];

/** The six customer kinds. `look` steers the figure painter; lines are short and in character. */
export const CUSTOMERS = {
  student: {
    name: 'Student', patience: 52, tipRate: 0.08, perfectTip: 2,
    look: { skin: '#e8b58c', hair: 'cap', hairColor: '#3a5a8c', cloth: '#4a7a5c', clothDark: '#38604a', extra: 'backpack' },
    lines: {
      arrive: ['Two lectures, zero lunch.', 'Please be quick-ish!'],
      waiting: ['My notes are getting cold…'],
      happy: ['Worth every coin!', 'Five stars, seriously.'],
      angry: ['I have a class!!'],
    },
  },
  worker: {
    name: 'Office Worker', patience: 62, tipRate: 0.14, perfectTip: 3,
    look: { skin: '#c98d64', hair: 'neat', hairColor: '#2e2119', cloth: '#5c6b7d', clothDark: '#46525f', extra: 'tie' },
    lines: {
      arrive: ['One hour. That is all I have.', 'The usual rush, sorry.'],
      waiting: ['My meeting moved up…'],
      happy: ['Efficient. I like it.', 'Back to work, fed.'],
      angry: ['I will expense nothing.'],
    },
  },
  neighbour: {
    name: 'Neighbour Rosa', patience: 95, tipRate: 0.12, perfectTip: 3,
    look: { skin: '#eec39e', hair: 'bun', hairColor: '#cfd2d6', cloth: '#8c4a6e', clothDark: '#6e3a56', extra: 'shawl' },
    lines: {
      arrive: ['No rush, dear.', 'Your mother would be proud.'],
      waiting: ['I brought my knitting.'],
      happy: ['Just like old times.', 'Bless this kitchen.'],
      angry: ['Oh… another day, then.'],
    },
  },
  tourist: {
    name: 'Tourist', patience: 70, tipRate: 0.22, perfectTip: 4,
    look: { skin: '#a86a42', hair: 'curls', hairColor: '#191410', cloth: '#c96a3c', clothDark: '#a04f2a', extra: 'camera' },
    lines: {
      arrive: ['The famous diner!', 'Guidebook says: eat here.'],
      waiting: ['Still sightseeing… inside.'],
      happy: ['Highlight of the trip!', 'Photographed AND eaten.'],
      angry: ['One star for the wait.'],
    },
  },
  foodie: {
    name: 'Foodie', patience: 85, tipRate: 0.18, perfectTip: 6,
    look: { skin: '#f0c8a2', hair: 'pompadour', hairColor: '#54341c', cloth: '#3f6b6e', clothDark: '#2f5154', extra: 'glasses' },
    lines: {
      arrive: ['Impress me, chef.', 'I review everything.'],
      waiting: ['Anticipation is a spice…'],
      happy: ['Superb. Every layer.', 'A quiet masterpiece.'],
      angry: ['Mediocrity, served slowly.'],
    },
  },
  critic: {
    name: 'Critic', patience: 58, tipRate: 0.0, perfectTip: 12,
    look: { skin: '#dcab84', hair: 'slick', hairColor: '#585048', cloth: '#33302e', clothDark: '#232120', extra: 'bowtie' },
    lines: {
      arrive: ['One dish. Do not waste it.', 'I have ended diners.'],
      waiting: ['My pen is getting heavy.'],
      happy: ['…Exceptional. Do not quote me.', 'Perfection, plated.'],
      angry: ['As expected. Pity.'],
    },
  },
};

export const CUSTOMER_IDS = Object.keys(CUSTOMERS);

/** The night shop: eight upgrades, every one changes the rules, none is decorative. */
export const UPGRADES = [
  { id: 'grill-slot', name: 'Second Grill Rack', cost: 60, desc: 'The grill holds 3 items at once instead of 2.' },
  { id: 'sharp-knives', name: 'Sharp Knives', cost: 45, desc: 'Chopping takes 30% less time.' },
  { id: 'fryer-slot', name: 'Deep Fryer XL', cost: 60, desc: 'The fryer holds 3 items at once instead of 2.' },
  { id: 'comfy-stools', name: 'Comfy Stools', cost: 55, desc: 'Customers wait 25% longer before giving up.' },
  { id: 'golden-ladle', name: 'The Golden Ladle', cost: 80, desc: 'The golden PERFECT window lasts 60% longer.' },
  { id: 'swift-stove', name: 'Swift Stove & Oven', cost: 65, desc: 'Boiling and baking take 25% less time.' },
  { id: 'tip-jar', name: 'Brass Tip Jar', cost: 50, desc: 'Every tip grows by half again.' },
  { id: 'long-day', name: 'Early Prep', cost: 40, desc: 'Each day of service runs 15 seconds longer.' },
];

/** The twelve days: goal, service length, arrival pace, patience and the price of the menu
 *  (word spreads; by the last day Rosa's cooking commands half again the early prices). */
export const DAYS = [
  { goal: 70, seconds: 95, spawn: 13.5, patienceScale: 1.0, priceScale: 1.0 },
  { goal: 100, seconds: 100, spawn: 12.0, patienceScale: 0.98, priceScale: 1.02 },
  { goal: 135, seconds: 105, spawn: 11.0, patienceScale: 0.96, priceScale: 1.05 },
  { goal: 175, seconds: 110, spawn: 10.5, patienceScale: 0.94, priceScale: 1.08 },
  { goal: 220, seconds: 120, spawn: 10.0, patienceScale: 0.92, priceScale: 1.12 },
  { goal: 270, seconds: 135, spawn: 9.2, patienceScale: 0.9, priceScale: 1.16 },
  { goal: 330, seconds: 140, spawn: 9.0, patienceScale: 0.88, priceScale: 1.2 },
  { goal: 400, seconds: 155, spawn: 8.5, patienceScale: 0.86, priceScale: 1.25 },
  { goal: 480, seconds: 170, spawn: 8.0, patienceScale: 0.84, priceScale: 1.3 },
  { goal: 570, seconds: 185, spawn: 7.5, patienceScale: 0.82, priceScale: 1.36 },
  { goal: 680, seconds: 205, spawn: 7.0, patienceScale: 0.8, priceScale: 1.43 },
  { goal: 960, seconds: 240, spawn: 6.5, patienceScale: 0.78, priceScale: 1.52 },
];

export function recipeById(id) {
  return RECIPES.find((r) => r.id === id);
}

/** Recipes available on a given day (1-based). */
export function menuForDay(day) {
  return RECIPES.filter((r) => r.unlock <= day);
}
