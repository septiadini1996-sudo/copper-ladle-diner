// The state machine: screens, days, customers, cooking and coin flow. Everything the
// renderer draws lives in one plain state object; everything the player can do arrives as
// click(x, y) or key(name). Time advances only through update(dt), in game seconds, so a
// staged scene (shots.js) can run the real rules forward deterministically.

import { DAY_SECONDS, LOAN_TOTAL, SCREEN, SEATS } from './config.js';
import { CUSTOMERS, CUSTOMER_IDS, DAYS, INGREDIENTS, PROCESSES, RECIPES, UPGRADES, menuForDay, recipeById } from './data.js';
import {
  addNextStep, createKitchen, createPlate, dayLength, nextStep, patienceSeconds,
  payout, phaseOf, plateAllPerfect, plateComplete, sendNextStepToCook, takeFromStation,
  updateKitchen,
} from './kitchen.js';
import { LAYOUT, PANTRY_ORDER, STATION_ORDER, pantryCell, stationSlotRect } from './render.js';
import { createRandom, pick, range } from './random.js';

/** A silent stand-in for the audio engine, used by screenshots and tests. */
export function createSilentAudio() {
  const noop = () => {};
  return {
    unlock: noop, click: noop, chop: noop, sizzle: noop, plate: noop, ding: noop,
    coin: noop, serve: noop, angry: noop, trash: noop, pop: noop,
    toggleMute: () => false, isMuted: () => false,
  };
}

