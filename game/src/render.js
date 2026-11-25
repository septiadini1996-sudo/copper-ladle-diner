// The renderer: every pixel of The Copper Ladle is drawn here, in code, on one canvas.
// The scene obeys a single light logic — warm light falls from the three hanging lamps and
// spills from the brick oven — so every surface is shaded with gradients, soft shadows and
// glow pools; nothing is a flat silhouette. Three depth layers read in every frame: the
// decorated wall behind, the customers at the counter in the middle, and the shaded
// counter front and workspace in the foreground.
//
// This module only reads state; the state machine in game.js owns it. Layout rectangles
// are exported so game.js can hit-test the same boxes the player sees.

import { INK, LOAN_TOTAL, SCREEN, STAGE } from './config.js';
import { CUSTOMERS, INGREDIENTS, PROCESSES, STATIONS, UPGRADES, recipeById } from './data.js';
import { nextStep, phaseOf, plateComplete } from './kitchen.js';
import { createRandom } from './random.js';

/** Fixed layout boxes shared with input handling. */
export const LAYOUT = {
  hud: { x: 0, y: 0, w: STAGE.width, h: 54 },
  muteBtn: { x: 1180, y: 9, w: 40, h: 36 },
  pauseBtn: { x: 1128, y: 9, w: 40, h: 36 },
  seatsX: [250, 640, 1030],
  seatY: 452,
  pantry: { x: 14, y: 524, w: 400, h: 268, cols: 5, cellW: 74, cellH: 34, gap: 3, gridX: 21, gridY: 556 },
  stations: { x: 428, y: 524, w: 424, h: 268, rowH: 48, gap: 5, top: 528, artX: 438, artW: 96, slotX: 548, slotW: 92, slotH: 42, slotGap: 6 },
  plating: { x: 866, y: 524, w: 400, h: 268, plateX: 982, plateY: 656, plateR: 84 },
  serveBtn: { x: 884, y: 738, w: 168, h: 40 },
  trashBtn: { x: 1064, y: 738, w: 184, h: 40 },
  startBtn: { x: 490, y: 648, w: 300, h: 56 },
  beginBtn: { x: 490, y: 620, w: 300, h: 54 },
  continueBtn: { x: 490, y: 668, w: 300, h: 52 },
  shopStartBtn: { x: 940, y: 716, w: 300, h: 52 },
  retryBtn: { x: 490, y: 600, w: 300, h: 54 },
  resumeBtn: { x: 490, y: 380, w: 300, h: 52 },
  restartBtn: { x: 490, y: 452, w: 300, h: 52 },
  shopGrid: { x: 70, y: 150, cols: 4, cardW: 272, cardH: 240, gap: 18 },
};

/** Pantry order: the order the ingredient buttons are drawn (and clicked). */
export const PANTRY_ORDER = [
  'bun', 'bread', 'dough', 'tortilla', 'patty',
  'steak', 'chicken', 'salmon', 'bacon', 'egg',
  'potato', 'noodles', 'rice', 'corn', 'cheese',
  'lettuce', 'tomato', 'onion', 'mushroom', 'carrot',
  'pepper', 'cucumber', 'garlic', 'basil', 'apple',
  'berries', 'cream', 'honey', 'sauce',
];

/** Rectangle of pantry cell i. */
export function pantryCell(i) {
  const p = LAYOUT.pantry;
  const col = i % p.cols;
  const row = Math.floor(i / p.cols);
  return { x: p.gridX + col * (p.cellW + p.gap), y: p.gridY + row * (p.cellH + p.gap), w: p.cellW, h: p.cellH };
}

/** Rectangle of a station slot. */
export function stationSlotRect(stationIndex, slot) {
  const s = LAYOUT.stations;
  return { x: s.slotX + slot * (s.slotW + s.slotGap), y: s.top + stationIndex * (s.rowH + s.gap) + 3, w: s.slotW, h: s.slotH };
}

export const STATION_ORDER = ['prep', 'grill', 'fryer', 'stove', 'oven'];

// ---------- small drawing helpers ----------

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function text(ctx, str, x, y, font, color, align = 'center') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function glowPool(ctx, x, y, rx, ry, alpha) {
  const g = ctx.createRadialGradient(x, y, 4, x, y, rx);
  g.addColorStop(0, `rgba(255,196,110,${alpha})`);
  g.addColorStop(1, 'rgba(255,196,110,0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ellipse(ctx, x, y, rx, rx);
  ctx.fill();
  ctx.restore();
}

function softShadow(ctx, x, y, rx, ry, alpha = 0.3) {
  ctx.fillStyle = `rgba(10,4,2,${alpha})`;
  ellipse(ctx, x, y, rx, ry);
  ctx.fill();
}

// ---------- the room ----------

function drawWindow(ctx, progress, t) {
  const x = 36, y = 78, w = 286, h = 174;
  // Evening sky: dusk amber at the start of service, deep indigo by the end.
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  const mix = (a, b) => Math.round(a + (b - a) * progress);
  sky.addColorStop(0, `rgb(${mix(238, 32)},${mix(150, 36)},${mix(84, 74)})`);
  sky.addColorStop(0.7, `rgb(${mix(196, 52)},${mix(96, 44)},${mix(70, 84)})`);
  sky.addColorStop(1, `rgb(${mix(120, 30)},${mix(62, 26)},${mix(56, 50)})`);
  ctx.save();
  rr(ctx, x, y, w, h, 8);
  ctx.clip();
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  // Moon (or low sun early on) drifting as the day drains.
  const mx = x + 52 + progress * 30, my = y + 42 - progress * 10;
  ctx.fillStyle = progress < 0.4 ? '#ffd98a' : '#e8e4da';
  ellipse(ctx, mx, my, 17, 17);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ellipse(ctx, mx - 5, my - 4, 4, 4); ctx.fill();
  ellipse(ctx, mx + 6, my + 6, 3, 3); ctx.fill();
  // Rooftops and lit windows across the street.
  ctx.fillStyle = 'rgba(38,20,34,0.85)';
  ctx.fillRect(x, y + 108, 74, 66);
  ctx.fillRect(x + 82, y + 92, 96, 82);
  ctx.fillRect(x + 186, y + 116, 100, 58);
  ctx.fillStyle = 'rgba(255,205,110,0.9)';
  const rng = createRandom(41);
  for (let i = 0; i < 14; i += 1) {
    const wx = x + 10 + rng() * (w - 24);
    const wy = y + 100 + rng() * 58;
    if (rng() > 0.35) ctx.fillRect(wx, wy, 7, 9);
  }
  // A street lamp and its halo.
  ctx.strokeStyle = '#241722';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x + 238, y + h); ctx.lineTo(x + 238, y + 96); ctx.stroke();
  glowPool(ctx, x + 238, y + 88, 30, 30, 0.5);
  ctx.fillStyle = '#ffd98a';
  ellipse(ctx, x + 238, y + 88, 6, 8); ctx.fill();
  // A car passes now and then, headlights first.
  const carPhase = (t * 0.045) % 1.6;
  if (carPhase < 1) {
    const cx = x - 70 + carPhase * (w + 140);
    ctx.fillStyle = 'rgba(20,12,20,0.9)';
    rr(ctx, cx, y + 138, 58, 20, 6); ctx.fill();
    rr(ctx, cx + 10, y + 128, 34, 14, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,160,0.95)';
    ellipse(ctx, cx + 56, y + 148, 4, 3); ctx.fill();
    glowPool(ctx, cx + 66, y + 148, 18, 8, 0.35);
  }
  // Street.
  ctx.fillStyle = 'rgba(24,14,22,0.55)';
  ctx.fillRect(x, y + 158, w, 16);
  ctx.restore();
  // Frame and cross bars, with a warm rim where the lamp light catches it.
  ctx.strokeStyle = INK.woodDark;
  ctx.lineWidth = 10;
  rr(ctx, x, y, w, h, 8); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,205,130,0.25)';
  ctx.lineWidth = 2;
  rr(ctx, x + 5, y + 5, w - 10, h - 10, 6); ctx.stroke();
  ctx.strokeStyle = INK.woodDark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  // Curtains.
  for (const side of [0, 1]) {
    const cx = side ? x + w - 26 : x + 4;
    const g = ctx.createLinearGradient(cx, 0, cx + 22, 0);
    g.addColorStop(0, '#7c2f3e');
    g.addColorStop(0.5, '#9c4254');
    g.addColorStop(1, '#6b2836');
    ctx.fillStyle = g;
    rr(ctx, cx, y + 2, 22, 92, 6); ctx.fill();
  }
}

const JAR_LABELS = [
  ['FLOUR', '#e8dcc0'], ['SUGAR', '#f2ead8'], ['SALT', '#dfe4e6'], ['RICE', '#efe8d2'],
  ['PASTA', '#e9cf8e'], ['SPICE', '#c96a3c'], ['HONEY', '#eda52c'], ['COCOA', '#7c4a2d'],
  ['HERBS', '#5d8a4a'], ['TEA', '#8a6a9e'], ['CHILI', '#c93b31'], ['OATS', '#dfc493'],
];

