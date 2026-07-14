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
  getCockfightState, joinCockfight, leaveCockfight, consumeCockfightResult, sendPledge, consumePledges
} from "./multiplayer.js";
import {
  startFratHouses, stopFratHouses, getFratHouses, buyHouseKey, setHouseLocked, setHouseColor, dropHouseKey
} from "./frat-houses.js";
import {
  isCoffeeShopAvailable, startCoffeeShop, stopCoffeeShop, getShiftRoster, isOnShift, shiftSize,
  clockIn, clockOut, distributeOrderEarnings, consumeCoffeeEarnings,
  getOrderAuthorityUid, broadcastMinigameEvent, consumeMinigameEvents
} from "./coffee-shop.js";
import { CoffeeShopMinigame } from "./coffee-shop-minigame.js";

/* ==================== CONFIG — tweak freely ==================== */
const PROPERTY_W = 960;   // forest/backyard/house/lawn/gym interior
const PROPERTY_H = 600;
const ROAD_H = 86;        // innermost ring, hugs the property — this is what "the road" means for the car
const SIDEWALK_H = 14;
const HOUSE_ROW_H = 70;   // outermost ring — this is where all 16 frat houses live
const PERIMETER_BAND = ROAD_H + SIDEWALK_H + HOUSE_ROW_H;
const OUTER_MARGIN = 60; // safety margin beyond the house row — without this, roofs/labels/popup buttons on the outer edge get clipped by the canvas boundary
const PROPERTY_OFFSET_X = PERIMETER_BAND + OUTER_MARGIN; // property interior no longer starts at (0,0) — it's inset by the ring + margin
const PROPERTY_OFFSET_Y = PERIMETER_BAND + OUTER_MARGIN;
const CANVAS_W = PROPERTY_W + (PERIMETER_BAND + OUTER_MARGIN) * 2;
const CANVAS_H = PROPERTY_H + (PERIMETER_BAND + OUTER_MARGIN) * 2;

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
const JAIL_CLOUT_PENALTY = 100;       // lost every single time you're jailed, however you got there

// car
const CAR_SPEED_MULTIPLIER = 1.9;
const CAR_INTERACT_RADIUS = 42;
const DUI_BEER_THRESHOLD = 30; // beer level at/above this and getting behind the wheel = straight to jail

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
  poolWave: "#BFEFFF",
  houseRowBg: "#E4DCC4",
  fratHouseWall: "#F4E9D8",
  fratHouseWallLocked: "#D8CFC0",
  fratHouseRoof: "#7A5A9E",
  carBody: "#3F8FD1",
  carBodyDark: "#2C6FA8",
  carWindow: "#BFEFFF",
  carWheel: "#1F2A44",
  gold: "#E0B84B",
  keyGold: "#F6C945",
  coffeeWall: "#6B4222",
  coffeeRoof: "#3E2A18",
  coffeeAwning: "#C9922A"
};

/* ---------------- grid layout (all offset into the property interior) ----------------
   Left column:   Forest (with Jail inset)
   Middle column: Backyard (top) / House (mid) / Front Lawn (bottom)
   Right column:  Forest patch (top) / Gym (mid, smaller now) / Pool (bottom)
   ------------------------------------------------------------------ */
function offsetRect(r){ return { ...r, x: r.x + PROPERTY_OFFSET_X, y: r.y + PROPERTY_OFFSET_Y }; }

const FOREST_RECT_LEFT  = offsetRect({ x: 20,  y: 20, w: 280, h: 570 });
const FOREST_RECT_RIGHT = offsetRect({ x: 660, y: 20, w: 280, h: 170 });
const JAIL_RECT = offsetRect({ x: 70, y: 240, w: 180, h: 130 }); // inset into the left forest only

const zones = [
  { key: "backyard", label: "Backyard",            x: 320, y: 20,  w: 320, h: 170, color: COLORS.backyard },
  { key: "house",    label: "Frat House Interior",  x: 320, y: 210, w: 320, h: 190, color: COLORS.house, roof: COLORS.roof, house: true },
  { key: "lawn",     label: "Front Lawn",           x: 320, y: 420, w: 320, h: 170, color: COLORS.lawn },
  { key: "gym",      label: "Gym",                  x: 660, y: 210, w: 280, h: 190, color: COLORS.gym, roof: COLORS.roofGym, sign: "GYM" },
  { key: "pool",     label: "Pool",                 x: 660, y: 420, w: 280, h: 170, color: COLORS.pool, water: true }
].map(z => ({ ...z, x: z.x + PROPERTY_OFFSET_X, y: z.y + PROPERTY_OFFSET_Y }));
const HOUSE_ZONE = zones.find(z => z.key === "house");
const POOL_ZONE = zones.find(z => z.key === "pool");

/* ---------------- stations ---------------- */
const stations = [
  { id: "seed", type: "seed", x: 390, y: 270, label: "Eat Seed" },
  { id: "beer", type: "beer", x: 560, y: 270, label: "Drink Beer" },
  { id: "bathroom", type: "bathroom", x: 590, y: 370, label: "Bathroom Stall" },
  { id: "gym", type: "gym", x: 800, y: 300, label: "Work Out" },
  { id: "cockfight", type: "cockfight", x: 480, y: 100, label: "Cockfight Ring" }
].map(s => ({ ...s, x: s.x + PROPERTY_OFFSET_X, y: s.y + PROPERTY_OFFSET_Y }));
const COCKFIGHT_STATION = stations.find(s => s.id === "cockfight");

/* ---------------- merch: closet purchases + Cockfight Ring rewards share this catalog ----------------
   Each item occupies one of four slots (head/face/neck/feet); equipping
   a new item in a slot replaces whatever was there. Rendering reuses
   drawChickCosmetic (originally built for the wandering chicks' bows/
   hats) since the shape vocabulary already covers most of this — see
   the "chain" and "shoes" cases added there for the two new slots. */
const MERCH_CATALOG = [
  { id: "bow_pink",    slot: "head", kind: "bow",       color: "#FF8FB1", label: "Pink Bow",      cost: 50 },
  { id: "bow_blue",    slot: "head", kind: "bow",       color: "#3F8FD1", label: "Blue Bow",      cost: 50 },
  { id: "cap_red",     slot: "head", kind: "cap",       color: "#E8433D", label: "Backwards Cap", cost: 70 },
  { id: "tophat_blk",  slot: "head", kind: "tophat",    color: "#1F2A44", label: "Top Hat",       cost: 90 },
  { id: "propeller",   slot: "head", kind: "propeller", color: "#F6C945", label: "Propeller Cap", cost: 90 },
  { id: "shades_blk",  slot: "face", kind: "shades",    color: "#1F2A44", label: "Cool Shades",   cost: 60 },
  { id: "shades_pink", slot: "face", kind: "shades",    color: "#FF8FB1", label: "Pink Shades",   cost: 60 },
  { id: "chain_gold",  slot: "neck", kind: "chain",     color: "#E0B84B", label: "Gold Chain",    cost: 120 },
  { id: "shoes_red",   slot: "feet", kind: "shoes",     color: "#E8433D", label: "Red Kicks",     cost: 80 },
  { id: "shoes_white", slot: "feet", kind: "shoes",     color: "#FFFFFF", label: "White Kicks",   cost: 80 }
];
function merchById(id){ return MERCH_CATALOG.find(m => m.id === id); }
function pickRandomUnownedMerch(owned){
  const ownedSet = new Set(owned || []);
  const unowned = MERCH_CATALOG.filter(m => !ownedSet.has(m.id));
  const pool = unowned.length ? unowned : MERCH_CATALOG;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- 16 frat houses, 4 per side, out in the house band beyond the road ----------------
   All 16 use the same unrotated building sprite regardless of which
   side of the map they're on (a deliberate simplification — properly
   rotating the roof/door to face the road on all 4 sides would need a
   meaningfully bigger art pass for a purely presentational upgrade). */
