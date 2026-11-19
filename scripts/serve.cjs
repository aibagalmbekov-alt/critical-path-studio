"use strict";

const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

const port = Number(process.env.PORT || 4173);
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/scheduler.js", ["scheduler.js", "text/javascript"]],
  ["/app.js", ["app.js", "text/javascript"]],
]);

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const asset = assets.get(req.url.split("?", 1)[0]);
  if (!asset) {
    res.writeHead(404).end("Not found");
    return;
  }
  const [filename, type] = asset;
  try {
    const content = await readFile(join(__dirname, "../dist", filename));
    res.writeHead(200, {
      "Content-Type": type + "; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }).end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(500).end("Unable to load the asset");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Critical Path Studio: http://127.0.0.1:" + server.address().port);
});
