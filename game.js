/* =====================================================================
   CHICKEN FRAT — game.js
   Phase 1: single map, three core clickers (Seed / Gym / Beer), the
   Chunder Clock + Party Fowl penalty, persistent Strength via Firestore.

   Not in this build yet (coming in later phases, see project README):
   picking up chicks, the Cockfight Ring, cosmetics, proximity chat,
   the slur filter, and multiplayer position sync over Realtime Database.
   Their map zones/signposts are drawn now so the world reads as whole,
   but they don't do anything yet.

   This file knows nothing about Firebase directly — it only listens for
   `cf:authready` / `cf:signout` events from auth.js, and calls
   `queuePatch()` from player-data.js to persist Strength.
   ===================================================================== */

import { queuePatch } from "./player-data.js";

/* ==================== CONFIG — tweak freely ==================== */
const CANVAS_W = 960;
const CANVAS_H = 600;

const PLAYER_RADIUS = 16;
const BASE_SPEED = 3.2;
const MAX_BEER_SPEED_PENALTY_FRACTION = 0.65; // at max beer, you're this much slower

const PROTEIN_MAX = 100;
const EAT_SEED_GAIN = 8;

const GYM_CONVERT_PER_TAP = 6; // protein consumed -> baseStrength gained, 1:1

const BEER_MAX = 100;
const DRINK_GAIN = 18;
const STRENGTH_BOOST_PER_DRINK = 14;
const STRENGTH_BOOST_CAP = 120;
const STRENGTH_BOOST_DECAY_PER_FRAME = 0.05;
const BEER_LEVEL_DECAY_PER_FRAME = 0.03; // slow natural sobering-up

const CHUNDER_COUNTDOWN_FRAMES = 10 * 60; // 10s @ ~60fps
const PARTY_FOWL_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const CHUNDER_RING_CIRCUMFERENCE = 276.5; // 2*pi*44, matches the SVG ring radius

const STATION_RADIUS = 46; // how close the player must be to interact

const DEBUG = true;
/* ==================== end config ==================== */

const COLORS = {
  house: "#FFF7E3",
  gym: "#D8D2C8",
  backyard: "#8FDB6B",
  lawn: "#A9E88C",
  wallLine: "#1F2A44",
  chickenBody: "#FFD23F",
  chickenComb: "#E8433D",
  chickenBeak: "#F2994A",
  stationRing: "#1F2A44"
};

/* ---------------- zones ---------------- */
const zones = [
  { key: "house", label: "Frat House Interior", x: 0, y: 0, w: 480, h: 300, color: COLORS.house },
  { key: "gym", label: "Gym", x: 480, y: 0, w: 480, h: 300, color: COLORS.gym },
  { key: "backyard", label: "Backyard", x: 0, y: 300, w: 480, h: 300, color: COLORS.backyard },
  { key: "lawn", label: "Front Lawn", x: 480, y: 300, w: 480, h: 300, color: COLORS.lawn }
];

/* ---------------- stations ---------------- */
const stations = [
  { id: "seed", type: "seed", x: 150, y: 150, emoji: "🌾", label: "Eat Seed" },
  { id: "beer", type: "beer", x: 360, y: 150, emoji: "🍺", label: "Drink Beer" },
  { id: "bathroom", type: "bathroom", x: 440, y: 260, emoji: "🚽", label: "Bathroom Stall" },
  { id: "gym", type: "gym", x: 720, y: 150, emoji: "🏋️", label: "Work Out" },
  { id: "cockfight", type: "locked", x: 200, y: 460, emoji: "🐓", label: "Cockfight Ring — coming soon" },
  { id: "chicks", type: "locked", x: 760, y: 460, emoji: "🐥", label: "Chicks to carry — coming soon" }
];

/* ---------------- state ---------------- */
let canvas, ctx;
let stationBtn, chunderClockEl, chunderRingFg, chunderSecondsEl;
let partyFowlBanner, partyFowlTimerEl;

let uid = null;
let running = false;
let animId = null;

let player = { x: 240, y: 150, };
const keys = new Set();

let stats = {
  protein: 0,
  baseStrength: 0,
  strengthBoost: 0,
  beerLevel: 0
};

let chunderActive = false;
let chunderFramesLeft = 0;
let partyFowlUntil = 0; // epoch ms, 0 = not locked
let nearestStation = null;

/* ==================== lifecycle ==================== */

function resetForNewSession(playerData){
  stats.protein = 0;
  stats.strengthBoost = 0;
  stats.beerLevel = 0;
  stats.baseStrength = (playerData && playerData.baseStrength) || 0;
  chunderActive = false;
  chunderFramesLeft = 0;
  partyFowlUntil = 0;
  player.x = 240;
  player.y = 150;
}

window.addEventListener("cf:authready", (e) => {
  uid = e.detail.uid;
  resetForNewSession(e.detail.playerData);
  startLoop();
  if (DEBUG) console.log("[ChickenFrat] session ready for", e.detail.displayName);
});

window.addEventListener("cf:signout", () => {
  uid = null;
  stopLoop();
});

/* ==================== input ==================== */
const MOVE_KEYS = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD"]);