const HOUSE_BAND_MID = ROAD_H + SIDEWALK_H + HOUSE_ROW_H / 2; // distance from the property edge to the house row's centerline
function sideSpread(n, total){
  const out = [];
  for (let i = 0; i < n; i++) out.push(total * (i + 0.5) / n);
  return out;
}
const fratHouses = [];
(function seedFratHouses(){
  let n = 1;
  sideSpread(4, PROPERTY_W).forEach(dx => {
    fratHouses.push({ id: `house${n++}`, side: "top", x: PROPERTY_OFFSET_X + dx, y: PROPERTY_OFFSET_Y - HOUSE_BAND_MID });
  });
  sideSpread(4, PROPERTY_W).forEach(dx => {
    fratHouses.push({ id: `house${n++}`, side: "bottom", x: PROPERTY_OFFSET_X + dx, y: PROPERTY_OFFSET_Y + PROPERTY_H + HOUSE_BAND_MID });
  });
  sideSpread(4, PROPERTY_H).forEach(dy => {
    fratHouses.push({ id: `house${n++}`, side: "left", x: PROPERTY_OFFSET_X - HOUSE_BAND_MID, y: PROPERTY_OFFSET_Y + dy });
  });
  sideSpread(4, PROPERTY_H).forEach(dy => {
    fratHouses.push({ id: `house${n++}`, side: "right", x: PROPERTY_OFFSET_X + PROPERTY_W + HOUSE_BAND_MID, y: PROPERTY_OFFSET_Y + dy });
  });
})();

const KEY_COST = 150;
const KEY_DROP_BEER_THRESHOLD = 90;
const SHRINE_COST = 100;
const SHRINE_SUCCESS_CHANCE = 0.05;
const PLEDGE_AMOUNT = 100;
const PAINT_COLORS = ["#F4E9D8", "#FF8FB1", "#3F8FD1", "#6BBF4A", "#E8433D", "#F6C945", "#7A5A9E", "#1F2A44"];

/* ---------------- coffee shop (bottom-left corner, beyond the house row) ----------------
   The minigame itself (order taking, grinder/espresso/steaming mechanics,
   scoring) is a separate module dropped in once it's built — see
   GEMINI_PROMPT_coffee_shop.md. This is just the world placement, the
   clock-in/out interaction, and the shift roster/earnings plumbing. */
const COFFEE_SHOP = {
  x: PROPERTY_OFFSET_X - HOUSE_BAND_MID,
  y: PROPERTY_OFFSET_Y + PROPERTY_H + HOUSE_BAND_MID
};
const COFFEE_SHOP_INTERACT_RADIUS = 60;

/* ---------------- car (starts parked on the bottom stretch of the road) ---------------- */
const car = { x: PROPERTY_OFFSET_X + PROPERTY_W / 2, y: PROPERTY_OFFSET_Y + PROPERTY_H + ROAD_H / 2 };
const CAR_OFFROAD_GRACE_FRAMES = 20; // brief buffer so one noisy frame near the curb doesn't insta-jail you

/* ---------------- decorative front-lawn chairs ---------------- */
const lawnChairs = [
  { x: 390, y: 480, color: COLORS.chairSeat },
  { x: 560, y: 490, color: COLORS.chairSeat2 },
  { x: 480, y: 540, color: COLORS.chairSeat }
].map(c => ({ ...c, x: c.x + PROPERTY_OFFSET_X, y: c.y + PROPERTY_OFFSET_Y }));

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

/** Is (x,y) within the ring road that hugs all 4 sides of the property? Used for the DUI-style "left the road" jail rule. */
function isOnRoad(x, y){
  const px0 = PROPERTY_OFFSET_X, py0 = PROPERTY_OFFSET_Y;
  const top = y >= py0 - ROAD_H && y < py0 && x >= 0 && x <= CANVAS_W;
  const bottom = y >= py0 + PROPERTY_H && y < py0 + PROPERTY_H + ROAD_H && x >= 0 && x <= CANVAS_W;
  const left = x >= px0 - ROAD_H && x < px0 && y >= py0 && y <= py0 + PROPERTY_H;
  const right = x >= px0 + PROPERTY_W && x < px0 + PROPERTY_W + ROAD_H && y >= py0 && y <= py0 + PROPERTY_H;
  return top || bottom || left || right;
}

/* ---------------- ten chicks, each with a distinct cosmetic + home roam zone ---------------- */
const ROAD_ROAM_RECTS = {
  top: { x: PROPERTY_OFFSET_X + 20, y: PROPERTY_OFFSET_Y - ROAD_H + 12, w: PROPERTY_W - 40, h: ROAD_H - 24 },
  bottom: { x: PROPERTY_OFFSET_X + 20, y: PROPERTY_OFFSET_Y + PROPERTY_H + 12, w: PROPERTY_W - 40, h: ROAD_H - 24 },
  left: { x: PROPERTY_OFFSET_X - ROAD_H + 12, y: PROPERTY_OFFSET_Y + 20, w: ROAD_H - 24, h: PROPERTY_H - 40 },
  right: { x: PROPERTY_OFFSET_X + PROPERTY_W + 12, y: PROPERTY_OFFSET_Y + 20, w: ROAD_H - 24, h: PROPERTY_H - 40 }
};
const ROAM_ZONES = {
  backyard: offsetRect({ x: 335, y: 35,  w: 290, h: 140 }),
  lawn:     offsetRect({ x: 335, y: 435, w: 290, h: 140 }),
  street:   ROAD_ROAM_RECTS.bottom
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
let canvas, ctx, gameWrapEl;
let stationBtn, chunderClockEl, chunderRingFg, chunderSecondsEl;
let partyFowlBanner, partyFowlTimerEl, jailBanner, jailTimerEl;
let toiletPeeBtn, toiletPoopBtn;
let poolPeeBtn;
let houseModalEl, houseModalTitleEl, houseModalBodyEl;
let closetModalEl, closetGridEl;
let coffeeShopModalEl, coffeeShopBodyEl;
let coffeeMinigameEl, coffeeMinigameContainerEl;

let uid = null;
let displayName = "";
let running = false;
let animId = null;
let tick = 0;
let drunkPhase = 0;

let chatInputBar, chatInputEl;
let chatOpen = false;
let localChatBubble = null; // { text, sentAt }

const SPAWN_X = PROPERTY_OFFSET_X + 400; // inside the house, same relative spot as before the perimeter expansion
const SPAWN_Y = PROPERTY_OFFSET_Y + 240;

let player = { x: SPAWN_X, y: SPAWN_Y, moving: false, carrying: [] };
const keys = new Set();

let stats = {
  protein: 0, baseStrength: 0, strengthBoost: 0, beerLevel: 0, clout: 0, clucks: 0,
  cosmetics: [], merch: [], equipped: { head: null, face: null, neck: null, feet: null },
  trophies: { wolf: 0, cockfight: 0 }, sizeBoosted: false
};
let sizeMultiplier = 1;

let driving = false;
let offRoadFrames = 0;
let hasDroppedKeyThisBinge = false;

let houseModalOpen = false;
let activeHouseId = null;
let closetModalOpen = false;
let coffeeShopModalOpen = false;
let coffeeMinigameOpen = false;
let coffeeMinigame = null;

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
  stats.clucks = (playerData && playerData.clucks) || 0;
  stats.cosmetics = (playerData && playerData.cosmetics) || [];
  stats.merch = (playerData && playerData.merch) || [];
  stats.equipped = (playerData && playerData.equipped) || { head: null, face: null, neck: null, feet: null };
  stats.trophies = (playerData && playerData.trophies) || { wolf: 0, cockfight: 0 };
  stats.sizeBoosted = !!(playerData && playerData.sizeBoosted);
  sizeMultiplier = stats.sizeBoosted ? 2 : 1;
  driving = false;
  offRoadFrames = 0;
  hasDroppedKeyThisBinge = false;
  houseModalOpen = false;
  closetModalOpen = false;
  coffeeShopModalOpen = false;
  activeHouseId = null;
  chunderActive = false;
  chunderFramesLeft = 0;
  partyFowlUntil = 0;
  fowlTimestamps = [];
  jailUntil = 0;
  toiletDisabledUntil = 0;
  player.x = SPAWN_X;
  player.y = SPAWN_Y;
  player.carrying = [];
  chicks.forEach(c => { c.carried = false; });
}

