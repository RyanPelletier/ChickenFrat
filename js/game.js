/* =====================================================================
   CHICKEN FRAT — game.js
   Phase 1 (+ cosmetic/map polish pass): single map, three core clickers
   (Seed / Gym / Beer), the Chunder Clock + Party Fowl penalty, persistent
   Strength via Firestore, an animated chicken, a more built-out map
   (house + gym buildings, backyard fight ring, front lawn chairs, a
   street with wandering chicks outside the property), and beer-drunk
   movement drift.

   Not in this build yet (coming in later phases, see project README):
   picking up chicks (the ones on the street are ambient/decorative only
   for now), the functioning Cockfight Ring, cosmetics you can unlock,
   proximity chat, the slur filter, and multiplayer position sync over
   Realtime Database.

   This file knows nothing about Firebase directly — it only listens for
   `cf:authready` / `cf:signout` events from auth.js, and calls
   `queuePatch()` from player-data.js to persist Strength.
   ===================================================================== */

import { queuePatch } from "./player-data.js";

/* ==================== CONFIG — tweak freely ==================== */
const CANVAS_W = 960;
const PROPERTY_H = 600;   // house/gym/backyard/lawn area
const STREET_H = 80;      // strip below the property
const CANVAS_H = PROPERTY_H + STREET_H;

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

const DRUNK_DRIFT_THRESHOLD = 35;  // beer level above which walking-straight gets hard
const DRUNK_DRIFT_MAX = 2.6;       // px/frame of involuntary sideways stumble at max beer

const CHUNDER_COUNTDOWN_FRAMES = 10 * 60; // 10s @ ~60fps
const PARTY_FOWL_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const CHUNDER_RING_CIRCUMFERENCE = 276.5; // 2*pi*44, matches the SVG ring radius

const STATION_RADIUS = 46; // how close the player must be to interact

const STREET_CHICK_COUNT = 6;
const STREET_CHICK_SPEED = 0.6;

const DEBUG = true;
/* ==================== end config ==================== */

const COLORS = {
  house: "#FFF7E3",
  gym: "#D8D2C8",
  backyard: "#8FDB6B",
  lawn: "#A9E88C",
  wallLine: "#1F2A44",
  roof: "#B5433C",
  roofGym: "#5B6472",
  door: "#8B5A2B",
  street: "#4A4A52",
  sidewalk: "#C9C6BE",
  laneLine: "#F6C945",
  fence: "#D8CBB0",
  chickenBody: "#FFD23F",
  chickenComb: "#E8433D",
  chickenBeak: "#F2994A",
  chickenLeg: "#F2994A",
  stationRing: "#1F2A44",
  troughWood: "#8B5A2B",
  troughWoodDark: "#6B4222",
  seedFill: "#F6C945",
  kegMetal: "#C9CDD3",
  kegMetalDark: "#9AA0A8",
  kegBand: "#8B5A2B",
  kegTap: "#E8433D",
  barbellBar: "#4A4A52",
  barbellPlate: "#1F2A44",
  ringDirt: "#C79A5B",
  ringPostLocked: "#9AA0A8",
  chairSeat: "#E8433D",
  chairSeat2: "#3F8FD1"
};

/* ---------------- zones ---------------- */
const zones = [
  { key: "house", label: "Frat House Interior", x: 20, y: 20, w: 430, h: 270, color: COLORS.house, roof: COLORS.roof, sign: null },
  { key: "gym", label: "Gym", x: 510, y: 20, w: 430, h: 270, color: COLORS.gym, roof: COLORS.roofGym, sign: "GYM" },
  { key: "backyard", label: "Backyard", x: 20, y: 320, w: 430, h: 260, color: COLORS.backyard },
  { key: "lawn", label: "Front Lawn", x: 510, y: 320, w: 430, h: 260, color: COLORS.lawn }
];

/* ---------------- stations ---------------- */
const stations = [
  { id: "seed", type: "seed", x: 150, y: 160, label: "Eat Seed" },
  { id: "beer", type: "beer", x: 350, y: 160, label: "Drink Beer" },
  { id: "bathroom", type: "bathroom", x: 400, y: 250, emoji: "🚽", label: "Bathroom Stall" },
  { id: "gym", type: "gym", x: 730, y: 160, label: "Work Out" },
  { id: "cockfight", type: "locked", x: 230, y: 450, label: "Cockfight Ring — coming soon" },
  { id: "chicks", type: "locked", x: 730, y: 450, emoji: "🐥", label: "Chicks to carry — coming soon" }
];