function drawShelf(ctx, t) {
  // Two wooden boards with shaded jars; copper pans hang below, swaying almost imperceptibly.
  for (const boardY of [128, 196]) {
    const g = ctx.createLinearGradient(0, boardY, 0, boardY + 10);
    g.addColorStop(0, INK.woodLight);
    g.addColorStop(1, INK.woodDark);
    ctx.fillStyle = g;
    rr(ctx, 372, boardY, 384, 10, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(384, boardY + 10, 8, 12);
    ctx.fillRect(736, boardY + 10, 8, 12);
  }
  JAR_LABELS.forEach(([label, color], i) => {
    const board = i < 6 ? 0 : 1;
    const col = i % 6;
    const jx = 388 + col * 62;
    const baseY = board === 0 ? 128 : 196;
    const jh = 40 + (i % 3) * 4;
    const jy = baseY - jh;
    // Glass body with shaded contents and a highlight stripe.
    ctx.fillStyle = 'rgba(230,225,210,0.20)';
    rr(ctx, jx, jy, 44, jh, 6); ctx.fill();
    ctx.fillStyle = color;
    rr(ctx, jx + 3, jy + jh * 0.38, 38, jh * 0.58, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(jx + 6, jy + 5, 5, jh - 12);
    ctx.fillStyle = INK.copperDark;
    rr(ctx, jx - 1, jy - 6, 46, 8, 3); ctx.fill();
    // The paper label, with the ingredient's name in tiny letters.
    ctx.fillStyle = INK.paper;
    rr(ctx, jx + 7, jy + jh * 0.44, 30, 13, 2); ctx.fill();
    text(ctx, label, jx + 22, jy + jh * 0.44 + 7, 'bold 6.5px Verdana, sans-serif', INK.ink);
  });
  // Copper pans on hooks.
  [428, 522, 616, 706].forEach((px, i) => {
    const sway = Math.sin(t * 0.9 + i * 1.7) * 0.03;
    ctx.save();
    ctx.translate(px, 206);
    ctx.rotate(sway);
    ctx.strokeStyle = '#2c1c10';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 16); ctx.stroke();
    const g = ctx.createRadialGradient(-6, 34, 4, 0, 38, 30);
    g.addColorStop(0, INK.copperLight);
    g.addColorStop(0.7, INK.copper);
    g.addColorStop(1, INK.copperDark);
    ctx.fillStyle = g;
    ellipse(ctx, 0, 40, 25, 27); ctx.fill();
    ctx.fillStyle = 'rgba(90,45,20,0.55)';
    ellipse(ctx, 0, 40, 17, 19); ctx.fill();
    ctx.fillStyle = 'rgba(255,225,180,0.5)';
    ellipse(ctx, -8, 28, 6, 9); ctx.fill();
    ctx.restore();
  });
  // Utensils on hooks beside the pans.
  ctx.strokeStyle = '#c9c2b4';
  ctx.lineWidth = 3;
  [772, 788].forEach((ux, i) => {
    ctx.beginPath(); ctx.moveTo(ux, 210); ctx.lineTo(ux, 238 + i * 6); ctx.stroke();
    ellipse(ctx, ux, 244 + i * 6, 5, 7); ctx.stroke();
  });
}

function drawWallDecor(ctx, state) {
  // Posters.
  const poster = (x, y, w, h, bg, title, sub, accent) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rr(ctx, x + 3, y + 4, w, h, 4); ctx.fill();
    ctx.fillStyle = bg;
    rr(ctx, x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(60,35,18,0.6)';
    ctx.lineWidth = 2;
    rr(ctx, x + 4, y + 4, w - 8, h - 8, 3); ctx.stroke();
    ellipse(ctx, x + w / 2, y + 26, 13, 13);
    ctx.fillStyle = accent; ctx.fill();
    text(ctx, title, x + w / 2, y + 54, 'bold 17px Georgia, serif', INK.ink);
    text(ctx, sub, x + w / 2, y + 72, '10px Georgia, serif', 'rgba(43,26,18,0.75)');
  };
  poster(792, 82, 118, 84, '#e9d9ae', 'EAT!', 'fresh daily', '#c93b31');
  poster(792, 180, 118, 84, '#dfe4da', "ROSA'S", 'since 1987', '#3f6b6e');
  // Wall clock, tucked between the window and the shelf, its hands on the service hour.
  const cx = 349, cy = 96;
  ctx.fillStyle = INK.woodDark;
  ellipse(ctx, cx, cy, 20, 20); ctx.fill();
  ctx.fillStyle = INK.paper;
  ellipse(ctx, cx, cy, 16, 16); ctx.fill();
  const ang = -Math.PI / 2 + (1 - state.timeLeft / Math.max(1, state.daySecs)) * Math.PI * 1.5;
  ctx.strokeStyle = INK.ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 9); ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang * 2.3) * 12, cy + Math.sin(ang * 2.3) * 12); ctx.stroke();
  // Menu board: today's specials in chalk.
  const mx = 952, my = 78, mw = 292, mh = 174;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  rr(ctx, mx + 4, my + 5, mw, mh, 8); ctx.fill();
  const mg = ctx.createLinearGradient(0, my, 0, my + mh);
  mg.addColorStop(0, '#31463c');
  mg.addColorStop(1, '#22332b');
  ctx.fillStyle = mg;
  rr(ctx, mx, my, mw, mh, 8); ctx.fill();
  ctx.strokeStyle = INK.woodLight;
  ctx.lineWidth = 5;
  rr(ctx, mx, my, mw, mh, 8); ctx.stroke();
  text(ctx, "— TODAY'S SPECIALS —", mx + mw / 2, my + 24, 'bold 14px Georgia, serif', '#e8cf96');
  state.specials.forEach((r, i) => {
    const yy = my + 56 + i * 24;
    text(ctx, r.name, mx + 18, yy, '13px Georgia, serif', 'rgba(246,231,200,0.92)', 'left');
    text(ctx, `$${Math.round(r.price * (state.priceScale ?? 1))}`, mx + mw - 18, yy, 'bold 13px Georgia, serif', '#e8cf96', 'right');
  });
}

function drawLamps(ctx, t) {
  for (const lx of [180, 640, 1100]) {
    const sway = Math.sin(t * 0.7 + lx) * 4;
    ctx.strokeStyle = '#1d1210';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(lx, 54); ctx.lineTo(lx + sway, 112); ctx.stroke();
    // Glow first, then the shade and bulb.
    glowPool(ctx, lx + sway, 128, 86, 60, 0.30);
    const g = ctx.createLinearGradient(lx - 30, 100, lx + 30, 132);
    g.addColorStop(0, '#3f6b5c');
    g.addColorStop(1, '#27443a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx + sway - 30, 130);
    ctx.lineTo(lx + sway - 12, 104);
    ctx.lineTo(lx + sway + 12, 104);
    ctx.lineTo(lx + sway + 30, 130);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd98a';
    ellipse(ctx, lx + sway, 132, 8, 6); ctx.fill();
    glowPool(ctx, lx + sway, 452, 120, 26, 0.20);
  }
}

/** Miso, the diner cat, asleep on her stool at the counter's right end. Breathing, always. */
function drawCat(ctx, t) {
  const x = 1196, y = 448;
  // The stool.
  ctx.fillStyle = INK.woodDark;
  ctx.fillRect(x - 30, y + 14, 8, 34);
  ctx.fillRect(x + 22, y + 14, 8, 34);
  const sg = ctx.createLinearGradient(0, y + 2, 0, y + 16);
  sg.addColorStop(0, '#9c4254');
  sg.addColorStop(1, '#74303f');
  ctx.fillStyle = sg;
  rr(ctx, x - 40, y + 2, 80, 14, 6); ctx.fill();
  const breath = 1 + Math.sin(t * 1.4) * 0.02;
  ctx.save();
  ctx.translate(x, y + 2);
  ctx.scale(1, breath);
  // Tail curled around the body.
  ctx.strokeStyle = '#c97b4a';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(6, -6, 30, 0.4, 2.4); ctx.stroke();
  ctx.strokeStyle = '#a05f31';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(6, -6, 30, 2.0, 2.4); ctx.stroke();
  // Body: a warm curled loaf with stripes.
  const bg = ctx.createRadialGradient(-10, -22, 6, 0, -12, 44);
  bg.addColorStop(0, '#eda96e');
  bg.addColorStop(1, '#c97b4a');
  ctx.fillStyle = bg;
  ellipse(ctx, 0, -12, 38, 22); ctx.fill();
  ctx.strokeStyle = 'rgba(140,80,40,0.5)';
  ctx.lineWidth = 3;
  for (const sx of [-18, -4, 10]) {
    ctx.beginPath(); ctx.moveTo(sx, -30); ctx.quadraticCurveTo(sx + 3, -18, sx, -6); ctx.stroke();
  }
  // Head tucked down, ears, closed eyes.
  ctx.fillStyle = '#eda96e';
  ellipse(ctx, -26, -14, 17, 14); ctx.fill();
  ctx.fillStyle = '#e09a58';
  ctx.beginPath();
  ctx.moveTo(-38, -24); ctx.lineTo(-34, -36); ctx.lineTo(-26, -27); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-18, -27); ctx.lineTo(-12, -37); ctx.lineTo(-8, -25); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,25,0.8)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-34, -14); ctx.quadraticCurveTo(-30, -11.5, -26, -14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-22, -14); ctx.quadraticCurveTo(-18, -11.5, -14, -14); ctx.stroke();
  ctx.restore();
  // A drifting z, now and then.
  const zPhase = (t * 0.22) % 1;
  if (zPhase < 0.55) {
    ctx.globalAlpha = 0.75 * (1 - zPhase);
    text(ctx, 'z', x - 34 + zPhase * 10, y - 52 - zPhase * 22, 'bold 15px Georgia, serif', '#e8dcc0');
    ctx.globalAlpha = 1;
  }
}

function drawCounter(ctx) {
  // Top slab with a lit front edge, then the shaded front face with panel mouldings.
  const g = ctx.createLinearGradient(0, 446, 0, 472);
  g.addColorStop(0, '#e0aa6a');
  g.addColorStop(0.25, INK.counterTop);
  g.addColorStop(1, '#9c6a38');
  ctx.fillStyle = g;
  rr(ctx, 8, 446, 1264, 26, 8); ctx.fill();
  ctx.fillStyle = 'rgba(255,230,180,0.5)';
  ctx.fillRect(14, 448, 1252, 3);
  const f = ctx.createLinearGradient(0, 472, 0, 518);
  f.addColorStop(0, INK.counterFace);
  f.addColorStop(1, INK.counterShadow);
  ctx.fillStyle = f;
  ctx.fillRect(8, 472, 1264, 46);
  ctx.strokeStyle = 'rgba(30,16,6,0.5)';
  ctx.lineWidth = 2;
  for (let px = 90; px < 1270; px += 150) {
    rr(ctx, px, 480, 118, 30, 4); ctx.stroke();
  }
}

// ---------- customers ----------

function moodOf(customer) {
  if (customer.moodOverride) return customer.moodOverride;
  const frac = customer.patience / customer.patienceMax;
  return frac > 0.55 ? 'happy' : frac > 0.28 ? 'flat' : 'angry';
}

