import {graph, Session} from "./sim.mjs";
import {examples} from "./examples.mjs";

const get = id => document.getElementById(id);
const STORE_KEY = "kuncilab.trace.v1";
const MAX_TRACE_BYTES = 128 * 1024;
const labels = {ready: "Siap", blocked: "Menunggu", done: "Selesai", aborted: "Dibatalkan"};

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function svgElement(tag, attributes = {}, content) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  return node;
}

function graphView({edges, cycles}, state) {
  const svg = get("graph");
  const defs = svgElement("defs");
  for (const [id, color] of [["arrow", "#a2b7d4"], ["arrow-cycle", "#ffaaa8"]]) {
    const marker = svgElement("marker", {id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto"});
    marker.append(svgElement("path", {d: "M 0 0 L 10 5 L 0 10 z", fill: color}));
    defs.append(marker);
  }
  const positions = new Map(state.threads.map((thread, index, all) => {
    const angle = 2 * Math.PI * index / all.length - Math.PI / 2;
    return [thread.id, all.length === 2 ? [125 + 230 * index, 165] : [
      240 + 170 * Math.cos(angle), 165 + 120 * Math.sin(angle),
    ]];
  }));
  const paths = edges.map(edge => {
    const [x, y] = positions.get(edge.from);
    const [u, v] = positions.get(edge.to);
    const distance = Math.hypot(u - x, v - y);
    const dx = (u - x) / distance, dy = (v - y) / distance;
    const cycle = cycles.some(ids => ids.includes(edge.from) && ids.includes(edge.to));
    const d = "M " + (x + 28 * dx - 7 * dy) + " " + (y + 28 * dy + 7 * dx)
      + " Q " + ((x + u) / 2 - 26 * dy) + " " + ((y + v) / 2 + 26 * dx)
      + " " + (u - 30 * dx - 7 * dy) + " " + (v - 30 * dy + 7 * dx);
    return svgElement("path", {d, class: cycle ? "edge cycle" : "edge",
      "marker-end": cycle ? "url(#arrow-cycle)" : "url(#arrow)"});
  });
  const nodes = state.threads.map(t => {
    const [x, y] = positions.get(t.id);
    const group = svgElement("g");
    const inCycle = cycles.some(cycle => cycle.includes(t.id));
    group.append(svgElement("circle", {cx: x, cy: y, r: 26, class: inCycle ? "node cycle" : "node"}));
    const attrs = t.id.length > 6 ? {x, y, textLength: 43, lengthAdjust: "spacingAndGlyphs"} : {x, y};
    group.append(svgElement("text", attrs, t.id));
    group.append(svgElement("title", {}, t.id + " · " + labels[t.status]));
    return group;
  });
  svg.replaceChildren(defs, ...paths, ...nodes);
  get("edges").replaceChildren(...(edges.length ? edges.map(edge =>
    element("li", edge.from + " → " + edge.to + " · menunggu " + edge.lock))
    : [element("li", "Antrean tunggu kosong.")]));
}

function actionButton(text, type, thread, disabled = false) {
  const button = element("button", text, type === "abort" ? "danger" : "");
  button.dataset.action = type;
  button.dataset.thread = thread;
  button.disabled = disabled;
  return button;
}

function nextStep(t) {
  if (t.status === "blocked") return "Menunggu mutex " + t.waiting;
  if (t.status !== "ready") return labels[t.status];
  const instruction = t.steps[t.pc];
  return instruction.op === "work" ? instruction.label : instruction.op + " " + instruction.lock;
}

let session = new Session(examples.silang);
try {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved && saved.length <= MAX_TRACE_BYTES) session = Session.replay(JSON.parse(saved));
} catch {
  get("feedback").textContent = "Jejak lokal tidak dapat dimuat. Preset awal dibuka.";
}

function render() {
  const state = session.state;
  const dependency = graph(state);
  const cycles = dependency.cycles;
  const ready = state.threads.some(t => t.status === "ready");
  const log = session.history.slice(1);
  get("scenario-title").textContent = session.scenario.name;
  get("run").disabled = !ready || cycles.length > 0;
  get("undo").disabled = !log.length;
  const status = get("status");
  status.dataset.mode = cycles.length ? "deadlock" : "normal";
  status.textContent = cycles.length
    ? "Deadlock · " + cycles.map(ids => [...ids, ids[0]].join(" → ")).join(" | ")
    : ready ? "Siap · " + log.length + " langkah tercatat"
      : "Simulasi selesai · " + state.threads.filter(t => t.status === "aborted").length + " thread dibatalkan";

  get("threads").replaceChildren(...state.threads.map(thread => {
    const id = thread.id;
    const inCycle = cycles.some(cycle => cycle.includes(id));
    const card = element("article", undefined, "thread");
    card.dataset.cycle = String(inCycle);
    const title = element("div", undefined, "thread-head");
    title.append(element("h3", id), element("span", labels[thread.status], "badge"));
    card.append(title, element("p", "Langkah " + thread.pc + "/" + thread.steps.length + " · " + nextStep(thread), "mono"));
    const holding = state.locks.filter(lock => lock.owner === id).map(lock => lock.id);
    card.append(element("p", "Memegang " + (holding.join(", ") || "—")));
    const actions = element("div", undefined, "row");
    actions.append(actionButton("Langkahkan " + id, "step", id, thread.status !== "ready"));
    if (inCycle) actions.append(actionButton("Batalkan " + id, "abort", id));
    card.append(actions);
    return card;
  }));
  get("locks").replaceChildren(...state.locks.map(lock => {
    const row = element("tr");
    row.append(...[lock.id, lock.owner ?? "—", lock.queue.join(" → ") || "—"].map(value => element("td", value)));
    return row;
  }));
  get("empty-log").hidden = log.length > 0;
  get("timeline").replaceChildren(...log.map(({event}) => {
    const item = element("li", event.description);
    if (event.effects.length) item.append(element("small", event.effects.join(" · ")));
    return item;
  }));
  get("timeline").scrollTop = get("timeline").scrollHeight;
  graphView(dependency, state);
}

function feedback(message, error = false) {
  const node = get("feedback");
  node.textContent = message;
  node.dataset.error = String(error);
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(session.trace()));
  } catch {
    feedback("Penyimpanan browser tidak tersedia. Unduh jejak untuk menyimpan sesi.", true);
  }
}

