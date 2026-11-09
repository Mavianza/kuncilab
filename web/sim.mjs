const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,11}$/;
const MAX_STEPS = 240;

export class ScenarioError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new ScenarioError(message);
}

function label(value, limit, field) {
  requireCondition(typeof value === "string", field + " harus berupa teks.");
  const cleaned = value.trim();
  requireCondition(cleaned.length > 0 && cleaned.length <= limit && !/[\x00-\x1F\x7F]/.test(cleaned),
    field + " harus berupa teks satu baris maksimal " + limit + " karakter.");
  return cleaned;
}

function identifier(id, field) {
  requireCondition(typeof id === "string" && ID.test(id), field + " memakai 1–12 huruf, angka, _ atau -, diawali huruf.");
  return id;
}

export function validateScenario(input) {
  requireCondition(input && typeof input === "object", "Skenario harus berupa objek.");
  const name = label(input.name, 60, "Nama skenario");
  requireCondition(Array.isArray(input.locks) && input.locks.length >= 1 && input.locks.length <= 16,
    "Masukkan 1–16 mutex.");
  const locks = input.locks.map(id => identifier(id, "ID mutex"));
  const lockIds = new Set(locks);
  requireCondition(lockIds.size === locks.length, "ID mutex harus unik.");
  requireCondition(Array.isArray(input.threads) && input.threads.length >= 2 && input.threads.length <= 12,
    "Masukkan 2–12 thread.");
  const ids = new Set();
  let total = 0;
  const threads = input.threads.map(thread => {
    const id = identifier(thread?.id, "ID thread");
    requireCondition(!ids.has(id), "ID thread berulang: " + id + ".");
    ids.add(id);
    requireCondition(Array.isArray(thread.steps) && thread.steps.length > 0, "Thread " + id + " perlu instruksi.");
    total += thread.steps.length;
    requireCondition(total <= MAX_STEPS, "Maksimal 240 instruksi per skenario.");
    const held = new Set();
    const steps = thread.steps.map((step, index) => {
      const prefix = id + " instruksi " + (index + 1) + ". ";
      if (step?.op === "work") return {op: "work", label: label(step.label, 72, prefix + "Label work")};
      requireCondition(step?.op === "lock" || step?.op === "unlock", prefix + "Gunakan lock, unlock, atau work.");
      requireCondition(lockIds.has(step.lock), prefix + "Mutex tidak terdaftar.");
      if (step.op === "lock") {
        requireCondition(!held.has(step.lock), prefix + "Mutex ini non-reentrant.");
        held.add(step.lock);
      } else {
        requireCondition(held.delete(step.lock), prefix + "Mutex belum diambil oleh thread ini.");
      }
      return {op: step.op, lock: step.lock};
    });
    requireCondition(held.size === 0, "Thread " + id + " harus melepas semua mutex sebelum selesai.");
    return {id, steps};
  });
  return {name, locks, threads};
}

export function graph(state) {
  const edges = state.threads.filter(t => t.status === "blocked").map(t => ({
    from: t.id,
    to: state.locks.find(lock => lock.id === t.waiting).owner,
    lock: t.waiting,
  }));
  const next = new Map(edges.map(edge => [edge.from, edge.to]));
  const done = new Set();
  const cycles = [];
  for (const {from} of edges) {
    const path = [];
    const positions = new Map();
    let id = from;
    while (next.has(id) && !done.has(id) && !positions.has(id)) {
      positions.set(id, path.length);
      path.push(id);
      id = next.get(id);
    }
    if (positions.has(id)) {
      const cycle = path.slice(positions.get(id));
      const first = cycle.indexOf([...cycle].sort()[0]);
      cycles.push([...cycle.slice(first), ...cycle.slice(0, first)]);
    }
    for (const seen of path) done.add(seen);
  }
  cycles.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {edges, cycles};
}

function advance(thread) {
  thread.pc++;
  thread.status = thread.pc === thread.steps.length ? "done" : "ready";
}