/* ---------------- decorative front-lawn chairs (no interaction) ---------------- */
const lawnChairs = [
  { x: 610, y: 470, color: COLORS.chairSeat },
  { x: 860, y: 480, color: COLORS.chairSeat2 },
  { x: 900, y: 400, color: COLORS.chairSeat }
];

/* ---------------- wandering street chicks (ambient only, not pickup-able yet) ---------------- */
const streetChicks = [];
for (let i = 0; i < STREET_CHICK_COUNT; i++){
  streetChicks.push({
    x: 60 + Math.random() * (CANVAS_W - 120),
    y: PROPERTY_H + 24 + Math.random() * (STREET_H - 48),
    dir: Math.random() < 0.5 ? -1 : 1,
    speed: STREET_CHICK_SPEED * (0.6 + Math.random() * 0.8),
    legPhase: Math.floor(Math.random() * 100)
  });
}

/* ---------------- state ---------------- */
let canvas, ctx;
let stationBtn, chunderClockEl, chunderRingFg, chunderSecondsEl;
let partyFowlBanner, partyFowlTimerEl;

let uid = null;
let running = false;
let animId = null;
let tick = 0;
let drunkPhase = 0;

let player = { x: 150, y: 110, moving: false };
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
  player.x = 150;
  player.y = 110;
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

  const moving = dx !== 0 || dy !== 0;
  player.moving = moving;
  if (dx !== 0 && dy !== 0){ dx *= 0.7071; dy *= 0.7071; }

  const speed = BASE_SPEED * currentSpeedMultiplier();
  let moveX = dx * speed;
  let moveY = dy * speed;

  // beer makes walking a straight line genuinely hard, not just cosmetic wobble
  if (moving && stats.beerLevel > DRUNK_DRIFT_THRESHOLD){
    drunkPhase += 0.14;
    const driftFrac = (stats.beerLevel - DRUNK_DRIFT_THRESHOLD) / (BEER_MAX - DRUNK_DRIFT_THRESHOLD);
    const driftMag = driftFrac * DRUNK_DRIFT_MAX;
    moveX += Math.sin(drunkPhase) * driftMag;
    moveY += Math.cos(drunkPhase * 0.8) * driftMag * 0.6;
  }

  player.x = Math.min(CANVAS_W - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, player.x + moveX));
  player.y = Math.min(PROPERTY_H - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, player.y + moveY));
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
  const bathroom = stations.find(s => s.type === "bathroom");
  const nearBathroom = Math.hypot(player.x - bathroom.x, player.y - bathroom.y) < STATION_RADIUS;
  if (nearBathroom){ resolveChunderSuccess(); return; }
  chunderFramesLeft--;
  if (chunderFramesLeft <= 0) triggerPartyFowl();
}

/* ==================== per-frame stat decay ==================== */
function updateStatDecay(){
  if (stats.strengthBoost > 0) stats.strengthBoost = Math.max(0, stats.strengthBoost - STRENGTH_BOOST_DECAY_PER_FRAME);
  if (!chunderActive && stats.beerLevel > 0) stats.beerLevel = Math.max(0, stats.beerLevel - BEER_LEVEL_DECAY_PER_FRAME);
}

/* ==================== street chicks (ambient) ==================== */
function updateStreetChicks(){
  streetChicks.forEach(c => {
    c.x += c.dir * c.speed;
    c.legPhase++;
    if (c.x < 30){ c.x = 30; c.dir = 1; }
    if (c.x > CANVAS_W - 30){ c.x = CANVAS_W - 30; c.dir = -1; }
    if (Math.random() < 0.004) c.dir *= -1; // occasional aimless turn
  });
}

/* ==================== update / draw ==================== */
function update(){
  tick++;
  updateMovement();
  nearestStation = findNearestStation();
  updateChunder();
  updateStatDecay();
  updateStreetChicks();
}

function draw(){
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawStreet();

  zones.forEach(z => {
    ctx.fillStyle = z.color;
    ctx.fillRect(z.x, z.y, z.w, z.h);
  });
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 3;
  zones.forEach(z => ctx.strokeRect(z.x, z.y, z.w, z.h));

  zones.forEach(z => { if (z.roof) drawBuildingTopper(z); });

  ctx.font = "700 13px 'Baloo 2', sans-serif";
  ctx.fillStyle = COLORS.wallLine;
  ctx.globalAlpha = 0.55;
  zones.forEach(z => ctx.fillText(z.label, z.x + 10, z.y + 20));
  ctx.globalAlpha = 1;

  lawnChairs.forEach(drawLawnChair);
  stations.forEach(drawStation);
  drawPlayer();
}

