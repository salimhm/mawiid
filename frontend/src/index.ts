import { serve, type BunRequest, type Server, type ServerWebSocket } from "bun";
import index from "./index.html";

// Requests to /api/* are forwarded to the Mawiid backend, so the browser
// only ever talks to this origin (the backend does not send CORS headers).
const backendUrl = new URL(process.env.BACKEND_URL || "http://localhost:3000");

type ProxySocket = { target: string; upstream?: WebSocket; queue: (string | Uint8Array<ArrayBuffer>)[] };

const toBackend = (req: Request) => {
  const url = new URL(req.url);
  return new URL(url.pathname.replace(/^\/api/, "") + url.search, backendUrl);
};

const server = serve<ProxySocket>({
  // The backend uses 3000 by default.
  port: Number(process.env.PORT) || 3100,

  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/*": async (req: BunRequest, server: Server<ProxySocket>) => {
      const target = toBackend(req);

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
    },
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

console.log(`🚀 Server running at ${server.url} (backend: ${backendUrl.origin})`);