window.addEventListener("cf:authready", (e) => {
  uid = e.detail.uid;
  displayName = e.detail.displayName;
  resetForNewSession(e.detail.playerData);
  initMultiplayer(uid, displayName);
  startFratHouses();
  startCoffeeShop(uid);
  startLoop();
  if (DEBUG) console.log("[ChickenFrat] session ready for", e.detail.displayName);
});

window.addEventListener("cf:signout", () => {
  uid = null;
  stopMultiplayer();
  stopFratHouses();
  stopCoffeeShop();
  if (coffeeMinigame){ coffeeMinigame.stop(); coffeeMinigame = null; }
  coffeeMinigameOpen = false;
  stopLoop();
});

/* ==================== input ==================== */
const MOVE_KEYS = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD"]);

function isTypingTarget(el){
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

document.addEventListener("keydown", (e) => {
  if (chatOpen) return; // let the chat input's own listener handle keys while typing
  if (isTypingTarget(document.activeElement)) return; // sign-in/sign-up fields, or anything else text-entry — never hijack these
  if (e.code === "Enter"){ e.preventDefault(); openChat(); return; }
  if (MOVE_KEYS.has(e.code)) { keys.add(e.code); e.preventDefault(); }
  if (e.code === "Space"){ e.preventDefault(); triggerInteraction(); }
});
document.addEventListener("keyup", (e) => {
  if (chatOpen) return;
  if (isTypingTarget(document.activeElement)) return;
  if (MOVE_KEYS.has(e.code)) keys.delete(e.code);
});

function openChat(){
  if (!running || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen) return;
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
  if (isJailed() || chatOpen || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen){ player.moving = false; return; }

  let dx = 0, dy = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;

  const moving = dx !== 0 || dy !== 0;
  player.moving = moving;
  if (dx !== 0 && dy !== 0){ dx *= 0.7071; dy *= 0.7071; }

  const speed = driving
    ? BASE_SPEED * CAR_SPEED_MULTIPLIER
    : BASE_SPEED * currentSpeedMultiplier() * (playerInPool() ? POOL_SPEED_MULTIPLIER : 1);
  let moveX = dx * speed;
  let moveY = dy * speed;

  if (!driving && moving && stats.beerLevel > DRUNK_DRIFT_THRESHOLD){
    drunkPhase += 0.14;
    const driftFrac = (stats.beerLevel - DRUNK_DRIFT_THRESHOLD) / (BEER_MAX - DRUNK_DRIFT_THRESHOLD);
    const driftMag = driftFrac * DRUNK_DRIFT_MAX;
    moveX += Math.sin(drunkPhase) * driftMag;
    moveY += Math.cos(drunkPhase * 0.8) * driftMag * 0.6;
  }

  player.x = Math.min(CANVAS_W - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, player.x + moveX));
  player.y = Math.min(CANVAS_H - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, player.y + moveY));
}

function playerInPool(){
  return pointInRect(player, POOL_ZONE);
}

/* ==================== interaction targeting (stations + loose chicks) ==================== */
function myHouseId(){
  const houses = getFratHouses();
  for (const id of Object.keys(houses)){
    if (houses[id].ownerUid === uid) return id;
  }
  return null;
}

function findNearestInteractable(){
  if (isJailed() || chatOpen || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen) return null;

  if (driving){
    // only one thing to do while driving: park
    const d = Math.hypot(player.x - car.x, player.y - car.y);
    return d < CAR_INTERACT_RADIUS * 1.6 ? { kind: "car", ref: car } : null;
  }

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
  const carDist = Math.hypot(player.x - car.x, player.y - car.y);
  if (carDist < CAR_INTERACT_RADIUS && carDist < bestDist){ best = { kind: "car", ref: car }; bestDist = carDist; }
  for (const h of fratHouses){
    const d = Math.hypot(player.x - h.x, player.y - h.y);
    if (d < STATION_RADIUS && d < bestDist){ best = { kind: "frathouse", ref: h }; bestDist = d; }
  }
  const coffeeDist = Math.hypot(player.x - COFFEE_SHOP.x, player.y - COFFEE_SHOP.y);
  if (coffeeDist < COFFEE_SHOP_INTERACT_RADIUS && coffeeDist < bestDist){ best = { kind: "coffeeshop", ref: COFFEE_SHOP }; bestDist = coffeeDist; }
  return best;
}

function interactableLabel(hit){
  if (!hit) return "";
  if (hit.kind === "chick"){
    if (player.carrying.length >= carryCapacity()) return "Hands full — drop these off at the house first";
    return `Pick up ${hit.ref.label} chick`;
  }
  if (hit.kind === "car"){
    if (driving) return "Park the car";
    return stats.beerLevel >= DUI_BEER_THRESHOLD ? "Get in the car" : "Drive the car";
  }
  if (hit.kind === "frathouse"){
    const house = getFratHouses()[hit.ref.id] || { ownerUid: null, locked: false };
    if (!house.ownerUid) return `Buy this frat house (${KEY_COST} Clout)`;
    if (house.ownerUid === uid) return "Enter your frat house";
    if (house.locked) return `Locked — ${house.ownerName || "someone"}'s frat house`;
    return `Enter ${house.ownerName || "their"}'s frat house`;
  }
  if (hit.kind === "coffeeshop"){
    return "Coffee Shop — Coming Soon 🚧";
  }
  const s = hit.ref;
  if (s.type === "seed") return "Tap to eat seed";
  if (s.type === "gym") return stats.protein > 0 ? "Tap to lift" : "Nothing to lift — eat seed first";
  if (s.type === "beer") return partyFowlUntil > Date.now() ? "Locked — you're in the doghouse" : "Tap to chug";
  if (s.type === "cockfight") return getCockfightState() === "waiting" ? "Waiting for a challenger... (tap to leave)" : "Enter the Cockfight Ring!";
  return s.label;
}
function interactableDisabled(hit){
  if (!hit) return false;
  if (hit.kind === "chick") return player.carrying.length >= carryCapacity();
  if (hit.kind === "frathouse"){
    const house = getFratHouses()[hit.ref.id] || { ownerUid: null, locked: false };
    return !!house.ownerUid && house.ownerUid !== uid && house.locked;
  }
  if (hit.kind === "coffeeshop"){
    return true; // parked — see "Coming Soon" sign, not ready for players yet
  }
  return false;
}

