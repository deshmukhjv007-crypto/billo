/* Billo live sync — Firestore adapter.
   Bundled (with the Firebase SDK) into app/sync/firebase.js by `npm run build` in this folder,
   so the app never loads code from a CDN and keeps working offline.

   The app only ever talks to this small interface (the same one test/fake-backend.js implements):
     ready()                              → Promise<uid>          anonymous sign-in, persisted
     createTrip(id, meta, code, docs)     → Promise               trip doc, then bills/payments + code
     lookup(code)                         → Promise<tripId|null>
     join(id)                             → Promise<meta>         adds this install's uid to the trip
     watch(id, cb)                        → unsubscribe()         cb({part, data, info}) | cb({error})
     apply(id, ops)                       → Promise               queued offline, synced when back
     leave(id)                            → Promise
*/
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, collection, getDoc, setDoc, updateDoc, writeBatch, onSnapshot, arrayUnion, arrayRemove, connectFirestoreEmulator
} from 'firebase/firestore';

function create(config) {
  /* optional, for local testing against `firebase emulators:start`:
     emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080] } */
  const emu = config.emulators || null;
  config = Object.assign({}, config); delete config.emulators;
  const app = initializeApp(config, 'billo');
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, { localCache: memoryLocalCache() }); /* private window / no IndexedDB */
  }
  if (emu && emu.auth) connectAuthEmulator(auth, emu.auth, { disableWarnings: true });
  if (emu && emu.firestore) connectFirestoreEmulator(db, emu.firestore[0], emu.firestore[1]);
  let uid = null;
  let readyP = null;

  function ready() {
    if (readyP) return readyP;
    readyP = new Promise((resolve, reject) => {
      const off = onAuthStateChanged(auth, u => {
        if (u) { uid = u.uid; off(); resolve(uid); return; }
        signInAnonymously(auth).catch(e => { off(); readyP = null; reject(e); });
      }, e => { readyP = null; reject(e); });
    });
    return readyP;
  }

  const tripRef = id => doc(db, 'trips', id);

  async function createTrip(id, meta, code, docs) {
    await ready();
    const now = Date.now();
    await setDoc(tripRef(id), Object.assign({}, meta, { code, uids: [uid], createdBy: uid, createdAt: now, updatedAt: now, v: 1 }));
    /* bills + payments + the code, in batches of 450 (Firestore's limit is 500 writes) */
    const writes = [];
    (docs.expenses || []).forEach(e => writes.push([doc(db, 'trips', id, 'expenses', e.id), Object.assign({}, e, { updatedBy: uid, updatedAt: now })]));
    (docs.payments || []).forEach(p => writes.push([doc(db, 'trips', id, 'payments', p.id), Object.assign({}, p, { updatedBy: uid, updatedAt: now })]));
    writes.push([doc(db, 'codes', code), { tripId: id, createdBy: uid, createdAt: now }]);
    for (let i = 0; i < writes.length; i += 450) {
      const b = writeBatch(db);
      writes.slice(i, i + 450).forEach(([r, d]) => b.set(r, d));
      await b.commit();
    }
  }

  async function lookup(code) {
    await ready();
    const s = await getDoc(doc(db, 'codes', code));
    return s.exists() ? s.data().tripId : null;
  }

  async function join(id) {
    await ready();
    await updateDoc(tripRef(id), { uids: arrayUnion(uid), updatedAt: Date.now() });
    const s = await getDoc(tripRef(id));
    return s.data();
  }

  function watch(id, cb) {
    const info = s => ({ fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites });
    const err = e => cb({ error: e });
    const col = name => s => {
      const data = {};
      s.forEach(d => { data[d.id] = d.data(); });
      cb({ part: name, data, info: info(s) });
    };
    const offs = [
      onSnapshot(tripRef(id), { includeMetadataChanges: true }, s => cb({ part: 'meta', data: s.exists() ? s.data() : null, info: info(s) }), err),
      onSnapshot(collection(db, 'trips', id, 'expenses'), { includeMetadataChanges: true }, col('expenses'), err),
      onSnapshot(collection(db, 'trips', id, 'payments'), { includeMetadataChanges: true }, col('payments'), err)
    ];
    return () => offs.forEach(f => f());
  }

  /* ops come from diffTrip() in the app: {kind:'meta', fields} | {kind:'set', col, id, data}.
     Not awaited by the app: Firestore applies them to its local cache at once (listeners fire),
     queues them while offline and sends them when the connection is back. */
  async function apply(id, ops) {
    await ready();
    const now = Date.now();
    for (let i = 0; i < ops.length; i += 450) {
      const b = writeBatch(db);
      ops.slice(i, i + 450).forEach(op => {
        if (op.kind === 'meta') b.update(tripRef(id), Object.assign({}, op.fields, { updatedAt: now }));
        else b.set(doc(db, 'trips', id, op.col, op.id), Object.assign({}, op.data, { updatedBy: uid, updatedAt: now }));
      });
      await b.commit();
    }
  }

  async function leave(id) {
    await ready();
    await updateDoc(tripRef(id), { uids: arrayRemove(uid), updatedAt: Date.now() });
  }

  return { kind: 'firebase', ready, createTrip, lookup, join, watch, apply, leave, get uid() { return uid; } };
}

window.BilloFirebase = { create };