function release(state, lock, effects) {
  lock.owner = lock.queue.shift() ?? null;
  if (lock.owner === null) return;
  const receiver = state.threads.find(t => t.id === lock.owner);
  receiver.waiting = null;
  advance(receiver);
  effects.push(lock.id + " diberikan ke " + receiver.id + " (FIFO)");
}

export function transition(previous, command) {
  const index = previous.threads.findIndex(t => t.id === command?.thread);
  requireCondition(index >= 0, "Thread tidak dikenal.");
  requireCondition(command.type === "step" || command.type === "abort", "Aksi tidak dikenal.");
  const state = structuredClone(previous);
  const thread = state.threads[index];
  const effects = [];
  let description;

  if (command.type === "abort") {
    requireCondition(graph(previous).cycles.some(cycle => cycle.includes(thread.id)),
      "Hanya thread yang berada dalam siklus deadlock bisa dibatalkan.");
    description = "Batalkan " + thread.id;
    const waiting = state.locks.find(lock => lock.id === thread.waiting);
    waiting.queue = waiting.queue.filter(id => id !== thread.id);
    thread.waiting = null;
    thread.status = "aborted";
    for (const lock of state.locks.filter(lock => lock.owner === thread.id)) {
      effects.push(thread.id + " melepas " + lock.id);
      release(state, lock, effects);
    }
  } else {
    requireCondition(thread.status === "ready", "Thread " + thread.id + " sedang tidak siap.");
    const step = thread.steps[thread.pc];
    const lock = state.locks.find(item => item.id === step.lock);
    switch (step.op) {
      case "work":
        description = thread.id + " · " + step.label;
        advance(thread);
        break;
      case "lock":
        if (lock.owner === null) {
          lock.owner = thread.id;
          description = thread.id + " mengambil " + lock.id;
          advance(thread);
        } else {
          thread.status = "blocked";
          thread.waiting = lock.id;
          lock.queue.push(thread.id);
          description = thread.id + " menunggu " + lock.id + " milik " + lock.owner;
        }
        break;
      case "unlock":
        requireCondition(lock.owner === thread.id, "Pemilik mutex tidak konsisten.");
        description = thread.id + " melepas " + lock.id;
        release(state, lock, effects);
        advance(thread);
        break;
    }
    state.cursor = (index + 1) % state.threads.length;
  }
  return {state, event: {description, effects}};
}

export class Session {
  constructor(input) {
    this.scenario = validateScenario(input);
    this.commands = [];
    this.history = [{
      state: {
        cursor: 0,
        threads: this.scenario.threads.map(t => ({...t, pc: 0, status: "ready", waiting: null})),
        locks: this.scenario.locks.map(id => ({id, owner: null, queue: []})),
      },
      event: null,
    }];
  }

  get state() { return this.history.at(-1).state; }

  apply(command) {
    const entry = transition(this.state, command);
    this.commands.push({type: command.type, thread: command.thread});
    this.history.push(entry);
    return entry.event;
  }

  undo() {
    if (!this.commands.length) return false;
    this.commands.pop();
    this.history.pop();
    return true;
  }

  run() {
    let steps = 0;
    while (!graph(this.state).cycles.length) {
      const {threads, cursor} = this.state;
      const ready = [...threads.slice(cursor), ...threads.slice(0, cursor)].find(t => t.status === "ready");
      if (!ready) break;
      this.apply({type: "step", thread: ready.id});
      steps++;
    }
    return steps;
  }

  trace() {
    return structuredClone({version: 1, scenario: this.scenario, commands: this.commands});
  }

  static replay(trace) {
    requireCondition(trace?.version === 1 && Array.isArray(trace.commands), "Format jejak harus versi 1.");
    const session = new Session(trace.scenario);
    const maxCommands = session.scenario.threads.reduce((n, t) => n + t.steps.length + 1, 0);
    requireCondition(trace.commands.length <= maxCommands, "Jejak melampaui batas aksi skenario.");
    for (const [index, command] of trace.commands.entries()) {
      try {
        session.apply(command);
      } catch (error) {
        throw new ScenarioError("Aksi " + (index + 1) + ". " + error.message);
      }
    }
    return session;
  }
}
