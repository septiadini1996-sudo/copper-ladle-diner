// The kitchen's rules, kept pure: no DOM, no canvas, no wall clock. The game state machine
// advances everything through update(dt) in game seconds, so the same code can be exercised
// by the node test suite and driven deterministically for screenshots.
//
// A cooking item lives in a station slot and moves through phases:
//   cooking  — its timer runs toward `cookSeconds`
//   perfect  — the golden window: plating it now marks the component PERFECT
//   done     — still good, no longer golden
//   burnt    — left too long; it can only be thrown away
// A plate takes a recipe's steps strictly in order. A 'none' step comes straight from the
// pantry; any other step must first be cooked and then plated from its station.

import { INGREDIENTS, PROCESSES, STATIONS, recipeById } from './data.js';

/** How long after the perfect window closes before an item burns, in seconds. */
export const BURN_GRACE = 7;

/** The golden window's base length, in seconds. */
export const PERFECT_BASE = 2.6;

/** Station slot counts with upgrades applied. */
export function stationSlots(owned) {
  const slots = {};
  for (const id of Object.keys(STATIONS)) slots[id] = STATIONS[id].slots;
  if (owned.has('grill-slot')) slots.grill += 1;
  if (owned.has('fryer-slot')) slots.fryer += 1;
  return slots;
}

/** Cook seconds for a process with upgrades applied. */
export function cookSeconds(process, owned) {
  let seconds = PROCESSES[process].seconds;
  if (process === 'chop' && owned.has('sharp-knives')) seconds *= 0.7;
  if ((process === 'boil' || process === 'bake') && owned.has('swift-stove')) seconds *= 0.75;
  return seconds;
}

/** The golden window's length with upgrades applied. */
export function perfectWindow(owned) {
  return PERFECT_BASE * (owned.has('golden-ladle') ? 1.6 : 1);
}

/** A fresh kitchen: every station empty. `owned` is a Set of upgrade ids. */
export function createKitchen(owned) {
  const counts = stationSlots(owned);
  const stations = {};
  for (const id of Object.keys(STATIONS)) {
    stations[id] = Array.from({ length: counts[id] }, () => null);
  }
  return { stations };
}

/**
 * Put an ingredient on its station to cook. Returns the slot index, or -1 when the process
 * needs no cooking or the station is full.
 */
export function startCooking(kitchen, owned, ingredient, process) {
  const stationId = PROCESSES[process].station;
  if (!stationId) return -1;
  const slots = kitchen.stations[stationId];
  const at = slots.indexOf(null);
  if (at === -1) return -1;
  slots[at] = {
    ingredient,
    process,
    elapsed: 0,
    needed: cookSeconds(process, owned),
    window: perfectWindow(owned),
  };
  return at;
}

/** The phase of a cooking item: 'cooking' | 'perfect' | 'done' | 'burnt'. */
export function phaseOf(item) {
  if (item.elapsed < item.needed) return 'cooking';
  if (item.elapsed < item.needed + item.window) return 'perfect';
  if (item.elapsed < item.needed + item.window + BURN_GRACE) return 'done';
  return 'burnt';
}

/** Advance every cooking item by dt seconds. Returns events: [{type:'perfect'|'burnt', ...}]. */
export function updateKitchen(kitchen, dt) {
  const events = [];
  for (const [stationId, slots] of Object.entries(kitchen.stations)) {
    slots.forEach((item, slot) => {
      if (!item) return;
      const before = phaseOf(item);
      item.elapsed += dt;
      const after = phaseOf(item);
      if (before !== 'perfect' && after === 'perfect') events.push({ type: 'perfect', stationId, slot, item });
      if (after === 'burnt' && before !== 'burnt') events.push({ type: 'burnt', stationId, slot, item });
    });
  }
  return events;
}

/** Take an item out of a station slot (plated or trashed). Returns it, or null. */
export function takeFromStation(kitchen, stationId, slot) {
  const item = kitchen.stations[stationId][slot];
  kitchen.stations[stationId][slot] = null;
  return item;
}

