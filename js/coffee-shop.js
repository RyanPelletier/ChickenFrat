/* =====================================================================
   COFFEE SHOP (Realtime Database)
   Handles the "shift" roster (up to 3 players clocked in at once) and
   splitting order earnings across whoever's on shift when an order
   completes. Lives in Realtime Database, not Firestore, because shift
   membership changes at gameplay speed (clocking in/out) and needs
   every on-shift player's screen to agree on who's currently working.

   Earnings distribution reuses the exact same "peer writes into your
   inbox, you claim it yourself" pattern already established for house
   pledges and Cockfight Ring results: nobody's client ever writes
   Clucks directly into another player's Firestore document. Whoever
   completes an order credits their own share locally and drops a
   message in each other on-shift player's earnings inbox; each of
   those players' own client picks it up and credits themselves.

   Data shape:
     /coffeeShop/shift/{uid} = { name, joinedAt }        (max 3 keys)
     /coffeeShopEarnings/{uid}/{pushId} = { amount, at }
     /coffeeShop/events/{pushId} = { ...minigame event, playerId, at }

   The minigame itself (js/coffee-shop-minigame.js) doesn't know about Firebase
   at all — this module relays its onStateChange events to other on-shift
   players via /coffeeShop/events, and feeds incoming events back into each
   client's own applyRemoteEvent(). Order-spawning authority (so 3 clients
   don't each spawn their own divergent order queue) is resolved the same
   deterministic way as everything else here: whoever's been on shift longest.

   game.js doesn't touch Firebase directly — it calls the functions
   below and reads getShiftRoster() / consumeCoffeeEarnings() each frame.
   ===================================================================== */

