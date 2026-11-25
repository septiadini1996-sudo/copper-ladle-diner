// The Copper Ladle's logic test suite. Run: node tests/logic.test.mjs
// Exercises the pure rules (data, kitchen) and the full state machine (game), including a
// bot that plays all twelve days to prove the campaign can be won end to end.

import { CUSTOMERS, CUSTOMER_IDS, DAYS, INGREDIENTS, PROCESSES, RECIPES, STATIONS, UPGRADES, menuForDay, recipeById } from '../game/src/data.js';
import {
  BURN_GRACE, addNextStep, cookSeconds, createKitchen, createPlate, dayLength,
  findCooked, nextStep, patienceSeconds, payout, perfectWindow, phaseOf, plateAllPerfect,
  plateComplete, recipeIngredients, sendNextStepToCook, startCooking, stationSlots,
  takeFromStation, updateKitchen,
} from '../game/src/kitchen.js';
import { LOAN_TOTAL, SCREEN } from '../game/src/config.js';
import { createGame, createSilentAudio } from '../game/src/game.js';
import { stageShot } from '../game/src/shots.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; }
  else { failed += 1; console.log(`FAIL: ${name}`); }
}
function eq(name, a, b) { check(`${name} (got ${a}, want ${b})`, a === b); }

// ---------- data integrity ----------
eq('ingredient count is 29', Object.keys(INGREDIENTS).length, 29);
eq('recipe count is 26', RECIPES.length, 26);
eq('customer type count is 6', CUSTOMER_IDS.length, 6);
eq('upgrade count is 8', UPGRADES.length, 8);
eq('day count is 12', DAYS.length, 12);
eq('station count is 5', Object.keys(STATIONS).length, 5);
eq('day goals sum to the loan', DAYS.reduce((s, d) => s + d.goal, 0), LOAN_TOTAL);
eq('first goal is 70', DAYS[0].goal, 70);
eq('last goal is 960', DAYS[11].goal, 960);
check('goals strictly rise', DAYS.every((d, i) => i === 0 || d.goal > DAYS[i - 1].goal));
for (const recipe of RECIPES) {
  check(`${recipe.id}: 3–6 steps`, recipe.steps.length >= 3 && recipe.steps.length <= 6);
  check(`${recipe.id}: price positive`, recipe.price > 0);
  for (const [ing, proc] of recipe.steps) {
    check(`${recipe.id}: known ingredient ${ing}`, ing in INGREDIENTS);
    check(`${recipe.id}: known process ${proc}`, proc in PROCESSES);
    if (proc !== 'none') check(`${recipe.id}: ${proc} has a station`, PROCESSES[proc].station in STATIONS);
  }
  void recipeIngredients(recipe);
}
for (const id of CUSTOMER_IDS) {
  const c = CUSTOMERS[id];
  check(`${id}: patience and lines`, c.patience > 0 && c.lines.arrive.length >= 2 && c.lines.happy.length >= 2 && c.lines.waiting.length >= 1 && c.lines.angry.length >= 1);
  check(`${id}: look complete`, Boolean(c.look.skin && c.look.hair && c.look.cloth && c.look.extra));
}
for (const up of UPGRADES) check(`${up.id}: costed and described`, up.cost > 0 && up.desc.length > 10);
check('menu grows by day 12 to all recipes', menuForDay(12).length === 26);
check('day 1 menu is the simple five', menuForDay(1).length === 5);

