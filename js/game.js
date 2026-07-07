/* =====================================================================
   CHICKEN FRAT — game.js
   Map v2: House (more house-shaped, with a chimney + windows) sits in a
   middle column with Backyard above it and Front Lawn below; Gym is a
   full-height column on the right; a Forest full of wandering wolves
   fills the left column, with a Jail cage inset into it; the Street
   still runs along the bottom. Ten cosmetic chicks still wander/roam
   and can be picked up and carried to the house for Clout.

   TWO WAYS TO END UP IN TROUBLE:
   1. The original Party Fowl rules (Chunder Clock timeout, or bringing
      the same chick to the house twice within 5 minutes) — 5 minute
      beer lockout.
   2. NEW: rack up 3 Party Fowls within a rolling 5-minute window and
      you get hauled off to Jail for 60 seconds — movement is frozen
      there, carried chicks are released back to the wild.

   WOLVES: wandering the Forest. Walk into one and it resolves instantly
   based on your total Strength (base + beer boost) vs. the wolf's own
   strength: win and you gain Clout, lose and you take a Strength hit,
   lose badly (wildly outmatched) and your Strength is wiped to zero.

   Not in this build yet (see project README): the functioning Cockfight
   Ring, unlockable player cosmetics, proximity chat, the slur filter,
   Sloppy Mac, and multiplayer position sync over Realtime Database.

   This file knows nothing about Firebase directly — it only listens for
   `cf:authready` / `cf:signout` events from auth.js, and calls
   `queuePatch()` from player-data.js to persist Strength/Clout.
   ===================================================================== */

import { queuePatch } from "./player-data.js";
import { initMultiplayer, stopMultiplayer, updateLocalPresence, sendChatMessage, getOtherPlayers, isMultiplayerAvailable } from "./multiplayer.js";

/* ==================== CONFIG — tweak freely ==================== */
const CANVAS_W = 960;
const PROPERTY_H = 600;   // forest/backyard/house/lawn/gym area
const STREET_H = 80;      // strip below the property
const CANVAS_H = PROPERTY_H + STREET_H;

const PLAYER_RADIUS = 16;
const BASE_SPEED = 3.2;
const MAX_BEER_SPEED_PENALTY_FRACTION = 0.65;

const PROTEIN_MAX = 100;
const EAT_SEED_GAIN = 8;
const GYM_CONVERT_PER_TAP = 6;

const BEER_MAX = 100;
const DRINK_GAIN = 18;
const STRENGTH_BOOST_PER_DRINK = 14;
const STRENGTH_BOOST_CAP = 120;
const STRENGTH_BOOST_DECAY_PER_FRAME = 0.05;
const BEER_LEVEL_DECAY_PER_FRAME = 0.03;

const DRUNK_DRIFT_THRESHOLD = 35;
const DRUNK_DRIFT_MAX = 2.6;

const CHUNDER_COUNTDOWN_FRAMES = 10 * 60;
const PARTY_FOWL_LOCKOUT_MS = 5 * 60 * 1000;
const CHUNDER_RING_CIRCUMFERENCE = 276.5;

const STATION_RADIUS = 46;
const CHICK_PICKUP_RADIUS = 36;

const CARRY_BASE_CAPACITY = 1;
const CARRY_STRENGTH_PER_SLOT = 50;
const CARRY_MAX_CAPACITY = 4;

const CLOUT_PER_CHICK = 15;
const CHICK_REPEAT_COOLDOWN_MS = 5 * 60 * 1000;

const CHICK_WANDER_MIN_FRAMES = 90;
const CHICK_WANDER_MAX_FRAMES = 220;
const CHICK_WANDER_SPEED_MIN = 0.35;
const CHICK_WANDER_SPEED_MAX = 0.85;

const TOAST_LIFESPAN_FRAMES = 75;

// jail
const JAIL_FOWL_THRESHOLD = 3;      // this many Party Fowls...
const JAIL_WINDOW_MS = 5 * 60 * 1000; // ...within this window...
const JAIL_LOCKOUT_MS = 60 * 1000;    // ...gets you this long in jail

// wolves
const WOLF_COUNT = 5;
const WOLF_MIN_STRENGTH = 35;
const WOLF_MAX_STRENGTH = 90;
const WOLF_CONTACT_RADIUS = 24;
const CLOUT_PER_WOLF_WIN = 25;
const WOLF_STRENGTH_LOSS = 15;
const WOLF_DEATH_THRESHOLD_FRACTION = 0.4; // outmatched by this much = wiped, not just hurt
const WOLF_ENCOUNTER_COOLDOWN_FRAMES = 100;
const WOLF_WANDER_MIN_FRAMES = 100;
const WOLF_WANDER_MAX_FRAMES = 260;

const CHAT_BUBBLE_LIFESPAN_MS = 6000;
const MAX_CHAT_VISIBLE_DISTANCE = 260; // beyond this, another player's speech bubble is fully faded

const DEBUG = true;
/* ==================== end config ==================== */

const COLORS = {
  house: "#FFF7E3",
  gym: "#D8D2C8",
  backyard: "#8FDB6B",
  lawn: "#A9E88C",
  forest: "#3E6B37",
  forestTreeDark: "#2F5C2A",
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
  kegBand: "#8B5A2B",
  kegTap: "#E8433D",
  barbellBar: "#4A4A52",
  barbellPlate: "#1F2A44",
  ringDirt: "#C79A5B",
  ringPostLocked: "#9AA0A8",
  chairSeat: "#E8433D",
  chairSeat2: "#3F8FD1",
  cloutGreen: "#1B7A4A",
  fowlRed: "#E8433D",
  jailStone: "#8B8F98",
  jailBars: "#3A3A42",
  wolfBody: "#6B6B75",
  wolfDark: "#4A4A52",
  wolfEye: "#E8433D",
  remoteChicken: "#F2994A",
  chatBubbleBg: "#FFFFFF"
};

