/* A stand-in for Firestore used by the sync tests (never shipped in the app).
   It behaves like the parts of Firestore Billo relies on:
     - listeners see our own writes immediately (latency compensation, hasPendingWrites)
     - writes made offline are queued and sent in order when back online
     - only uids in trips/{id}.uids may read or write a trip (like firestore.rules)
     - last write wins per document; trip meta updates are field-level (dot paths)
   Works in Node (direct transport) and in the browser (HTTP + SSE, see fake-sync-server.js). */
(function (root) {
  'use strict';
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function applyOps(state, ops, uid, now) {
    ops.forEach(op => {
      if (op.kind === 'meta') {
        state.meta = Object.assign({}, state.meta);
        state.meta.members = Object.assign({}, state.meta.members);
        Object.keys(op.fields).forEach(k => {
          if (k.indexOf('members.') === 0) state.meta.members[k.slice(8)] = clone(op.fields[k]);
          else state.meta[k] = clone(op.fields[k]);
        });
        state.meta.updatedAt = now;
      } else {
        state[op.col] = Object.assign({}, state[op.col]);
        state[op.col][op.id] = Object.assign(clone(op.data), { updatedBy: uid, updatedAt: now });
      }
    });
  }

  /* ---------- the "server" ---------- */
  function FakeServer() {
    const trips = {}, codes = {}, subs = {};
    let n = 0, clock = 1;
    const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
    const member = (uid, id) => trips[id] && trips[id].meta.uids.indexOf(uid) >= 0;
    function notify(id) {
      (subs[id] || []).forEach(s => {
        if (!member(s.uid, id)) { s.fn({ error: denied() }); return; }
        s.fn({ state: clone(trips[id]) });
      });
    }
    return {
      signIn() { return 'uid' + (++n) + Math.random().toString(36).slice(2, 6); },
      createTrip(uid, id, meta, code, docs) {
        if (trips[id] || codes[code]) throw new Error('exists');
        const now = clock++;
        trips[id] = { meta: Object.assign(clone(meta), { code, uids: [uid], createdBy: uid, createdAt: now, updatedAt: now }), expenses: {}, payments: {} };
        (docs.expenses || []).forEach(e => { trips[id].expenses[e.id] = Object.assign(clone(e), { updatedBy: uid, updatedAt: now }); });
        (docs.payments || []).forEach(p => { trips[id].payments[p.id] = Object.assign(clone(p), { updatedBy: uid, updatedAt: now }); });
        codes[code] = id;
        notify(id);
      },
      lookup(uid, code) { return codes[code] || null; },
      join(uid, id) {
        if (!trips[id]) throw denied();
        if (!member(uid, id)) trips[id].meta.uids.push(uid);
        notify(id);
        return clone(trips[id].meta);
      },
      write(uid, id, ops) {
        if (!member(uid, id)) throw denied();
        applyOps(trips[id], ops, uid, clock++);
        notify(id);
      },
      leave(uid, id) {
        if (!trips[id]) return;
        trips[id].meta.uids = trips[id].meta.uids.filter(u => u !== uid);
        notify(id);
      },
      subscribe(uid, id, fn) {
        const s = { uid, fn };
        (subs[id] = subs[id] || []).push(s);
        if (!member(uid, id)) fn({ error: denied() });
        else fn({ state: clone(trips[id]) });
        return () => { subs[id] = (subs[id] || []).filter(x => x !== s); };
      },
      _trips: trips
    };
  }

  /* ---------- a client (one phone) — same interface as the Firestore adapter ---------- */
  function FakeClient(transport, opts) {
    opts = opts || {};
    let uid = opts.uid || null, online = opts.online !== false;
    const views = {};   /* trip id → { server, pending: [ops...], watchers: [cb], unsub } */
    const defer = fn => (opts.sync ? fn() : setTimeout(fn, opts.latency || 0));
    function v(id) { return views[id] || (views[id] = { server: null, pending: [], watchers: [], unsub: null, err: null }); }
    function emit(id) {
      const w = v(id);
      if (w.err) { w.watchers.forEach(cb => cb({ error: w.err })); return; }
      if (!w.server) return;
      const view = clone(w.server);
      w.pending.forEach(p => applyOps(view, p.ops, uid, 0));
      const info = { fromCache: !online, pending: w.pending.length > 0 };
      w.watchers.forEach(cb => {
        cb({ part: 'meta', data: view.meta, info });
        cb({ part: 'expenses', data: view.expenses || {}, info });
        cb({ part: 'payments', data: view.payments || {}, info });
      });
    }
    function connect(id) {
      const w = v(id);
      if (w.unsub || !online) return;
      w.unsub = transport.subscribe(uid, id, msg => defer(() => {
        if (msg.error) { w.err = msg.error; } else { w.err = null; w.server = msg.state; }
        emit(id);
      }));
    }
    async function flush(id) {
      const w = v(id);
      while (online && w.pending.length) {
        const p = w.pending[0];
        await transport.write(uid, id, p.ops);
        w.pending.shift();
      }
      emit(id);
    }
    const need = () => { if (!online) { const e = new Error('Failed to get document because the client is offline.'); e.code = 'unavailable'; throw e; } };
    return {
      kind: 'fake',
      get uid() { return uid; },
      async ready() { if (!uid) { need(); uid = await transport.signIn(); } return uid; },
      async createTrip(id, meta, code, docs) { need(); await transport.createTrip(uid, id, meta, code, docs); },
      async lookup(code) { need(); return transport.lookup(uid, code); },
      async join(id) { need(); return transport.join(uid, id); },
      watch(id, cb) {
        const w = v(id);
        w.watchers.push(cb);
        if (w.server) defer(() => emit(id));
        connect(id);
        return () => { w.watchers = w.watchers.filter(x => x !== cb); if (!w.watchers.length && w.unsub) { w.unsub(); w.unsub = null; } };
      },
      async apply(id, ops) {
        const w = v(id);
        w.pending.push({ ops: clone(ops) });
        emit(id);
        if (online) return flush(id);
      },
      async leave(id) { need(); await transport.leave(uid, id); },
      async setOnline(on) {
        online = on;
        if (!on) { Object.keys(views).forEach(id => { const w = views[id]; if (w.unsub) { w.unsub(); w.unsub = null; } emit(id); }); return; }
        for (const id of Object.keys(views)) { connect(id); await flush(id); }
      },
      pendingCount() { return Object.values(views).reduce((s, w) => s + w.pending.length, 0); }
    };
  }

  /* ---------- transports ---------- */
  function directTransport(server) {
    return {
      signIn: async () => server.signIn(),
      createTrip: async (...a) => server.createTrip(...a),
      lookup: async (...a) => server.lookup(...a),
      join: async (...a) => server.join(...a),
      write: async (...a) => server.write(...a),
      leave: async (...a) => server.leave(...a),
      subscribe: (uid, id, fn) => server.subscribe(uid, id, fn)
    };
  }
  function httpTransport(base) {
    const call = async (m, body) => {
      const r = await fetch(base + '/api/' + m, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
      return j.result;
    };
    return {
      signIn: () => call('signIn', {}),
      createTrip: (uid, id, meta, code, docs) => call('createTrip', { uid, args: [id, meta, code, docs] }),
      lookup: (uid, code) => call('lookup', { uid, args: [code] }),
      join: (uid, id) => call('join', { uid, args: [id] }),
      write: (uid, id, ops) => call('write', { uid, args: [id, ops] }),
      leave: (uid, id) => call('leave', { uid, args: [id] }),
      subscribe(uid, id, fn) {
        const es = new EventSource(base + '/api/sub?uid=' + encodeURIComponent(uid) + '&trip=' + encodeURIComponent(id));
        es.onmessage = ev => { const m = JSON.parse(ev.data); if (m.error) { const e = new Error(m.error.message); e.code = m.error.code; fn({ error: e }); } else fn(m); };
        return () => es.close();
      }
    };
  }

  const api = { FakeServer, FakeClient, directTransport, httpTransport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BilloFakeSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
