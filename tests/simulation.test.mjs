import assert from "node:assert/strict";
import {test} from "node:test";

import {graph, ScenarioError, Session, transition, validateScenario} from "../web/sim.mjs";
import {examples} from "../web/examples.mjs";

const step = (session, thread) => session.apply({type: "step", thread});
const abort = (session, thread) => session.apply({type: "abort", thread});
const acquire = lock => ({op: "lock", lock});
const release = lock => ({op: "unlock", lock});

test("preset silang berhenti tepat ketika dua thread membentuk siklus", () => {
  const session = new Session(examples.silang);
  for (const thread of ["T1", "T2", "T1"]) step(session, thread);
  assert.deepEqual(graph(session.state), {edges: [{from: "T1", to: "T2", lock: "B"}], cycles: []});
  assert.equal(session.run(), 1);
  assert.deepEqual(graph(session.state).cycles, [["T1", "T2"]]);
  assert.equal(session.commands.length, 4);
  assert.equal(session.run(), 0);
});

test("pembatalan melepas mutex, memberikan ke penunggu, dan memungkinkan thread lain selesai", () => {
  const session = new Session(examples.silang);
  session.run();
  const event = abort(session, "T2");
  assert.deepEqual(event.effects, ["T2 melepas B", "B diberikan ke T1 (FIFO)"]);
  assert.deepEqual(graph(session.state), {edges: [], cycles: []});
  assert.deepEqual(session.state.locks.map(lock => lock.owner), ["T1", "T1"]);
  assert.equal(session.run(), 3);
  assert.deepEqual(session.state.threads.map(t => t.status), ["done", "aborted"]);
  assert.ok(session.state.locks.every(lock => lock.owner === null && !lock.queue.length));
});

test("round-robin pada urutan mutex konsisten selesai tanpa deadlock", () => {
  const session = new Session(examples.searah);
  assert.equal(session.run(), 10);
  assert.deepEqual(graph(session.state).cycles, []);
  assert.ok(session.state.threads.every(t => t.status === "done"));
  assert.ok(session.state.locks.every(lock => lock.owner === null));
});

test("preset tiga thread mengembalikan siklus dalam urutan panah yang stabil", () => {
  const session = new Session(examples.cincin);
  assert.equal(session.run(), 6);
  assert.deepEqual(graph(session.state).cycles, [["T1", "T2", "T3"]]);
});

test("jejak ekspor dan replay merekonstruksi seluruh riwayat termasuk pemulihan", () => {
  const session = new Session(examples.cincin);
  session.run();
  abort(session, "T2");
  session.run();
  const saved = JSON.stringify(session.trace());
  const replayed = Session.replay(JSON.parse(saved));
  assert.deepEqual(replayed.history, session.history);
  assert.equal(JSON.stringify(replayed.trace()), saved);
  assert.ok(replayed.state.threads.every(t => ["done", "aborted"].includes(t.status)));
});

test("undo mengembalikan siklus dan antrean sebelumnya lalu replay identik", () => {
  const session = new Session(examples.silang);
  assert.equal(session.undo(), false);
  session.run();
  const before = structuredClone(session.state);
  abort(session, "T2");
  const after = structuredClone(session.state);
  assert.equal(session.undo(), true);
  assert.deepEqual(session.state, before);
  abort(session, "T2");
  assert.deepEqual(session.state, after);
});

test("menolak aksi tidak sah tanpa menambah jejak atau mengubah state", () => {
  const session = new Session(examples.silang);
  assert.throws(() => abort(session, "T1"), /siklus deadlock/);
  assert.throws(() => step(session, "asing"), /tidak dikenal/);
  session.run();
  const before = structuredClone(session.history);
  assert.throws(() => step(session, "T1"), /tidak siap/);
  assert.deepEqual(session.history, before);
  assert.equal(session.commands.length, 4);
});

test("jejak yang rusak dilaporkan dengan nomor aksi", () => {
  const session = new Session(examples.silang);
  session.run();
  const trace = session.trace();
  trace.commands.push({type: "step", thread: "T1"});
  assert.throws(() => Session.replay(trace), /Aksi 5.*tidak siap/);
  assert.throws(() => Session.replay({...trace, version: 2}), /versi 1/);
  assert.throws(() => Session.replay({...trace, commands: Array(99).fill({type: "step", thread: "T1"})}), /batas aksi/);
});