/* ---------------- grid layout ----------------
   Left column:  Forest (with Jail inset)
   Middle column: Backyard (top) / House (mid) / Front Lawn (bottom)
   Right column: Gym (full height)
   ------------------------------------------------------------------ */
const FOREST_RECT = { x: 20, y: 20, w: 280, h: 570 };
const JAIL_RECT    = { x: 70, y: 240, w: 180, h: 130 };

const zones = [
  { key: "backyard", label: "Backyard",            x: 320, y: 20,  w: 320, h: 170, color: COLORS.backyard },
  { key: "house",    label: "Frat House Interior",  x: 320, y: 210, w: 320, h: 190, color: COLORS.house, roof: COLORS.roof, house: true },
  { key: "lawn",     label: "Front Lawn",           x: 320, y: 420, w: 320, h: 170, color: COLORS.lawn },
  { key: "gym",      label: "Gym",                  x: 660, y: 20,  w: 280, h: 570, color: COLORS.gym, roof: COLORS.roofGym, sign: "GYM" }
];
const HOUSE_ZONE = zones.find(z => z.key === "house");

/* ---------------- stations ---------------- */
const stations = [
  { id: "seed", type: "seed", x: 390, y: 270, label: "Eat Seed" },
  { id: "beer", type: "beer", x: 560, y: 270, label: "Drink Beer" },
  { id: "bathroom", type: "bathroom", x: 590, y: 370, emoji: "🚽", label: "Bathroom Stall" },
  { id: "gym", type: "gym", x: 800, y: 300, label: "Work Out" },
  { id: "cockfight", type: "locked", x: 480, y: 100, label: "Cockfight Ring — coming soon" }
];

/* ---------------- decorative front-lawn chairs ---------------- */
const lawnChairs = [
  { x: 390, y: 480, color: COLORS.chairSeat },
  { x: 560, y: 490, color: COLORS.chairSeat2 },
  { x: 480, y: 540, color: COLORS.chairSeat }
];

/* ---------------- helpers ---------------- */
function pointInRect(p, r){
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}
function randomPointInRect(r){
  return { x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h };
}
function randomForestPoint(){
  let p, tries = 0;
  do{
    p = { x: FOREST_RECT.x + 20 + Math.random() * (FOREST_RECT.w - 40), y: FOREST_RECT.y + 20 + Math.random() * (FOREST_RECT.h - 40) };
    tries++;
  } while (pointInRect(p, JAIL_RECT) && tries < 20);
  return p;
}

/* ---------------- ten chicks, each with a distinct cosmetic + home roam zone ---------------- */
const ROAM_ZONES = {
  backyard: { x: 335, y: 35,  w: 290, h: 140 },
  lawn:     { x: 335, y: 435, w: 290, h: 140 },
  street:   { x: 40,  y: 610, w: 880, h: 50 }
};

const CHICK_DEFS = [
  { cosmetic: { kind: "bow",       color: "#FF8FB1" }, roam: "backyard", label: "Pink Bow" },
  { cosmetic: { kind: "bow",       color: "#3F8FD1" }, roam: "backyard", label: "Blue Bow" },
  { cosmetic: { kind: "bow",       color: "#6BBF4A" }, roam: "backyard", label: "Green Bow" },
  { cosmetic: { kind: "bow",       color: "#A569BD" }, roam: "backyard", label: "Purple Bow" },
  { cosmetic: { kind: "bow",       color: "#F6C945" }, roam: "lawn",     label: "Yellow Bow" },
  { cosmetic: { kind: "cap",       color: "#E8433D" }, roam: "lawn",     label: "Backwards Cap" },
  { cosmetic: { kind: "shades",    color: "#1F2A44" }, roam: "lawn",     label: "Shutter Shades" },
  { cosmetic: { kind: "toga",      color: "#FFFFFF" }, roam: "street",   label: "Toga" },
  { cosmetic: { kind: "tophat",    color: "#1F2A44" }, roam: "street",   label: "Top Hat" },
  { cosmetic: { kind: "propeller", color: "#F6C945" }, roam: "street",   label: "Propeller Cap" }
];

const chicks = CHICK_DEFS.map((def, i) => {
  const rect = ROAM_ZONES[def.roam];
  const p = randomPointInRect(rect);
  return {
    id: i, label: def.label, cosmetic: def.cosmetic, roamRect: rect,
    x: p.x, y: p.y, vx: 0, vy: 0, wanderFramesLeft: 0,
    legPhase: Math.floor(Math.random() * 100), facing: 1,
    carried: false, lastDeliveredAt: 0
  };
});

/* ---------------- forest trees (static decoration) ---------------- */
const forestTrees = [];
for (let i = 0; i < 14; i++){
  let p, tries = 0;
  do{ p = { x: FOREST_RECT.x + 15 + Math.random() * (FOREST_RECT.w - 30), y: FOREST_RECT.y + 15 + Math.random() * (FOREST_RECT.h - 30) }; tries++; }
  while (pointInRect(p, JAIL_RECT) && tries < 20);
  forestTrees.push({ x: p.x, y: p.y, size: 10 + Math.random() * 8 });
}

/* ---------------- wolves ---------------- */
const wolves = [];
for (let i = 0; i < WOLF_COUNT; i++){
  const p = randomForestPoint();
  wolves.push({
    id: i, x: p.x, y: p.y, vx: 0, vy: 0, wanderFramesLeft: 0, facing: 1,
    strength: Math.floor(WOLF_MIN_STRENGTH + Math.random() * (WOLF_MAX_STRENGTH - WOLF_MIN_STRENGTH)),
    cooldownFrames: 0
  });
}

/* ---------------- state ---------------- */
let canvas, ctx;
let stationBtn, chunderClockEl, chunderRingFg, chunderSecondsEl;
let partyFowlBanner, partyFowlTimerEl, jailBanner, jailTimerEl;

let uid = null;
let displayName = "";
let running = false;
let animId = null;
let tick = 0;
let drunkPhase = 0;

let chatInputBar, chatInputEl;
let chatOpen = false;
let localChatBubble = null; // { text, sentAt }

