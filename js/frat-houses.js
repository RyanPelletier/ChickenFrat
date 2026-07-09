/* =====================================================================
   FRAT HOUSES (Firestore)
   Shared, cross-player state — who owns which house and whether it's
   locked. This lives in Firestore, not Realtime Database, deliberately:
   ownership changes are rare (buy/lock/unlock/drop), not high-frequency
   like position, so Firestore's per-read/write billing is the cheaper,
   more appropriate fit here — the opposite tradeoff from multiplayer.js.

   Buying a house uses a Firestore transaction so two players clicking
   "buy" on the same unowned house at the same instant can't both win it.

   game.js doesn't touch Firestore directly for this — it calls the
   functions below and reads getFratHouses() each frame.
   ===================================================================== */

import { db, isFirebaseConfigured } from "./firebase-init.js";
import {
  doc, collection, onSnapshot, runTransaction, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const HOUSE_IDS = Array.from({ length: 16 }, (_, i) => `house${i + 1}`);

let housesCache = {};
let unsubscribe = null;

function defaultHouse(){
  return { ownerUid: null, ownerName: null, locked: false, color: null };
}

export function startFratHouses(){
  if (!isFirebaseConfigured) return;
  const seeded = {};
  HOUSE_IDS.forEach(id => { seeded[id] = defaultHouse(); });
  housesCache = seeded;

  unsubscribe = onSnapshot(collection(db, "fratHouses"), (snap) => {
    const next = {};
    HOUSE_IDS.forEach(id => { next[id] = defaultHouse(); });
    snap.forEach(d => { next[d.id] = { ...defaultHouse(), ...d.data() }; });
    housesCache = next;
  }, (err) => console.error("[ChickenFrat] frat house sync failed:", err));
}

export function stopFratHouses(){
  if (unsubscribe){ unsubscribe(); unsubscribe = null; }
  housesCache = {};
}

/** Returns { houseId: {ownerUid, ownerName, locked} } for all houses. */
export function getFratHouses(){
  return housesCache;
}

export async function buyHouseKey(houseId, uid, displayName){
  if (!isFirebaseConfigured) return { ok: false, reason: "not-configured" };
  const ref = doc(db, "fratHouses", houseId);
  try{
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : defaultHouse();
      if (data.ownerUid){
        return { ok: false, reason: "taken" };
      }
      tx.set(ref, { ownerUid: uid, ownerName: displayName, locked: false });
      return { ok: true };
    });
  }catch(err){
    console.error("[ChickenFrat] buyHouseKey failed:", err);
    return { ok: false, reason: "error" };
  }
}

export async function setHouseLocked(houseId, uid, locked){
  const ref = doc(db, "fratHouses", houseId);
  try{
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().ownerUid !== uid) return false;
    await updateDoc(ref, { locked });
    return true;
  }catch(err){
    console.error("[ChickenFrat] setHouseLocked failed:", err);
    return false;
  }
}

export async function setHouseColor(houseId, uid, color){
  const ref = doc(db, "fratHouses", houseId);
  try{
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().ownerUid !== uid) return false;
    await updateDoc(ref, { color });
    return true;
  }catch(err){
    console.error("[ChickenFrat] setHouseColor failed:", err);
    return false;
  }
}

/** Called when a player gets too drunk while owning a house — clears ownership. */
export async function dropHouseKey(houseId, uid){
  const ref = doc(db, "fratHouses", houseId);
  try{
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().ownerUid !== uid) return false;
    await updateDoc(ref, { ownerUid: null, ownerName: null, locked: false });
    return true;
  }catch(err){
    console.error("[ChickenFrat] dropHouseKey failed:", err);
    return false;
  }
}