function inside(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function createGame(seed, audio) {
  const rng = createRandom(seed);
  const state = {
    screen: SCREEN.TITLE,
    t: 0,
    day: 1,
    bank: 0,
    loanRepaid: 0,
    totalEarned: 0,
    dayEarned: 0,
    goal: DAYS[0].goal,
    daySecs: DAY_SECONDS,
    priceScale: 1,
    timeLeft: DAY_SECONDS,
    customers: Array(SEATS).fill(null),
    selectedSeat: -1,
    kitchen: createKitchen(new Set()),
    owned: new Set(),
    specials: menuForDay(1).slice(0, 5),
    fx: [],
    toast: null,
    summary: null,
    newUnlock: null,
    shopMsg: '',
    muted: false,
    stats: { served: 0, lost: 0, perfects: 0 },
    dayStats: { served: 0, lost: 0, perfects: 0 },
  };
  let spawnTimer = 1;
  let snapshot = null; // bank/owned/loan at the start of the current day, for retries

  function toast(msg) {
    state.toast = { text: msg, until: state.t + 1.7 };
  }

  function say(customer, line, seconds = 2.6) {
    customer.bubble = { text: line };
    customer.bubbleT = seconds;
  }

  function selected() {
    return state.selectedSeat >= 0 ? state.customers[state.selectedSeat] : null;
  }

  function selectSeat(seat) {
    state.customers.forEach((c) => { if (c) c.selected = false; });
    state.selectedSeat = seat;
    const c = state.customers[seat];
    if (c) c.selected = true;
  }

  function spawnCustomer(forceType, forceRecipe) {
    const free = [];
    state.customers.forEach((c, i) => { if (!c) free.push(i); });
    if (!free.length) return null;
    const seat = free[Math.floor(rng() * free.length)];
    const typeId = forceType ?? pick(rng, CUSTOMER_IDS);
    const type = CUSTOMERS[typeId];
    const menu = menuForDay(state.day);
    const recipe = forceRecipe ?? pick(rng, menu);
    const patience = patienceSeconds(type, DAYS[state.day - 1].patienceScale, state.owned);
    const customer = {
      seat,
      typeId,
      recipeId: recipe.id,
      plate: createPlate(recipe.id),
      patience,
      patienceMax: patience,
      phase: 'enter',
      walk: 0,
      leaving: false,
      moodOverride: null,
      bubble: null,
      bubbleT: 0,
      bobSeed: rng() * 10,
      selected: false,
    };
    say(customer, pick(rng, type.lines.arrive), 3);
    state.customers[seat] = customer;
    if (state.selectedSeat === -1) selectSeat(seat);
    return customer;
  }

  function startDay(day, { keepSnapshot = false } = {}) {
    state.day = day;
    const cfg = DAYS[day - 1];
    state.goal = cfg.goal;
    state.daySecs = dayLength(cfg.seconds, state.owned);
    state.priceScale = cfg.priceScale;
    state.timeLeft = state.daySecs;
    state.dayEarned = 0;
    state.dayStats = { served: 0, lost: 0, perfects: 0 };
    state.kitchen = createKitchen(state.owned);
    state.customers = Array(SEATS).fill(null);
    state.selectedSeat = -1;
    state.fx = [];
    state.specials = menuForDay(day).slice(-5);
    const unlocked = RECIPES.filter((r) => r.unlock === day);
    state.newUnlock = unlocked.length ? unlocked.map((r) => r.name).join(' · ') : null;
    spawnTimer = 0.8;
    if (!keepSnapshot) {
      snapshot = { bank: state.bank, loan: state.loanRepaid, owned: new Set(state.owned), totalEarned: state.totalEarned, stats: { ...state.stats } };
    }
    state.screen = SCREEN.INTRO;
  }

  function endDay() {
    const met = state.dayEarned >= state.goal;
    if (!met) {
      state.screen = SCREEN.OVER;
      return;
    }
    state.summary = {
      earned: state.dayEarned,
      goal: state.goal,
      served: state.dayStats.served,
      lost: state.dayStats.lost,
      perfects: state.dayStats.perfects,
      metGoal: true,
    };
    state.screen = SCREEN.SUMMARY;
  }

  function customerLeaves(customer, happy) {
    customer.leaving = true;
    customer.walk = 1;
    customer.moodOverride = happy ? 'happy' : 'angry';
    if (customer.selected) selectSeat(-1);
    if (happy) {
      say(customer, pick(rng, CUSTOMERS[customer.typeId].lines.happy), 1.6);
    } else {
      say(customer, pick(rng, CUSTOMERS[customer.typeId].lines.angry), 1.6);
      audio.angry();
      state.stats.lost += 1;
      state.dayStats.lost += 1;
      state.fx.push({ kind: 'sad', x: LAYOUT.seatsX[customer.seat], y: 210, text: 'left hungry…', at: state.t, seed: rng() * 6 });
    }
  }

  function serveSelected() {
    const customer = selected();
    if (!customer || customer.leaving) return;
    if (!plateComplete(customer.plate)) {
      toast('The dish is not finished yet.');
      return;
    }
    const recipe = recipeById(customer.recipeId);
    const type = CUSTOMERS[customer.typeId];
    const allPerfect = plateAllPerfect(customer.plate);
    const scaled = { ...recipe, price: Math.round(recipe.price * (state.priceScale ?? 1)) };
    const pay = payout(scaled, type, customer.patience / customer.patienceMax, allPerfect, state.owned);
    state.bank += pay.total;
    state.dayEarned += pay.total;
    state.totalEarned += pay.total;
    state.loanRepaid = Math.min(LOAN_TOTAL, state.loanRepaid + pay.total);
    const perfectCount = customer.plate.perfects.filter(Boolean).length;
    state.stats.served += 1;
    state.dayStats.served += 1;
    state.stats.perfects += perfectCount;
    state.dayStats.perfects += perfectCount;
    const x = LAYOUT.seatsX[customer.seat];
    state.fx.push({ kind: 'coin', x, y: 236, text: `+$${pay.total}`, at: state.t, seed: rng() * 6 });
    if (pay.tip > 0) state.fx.push({ kind: 'coin', x: x + 54, y: 262, text: `tip $${pay.tip}`, at: state.t + 0.05, seed: rng() * 6 });
    if (allPerfect) state.fx.push({ kind: 'sparkle', x, y: 330, at: state.t, seed: rng() * 6 });
    audio.serve();
    audio.coin();
    customerLeaves(customer, true);
  }

  function update(dt) {
    state.t += dt;
    state.fx = state.fx.filter((fx) => state.t - fx.at < 1.4);
    if (state.screen !== SCREEN.SERVICE) return;
    // Kitchen first: a perfect ding the moment a window opens.
    for (const ev of updateKitchen(state.kitchen, dt)) {
      if (ev.type === 'perfect') audio.ding();
      if (ev.type === 'burnt') toast(`${INGREDIENTS[ev.item.ingredient].name} burnt! Click it to throw it away.`);
    }
    // Customers.
    let anyWaiting = false;
    state.customers.forEach((customer, seat) => {
      if (!customer) return;
      if (customer.bubbleT > 0) {
        customer.bubbleT -= dt;
        if (customer.bubbleT <= 0) customer.bubble = null;
      }
      if (customer.leaving) {
        customer.walk -= dt / 0.8;
        if (customer.walk <= 0) state.customers[seat] = null;
        return;
      }
      if (customer.phase === 'enter') {
        customer.walk += dt / 0.85;
        if (customer.walk >= 1) { customer.walk = 1; customer.phase = 'wait'; }
        return;
      }
      anyWaiting = true;
      customer.patience -= dt;
      const frac = customer.patience / customer.patienceMax;
      if (frac < 0.3 && !customer.warned) {
        customer.warned = true;
        say(customer, pick(rng, CUSTOMERS[customer.typeId].lines.waiting), 2.4);
      }
      if (customer.patience <= 0) customerLeaves(customer, false);
    });
    // New arrivals.
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = range(rng, 0.75, 1.25) * DAYS[state.day - 1].spawn;
      if (state.customers.some((c) => !c)) spawnCustomer();
    }
    void anyWaiting;
    // The clock.
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      endDay();
    }
  }

  function clickPantry(id) {
    const customer = selected();
    if (!customer || customer.leaving) { toast('Click a customer first.'); return; }
    const step = nextStep(customer.plate);
    if (!step) { toast('That dish is ready — serve it!'); return; }
    if (step.ingredient !== id) {
      toast(`Next: ${INGREDIENTS[step.ingredient].name}${step.process !== 'none' ? ` (${PROCESSES[step.process].label})` : ''}`);
      audio.click();
      return;
    }
    if (step.process === 'none') {
      addNextStep(state.kitchen, customer.plate);
      audio.plate();
      state.fx.push({ kind: 'sparkle', x: LAYOUT.plating.plateX, y: LAYOUT.plating.plateY - 60, at: state.t, seed: rng() * 6 });
      return;
    }
    const slot = sendNextStepToCook(state.kitchen, state.owned, customer.plate);
    if (slot === -1) {
      toast(`${PROCESSES[step.process].label} station is full!`);
      audio.click();
      return;
    }
    if (step.process === 'chop') audio.chop(); else audio.sizzle();
  }

  function clickStation(stationId, slot) {
    const item = state.kitchen.stations[stationId][slot];
    if (!item) return;
    const phase = phaseOf(item);
    if (phase === 'cooking') { toast('Still cooking…'); return; }
    if (phase === 'burnt') {
      takeFromStation(state.kitchen, stationId, slot);
      audio.trash();
      toast('Burnt food, in the bin.');
      return;
    }
    const customer = selected();
    if (!customer || customer.leaving) { toast('Select the customer this belongs to.'); return; }
    const step = nextStep(customer.plate);
    if (!step || step.process === 'none' || step.ingredient !== item.ingredient || PROCESSES[step.process].station !== stationId) {
      toast(step ? `The plate needs ${INGREDIENTS[step.ingredient].name} next.` : 'That dish is already complete.');
      return;
    }
    takeFromStation(state.kitchen, stationId, slot);
    customer.plate.added += 1;
    customer.plate.perfects.push(phase === 'perfect');
    audio.plate();
    if (phase === 'perfect') {
      state.fx.push({ kind: 'sparkle', x: LAYOUT.plating.plateX, y: LAYOUT.plating.plateY - 60, at: state.t, seed: rng() * 6 });
    }
  }

  function click(x, y) {
    audio.unlock();
    const S = state.screen;
    if (S === SCREEN.TITLE) {
      if (inside(x, y, LAYOUT.startBtn)) { audio.pop(); startDay(1); }
      return;
    }
    if (S === SCREEN.INTRO) {
      if (inside(x, y, LAYOUT.beginBtn)) { audio.pop(); state.screen = SCREEN.SERVICE; }
      return;
    }
    if (S === SCREEN.PAUSE) {
      if (inside(x, y, LAYOUT.resumeBtn)) state.screen = SCREEN.SERVICE;
      if (inside(x, y, LAYOUT.restartBtn)) startDay(state.day, { keepSnapshot: true });
      return;
    }
    if (S === SCREEN.SUMMARY) {
      if (inside(x, y, LAYOUT.continueBtn)) {
        audio.pop();
        if (state.day >= 12) state.screen = SCREEN.WIN;
        else { state.shopMsg = ''; state.screen = SCREEN.SHOP; }
      }
      return;
    }
    if (S === SCREEN.SHOP) {
      const g = LAYOUT.shopGrid;
      UPGRADES.forEach((up, i) => {
        const col = i % g.cols, row = Math.floor(i / g.cols);
        const rect = { x: g.x + col * (g.cardW + g.gap), y: g.y + row * (g.cardH + g.gap), w: g.cardW, h: g.cardH };
        if (!inside(x, y, rect) || state.owned.has(up.id)) return;
        if (state.bank >= up.cost) {
          state.bank -= up.cost;
          state.owned.add(up.id);
          state.shopMsg = `${up.name} — yours.`;
          audio.coin();
        } else {
          state.shopMsg = `The ${up.name} costs $${up.cost} — not enough coins yet.`;
          audio.click();
        }
      });
      if (inside(x, y, LAYOUT.shopStartBtn)) { audio.pop(); startDay(state.day + 1); }
      return;
    }
    if (S === SCREEN.OVER) {
      if (inside(x, y, LAYOUT.retryBtn)) {
        state.bank = snapshot.bank;
        state.loanRepaid = snapshot.loan;
        state.totalEarned = snapshot.totalEarned;
        state.owned = new Set(snapshot.owned);
        state.stats = { ...snapshot.stats };
        startDay(state.day, { keepSnapshot: true });
      }
      return;
    }
    if (S === SCREEN.WIN) {
      if (inside(x, y, LAYOUT.continueBtn)) {
        state.bank = 0;
        state.loanRepaid = 0;
        state.totalEarned = 0;
        state.owned = new Set();
        state.stats = { served: 0, lost: 0, perfects: 0 };
        state.screen = SCREEN.TITLE;
      }
      return;
    }
    // Service.
    if (inside(x, y, LAYOUT.muteBtn)) {
      state.muted = audio.toggleMute();
      return;
    }
    if (inside(x, y, LAYOUT.pauseBtn)) { state.screen = SCREEN.PAUSE; return; }
    // Customers: click a figure (or its ticket) to select.
    for (let seat = 0; seat < SEATS; seat += 1) {
      const c = state.customers[seat];
      if (!c || c.leaving) continue;
      const cx = LAYOUT.seatsX[seat];
      if (Math.abs(x - cx) <= 74 && y >= 236 && y <= 516) { selectSeat(seat); audio.click(); return; }
    }
    // Pantry.
    for (let i = 0; i < PANTRY_ORDER.length; i += 1) {
      if (inside(x, y, pantryCell(i))) { clickPantry(PANTRY_ORDER[i]); return; }
    }
    // Stations.
    for (let row = 0; row < STATION_ORDER.length; row += 1) {
      const stationId = STATION_ORDER[row];
      const slots = state.kitchen.stations[stationId];
      for (let slot = 0; slot < slots.length; slot += 1) {
        if (inside(x, y, stationSlotRect(row, slot))) { clickStation(stationId, slot); return; }
      }
    }
    // Serve / trash.
    if (inside(x, y, LAYOUT.serveBtn)) { serveSelected(); return; }
    if (inside(x, y, LAYOUT.trashBtn)) {
      const customer = selected();
      if (customer && customer.plate.added > 0) {
        customer.plate = createPlate(customer.recipeId);
        audio.trash();
        toast('Plate cleared.');
      }
      return;
    }
  }

  function key(name) {
    audio.unlock();
    if (name === 'm' || name === 'M') { state.muted = audio.toggleMute(); return; }
    if (state.screen === SCREEN.SERVICE) {
      if (name === ' ' || name === 'Enter') serveSelected();
      if (name === 'Escape' || name === 'p' || name === 'P') state.screen = SCREEN.PAUSE;
    } else if (state.screen === SCREEN.PAUSE && (name === 'Escape' || name === 'p' || name === 'P')) {
      state.screen = SCREEN.SERVICE;
    }
  }

  return {
    state,
    update,
    click,
    key,
    startDay,
    spawnCustomer,
    selectSeat,
    serveSelected,
  };
}
