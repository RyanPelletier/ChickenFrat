/* =====================================================================
   CHICKEN FRAT — game.js
   Map v3: House (more house-shaped, with a chimney + windows) sits in a
   middle column with Backyard above it and Front Lawn below. The right
   column now stacks Forest (top) / Gym (mid, smaller) / Pool (bottom) —
   mirroring the middle column's proportions. A second Forest fills the
   whole left column, with a Jail cage inset into it. The Street still
   runs along the bottom. Ten cosmetic chicks still wander/roam and can
   be picked up and carried to the house for Clout.

   POOL: wading through it is slow (heavy speed penalty), and there's a
   "pee in the pool" button that's an instant, no-questions-asked Party
   Fowl if clicked — pure self-inflicted chaos button, no other checks.

   TWO WAYS TO END UP IN TROUBLE:
   1. The original Party Fowl rules (Chunder Clock timeout, bringing the
      same chick to the house twice within 5 minutes, or peeing in the
      pool) — 5 minute beer lockout each time.
   2. Rack up 3 Party Fowls within a rolling 5-minute window and you get
      hauled off to Jail for 60 seconds — movement is frozen there,
      carried chicks are released back to the wild.

   WOLVES: wandering both Forest patches. Walk into one and it resolves
   instantly based on your total Strength (base + beer boost) vs. the
   wolf's own strength: win and you gain Clout, lose and you take a
   Strength hit, lose badly (wildly outmatched) and your Strength is
   wiped to zero. Each individual wolf DOUBLES its own strength every
   time it's defeated, so farming the same wolf over and over stops
   working fast — you have to keep building real Strength to keep up.

   Not in this build yet (see project README): the functioning Cockfight
   Ring, unlockable player cosmetics, the slur filter, and Sloppy Mac.

   This file knows nothing about Firebase directly — it only listens for
   `cf:authready` / `cf:signout` events from auth.js, and calls
   `queuePatch()` from player-data.js to persist Strength/Clout.
   ===================================================================== */

import { queuePatch } from "./player-data.js";
import {
  initMultiplayer, stopMultiplayer, updateLocalPresence, sendChatMessage, getOtherPlayers, isMultiplayerAvailable,
  getCockfightState, joinCockfight, leaveCockfight, consumeCockfightResult
} from "./multiplayer.js";

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
const WOLF_MIN_STRENGTH = 35;
const WOLF_MAX_STRENGTH = 90;
const WOLF_CONTACT_RADIUS = 24;
const CLOUT_PER_WOLF_WIN = 25;
const WOLF_STRENGTH_LOSS = 15;
const WOLF_DEATH_THRESHOLD_FRACTION = 0.4; // outmatched by this much = wiped, not just hurt
const WOLF_ENCOUNTER_COOLDOWN_FRAMES = 100;
const WOLF_STRENGTH_GROWTH_MULTIPLIER = 2; // each wolf gets this much tougher every time it's defeated — stops farm-killing the same one
const WOLF_WANDER_MIN_FRAMES = 100;
const WOLF_WANDER_MAX_FRAMES = 260;

const CHAT_BUBBLE_LIFESPAN_MS = 6000;
const MAX_CHAT_VISIBLE_DISTANCE = 260; // beyond this, another player's speech bubble is fully faded

// pool
const POOL_SPEED_MULTIPLIER = 0.35; // wading through water is slow

// toilet
const PEE_RELIEF_AMOUNT = 40;      // how much peeing brings the Beer meter down
const TOILET_DISABLED_MS = 60 * 1000; // pooping breaks the toilet for this long

// cockfight
const COCKFIGHT_WIN_CLOUT = 25;
const COCKFIGHT_LEAVE_RADIUS = 90; // wander this far from the ring while waiting and you auto-leave the queue

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
  chatBubbleBg: "#FFFFFF",
  pool: "#6EC6E8",
  poolDeep: "#3F8FD1",
  poolWave: "#BFEFFF"
};

