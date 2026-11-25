"""Live browser view of a translation_bot.py run (--watch).

Serves one local page that shows every sentence as a bot speaks it, what the worker heard, and
each listener's translation as it arrives, then the scores. The page also joins the LiveKit room
as a hidden, listen-only participant, so the bots can be heard. Events reach the page over
Server-Sent Events; a page opened late gets everything sent so far.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import os
from pathlib import Path

from aiohttp import web
from livekit import api

REPO = Path(__file__).resolve().parents[3]
LOCAL_SDK = REPO / "node_modules/livekit-client/dist/livekit-client.umd.js"
CDN_SDK = "https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.js"


def viewer_token(room: str) -> str:
    return (
        api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(f"viewer_{os.getpid()}")
        .with_name("viewer")
        .with_ttl(datetime.timedelta(hours=6))
        .with_grants(api.VideoGrants(room_join=True, room=room, can_publish=False, can_publish_data=False,
                                     can_subscribe=True, hidden=True))
        .to_jwt()
    )


class Viewer:
    def __init__(self, host: str, port: int) -> None:
        self.host, self.port = host, port
        self.events: list[str] = []
        self.clients: list[asyncio.Queue[str | None]] = []
        self.connected = asyncio.Event()
        self.runner: web.AppRunner | None = None

    @property
    def url(self) -> str:
        return f"http://{'localhost' if self.host in ('127.0.0.1', '0.0.0.0') else self.host}:{self.port}/"

    async def start(self) -> None:
        app = web.Application()
        app.router.add_get("/", self.page)
        app.router.add_get("/events", self.stream)
        app.router.add_get("/livekit-client.umd.js", self.sdk)
        self.runner = web.AppRunner(app, access_log=None)
        await self.runner.setup()
        await web.TCPSite(self.runner, self.host, self.port).start()

    async def stop(self) -> None:
        for queue in self.clients:
            queue.put_nowait(None)
        await asyncio.sleep(0.2)
        if self.runner:
            await self.runner.cleanup()

    def emit(self, event: dict) -> None:
        data = json.dumps(event, ensure_ascii=False)
        self.events.append(data)
        for queue in self.clients:
            queue.put_nowait(data)

    async def page(self, request: web.Request) -> web.Response:
        sdk = "/livekit-client.umd.js" if LOCAL_SDK.exists() else CDN_SDK
        return web.Response(text=PAGE.replace("__SDK__", sdk), content_type="text/html")

    async def sdk(self, request: web.Request) -> web.StreamResponse:
        return web.FileResponse(LOCAL_SDK)

    async def stream(self, request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
        await response.prepare(request)
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        for data in self.events:
            queue.put_nowait(data)
        self.clients.append(queue)
        self.connected.set()
        try:
            while True:
                data = await queue.get()
                if data is None:
                    break
                await response.write(f"data: {data}\n\n".encode())
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            self.clients.remove(queue)
        return response


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Translation bots live</title>
<style>
:root{--bg:#f6f6f8;--card:#fff;--fg:#1c1c1f;--muted:#6b6b74;--line:#e2e2e8;--accent:#0b57d0;--ok:#137333;--bad:#b3261e;--live:#f3f6fc}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1c1c20;--fg:#ececf1;--muted:#9a9aa5;--line:#2c2c33;--accent:#8ab4f8;--ok:#81c995;--bad:#f28b82;--live:#1f2633}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:17px;margin:0;flex:1 1 auto}#status{color:var(--muted);font-size:13px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:6px 12px;cursor:pointer}
button.on{border-color:var(--accent);color:var(--accent)}
main{max-width:980px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 12px}
.card.speaking{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;color:var(--muted);font-size:13px}
.head b{color:var(--fg);font-size:14px}.said{margin:6px 0 10px}
.row{display:grid;grid-template-columns:120px 1fr auto;gap:10px;padding:6px 0;border-top:1px solid var(--line);align-items:baseline}
.label{color:var(--muted);font-size:13px}.text{min-height:1.5em}.text .partial{color:var(--muted);font-style:italic}
.text:empty::before{content:"waiting…";color:var(--muted);font-size:13px}
.score{font-size:12px;color:var(--muted);white-space:nowrap}.score.ok{color:var(--ok)}.score.bad{color:var(--bad)}
.ref{grid-column:2/4;color:var(--muted);font-size:13px;display:none}.show-ref .ref{display:block}
.rtl{direction:rtl;text-align:right}
#verdict{font-weight:600}#verdict.ok{color:var(--ok)}#verdict.bad{color:var(--bad)}
@media (max-width:600px){.row{grid-template-columns:1fr}.ref{grid-column:1}}
</style></head><body>
<header><h1>Translation bots live</h1><span id="status">connecting…</span><span id="verdict"></span>
<button id="listen">🔈 Listen</button><button id="refs">Show references</button></header>
<main id="cards"></main>
<script src="__SDK__"></script>
<script>
const NAMES={"fr-FR":"French","en-US":"English","ar-SA":"Arabic","ar-MA":"Darija","zh-CN":"Chinese","zh-TW":"Chinese (TW)"};
const name=l=>NAMES[l]||l, rtl=l=>l.startsWith("ar");
let languages=[], tracks={}, room=null, cards=[], current=null;
const $=s=>document.querySelector(s), status=t=>$("#status").textContent=t;
$("#refs").onclick=()=>{document.body.classList.toggle("show-ref");$("#refs").classList.toggle("on")};
$("#listen").onclick=async()=>{if(!room)return;await room.startAudio();
  const on=!$("#listen").classList.contains("on");$("#listen").classList.toggle("on",on);$("#listen").textContent=on?"🔊 Listening":"🔈 Listen";
  document.querySelectorAll("audio").forEach(a=>a.muted=!on)};
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function newCard(ev){
  const c=el("section","card speaking");c.dataset.lang=ev.language;c.dataset.id=ev.id;
  const h=el("div","head");h.append(el("b",null,name(ev.language)+" speaker"),el("span",null,ev.warmup?"warm-up (not scored)":"FLEURS "+ev.id));
  const said=el("div","said"+(rtl(ev.language)?" rtl":""),ev.text);c.append(h,said);c.rows={};
  for(const l of languages){const r=el("div","row");const label=el("div","label",l===ev.language?"heard ("+name(l)+")":"→ "+name(l));
    const t=el("div","text"+(rtl(l)?" rtl":""));const s=el("div","score");const ref=el("div","ref"+(rtl(l)?" rtl":""),"reference: "+(ev.references[l]||""));
    r.append(label,t,s,ref);c.append(r);c.rows[l]={text:t,score:s,segs:{}}}
  if(current)current.classList.remove("speaking");current=c;cards.push(c);$("#cards").append(c);c.scrollIntoView({behavior:"smooth",block:"nearest"})}
function caption(ev){
  const lang=tracks[ev.track];if(!lang)return;
  const card=[...cards].reverse().find(c=>c.dataset.lang===lang);if(!card)return;
  const row=card.rows[ev.listener];if(!row)return;
  let span=row.segs[ev.segment];if(!span){span=el("span");row.segs[ev.segment]=span;row.text.append(span," ")}
  span.textContent=ev.text;span.className=ev.final?"":"partial"}
function results(ev){
  for(const r of ev.sentences){const card=cards.find(c=>c.dataset.id===String(r.sentence_id)&&c.dataset.lang===r.language);if(!card)continue;
    const h=card.rows[r.language];if(h&&r.wer!=null){h.score.textContent="WER "+Math.round(r.wer*100)+"%";h.score.classList.add(r.wer<=ev.limits.max_wer?"ok":"bad")}
    for(const[l,o]of Object.entries(r.translations)){const row=card.rows[l];if(!row)continue;
      row.score.textContent=o.chrf==null?"never arrived":"chrF "+Math.round(o.chrf)+" · "+o.latency_s+" s";
      row.score.classList.add(o.chrf!=null&&o.chrf>=ev.limits.min_chrf?"ok":"bad")}}
  const v=$("#verdict");v.textContent=ev.passed?"PASS":"FAIL";v.className=ev.passed?"ok":"bad";v.title=(ev.problems||[]).join("\n")}
async function join(ev){
  try{room=new LivekitClient.Room();
    room.on(LivekitClient.RoomEvent.TrackSubscribed,(track)=>{if(track.kind==="audio"){const a=track.attach();a.muted=!$("#listen").classList.contains("on");document.body.append(a)}});
    await room.connect(ev.livekit_url,ev.token);}catch(e){$("#listen").disabled=true;$("#listen").title="audio unavailable: "+e}}
const source=new EventSource("/events");
source.onmessage=m=>{const ev=JSON.parse(m.data);
  if(ev.type==="setup"){languages=ev.languages;tracks=ev.tracks;status("room "+ev.room);join(ev)}
  else if(ev.type==="status")status(ev.text);
  else if(ev.type==="sentence")newCard(ev);
  else if(ev.type==="spoken")current&&current.classList.remove("speaking");
  else if(ev.type==="caption")caption(ev);
  else if(ev.type==="results"){results(ev);status("finished");source.close();room&&room.disconnect()}};
source.onerror=()=>status("disconnected (run finished or stopped)");
</script></body></html>
"""