/** Find a finished (not cooking, not burnt) station item for an ingredient+process, if any. */
export function findCooked(kitchen, ingredient, process) {
  const stationId = PROCESSES[process].station;
  if (!stationId) return null;
  const slots = kitchen.stations[stationId];
  for (let slot = 0; slot < slots.length; slot += 1) {
    const item = slots[slot];
    if (item && item.ingredient === ingredient && phaseOf(item) !== 'cooking' && phaseOf(item) !== 'burnt') {
      return { stationId, slot, item, perfect: phaseOf(item) === 'perfect' };
    }
  }
  return null;
}

/** A plate being built for one order: which steps are on it, and which were perfect. */
export function createPlate(recipeId) {
  return { recipeId, added: 0, perfects: [] };
}

/** The next step a plate needs: {ingredient, process, index} or null when complete. */
export function nextStep(plate) {
  const recipe = recipeById(plate.recipeId);
  if (plate.added >= recipe.steps.length) return null;
  const [ingredient, process] = recipe.steps[plate.added];
  return { ingredient, process, index: plate.added };
}

/**
 * Try to add the plate's next step. For a 'none' step it always succeeds. For a cooked step
 * a finished item must be waiting in its station; it is consumed. Returns 'added', 'perfect'
 * (added from the golden window), 'needs-cooking' or 'complete'.
 */
export function addNextStep(kitchen, plate) {
  const step = nextStep(plate);
  if (!step) return 'complete';
  if (step.process === 'none') {
    plate.added += 1;
    plate.perfects.push(false);
    return 'added';
  }
  const found = findCooked(kitchen, step.ingredient, step.process);
  if (!found) return 'needs-cooking';
  takeFromStation(kitchen, found.stationId, found.slot);
  plate.added += 1;
  plate.perfects.push(found.perfect);
  return found.perfect ? 'perfect' : 'added';
}

/** Send the plate's next raw ingredient to its station. Returns the slot, or -1. */
export function sendNextStepToCook(kitchen, owned, plate) {
  const step = nextStep(plate);
  if (!step || step.process === 'none') return -1;
  return startCooking(kitchen, owned, step.ingredient, step.process);
}

export function plateComplete(plate) {
  return nextStep(plate) === null;
}

/** True when every cooked component of the plate was plated inside its golden window. */
export function plateAllPerfect(plate) {
  const recipe = recipeById(plate.recipeId);
  return recipe.steps.every(([, process], i) => process === 'none' || plate.perfects[i]);
}

/**
 * What a served order pays: price + tip. The tip scales with the customer's remaining
 * patience fraction; a flawless plate earns the type's perfect bonus instead of the plain
 * tip for the critic (whose tipRate is 0 — perfection or nothing). The brass tip jar
 * multiplies every tip by 1.5. All figures are whole dollars.
 */
export function payout(recipe, customer, patienceFrac, allPerfect, owned) {
  let tip = Math.round(recipe.price * customer.tipRate * Math.max(0, patienceFrac));
  if (allPerfect) tip = Math.max(tip, customer.perfectTip);
  if (owned.has('tip-jar')) tip = Math.round(tip * 1.5);
  return { price: recipe.price, tip, total: recipe.price + tip };
}

/** Patience in seconds for a customer type on a day, with upgrades applied. */
export function patienceSeconds(customer, dayScale, owned) {
  const stools = owned.has('comfy-stools') ? 1.25 : 1;
  return customer.patience * dayScale * stools;
}

/** Seconds of service in a day, with the Early Prep upgrade applied. */
export function dayLength(baseSeconds, owned) {
  return baseSeconds + (owned.has('long-day') ? 15 : 0);
}

/** Every ingredient id a recipe uses, for pantry highlighting and tests. */
export function recipeIngredients(recipe) {
  return [...new Set(recipe.steps.map(([ingredient]) => ingredient))];
}

export function ingredientKnown(id) {
  return Object.prototype.hasOwnProperty.call(INGREDIENTS, id);
}
