// Boot: wire the canvas, the state machine, the renderer and the audio together, run the
// frame loop, and — when the page is opened with ?shot=<scene> — stage that scene instead
// of starting a live game, freeze it, and raise window.__shotReady for the screenshot tool.

import { STAGE } from './config.js';
import { createAudio } from './audio.js';
import { createGame, createSilentAudio } from './game.js';
import { createRenderer } from './render.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed') ?? '7') || 7;

const audio = shotName ? createSilentAudio() : createAudio();
const game = createGame(seed, audio);
const renderer = createRenderer(canvas);

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = STAGE.width * dpr;
  canvas.height = STAGE.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

function toStage(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * STAGE.width,
    y: ((event.clientY - rect.top) / rect.height) * STAGE.height,
  };
}

canvas.addEventListener('pointerdown', (event) => {
  const { x, y } = toStage(event);
  game.click(x, y);
  renderer.draw(game.state);
});
window.addEventListener('keydown', (event) => {
  if (event.key === ' ') event.preventDefault();
  game.key(event.key);
  renderer.draw(game.state);
});

if (shotName) {
  stageShot(game, shotName);
  renderer.draw(game.state);
  window.__shotReady = true;
  window.__ladle = game;
} else {
  let last = performance.now();
  let announced = '';
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    renderer.draw(game.state);
    const line = `Day ${game.state.day}, ${game.state.screen}, $${game.state.bank} in the purse.`;
    if (line !== announced) {
      announced = line;
      if (status) status.textContent = line;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__ladle = game;
}