function drawCharacter(ctx, customer, t) {
  const type = CUSTOMERS[customer.typeId];
  const look = type.look;
  const cx = LAYOUT.seatsX[customer.seat];
  const enterShift = customer.phase === 'enter' || customer.leaving ? (1 - customer.walk) * 260 : 0;
  const x = cx + enterShift;
  const bob = customer.phase === 'wait' && !customer.leaving ? Math.sin(t * 1.8 + customer.bobSeed) * 2.2 : 0;
  const baseY = LAYOUT.seatY + bob;
  softShadow(ctx, x, 452, 56, 10, 0.35);
  // Stool.
  ctx.fillStyle = INK.woodDark;
  ctx.fillRect(x - 26, 428, 52, 10);
  ctx.fillRect(x - 20, 438, 6, 16);
  ctx.fillRect(x + 14, 438, 6, 16);
  // Body: shaded clothing with fold lines and arms resting toward the counter.
  const bg = ctx.createLinearGradient(x - 40, 350, x + 40, 440);
  bg.addColorStop(0, look.cloth);
  bg.addColorStop(1, look.clothDark);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x - 34, 440);
  ctx.quadraticCurveTo(x - 40, 372, x - 22, 352);
  ctx.lineTo(x + 22, 352);
  ctx.quadraticCurveTo(x + 40, 372, x + 34, 440);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 12, 366); ctx.quadraticCurveTo(x - 14, 400, x - 12, 436); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 12, 366); ctx.quadraticCurveTo(x + 14, 400, x + 12, 436); ctx.stroke();
  // Arms forward onto the counter.
  ctx.strokeStyle = look.clothDark;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 30, 386); ctx.quadraticCurveTo(x - 38, 424, x - 18, 442); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 30, 386); ctx.quadraticCurveTo(x + 38, 424, x + 18, 442); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = look.skin;
  ellipse(ctx, x - 16, 444, 7, 5); ctx.fill();
  ellipse(ctx, x + 16, 444, 7, 5); ctx.fill();
  // Extras that make each type themselves.
  if (look.extra === 'tie') {
    ctx.fillStyle = '#8c3030';
    ctx.beginPath();
    ctx.moveTo(x - 5, 356); ctx.lineTo(x + 5, 356); ctx.lineTo(x + 3, 396); ctx.lineTo(x, 404); ctx.lineTo(x - 3, 396);
    ctx.closePath(); ctx.fill();
  }
  if (look.extra === 'shawl') {
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x - 24, 360); ctx.quadraticCurveTo(x, 384, x + 24, 360); ctx.stroke();
  }
  if (look.extra === 'backpack') {
    ctx.fillStyle = '#38604a';
    rr(ctx, x - 46, 372, 12, 44, 5); ctx.fill();
    rr(ctx, x + 34, 372, 12, 44, 5); ctx.fill();
  }
  if (look.extra === 'camera') {
    ctx.fillStyle = '#2b2b30';
    rr(ctx, x - 11, 384, 22, 15, 3); ctx.fill();
    ctx.fillStyle = '#7fb2d9';
    ellipse(ctx, x, 391, 5, 5); ctx.fill();
    ctx.strokeStyle = '#2b2b30';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 8, 356); ctx.lineTo(x - 4, 384); ctx.stroke();
  }
  if (look.extra === 'bowtie') {
    ctx.fillStyle = '#8c2020';
    ctx.beginPath();
    ctx.moveTo(x, 360); ctx.lineTo(x - 10, 353); ctx.lineTo(x - 10, 367); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, 360); ctx.lineTo(x + 10, 353); ctx.lineTo(x + 10, 367); ctx.closePath(); ctx.fill();
  }
  // Head: shaded skin, ears, then hair with a highlight, then the face.
  const hy = 316 + bob;
  ctx.fillStyle = look.skin;
  ellipse(ctx, x - 30, hy + 2, 5, 7); ctx.fill();
  ellipse(ctx, x + 30, hy + 2, 5, 7); ctx.fill();
  const hg = ctx.createRadialGradient(x - 10, hy - 14, 6, x, hy, 34);
  hg.addColorStop(0, shade(look.skin, 18));
  hg.addColorStop(1, shade(look.skin, -16));
  ctx.fillStyle = hg;
  ellipse(ctx, x, hy, 30, 32); ctx.fill();
  drawHair(ctx, x, hy, look);
  drawFace(ctx, x, hy, look, moodOf(customer), t, customer);
  // Patience: a slim bar beside the figure, draining from green to red.
  const frac = Math.max(0, customer.patience / customer.patienceMax);
  const bx = x + 52, by = 306, bh = 128;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  rr(ctx, bx - 2, by - 2, 9, bh + 4, 4); ctx.fill();
  ctx.fillStyle = frac > 0.55 ? INK.good : frac > 0.28 ? INK.warn : INK.bad;
  rr(ctx, bx, by + bh * (1 - frac), 5, bh * frac, 2); ctx.fill();
  // The selected customer's seat glows.
  if (customer.selected) {
    ctx.strokeStyle = 'rgba(242,182,60,0.85)';
    ctx.lineWidth = 2.5;
    ellipse(ctx, x, 448, 62, 12); ctx.stroke();
  }
}

