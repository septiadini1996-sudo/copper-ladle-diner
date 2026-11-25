// The screenshot scenes behind ?shot=service|assembly|shop|summary. Each scene drives the
// real game — the same state machine, kitchen and rules a player gets — into a composed
// moment, then freezes it. The seed is fixed and the render time is pinned, so the same
// query always produces the same frame.

import { SCREEN } from './config.js';
import { PROCESSES } from './data.js';
import { createPlate, nextStep, startCooking } from './kitchen.js';

/** Put the next step of a customer's dish on its station, aged into the wanted phase. */
function ageCooking(game, customer, wantPhase) {
  const step = nextStep(customer.plate);
  if (!step || step.process === 'none') return;
  const slot = startCooking(game.state.kitchen, game.state.owned, step.ingredient, step.process);
  if (slot === -1) return;
  const stationId = PROCESSES[step.process].station;
  const item = game.state.kitchen.stations[stationId][slot];
  if (wantPhase === 'perfect') item.elapsed = item.needed + item.window * 0.4;
  else if (wantPhase === 'done') item.elapsed = item.needed + item.window + 2;
  else item.elapsed = item.needed * 0.55;
}

/** Hand-place the first `count` steps of a plate (as if already cooked and plated). */
function prePlate(customer, count, perfectIdx = []) {
  const plate = createPlate(customer.recipeId);
  plate.added = count;
  plate.perfects = Array.from({ length: count }, (_, i) => perfectIdx.includes(i));
  customer.plate = plate;
}

/** Seat a chosen customer with a chosen order at a chosen seat, settled and mid-scene. */
function seatCustomer(game, seat, typeId, recipeId, bubble, patienceFrac = 0.8) {
  if (game.state.customers[seat]) return game.state.customers[seat];
  const customer = game.spawnCustomer(typeId, { id: recipeId });
  if (!customer) return null;
  if (customer.seat !== seat) {
    game.state.customers[customer.seat] = null;
    customer.seat = seat;
    game.state.customers[seat] = customer;
  }
  customer.phase = 'wait';
  customer.walk = 1;
  customer.patience = customer.patienceMax * patienceFrac;
  if (bubble) {
    customer.bubble = { text: bubble };
    customer.bubbleT = 999;
  }
  return customer;
}

/** Stage the named scene on a fresh game; the caller renders state afterwards. */
export function stageShot(game, name) {
  const state = game.state;
  if (name === 'shop') {
    game.startDay(3);
    state.bank = 145;
    state.owned = new Set(['sharp-knives']);
    state.shopMsg = 'Sharp Knives — yours. The purse is lighter, the board is faster.';
    state.screen = SCREEN.SHOP;
    state.t = 26.4;
    return;
  }
  if (name === 'summary') {
    game.startDay(4);
    state.summary = { earned: 212, goal: 175, served: 11, lost: 1, perfects: 9, metGoal: true };
    state.screen = SCREEN.SUMMARY;
    state.t = 41.2;
    return;
  }
  if (name === 'assembly') {
    // Day 7: the critic's Double Stack, half built, its second patty in the golden window.
    game.startDay(7);
    state.screen = SCREEN.SERVICE;
    state.bank = 356;
    state.dayEarned = 388;
    state.loanRepaid = 1904;
    state.timeLeft = 84;
    state.owned = new Set(['sharp-knives', 'comfy-stools']);
    const neighbour = seatCustomer(game, 0, 'neighbour', 'garden-salad', 'No rush, dear.', 0.9);
    const critic = seatCustomer(game, 1, 'critic', 'double-stack', 'Impress me, chef.', 0.74);
    if (neighbour) prePlate(neighbour, 2, []);
    if (critic) {
      prePlate(critic, 3, [1]);
      ageCooking(game, critic, 'perfect');
      game.selectSeat(1);
    }
    state.t = 13.7;
    return;
  }
  // service (the cover): day 5, mid-rush, three orders alive at once.
  game.startDay(5);
  state.screen = SCREEN.SERVICE;
  state.bank = 214;
  state.dayEarned = 187;
  state.loanRepaid = 1030;
  state.timeLeft = 66;
  state.owned = new Set(['sharp-knives', 'comfy-stools']);
  const tourist = seatCustomer(game, 0, 'tourist', 'copper-burger', 'The famous diner!', 0.86);
  const neighbour = seatCustomer(game, 1, 'neighbour', 'garden-salad', 'Something warm, please.', 0.92);
  const worker = seatCustomer(game, 2, 'worker', 'lantern-noodles', 'One of the usual!', 0.62);
  if (tourist) {
    prePlate(tourist, 3, [1]); // bun, patty (perfect), cheese already stacked
    ageCooking(game, tourist, 'done'); // the tomato waits, chopped, on the prep board
  }
  if (worker) ageCooking(game, worker, 'cooking'); // noodles mid-boil on the stove
  game.selectSeat(0);
  // A patty on the grill, inside its golden PERFECT ring; fries mid-cook beside it.
  const grillSlot = startCooking(state.kitchen, state.owned, 'patty', 'grill');
  if (grillSlot !== -1) {
    const item = state.kitchen.stations.grill[grillSlot];
    item.elapsed = item.needed + item.window * 0.45;
  }
  const frySlot = startCooking(state.kitchen, state.owned, 'potato', 'fry');
  if (frySlot !== -1) {
    const item = state.kitchen.stations.fryer[frySlot];
    item.elapsed = item.needed * 0.5;
  }
  state.t = 9.25;
}