let player = { x: 400, y: 240, moving: false, carrying: [] };
const keys = new Set();

let stats = { protein: 0, baseStrength: 0, strengthBoost: 0, beerLevel: 0, clout: 0 };

let chunderActive = false;
let chunderFramesLeft = 0;
let partyFowlUntil = 0;
let fowlTimestamps = [];
let jailUntil = 0;
let nearestInteractable = null;
let toast = null;

/* ==================== lifecycle ==================== */
function resetForNewSession(playerData){
  stats.protein = 0;
  stats.strengthBoost = 0;
  stats.beerLevel = 0;
  stats.baseStrength = (playerData && playerData.baseStrength) || 0;
  stats.clout = (playerData && playerData.clout) || 0;
  chunderActive = false;
  chunderFramesLeft = 0;
  partyFowlUntil = 0;
  fowlTimestamps = [];
  jailUntil = 0;
  player.x = 400;
  player.y = 240;
  player.carrying = [];
  chicks.forEach(c => { c.carried = false; });
}

window.addEventListener("cf:authready", (e) => {
  uid = e.detail.uid;
  displayName = e.detail.displayName;
  resetForNewSession(e.detail.playerData);
  initMultiplayer(uid, displayName);
  startLoop();
  if (DEBUG) console.log("[ChickenFrat] session ready for", e.detail.displayName);
});

window.addEventListener("cf:signout", () => {
  uid = null;
  stopMultiplayer();
  stopLoop();
});

/* ==================== input ==================== */
const MOVE_KEYS = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD"]);

document.addEventListener("keydown", (e) => {
  if (chatOpen) return; // let the chat input's own listener handle keys while typing
  if (e.code === "Enter"){ e.preventDefault(); openChat(); return; }
  if (MOVE_KEYS.has(e.code)) { keys.add(e.code); e.preventDefault(); }
  if (e.code === "Space"){ e.preventDefault(); triggerInteraction(); }
});
document.addEventListener("keyup", (e) => {
  if (chatOpen) return;
  if (MOVE_KEYS.has(e.code)) keys.delete(e.code);
});

function openChat(){
  if (!running) return;
  chatOpen = true;
  keys.clear(); // don't leave the chicken drifting on whatever was held when Enter was pressed
  chatInputBar.hidden = false;
  chatInputEl.value = "";
  chatInputEl.focus();
}
function closeChat(){
  chatOpen = false;
  chatInputBar.hidden = true;
  chatInputEl.blur();
}

function currentSpeedMultiplier(){
  const penalty = (stats.beerLevel / BEER_MAX) * MAX_BEER_SPEED_PENALTY_FRACTION;
  return Math.max(0.25, 1 - penalty);
}
function carryCapacity(){
  return Math.min(CARRY_MAX_CAPACITY, CARRY_BASE_CAPACITY + Math.floor(stats.baseStrength / CARRY_STRENGTH_PER_SLOT));
}
function isJailed(){ return jailUntil > Date.now(); }