function triggerInteraction(){
  if (!running || isJailed() || chatOpen || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen || !nearestInteractable) return;

  if (nearestInteractable.kind === "chick"){
    if (player.carrying.length >= carryCapacity()) return;
    const c = nearestInteractable.ref;
    c.carried = true;
    player.carrying.push(c.id);
    if (DEBUG) console.log("[ChickenFrat] picked up chick:", c.label);
    return;
  }

  if (nearestInteractable.kind === "car"){
    toggleCar();
    return;
  }

  if (nearestInteractable.kind === "frathouse"){
    enterOrBuyHouse(nearestInteractable.ref);
    return;
  }

  if (nearestInteractable.kind === "coffeeshop"){
    return; // parked for now — see interactableDisabled/Label above
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

/* ==================== car ==================== */
function toggleCar(){
  if (driving){
    driving = false;
    car.x = player.x;
    car.y = player.y;
    if (DEBUG) console.log("[ChickenFrat] parked the car");
    return;
  }
  if (stats.beerLevel >= DUI_BEER_THRESHOLD){
    sendToJail("DUI");
    showToast(`DUI! Straight to jail (-${JAIL_CLOUT_PENALTY} Clout)`, COLORS.fowlRed);
    if (DEBUG) console.log("[ChickenFrat] tried to drive drunk — straight to jail");
    return;
  }
  driving = true;
  player.x = car.x;
  player.y = car.y;
  if (DEBUG) console.log("[ChickenFrat] started driving");
}

/* ==================== frat houses ==================== */
async function enterOrBuyHouse(house){
  const state = getFratHouses()[house.id] || { ownerUid: null, locked: false };
  if (!state.ownerUid){
    if (stats.clout < KEY_COST){
      showToast(`Need ${KEY_COST} Clout for a key`, COLORS.fowlRed);
      return;
    }
    const result = await buyHouseKey(house.id, uid, displayName);
    if (result.ok){
      stats.clout -= KEY_COST;
      queuePatch({ clout: stats.clout });
      showToast("Bought the key! It's yours now", COLORS.cloutGreen);
    }else{
      showToast("Too slow — someone just bought it", COLORS.fowlRed);
    }
    return;
  }
  if (state.ownerUid !== uid && state.locked) return; // shouldn't happen, button is disabled, but be safe
  activeHouseId = house.id;
  houseModalOpen = true;
  renderHouseModal();
}

/* ==================== coffee shop (world/shift plumbing — minigame itself is a separate module, see GEMINI_PROMPT_coffee_shop.md) ==================== */
function openCoffeeShop(){
  coffeeShopModalOpen = true;
  renderCoffeeShopModal();
  coffeeShopModalEl.hidden = false;
}
function closeCoffeeShopModal(){
  coffeeShopModalOpen = false;
  coffeeShopModalEl.hidden = true;
}

function renderCoffeeShopModal(){
  const roster = getShiftRoster();
  const rosterEntries = Object.entries(roster);
  const onShiftNow = isOnShift();

  let rosterHtml = '<div class="trophy-shelf">';
  if (rosterEntries.length === 0){
    rosterHtml += '<span class="trophy-empty">Nobody\'s clocked in right now.</span>';
  }else{
    rosterHtml += rosterEntries.map(([id, data]) =>
      `<span class="trophy-icon" style="font-size:0.85rem;">☕ ${escapeHTML(data.name || "Chicken")}${id === uid ? " (you)" : ""}</span>`
    ).join("");
  }
  rosterHtml += "</div>";

  let actionHtml;
  if (onShiftNow){
    actionHtml = `
      <button type="button" class="btn" id="coffee-play-btn">Run the Register ☕</button>
      <button type="button" class="btn light" id="coffee-clockout-btn">Clock Out</button>
    `;
  }else if (rosterEntries.length >= 3){
    actionHtml = `<p style="text-align:center; font-size:0.85rem; opacity:0.75;">Shift's full — check back later.</p>`;
  }else{
    actionHtml = `<button type="button" class="btn" id="coffee-clockin-btn">Clock In</button>`;
  }

  coffeeShopBodyEl.innerHTML = `
    <p style="text-align:center; font-size:0.85rem; opacity:0.8;">
      Up to 3 chickens on shift at once, sharing everything the register earns.
      Coffee Clucks: <strong>${Math.floor(stats.clucks)}</strong>
    </p>
    ${rosterHtml}
    <div class="house-actions">${actionHtml}</div>
  `;

  if (onShiftNow){
    document.getElementById("coffee-play-btn").addEventListener("click", openCoffeeMinigame);
    document.getElementById("coffee-clockout-btn").addEventListener("click", async () => {
      await clockOut(uid);
      renderCoffeeShopModal();
    });
  }else if (rosterEntries.length < 3){
    document.getElementById("coffee-clockin-btn").addEventListener("click", async () => {
      const result = await clockIn(uid, displayName);
      if (!result.ok) showToast("Shift just filled up — try again in a bit", COLORS.fowlRed);
      renderCoffeeShopModal();
    });
  }
}

/* ---------------- the actual minigame — see coffee-shop-minigame.js ---------------- */
function openCoffeeMinigame(){
  if (!isOnShift() || coffeeMinigame) return;
  coffeeShopModalEl.hidden = true;
  coffeeMinigameOpen = true;
  coffeeMinigameContainerEl.innerHTML = "";

  coffeeMinigame = new CoffeeShopMinigame(coffeeMinigameContainerEl, {
    localPlayerId: uid,
    isOrderAuthority: getOrderAuthorityUid() === uid
  });

  coffeeMinigame.onStateChange((event) => broadcastMinigameEvent(event));

  coffeeMinigame.onOrderComplete(async ({ value }) => {
    if (value <= 0) return;
    const myShare = await distributeOrderEarnings(value);
    stats.clucks += myShare;
    queuePatch({ clucks: stats.clucks });
    showToast(`Order done! +${myShare.toFixed(1)} Clucks (your share)`, COLORS.cloutGreen);
  });

  coffeeMinigame.start();
  coffeeMinigameEl.hidden = false;
}

function closeCoffeeMinigame(){
  if (coffeeMinigame){
    coffeeMinigame.stop();
    coffeeMinigame = null;
  }
  coffeeMinigameOpen = false;
  coffeeMinigameEl.hidden = true;
  coffeeShopModalOpen = true;
  renderCoffeeShopModal();
  coffeeShopModalEl.hidden = false;
}

/** Relay incoming multiplayer events into the running minigame, and keep order-spawn
    authority up to date in case the current authority clocks out mid-shift. */
function updateCoffeeMinigameSync(){
  if (!coffeeMinigame) return;
  const events = consumeMinigameEvents();
  events.forEach(event => coffeeMinigame.applyRemoteEvent(event));
  coffeeMinigame.setOrderAuthority(getOrderAuthorityUid() === uid);
  if (!isOnShift()) closeCoffeeMinigame(); // e.g. got dropped from shift by someone else's action
}

function updateCoffeeEarnings(){
  const earnings = consumeCoffeeEarnings();
  if (!earnings.length) return;
  let total = 0;
  earnings.forEach(e => { total += e.amount || 0; });
  if (total > 0){
    stats.clucks += total;
    queuePatch({ clucks: stats.clucks });
    showToast(`+${total.toFixed(1)} Clucks from the shift!`, COLORS.cloutGreen);
  }
}

/* ==================== house modal, closet, shrine ==================== */
function escapeHTML(str){
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

function closeHouseModal(){
  houseModalOpen = false;
  activeHouseId = null;
  houseModalEl.hidden = true;
}

function renderHouseModal(){
  const house = getFratHouses()[activeHouseId];
  if (!house){ closeHouseModal(); return; }
  const mine = house.ownerUid === uid;

  houseModalTitleEl.textContent = mine ? "Your Frat House" : `${house.ownerName || "Someone"}'s Frat House`;

  const trophyCount = stats.trophies.wolf + stats.trophies.cockfight;
  let trophyHtml = '<div class="trophy-shelf">';
  if (trophyCount === 0){
    trophyHtml += '<span class="trophy-empty">No trophies on the shelf yet — go win some fights.</span>';
  }else{
    for (let i = 0; i < stats.trophies.cockfight; i++) trophyHtml += '<span class="trophy-icon" title="Cockfight win">🐓🏆</span>';
    for (let i = 0; i < stats.trophies.wolf; i++) trophyHtml += '<span class="trophy-icon" title="Wolf defeated">🐺🏆</span>';
  }
  trophyHtml += "</div>";

  let bodyHtml = trophyHtml;

  if (mine){
    const paintSwatches = PAINT_COLORS.map(c => `
      <button type="button" class="paint-swatch ${house.color === c ? "active" : ""}" data-color="${c}" style="background:${c}" title="${c}"></button>
    `).join("");
    bodyHtml += `
      <div class="house-row">
        <span class="house-owner-badge">Status: ${house.locked ? "🔒 Locked" : "🔓 Unlocked"}</span>
        <button type="button" class="btn-small" id="house-lock-toggle-btn">${house.locked ? "Unlock" : "Lock"}</button>
      </div>
      <div class="paint-row">
        <span class="house-owner-badge">Paint:</span>
        <div class="paint-swatches">${paintSwatches}</div>
      </div>
      <div class="house-actions">
        <button type="button" class="btn" id="house-open-closet-btn">Open the Closet 👕</button>
      </div>
      <div class="shrine-box">
        <p>🐔✨ The Golden Chicken Shrine ✨🐔</p>
        <p>${stats.sizeBoosted ? "You have already been blessed. The chicken god's work here is done." : `Pray for a bigger cock — ${SHRINE_COST} Clout, ${Math.round(SHRINE_SUCCESS_CHANCE * 100)}% chance, once ever.`}</p>
        <button type="button" class="btn" id="house-shrine-btn" ${stats.sizeBoosted ? "disabled" : ""}>Pray</button>
      </div>
    `;
  }else{
    bodyHtml += `
      <p style="text-align:center; font-size:0.82rem; opacity:0.75;">Only ${escapeHTML(house.ownerName || "the owner")} can use the closet or shrine here.</p>
      <div class="house-actions">
        <button type="button" class="btn" id="house-pledge-btn" ${stats.clout < PLEDGE_AMOUNT ? "disabled" : ""}>Pledge ${PLEDGE_AMOUNT} Clout to ${escapeHTML(house.ownerName || "the owner")}</button>
      </div>
    `;
  }

  houseModalBodyEl.innerHTML = bodyHtml;

  if (mine){
    document.getElementById("house-lock-toggle-btn").addEventListener("click", () => toggleHouseLock(house));
    document.getElementById("house-open-closet-btn").addEventListener("click", openCloset);
    document.getElementById("house-shrine-btn").addEventListener("click", prayAtShrine);
    houseModalBodyEl.querySelectorAll(".paint-swatch").forEach(btn => {
      btn.addEventListener("click", () => paintHouse(btn.dataset.color));
    });
  }else{
    const pledgeBtn = document.getElementById("house-pledge-btn");
    if (pledgeBtn) pledgeBtn.addEventListener("click", () => pledgeToHouse(house));
  }

  houseModalEl.hidden = false;
}

async function toggleHouseLock(house){
  const ok = await setHouseLocked(activeHouseId, uid, !house.locked);
  if (ok) renderHouseModal();
}

async function paintHouse(color){
  const ok = await setHouseColor(activeHouseId, uid, color);
  if (ok) renderHouseModal();
}

async function pledgeToHouse(house){
  if (stats.clout < PLEDGE_AMOUNT){
    showToast(`Need ${PLEDGE_AMOUNT} Clout to pledge`, COLORS.fowlRed);
    return;
  }
  stats.clout -= PLEDGE_AMOUNT;
  queuePatch({ clout: stats.clout });
  const ok = await sendPledge(house.ownerUid, house.id, displayName, PLEDGE_AMOUNT);
  if (ok){
    showToast(`Pledged ${PLEDGE_AMOUNT} Clout to ${house.ownerName || "the owner"}!`, COLORS.cloutGreen);
  }else{
    stats.clout += PLEDGE_AMOUNT; // refund — the send itself failed outright
    queuePatch({ clout: stats.clout });
    showToast("Pledge failed — try again", COLORS.fowlRed);
  }
  renderHouseModal();
}

function updatePledges(){
  const pledges = consumePledges();
  if (!pledges.length) return;
  let total = 0;
  pledges.forEach(p => {
    total += p.amount || 0;
    if (DEBUG) console.log("[ChickenFrat] received pledge:", p);
  });
  if (total > 0){
    stats.clout += total;
    queuePatch({ clout: stats.clout });
    const from = pledges.length === 1 ? (pledges[0].fromName || "someone") : `${pledges.length} people`;
    showToast(`+${total} Clout pledged by ${from}!`, COLORS.cloutGreen);
  }
}

async function prayAtShrine(){
  if (stats.sizeBoosted) return;
  if (stats.clout < SHRINE_COST){
    showToast(`Need ${SHRINE_COST} Clout to pray`, COLORS.fowlRed);
    return;
  }
  stats.clout -= SHRINE_COST;
  const blessed = Math.random() < SHRINE_SUCCESS_CHANCE;
  if (blessed){
    stats.sizeBoosted = true;
    sizeMultiplier = 2;
    queuePatch({ clout: stats.clout, sizeBoosted: true });
    showToast("IT WORKED! Blessed by the Golden Chicken — 2x size, forever", COLORS.cloutGreen);
  }else{
    queuePatch({ clout: stats.clout });
    showToast("The Golden Chicken was not impressed. Try again sometime.", COLORS.wallLine);
  }
  renderHouseModal();
}

/* ---------------- closet ---------------- */
function openCloset(){
  closetModalOpen = true;
  renderClosetModal();
  closetModalEl.hidden = false;
}
function closeCloset(){
  closetModalOpen = false;
  closetModalEl.hidden = true;
}

function renderClosetModal(){
  closetGridEl.innerHTML = MERCH_CATALOG.map(item => {
    const owned = stats.merch.includes(item.id);
    const equipped = stats.equipped[item.slot] === item.id;
    const btnLabel = equipped ? "Equipped" : owned ? "Equip" : `Buy (${item.cost})`;
    const disabled = equipped || (!owned && stats.clout < item.cost);
    return `
      <div class="closet-item ${equipped ? "equipped" : ""}">
        <div class="closet-swatch" style="background:${item.color}"></div>
        <div class="closet-item-label">${escapeHTML(item.label)}</div>
        <div class="closet-item-cost">${owned ? "Owned" : item.cost + " Clout"}</div>
        <button type="button" data-item-id="${item.id}" ${disabled ? "disabled" : ""}>${btnLabel}</button>
      </div>
    `;
  }).join("");

  closetGridEl.querySelectorAll("button[data-item-id]").forEach(btn => {
    btn.addEventListener("click", () => handleMerchClick(btn.dataset.itemId));
  });
}

function handleMerchClick(itemId){
  const item = merchById(itemId);
  if (!item) return;
  const owned = stats.merch.includes(item.id);
  if (owned){
    stats.equipped = { ...stats.equipped, [item.slot]: item.id };
    queuePatch({ equipped: stats.equipped });
  }else{
    if (stats.clout < item.cost) return;
    stats.clout -= item.cost;
    stats.merch = [...stats.merch, item.id];
    stats.equipped = { ...stats.equipped, [item.slot]: item.id };
    queuePatch({ clout: stats.clout, merch: stats.merch, equipped: stats.equipped });
    showToast(`Bought ${item.label}!`, COLORS.cloutGreen);
  }
  renderClosetModal();
}

/* ==================== toilet: pee or poop ==================== */
function playerNearBathroom(){
  const bathroom = stations.find(s => s.type === "bathroom");
  return Math.hypot(player.x - bathroom.x, player.y - bathroom.y) < STATION_RADIUS;
}
function doPee(){
  if (!running || isJailed() || chatOpen || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen) return;
  if (isToiletDisabled() || !playerNearBathroom()) return;
  const relief = Math.min(stats.beerLevel, PEE_RELIEF_AMOUNT);
  stats.beerLevel = Math.max(0, stats.beerLevel - PEE_RELIEF_AMOUNT);
  showToast(relief > 0 ? `-${Math.round(relief)} Beer — ahh, relief` : "Nothing to relieve", COLORS.cloutGreen);
  if (DEBUG) console.log("[ChickenFrat] peed — beer level now", stats.beerLevel);
}
function doPoop(){
  if (!running || isJailed() || chatOpen || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen) return;
  if (isToiletDisabled() || !playerNearBathroom()) return;
  toiletDisabledUntil = Date.now() + TOILET_DISABLED_MS;
  triggerPartyFowl("poop");
  showToast("PARTY FOWL! ...and now the toilet's broken", COLORS.fowlRed);
  if (DEBUG) console.log("[ChickenFrat] pooped — instant Party Fowl, toilet out of order for 60s");
}
function doPoolPee(){
  if (!running || isJailed() || chatOpen || houseModalOpen || closetModalOpen || coffeeShopModalOpen || coffeeMinigameOpen) return;
  if (!playerInPool()) return;
  triggerPartyFowl("pool-pee");
  showToast("PARTY FOWL! You peed in the pool", COLORS.fowlRed);
  if (DEBUG) console.log("[ChickenFrat] peed in the pool — instant Party Fowl (surprise!)");
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
function sendToJail(reason){
  jailUntil = Date.now() + JAIL_LOCKOUT_MS;
  fowlTimestamps = [];
  driving = false; // the car gets impounded, you don't drive it into the cell
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

  const cloutLost = Math.min(stats.clout, JAIL_CLOUT_PENALTY);
  stats.clout = Math.max(0, stats.clout - JAIL_CLOUT_PENALTY);
  queuePatch({ clout: stats.clout });

  if (DEBUG) console.log("[ChickenFrat] BOOKED (" + (reason || "party fowls") + ") — locked up for 60s, lost", cloutLost, "Clout");
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
    sendToJail("3 party fowls");
    showToast(`BOOKED! Too many Party Fowls (-${JAIL_CLOUT_PENALTY} Clout)`, COLORS.wallLine);
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
    stats.trophies = { ...stats.trophies, wolf: stats.trophies.wolf + 1 };
    queuePatch({ clout: stats.clout, trophies: stats.trophies });
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
  updateLocalPresence(player.x, player.y, { equipped: stats.equipped, driving, size: sizeMultiplier });
  nearestInteractable = findNearestInteractable();
  updateDelivery();
  updateChunder();
  updateStatDecay();
  updateChicks();
  updateWolves();
  updateWolfEncounters();
  updateCockfight();
  updateKeyDrop();
  updatePledges();
  updateCoffeeEarnings();
  updateCoffeeMinigameSync();
  updateCarRoadCheck();
  if (toast && toast.framesLeft > 0) toast.framesLeft--;
}

function updateCarRoadCheck(){
  if (!driving){ offRoadFrames = 0; return; }
  if (isOnRoad(player.x, player.y)){
    offRoadFrames = 0;
    return;
  }
  offRoadFrames++;
  if (offRoadFrames > CAR_OFFROAD_GRACE_FRAMES){
    sendToJail("left the road");
    showToast(`Busted for leaving the road! (-${JAIL_CLOUT_PENALTY} Clout)`, COLORS.fowlRed);
    if (DEBUG) console.log("[ChickenFrat] drove off the road — straight to jail");
  }
}

function updateKeyDrop(){
  if (stats.beerLevel >= KEY_DROP_BEER_THRESHOLD){
    if (hasDroppedKeyThisBinge) return;
    const houseId = myHouseId();
    if (houseId){
      hasDroppedKeyThisBinge = true;
      dropHouseKey(houseId, uid).then((ok) => {
        if (ok) showToast("You were too drunk and dropped your frat house key!", COLORS.fowlRed);
      });
    }
  }else{
    hasDroppedKeyThisBinge = false;
  }
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
    const item = pickRandomUnownedMerch(stats.merch);
    stats.merch = [...stats.merch, item.id];
    stats.equipped = { ...stats.equipped, [item.slot]: item.id };
    stats.clout += COCKFIGHT_WIN_CLOUT;
    stats.trophies = { ...stats.trophies, cockfight: stats.trophies.cockfight + 1 };
    queuePatch({ clout: stats.clout, merch: stats.merch, equipped: stats.equipped, trophies: stats.trophies });
    showToast(`Won the cockfight! +${COCKFIGHT_WIN_CLOUT} Clout + ${item.label}`, COLORS.cloutGreen);
    if (DEBUG) console.log("[ChickenFrat] cockfight WIN vs", result.opponentName, "- unlocked", item.label);
  }else{
    showToast(`Lost to ${result.opponentName || "a tough bird"} — no big deal`, COLORS.wallLine);
    if (DEBUG) console.log("[ChickenFrat] cockfight loss vs", result.opponentName);
  }
}

function draw(){
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawPerimeter();
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

function drawEquippedMerch(equipped, x, y, bodyR){
  if (!equipped) return;
  ["head", "face", "neck", "feet"].forEach(slot => {
    const id = equipped[slot];
    if (!id) return;
    const item = merchById(id);
    if (item) drawChickCosmetic({ cosmetic: { kind: item.kind, color: item.color } }, x, y, bodyR);
  });
}

function drawRemoteChicken(op){
  const x = op.x, y = op.y;
  const look = op.look || {};
  const scale = look.size === 2 ? 2 : 1;

  if (look.driving){
    drawCarShape(x, y, scale);
    ctx.font = "700 11px 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.wallLine;
    ctx.fillText(op.displayName || "Chicken", x, y - 30 * scale);
    ctx.textAlign = "left";
    return;
  }

  ctx.save();
  if (scale !== 1){ ctx.translate(x, y); ctx.scale(scale, scale); ctx.translate(-x, -y); }

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

  drawEquippedMerch(look.equipped, x, y, PLAYER_RADIUS * 0.9);

  ctx.restore();

  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.wallLine;
  ctx.fillText(op.displayName || "Chicken", x, y - (PLAYER_RADIUS + 8) * scale);
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
function fillRing(d1, d2, color){
  const px0 = PROPERTY_OFFSET_X, py0 = PROPERTY_OFFSET_Y;
  const px1 = px0 + PROPERTY_W, py1 = py0 + PROPERTY_H;
  ctx.fillStyle = color;
  ctx.fillRect(0, py0 - d2, CANVAS_W, d2 - d1);              // top (spans full width, covers both corners)
  ctx.fillRect(0, py1 + d1, CANVAS_W, d2 - d1);              // bottom (spans full width, covers both corners)
  ctx.fillRect(px0 - d2, py0, d2 - d1, PROPERTY_H);          // left (property height only — corners already covered)
  ctx.fillRect(px1 + d1, py0, d2 - d1, PROPERTY_H);          // right
}

function drawLaneLines(){
  const px0 = PROPERTY_OFFSET_X, py0 = PROPERTY_OFFSET_Y;
  const px1 = px0 + PROPERTY_W, py1 = py0 + PROPERTY_H;
  ctx.strokeStyle = COLORS.laneLine;
  ctx.lineWidth = 4;
  ctx.setLineDash([26, 18]);
  ctx.beginPath();
  ctx.moveTo(px0 - ROAD_H, py0 - ROAD_H / 2); ctx.lineTo(px1 + ROAD_H, py0 - ROAD_H / 2);
  ctx.moveTo(px0 - ROAD_H, py1 + ROAD_H / 2); ctx.lineTo(px1 + ROAD_H, py1 + ROAD_H / 2);
  ctx.moveTo(px0 - ROAD_H / 2, py0 - ROAD_H); ctx.lineTo(px0 - ROAD_H / 2, py1 + ROAD_H);
  ctx.moveTo(px1 + ROAD_H / 2, py0 - ROAD_H); ctx.lineTo(px1 + ROAD_H / 2, py1 + ROAD_H);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPropertyFence(){
  const px0 = PROPERTY_OFFSET_X, py0 = PROPERTY_OFFSET_Y;
  const px1 = px0 + PROPERTY_W, py1 = py0 + PROPERTY_H;
  ctx.fillStyle = COLORS.fence;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 1.5;
  for (let x = px0 + 6; x < px1; x += 22){
    ctx.fillRect(x, py0 - 2, 8, 16); ctx.strokeRect(x, py0 - 2, 8, 16);   // top edge
    ctx.fillRect(x, py1 - 14, 8, 16); ctx.strokeRect(x, py1 - 14, 8, 16); // bottom edge
  }
  for (let y = py0 + 6; y < py1; y += 22){
    ctx.fillRect(px0 - 2, y, 16, 8); ctx.strokeRect(px0 - 2, y, 16, 8);   // left edge
    ctx.fillRect(px1 - 14, y, 16, 8); ctx.strokeRect(px1 - 14, y, 16, 8); // right edge
  }
}

function drawPerimeter(){
  fillRing(ROAD_H + SIDEWALK_H, ROAD_H + SIDEWALK_H + HOUSE_ROW_H, COLORS.houseRowBg);
  fillRing(ROAD_H, ROAD_H + SIDEWALK_H, COLORS.sidewalk);
  fillRing(0, ROAD_H, COLORS.street);
  drawLaneLines();
  drawPropertyFence();

  fratHouses.forEach(drawFratHouse);
  drawCoffeeShop();
  drawCar();
  chicks.forEach(c => { if (!c.carried && c.roamRect === ROAM_ZONES.street) drawChick(c); });
}

function drawCoffeeShop(){
  const { x, y } = COFFEE_SHOP;
  const w = 100, h = 60;

  ctx.fillStyle = COLORS.coffeeWall;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);

  // striped awning
  ctx.fillStyle = COLORS.coffeeAwning;
  ctx.fillRect(x - w / 2 - 6, y - h / 2 - 14, w + 12, 16);
  ctx.strokeRect(x - w / 2 - 6, y - h / 2 - 14, w + 12, 16);
  ctx.fillStyle = COLORS.coffeeRoof;
  for (let i = 0; i < 6; i++){
    ctx.fillRect(x - w / 2 - 6 + i * ((w + 12) / 6), y - h / 2 - 14, (w + 12) / 12, 16);
  }

  ctx.fillStyle = COLORS.door;
  ctx.fillRect(x - 14, y + h / 2 - 26, 28, 26);

  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("☕", x, y - h / 2 - 22);

  // Red "Coming Soon" sign, hanging off the awning — the shop isn't playable yet
  const signW = 96, signH = 20;
  const signY = y - h / 2 - 34;
  ctx.fillStyle = COLORS.fowlRed;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.fillRect(x - signW / 2, signY, signW, signH);
  ctx.strokeRect(x - signW / 2, signY, signW, signH);
  // little chains connecting the sign to the awning
  ctx.beginPath();
  ctx.moveTo(x - signW / 2 + 8, signY); ctx.lineTo(x - w / 2 + 4, y - h / 2 - 14);
  ctx.moveTo(x + signW / 2 - 8, signY); ctx.lineTo(x + w / 2 - 4, y - h / 2 - 14);
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.fillText("COMING SOON", x, signY + signH / 2 + 4);

  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.fillStyle = COLORS.wallLine;
  ctx.fillText("Coffee Shop", x, y + h / 2 + 16);
  ctx.textAlign = "left";
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

/* ---------------- car ---------------- */
function drawCarShape(x, y, scale = 1){
  const w = 44 * scale, h = 26 * scale;
  ctx.fillStyle = COLORS.carBody;
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h / 2 + 6 * scale);
  ctx.lineTo(x - w / 2 + 8 * scale, y - h / 2);
  ctx.lineTo(x + w / 2 - 8 * scale, y - h / 2);
  ctx.lineTo(x + w / 2, y - h / 2 + 6 * scale);
  ctx.lineTo(x + w / 2, y + h / 2);
  ctx.lineTo(x - w / 2, y + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.carWindow;
  ctx.fillRect(x - w / 2 + 10 * scale, y - h / 2 + 3 * scale, w * 0.55, h * 0.4);

  ctx.fillStyle = COLORS.carWheel;
  ctx.beginPath(); ctx.arc(x - w * 0.28, y + h / 2, 5 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w * 0.28, y + h / 2, 5 * scale, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = COLORS.carBodyDark;
  ctx.fillRect(x - w / 2, y + h / 2 - 3 * scale, w, 3 * scale);
}

function drawCar(){
  if (driving) return; // drawn as part of the player instead while driving
  drawCarShape(car.x, car.y);
}

/* ---------------- frat houses ---------------- */
function drawFratHouse(house){
  const state = getFratHouses()[house.id] || { ownerUid: null, ownerName: null, locked: false, color: null };
  const owned = !!state.ownerUid;
  const mine = state.ownerUid === uid;
  const { x, y } = house;

  ctx.fillStyle = owned ? (state.color || COLORS.fratHouseWall) : COLORS.fratHouseWallLocked;
  ctx.fillRect(x - 42, y - 24, 84, 48);
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 42, y - 24, 84, 48);

  ctx.fillStyle = COLORS.fratHouseRoof;
  ctx.beginPath();
  ctx.moveTo(x - 48, y - 24);
  ctx.lineTo(x, y - 46);
  ctx.lineTo(x + 48, y - 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.door;
  ctx.fillRect(x - 10, y, 20, 24);

  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  if (!owned){
    ctx.fillText("🔑", x, y - 30);
  }else if (state.locked && !mine){
    ctx.fillText("🔒", x, y - 30);
  }else if (mine){
    ctx.fillText("⭐", x, y - 30);
  }

  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.fillStyle = COLORS.wallLine;
  ctx.fillText(owned ? (state.ownerName || "Owned") : "For Sale", x, y - 52);
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
  }else if (kind === "chain"){
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y + bodyR * 0.5, bodyR * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y + bodyR * 0.98, bodyR * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }else if (kind === "shoes"){
    ctx.fillStyle = color;
    ctx.strokeStyle = COLORS.wallLine;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x - bodyR * 0.4, y + bodyR * 1.5, bodyR * 0.32, bodyR * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x + bodyR * 0.4, y + bodyR * 1.5, bodyR * 0.32, bodyR * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

/* ---------------- player ---------------- */
function drawPlayer(){
  const x = player.x;
  const y = player.y;

  if (driving){
    drawCarShape(x, y);
    return;
  }

  const wobble = stats.beerLevel > 40 ? Math.sin(Date.now() / 90) * (stats.beerLevel / 100) * 4 : 0;
  const drawX = x + wobble;

  ctx.save();
  if (sizeMultiplier !== 1){ ctx.translate(x, y); ctx.scale(sizeMultiplier, sizeMultiplier); ctx.translate(-x, -y); }

  const legSwing = player.moving ? (Math.floor(tick / 6) % 2 === 0 ? 5 : -5) : 0;
  ctx.strokeStyle = COLORS.chickenLeg; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(drawX - 6, y + PLAYER_RADIUS * 0.7);
  ctx.lineTo(drawX - 6 + legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 10);
  ctx.moveTo(drawX + 6, y + PLAYER_RADIUS * 0.7);
  ctx.lineTo(drawX + 6 - legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 10);
  ctx.stroke();
  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  ctx.ellipse(drawX - 6 + legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 11, 4, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(drawX + 6 - legSwing * 0.3, y + PLAYER_RADIUS * 0.7 + 11, 4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isJailed()){
    ctx.globalAlpha = 0.6; // visually "behind bars"
  }

  ctx.fillStyle = COLORS.chickenBody;
  ctx.beginPath();
  ctx.ellipse(drawX, y, PLAYER_RADIUS, PLAYER_RADIUS * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(31,42,68,0.25)"; ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(31,42,68,0.12)";
  ctx.beginPath();
  ctx.ellipse(drawX - 4, y + 2, 8, 11, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.chickenComb;
  ctx.beginPath();
  ctx.moveTo(drawX - 6, y - PLAYER_RADIUS + 2);
  ctx.lineTo(drawX - 2, y - PLAYER_RADIUS - 8);
  ctx.lineTo(drawX + 2, y - PLAYER_RADIUS + 2);
  ctx.lineTo(drawX + 6, y - PLAYER_RADIUS - 6);
  ctx.lineTo(drawX + 9, y - PLAYER_RADIUS + 3);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = COLORS.chickenBeak;
  ctx.beginPath();
  ctx.moveTo(drawX + PLAYER_RADIUS - 4, y);
  ctx.lineTo(drawX + PLAYER_RADIUS + 8, y + 3);
  ctx.lineTo(drawX + PLAYER_RADIUS - 4, y + 7);
  ctx.closePath(); ctx.fill();

  drawEquippedMerch(stats.equipped, drawX, y, PLAYER_RADIUS);

  ctx.globalAlpha = 1;
  ctx.restore();

  const n = player.carrying.length;
  player.carrying.forEach((id, i) => {
    const c = chicks.find(ch => ch.id === id);
    const bob = Math.sin(tick / 10 + i) * 2;
    const spacing = 16;
    const startX = x - ((n - 1) * spacing) / 2;
    drawChick(c, 0.8, startX + i * spacing, y - PLAYER_RADIUS * sizeMultiplier - 20 + bob);
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
/** Convert a point in game/canvas coordinates to actual on-screen CSS pixels relative to #game-wrap.
    Necessary because the canvas is rendered at a fixed internal resolution (CANVAS_W x CANVAS_H) but
    CSS (max-width/max-height: 100%) can scale it down to fit the viewport — without this conversion,
    popups positioned using raw game coordinates drift further off-target the more the canvas is scaled
    down, which is especially visible for anything near the outer edge (like the frat houses). */
function canvasPos(x, y){
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = gameWrapEl.getBoundingClientRect();
  const scaleX = canvasRect.width / CANVAS_W;
  const scaleY = canvasRect.height / CANVAS_H;
  return {
    left: (canvasRect.left - wrapRect.left) + x * scaleX,
    top: (canvasRect.top - wrapRect.top) + y * scaleY
  };
}
function positionEl(el, x, y){
  const p = canvasPos(x, y);
  el.style.left = p.left + "px";
  el.style.top = p.top + "px";
}

function syncHud(){
  document.getElementById("meter-protein-fill").style.width = (stats.protein / PROTEIN_MAX * 100) + "%";
  document.getElementById("meter-protein-value").textContent = Math.floor(stats.protein);
  document.getElementById("meter-beer-fill").style.width = (stats.beerLevel / BEER_MAX * 100) + "%";
  document.getElementById("meter-beer-value").textContent = Math.floor(stats.beerLevel);
  document.getElementById("meter-strength-value").textContent = Math.floor(stats.baseStrength + stats.strengthBoost);
  document.getElementById("meter-clout-value").textContent = Math.floor(stats.clout);
  document.getElementById("trophy-value").textContent = stats.trophies.wolf + stats.trophies.cockfight;
  document.getElementById("meter-clucks-value").textContent = Math.floor(stats.clucks);

  const nearBathroomStation = nearestInteractable && nearestInteractable.kind === "station" && nearestInteractable.ref.type === "bathroom";

  if (nearBathroomStation && !isJailed() && !houseModalOpen && !closetModalOpen && !coffeeShopModalOpen && !coffeeMinigameOpen){
    const s = nearestInteractable.ref;
    if (isToiletDisabled()){
      stationBtn.hidden = false;
      stationBtn.textContent = "Toilet out of order (" + Math.ceil((toiletDisabledUntil - Date.now()) / 1000) + "s)";
      positionEl(stationBtn, s.x, s.y);
      stationBtn.disabled = true;
      toiletPeeBtn.hidden = true;
      toiletPoopBtn.hidden = true;
    }else{
      stationBtn.hidden = true;
      toiletPeeBtn.hidden = false;
      positionEl(toiletPeeBtn, s.x, s.y);
      toiletPoopBtn.hidden = false;
      positionEl(toiletPoopBtn, s.x, s.y - 46);
    }
  }else if (nearestInteractable && !isJailed()){
    stationBtn.hidden = false;
    const anchor = nearestInteractable.ref;
    stationBtn.textContent = interactableLabel(nearestInteractable);
    positionEl(stationBtn, anchor.x, anchor.y);
    stationBtn.disabled = interactableDisabled(nearestInteractable);
    toiletPeeBtn.hidden = true;
    toiletPoopBtn.hidden = true;
  }else{
    stationBtn.hidden = true;
    toiletPeeBtn.hidden = true;
    toiletPoopBtn.hidden = true;
  }

  if (playerInPool() && !isJailed() && !chatOpen && !houseModalOpen && !closetModalOpen && !coffeeShopModalOpen && !coffeeMinigameOpen){
    poolPeeBtn.hidden = false;
    positionEl(poolPeeBtn, player.x, player.y - 30);
  }else{
    poolPeeBtn.hidden = true;
  }

  if (chunderActive){
    chunderClockEl.hidden = false;
    positionEl(chunderClockEl, player.x - 37, player.y - 100);
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
  gameWrapEl = document.getElementById("game-wrap");
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
  poolPeeBtn = document.getElementById("pool-pee-btn");
  houseModalEl = document.getElementById("house-modal");
  houseModalTitleEl = document.getElementById("house-modal-title");
  houseModalBodyEl = document.getElementById("house-modal-body");
  closetModalEl = document.getElementById("closet-modal");
  closetGridEl = document.getElementById("closet-grid");

  coffeeShopModalEl = document.getElementById("coffee-shop-modal");
  coffeeShopBodyEl = document.getElementById("coffee-shop-body");
  coffeeMinigameEl = document.getElementById("coffee-minigame-overlay");
  coffeeMinigameContainerEl = document.getElementById("coffee-minigame-container");

  stationBtn.addEventListener("click", triggerInteraction);
  toiletPeeBtn.addEventListener("click", doPee);
  toiletPoopBtn.addEventListener("click", doPoop);
  poolPeeBtn.addEventListener("click", doPoolPee);
  document.getElementById("house-modal-close-btn").addEventListener("click", closeHouseModal);
  document.getElementById("closet-close-btn").addEventListener("click", closeCloset);
  document.getElementById("coffee-shop-close-btn").addEventListener("click", closeCoffeeShopModal);
  document.getElementById("coffee-minigame-close-btn").addEventListener("click", closeCoffeeMinigame);

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (coffeeMinigameOpen){ closeCoffeeMinigame(); }
    else if (closetModalOpen){ closeCloset(); }
    else if (coffeeShopModalOpen){ closeCoffeeShopModal(); }
    else if (houseModalOpen){ closeHouseModal(); }
  });

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
