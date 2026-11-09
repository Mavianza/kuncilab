import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/styles.css", ["styles.css", "text/css"]],
  ["/app.mjs", ["app.mjs", "text/javascript"]],
  ["/examples.mjs", ["examples.mjs", "text/javascript"]],
  ["/sim.mjs", ["sim.mjs", "text/javascript"]],
]);

export function webServer() {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy",
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {Allow: "GET, HEAD"}).end("Metode tidak didukung.");
      return;
    }
    const asset = assets.get(request.url?.split("?")[0]);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    const [name, type] = asset;
    try {
      const data = await readFile(new URL("web/" + name, import.meta.url));
      response.writeHead(200, {"Content-Type": type + "; charset=utf-8", "Content-Length": data.length});
      response.end(request.method === "HEAD" ? undefined : data);
    } catch (error) {
      console.error("Gagal membaca " + name + ". " + error.message);
      response.writeHead(500).end("Aset tidak dapat dibaca.");
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const value = process.argv[2] ?? "8765";
  const port = Number(value);
  if (process.argv.length > 3 || !/^[0-9]{1,5}$/.test(value) || port < 1 || port > 65535) {
    console.error("Gunakan node server.mjs [port antara 1 dan 65535].");
    process.exitCode = 2;
  } else {
    const server = webServer();
    server.on("error", error => {
      console.error("Server tidak dapat berjalan. " + error.message);
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () => console.log("KunciLab siap di http://127.0.0.1:" + port));
  }
}