function updateMovement(){
  if (isJailed() || chatOpen){ player.moving = false; return; }

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

/* ==================== interaction targeting (stations + loose chicks) ==================== */
function findNearestInteractable(){
  if (isJailed() || chatOpen) return null;
  let best = null, bestDist = Infinity;
  for (const s of stations){
    const d = Math.hypot(player.x - s.x, player.y - s.y);
    if (d < STATION_RADIUS && d < bestDist){ best = { kind: "station", ref: s }; bestDist = d; }
  }
  for (const c of chicks){
    if (c.carried) continue;
    const d = Math.hypot(player.x - c.x, player.y - c.y);
    if (d < CHICK_PICKUP_RADIUS && d < bestDist){ best = { kind: "chick", ref: c }; bestDist = d; }
  }
  return best;
}

function interactableLabel(hit){
  if (!hit) return "";
  if (hit.kind === "chick"){
    if (player.carrying.length >= carryCapacity()) return "Hands full — drop these off at the house first";
    return `Pick up ${hit.ref.label} chick`;
  }
  const s = hit.ref;
  if (s.type === "locked") return s.label;
  if (s.type === "seed") return "Tap to eat seed";
  if (s.type === "gym") return stats.protein > 0 ? "Tap to lift" : "Nothing to lift — eat seed first";
  if (s.type === "beer") return partyFowlUntil > Date.now() ? "Locked — you're in the doghouse" : "Tap to chug";
  if (s.type === "bathroom") return chunderActive ? "You made it — hurl in peace" : "Bathroom stall";
  return s.label;
}
function interactableDisabled(hit){
  if (!hit) return false;
  if (hit.kind === "chick") return player.carrying.length >= carryCapacity();
  return hit.ref.type === "locked";
}

function triggerInteraction(){
  if (!running || isJailed() || chatOpen || !nearestInteractable) return;

  if (nearestInteractable.kind === "chick"){
    if (player.carrying.length >= carryCapacity()) return;
    const c = nearestInteractable.ref;
    c.carried = true;
    player.carrying.push(c.id);
    if (DEBUG) console.log("[ChickenFrat] picked up chick:", c.label);
    return;
  }

  const s = nearestInteractable.ref;
  if (s.type === "seed"){
    stats.protein = Math.min(PROTEIN_MAX, stats.protein + EAT_SEED_GAIN);
  }else if (s.type === "gym"){
    if (stats.protein <= 0) return;
    const gain = Math.min(GYM_CONVERT_PER_TAP, stats.protein);
    stats.protein -= gain;
    stats.baseStrength += gain;
    queuePatch({ baseStrength: stats.baseStrength });
    if (DEBUG) console.log("[ChickenFrat] gained strength:", gain, "-> total", stats.baseStrength);
  }else if (s.type === "beer"){
    if (partyFowlUntil > Date.now()) return;
    if (chunderActive) return;
    stats.beerLevel = Math.min(BEER_MAX, stats.beerLevel + DRINK_GAIN);
    stats.strengthBoost = Math.min(STRENGTH_BOOST_CAP, stats.strengthBoost + STRENGTH_BOOST_PER_DRINK);
    if (stats.beerLevel >= BEER_MAX) startChunderClock();
  }
}

/* ==================== chick delivery ==================== */
function playerInHouseZone(){
  return player.x > HOUSE_ZONE.x && player.x < HOUSE_ZONE.x + HOUSE_ZONE.w &&
         player.y > HOUSE_ZONE.y && player.y < HOUSE_ZONE.y + HOUSE_ZONE.h;
}
function showToast(text, color){
  toast = { text, color, framesLeft: TOAST_LIFESPAN_FRAMES, x: player.x, y: player.y };
}

function updateDelivery(){
  if (player.carrying.length === 0 || !playerInHouseZone()) return;

  const now = Date.now();
  let cloutGained = 0;
  let anyPartyFowl = false;

  player.carrying.forEach(id => {
    const c = chicks.find(ch => ch.id === id);
    const isRepeat = c.lastDeliveredAt > 0 && (now - c.lastDeliveredAt) < CHICK_REPEAT_COOLDOWN_MS;
    if (isRepeat){ anyPartyFowl = true; }
    else{ cloutGained += CLOUT_PER_CHICK; }
    c.lastDeliveredAt = now;
    c.carried = false;
    const p = randomPointInRect(c.roamRect);
    c.x = p.x; c.y = p.y;
  });
  player.carrying = [];

  if (cloutGained > 0){
    stats.clout += cloutGained;
    queuePatch({ clout: stats.clout });
  }
  if (anyPartyFowl){
    triggerPartyFowl("repeat-chick");
    showToast("PARTY FOWL! Same chick, twice too soon", COLORS.fowlRed);
  }else if (cloutGained > 0){
    showToast(`+${cloutGained} Clout!`, COLORS.cloutGreen);
  }
}

/* ==================== chunder clock / party fowl / jail ==================== */
function startChunderClock(){
  chunderActive = true;
  chunderFramesLeft = CHUNDER_COUNTDOWN_FRAMES;
  if (DEBUG) console.log("[ChickenFrat] Chunder Clock started — get to the bathroom");
}
function resolveChunderSuccess(){
  chunderActive = false;
  stats.beerLevel = 20;
  stats.strengthBoost = Math.min(stats.strengthBoost, STRENGTH_BOOST_PER_DRINK);
}
function pruneFowlTimestamps(){
  const cutoff = Date.now() - JAIL_WINDOW_MS;
  fowlTimestamps = fowlTimestamps.filter(t => t > cutoff);
}
function sendToJail(){
  jailUntil = Date.now() + JAIL_LOCKOUT_MS;
  fowlTimestamps = [];
  // release any carried chicks back into the wild — you're going away for a bit
  player.carrying.forEach(id => {
    const c = chicks.find(ch => ch.id === id);
    c.carried = false;
    const p = randomPointInRect(c.roamRect);
    c.x = p.x; c.y = p.y;
  });
  player.carrying = [];
  player.x = JAIL_RECT.x + JAIL_RECT.w / 2;
  player.y = JAIL_RECT.y + JAIL_RECT.h / 2;
  if (DEBUG) console.log("[ChickenFrat] BOOKED — too many Party Fowls, locked up for 60s");
}
function triggerPartyFowl(reason){
  chunderActive = false;
  stats.beerLevel = 0;
  stats.strengthBoost = 0;
  partyFowlUntil = Date.now() + PARTY_FOWL_LOCKOUT_MS;
  fowlTimestamps.push(Date.now());
  pruneFowlTimestamps();
  if (DEBUG) console.log("[ChickenFrat] PARTY FOWL (" + reason + ") — beer locked; fowl count in window:", fowlTimestamps.length);
  if (fowlTimestamps.length >= JAIL_FOWL_THRESHOLD){
    sendToJail();
    showToast("BOOKED! Too many Party Fowls", COLORS.wallLine);
  }
}
function updateChunder(){
  if (!chunderActive) return;
  const bathroom = stations.find(s => s.type === "bathroom");
  const nearBathroom = Math.hypot(player.x - bathroom.x, player.y - bathroom.y) < STATION_RADIUS;
  if (nearBathroom){ resolveChunderSuccess(); return; }
  chunderFramesLeft--;
  if (chunderFramesLeft <= 0) triggerPartyFowl("chunder");
}

/* ==================== per-frame stat decay ==================== */
function updateStatDecay(){
  if (stats.strengthBoost > 0) stats.strengthBoost = Math.max(0, stats.strengthBoost - STRENGTH_BOOST_DECAY_PER_FRAME);
  if (!chunderActive && stats.beerLevel > 0) stats.beerLevel = Math.max(0, stats.beerLevel - BEER_LEVEL_DECAY_PER_FRAME);
}

/* ==================== chick wandering ==================== */
function updateChicks(){
  chicks.forEach(c => {
    if (c.carried) return;
    c.wanderFramesLeft--;
    if (c.wanderFramesLeft <= 0){
      const angle = Math.random() * Math.PI * 2;
      const speed = CHICK_WANDER_SPEED_MIN + Math.random() * (CHICK_WANDER_SPEED_MAX - CHICK_WANDER_SPEED_MIN);
      if (Math.random() < 0.25){ c.vx = 0; c.vy = 0; }
      else{ c.vx = Math.cos(angle) * speed; c.vy = Math.sin(angle) * speed; }
      c.wanderFramesLeft = CHICK_WANDER_MIN_FRAMES + Math.random() * (CHICK_WANDER_MAX_FRAMES - CHICK_WANDER_MIN_FRAMES);
    }
    c.x += c.vx; c.y += c.vy;
    if (Math.abs(c.vx) > 0.05) c.facing = c.vx > 0 ? 1 : -1;
    const r = c.roamRect;
    if (c.x < r.x){ c.x = r.x; c.vx *= -1; }
    if (c.x > r.x + r.w){ c.x = r.x + r.w; c.vx *= -1; }
    if (c.y < r.y){ c.y = r.y; c.vy *= -1; }
    if (c.y > r.y + r.h){ c.y = r.y + r.h; c.vy *= -1; }
    if (Math.abs(c.vx) > 0.05 || Math.abs(c.vy) > 0.05) c.legPhase++;
  });
}

/* ==================== wolves ==================== */
function updateWolves(){
  wolves.forEach(w => {
    if (w.cooldownFrames > 0) w.cooldownFrames--;
    w.wanderFramesLeft--;
    if (w.wanderFramesLeft <= 0){
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 0.5;
      w.vx = Math.cos(angle) * speed; w.vy = Math.sin(angle) * speed;
      w.wanderFramesLeft = WOLF_WANDER_MIN_FRAMES + Math.random() * (WOLF_WANDER_MAX_FRAMES - WOLF_WANDER_MIN_FRAMES);
    }
    const nx = w.x + w.vx, ny = w.y + w.vy;
    const blockedX = nx < FOREST_RECT.x + 16 || nx > FOREST_RECT.x + FOREST_RECT.w - 16 || pointInRect({ x: nx, y: w.y }, JAIL_RECT);
    const blockedY = ny < FOREST_RECT.y + 16 || ny > FOREST_RECT.y + FOREST_RECT.h - 16 || pointInRect({ x: w.x, y: ny }, JAIL_RECT);
    if (blockedX) w.vx *= -1; else w.x = nx;
    if (blockedY) w.vy *= -1; else w.y = ny;
    if (Math.abs(w.vx) > 0.05) w.facing = w.vx > 0 ? 1 : -1;
  });
}

function resolveWolfEncounter(w){
  const totalStrength = stats.baseStrength + stats.strengthBoost;
  if (totalStrength >= w.strength){
    stats.clout += CLOUT_PER_WOLF_WIN;
    queuePatch({ clout: stats.clout });
    showToast(`+${CLOUT_PER_WOLF_WIN} Clout! Wolf defeated`, COLORS.cloutGreen);
    if (DEBUG) console.log("[ChickenFrat] defeated a wolf (str " + w.strength + ")");
  }else if (totalStrength < w.strength * WOLF_DEATH_THRESHOLD_FRACTION){
    stats.baseStrength = 0;
    stats.strengthBoost = 0;
    queuePatch({ baseStrength: 0 });
    showToast("Mauled by a wolf! Strength wiped to 0", COLORS.fowlRed);
    if (DEBUG) console.log("[ChickenFrat] KILLED by wolf (str " + w.strength + ") — strength reset to 0");
  }else{
    stats.baseStrength = Math.max(0, stats.baseStrength - WOLF_STRENGTH_LOSS);
    queuePatch({ baseStrength: stats.baseStrength });
    showToast(`-${WOLF_STRENGTH_LOSS} Strength! That wolf got you`, COLORS.fowlRed);
    if (DEBUG) console.log("[ChickenFrat] lost to wolf (str " + w.strength + ") — strength now", stats.baseStrength);
  }
  const p = randomForestPoint();
  w.x = p.x; w.y = p.y;
  w.cooldownFrames = WOLF_ENCOUNTER_COOLDOWN_FRAMES;
}

function updateWolfEncounters(){
  if (isJailed()) return;
  wolves.forEach(w => {
    if (w.cooldownFrames > 0) return;
    const d = Math.hypot(player.x - w.x, player.y - w.y);
    if (d < WOLF_CONTACT_RADIUS) resolveWolfEncounter(w);
  });
}

/* ==================== update / draw ==================== */
function update(){
  tick++;
  updateMovement();
  updateLocalPresence(player.x, player.y);
  nearestInteractable = findNearestInteractable();
  updateDelivery();
  updateChunder();
  updateStatDecay();
  updateChicks();
  updateWolves();
  updateWolfEncounters();
  if (toast && toast.framesLeft > 0) toast.framesLeft--;
}

function draw(){
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawStreet();
  drawForest();

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
  chicks.forEach(c => { if (!c.carried && c.roamRect !== ROAM_ZONES.street) drawChick(c); });
  drawOtherPlayers();
  drawPlayer();
  drawLocalChatBubble();
  drawToast();
}

/* ---------------- other players (Realtime Database presence) ---------------- */
function drawOtherPlayers(){
  const others = getOtherPlayers();
  Object.values(others).forEach(op => {
    drawRemoteChicken(op);
    if (op.chat && op.chat.text){
      const age = Date.now() - op.chat.sentAt;
      if (age < CHAT_BUBBLE_LIFESPAN_MS){
        const dist = Math.hypot(player.x - op.x, player.y - op.y);
        const alpha = Math.max(0, 1 - dist / MAX_CHAT_VISIBLE_DISTANCE);
        if (alpha > 0) drawChatBubble(op.x, op.y - PLAYER_RADIUS - 20, op.chat.text, alpha);
      }
    }
  });
}

function drawRemoteChicken(op){
  const x = op.x, y = op.y;
  ctx.fillStyle = COLORS.remoteChicken;
  ctx.beginPath();
  ctx.ellipse(x, y, PLAYER_RADIUS * 0.9, PLAYER_RADIUS * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(31,42,68,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = COLORS.chickenComb;
  ctx.beginPath();
  ctx.moveTo(x - 5, y - PLAYER_RADIUS * 0.9 + 2);
  ctx.lineTo(x, y - PLAYER_RADIUS * 0.9 - 7);
  ctx.lineTo(x + 5, y - PLAYER_RADIUS * 0.9 + 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  ctx.moveTo(x + PLAYER_RADIUS * 0.7, y);
  ctx.lineTo(x + PLAYER_RADIUS * 0.7 + 7, y + 3);
  ctx.lineTo(x + PLAYER_RADIUS * 0.7, y + 6);
  ctx.closePath();
  ctx.fill();

  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.wallLine;
  ctx.fillText(op.displayName || "Chicken", x, y - PLAYER_RADIUS - 8);
  ctx.textAlign = "left";
}

function drawChatBubble(x, y, text, alpha){
  ctx.globalAlpha = alpha;
  ctx.font = "700 12px 'Baloo 2', sans-serif";
  const paddingX = 10;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + paddingX * 2;
  const boxH = 22;
  ctx.fillStyle = COLORS.chatBubbleBg;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  roundedRect(ctx, x - boxW / 2, y - boxH, boxW, boxH, 8);
  ctx.fill();
  ctx.stroke();
  // little tail pointing down at the chicken
  ctx.beginPath();
  ctx.moveTo(x - 5, y);
  ctx.lineTo(x + 5, y);
  ctx.lineTo(x, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.wallLine;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - boxH / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
}

function roundedRect(context, x, y, w, h, r){
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawLocalChatBubble(){
  if (!localChatBubble) return;
  const age = Date.now() - localChatBubble.sentAt;
  if (age >= CHAT_BUBBLE_LIFESPAN_MS){ localChatBubble = null; return; }
  drawChatBubble(player.x, player.y - PLAYER_RADIUS - 20, localChatBubble.text, 1);
}

/* ---------------- forest + jail + wolves ---------------- */
function drawForest(){
  ctx.fillStyle = COLORS.forest;
  ctx.fillRect(FOREST_RECT.x, FOREST_RECT.y, FOREST_RECT.w, FOREST_RECT.h);
  ctx.font = "700 13px 'Baloo 2', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.globalAlpha = 0.65;
  ctx.fillText("Forest", FOREST_RECT.x + 10, FOREST_RECT.y + 20);
  ctx.globalAlpha = 1;

  forestTrees.forEach(drawTree);
  drawJail();
  wolves.forEach(drawWolf);
}

function drawTree(t){
  ctx.fillStyle = COLORS.troughWoodDark;
  ctx.fillRect(t.x - 2, t.y + t.size * 0.6, 4, t.size * 0.5);
  ctx.fillStyle = COLORS.forestTreeDark;
  for (let i = 0; i < 3; i++){
    const w = t.size * (1 - i * 0.22);
    const yy = t.y - i * t.size * 0.35;
    ctx.beginPath();
    ctx.moveTo(t.x, yy - t.size * 0.5);
    ctx.lineTo(t.x - w / 2, yy + t.size * 0.25);
    ctx.lineTo(t.x + w / 2, yy + t.size * 0.25);
    ctx.closePath();
    ctx.fill();
  }
}

function drawJail(){
  const r = JAIL_RECT;
  ctx.fillStyle = COLORS.jailStone;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 3;
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  ctx.strokeStyle = COLORS.jailBars;
  ctx.lineWidth = 4;
  for (let x = r.x + 14; x < r.x + r.w; x += 18){
    ctx.beginPath();
    ctx.moveTo(x, r.y);
    ctx.lineTo(x, r.y + r.h);
    ctx.stroke();
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 13px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("JAIL", r.x + r.w / 2, r.y - 8);
  ctx.textAlign = "left";
}

function drawWolf(w){
  const bodyW = 16, bodyH = 10;
  const facing = w.facing >= 0 ? 1 : -1;

  ctx.strokeStyle = COLORS.wolfDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w.x - 8, w.y + bodyH - 2); ctx.lineTo(w.x - 8, w.y + bodyH + 8);
  ctx.moveTo(w.x + 8, w.y + bodyH - 2); ctx.lineTo(w.x + 8, w.y + bodyH + 8);
  ctx.stroke();

  ctx.fillStyle = COLORS.wolfBody;
  ctx.beginPath();
  ctx.ellipse(w.x, w.y, bodyW, bodyH, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(w.x - facing * 4, w.y - bodyH);
  ctx.lineTo(w.x - facing * 8, w.y - bodyH - 8);
  ctx.lineTo(w.x - facing * 1, w.y - bodyH - 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.wolfDark;
  ctx.beginPath();
  ctx.moveTo(w.x + facing * bodyW * 0.7, w.y - 2);
  ctx.lineTo(w.x + facing * (bodyW * 0.7 + 10), w.y + 1);
  ctx.lineTo(w.x + facing * bodyW * 0.7, w.y + 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.wolfEye;
  ctx.beginPath();
  ctx.arc(w.x + facing * 4, w.y - 3, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------------- street ---------------- */
function drawStreet(){
  ctx.fillStyle = COLORS.sidewalk;
  ctx.fillRect(0, PROPERTY_H, CANVAS_W, 14);

  ctx.fillStyle = COLORS.street;
  ctx.fillRect(0, PROPERTY_H + 14, CANVAS_W, STREET_H - 14);

  ctx.strokeStyle = COLORS.laneLine;
  ctx.lineWidth = 4;
  ctx.setLineDash([26, 18]);
  ctx.beginPath();
  ctx.moveTo(0, PROPERTY_H + 14 + (STREET_H - 14) / 2);
  ctx.lineTo(CANVAS_W, PROPERTY_H + 14 + (STREET_H - 14) / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = COLORS.fence;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 1.5;
  for (let x = 6; x < CANVAS_W; x += 22){
    ctx.fillRect(x, PROPERTY_H - 14, 8, 16);
    ctx.strokeRect(x, PROPERTY_H - 14, 8, 16);
  }

  chicks.forEach(c => { if (!c.carried && c.roamRect === ROAM_ZONES.street) drawChick(c); });
}

/* ---------------- building toppers (roof, chimney, windows, door, signage) ---------------- */
function drawBuildingTopper(z){
  const roofHeight = z.house ? 20 : 26;
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

  if (z.house){
    // chimney
    ctx.fillStyle = COLORS.troughWoodDark;
    ctx.fillRect(z.x + z.w * 0.68, z.y - roofHeight * 0.85, 14, roofHeight * 0.7);
    ctx.strokeRect(z.x + z.w * 0.68, z.y - roofHeight * 0.85, 14, roofHeight * 0.7);
    // windows on the front wall
    [0.2, 0.62].forEach(frac => {
      const wx = z.x + z.w * frac;
      ctx.fillStyle = "#BFEFFF";
      ctx.fillRect(wx, z.y + 10, 26, 22);
      ctx.strokeStyle = COLORS.wallLine;
      ctx.lineWidth = 2;
      ctx.strokeRect(wx, z.y + 10, 26, 22);
      ctx.beginPath();
      ctx.moveTo(wx + 13, z.y + 10); ctx.lineTo(wx + 13, z.y + 32);
      ctx.moveTo(wx, z.y + 21); ctx.lineTo(wx + 26, z.y + 21);
      ctx.stroke();
    });
  }

  if (z.sign){
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 12px 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(z.sign, z.x + z.w / 2, z.y - 8);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = COLORS.door;
  ctx.fillRect(z.x + z.w / 2 - 16, z.y + z.h - 4, 32, 4);
}

/* ---------------- decorative lawn chairs ---------------- */
function drawLawnChair(c){
  ctx.fillStyle = COLORS.troughWoodDark;
  ctx.fillRect(c.x - 10, c.y + 10, 4, 10);
  ctx.fillRect(c.x + 10, c.y + 10, 4, 10);
  ctx.fillStyle = c.color;
  ctx.fillRect(c.x - 12, c.y - 2, 26, 12);
  ctx.fillRect(c.x - 12, c.y - 20, 26, 18);
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
  if (s.id === "cockfight") return drawFightRing(s);
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
  ctx.moveTo(x - 34, y + 6); ctx.lineTo(x + 34, y + 6);
  ctx.lineTo(x + 28, y + 18); ctx.lineTo(x - 28, y + 18);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = COLORS.troughWood;
  ctx.beginPath();
  ctx.moveTo(x - 36, y - 10); ctx.lineTo(x + 36, y - 10);
  ctx.lineTo(x + 30, y + 8); ctx.lineTo(x - 30, y + 8);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = COLORS.wallLine; ctx.lineWidth = 2; ctx.stroke();

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
  ctx.strokeStyle = COLORS.wallLine; ctx.lineWidth = 2;
  ctx.strokeRect(x - 18, y - 26, 36, 46);
  ctx.fillStyle = COLORS.kegBand;
  ctx.fillRect(x - 18, y - 14, 36, 5);
  ctx.fillRect(x - 18, y + 6, 36, 5);
  ctx.fillStyle = COLORS.kegTap;
  ctx.fillRect(x + 12, y - 6, 12, 6);
  ctx.beginPath();
  ctx.arc(x + 26, y - 3, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawGymRack(s){
  const { x, y } = s;
  ctx.strokeStyle = COLORS.barbellBar; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x - 26, y + 20); ctx.lineTo(x - 8, y - 18);
  ctx.moveTo(x + 26, y + 20); ctx.lineTo(x + 8, y - 18);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 30, y - 16); ctx.lineTo(x + 30, y - 16);
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
  ctx.strokeStyle = COLORS.wallLine; ctx.lineWidth = 1.5;
  const postPoints = [];
  for (let i = 0; i < posts; i++){
    const a = (i / posts) * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.62;
    postPoints.push([px, py]);
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  postPoints.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
  ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "18px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("🔒", x, y + 5);
  ctx.textAlign = "left";
}

/* ---------------- chicks (wandering + cosmetics) ---------------- */
function drawChick(c, scale = 1, xOverride, yOverride){
  const x = xOverride !== undefined ? xOverride : c.x;
  const y = yOverride !== undefined ? yOverride : c.y;
  const bodyR = 8 * scale;

  const legOffset = Math.floor(c.legPhase / 8) % 2 === 0 ? 1 : -1;
  ctx.fillStyle = COLORS.chickenLeg;
  ctx.fillRect(x - 3 * scale, y + bodyR - 2, 2 * scale, (4 + legOffset) * scale);
  ctx.fillRect(x + 1 * scale, y + bodyR - 2, 2 * scale, (4 - legOffset) * scale);

  ctx.fillStyle = COLORS.chickenBody;
  ctx.beginPath();
  ctx.ellipse(x, y, bodyR, bodyR * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  const facing = c.facing >= 0 ? 1 : -1;
  ctx.moveTo(x + facing * bodyR * 0.75, y);
  ctx.lineTo(x + facing * bodyR * 1.4, y + 1.5 * scale);
  ctx.lineTo(x + facing * bodyR * 0.75, y + 3 * scale);
  ctx.closePath(); ctx.fill();

  drawChickCosmetic(c, x, y, bodyR);
}

function drawChickCosmetic(c, x, y, bodyR){
  const { kind, color } = c.cosmetic;
  ctx.fillStyle = color;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 1;

  if (kind === "bow"){
    ctx.beginPath();
    ctx.moveTo(x - bodyR * 0.6, y - bodyR * 0.9);
    ctx.lineTo(x - bodyR * 1.3, y - bodyR * 1.5);
    ctx.lineTo(x - bodyR * 1.3, y - bodyR * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - bodyR * 0.6, y - bodyR * 0.9);
    ctx.lineTo(x + bodyR * 0.1, y - bodyR * 1.5);
    ctx.lineTo(x + bodyR * 0.1, y - bodyR * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.arc(x - bodyR * 0.6, y - bodyR * 0.9, bodyR * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }else if (kind === "cap"){
    ctx.beginPath();
    ctx.arc(x, y - bodyR * 0.9, bodyR * 0.75, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + bodyR * 0.3, y - bodyR * 1.5, bodyR * 0.5, bodyR * 0.4);
  }else if (kind === "shades"){
    ctx.fillRect(x - bodyR * 0.85, y - bodyR * 0.25, bodyR * 1.7, bodyR * 0.5);
  }else if (kind === "toga"){
    ctx.beginPath();
    ctx.moveTo(x - bodyR * 0.9, y - bodyR * 0.5);
    ctx.lineTo(x + bodyR * 0.9, y + bodyR * 0.1);
    ctx.lineTo(x + bodyR * 0.5, y + bodyR * 0.6);
    ctx.lineTo(x - bodyR * 0.9, y + bodyR * 0.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }else if (kind === "tophat"){
    ctx.fillRect(x - bodyR * 0.55, y - bodyR * 1.9, bodyR * 1.1, bodyR * 1.1);
    ctx.fillRect(x - bodyR * 0.8, y - bodyR * 0.9, bodyR * 1.6, bodyR * 0.22);
  }else if (kind === "propeller"){
    ctx.beginPath();
    ctx.arc(x, y - bodyR * 1.1, bodyR * 0.6, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - bodyR * 0.7, y - bodyR * 1.5); ctx.lineTo(x + bodyR * 0.7, y - bodyR * 1.5);
    ctx.moveTo(x, y - bodyR * 1.9); ctx.lineTo(x, y - bodyR * 1.1);
    ctx.stroke();
  }
}

/* ---------------- player ---------------- */
function drawPlayer(){
  const wobble = stats.beerLevel > 40 ? Math.sin(Date.now() / 90) * (stats.beerLevel / 100) * 4 : 0;
  const x = player.x + wobble;
  const y = player.y;

  const legSwing = player.moving ? (Math.floor(tick / 6) % 2 === 0 ? 5 : -5) : 0;
  ctx.strokeStyle = COLORS.chickenLeg; ctx.lineWidth = 3;
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

  if (isJailed()){
    ctx.globalAlpha = 0.6; // visually "behind bars"
  }

  ctx.fillStyle = COLORS.chickenBody;
  ctx.beginPath();
  ctx.ellipse(x, y, PLAYER_RADIUS, PLAYER_RADIUS * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(31,42,68,0.25)"; ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(31,42,68,0.12)";
  ctx.beginPath();
  ctx.ellipse(x - 4, y + 2, 8, 11, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.chickenComb;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - PLAYER_RADIUS + 2);
  ctx.lineTo(x - 2, y - PLAYER_RADIUS - 8);
  ctx.lineTo(x + 2, y - PLAYER_RADIUS + 2);
  ctx.lineTo(x + 6, y - PLAYER_RADIUS - 6);
  ctx.lineTo(x + 9, y - PLAYER_RADIUS + 3);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  ctx.moveTo(x + PLAYER_RADIUS - 4, y);
  ctx.lineTo(x + PLAYER_RADIUS + 8, y + 3);
  ctx.lineTo(x + PLAYER_RADIUS - 4, y + 7);
  ctx.closePath(); ctx.fill();

  ctx.globalAlpha = 1;

  const n = player.carrying.length;
  player.carrying.forEach((id, i) => {
    const c = chicks.find(ch => ch.id === id);
    const bob = Math.sin(tick / 10 + i) * 2;
    const spacing = 16;
    const startX = x - ((n - 1) * spacing) / 2;
    drawChick(c, 0.8, startX + i * spacing, y - PLAYER_RADIUS - 20 + bob);
  });
}

function drawToast(){
  if (!toast || toast.framesLeft <= 0) return;
  const frac = toast.framesLeft / TOAST_LIFESPAN_FRAMES;
  const riseY = toast.y - PLAYER_RADIUS - 34 - (1 - frac) * 18;
  ctx.globalAlpha = Math.min(1, frac * 1.6);
  ctx.font = "700 13px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = toast.color;
  ctx.fillText(toast.text, toast.x, riseY);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

/* ==================== HUD sync ==================== */
function syncHud(){
  document.getElementById("meter-protein-fill").style.width = (stats.protein / PROTEIN_MAX * 100) + "%";
  document.getElementById("meter-protein-value").textContent = Math.floor(stats.protein);
  document.getElementById("meter-beer-fill").style.width = (stats.beerLevel / BEER_MAX * 100) + "%";
  document.getElementById("meter-beer-value").textContent = Math.floor(stats.beerLevel);
  document.getElementById("meter-strength-value").textContent = Math.floor(stats.baseStrength + stats.strengthBoost);
  document.getElementById("meter-clout-value").textContent = Math.floor(stats.clout);

  if (nearestInteractable && !isJailed()){
    stationBtn.hidden = false;
    const anchor = nearestInteractable.ref;
    stationBtn.textContent = interactableLabel(nearestInteractable);
    stationBtn.style.left = anchor.x + "px";
    stationBtn.style.top = anchor.y + "px";
    stationBtn.disabled = interactableDisabled(nearestInteractable);
  }else{
    stationBtn.hidden = true;
  }

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

  const fowlMsLeft = partyFowlUntil - Date.now();
  if (fowlMsLeft > 0){
    partyFowlBanner.hidden = false;
    const totalSec = Math.ceil(fowlMsLeft / 1000);
    partyFowlTimerEl.textContent = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
  }else{
    partyFowlBanner.hidden = true;
  }

  const jailMsLeft = jailUntil - Date.now();
  if (jailMsLeft > 0){
    jailBanner.hidden = false;
    const totalSec = Math.ceil(jailMsLeft / 1000);
    jailTimerEl.textContent = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
  }else{
    jailBanner.hidden = true;
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
function startLoop(){ running = true; if (!animId) frame(); }
function stopLoop(){ running = false; if (animId){ cancelAnimationFrame(animId); animId = null; } }

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
  jailBanner = document.getElementById("jail-banner");
  jailTimerEl = document.getElementById("jail-timer");
  chatInputBar = document.getElementById("chat-input-bar");
  chatInputEl = document.getElementById("chat-input");

  stationBtn.addEventListener("click", triggerInteraction);

  chatInputEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.code === "Enter"){
      e.preventDefault();
      const text = chatInputEl.value.trim();
      if (text){
        sendChatMessage(text);
        localChatBubble = { text, sentAt: Date.now() };
      }
      closeChat();
    }else if (e.code === "Escape"){
      e.preventDefault();
      closeChat();
    }
  });

  draw();
  if (DEBUG){
    console.log("[ChickenFrat] game.js loaded — map v2 (forest/jail/wolves) + multiplayer");
    if (!isMultiplayerAvailable()) console.log("[ChickenFrat] Realtime Database not configured yet — multiplayer disabled until databaseURL is set in firebase-init.js");
  }
}

document.addEventListener("DOMContentLoaded", initGame);