// ---------- cooking phases ----------
{
  const owned = new Set();
  const k = createKitchen(owned);
  const slot = startCooking(k, owned, 'patty', 'grill');
  eq('grill accepts a patty', slot, 0);
  const item = k.stations.grill[0];
  eq('phase cooking at 0', phaseOf(item), 'cooking');
  item.elapsed = item.needed - 0.01;
  eq('phase cooking just before done', phaseOf(item), 'cooking');
  item.elapsed = item.needed + 0.01;
  eq('phase perfect inside window', phaseOf(item), 'perfect');
  item.elapsed = item.needed + item.window + 0.01;
  eq('phase done after window', phaseOf(item), 'done');
  item.elapsed = item.needed + item.window + BURN_GRACE + 0.01;
  eq('phase burnt after grace', phaseOf(item), 'burnt');
}
// Capacity and fullness.
{
  const owned = new Set();
  const k = createKitchen(owned);
  startCooking(k, owned, 'patty', 'grill');
  startCooking(k, owned, 'steak', 'grill');
  eq('full grill refuses', startCooking(k, owned, 'salmon', 'grill'), -1);
  eq('none process never cooks', startCooking(k, owned, 'bun', 'none'), -1);
  takeFromStation(k, 'grill', 0);
  check('freed slot cooks again', startCooking(k, owned, 'salmon', 'grill') !== -1);
}
// Perfect/burnt events fire once each.
{
  const owned = new Set();
  const k = createKitchen(owned);
  startCooking(k, owned, 'egg', 'fry');
  let perfects = 0, burnts = 0;
  for (let i = 0; i < 400; i += 1) {
    for (const ev of updateKitchen(k, 0.1)) {
      if (ev.type === 'perfect') perfects += 1;
      if (ev.type === 'burnt') burnts += 1;
    }
  }
  eq('exactly one perfect event', perfects, 1);
  eq('exactly one burnt event', burnts, 1);
}

// ---------- upgrades change the rules ----------
{
  const none = new Set();
  eq('base grill slots', stationSlots(none).grill, 2);
  eq('grill-slot upgrade adds one', stationSlots(new Set(['grill-slot'])).grill, 3);
  eq('fryer-slot upgrade adds one', stationSlots(new Set(['fryer-slot'])).fryer, 3);
  check('sharp knives speed chopping 30%', Math.abs(cookSeconds('chop', new Set(['sharp-knives'])) - cookSeconds('chop', none) * 0.7) < 1e-9);
  check('swift stove speeds boiling 25%', Math.abs(cookSeconds('boil', new Set(['swift-stove'])) - cookSeconds('boil', none) * 0.75) < 1e-9);
  check('golden ladle widens window 60%', Math.abs(perfectWindow(new Set(['golden-ladle'])) - perfectWindow(none) * 1.6) < 1e-9);
  check('comfy stools extend patience 25%', Math.abs(patienceSeconds(CUSTOMERS.student, 1, new Set(['comfy-stools'])) - CUSTOMERS.student.patience * 1.25) < 1e-9);
  eq('early prep adds 15 seconds', dayLength(95, new Set(['long-day'])), 110);
}

// ---------- plate rules ----------
{
  const owned = new Set();
  const k = createKitchen(owned);
  const plate = createPlate('copper-burger');
  eq('first step is the bun', nextStep(plate).ingredient, 'bun');
  eq('pantry step adds at once', addNextStep(k, plate), 'added');
  eq('cooked step refuses without cooking', addNextStep(k, plate), 'needs-cooking');
  const slot = sendNextStepToCook(k, owned, plate);
  check('patty sent to the grill', slot !== -1);
  const item = k.stations.grill[slot];
  item.elapsed = item.needed + item.window * 0.5; // squarely in the golden window
  eq('golden plating reports perfect', addNextStep(k, plate), 'perfect');
  check('station slot freed after plating', k.stations.grill[slot] === null);
  eq('cheese adds from the pantry', addNextStep(k, plate), 'added');
  // Tomato must be chopped: cook it and let the window pass — still plateable, not perfect.
  const chopSlot = sendNextStepToCook(k, owned, plate);
  const chop = k.stations.prep[chopSlot];
  chop.elapsed = chop.needed + chop.window + 1;
  eq('late plating is plain added', addNextStep(k, plate), 'added');
  eq('top bun completes the plate', addNextStep(k, plate), 'added');
  check('plate complete', plateComplete(plate));
  eq('further adds report complete', addNextStep(k, plate), 'complete');
  check('not all perfect (tomato was late)', !plateAllPerfect(plate));
  check('findCooked ignores cooking items', findCooked(k, 'patty', 'grill') === null);
}