import { rtdb, isRealtimeDbConfigured } from "./firebase-init.js";
import {
  ref, remove, get, onValue, onChildAdded, onDisconnect, runTransaction, push,
  query, orderByChild, startAt
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const MAX_SHIFT_SIZE = 3;

let currentUid = null;
let shiftUnsubscribe = null;
let earningsUnsubscribe = null;
let minigameEventsUnsubscribe = null;
let shiftRosterCache = {};
let incomingEarnings = [];
let incomingMinigameEvents = [];
let onShift = false;

export function isCoffeeShopAvailable(){
  return isRealtimeDbConfigured;
}

export function startCoffeeShop(uid){
  if (!isRealtimeDbConfigured) return;
  currentUid = uid;
  shiftRosterCache = {};
  incomingEarnings = [];
  incomingMinigameEvents = [];
  onShift = false;

  shiftUnsubscribe = onValue(ref(rtdb, "coffeeShop/shift"), (snap) => {
    shiftRosterCache = snap.val() || {};
    onShift = !!shiftRosterCache[uid];
  });

  const myEarningsRef = ref(rtdb, `coffeeShopEarnings/${uid}`);
  earningsUnsubscribe = onValue(myEarningsRef, (snap) => {
    const val = snap.val() || {};
    Object.entries(val).forEach(([id, data]) => {
      if (!data) return;
      incomingEarnings.push(data);
      remove(ref(rtdb, `coffeeShopEarnings/${uid}/${id}`)).catch(() => {});
    });
  });

  // Only ever want events from this point forward — a fresh session shouldn't
  // replay a stale minigame history from an earlier shift.
  const sessionStartAt = Date.now();
  const eventsQuery = query(ref(rtdb, "coffeeShop/events"), orderByChild("at"), startAt(sessionStartAt));
  minigameEventsUnsubscribe = onChildAdded(eventsQuery, (snap) => {
    const data = snap.val();
    if (!data || data.playerId === currentUid) return; // don't echo our own actions back to ourselves
    incomingMinigameEvents.push(data);
  });
}

export function stopCoffeeShop(){
  if (shiftUnsubscribe){ shiftUnsubscribe(); shiftUnsubscribe = null; }
  if (earningsUnsubscribe){ earningsUnsubscribe(); earningsUnsubscribe = null; }
  if (minigameEventsUnsubscribe){ minigameEventsUnsubscribe(); minigameEventsUnsubscribe = null; }
  if (currentUid && onShift) clockOut(currentUid);
  currentUid = null;
  shiftRosterCache = {};
  incomingEarnings = [];
  incomingMinigameEvents = [];
  onShift = false;
}

export function getShiftRoster(){
  return shiftRosterCache;
}
export function isOnShift(){
  return onShift;
}
export function shiftSize(){
  return Object.keys(shiftRosterCache).length;
}

export async function clockIn(uid, name){
  if (!isRealtimeDbConfigured) return { ok: false, reason: "not-configured" };
  const shiftRef = ref(rtdb, "coffeeShop/shift");
  try{
    const result = await runTransaction(shiftRef, (current) => {
      const roster = current || {};
      if (roster[uid]) return roster; // already on shift, no-op
      if (Object.keys(roster).length >= MAX_SHIFT_SIZE) return; // abort — shift is full
      return { ...roster, [uid]: { name, joinedAt: Date.now() } };
    });
    if (result.committed){
      onDisconnect(ref(rtdb, `coffeeShop/shift/${uid}`)).remove();
      return { ok: true };
    }
    return { ok: false, reason: "full" };
  }catch(err){
    console.error("[ChickenFrat] clockIn failed:", err);
    return { ok: false, reason: "error" };
  }
}

export async function clockOut(uid){
  if (!isRealtimeDbConfigured) return;
  try{
    await remove(ref(rtdb, `coffeeShop/shift/${uid}`));
  }catch(err){ console.error("[ChickenFrat] clockOut failed:", err); }
}

/** Call when an order completes with `value` Clucks — splits it across whoever's on shift right now.
    Returns the caller's own share (credit it locally); everyone else's share is delivered to their inbox. */
export async function distributeOrderEarnings(value){
  const roster = Object.keys(shiftRosterCache);
  if (roster.length === 0) return value; // shouldn't happen — you have to be on shift to run the register
  const share = value / roster.length;
  const others = roster.filter(id => id !== currentUid);
  await Promise.all(others.map(otherUid =>
    push(ref(rtdb, `coffeeShopEarnings/${otherUid}`), { amount: share, at: Date.now() }).catch((err) => {
      console.error("[ChickenFrat] failed to pay shift-mate:", err);
    })
  ));
  return share;
}

/** Call once per frame (cheap) — returns any newly-arrived earnings (from shift-mates) and clears them. */
export function consumeCoffeeEarnings(){
  const e = incomingEarnings;
  incomingEarnings = [];
  return e;
}

/** Deterministic pick, computable independently by every on-shift client from the same
    synced roster: whoever's been on shift longest is the one whose local minigame instance
    is allowed to spawn new orders. Avoids every client spawning its own divergent queue. */
export function getOrderAuthorityUid(){
  const entries = Object.entries(shiftRosterCache);
  if (entries.length === 0) return null;
  entries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  return entries[0][0];
}
export function isOrderAuthority(uid){
  return getOrderAuthorityUid() === uid;
}

/** Broadcast a minigame state-change event to whoever else is on shift. Opportunistically
    prunes events older than a minute so this list doesn't grow unbounded over a long session. */
export async function broadcastMinigameEvent(event){
  if (!isRealtimeDbConfigured || !currentUid) return;
  try{
    await push(ref(rtdb, "coffeeShop/events"), { ...event, playerId: currentUid, at: Date.now() });
    pruneOldMinigameEvents();
  }catch(err){
    console.error("[ChickenFrat] broadcastMinigameEvent failed:", err);
  }
}

let lastPruneAt = 0;
async function pruneOldMinigameEvents(){
  const now = Date.now();
  if (now - lastPruneAt < 15000) return; // throttle — no need to check this on every single event
  lastPruneAt = now;
  try{
    const cutoff = now - 60000;
    const staleQuery = query(ref(rtdb, "coffeeShop/events"), orderByChild("at"));
    const snap = await get(staleQuery);
    const val = snap.val() || {};
    const deletions = Object.entries(val)
      .filter(([, data]) => data && data.at < cutoff)
      .map(([id]) => remove(ref(rtdb, `coffeeShop/events/${id}`)).catch(() => {}));
    await Promise.all(deletions);
  }catch(err){
    console.error("[ChickenFrat] pruneOldMinigameEvents failed:", err);
  }
}

/** Call once per frame (cheap) — returns any newly-arrived relayed minigame events and clears them. */
export function consumeMinigameEvents(){
  const e = incomingMinigameEvents;
  incomingMinigameEvents = [];
  return e;
}
