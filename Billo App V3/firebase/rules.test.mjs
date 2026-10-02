/* Billo Firestore rules tests — run with the emulator:
     cd firebase && npm install && npm test
   (needs Java 11+; `firebase emulators:exec` starts and stops the emulator for you) */
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, arrayUnion } from 'firebase/firestore';

let env;
const TRIP = 'tripSECRETabc123xyz';
const CODE = 'GOA-7K2Q-X9MB';
const meta = uid => ({
  name: 'Goa Trip', emoji: '🏖️', currency: 'INR', code: CODE, budget: null, days: null,
  members: { m1: { name: 'Jay' }, m2: { name: 'Rahul' } }, uids: [uid], createdBy: uid, createdAt: 1, updatedAt: 1, v: 1
});
const bill = (uid, extra) => Object.assign({
  id: 'e1', amount: 800, desc: 'Cab', payerId: 'm1', parts: ['m1', 'm2'], cat: 'cab', ts: 1, updatedBy: uid, deleted: false
}, extra || {});

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-billo', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const db = uid => env.authenticatedContext(uid).firestore();
async function seedTrip() {
  await assertSucceeds(setDoc(doc(db('jay'), 'trips', TRIP), meta('jay')));
  await assertSucceeds(setDoc(doc(db('jay'), 'codes', CODE), { tripId: TRIP, createdBy: 'jay', createdAt: 1 }));
}

test('creator can create a trip, its code and bills', async () => {
  await seedTrip();
  await assertSucceeds(setDoc(doc(db('jay'), 'trips', TRIP, 'expenses', 'e1'), bill('jay')));
});

test('signed-out users can do nothing', async () => {
  await seedTrip();
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, 'codes', CODE)));
  await assertFails(getDoc(doc(anon, 'trips', TRIP)));
});

test('codes can be looked up but never listed, changed or deleted', async () => {
  await seedTrip();
  await assertSucceeds(getDoc(doc(db('rahul'), 'codes', CODE)));
  await assertFails(getDocs(collection(db('rahul'), 'codes')));
  await assertFails(setDoc(doc(db('rahul'), 'codes', CODE), { tripId: 'mine', createdBy: 'rahul', createdAt: 2 }));
  await assertFails(deleteDoc(doc(db('jay'), 'codes', CODE)));
});

test('cannot mint a code for someone else’s trip', async () => {
  await seedTrip();
  await assertFails(setDoc(doc(db('eve'), 'codes', 'EVE-2222-3333'), { tripId: TRIP, createdBy: 'eve', createdAt: 1 }));
});

test('outsiders cannot read a trip or its bills', async () => {
  await seedTrip();
  await setDoc(doc(db('jay'), 'trips', TRIP, 'expenses', 'e1'), bill('jay'));
  await assertFails(getDoc(doc(db('eve'), 'trips', TRIP)));
  await assertFails(getDocs(collection(db('eve'), 'trips', TRIP, 'expenses')));
  await assertFails(getDocs(collection(db('eve'), 'trips')));
});

test('joining adds exactly yourself, then you can read and write', async () => {
  await seedTrip();
  await assertSucceeds(updateDoc(doc(db('rahul'), 'trips', TRIP), { uids: arrayUnion('rahul'), updatedAt: 2 }));
  await assertSucceeds(getDoc(doc(db('rahul'), 'trips', TRIP)));
  await assertSucceeds(setDoc(doc(db('rahul'), 'trips', TRIP, 'expenses', 'e2'), bill('rahul', { id: 'e2' })));
});

test('a joiner cannot sneak in other changes or other people', async () => {
  await seedTrip();
  await assertFails(updateDoc(doc(db('eve'), 'trips', TRIP), { uids: arrayUnion('eve'), name: 'Pwned' }));
  await assertFails(updateDoc(doc(db('eve'), 'trips', TRIP), { uids: arrayUnion('eve', 'mallory') }));
});

test('members cannot kick others, change the code or the creator', async () => {
  await seedTrip();
  await updateDoc(doc(db('rahul'), 'trips', TRIP), { uids: arrayUnion('rahul') });
  await assertFails(updateDoc(doc(db('rahul'), 'trips', TRIP), { uids: ['rahul'] }));
  await assertFails(updateDoc(doc(db('rahul'), 'trips', TRIP), { code: 'NEW-2222-3333' }));
  await assertFails(updateDoc(doc(db('rahul'), 'trips', TRIP), { createdBy: 'rahul' }));
  await assertSucceeds(updateDoc(doc(db('rahul'), 'trips', TRIP), { 'members.m2.upi': 'rahul@ybl', updatedAt: 3 }));
  await assertSucceeds(updateDoc(doc(db('rahul'), 'trips', TRIP), { uids: ['jay'] }));   // leaving is fine
});

test('bills: must be stamped with your uid, no photos, no hard deletes', async () => {
  await seedTrip();
  const ref = doc(db('jay'), 'trips', TRIP, 'expenses', 'e1');
  await assertFails(setDoc(ref, bill('someone-else')));
  await assertFails(setDoc(ref, bill('jay', { img: 'data:image/jpeg;base64,AAAA' })));
  await assertFails(setDoc(ref, bill('jay', { amount: -5 })));
  await assertFails(setDoc(ref, bill('jay', { id: 'other' })));
  await assertSucceeds(setDoc(ref, bill('jay')));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(setDoc(ref, bill('jay', { deleted: true })));
});

test('payments are member-only', async () => {
  await seedTrip();
  const p = { id: 'p1', from: 'm2', to: 'm1', amount: 400, ts: 1, updatedBy: 'jay', deleted: false };
  await assertSucceeds(setDoc(doc(db('jay'), 'trips', TRIP, 'payments', 'p1'), p));
  await assertFails(setDoc(doc(db('eve'), 'trips', TRIP, 'payments', 'p2'), Object.assign({}, p, { id: 'p2', updatedBy: 'eve' })));
});