function perform(operation) {
  try {
    const message = operation();
    render();
    feedback(message ?? "");
    persist();
  } catch (error) {
    feedback(error.message, true);
  }
}

function replaceSession(next) {
  session = next;
  get("editor").value = JSON.stringify(session.scenario, null, 2);
}

get("load").addEventListener("click", () => perform(() => {
  replaceSession(new Session(examples[get("preset").value]));
  return "Preset dimuat.";
}));
get("reset").addEventListener("click", () => perform(() => replaceSession(new Session(session.scenario))));
get("run").addEventListener("click", () => perform(() => session.run() + " langkah otomatis dijalankan."));
get("undo").addEventListener("click", () => {
  if (session.undo()) perform(() => "Satu aksi dibatalkan.");
});
get("threads").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const {action, thread} = button.dataset;
  perform(() => session.apply({type: action, thread}).description);
  const next = [...get("threads").querySelectorAll("button")].find(item => !item.disabled
    && item.dataset.thread === thread && item.dataset.action === action);
  (next ?? get("undo")).focus();
});
get("apply").addEventListener("click", () => perform(() => {
  replaceSession(new Session(JSON.parse(get("editor").value)));
  return "Skenario diterapkan.";
}));
get("download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(session.trace(), null, 2) + "\n"], {type: "application/json"});
  const href = URL.createObjectURL(blob);
  const link = element("a");
  link.href = href;
  link.download = "jejak-kuncilab.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
});
get("upload").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > MAX_TRACE_BYTES) {
    feedback("Jejak maksimal 128 KiB.", true);
    return;
  }
  try {
    const content = await file.text();
    perform(() => {
      replaceSession(Session.replay(JSON.parse(content)));
      return "Jejak berhasil diputar ulang.";
    });
  } catch (error) {
    feedback(error.message, true);
  }
});

replaceSession(session);
render();
