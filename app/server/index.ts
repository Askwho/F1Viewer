import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { constants as zlib, createGzip } from "node:zlib";
import { networkInterfaces } from "node:os";
import { parseArgs } from "node:util";
import { WebSocketServer } from "ws";
import { Hub, type Entry } from "./hub.ts";
import { TokenStore } from "./token.ts";
import { LiveSource } from "./sources/live.ts";
import { startReplay } from "./sources/archive.ts";
import { getCircuit, saveTraced } from "./circuits.ts";
import { KeyStore } from "./keys.ts";
import { RadioTranscriber } from "./radio.ts";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const DIST = join(ROOT, "dist");

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: process.env.PORT || "8787" },
    replay: { type: "string" },
    from: { type: "string", default: "start" },
    speed: { type: "string", default: "1" },
    "no-record": { type: "boolean", default: false },
  },
});

const hub = new Hub();
hub.onTrace = (outline, key) => {
  saveTraced(key, outline, join(DATA, "circuits"));
  console.log(`[map] traced circuit ${key} from car positions (${outline.x.length} points)`);
};
const tokens = new TokenStore(join(DATA, "f1tv-token.txt"));
const keys = new KeyStore(join(DATA, "keys.json"));
const radio = new RadioTranscriber(hub, keys, join(DATA, "radio"));
radio.start();
let live: LiveSource | undefined;
let stopRecording: (() => Promise<void>) | undefined;

if (args.replay) {
  startReplay(hub, args.replay, join(DATA, "archive"), { from: args.from, speed: Number(args.speed) }).catch((e) => {
    console.error("[replay]", e.message);
    hub.setStatus("replay", `failed: ${e.message}`, false);
  });
} else {
  live = new LiveSource(hub, tokens);
  tokens.onChange = () => live?.restart();
  live.start();
  if (!args["no-record"]) stopRecording = recordLive(hub);
}

// Every live session is kept as gzipped JSONL so it can be replayed later.
// Flushed every few seconds, so even a hard kill loses only the last moment.
function recordLive(hub: Hub): () => Promise<void> {
  const dir = join(DATA, "recordings");
  mkdirSync(dir, { recursive: true });
  let out: ReturnType<typeof createGzip> | undefined;
  let file: ReturnType<typeof createWriteStream> | undefined;
  let dirty = false;
  hub.onEntry = (e: Entry) => {
    if (e.topic === "LapHistory" || e.topic === "Incidents") return;
    if (e.topic === "__reset" || !out) {
      out?.end();
      const stamp = new Date(e.t).toISOString().replace(/[:.]/g, "-");
      out = createGzip();
      file = createWriteStream(join(dir, `${stamp}.jsonl.gz`));
      out.pipe(file);
    }
    out.write(JSON.stringify(e) + "\n");
    dirty = true;
  };
  const flusher = setInterval(() => {
    if (dirty) out?.flush(zlib.Z_SYNC_FLUSH);
    dirty = false;
  }, 5000);
  return () =>
    new Promise((done) => {
      clearInterval(flusher);
      hub.onEntry = undefined;
      if (!out || !file) return done();
      file.on("close", () => done());
      out.end();
    });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function json(res: any, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: any): Promise<string> {
  let s = "";
  for await (const chunk of req) s += chunk;
  return s;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  try {
    if (p === "/api/status") {
      return json(res, 200, { status: hub.status, token: tokens.info(), radio: radio.status(), mode: args.replay ? "replay" : "live" });
    }
    if (p === "/api/token" && req.method === "POST") {
      const ok = tokens.set(await readBody(req));
      return json(res, ok ? 200 : 400, ok ? { token: tokens.info() } : { error: "That doesn't look like an F1 TV token or login-session cookie." });
    }
    if (p === "/api/keys" && req.method === "POST") {
      let body: any;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "Expected JSON" });
      }
      keys.set({ elevenlabs: body.elevenlabs, groq: body.groq, anthropic: body.anthropic });
      return json(res, 200, { radio: radio.status() });
    }
    const circuit = /^\/api\/circuit\/(\d+)\/(\d+)$/.exec(p);
    if (circuit) {
      const c = await getCircuit(Number(circuit[1]), Number(circuit[2]), join(DATA, "circuits"));
      return c ? json(res, 200, c) : json(res, 404, { error: "no outline yet" });
    }
    if (p === "/api/shutdown" && req.method === "POST") {
      // Only from this PC (stop.cmd), never from the tablet or anything else on the network.
      if (!isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: "local only" });
      json(res, 200, { stopping: true });
      return shutdown("stop requested");
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });

    // Static app with SPA fallback.
    let file = normalize(join(DIST, decodeURIComponent(p)));
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("App not built yet: run `npm run build` (or use `npm run dev`).");
    }
    const immutable = file.includes(`${join(DIST, "assets")}`);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    createReadStream(file).pipe(res);
  } catch (e: any) {
    json(res, 500, { error: e.message });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => hub.attach(ws));
wss.on("error", () => {}); // listen errors are handled on the HTTP server below

function isLoopback(addr: string | undefined) {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

let stopping = false;
async function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping (${reason})…`);
  setTimeout(() => process.exit(0), 4000).unref();
  live?.stop();
  for (const ws of wss.clients) ws.close(1001, "relay stopping");
  server.close();
  await stopRecording?.();
  console.log("Stopped. Recording saved.");
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(sig, () => shutdown(sig));

server.on("error", (e: any) => {
  if (e.code === "EADDRINUSE") {
    console.log(`Pit Wall is already running on port ${args.port}. Run stop.cmd first to restart it.`);
    process.exit(2);
  }
  throw e;
});

server.listen(Number(args.port), "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i!.address}:${args.port}`);
  console.log(`F1 Viewer relay (${args.replay ? "replay" : "live"}) on:\n  ${ips.join("\n  ")}`);
});