/* ---------------- grid layout ----------------
   Left column:   Forest (with Jail inset)
   Middle column: Backyard (top) / House (mid) / Front Lawn (bottom)
   Right column:  Forest patch (top) / Gym (mid, smaller now) / Pool (bottom)
   ------------------------------------------------------------------ */
const FOREST_RECT_LEFT  = { x: 20,  y: 20, w: 280, h: 570 };
const FOREST_RECT_RIGHT = { x: 660, y: 20, w: 280, h: 170 };
const JAIL_RECT = { x: 70, y: 240, w: 180, h: 130 }; // inset into the left forest only

const zones = [
  { key: "backyard", label: "Backyard",            x: 320, y: 20,  w: 320, h: 170, color: COLORS.backyard },
  { key: "house",    label: "Frat House Interior",  x: 320, y: 210, w: 320, h: 190, color: COLORS.house, roof: COLORS.roof, house: true },
  { key: "lawn",     label: "Front Lawn",           x: 320, y: 420, w: 320, h: 170, color: COLORS.lawn },
  { key: "gym",      label: "Gym",                  x: 660, y: 210, w: 280, h: 190, color: COLORS.gym, roof: COLORS.roofGym, sign: "GYM" },
  { key: "pool",     label: "Pool",                 x: 660, y: 420, w: 280, h: 170, color: COLORS.pool, water: true }
];
const HOUSE_ZONE = zones.find(z => z.key === "house");
const POOL_ZONE = zones.find(z => z.key === "pool");

/* ---------------- stations ---------------- */
const stations = [
  { id: "seed", type: "seed", x: 390, y: 270, label: "Eat Seed" },
  { id: "beer", type: "beer", x: 560, y: 270, label: "Drink Beer" },
  { id: "bathroom", type: "bathroom", x: 590, y: 370, label: "Bathroom Stall" },
  { id: "gym", type: "gym", x: 800, y: 300, label: "Work Out" },
  { id: "cockfight", type: "cockfight", x: 480, y: 100, label: "Cockfight Ring" }
];
const COCKFIGHT_STATION = stations.find(s => s.id === "cockfight");

