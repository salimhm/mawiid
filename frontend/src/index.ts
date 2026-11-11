import { serve, type BunRequest, type Server, type ServerWebSocket } from "bun";
import { connect, createServer } from "node:net";
import index from "./index.html";

// Requests to /api/* are forwarded to the Mawiid backend, so the browser
// only ever talks to this origin (the backend does not send CORS headers).
const backendUrl = new URL(process.env.BACKEND_URL || "http://localhost:3000");
// /livekit/* does the same for LiveKit, so signaling can use wss:// with this server's certificate.
const livekitUrl = new URL(process.env.LIVEKIT_PROXY_URL || "http://localhost:7880");

// With a certificate, PORT serves HTTPS and redirects plain HTTP to it.
const port = Number(process.env.PORT) || 3100;
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
  // With a certificate this server is internal: the listener below accepts connections on PORT.
  ...(tls ? { tls, hostname: "127.0.0.1", port: 0 } : { port }),

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
  // One port serves both protocols, told apart by the first byte: 0x16 starts a TLS
  // handshake. 308 keeps the method and body. Browsers do not follow redirects on
  // WebSocket handshakes, so the frontend itself picks wss:// on an HTTPS page.
  createServer((client) => {
    client.on("error", () => client.destroy());
    client.once("data", (first) => {
      if (first[0] === 0x16) {
        const upstream = connect(server.port!, "127.0.0.1");
        upstream.on("error", () => client.destroy());
        client.on("close", () => upstream.destroy());
        upstream.write(first);
        client.pipe(upstream).pipe(client);
        return;
      }
      const lines = first.toString("latin1").split("\r\n");
      const path = lines[0]?.split(" ")[1];
      const host = lines.find((line) => /^host:/i.test(line))?.slice(5).trim();
      client.end(
        path?.startsWith("/") && host
          ? `HTTP/1.1 308 Permanent Redirect\r\nLocation: https://${host}${path}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
          : "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    });
  }).listen(port);
}

console.log(`🚀 Server running at ${tls ? `https://localhost:${port}/ (http redirects to https)` : server.url} (backend: ${backendUrl.origin})`);