function drawHair(ctx, x, hy, look) {
  ctx.fillStyle = look.hairColor;
  const style = look.hair;
  if (style === 'cap') {
    ctx.beginPath(); ctx.ellipse(x, hy - 16, 31, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    rr(ctx, x - 33, hy - 18, 66, 7, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.ellipse(x - 8, hy - 26, 16, 6, -0.2, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'bun') {
    ctx.beginPath(); ctx.ellipse(x, hy - 14, 31, 22, 0, Math.PI, Math.PI * 2); ctx.fill();
    ellipse(ctx, x, hy - 38, 11, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ellipse(ctx, x - 3, hy - 40, 4, 3); ctx.fill();
  } else if (style === 'pompadour') {
    ctx.beginPath();
    ctx.moveTo(x - 30, hy - 12);
    ctx.quadraticCurveTo(x - 32, hy - 44, x + 2, hy - 46);
    ctx.quadraticCurveTo(x + 34, hy - 44, x + 30, hy - 10);
    ctx.quadraticCurveTo(x, hy - 22, x - 30, hy - 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath(); ctx.ellipse(x + 4, hy - 38, 14, 5, -0.15, 0, Math.PI * 2); ctx.fill();
  } else if (style === 'curls') {
    for (const [ox, oy, r] of [[-24, -18, 11], [-10, -27, 12], [6, -28, 12], [20, -20, 11], [27, -6, 9], [-29, -5, 9]]) {
      ellipse(ctx, x + ox, hy + oy, r, r); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ellipse(ctx, x - 8, hy - 30, 6, 4); ctx.fill();
  } else if (style === 'slick') {
    ctx.beginPath(); ctx.ellipse(x, hy - 15, 30, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 30, hy - 16, 60, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.ellipse(x - 6, hy - 27, 15, 4, -0.1, 0, Math.PI * 2); ctx.fill();
  } else { // neat
    ctx.beginPath(); ctx.ellipse(x, hy - 15, 30, 20, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.ellipse(x - 8, hy - 25, 13, 4, -0.15, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFace(ctx, x, hy, look, mood, t, customer) {
  const blink = (t * 0.5 + customer.bobSeed) % 3.4 < 0.09;
  ctx.strokeStyle = 'rgba(43,26,18,0.9)';
  ctx.fillStyle = 'rgba(43,26,18,0.9)';
  ctx.lineWidth = 2;
  if (blink) {
    ctx.beginPath(); ctx.moveTo(x - 14, hy + 1); ctx.lineTo(x - 6, hy + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, hy + 1); ctx.lineTo(x + 14, hy + 1); ctx.stroke();
  } else {
    ellipse(ctx, x - 10, hy, 3, 4); ctx.fill();
    ellipse(ctx, x + 10, hy, 3, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ellipse(ctx, x - 11, hy - 1.5, 1.1, 1.4); ctx.fill();
    ellipse(ctx, x + 9, hy - 1.5, 1.1, 1.4); ctx.fill();
    ctx.fillStyle = 'rgba(43,26,18,0.9)';
  }
  // Brows follow the mood.
  ctx.lineWidth = 2.2;
  const browY = mood === 'angry' ? hy - 10 : hy - 12;
  ctx.beginPath();
  if (mood === 'angry') {
    ctx.moveTo(x - 15, browY - 2); ctx.lineTo(x - 5, browY + 2);
    ctx.moveTo(x + 15, browY - 2); ctx.lineTo(x + 5, browY + 2);
  } else {
    ctx.moveTo(x - 15, browY); ctx.quadraticCurveTo(x - 10, browY - 3, x - 5, browY);
    ctx.moveTo(x + 5, browY); ctx.quadraticCurveTo(x + 10, browY - 3, x + 15, browY);
  }
  ctx.stroke();
  // Nose and mouth.
  ctx.strokeStyle = 'rgba(120,70,40,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x + 1, hy + 4); ctx.quadraticCurveTo(x + 3, hy + 9, x, hy + 11); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,40,30,0.9)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  if (mood === 'happy') ctx.arc(x, hy + 12, 8, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood === 'flat') { ctx.moveTo(x - 6, hy + 19); ctx.lineTo(x + 6, hy + 19); }
  else ctx.arc(x, hy + 26, 7, 1.15 * Math.PI, 1.85 * Math.PI);
  ctx.stroke();
  // Cheeks when pleased.
  if (mood === 'happy') {
    ctx.fillStyle = 'rgba(230,120,100,0.28)';
    ellipse(ctx, x - 19, hy + 10, 6, 4); ctx.fill();
    ellipse(ctx, x + 19, hy + 10, 6, 4); ctx.fill();
  }
  if (look.extra === 'glasses') {
    ctx.strokeStyle = 'rgba(30,25,20,0.85)';
    ctx.lineWidth = 2;
    rr(ctx, x - 19, hy - 7, 16, 13, 4); ctx.stroke();
    rr(ctx, x + 3, hy - 7, 16, 13, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 3, hy - 2); ctx.lineTo(x + 3, hy - 2); ctx.stroke();
  }
}

function drawBubble(ctx, customer) {
  if (!customer.bubble) return;
  const cx = LAYOUT.seatsX[customer.seat] + (customer.phase === 'enter' || customer.leaving ? (1 - customer.walk) * 260 : 0);
  const msg = customer.bubble.text;
  ctx.font = 'italic 13.5px Georgia, serif';
  const w = Math.min(230, ctx.measureText(msg).width + 26);
  const x = Math.max(14, Math.min(STAGE.width - w - 14, cx - w / 2));
  const y = 196;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  rr(ctx, x + 2, y + 3, w, 34, 10); ctx.fill();
  ctx.fillStyle = '#fdf6e0';
  rr(ctx, x, y, w, 34, 10); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 6, y + 33); ctx.lineTo(cx + 6, y + 33); ctx.lineTo(cx, y + 44);
  ctx.closePath(); ctx.fill();
  text(ctx, msg, x + w / 2, y + 17, 'italic 13.5px Georgia, serif', INK.ink);
}

function drawTicket(ctx, customer, state) {
  const recipe = recipeById(customer.recipeId);
  const cx = LAYOUT.seatsX[customer.seat];
  const w = 196, h = 34, x = cx - w / 2, y = 476;
  ctx.save();
  ctx.translate(cx, y);
  ctx.rotate(Math.sin(customer.seat * 7.3) * 0.012);
  ctx.translate(-cx, -y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  rr(ctx, x + 2, y + 2, w, h, 4); ctx.fill();
  ctx.fillStyle = INK.paper;
  rr(ctx, x, y, w, h, 4); ctx.fill();
  ctx.fillStyle = '#c93b31';
  ellipse(ctx, cx, y + 1, 4, 4); ctx.fill();
  text(ctx, recipe.name, x + 10, y + 13, 'bold 11.5px Verdana, sans-serif', INK.ink, 'left');
  text(ctx, `$${Math.round(recipe.price * (state.priceScale ?? 1))}`, x + w - 10, y + 13, 'bold 11.5px Verdana, sans-serif', INK.ink, 'right');
  // Step dots: filled as the plate grows.
  const plate = customer.plate;
  recipe.steps.forEach((_, i) => {
    const dx = x + 14 + i * 15;
    ctx.fillStyle = plate && i < plate.added ? INK.good : 'rgba(43,26,18,0.25)';
    ellipse(ctx, dx, y + 26, 4, 4); ctx.fill();
  });
  ctx.restore();
}

// ---------- dishes ----------

function dishSeed(recipeId) {
  let h = 7;
  for (const ch of recipeId) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

/** One ingredient drawn as it appears inside a dish. kind selects the presentation. */
function paintIngredient(ctx, id, cx, y, w, mode, rng) {
  const ing = INGREDIENTS[id];
  const hw = w / 2;
  ctx.save();
  if (mode === 'bun-bottom') {
    const g = ctx.createLinearGradient(0, y - 9, 0, y + 4);
    g.addColorStop(0, ing.light); g.addColorStop(1, ing.dark);
    ctx.fillStyle = g;
    rr(ctx, cx - hw, y - 8, w, 12, 5); ctx.fill();
  } else if (mode === 'bun-top') {
    const dome = w * 0.24;
    const g = ctx.createLinearGradient(0, y - dome, 0, y + 2);
    g.addColorStop(0, ing.light); g.addColorStop(1, ing.base);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.quadraticCurveTo(cx, y - dome * 2, cx + hw, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,246,220,0.9)';
    for (let i = 0; i < 6; i += 1) ellipse(ctx, cx - hw + 8 + rng() * (w - 16), y - 6 - rng() * dome * 0.5, 2.2, 1.3), ctx.fill();
  } else if (mode === 'layer') {
    const g = ctx.createLinearGradient(0, y - 7, 0, y + 5);
    g.addColorStop(0, ing.light); g.addColorStop(1, ing.dark);
    ctx.fillStyle = g;
    if (id === 'cheese') {
      rr(ctx, cx - hw, y - 6, w, 9, 3); ctx.fill();
      ctx.beginPath();
      for (const dx of [-0.6, -0.15, 0.35, 0.7]) {
        const px = cx + dx * w * 0.5;
        ctx.moveTo(px - 4, y + 2); ctx.lineTo(px + 4, y + 2); ctx.lineTo(px, y + 9 + rng() * 4); ctx.closePath(); ctx.fill();
      }
    } else if (id === 'lettuce' || id === 'basil') {
      ctx.beginPath();
      ctx.moveTo(cx - hw, y);
      for (let px = -hw; px < hw; px += 9) ctx.quadraticCurveTo(cx + px + 4, y - 8, cx + px + 9, y);
      ctx.lineTo(cx + hw, y + 4); ctx.lineTo(cx - hw, y + 4);
      ctx.closePath(); ctx.fill();
    } else if (id === 'patty' || id === 'steak') {
      rr(ctx, cx - hw, y - 7, w, 13, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(40,18,8,0.5)';
      ctx.lineWidth = 2;
      for (const dx of [-0.5, 0, 0.5]) {
        ctx.beginPath(); ctx.moveTo(cx + dx * w * 0.55 - 5, y - 5); ctx.lineTo(cx + dx * w * 0.55 + 5, y + 4); ctx.stroke();
      }
    } else if (id === 'tomato') {
      ellipse(ctx, cx, y - 1, hw * 0.92, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,170,0.65)';
      for (const dx of [-0.4, 0.05, 0.45]) ellipse(ctx, cx + dx * w * 0.5, y - 1, 3, 2), ctx.fill();
    } else if (id === 'bacon') {
      ctx.beginPath();
      ctx.moveTo(cx - hw, y - 2);
      for (let px = -hw; px < hw; px += 12) ctx.quadraticCurveTo(cx + px + 6, y - 9, cx + px + 12, y - 2);
      ctx.lineTo(cx + hw, y + 4); ctx.lineTo(cx - hw, y + 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,190,0.5)';
      ctx.fillRect(cx - hw + 4, y - 3, w - 8, 2.4);
    } else {
      rr(ctx, cx - hw, y - 6, w, 11, 5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 4; i += 1) ellipse(ctx, cx - hw + 6 + rng() * (w - 12), y - 1, 2.4, 1.6), ctx.fill();
    }
  } else if (mode === 'mound') {
    // Inside a bowl or on a plate: a shaded little heap with texture marks.
    const g = ctx.createRadialGradient(cx - 4, y - 8, 3, cx, y, hw);
    g.addColorStop(0, ing.light); g.addColorStop(1, ing.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y + 3);
    ctx.quadraticCurveTo(cx, y - 15 - rng() * 4, cx + hw, y + 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    for (let i = 0; i < 4; i += 1) ellipse(ctx, cx - hw + 5 + rng() * (w - 10), y - 3 - rng() * 6, 2.4, 1.5), ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let i = 0; i < 3; i += 1) ellipse(ctx, cx - hw + 5 + rng() * (w - 10), y, 2.2, 1.4), ctx.fill();
    if (id === 'egg') {
      ctx.fillStyle = '#fff8e2';
      ellipse(ctx, cx, y - 2, hw * 0.8, 7); ctx.fill();
      ctx.fillStyle = '#f2a63c';
      ellipse(ctx, cx, y - 3, 6.5, 5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ellipse(ctx, cx - 2, y - 5, 2, 1.4); ctx.fill();
    }
    if (id === 'noodles') {
      ctx.strokeStyle = shade(ing.base, -28);
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(cx - hw + 3, y - 2 - i * 3);
        ctx.quadraticCurveTo(cx, y - 8 - i * 3, cx + hw - 3, y - 2 - i * 3);
        ctx.stroke();
      }
    }
    if (id === 'salmon' || id === 'steak') {
      ctx.strokeStyle = 'rgba(255,235,220,0.45)';
      ctx.lineWidth = 2;
      for (const dx of [-0.35, 0.05, 0.45]) {
        ctx.beginPath(); ctx.moveTo(cx + dx * w - 3, y - 8); ctx.lineTo(cx + dx * w + 3, y + 1); ctx.stroke();
      }
    }
    if (id === 'berries') {
      for (const [ox, oy] of [[-8, -4], [2, -8], [10, -3], [-2, -1]]) {
        ctx.fillStyle = ing.base;
        ellipse(ctx, cx + ox, y + oy, 4.6, 4.2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ellipse(ctx, cx + ox - 1.5, y + oy - 1.5, 1.4, 1.1); ctx.fill();
        ctx.fillStyle = ing.base;
      }
    }
    if (id === 'cream') {
      ctx.fillStyle = ing.light;
      ctx.beginPath();
      ctx.moveTo(cx - 9, y + 2);
      ctx.quadraticCurveTo(cx - 10, y - 8, cx - 2, y - 8);
      ctx.quadraticCurveTo(cx, y - 15, cx + 3, y - 8);
      ctx.quadraticCurveTo(cx + 11, y - 7, cx + 9, y + 2);
      ctx.closePath(); ctx.fill();
    }
    if (id === 'honey' || id === 'sauce') {
      ctx.strokeStyle = ing.base;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx - hw + 3, y - 6);
      for (let px = -hw + 3; px < hw - 4; px += 8) ctx.lineTo(cx + px + 4, y - 1), ctx.lineTo(cx + px + 8, y - 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPlateShadow(ctx, cx, cy, r) {
  softShadow(ctx, cx, cy + r * 0.62, r * 1.02, r * 0.2, 0.4);
}

function drawPlateBase(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
  g.addColorStop(0, '#fdfaf2');
  g.addColorStop(0.75, '#efe6d2');
  g.addColorStop(1, '#cfc0a0');
  ctx.fillStyle = g;
  ellipse(ctx, cx, cy, r, r * 0.72); ctx.fill();
  ctx.strokeStyle = 'rgba(150,125,85,0.5)';
  ctx.lineWidth = 2;
  ellipse(ctx, cx, cy, r * 0.78, r * 0.55); ctx.stroke();
}

/** Draw a plate with the steps added so far. The dish visibly grows, layer by layer. */
export function drawDish(ctx, plate, cx, cy, r, t) {
  const recipe = recipeById(plate.recipeId);
  const rng = createRandom(dishSeed(recipe.id) + plate.added * 13);
  const steps = recipe.steps.slice(0, plate.added);
  drawPlateShadow(ctx, cx, cy, r);
  if (recipe.kind === 'bowl') {
    // Bowl first (its rim behind the contents), contents mound up, then the near rim.
    const bg = ctx.createLinearGradient(0, cy - r * 0.2, 0, cy + r * 0.66);
    bg.addColorStop(0, '#b5503c');
    bg.addColorStop(1, '#7c3222');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.12);
    ctx.quadraticCurveTo(cx, cy + r * 0.95, cx + r, cy - r * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5d2718';
    ellipse(ctx, cx, cy + r * 0.62, r * 0.3, r * 0.09); ctx.fill();
    steps.forEach(([ing], i) => {
      paintIngredient(ctx, ing, cx, cy - r * 0.14 - i * r * 0.05, r * (1.25 - i * 0.07), 'mound', rng);
    });
    ctx.fillStyle = '#d96a4f';
    ellipse(ctx, cx, cy - r * 0.12, r, r * 0.17); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ellipse(ctx, cx, cy - r * 0.12, r * 0.86, r * 0.12); ctx.fill();
    steps.forEach(([ing], i) => {
      if (i >= steps.length - 2) paintIngredient(ctx, ing, cx, cy - r * 0.2 - (i - Math.max(0, steps.length - 2)) * r * 0.08, r * 0.8, 'mound', rng);
    });
  } else if (recipe.kind === 'stack') {
    drawPlateBase(ctx, cx, cy + r * 0.34, r);
    softShadow(ctx, cx, cy + r * 0.5, r * 0.52, r * 0.1, 0.3);
    let y = cy + r * 0.44;
    steps.forEach(([ing], i) => {
      const isBun = ing === 'bun' || ing === 'bread';
      const mode = isBun ? (i === recipe.steps.length - 1 && plate.added === recipe.steps.length ? 'bun-top' : i === 0 ? 'bun-bottom' : 'layer') : 'layer';
      paintIngredient(ctx, ing, cx, y, r * 1.12, mode, rng);
      y -= r * 0.185;
    });
  } else if (recipe.kind === 'flat') {
    drawPlateBase(ctx, cx, cy + r * 0.3, r);
    if (steps.length) {
      const ing = INGREDIENTS[steps[0][0]];
      const g = ctx.createRadialGradient(cx - 8, cy, 4, cx, cy + r * 0.2, r * 0.9);
      g.addColorStop(0, ing.light); g.addColorStop(1, ing.dark);
      ctx.fillStyle = g;
      ellipse(ctx, cx, cy + r * 0.18, r * 0.88, r * 0.5); ctx.fill();
      steps.slice(1).forEach(([ingId], i) => {
        for (let k = 0; k < 4; k += 1) {
          paintIngredient(ctx, ingId, cx - r * 0.5 + rng() * r, cy + r * 0.02 + rng() * r * 0.3, r * 0.3, 'mound', rng);
        }
        void i;
      });
    }
  } else if (recipe.kind === 'taco') {
    drawPlateBase(ctx, cx, cy + r * 0.32, r);
    [-0.42, 0.42].forEach((off, shellIdx) => {
      const sx = cx + off * r;
      ctx.fillStyle = INGREDIENTS.tortilla.dark;
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.4, cy + r * 0.42);
      ctx.quadraticCurveTo(sx, cy - r * 0.62, sx + r * 0.4, cy + r * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = INGREDIENTS.tortilla.base;
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.34, cy + r * 0.4);
      ctx.quadraticCurveTo(sx, cy - r * 0.5, sx + r * 0.34, cy + r * 0.4);
      ctx.closePath(); ctx.fill();
      steps.forEach(([ing], i) => {
        if (ing === 'tortilla') return;
        if ((i + shellIdx) % 2 === 0) paintIngredient(ctx, ing, sx, cy + r * 0.3 - i * r * 0.06, r * 0.5, 'mound', rng);
      });
    });
  } else { // plate: items arranged around the dish
    drawPlateBase(ctx, cx, cy + r * 0.26, r);
    const spots = [[0, 0.05], [-0.45, -0.08], [0.45, -0.08], [-0.28, 0.3], [0.3, 0.3], [0, -0.3]];
    steps.forEach(([ing], i) => {
      const [ox, oy] = spots[i % spots.length];
      paintIngredient(ctx, ing, cx + ox * r, cy + oy * r + r * 0.22, r * 0.52, 'mound', rng);
    });
  }
  // Steam curls off a hot, finished dish.
  if (plateComplete(plate) && t !== null) {
    ctx.strokeStyle = 'rgba(255,250,240,0.4)';
    ctx.lineWidth = 2.4;
    for (const dx of [-0.25, 0.1]) {
      ctx.beginPath();
      const sx = cx + dx * r;
      const sy = cy - r * 0.34;
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + Math.sin(t * 2 + dx * 9) * 5, sy - 14, sx + Math.sin(t * 1.6 + dx * 7) * 8, sy - 28);
      ctx.stroke();
    }
  }
}

// ---------- workspace panels ----------

function panel(ctx, x, y, w, h, title) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  rr(ctx, x + 3, y + 4, w, h, 10); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#3a2430');
  g.addColorStop(1, '#2a1822');
  ctx.fillStyle = g;
  rr(ctx, x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(220,170,110,0.28)';
  ctx.lineWidth = 1.5;
  rr(ctx, x, y, w, h, 10); ctx.stroke();
  if (title) text(ctx, title, x + 14, y + 17, 'bold 12px Verdana, sans-serif', '#e8cf96', 'left');
}

function drawPantry(ctx, state) {
  const p = LAYOUT.pantry;
  panel(ctx, p.x, p.y, p.w, p.h, 'PANTRY');
  const sel = state.customers[state.selectedSeat];
  const step = sel ? nextStep(sel.plate) : null;
  if (step) {
    const ing = INGREDIENTS[step.ingredient];
    const proc = PROCESSES[step.process];
    text(ctx, `next: ${ing.name}${step.process !== 'none' ? ` · ${proc.label}` : ''}`, p.x + p.w - 14, p.y + 17, 'bold 11.5px Verdana, sans-serif', '#ffd98a', 'right');
  }
  PANTRY_ORDER.forEach((id, i) => {
    const cell = pantryCell(i);
    const ing = INGREDIENTS[id];
    const isNext = step && step.ingredient === id;
    const g = ctx.createLinearGradient(0, cell.y, 0, cell.y + cell.h);
    g.addColorStop(0, '#54402c');
    g.addColorStop(1, '#3c2c1e');
    ctx.fillStyle = g;
    rr(ctx, cell.x, cell.y, cell.w, cell.h, 7); ctx.fill();
    ctx.strokeStyle = isNext ? INK.gold : 'rgba(220,170,110,0.22)';
    ctx.lineWidth = isNext ? 2.4 : 1.2;
    rr(ctx, cell.x, cell.y, cell.w, cell.h, 7); ctx.stroke();
    if (isNext) glowPool(ctx, cell.x + cell.w / 2, cell.y + cell.h / 2, 40, 22, 0.25);
    // A little shaded sample of the ingredient itself.
    const sg = ctx.createRadialGradient(cell.x + 14, cell.y + 12, 2, cell.x + 16, cell.y + 16, 11);
    sg.addColorStop(0, ing.light);
    sg.addColorStop(1, ing.dark);
    ctx.fillStyle = sg;
    ellipse(ctx, cell.x + 16, cell.y + cell.h / 2, 9, 8); ctx.fill();
    text(ctx, ing.name, cell.x + 28, cell.y + cell.h / 2, '10.5px Verdana, sans-serif', INK.cream, 'left');
  });
}

const STATION_ART = {
  prep: 'board', grill: 'grill', fryer: 'fryer', stove: 'pot', oven: 'oven',
};

function drawStationArt(ctx, stationId, x, y, w, h, active, t) {
  ctx.save();
  if (stationId === 'prep') {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#caa06a'); g.addColorStop(1, '#9c7440');
    ctx.fillStyle = g;
    rr(ctx, x + 4, y + 10, w - 8, h - 18, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,25,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + 10, y + h / 2); ctx.lineTo(x + w - 24, y + h / 2); ctx.stroke();
    ctx.strokeStyle = '#d8dce2';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + w - 22, y + 8); ctx.lineTo(x + w - 12, y + 26); ctx.stroke();
    ctx.strokeStyle = '#5a3a1c';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + w - 12, y + 26); ctx.lineTo(x + w - 8, y + 34); ctx.stroke();
  } else if (stationId === 'grill') {
    ctx.fillStyle = '#33383e';
    rr(ctx, x + 4, y + 8, w - 8, h - 14, 5); ctx.fill();
    if (active) {
      glowPool(ctx, x + w / 2, y + h / 2 + 4, 40, 16, 0.4 + Math.sin(t * 7) * 0.08);
      ctx.fillStyle = 'rgba(230,90,40,0.75)';
      for (let i = 0; i < 5; i += 1) ellipse(ctx, x + 14 + i * 15, y + h / 2 + 5, 5, 3.4), ctx.fill();
    }
    ctx.strokeStyle = '#14161a';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath(); ctx.moveTo(x + 8, y + 14 + i * 9); ctx.lineTo(x + w - 8, y + 14 + i * 9); ctx.stroke();
    }
  } else if (stationId === 'fryer') {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#8b939c'); g.addColorStop(1, '#565d66');
    ctx.fillStyle = g;
    rr(ctx, x + 8, y + 10, w - 16, h - 16, 5); ctx.fill();
    ctx.fillStyle = '#e8a83c';
    rr(ctx, x + 13, y + 14, w - 26, 12, 3); ctx.fill();
    if (active) {
      ctx.fillStyle = 'rgba(255,240,200,0.8)';
      const rng = createRandom(Math.floor(t * 6));
      for (let i = 0; i < 5; i += 1) ellipse(ctx, x + 16 + rng() * (w - 32), y + 17 + rng() * 7, 2, 1.6), ctx.fill();
    }
    ctx.strokeStyle = '#3a3f45';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + w - 14, y + 4); ctx.lineTo(x + w - 22, y + 14); ctx.stroke();
  } else if (stationId === 'stove') {
    ctx.fillStyle = '#2e3138';
    ellipse(ctx, x + w / 2, y + h - 8, w / 2 - 6, 8); ctx.fill();
    if (active) {
      ctx.fillStyle = 'rgba(90,150,255,0.8)';
      ellipse(ctx, x + w / 2, y + h - 9, 16, 4.4); ctx.fill();
      ctx.fillStyle = 'rgba(230,90,40,0.85)';
      ellipse(ctx, x + w / 2, y + h - 9, 9, 2.8); ctx.fill();
    }
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#6a7076'); g.addColorStop(0.5, '#a8adb4'); g.addColorStop(1, '#5a6068');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + 16, y + h - 12);
    ctx.lineTo(x + 20, y + 12);
    ctx.quadraticCurveTo(x + w / 2, y + 4, x + w - 20, y + 12);
    ctx.lineTo(x + w - 16, y + h - 12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#43484e';
    ellipse(ctx, x + w / 2, y + 11, w / 2 - 19, 5); ctx.fill();
  } else if (stationId === 'oven') {
    // The brick oven: arched mouth, and a fire that glows while anything bakes.
    ctx.fillStyle = '#8a4a34';
    rr(ctx, x + 2, y + 2, w - 4, h - 4, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(60,25,15,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x + 2, y + h / 2); ctx.lineTo(x + w - 2, y + h / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w / 2, y + 2); ctx.lineTo(x + w / 2, y + 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w / 4, y + h / 2); ctx.lineTo(x + w / 4, y + h - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + (3 * w) / 4, y + h / 2); ctx.lineTo(x + (3 * w) / 4, y + h - 2); ctx.stroke();
    ctx.fillStyle = '#1c0f0a';
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 17, y + h - 6);
    ctx.lineTo(x + w / 2 - 17, y + 22);
    ctx.quadraticCurveTo(x + w / 2, y + 4, x + w / 2 + 17, y + 22);
    ctx.lineTo(x + w / 2 + 17, y + h - 6);
    ctx.closePath(); ctx.fill();
    if (active) {
      const flicker = 0.75 + Math.sin(t * 9.3) * 0.15 + Math.sin(t * 23.7) * 0.1;
      glowPool(ctx, x + w / 2, y + h - 12, 26, 16, 0.55 * flicker);
      ctx.fillStyle = `rgba(255,${Math.round(140 + 40 * flicker)},50,0.95)`;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - 9, y + h - 7);
      ctx.quadraticCurveTo(x + w / 2 - 3, y + h - 22 * flicker, x + w / 2, y + h - 8);
      ctx.quadraticCurveTo(x + w / 2 + 4, y + h - 20 * flicker, x + w / 2 + 9, y + h - 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,130,0.95)';
      ellipse(ctx, x + w / 2, y + h - 9, 5, 3); ctx.fill();
    }
  }
  ctx.restore();
}

function drawStations(ctx, state, t) {
  const s = LAYOUT.stations;
  panel(ctx, s.x, s.y, s.w, s.h, 'STATIONS');
  text(ctx, 'click a ready item to plate it', s.x + s.w - 14, s.y + 17, '10.5px Verdana, sans-serif', 'rgba(246,231,200,0.6)', 'right');
  STATION_ORDER.forEach((stationId, row) => {
    const y = s.top + row * (s.rowH + s.gap);
    const slots = state.kitchen.stations[stationId];
    const active = slots.some(Boolean);
    drawStationArt(ctx, stationId, s.artX, y + 8, s.artW - 8, s.rowH - 16, active, t);
    text(ctx, STATIONS[stationId].name.toUpperCase(), s.artX + (s.artW - 8) / 2, y + s.rowH - 1, 'bold 8px Verdana, sans-serif', 'rgba(246,231,200,0.55)');
    slots.forEach((item, slot) => {
      const rect = stationSlotRect(row, slot);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      rr(ctx, rect.x, rect.y, rect.w, rect.h, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(220,170,110,0.18)';
      ctx.lineWidth = 1.2;
      rr(ctx, rect.x, rect.y, rect.w, rect.h, 7); ctx.stroke();
      if (!item) return;
      const phase = phaseOf(item);
      const ing = INGREDIENTS[item.ingredient];
      // The item itself, shaded, steaming while hot.
      paintIngredient(ctx, item.ingredient, rect.x + rect.w / 2, rect.y + rect.h - 6, rect.w * 0.8, 'mound', createRandom(slot * 31 + row * 7));
      if (phase !== 'burnt') drawSteam(ctx, rect.x + rect.w / 2, rect.y + 8, t, slot + row * 3);
      // The progress ring: fills while cooking, turns gold in the perfect window, red when burnt.
      const frac = phase === 'cooking' ? item.elapsed / item.needed : 1;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath(); ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, 19, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = phase === 'perfect' ? INK.gold : phase === 'burnt' ? INK.bad : phase === 'done' ? INK.good : '#d8dce2';
      ctx.beginPath();
      ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, 19, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      if (phase === 'perfect') {
        const pulse = 0.65 + Math.sin(t * 8) * 0.35;
        ctx.strokeStyle = `rgba(242,182,60,${0.5 * pulse})`;
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, 23, 0, Math.PI * 2); ctx.stroke();
        text(ctx, 'PERFECT!', rect.x + rect.w / 2, rect.y - 4, 'bold 10px Verdana, sans-serif', INK.gold);
      }
      if (phase === 'burnt') {
        text(ctx, 'BURNT', rect.x + rect.w / 2, rect.y - 4, 'bold 9.5px Verdana, sans-serif', INK.bad);
        ctx.fillStyle = 'rgba(20,12,10,0.45)';
        ellipse(ctx, rect.x + rect.w / 2, rect.y + rect.h - 12, 16, 8); ctx.fill();
      }
      void ing;
    });
  });
}

function drawSteam(ctx, x, y, t, seed) {
  ctx.strokeStyle = 'rgba(255,250,240,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 2; i += 1) {
    const ph = (t * 0.9 + seed * 0.37 + i * 0.5) % 1;
    ctx.globalAlpha = 0.35 * (1 - ph);
    ctx.beginPath();
    ctx.moveTo(x - 5 + i * 10, y);
    ctx.quadraticCurveTo(x - 8 + i * 10 + Math.sin(t * 3 + i) * 2, y - 8 - ph * 8, x - 4 + i * 10, y - 14 - ph * 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPlating(ctx, state, t) {
  const p = LAYOUT.plating;
  panel(ctx, p.x, p.y, p.w, p.h, 'PLATING');
  const customer = state.customers[state.selectedSeat];
  if (!customer) {
    text(ctx, 'Click a customer to take their order.', p.plateX, p.plateY - 20, 'italic 14px Georgia, serif', 'rgba(246,231,200,0.65)');
    drawPlateBase(ctx, p.plateX, p.plateY + 20, p.plateR * 0.8);
    return;
  }
  const recipe = recipeById(customer.recipeId);
  const type = CUSTOMERS[customer.typeId];
  text(ctx, recipe.name, p.x + 200, p.y + 17, 'bold 12.5px Verdana, sans-serif', '#ffd98a');
  text(ctx, `for the ${type.name}`, p.x + 200, p.y + 35, 'italic 11px Georgia, serif', 'rgba(246,231,200,0.6)');
  drawDish(ctx, customer.plate, p.plateX, p.plateY, p.plateR, t);
  // The step checklist: what is on, what is next, what is left.
  const lx = 1096;
  recipe.steps.forEach(([ing, proc], i) => {
    const yy = p.y + 66 + i * 25;
    const done = i < customer.plate.added;
    const isNext = i === customer.plate.added;
    ctx.fillStyle = done ? INK.good : isNext ? INK.gold : 'rgba(246,231,200,0.3)';
    ellipse(ctx, lx, yy, 6, 6); ctx.fill();
    if (done) {
      ctx.strokeStyle = '#22331b';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(lx - 3, yy); ctx.lineTo(lx - 1, yy + 3); ctx.lineTo(lx + 3.4, yy - 3); ctx.stroke();
    }
    const label = `${INGREDIENTS[ing].name}${proc !== 'none' ? ` · ${PROCESSES[proc].label}` : ''}`;
    text(ctx, label, lx + 12, yy, `${isNext ? 'bold ' : ''}11px Verdana, sans-serif`, done ? 'rgba(246,231,200,0.45)' : INK.cream, 'left');
    if (done && customer.plate.perfects[i]) text(ctx, '★', lx + 148, yy, '11px Verdana, sans-serif', INK.gold, 'right');
  });
  // Serve and trash.
  const ready = plateComplete(customer.plate);
  const sb = LAYOUT.serveBtn;
  const sg = ctx.createLinearGradient(0, sb.y, 0, sb.y + sb.h);
  sg.addColorStop(0, ready ? '#8fbf6a' : '#5c7350');
  sg.addColorStop(1, ready ? '#679c46' : '#43573c');
  ctx.fillStyle = sg;
  rr(ctx, sb.x, sb.y, sb.w, sb.h, 9); ctx.fill();
  text(ctx, ready ? 'SERVE  (space)' : 'SERVE', sb.x + sb.w / 2, sb.y + sb.h / 2, 'bold 14px Verdana, sans-serif', '#fdf6e0');
  const tb = LAYOUT.trashBtn;
  ctx.fillStyle = '#6e3a30';
  rr(ctx, tb.x, tb.y, tb.w, tb.h, 9); ctx.fill();
  text(ctx, 'TRASH PLATE', tb.x + tb.w / 2, tb.y + tb.h / 2, 'bold 12.5px Verdana, sans-serif', 'rgba(253,246,224,0.85)');
}

function drawHud(ctx, state) {
  const g = ctx.createLinearGradient(0, 0, 0, 54);
  g.addColorStop(0, '#241118');
  g.addColorStop(1, '#170b10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAGE.width, 54);
  ctx.fillStyle = 'rgba(242,182,60,0.35)';
  ctx.fillRect(0, 53, STAGE.width, 1);
  text(ctx, `DAY ${state.day}`, 18, 27, 'bold 17px Georgia, serif', INK.cream, 'left');
  // Coin purse.
  ctx.fillStyle = INK.gold;
  ellipse(ctx, 128, 27, 11, 11); ctx.fill();
  ctx.fillStyle = '#8a5f10';
  text(ctx, '$', 128, 27.5, 'bold 12px Verdana, sans-serif', '#8a5f10');
  text(ctx, `${state.bank}`, 146, 27, 'bold 16px Verdana, sans-serif', INK.cream, 'left');
  // Goal progress.
  const gx = 250, gw = 330;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  rr(ctx, gx, 18, gw, 18, 9); ctx.fill();
  const gf = Math.min(1, state.dayEarned / state.goal);
  const gg = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  gg.addColorStop(0, '#c97b4a'); gg.addColorStop(1, INK.gold);
  ctx.fillStyle = gg;
  if (gf > 0) rr(ctx, gx, 18, Math.max(18, gw * gf), 18, 9), ctx.fill();
  text(ctx, `goal $${state.goal} · earned $${state.dayEarned}`, gx + gw / 2, 27.5, 'bold 11px Verdana, sans-serif', '#fdf6e0');
  // Day timer.
  const urgent = state.timeLeft <= 15;
  text(ctx, `⏱ ${Math.max(0, Math.ceil(state.timeLeft))}s`, 640, 27, 'bold 16px Verdana, sans-serif', urgent ? INK.bad : INK.cream);
  // Loan.
  text(ctx, `loan repaid $${state.loanRepaid} / $${LOAN_TOTAL}`, 1110, 27, '13px Verdana, sans-serif', 'rgba(246,231,200,0.8)', 'right');
  // Pause and mute.
  for (const [rect, label] of [[LAYOUT.pauseBtn, 'II'], [LAYOUT.muteBtn, state.muted ? '✕♪' : '♪']]) {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 8); ctx.fill();
    text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, 'bold 14px Verdana, sans-serif', INK.cream);
  }
}

function drawFx(ctx, state) {
  for (const fx of state.fx) {
    const age = state.t - fx.at;
    if (fx.kind === 'coin') {
      ctx.globalAlpha = Math.max(0, 1 - age / 1.1);
      text(ctx, fx.text, fx.x, fx.y - age * 44, 'bold 17px Verdana, sans-serif', INK.gold);
      ctx.globalAlpha = 1;
    } else if (fx.kind === 'sparkle') {
      ctx.globalAlpha = Math.max(0, 1 - age / 0.7);
      ctx.fillStyle = INK.gold;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + fx.seed;
        const d = age * 46;
        ellipse(ctx, fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d - age * 12, 2.6, 2.6); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (fx.kind === 'sad') {
      ctx.globalAlpha = Math.max(0, 1 - age / 1.2);
      text(ctx, fx.text, fx.x, fx.y - age * 26, 'italic 14px Georgia, serif', '#d9a0a0');
      ctx.globalAlpha = 1;
    }
  }
  if (state.toast && state.t < state.toast.until) {
    ctx.font = 'bold 14px Verdana, sans-serif';
    const w = ctx.measureText(state.toast.text).width + 34;
    ctx.fillStyle = 'rgba(20,10,8,0.82)';
    rr(ctx, (STAGE.width - w) / 2, 60, w, 30, 8); ctx.fill();
    text(ctx, state.toast.text, STAGE.width / 2, 75.5, 'bold 14px Verdana, sans-serif', '#ffd98a');
  }
}

// ---------- scene and screens ----------

function drawScene(ctx, state, t, { customers = true } = {}) {
  const progress = 1 - state.timeLeft / Math.max(1, state.daySecs);
  const wg = ctx.createLinearGradient(0, 54, 0, 300);
  wg.addColorStop(0, INK.wallTop);
  wg.addColorStop(1, INK.wallBottom);
  ctx.fillStyle = wg;
  ctx.fillRect(0, 54, STAGE.width, 392);
  // Wainscot band low on the wall.
  const wsc = ctx.createLinearGradient(0, 262, 0, 300);
  wsc.addColorStop(0, INK.wainscot);
  wsc.addColorStop(1, INK.wainscotDark);
  ctx.fillStyle = wsc;
  ctx.fillRect(0, 262, STAGE.width, 38);
  ctx.fillStyle = 'rgba(255,205,130,0.13)';
  ctx.fillRect(0, 262, STAGE.width, 2);
  // Warm spill from the oven side and a soft vignette for depth.
  const spill = ctx.createLinearGradient(900, 0, 1280, 0);
  spill.addColorStop(0, 'rgba(255,140,60,0)');
  spill.addColorStop(1, 'rgba(255,140,60,0.10)');
  ctx.fillStyle = spill;
  ctx.fillRect(0, 54, STAGE.width, 392);
  drawWindow(ctx, progress, t);
  drawShelf(ctx, t);
  drawWallDecor(ctx, state);
  drawLamps(ctx, t);
  if (customers) {
    for (const customer of state.customers) if (customer) drawCharacter(ctx, customer, t);
  }
  drawCounter(ctx);
  if (customers) {
    for (const customer of state.customers) if (customer) drawTicket(ctx, customer, state);
    for (const customer of state.customers) if (customer) drawBubble(ctx, customer);
  }
  drawCat(ctx, t);
  // Floor shadow strip between counter and workspace.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 518, STAGE.width, 6);
}

function card(ctx, w, h) {
  const x = (STAGE.width - w) / 2, y = (STAGE.height - h) / 2;
  ctx.fillStyle = 'rgba(12,5,8,0.62)';
  ctx.fillRect(0, 0, STAGE.width, STAGE.height);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  rr(ctx, x + 5, y + 7, w, h, 16); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f8ecd0');
  g.addColorStop(1, '#ecd9ae');
  ctx.fillStyle = g;
  rr(ctx, x, y, w, h, 16); ctx.fill();
  ctx.strokeStyle = INK.copperDark;
  ctx.lineWidth = 3;
  rr(ctx, x, y, w, h, 16); ctx.stroke();
  return { x, y, w, h };
}

function button(ctx, rect, label, enabled = true, primary = true) {
  const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  if (primary) {
    g.addColorStop(0, enabled ? '#c97b4a' : '#9a8874');
    g.addColorStop(1, enabled ? '#9c5a2e' : '#7a6a58');
  } else {
    g.addColorStop(0, '#6b5a49');
    g.addColorStop(1, '#4e4033');
  }
  ctx.fillStyle = g;
  rr(ctx, rect.x, rect.y, rect.w, rect.h, 11); ctx.fill();
  ctx.fillStyle = 'rgba(255,240,210,0.35)';
  rr(ctx, rect.x + 3, rect.y + 3, rect.w - 6, rect.h * 0.42, 8); ctx.fill();
  text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1, 'bold 16px Verdana, sans-serif', '#fdf6e0');
}

function drawTitle(ctx, state, t) {
  drawScene(ctx, state, t, { customers: false });
  ctx.fillStyle = 'rgba(16,7,10,0.45)';
  ctx.fillRect(0, 0, STAGE.width, STAGE.height);
  // The hanging sign.
  ctx.strokeStyle = '#1d1210';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(430, 54); ctx.lineTo(452, 118); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(850, 54); ctx.lineTo(828, 118); ctx.stroke();
  const sg = ctx.createLinearGradient(0, 118, 0, 238);
  sg.addColorStop(0, '#6e4525');
  sg.addColorStop(1, '#4a2c15');
  ctx.fillStyle = sg;
  rr(ctx, 380, 118, 520, 122, 14); ctx.fill();
  ctx.strokeStyle = INK.brass;
  ctx.lineWidth = 3;
  rr(ctx, 392, 130, 496, 98, 10); ctx.stroke();
  text(ctx, 'THE COPPER LADLE', 640, 168, 'bold 44px Georgia, serif', '#f6e7c8');
  text(ctx, 'a diner-rescue cooking game', 640, 206, 'italic 17px Georgia, serif', '#e8cf96');
  const story = [
    'Cook Rosa has twelve days to repay a $4,390 loan —',
    'or the bank takes her diner, her cat, and her copper ladle.',
  ];
  story.forEach((line, i) => text(ctx, line, 640, 292 + i * 24, '15.5px Georgia, serif', INK.cream));
  // How to play, on a chalkboard.
  const hx = 330, hy = 356, hw = 620, hh = 262;
  const hg = ctx.createLinearGradient(0, hy, 0, hy + hh);
  hg.addColorStop(0, '#31463c'); hg.addColorStop(1, '#22332b');
  ctx.fillStyle = hg;
  rr(ctx, hx, hy, hw, hh, 10); ctx.fill();
  ctx.strokeStyle = INK.woodLight;
  ctx.lineWidth = 5;
  rr(ctx, hx, hy, hw, hh, 10); ctx.stroke();
  text(ctx, 'HOW TO PLAY', 640, hy + 30, 'bold 16px Georgia, serif', '#e8cf96');
  const how = [
    '1 · Click a customer to take their order.',
    '2 · Click a pantry ingredient: it cooks at its station,',
    '     or lands straight on the plate.',
    '3 · Click the cooked item inside its golden PERFECT ring',
    '     to plate it at its best — leave it longer and it burns.',
    '4 · Build the dish layer by layer, then SERVE (or press Space).',
    '5 · Earn the day\'s goal before the timer ends. Spend the',
    '     night\'s coins in the shop. Clear the loan in 12 days!',
  ];
  how.forEach((line, i) => text(ctx, line, hx + 36, hy + 66 + i * 27, '14.5px Georgia, serif', 'rgba(246,231,200,0.94)', 'left'));
  button(ctx, LAYOUT.startBtn, 'START COOKING');
}

function drawIntro(ctx, state) {
  drawScene(ctx, state, state.t, { customers: false });
  const c = card(ctx, 560, 430);
  text(ctx, `DAY ${state.day} OF 12`, c.x + c.w / 2, c.y + 58, 'bold 34px Georgia, serif', INK.ink);
  const lines = [
    `Today's goal: earn $${state.goal} before service ends.`,
    `Loan still owed: $${LOAN_TOTAL - state.loanRepaid}.`,
    state.day === 1 ? 'The first customers are already at the door…' :
      state.day === 12 ? 'The last day. The bank manager is watching.' :
        'Word is spreading — the diner fills a little faster.',
  ];
  lines.forEach((line, i) => text(ctx, line, c.x + c.w / 2, c.y + 118 + i * 30, '16px Georgia, serif', 'rgba(43,26,18,0.85)'));
  if (state.newUnlock) {
    ctx.fillStyle = 'rgba(201,123,74,0.2)';
    rr(ctx, c.x + 70, c.y + 226, c.w - 140, 44, 9); ctx.fill();
    text(ctx, `New on the menu: ${state.newUnlock}`, c.x + c.w / 2, c.y + 248, 'bold 15px Georgia, serif', INK.copperDark);
  }
  const loanFrac = state.loanRepaid / LOAN_TOTAL;
  ctx.fillStyle = 'rgba(43,26,18,0.15)';
  rr(ctx, c.x + 70, c.y + 300, c.w - 140, 16, 8); ctx.fill();
  ctx.fillStyle = INK.copper;
  if (loanFrac > 0) rr(ctx, c.x + 70, c.y + 300, Math.max(16, (c.w - 140) * loanFrac), 16, 8), ctx.fill();
  text(ctx, `loan repaid $${state.loanRepaid} of $4,390`, c.x + c.w / 2, c.y + 308.5, 'bold 11px Verdana, sans-serif', '#fdf6e0');
  button(ctx, LAYOUT.beginBtn, 'OPEN THE DINER');
}

function drawSummary(ctx, state) {
  drawScene(ctx, state, state.t, { customers: false });
  const s = state.summary;
  const c = card(ctx, 600, 470);
  text(ctx, `DAY ${state.day} — SERVICE DONE`, c.x + c.w / 2, c.y + 54, 'bold 27px Georgia, serif', INK.ink);
  const rows = [
    ['Earned today', `$${s.earned}`],
    ['The goal was', `$${s.goal}`],
    ['Customers served', `${s.served}`],
    ['Customers who left', `${s.lost}`],
    ['Perfect components', `${s.perfects}`],
    ['Toward the loan', `$${s.earned}`],
  ];
  rows.forEach(([k, v], i) => {
    const yy = c.y + 108 + i * 34;
    text(ctx, k, c.x + 70, yy, '15.5px Georgia, serif', 'rgba(43,26,18,0.8)', 'left');
    text(ctx, v, c.x + c.w - 70, yy, 'bold 15.5px Georgia, serif', INK.ink, 'right');
  });
  text(ctx, s.metGoal ? 'Goal met — the diner survives another day.' : 'Goal missed…', c.x + c.w / 2, c.y + 330, 'italic 15.5px Georgia, serif', INK.copperDark);
  button(ctx, LAYOUT.continueBtn, state.day >= 12 ? 'SEE THE VERDICT' : 'TO THE NIGHT SHOP');
}

function drawShop(ctx, state) {
  drawScene(ctx, state, state.t, { customers: false });
  ctx.fillStyle = 'rgba(12,5,8,0.66)';
  ctx.fillRect(0, 0, STAGE.width, STAGE.height);
  text(ctx, 'THE NIGHT SHOP', 640, 74, 'bold 32px Georgia, serif', INK.cream);
  text(ctx, `Coins in the purse: $${state.bank} · Every upgrade changes the rules — none is decoration.`, 640, 108, '14.5px Georgia, serif', 'rgba(246,231,200,0.8)');
  const g = LAYOUT.shopGrid;
  UPGRADES.forEach((up, i) => {
    const col = i % g.cols, row = Math.floor(i / g.cols);
    const x = g.x + col * (g.cardW + g.gap);
    const y = g.y + row * (g.cardH + g.gap);
    const owned = state.owned.has(up.id);
    const afford = state.bank >= up.cost;
    const cg = ctx.createLinearGradient(0, y, 0, y + g.cardH);
    cg.addColorStop(0, owned ? '#476b46' : '#f8ecd0');
    cg.addColorStop(1, owned ? '#38543a' : '#ecd9ae');
    ctx.fillStyle = cg;
    rr(ctx, x, y, g.cardW, g.cardH, 12); ctx.fill();
    ctx.strokeStyle = owned ? '#7fb069' : INK.copperDark;
    ctx.lineWidth = 2.5;
    rr(ctx, x, y, g.cardW, g.cardH, 12); ctx.stroke();
    text(ctx, up.name, x + g.cardW / 2, y + 34, 'bold 16.5px Georgia, serif', owned ? '#fdf6e0' : INK.ink);
    // Wrap the description by hand into two short lines.
    const words = up.desc.split(' ');
    const lines = [''];
    for (const word of words) {
      const trial = `${lines[lines.length - 1]} ${word}`.trim();
      if (trial.length > 30 && lines[lines.length - 1]) lines.push(word);
      else lines[lines.length - 1] = trial;
    }
    lines.slice(0, 3).forEach((line, li) => text(ctx, line, x + g.cardW / 2, y + 74 + li * 22, '13.5px Georgia, serif', owned ? 'rgba(253,246,224,0.9)' : 'rgba(43,26,18,0.78)'));
    if (owned) {
      text(ctx, '✓ OWNED', x + g.cardW / 2, y + g.cardH - 34, 'bold 16px Verdana, sans-serif', '#ffd98a');
    } else {
      const bg2 = ctx.createLinearGradient(0, y + g.cardH - 58, 0, y + g.cardH - 18);
      bg2.addColorStop(0, afford ? '#c97b4a' : '#9a8874');
      bg2.addColorStop(1, afford ? '#9c5a2e' : '#7a6a58');
      ctx.fillStyle = bg2;
      rr(ctx, x + 46, y + g.cardH - 58, g.cardW - 92, 40, 9); ctx.fill();
      text(ctx, `BUY · $${up.cost}`, x + g.cardW / 2, y + g.cardH - 37, 'bold 15px Verdana, sans-serif', '#fdf6e0');
    }
  });
  if (state.shopMsg) text(ctx, state.shopMsg, 300, 742, 'italic 14px Georgia, serif', '#ffd98a', 'left');
  button(ctx, LAYOUT.shopStartBtn, state.day + 1 >= 12 ? 'START THE FINAL DAY' : `START DAY ${state.day + 1}`);
}

function drawOver(ctx, state) {
  drawScene(ctx, state, state.t, { customers: false });
  const c = card(ctx, 620, 420);
  text(ctx, 'THE BANK TAKES THE DINER', c.x + c.w / 2, c.y + 66, 'bold 28px Georgia, serif', '#8c3030');
  const lines = [
    `Day ${state.day} ended at $${state.dayEarned} of the $${state.goal} goal.`,
    'The loan officer folds her umbrella and reaches for the keys.',
    'But a day can be replayed — Rosa has done harder things.',
  ];
  lines.forEach((line, i) => text(ctx, line, c.x + c.w / 2, c.y + 128 + i * 28, '15.5px Georgia, serif', 'rgba(43,26,18,0.85)'));
  text(ctx, `Served ${state.stats.served} · Perfect components ${state.stats.perfects}`, c.x + c.w / 2, c.y + 236, '14px Georgia, serif', 'rgba(43,26,18,0.7)');
  button(ctx, LAYOUT.retryBtn, `RETRY DAY ${state.day}`);
}

function drawWin(ctx, state, t) {
  drawScene(ctx, state, t, { customers: false });
  const c = card(ctx, 640, 440);
  text(ctx, 'THE DINER IS ROSA\'S AGAIN', c.x + c.w / 2, c.y + 62, 'bold 27px Georgia, serif', INK.copperDark);
  // The golden ladle, held high.
  ctx.save();
  ctx.translate(640, c.y + 128);
  ctx.rotate(Math.sin(t * 1.3) * 0.06);
  ctx.strokeStyle = INK.brass;
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-54, 26); ctx.lineTo(30, -18); ctx.stroke();
  ctx.fillStyle = INK.gold;
  ellipse(ctx, 46, -26, 20, 13); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ellipse(ctx, 40, -30, 7, 4); ctx.fill();
  ctx.restore();
  const lines = [
    'Twelve days, one loan, zero diners lost to the bank.',
    `Total earned: $${state.totalEarned} · Customers served: ${state.stats.served}`,
    `Perfect components: ${state.stats.perfects} · Customers who left: ${state.stats.lost}`,
    'Miso the cat sleeps on. Some things never change.',
  ];
  lines.forEach((line, i) => text(ctx, line, c.x + c.w / 2, c.y + 196 + i * 28, '15.5px Georgia, serif', 'rgba(43,26,18,0.85)'));
  button(ctx, LAYOUT.continueBtn, 'PLAY AGAIN');
}

function drawPause(ctx, state) {
  ctx.fillStyle = 'rgba(12,5,8,0.6)';
  ctx.fillRect(0, 0, STAGE.width, STAGE.height);
  text(ctx, 'PAUSED', 640, 300, 'bold 40px Georgia, serif', INK.cream);
  text(ctx, 'The diner holds its breath.', 640, 340, 'italic 15px Georgia, serif', 'rgba(246,231,200,0.75)');
  button(ctx, LAYOUT.resumeBtn, 'BACK TO SERVICE');
  button(ctx, LAYOUT.restartBtn, 'RESTART THE DAY', true, false);
}

/** Create the renderer bound to a canvas. `draw(state)` paints the current frame. */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  function draw(state) {
    const t = state.t;
    ctx.clearRect(0, 0, STAGE.width, STAGE.height);
    if (state.screen === SCREEN.TITLE) { drawTitle(ctx, state, t); return; }
    if (state.screen === SCREEN.INTRO) { drawIntro(ctx, state); return; }
    if (state.screen === SCREEN.SHOP) { drawShop(ctx, state); return; }
    if (state.screen === SCREEN.SUMMARY) { drawSummary(ctx, state); return; }
    if (state.screen === SCREEN.OVER) { drawOver(ctx, state); return; }
    if (state.screen === SCREEN.WIN) { drawWin(ctx, state, t); return; }
    // Service (and pause over it).
    drawScene(ctx, state, t);
    drawPantry(ctx, state);
    drawStations(ctx, state, t);
    drawPlating(ctx, state, t);
    drawHud(ctx, state);
    drawFx(ctx, state);
    if (state.screen === SCREEN.PAUSE) drawPause(ctx, state);
  }
  return { draw };
}
