import { serve, type BunRequest, type Server, type ServerWebSocket } from "bun";
import index from "./index.html";

// Requests to /api/* are forwarded to the Mawiid backend, so the browser
// only ever talks to this origin (the backend does not send CORS headers).
const backendUrl = new URL(process.env.BACKEND_URL || "http://localhost:3000");
// /livekit/* does the same for LiveKit, so signaling can use wss:// with this server's certificate.
const livekitUrl = new URL(process.env.LIVEKIT_PROXY_URL || "http://localhost:7880");

// With a certificate, this server is HTTPS on HTTPS_PORT and PORT only redirects to it.
const httpPort = Number(process.env.PORT) || 3100;
const httpsPort = Number(process.env.HTTPS_PORT) || 3443;
const tls = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
  ? { cert: Bun.file(process.env.TLS_CERT_FILE), key: Bun.file(process.env.TLS_KEY_FILE) }
  : undefined;

type ProxySocket = { target: string; upstream?: WebSocket; queue: (string | Uint8Array<ArrayBuffer>)[] };

const proxy = (prefix: string, upstream: URL) => async (req: BunRequest, server: Server<ProxySocket>) => {
  const url = new URL(req.url);
  const target = new URL(url.pathname.slice(prefix.length) + url.search, upstream);

  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    if (server.upgrade(req, { data: { target: target.href, queue: [] } })) return;
    return new Response("WebSocket upgrade failed", { status: 400 });
  }

  const headers = new Headers(req.headers);
  headers.delete("host");
  try {
    return await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
  } catch {
    return Response.json({ code: "backend-unavailable" }, { status: 502 });
  }
};

const server = serve<ProxySocket>({
  // The backend uses 3000 by default.
  port: tls ? httpsPort : httpPort,
  tls,

  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/*": proxy("/api", backendUrl),
    "/livekit/*": proxy("/livekit", livekitUrl),
  },

  websocket: {
    open(ws: ServerWebSocket<ProxySocket>) {
      const upstream = new WebSocket(ws.data.target);
      ws.data.upstream = upstream;
      upstream.onopen = () => {
        for (const message of ws.data.queue) upstream.send(message);
        ws.data.queue = [];
      };
      upstream.onmessage = (event) => ws.send(event.data);
      upstream.onclose = (event) => ws.close(event.code === 1005 ? 1000 : event.code, event.reason);
      upstream.onerror = () => ws.close(1011, "backend-unavailable");
    },
    message(ws, raw) {
      const message = typeof raw === "string" ? raw : new Uint8Array(raw);
      const upstream = ws.data.upstream;
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
      else ws.data.queue.push(message);
    },
    close(ws) {
      ws.data.upstream?.close();
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

if (tls) {
  // 308 keeps the method and body. Browsers do not follow redirects on WebSocket
  // handshakes, so the frontend itself picks wss:// on an HTTPS page.
  serve({
    port: httpPort,
    fetch(req) {
      const url = new URL(req.url);
      url.protocol = "https:";
      url.port = String(httpsPort);
      return Response.redirect(url.href, 308);
    },
  });
  console.log(`↪️  http://localhost:${httpPort} redirects to HTTPS`);
}

console.log(`🚀 Server running at ${server.url} (backend: ${backendUrl.origin})`);