test("FIFO memindahkan pemilik dan mengubah edge penunggu berikutnya", () => {
  const session = new Session({
    name: "Antrian tiga pihak", locks: ["L"],
    threads: ["T1", "T2", "T3"].map(id => ({id, steps: [acquire("L"), release("L")]})),
  });
  for (const id of ["T1", "T3", "T2"]) step(session, id);
  assert.deepEqual(session.state.locks[0].queue, ["T3", "T2"]);
  step(session, "T1");
  assert.equal(session.state.locks[0].owner, "T3");
  assert.deepEqual(graph(session.state).edges, [{from: "T2", to: "T3", lock: "L"}]);
  step(session, "T3");
  assert.equal(session.state.locks[0].owner, "T2");
  step(session, "T2");
  assert.equal(session.state.locks[0].owner, null);
});

test("dua siklus independen terdeteksi dan thread yang hanya menunggu tidak boleh dibatalkan", () => {
  const make = (id, a, b) => ({id, steps: [acquire(a), acquire(b), release(b), release(a)]});
  const session = new Session({
    name: "Dua siklus", locks: ["A", "B", "C", "D"],
    threads: [make("T1", "A", "B"), make("T2", "B", "A"), make("T3", "C", "D"), make("T4", "D", "C"),
      {id: "T5", steps: [acquire("A"), release("A")]}],
  });
  for (const id of ["T1", "T2", "T3", "T4", "T5", "T1", "T2", "T3", "T4"]) step(session, id);
  assert.deepEqual(graph(session.state).cycles, [["T1", "T2"], ["T3", "T4"]]);
  assert.throws(() => abort(session, "T5"), /siklus deadlock/);
  abort(session, "T1");
  assert.deepEqual(graph(session.state).cycles, [["T3", "T4"]]);
  assert.equal(session.state.locks[0].owner, "T5");
});

test("validasi skenario menangkap mutex asing, double lock, unlock, dan lock tersisa", () => {
  for (const [steps, pattern] of [
    [[acquire("X")], /tidak terdaftar/],
    [[acquire("A"), acquire("A")], /non-reentrant/],
    [[release("A")], /belum diambil/],
    [[acquire("A")], /harus melepas/],
  ]) {
    const scenario = structuredClone(examples.silang);
    scenario.threads[0].steps = steps;
    assert.throws(() => validateScenario(scenario), pattern);
  }
  assert.throws(() => validateScenario({...examples.silang, locks: ["A", "A"]}), ScenarioError);
});

test("seluruh state terjangkau preset tiga thread menjaga pemilik dan antrean konsisten", () => {
  const queue = [new Session(examples.cincin).state];
  const seen = new Set();
  let deadlocks = 0;
  while (queue.length) {
    const state = queue.pop();
    const key = JSON.stringify(state);
    if (seen.has(key)) continue;
    seen.add(key);
    const queued = new Map();
    for (const lock of state.locks) {
      assert.ok(lock.owner !== null || !lock.queue.length);
      const owner = state.threads.find(t => t.id === lock.owner);
      if (lock.owner !== null) assert.ok(owner && ["ready", "blocked"].includes(owner.status));
      for (const id of lock.queue) {
        assert.notEqual(id, lock.owner);
        assert.ok(!queued.has(id));
        queued.set(id, lock.id);
      }
    }
    const {cycles} = graph(state);
    if (cycles.length) deadlocks++;
    for (const thread of state.threads) {
      assert.equal(queued.get(thread.id) ?? null, thread.waiting);
      assert.equal(thread.status === "blocked", thread.waiting !== null);
      if (thread.status === "ready") queue.push(transition(state, {type: "step", thread: thread.id}).state);
      if (cycles.some(cycle => cycle.includes(thread.id))) queue.push(transition(state, {type: "abort", thread: thread.id}).state);
    }
  }
  assert.ok(seen.size > 100);
  assert.ok(deadlocks > 0);
});