// ---------- payout rules ----------
{
  const burger = recipeById('copper-burger');
  const none = new Set();
  const full = payout(burger, CUSTOMERS.worker, 1, false, none);
  eq('full-patience worker tip', full.tip, Math.round(13 * 0.14));
  eq('total is price + tip', full.total, full.price + full.tip);
  const half = payout(burger, CUSTOMERS.worker, 0.5, false, none);
  check('tip shrinks with patience', half.tip < full.tip);
  const criticPlain = payout(burger, CUSTOMERS.critic, 1, false, none);
  eq('critic pays no tip for a plain dish', criticPlain.tip, 0);
  const criticPerfect = payout(burger, CUSTOMERS.critic, 0.2, true, none);
  eq('critic pays the perfect bonus', criticPerfect.tip, CUSTOMERS.critic.perfectTip);
  const jarred = payout(burger, CUSTOMERS.worker, 1, false, new Set(['tip-jar']));
  eq('tip jar multiplies the tip', jarred.tip, Math.round(full.tip * 1.5));
  const foodiePerfect = payout(recipeById('ladle-feast'), CUSTOMERS.foodie, 0.1, true, none);
  eq('foodie perfect bonus beats a thin patience tip', foodiePerfect.tip, CUSTOMERS.foodie.perfectTip);
}

// ---------- the state machine: one dish, end to end ----------
{
  const game = createGame(7, createSilentAudio());
  const { state } = game;
  game.click(640, 676); // START COOKING (title button)
  eq('title leads to intro', state.screen, SCREEN.INTRO);
  game.click(640, 647); // OPEN THE DINER
  eq('intro leads to service', state.screen, SCREEN.SERVICE);
  const customer = game.spawnCustomer('worker', recipeById('copper-burger'));
  check('customer spawned', Boolean(customer));
  customer.phase = 'wait';
  customer.walk = 1;
  game.selectSeat(customer.seat);
  // Build the burger through the real click path: pantry cells and station slots.
  const cellOf = (id) => {
    const order = ['bun', 'bread', 'dough', 'tortilla', 'patty', 'steak', 'chicken', 'salmon', 'bacon', 'egg', 'potato', 'noodles', 'rice', 'corn', 'cheese', 'lettuce', 'tomato', 'onion', 'mushroom', 'carrot', 'pepper', 'cucumber', 'garlic', 'basil', 'apple', 'berries', 'cream', 'honey', 'sauce'];
    const i = order.indexOf(id);
    return { x: 21 + (i % 5) * 77 + 37, y: 556 + Math.floor(i / 5) * 37 + 17 };
  };
  const clickIng = (id) => { const c = cellOf(id); game.click(c.x, c.y); };
  clickIng('bun');
  eq('bun on the plate', customer.plate.added, 1);
  clickIng('patty'); // sends it to the grill
  check('patty is grilling', state.kitchen.stations.grill.some(Boolean));
  const grillSlot = state.kitchen.stations.grill.findIndex(Boolean);
  const patty = state.kitchen.stations.grill[grillSlot];
  patty.elapsed = patty.needed + patty.window * 0.5;
  // Click the grill slot (row 1, this slot).
  game.click(548 + grillSlot * 98 + 46, 528 + 1 * 53 + 3 + 21);
  eq('patty plated from the golden window', customer.plate.added, 2);
  eq('patty marked perfect', customer.plate.perfects[1], true);
  clickIng('cheese');
  clickIng('tomato'); // to the prep board
  const prepSlot = state.kitchen.stations.prep.findIndex(Boolean);
  const tomato = state.kitchen.stations.prep[prepSlot];
  tomato.elapsed = tomato.needed + 0.2; // inside the window too
  game.click(548 + prepSlot * 98 + 46, 528 + 0 * 53 + 3 + 21);
  clickIng('bun');
  check('burger complete', plateComplete(customer.plate));
  check('burger flawless', plateAllPerfect(customer.plate));
  const bankBefore = state.bank;
  game.click(884 + 84, 738 + 20); // SERVE
  check('serving pays', state.bank > bankBefore);
  eq('served count one', state.dayStats.served, 1);
}