/* ---------------- street + wandering chicks ---------------- */
function drawStreet(){
  ctx.fillStyle = COLORS.sidewalk;
  ctx.fillRect(0, PROPERTY_H, CANVAS_W, 14);

  ctx.fillStyle = COLORS.street;
  ctx.fillRect(0, PROPERTY_H + 14, CANVAS_W, STREET_H - 14);

  // dashed lane line
  ctx.strokeStyle = COLORS.laneLine;
  ctx.lineWidth = 4;
  ctx.setLineDash([26, 18]);
  ctx.beginPath();
  ctx.moveTo(0, PROPERTY_H + 14 + (STREET_H - 14) / 2);
  ctx.lineTo(CANVAS_W, PROPERTY_H + 14 + (STREET_H - 14) / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // low picket fence separating yard from sidewalk
  ctx.fillStyle = COLORS.fence;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 1.5;
  for (let x = 6; x < CANVAS_W; x += 22){
    ctx.fillRect(x, PROPERTY_H - 14, 8, 16);
    ctx.strokeRect(x, PROPERTY_H - 14, 8, 16);
  }

  streetChicks.forEach(drawStreetChick);
}

function drawStreetChick(c){
  const legOffset = Math.floor(c.legPhase / 8) % 2 === 0 ? 2 : -2;
  ctx.fillStyle = COLORS.chickenLeg;
  ctx.fillRect(c.x - 3, c.y + 5, 2, 4 + legOffset * 0.3);
  ctx.fillRect(c.x + 2, c.y + 5, 2, 4 - legOffset * 0.3);

  ctx.fillStyle = COLORS.chickenBody;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  const facing = c.dir >= 0 ? 1 : -1;
  ctx.moveTo(c.x + facing * 6, c.y);
  ctx.lineTo(c.x + facing * 11, c.y + 1.5);
  ctx.lineTo(c.x + facing * 6, c.y + 3);
  ctx.closePath();
  ctx.fill();
}

/* ---------------- building toppers (roof + signage) ---------------- */
function drawBuildingTopper(z){
  const roofHeight = 26;
  ctx.fillStyle = z.roof;
  ctx.beginPath();
  ctx.moveTo(z.x - 6, z.y);
  ctx.lineTo(z.x + z.w / 2, z.y - roofHeight);
  ctx.lineTo(z.x + z.w + 6, z.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (z.sign){
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 12px 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(z.sign, z.x + z.w / 2, z.y - 8);
    ctx.textAlign = "left";
  }

  // door connecting to the yard below
  ctx.fillStyle = COLORS.door;
  ctx.fillRect(z.x + z.w / 2 - 16, z.y + z.h - 4, 32, 4);
}

/* ---------------- decorative lawn chairs ---------------- */
function drawLawnChair(c){
  ctx.fillStyle = COLORS.troughWoodDark;
  ctx.fillRect(c.x - 10, c.y + 10, 4, 10);
  ctx.fillRect(c.x + 10, c.y + 10, 4, 10);

  ctx.fillStyle = c.color;
  ctx.fillRect(c.x - 12, c.y - 2, 26, 12);   // seat
  ctx.fillRect(c.x - 12, c.y - 20, 26, 18);  // backrest
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(c.x - 12, c.y - 2, 26, 12);
  ctx.strokeRect(c.x - 12, c.y - 20, 26, 18);
}

/* ---------------- stations ---------------- */
function drawStation(s){
  if (s.type === "seed") return drawTrough(s);
  if (s.type === "beer") return drawKeg(s);
  if (s.type === "gym") return drawGymRack(s);
  if (s.type === "cockfight" || s.id === "cockfight") return drawFightRing(s);
  return drawGenericStation(s);
}

function drawGenericStation(s){
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
  ctx.fillText(s.emoji || "?", s.x, s.y + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawTrough(s){
  const { x, y } = s;
  ctx.fillStyle = COLORS.troughWoodDark;
  ctx.beginPath();
  ctx.moveTo(x - 34, y + 6);
  ctx.lineTo(x + 34, y + 6);
  ctx.lineTo(x + 28, y + 18);
  ctx.lineTo(x - 28, y + 18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.troughWood;
  ctx.beginPath();
  ctx.moveTo(x - 36, y - 10);
  ctx.lineTo(x + 36, y - 10);
  ctx.lineTo(x + 30, y + 8);
  ctx.lineTo(x - 30, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.stroke();

  // seed mound
  ctx.fillStyle = COLORS.seedFill;
  ctx.beginPath();
  ctx.ellipse(x, y - 6, 24, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#C9922A";
  for (let i = -3; i <= 3; i++){
    ctx.beginPath();
    ctx.arc(x + i * 6, y - 6 + (i % 2 === 0 ? -1 : 2), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawKeg(s){
  const { x, y } = s;
  ctx.fillStyle = COLORS.kegMetal;
  ctx.fillRect(x - 18, y - 26, 36, 46);
  ctx.beginPath();
  ctx.ellipse(x, y - 26, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 18, y - 26, 36, 46);

  ctx.fillStyle = COLORS.kegBand;
  ctx.fillRect(x - 18, y - 14, 36, 5);
  ctx.fillRect(x - 18, y + 6, 36, 5);

  // tap
  ctx.fillStyle = COLORS.kegTap;
  ctx.fillRect(x + 12, y - 6, 12, 6);
  ctx.beginPath();
  ctx.arc(x + 26, y - 3, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawGymRack(s){
  const { x, y } = s;
  // A-frame rack
  ctx.strokeStyle = COLORS.barbellBar;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x - 26, y + 20);
  ctx.lineTo(x - 8, y - 18);
  ctx.moveTo(x + 26, y + 20);
  ctx.lineTo(x + 8, y - 18);
  ctx.stroke();

  // barbell resting on the rack
  ctx.strokeStyle = COLORS.barbellBar;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 30, y - 16);
  ctx.lineTo(x + 30, y - 16);
  ctx.stroke();

  ctx.fillStyle = COLORS.barbellPlate;
  [-30, -24, 24, 30].forEach((dx, i) => {
    const r = i === 0 || i === 3 ? 12 : 9;
    ctx.beginPath();
    ctx.arc(x + dx, y - 16, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawFightRing(s){
  const { x, y } = s;
  const r = 34;
  ctx.fillStyle = COLORS.ringDirt;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const posts = 6;
  ctx.fillStyle = COLORS.ringPostLocked;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 1.5;
  const postPoints = [];
  for (let i = 0; i < posts; i++){
    const a = (i / posts) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r * 0.62;
    postPoints.push([px, py]);
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  postPoints.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🔒", x, y + 5);
  ctx.textAlign = "left";
}

/* ---------------- player ---------------- */
function drawPlayer(){
  const wobble = stats.beerLevel > 40 ? Math.sin(Date.now() / 90) * (stats.beerLevel / 100) * 4 : 0;
  const x = player.x + wobble;
  const y = player.y;

  // legs — animate a walk cycle while moving, planted while idle
  const legSwing = player.moving ? (Math.floor(tick / 6) % 2 === 0 ? 5 : -5) : 0;
  ctx.strokeStyle = COLORS.chickenLeg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + PLAYER_RADIUS * 0.7);
  ctx.lineTo(x - 6 + legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 10);
  ctx.moveTo(x + 6, y + PLAYER_RADIUS * 0.7);
  ctx.lineTo(x + 6 - legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 10);
  ctx.stroke();
  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  ctx.ellipse(x - 6 + legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 11, 4, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 6 - legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 11, 4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  ctx.fillStyle = COLORS.chickenBody;
  ctx.beginPath();
  ctx.ellipse(x, y, PLAYER_RADIUS, PLAYER_RADIUS * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(31,42,68,0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // wing detail
  ctx.fillStyle = "rgba(31,42,68,0.12)";
  ctx.beginPath();
  ctx.ellipse(x - 4, y + 2, 8, 11, -0.3, 0, Math.PI * 2);
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
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  ctx = canvas.getContext("2d");
  stationBtn = document.getElementById("station-action-btn");
  chunderClockEl = document.getElementById("chunder-clock");
  chunderRingFg = document.getElementById("chunder-ring-fg");
  chunderSecondsEl = document.getElementById("chunder-seconds");
  partyFowlBanner = document.getElementById("party-fowl-banner");
  partyFowlTimerEl = document.getElementById("party-fowl-timer");

  stationBtn.addEventListener("click", triggerStationAction);

  draw(); // paint the world once even before auth resolves
  if (DEBUG) console.log("[ChickenFrat] game.js loaded — Phase 1 build (map/cosmetics polish)");
}

document.addEventListener("DOMContentLoaded", initGame);