document.addEventListener("keydown", (e) => {
  if (MOVE_KEYS.has(e.code)) { keys.add(e.code); e.preventDefault(); }
  if (e.code === "Space"){ e.preventDefault(); triggerStationAction(); }
});
document.addEventListener("keyup", (e) => {
  if (MOVE_KEYS.has(e.code)) keys.delete(e.code);
});

function currentSpeedMultiplier(){
  const penalty = (stats.beerLevel / BEER_MAX) * MAX_BEER_SPEED_PENALTY_FRACTION;
  return Math.max(0.25, 1 - penalty);
}

function updateMovement(){
  let dx = 0, dy = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;

  if (dx !== 0 && dy !== 0){ dx *= 0.7071; dy *= 0.7071; }

  const speed = BASE_SPEED * currentSpeedMultiplier();
  player.x = Math.min(CANVAS_W - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, player.x + dx * speed));
  player.y = Math.min(CANVAS_H - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, player.y + dy * speed));
}

/* ==================== stations ==================== */
function findNearestStation(){
  let best = null, bestDist = Infinity;
  for (const s of stations){
    const d = Math.hypot(player.x - s.x, player.y - s.y);
    if (d < STATION_RADIUS && d < bestDist){ best = s; bestDist = d; }
  }
  return best;
}

function stationButtonLabel(s){
  if (s.type === "locked") return s.label;
  if (s.type === "seed") return "Tap to eat seed";
  if (s.type === "gym") return stats.protein > 0 ? "Tap to lift" : "Nothing to lift — eat seed first";
  if (s.type === "beer") return partyFowlUntil > Date.now() ? "Locked — you're in the doghouse" : "Tap to chug";
  if (s.type === "bathroom") return chunderActive ? "You made it — hurl in peace" : "Bathroom stall";
  return s.label;
}

function triggerStationAction(){
  if (!running || !nearestStation) return;
  const s = nearestStation;

  if (s.type === "seed"){
    stats.protein = Math.min(PROTEIN_MAX, stats.protein + EAT_SEED_GAIN);
  }else if (s.type === "gym"){
    if (stats.protein <= 0) return; // no gains without seed, per the brief
    const gain = Math.min(GYM_CONVERT_PER_TAP, stats.protein);
    stats.protein -= gain;
    stats.baseStrength += gain;
    queuePatch({ baseStrength: stats.baseStrength });
    if (DEBUG) console.log("[ChickenFrat] gained strength:", gain, "-> total", stats.baseStrength);
  }else if (s.type === "beer"){
    if (partyFowlUntil > Date.now()) return; // locked out
    if (chunderActive) return; // no more chugging mid-countdown
    stats.beerLevel = Math.min(BEER_MAX, stats.beerLevel + DRINK_GAIN);
    stats.strengthBoost = Math.min(STRENGTH_BOOST_CAP, stats.strengthBoost + STRENGTH_BOOST_PER_DRINK);
    if (stats.beerLevel >= BEER_MAX) startChunderClock();
  }
  // "bathroom" and "locked" stations have no tap action — bathroom resolves automatically below
}

/* ==================== chunder clock / party fowl ==================== */
function startChunderClock(){
  chunderActive = true;
  chunderFramesLeft = CHUNDER_COUNTDOWN_FRAMES;
  if (DEBUG) console.log("[ChickenFrat] Chunder Clock started — get to the bathroom");
}

function resolveChunderSuccess(){
  chunderActive = false;
  stats.beerLevel = 20;
  stats.strengthBoost = Math.min(stats.strengthBoost, STRENGTH_BOOST_PER_DRINK);
  if (DEBUG) console.log("[ChickenFrat] made it to the bathroom in time");
}

function triggerPartyFowl(){
  chunderActive = false;
  stats.beerLevel = 0;
  stats.strengthBoost = 0;
  partyFowlUntil = Date.now() + PARTY_FOWL_LOCKOUT_MS;
  if (DEBUG) console.log("[ChickenFrat] PARTY FOWL — beer locked for 5 minutes");
}

function updateChunder(){
  if (!chunderActive) return;
  const nearBathroom = Math.hypot(player.x - 440, player.y - 260) < STATION_RADIUS;
  if (nearBathroom){ resolveChunderSuccess(); return; }
  chunderFramesLeft--;
  if (chunderFramesLeft <= 0) triggerPartyFowl();
}

/* ==================== per-frame stat decay ==================== */
function updateStatDecay(){
  if (stats.strengthBoost > 0) stats.strengthBoost = Math.max(0, stats.strengthBoost - STRENGTH_BOOST_DECAY_PER_FRAME);
  if (!chunderActive && stats.beerLevel > 0) stats.beerLevel = Math.max(0, stats.beerLevel - BEER_LEVEL_DECAY_PER_FRAME);
}

/* ==================== update / draw ==================== */
function update(){
  updateMovement();
  nearestStation = findNearestStation();
  updateChunder();
  updateStatDecay();
}