/* ---------------- player cosmetics, won from the Cockfight Ring ---------------- */
const PLAYER_COSMETIC_POOL = [
  { kind: "bow",       color: "#FF8FB1" },
  { kind: "bow",       color: "#3F8FD1" },
  { kind: "bow",       color: "#6BBF4A" },
  { kind: "cap",       color: "#E8433D" },
  { kind: "shades",    color: "#1F2A44" },
  { kind: "toga",      color: "#FFFFFF" },
  { kind: "tophat",    color: "#1F2A44" },
  { kind: "propeller", color: "#F6C945" }
];
function pickRandomCosmetic(owned){
  const ownedKeys = new Set((owned || []).map(c => c.kind + c.color));
  const unowned = PLAYER_COSMETIC_POOL.filter(c => !ownedKeys.has(c.kind + c.color));
  const pool = unowned.length ? unowned : PLAYER_COSMETIC_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
function randomForestPoint(rect){
  let p, tries = 0;
  do{
    p = { x: rect.x + 20 + Math.random() * (rect.w - 40), y: rect.y + 20 + Math.random() * (rect.h - 40) };
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
function seedTrees(rect, count){
  for (let i = 0; i < count; i++){
    let p, tries = 0;
    do{ p = { x: rect.x + 15 + Math.random() * (rect.w - 30), y: rect.y + 15 + Math.random() * (rect.h - 30) }; tries++; }
    while (pointInRect(p, JAIL_RECT) && tries < 20);
    forestTrees.push({ x: p.x, y: p.y, size: 10 + Math.random() * 8 });
  }
}
seedTrees(FOREST_RECT_LEFT, 14);
seedTrees(FOREST_RECT_RIGHT, 6);

/* ---------------- wolves (roam both forest patches) ---------------- */
const wolves = [];
function seedWolves(rect, count, startId){
  for (let i = 0; i < count; i++){
    const p = randomForestPoint(rect);
    wolves.push({
      id: startId + i, roamRect: rect, x: p.x, y: p.y, vx: 0, vy: 0, wanderFramesLeft: 0, facing: 1,
      strength: Math.floor(WOLF_MIN_STRENGTH + Math.random() * (WOLF_MAX_STRENGTH - WOLF_MIN_STRENGTH)),
      cooldownFrames: 0
    });
  }
}
seedWolves(FOREST_RECT_LEFT, 5, 0);
seedWolves(FOREST_RECT_RIGHT, 3, 5);

/* ---------------- state ---------------- */
let canvas, ctx;
let stationBtn, chunderClockEl, chunderRingFg, chunderSecondsEl;
let partyFowlBanner, partyFowlTimerEl, jailBanner, jailTimerEl;
let toiletPeeBtn, toiletPoopBtn;

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

let stats = { protein: 0, baseStrength: 0, strengthBoost: 0, beerLevel: 0, clout: 0, cosmetics: [] };
let equippedCosmetic = null; // {kind,color} — auto-equips the most recently won cosmetic

let chunderActive = false;
let chunderFramesLeft = 0;
let partyFowlUntil = 0;
let fowlTimestamps = [];
let jailUntil = 0;
let toiletDisabledUntil = 0;
let nearestInteractable = null;
let toast = null;

/* ==================== lifecycle ==================== */
function resetForNewSession(playerData){
  stats.protein = 0;
  stats.strengthBoost = 0;
  stats.beerLevel = 0;
  stats.baseStrength = (playerData && playerData.baseStrength) || 0;
  stats.clout = (playerData && playerData.clout) || 0;
  stats.cosmetics = (playerData && playerData.cosmetics) || [];
  equippedCosmetic = stats.cosmetics.length ? stats.cosmetics[stats.cosmetics.length - 1] : null;
  chunderActive = false;
  chunderFramesLeft = 0;
  partyFowlUntil = 0;
  fowlTimestamps = [];
  jailUntil = 0;
  toiletDisabledUntil = 0;
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
function isToiletDisabled(){ return toiletDisabledUntil > Date.now(); }

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

  const speed = BASE_SPEED * currentSpeedMultiplier() * (playerInPool() ? POOL_SPEED_MULTIPLIER : 1);
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

function playerInPool(){
  return pointInRect(player, POOL_ZONE);
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
  if (s.type === "cockfight") return getCockfightState() === "waiting" ? "Waiting for a challenger... (tap to leave)" : "Enter the Cockfight Ring!";
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
  }else if (s.type === "cockfight"){
    if (getCockfightState() === "waiting") leaveCockfight();
    else joinCockfight(stats.baseStrength + stats.strengthBoost);
  }
}

/* ==================== toilet: pee or poop ==================== */
function playerNearBathroom(){
  const bathroom = stations.find(s => s.type === "bathroom");
  return Math.hypot(player.x - bathroom.x, player.y - bathroom.y) < STATION_RADIUS;
}
function doPee(){
  if (!running || isJailed() || chatOpen) return;
  if (isToiletDisabled() || !playerNearBathroom()) return;
  const relief = Math.min(stats.beerLevel, PEE_RELIEF_AMOUNT);
  stats.beerLevel = Math.max(0, stats.beerLevel - PEE_RELIEF_AMOUNT);
  showToast(relief > 0 ? `-${Math.round(relief)} Beer — ahh, relief` : "Nothing to relieve", COLORS.cloutGreen);
  if (DEBUG) console.log("[ChickenFrat] peed — beer level now", stats.beerLevel);
}
function doPoop(){
  if (!running || isJailed() || chatOpen) return;
  if (isToiletDisabled() || !playerNearBathroom()) return;
  toiletDisabledUntil = Date.now() + TOILET_DISABLED_MS;
  triggerPartyFowl("poop");
  showToast("PARTY FOWL! ...and now the toilet's broken", COLORS.fowlRed);
  if (DEBUG) console.log("[ChickenFrat] pooped — instant Party Fowl, toilet out of order for 60s");
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
  const nearBathroom = !isToiletDisabled() && Math.hypot(player.x - bathroom.x, player.y - bathroom.y) < STATION_RADIUS;
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
    const r = w.roamRect;
    const blockedX = nx < r.x + 16 || nx > r.x + r.w - 16 || pointInRect({ x: nx, y: w.y }, JAIL_RECT);
    const blockedY = ny < r.y + 16 || ny > r.y + r.h - 16 || pointInRect({ x: w.x, y: ny }, JAIL_RECT);
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
    const oldStrength = w.strength;
    w.strength = Math.round(w.strength * WOLF_STRENGTH_GROWTH_MULTIPLIER);
    showToast(`+${CLOUT_PER_WOLF_WIN} Clout! Wolf defeated — it'll come back at ${w.strength} strength`, COLORS.cloutGreen);
    if (DEBUG) console.log("[ChickenFrat] defeated a wolf (str " + oldStrength + ") — it grows to", w.strength);
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
  const p = randomForestPoint(w.roamRect);
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
  updateLocalPresence(player.x, player.y, equippedCosmetic);
  nearestInteractable = findNearestInteractable();
  updateDelivery();
  updateChunder();
  updateStatDecay();
  updateChicks();
  updateWolves();
  updateWolfEncounters();
  updateCockfight();
  if (toast && toast.framesLeft > 0) toast.framesLeft--;
}

function updateCockfight(){
  // wander too far from the ring while waiting and you auto-leave the queue
  if (getCockfightState() === "waiting"){
    const dist = Math.hypot(player.x - COCKFIGHT_STATION.x, player.y - COCKFIGHT_STATION.y);
    if (dist > COCKFIGHT_LEAVE_RADIUS) leaveCockfight();
  }

  const result = consumeCockfightResult();
  if (!result) return;

  if (result.won){
    const cosmetic = pickRandomCosmetic(stats.cosmetics);
    stats.cosmetics = [...stats.cosmetics, cosmetic];
    stats.clout += COCKFIGHT_WIN_CLOUT;
    equippedCosmetic = cosmetic;
    queuePatch({ clout: stats.clout, cosmetics: stats.cosmetics });
    showToast(`Won the cockfight! +${COCKFIGHT_WIN_CLOUT} Clout + new look`, COLORS.cloutGreen);
    if (DEBUG) console.log("[ChickenFrat] cockfight WIN vs", result.opponentName, "- unlocked", cosmetic);
  }else{
    showToast(`Lost to ${result.opponentName || "a tough bird"} — no big deal`, COLORS.wallLine);
    if (DEBUG) console.log("[ChickenFrat] cockfight loss vs", result.opponentName);
  }
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
  zones.forEach(z => { if (z.water) drawPoolTexture(z); });

  ctx.font = "700 13px 'Baloo 2', sans-serif";
  ctx.fillStyle = COLORS.wallLine;
  ctx.globalAlpha = 0.55;
  zones.forEach(z => ctx.fillText(z.label, z.x + 10, z.y + z.h - 10));
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

  if (op.cosmetic) drawChickCosmetic({ cosmetic: op.cosmetic }, x, y, PLAYER_RADIUS * 0.9);

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
  [FOREST_RECT_LEFT, FOREST_RECT_RIGHT].forEach(rect => {
    ctx.fillStyle = COLORS.forest;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.font = "700 13px 'Baloo 2', sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.65;
    ctx.fillText("Forest", rect.x + 10, rect.y + rect.h - 10);
    ctx.globalAlpha = 1;
  });

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

function drawPoolTexture(z){
  // deeper-water patch
  ctx.fillStyle = COLORS.poolDeep;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(z.x + 20, z.y + 20, z.w - 40, z.h - 40);
  ctx.globalAlpha = 1;

  // wavy ripple lines
  ctx.strokeStyle = COLORS.poolWave;
  ctx.lineWidth = 2;
  const rowSpacing = 26;
  for (let y = z.y + 22; y < z.y + z.h - 10; y += rowSpacing){
    ctx.beginPath();
    for (let x = z.x + 12; x < z.x + z.w - 12; x += 4){
      const yy = y + Math.sin((x + tick * 0.6) / 14) * 3;
      if (x === z.x + 12) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
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
  if (s.type === "bathroom") return drawToilet(s);
  if (s.id === "cockfight") return drawFightRing(s);
  return drawGenericStation(s);
}

function drawToilet(s){
  const { x, y } = s;
  const broken = isToiletDisabled();
  ctx.globalAlpha = broken ? 0.5 : 1;

  // tank (back)
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.fillRect(x - 15, y - 32, 30, 18);
  ctx.strokeRect(x - 15, y - 32, 30, 18);
  ctx.fillRect(x - 17, y - 36, 34, 6); // tank lid overhang
  ctx.strokeRect(x - 17, y - 36, 34, 6);

  // bowl base
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(x - 12, y - 14);
  ctx.lineTo(x + 12, y - 14);
  ctx.lineTo(x + 16, y + 12);
  ctx.quadraticCurveTo(x, y + 22, x - 16, y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // seat ring (top, slightly darker to read as a separate piece)
  ctx.fillStyle = "#E7E1CF";
  ctx.beginPath();
  ctx.ellipse(x, y - 14, 15, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.ellipse(x, y - 14, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;

  if (broken){
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🚫", x, y - 44);
    ctx.textAlign = "left";
  }
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
  const waiting = getCockfightState() === "waiting";

  ctx.fillStyle = COLORS.ringDirt;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const posts = 6;
  ctx.fillStyle = COLORS.troughWood;
  ctx.strokeStyle = COLORS.wallLine; ctx.lineWidth = 1.5;
  const postPoints = [];
  for (let i = 0; i < posts; i++){
    const a = (i / posts) * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.62;
    postPoints.push([px, py]);
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.strokeStyle = COLORS.kegTap; ctx.lineWidth = 2.5;
  ctx.beginPath();
  postPoints.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
  ctx.closePath(); ctx.stroke();

  ctx.font = "18px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(waiting ? "⏳" : "🐓", x, y + 5);
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

  if (equippedCosmetic) drawChickCosmetic({ cosmetic: equippedCosmetic }, x, y, PLAYER_RADIUS);

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

  const nearBathroomStation = nearestInteractable && nearestInteractable.kind === "station" && nearestInteractable.ref.type === "bathroom";

  if (nearBathroomStation && !isJailed()){
    const s = nearestInteractable.ref;
    if (isToiletDisabled()){
      stationBtn.hidden = false;
      stationBtn.textContent = "Toilet out of order (" + Math.ceil((toiletDisabledUntil - Date.now()) / 1000) + "s)";
      stationBtn.style.left = s.x + "px";
      stationBtn.style.top = s.y + "px";
      stationBtn.disabled = true;
      toiletPeeBtn.hidden = true;
      toiletPoopBtn.hidden = true;
    }else{
      stationBtn.hidden = true;
      toiletPeeBtn.hidden = false;
      toiletPeeBtn.style.left = (s.x - 48) + "px";
      toiletPeeBtn.style.top = s.y + "px";
      toiletPoopBtn.hidden = false;
      toiletPoopBtn.style.left = (s.x + 48) + "px";
      toiletPoopBtn.style.top = s.y + "px";
    }
  }else if (nearestInteractable && !isJailed()){
    stationBtn.hidden = false;
    const anchor = nearestInteractable.ref;
    stationBtn.textContent = interactableLabel(nearestInteractable);
    stationBtn.style.left = anchor.x + "px";
    stationBtn.style.top = anchor.y + "px";
    stationBtn.disabled = interactableDisabled(nearestInteractable);
    toiletPeeBtn.hidden = true;
    toiletPoopBtn.hidden = true;
  }else{
    stationBtn.hidden = true;
    toiletPeeBtn.hidden = true;
    toiletPoopBtn.hidden = true;
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
  toiletPeeBtn = document.getElementById("toilet-pee-btn");
  toiletPoopBtn = document.getElementById("toilet-poop-btn");

  stationBtn.addEventListener("click", triggerInteraction);
  toiletPeeBtn.addEventListener("click", doPee);
  toiletPoopBtn.addEventListener("click", doPoop);

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
