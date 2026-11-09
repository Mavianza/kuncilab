import assert from "node:assert/strict";
import {once} from "node:events";
import {test} from "node:test";

import {webServer} from "../server.mjs";

test("server loopback menyajikan UI dan semua modul yang dipakai", async t => {
  const server = webServer().listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  const html = await response.text();
  assert.match(html, /id="status"/);
  assert.match(html, /id="upload"/);
  assert.match(html, /src="\/app.mjs"/);
  for (const [path, type] of [["app.mjs", "text/javascript"], ["sim.mjs", "text/javascript"],
    ["examples.mjs", "text/javascript"], ["styles.css", "text/css"]]) {
    const asset = await fetch(base + "/" + path);
    assert.equal(asset.status, 200);
    assert.ok(asset.headers.get("content-type").startsWith(type));
    assert.ok((await asset.text()).length > 100);
  }
  assert.equal(await (await fetch(base + "/", {method: "HEAD"})).text(), "");
  assert.equal((await fetch(base + "/%2e%2e/package.json")).status, 404);
  assert.equal((await fetch(base + "/", {method: "POST"})).status, 405);
});