function draw(){
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  zones.forEach(z => {
    ctx.fillStyle = z.color;
    ctx.fillRect(z.x, z.y, z.w, z.h);
  });
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 3;
  zones.forEach(z => ctx.strokeRect(z.x, z.y, z.w, z.h));

  ctx.font = "700 13px 'Baloo 2', sans-serif";
  ctx.fillStyle = COLORS.wallLine;
  ctx.globalAlpha = 0.55;
  zones.forEach(z => ctx.fillText(z.label, z.x + 10, z.y + 20));
  ctx.globalAlpha = 1;

  stations.forEach(drawStation);
  drawPlayer();
}

function drawStation(s){
  const locked = s.type === "locked";
  ctx.beginPath();
  ctx.arc(s.x, s.y, 22, 0, Math.PI * 2);
  ctx.fillStyle = locked ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.85)";
  ctx.fill();
  ctx.strokeStyle = COLORS.stationRing;
  ctx.lineWidth = 3;
  ctx.setLineDash(locked ? [4, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s.emoji, s.x, s.y + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawPlayer(){
  const wobble = stats.beerLevel > 40 ? Math.sin(Date.now() / 90) * (stats.beerLevel / 100) * 4 : 0;
  const x = player.x + wobble;
  const y = player.y;

  // body
  ctx.fillStyle = COLORS.chickenBody;
  ctx.beginPath();
  ctx.ellipse(x, y, PLAYER_RADIUS, PLAYER_RADIUS * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();

  // comb
  ctx.fillStyle = COLORS.chickenComb;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - PLAYER_RADIUS + 2);
  ctx.lineTo(x - 2, y - PLAYER_RADIUS - 8);
  ctx.lineTo(x + 2, y - PLAYER_RADIUS + 2);
  ctx.lineTo(x + 6, y - PLAYER_RADIUS - 6);
  ctx.lineTo(x + 9, y - PLAYER_RADIUS + 3);
  ctx.closePath();
  ctx.fill();

  // beak
  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  ctx.moveTo(x + PLAYER_RADIUS - 4, y);
  ctx.lineTo(x + PLAYER_RADIUS + 8, y + 3);
  ctx.lineTo(x + PLAYER_RADIUS - 4, y + 7);
  ctx.closePath();
  ctx.fill();
}

/* ==================== HUD sync ==================== */
function syncHud(){
  document.getElementById("meter-protein-fill").style.width = (stats.protein / PROTEIN_MAX * 100) + "%";
  document.getElementById("meter-protein-value").textContent = Math.floor(stats.protein);

  document.getElementById("meter-beer-fill").style.width = (stats.beerLevel / BEER_MAX * 100) + "%";
  document.getElementById("meter-beer-value").textContent = Math.floor(stats.beerLevel);

  const totalStrength = Math.floor(stats.baseStrength + stats.strengthBoost);
  document.getElementById("meter-strength-value").textContent = totalStrength;

  // station action button
  if (nearestStation){
    stationBtn.hidden = false;
    stationBtn.textContent = stationButtonLabel(nearestStation);
    stationBtn.style.left = nearestStation.x + "px";
    stationBtn.style.top = nearestStation.y + "px";
    stationBtn.disabled = nearestStation.type === "locked";
  }else{
    stationBtn.hidden = true;
  }

  // chunder clock
  if (chunderActive){
    chunderClockEl.hidden = false;
    chunderClockEl.style.left = (player.x - 37) + "px";
    chunderClockEl.style.top = (player.y - 100) + "px";
    const frac = chunderFramesLeft / CHUNDER_COUNTDOWN_FRAMES;
    chunderRingFg.style.strokeDashoffset = String(CHUNDER_RING_CIRCUMFERENCE * (1 - frac));
    chunderSecondsEl.textContent = Math.ceil(chunderFramesLeft / 60);
  }else{
    chunderClockEl.hidden = true;
  }

  // party fowl banner
  const msLeft = partyFowlUntil - Date.now();
  if (msLeft > 0){
    partyFowlBanner.hidden = false;
    const totalSec = Math.ceil(msLeft / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = String(totalSec % 60).padStart(2, "0");
    partyFowlTimerEl.textContent = `${mm}:${ss}`;
  }else{
    partyFowlBanner.hidden = true;
  }
}

/* ==================== loop ==================== */
function frame(){
  if (!running) return;
  update();
  draw();
  syncHud();
  animId = requestAnimationFrame(frame);
}

function startLoop(){
  running = true;
  if (!animId) frame();
}

function stopLoop(){
  running = false;
  if (animId){ cancelAnimationFrame(animId); animId = null; }
}

/* ==================== init ==================== */
function initGame(){
  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d");
  stationBtn = document.getElementById("station-action-btn");
  chunderClockEl = document.getElementById("chunder-clock");
  chunderRingFg = document.getElementById("chunder-ring-fg");
  chunderSecondsEl = document.getElementById("chunder-seconds");
  partyFowlBanner = document.getElementById("party-fowl-banner");
  partyFowlTimerEl = document.getElementById("party-fowl-timer");

  stationBtn.addEventListener("click", triggerStationAction);

  draw(); // paint the world once even before auth resolves
  if (DEBUG) console.log("[ChickenFrat] game.js loaded — Phase 1 build");
}

document.addEventListener("DOMContentLoaded", initGame);