// ---------- a bot plays the whole campaign ----------
// The bot plays the way the game asks to be played: it pipelines. Every tick it works
// every seated customer's next step — cooking in parallel across the five stations,
// plating what is ready, serving what is complete — and at night it buys the upgrades a
// player would (throughput first). If a day still fails it retries, as a player may.
{
  const game = createGame(11, createSilentAudio());
  const { state } = game;
  game.click(640, 676);
  game.click(640, 647);
  let guard = 0;
  const buyOrder = ['grill-slot', 'fryer-slot', 'sharp-knives', 'swift-stove', 'golden-ladle', 'comfy-stools', 'long-day', 'tip-jar'];
  while (state.screen !== SCREEN.WIN && guard < 400000) {
    guard += 1;
    if (state.screen === SCREEN.INTRO) { game.click(640, 647); continue; }
    if (state.screen === SCREEN.SUMMARY) { game.click(640, 694); continue; }
    if (state.screen === SCREEN.SHOP) {
      const g = { x: 70, y: 150, cols: 4, cardW: 272, cardH: 240, gap: 18 };
      let bought = false;
      for (const id of buyOrder) {
        if (state.owned.has(id)) continue;
        const i = UPGRADES.findIndex((u) => u.id === id);
        const up = UPGRADES[i];
        if (state.bank < up.cost) continue;
        const col = i % g.cols, row = Math.floor(i / g.cols);
        game.click(g.x + col * (g.cardW + g.gap) + g.cardW / 2, g.y + row * (g.cardH + g.gap) + g.cardH / 2);
        bought = true;
        break;
      }
      if (!bought) game.click(1090, 742);
      continue;
    }
    if (state.screen === SCREEN.OVER) { game.click(640, 627); continue; }
    if (state.screen !== SCREEN.SERVICE) break;
    // Bin anything burnt, anywhere.
    for (const slots of Object.values(state.kitchen.stations)) {
      slots.forEach((it, i) => { if (it && phaseOf(it) === 'burnt') slots[i] = null; });
    }
    // Work every waiting customer, most impatient first.
    const waiting = state.customers.filter((c) => c && !c.leaving && c.phase === 'wait')
      .sort((a, b) => a.patience - b.patience);
    for (const customer of waiting) {
      const step = nextStep(customer.plate);
      if (!step) {
        game.selectSeat(customer.seat);
        game.serveSelected();
        continue;
      }
      if (step.process === 'none') { addNextStep(state.kitchen, customer.plate); continue; }
      if (findCooked(state.kitchen, step.ingredient, step.process)) { addNextStep(state.kitchen, customer.plate); continue; }
      const st = PROCESSES[step.process].station;
      const slots = state.kitchen.stations[st];
      const already = slots.some((it) => it && it.ingredient === step.ingredient);
      if (!already) {
        // Cook this step unless the same ingredient is already cooking for someone else
        // and that plate will need it too — duplicates are fine, stations permitting.
        const sent = startCooking(state.kitchen, state.owned, step.ingredient, step.process);
        if (sent === -1) {
          const idx = slots.findIndex((it) => it && phaseOf(it) !== 'cooking');
          if (idx !== -1) slots[idx] = null;
        }
      }
    }
    game.update(0.1);
  }
  check(`campaign reaches the win screen (screen=${state.screen}, day=${state.day}, guard=${guard})`, state.screen === SCREEN.WIN);
  check('loan fully repaid on the win path', state.loanRepaid === LOAN_TOTAL);
  check('the bot bought upgrades along the way', state.owned.size >= 3);
}

// ---------- screenshot scenes stage without errors ----------
for (const name of ['service', 'assembly', 'shop', 'summary']) {
  const game = createGame(7, createSilentAudio());
  stageShot(game, name);
  check(`shot ${name}: staged on the right screen`, game.state.screen === (name === 'shop' ? SCREEN.SHOP : name === 'summary' ? SCREEN.SUMMARY : SCREEN.SERVICE));
  if (name === 'service') {
    check('cover: three customers seated', game.state.customers.filter(Boolean).length === 3);
    check('cover: a dish is half built', game.state.customers.some((c) => c && c.plate.added >= 2 && !plateComplete(c.plate)));
    check('cover: something sits in the golden window', Object.values(game.state.kitchen.stations).flat().some((it) => it && phaseOf(it) === 'perfect'));
    check('cover: every seated customer has a bubble', game.state.customers.filter(Boolean).every((c) => c.bubble));
  }
  if (name === 'assembly') {
    const sel = game.state.customers[game.state.selectedSeat];
    check('assembly: the critic is selected', sel && sel.typeId === 'critic');
    check('assembly: the stack is half built', sel && sel.plate.added === 3);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
