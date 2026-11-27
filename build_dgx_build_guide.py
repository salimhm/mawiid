"""Builds the DGX caption architecture guide: build path plus design philosophy.

Every technical statement is taken from this checkout:
  services/ai/src/mawiid_ai/agent/worker.py       (Models, stt_plan, admission, threads)
  services/ai/src/mawiid_ai/agent/backlog.py     (bounded audio, drop on overflow)
  services/ai/src/mawiid_ai/agent/pipeline.py    (shedding levels, per-speaker translation chain)
  services/ai/src/mawiid_ai/stt/config.py        (device_index default "0", instances)
  services/ai/src/mawiid_ai/translation/config.py(device_index default "0", inter_threads)
  services/ai/src/mawiid_ai/stt/whisper_engine.py, translation/madlad_engine.py
  infra/compose/docker-compose.yml, docker-compose.gpu.yml, observability/README.md
  services/ai/data/loadtest/local-ramp/summary.json
  services/ai/data/translation-bot/20261125-154308/results.json

Output: output/pdf/mawiid-dgx-caption-architecture-build-guide.pdf
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output/pdf/mawiid-dgx-caption-architecture-build-guide.pdf"

NAVY = colors.HexColor("#123F4A")
TEAL = colors.HexColor("#0F766E")
INK = colors.HexColor("#172331")
MUTED = colors.HexColor("#4E6472")
PALE = colors.HexColor("#F1F7F8")
PALE2 = colors.HexColor("#F7FAFB")
LINE = colors.HexColor("#D5E1E6")
GREEN_BG = colors.HexColor("#E8F5EC")
AMBER_BG = colors.HexColor("#FFF4E0")
RED_BG = colors.HexColor("#FBE7E7")
CODE_BG = colors.HexColor("#F4F8F9")

USABLE = 7.07  # inches between margins on A4


def styles():
    s = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("T", parent=s["Title"], fontName="Helvetica-Bold", fontSize=25, leading=29,
                                textColor=INK, alignment=TA_LEFT, spaceAfter=4),
        "subtitle": ParagraphStyle("ST", parent=s["Normal"], fontName="Helvetica", fontSize=11.6, leading=15.8,
                                   textColor=MUTED, spaceAfter=10),
        "eyebrow": ParagraphStyle("EB", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=7.8, leading=10,
                                  textColor=TEAL, spaceAfter=3),
        "h1": ParagraphStyle("H1", parent=s["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=18.5,
                             textColor=NAVY, spaceBefore=13, spaceAfter=5, keepWithNext=True),
        "h2": ParagraphStyle("H2", parent=s["Heading2"], fontName="Helvetica-Bold", fontSize=10.8, leading=13.5,
                             textColor=NAVY, spaceBefore=9, spaceAfter=3, keepWithNext=True),
        "h3": ParagraphStyle("H3", parent=s["Heading3"], fontName="Helvetica-Bold", fontSize=9.6, leading=12,
                             textColor=INK, spaceBefore=7, spaceAfter=2, keepWithNext=True),
        "body": ParagraphStyle("B", parent=s["BodyText"], fontName="Helvetica", fontSize=9.15, leading=12.6,
                               textColor=INK, spaceAfter=5.5),
        "lead": ParagraphStyle("LD", parent=s["BodyText"], fontName="Helvetica", fontSize=10.0, leading=14.2,
                               textColor=INK, spaceAfter=6),
        "small": ParagraphStyle("SM", parent=s["Normal"], fontName="Helvetica", fontSize=7.7, leading=10.2,
                                textColor=MUTED, spaceAfter=4),
        "bullet": ParagraphStyle("BL", parent=s["BodyText"], fontName="Helvetica", fontSize=9.1, leading=12.4,
                                 textColor=INK, leftIndent=13, firstLineIndent=-8, spaceAfter=2.5),
        "th": ParagraphStyle("TH", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=7.6, leading=9.6,
                             textColor=colors.white),
        "td": ParagraphStyle("TD", parent=s["Normal"], fontName="Helvetica", fontSize=7.6, leading=9.9,
                             textColor=INK),
        "tdb": ParagraphStyle("TDB", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=7.6, leading=9.9,
                              textColor=INK),
        "code": ParagraphStyle("CD", parent=s["Code"], fontName="Courier", fontSize=7.5, leading=10.2,
                               textColor=colors.HexColor("#0E3A44")),
        "node": ParagraphStyle("ND", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=8.0, leading=9.8,
                               textColor=NAVY),
        "nodelbl": ParagraphStyle("NL", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=6.6, leading=8.2,
                                  textColor=MUTED),
        "nodesub": ParagraphStyle("NS", parent=s["Normal"], fontName="Helvetica", fontSize=7.1, leading=8.8,
                                  textColor=INK),
        "caption": ParagraphStyle("CP", parent=s["Normal"], fontName="Helvetica-Oblique", fontSize=7.4, leading=9.4,
                                  textColor=MUTED, spaceBefore=3, spaceAfter=7),
    }


S = styles()


def p(text, style):
    return Paragraph(text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), style)


def raw(text, style):
    """Paragraph that may use the small inline tags written in this file."""
    return Paragraph(text, style)


def table(headers, rows, widths, *, bold_first=False, fills=None, size=None, valign="TOP", pad=3.4):
    head = [p(h, S["th"]) for h in headers] if headers else []
    body = [head] if head else []
    cell = S["td"] if size is None else ParagraphStyle("tds", parent=S["td"], fontSize=size, leading=size + 2.3)
    bold = S["tdb"] if size is None else ParagraphStyle("tdbs", parent=S["tdb"], fontSize=size, leading=size + 2.3)
    for row in rows:
        body.append([p(str(c), bold if (bold_first and i == 0) else cell) for i, c in enumerate(row)])
    t = Table(body, colWidths=[w * inch for w in widths], repeatRows=1 if head else 0, hAlign="LEFT")
    cmds = [
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), valign),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
        ("LEFTPADDING", (0, 0), (-1, -1), 4.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4.5),
    ]
    if head:
        cmds.append(("BACKGROUND", (0, 0), (-1, 0), NAVY))
    start = 1 if head else 0
    for r in range(start, len(body)):
        cmds.append(("BACKGROUND", (0, r), (-1, r), colors.white if (r - start) % 2 == 0 else PALE2))
    for (r, c), color in (fills or {}).items():
        cmds.append(("BACKGROUND", (c, r), (c, r), color))
    t.setStyle(TableStyle(cmds))
    return t


def code(text):
    t = Table([[Preformatted(text, S["code"])]], colWidths=[USABLE * inch], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, NAVY),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def callout(label, text, kind="info"):
    bg, edge = {
        "info": (PALE, NAVY),
        "good": (GREEN_BG, colors.HexColor("#1E7A53")),
        "warn": (AMBER_BG, colors.HexColor("#A65D05")),
        "bad": (RED_BG, colors.HexColor("#A62929")),
    }[kind]
    inner = raw(
        f'<font size="6.9" color="#4E6472"><b>{label.upper()}</b></font><br/>{text}',
        ParagraphStyle("callout", parent=S["body"], fontSize=9.0, leading=12.4, spaceAfter=0),
    )
    t = Table([[inner]], colWidths=[USABLE * inch], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ]))
    return t


def box(label, title, sub, kind="dgx", width=1.7):
    bg = {"vm": colors.HexColor("#EDF5FA"), "dgx": colors.HexColor("#EDF9F6"),
          "bad": colors.HexColor("#FDF1F1"), "plain": colors.white}[kind]
    edge = {"vm": colors.HexColor("#91B8CC"), "dgx": colors.HexColor("#86BFB4"),
            "bad": colors.HexColor("#D9A4A4"), "plain": LINE}[kind]
    inner = [
        raw(f'<font size="6.3" color="#4E6472"><b>{label.upper()}</b></font>', S["nodelbl"]),
        p(title, S["node"]),
        p(sub, S["nodesub"]),
    ]
    t = Table([[inner]], colWidths=[width * inch], hAlign="CENTER", vAlign="MIDDLE")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, edge),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def arrow(symbol="->", size=11):
    return raw(f'<font size="{size}" color="#1B6B84"><b>{symbol}</b></font>',
               ParagraphStyle("ar", parent=S["body"], alignment=1, spaceAfter=0))


def flow(nodes, widths=None):
    """nodes: list of flowables; arrows are inserted between them."""
    cells, cols = [], []
    for i, item in enumerate(nodes):
        if i:
            cells.append(arrow())
            cols.append(0.26)
        cells.append(item)
        cols.append(widths[i // 2] if widths else 1.6)
    t = Table([cells], colWidths=[c * inch for c in cols], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def stage(num, title, goal, do, check, files=None):
    rows = [("Goal", goal), ("Do", do), ("Check", check)]
    if files:
        rows.append(("Touch", files))
    return [
        raw(f'<font size="6.9" color="#0F766E"><b>STAGE {num}</b></font>'
            f'<br/><font size="11.2" color="#123F4A"><b>{title}</b></font>', S["h2"]),
        table(None, rows, [0.72, 6.3], bold_first=True, size=7.7),
        Spacer(1, 6),
    ]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(0.6 * inch, 0.52 * inch, (0.6 + USABLE) * inch, 0.52 * inch)
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.6 * inch, 0.33 * inch, "Mawiid  |  DGX caption architecture  |  build path v1.0  |  26 November 2026")
    canvas.drawRightString((0.6 + USABLE) * inch, 0.33 * inch, f"{doc.page}")
    canvas.restoreState()


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.55 * inch, bottomMargin=0.72 * inch,
        title="Mawiid DGX caption architecture - build path",
        author="Mawiid",
        subject="Build path and design philosophy for running live captions on the DGX",
    )

    s = []
    # ---------------------------------------------------------------- cover
    s += [
        p("MAWIID  /  ENGINEERING BUILD GUIDE", S["eyebrow"]),
        p("Building the DGX caption service", S["title"]),
        p("A staged build path from the 10-room overload to a measured GPU service, and the reasoning "
          "behind each architectural choice.", S["subtitle"]),
    ]
    s.append(table(
        None,
        [
            ("Companion", "Live captions on the DGX - architecture decision brief, 26 November 2026."),
            ("Scope", "AI caption worker, LiveKit, application VM, DGX host, observability."),
            ("Grounding", "Every default, file path and environment variable below is read from this checkout."),
            ("Not claimed", "No DGX capacity number. Nothing here was measured on the DGX, because it has not run there."),
        ],
        [1.05, 5.97], bold_first=True, size=7.9,
    ))
    s.append(Spacer(1, 9))
    s.append(callout(
        "The path in one paragraph",
        "Move the AI worker to the DGX and keep the application, LiveKit and dashboards on the 8 GB VM. Inside the "
        "existing worker process, turn on the multi-GPU path the code already supports: one Whisper replica per GPU, "
        "one MADLAD replica per GPU, with a bounded queue in front of both. Then measure one dimension at a time - "
        "speakers first, then rooms - and only build inference servers if those numbers say the single process has "
        "run out of road. The smallest change that can prove ten rooms, and the only one whose failure mode is "
        "degraded captions rather than a broken meeting.",
        "good",
    ))
    s.append(Spacer(1, 8))
    s.append(raw("<b>Why this document exists.</b> The decision brief states the decision. This guide states how to "
                 "build it: the order of work, the exact files and settings, the check that ends each stage, and the "
                 "reason each choice was made instead of the obvious alternative.", S["body"]))
    s.append(p("How to use this guide", S["h2"]))
    s.append(p("Read sections 1 and 2 with the team to agree on the problem and the rules. Then work section 4 from "
               "stage 0 downwards, in order, stopping at every Check - a stage that has not passed its check is not "
               "finished, however good the next one looks. Sections 5 to 8 are reference and closure.", S["body"]))
    s.append(p("What is in it", S["h2"]))
    s.append(table(
        None,
        [
            ("1  The overload problem", "Where work actually serializes in this code, and why more containers do not help."),
            ("2  Design philosophy", "Five rules, each with the alternative it rules out."),
            ("3  Target architecture", "Topology, what runs where, and one phrase end to end."),
            ("4  Build path", "Nine stages from a blank DGX to a measured capacity result."),
            ("5  Configuration reference", "Every default in the code against the Phase 1 value, and the trap in each."),
            ("6  Phase 2", "What the inference-router design is, and the measurements that would justify it."),
            ("7  Failure modes", "The seven ways this build goes wrong silently, and how each is caught."),
            ("8  Definition of done", "The gates, and the artifact behind every claim in this guide."),
        ],
        [1.55, 5.47], bold_first=True, size=7.9,
    ))

    # ---------------------------------------------------------------- 1
    s.append(PageBreak())
    s.append(p("1. The overload problem, stated precisely", S["h1"]))
    s.append(p("The caption worker does not crash under load. It queues. Every speaker's audio is pumped into a "
               "bounded backlog, a per-speaker loop cuts it into phrases, asks Whisper for text, asks MADLAD for "
               "translations, and publishes the result. Overload is what happens when phrases arrive faster than "
               "the two models retire them: latency grows, the backlog overflows, audio is dropped, and captions "
               "thin out until a listener sees nothing.", S["lead"]))
    s.append(table(
        ["Speakers at once, one room", "Caption p95", "Audio dropped", "STT p95", "Translation p95"],
        [
            ("1", "6.54 s", "0%", "2.17 s", "6.73 s"),
            ("2", "13.11 s", "2.9%", "4.83 s", "7.16 s"),
            ("3", "19.17 s", "7.4%", "9.63 s", "13.21 s"),
            ("4", "21.38 s", "22.7%", "15.47 s", "26.61 s"),
            ("5", "23.34 s", "30.9%", "15.61 s", "13.21 s"),
        ],
        [1.45, 1.05, 1.0, 1.05, 1.3], bold_first=True,
        fills={(1, 0): AMBER_BG, (2, 0): RED_BG, (3, 0): RED_BG, (4, 0): RED_BG, (5, 0): RED_BG},
    ))
    s.append(p("Source: services/ai/data/loadtest/local-ramp/summary.json. One room, five bot speakers, fifteen "
               "minutes, CPU only. The absolute values are a CPU machine's, but the shape is the finding: p95 "
               "roughly doubles from one speaker to two and keeps climbing, while the volume thrown away rises with "
               "it. Capacity is consumed by simultaneous speech, not by head-count in the room.", S["small"]))

    s.append(p("1.1 The three places where work serializes", S["h2"]))
    s.append(p("Overload is not diffuse. In this code it comes from three concrete places, and each has a different "
               "fix.", S["body"]))
    s.append(table(
        ["Where", "What the code actually does", "Consequence"],
        [
            ("Default GPU index",
             "WhisperSettings.device_index and MadladSettings.device_index both default to [0], read from "
             "MAWIID_STT_WHISPER_DEVICE_INDEX and MAWIID_MT_DEVICE_INDEX.",
             "Every decode in the process targets GPU 0, however many GPUs the host has. The other GPUs are idle "
             "capacity the application never asks for."),
            ("One translation object per process",
             "worker.load_models() builds a single SubtitleTranslator once and hands that same object to every "
             "RoomPipeline. MadladEngine creates one ctranslate2.Translator with inter_threads=1 by default.",
             "All rooms' finals enter one translation engine. CTranslate2 serializes calls inside it, so rooms "
             "queue behind each other's translations."),
            ("One speech-to-text path on GPU",
             "stt_plan() returns exactly one copy when the device is CUDA (the 'else 1' branch), so Models.stt "
             "holds one SttInstance and acquire() hands the same instance to every room.",
             "Rooms share one decode path with a fixed number of workers; a busy room slows every room on it."),
            ("Per-speaker translation chain",
             "RoomPipeline awaits the speaker's previous translation before starting the next one; the wait is "
             "recorded as mawiid_caption_translation_queue_duration_seconds.",
             "Correct for ordering, but one slow translation delays that speaker's following captions as well."),
        ],
        [1.28, 3.05, 2.72], bold_first=True, size=7.3,
    ))
    s.append(p("The measured stage split points at translation first: at one speaker the median translation is "
               "2.38 s against 0.68 s for speech recognition. Whisper becomes the wall only later, at five "
               "speakers (9.63 s against 5.87 s). A plan that only fixes the speech model fixes the wrong stage "
               "first.", S["body"]))
    s.append(callout(
        "The sentence that names the bug",
        "The worker scales rooms by adding threads, but scales throughput only by adding replicas - and the "
        "replica count is one, on one GPU, for both models. Threads wait on a single service; they do not make it "
        "faster.",
        "bad",
    ))

    s.append(p("1.2 Why running eight containers does not fix it", S["h2"]))
    s.append(p("The intuitive move is to run eight copies of the AI service and let LiveKit spread rooms across "
               "them. It buys failure isolation, and it is the wrong first move for three reasons.", S["body"]))
    for text in [
        "VRAM is the scarce resource, not process count. Each container loads its own weights: eight containers "
        "mean eight copies of Whisper, eight of the Darija model while ar-MA is enabled, and eight MADLAD copies "
        "at roughly 2.8 GB each in int8. Most of the DGX would hold duplicates.",
        "Nothing is shared. A Python model object cannot be shared across processes; the only sharing available "
        "across the DGX is replication - the same weights resident on each GPU, addressed by one process.",
        "The queue moves instead of shrinking. Eight engines fed by the same per-room demand still retire one "
        "phrase per engine slot at a time; what actually rises is the number of decode slots, which the code can "
        "already do inside one process.",
    ]:
        s.append(p("- " + text, S["bullet"]))
    s.append(p("The correct reading of 'share the model' is therefore: one copy per GPU, one process addressing "
               "them all. That is exactly what device_index and num_workers already implement.", S["body"]))

    s.append(p("1.3 French is not the fault", S["h2"]))
    s.append(p("The latest French bot run delivered 5 of 5 French transcripts (word error 0.268) and 5 of 5 "
               "translations in both directions, with a median of 3.79 s and a maximum of 6.21 s. A broken French "
               "engine would lose French captions; a saturated engine stretches latency for every language "
               "equally, and French finals still compete for the shared translator when listeners ask for English "
               "or Arabic. The French numbers are small-sample evidence about quality, not a capacity result.", S["body"]))
    s.append(p("Source: services/ai/data/translation-bot/20261125-154308/results.json.", S["small"]))

    s.append(p("1.4 The arithmetic for ten rooms", S["h2"]))
    s.append(p("The ramp measured one room with five speakers; the target is ten rooms of ten people. The bridge "
               "between them is not a forecast, it is arithmetic on measured rates - and it is the reason this "
               "plan measures instead of predicting.", S["body"]))
    s.append(table(
        ["Quantity", "Value", "Where it comes from"],
        [
            ("Expected captions in the ramp", "952 over 15 minutes", "summary.json, one room, five speakers"),
            ("Implied caption rate, whole room", "about 1.06 per second", "952 divided by 900 seconds"),
            ("Implied rate per active speaker", "about 0.21 per second, one phrase every 4.7 s of speech",
             "the room rate divided by five speakers"),
            ("Ten rooms with three speakers each", "about 6.3 phrases per second before any translation",
             "30 speakers at 0.21; three per room is an assumption, chosen to show scale"),
            ("Added translation demand", "one call per target-language group present in the room",
             "translator.py groups listeners by target language"),
            ("Rate the current layout sustained", "1.06 per second, at p95 23.34 s and 30.9% dropped",
             "the same ramp, at its worst stage"),
        ],
        [1.75, 2.55, 2.72], bold_first=True, size=7.2,
    ))
    s.append(p("Six times the arrival rate that already missed the target by a factor of eight. Nothing in this "
               "table is a capacity claim: it does not say the DGX will manage ten rooms, and it does not say it "
               "will fail. It says the gap between the measured system and the requested system is wide enough "
               "that the next step must be replicas and measurement, not tuning.", S["body"]))

    s.append(p("1.5 What the code already gets right", S["h2"]))
    s.append(p("This matters for the build path, not just for morale. Because the pipeline already degrades instead "
               "of collapsing, Phase 1 can be a deployment and configuration change. A system without these "
               "protections would need the rewrite first.", S["body"]))
    s.append(table(
        ["Protection", "Where it lives", "What it prevents"],
        [
            ("Bounded audio, five seconds per speaker", "agent/backlog.py, MAWIID_AGENT_MAX_BACKLOG_S",
             "Audio piling up at 32 KB/s per speaker until the process dies. On overflow the whole backlog is "
             "dropped, so the pipeline resumes on live speech rather than stale fragments."),
            ("Three-step caption shedding", "agent/pipeline.py, levels 1 to 3",
             "Silent quality collapse with no explanation. Partials go first, then the Darija model, then "
             "translation; the original transcript is always kept and listeners are told."),
            ("Admission control", "worker.py, MAWIID_AGENT_MAX_ROOMS through the load function",
             "A tenth room queueing behind the ninth instead of being dispatched elsewhere."),
            ("One translation per language, not per listener", "translation/translator.py",
             "Ten French listeners costing ten translations. Listeners are grouped by target language before the "
             "model is called."),
            ("Engine failover with cooldown", "stt/router.py, translation/config.py",
             "A failing engine being retried on every phrase. A failed engine is skipped for 60 s, and the next "
             "engine in the chain takes over."),
        ],
        [1.62, 1.95, 3.5], bold_first=True, size=7.2,
    ))
    s.append(p("The build path below therefore adds capacity to something that is already safe to overload. That is "
               "the whole reason it can start with a device-index list instead of a new service.", S["body"]))

    # ---------------------------------------------------------------- 2
    s.append(PageBreak())
    s.append(p("2. The philosophy behind the design", S["h1"]))
    s.append(p("Five principles decide every choice in this guide. They are stated as rules because each one rules "
               "out a plausible alternative that would have cost money or trust.", S["lead"]))

    principles = [
        ("P1. Scale the decode slots, not the process count.",
         "A GPU with idle capacity that our configuration never addresses is worth nothing. CTranslate2 will hold "
         "one replica of the same model per listed GPU and run several workers per replica, so the cheapest real "
         "capacity increase in this system is a device-index list plus a worker count - not another container.",
         "It forbids treating 'add replicas' as 'add services'. Nine processes remain slow if all nine still "
         "point at GPU 0."),
        ("P2. One copy of the weights per GPU. Replicate, never shard.",
         "Whisper small and MADLAD 3B each fit on a single GPU. Splitting either across GPUs buys communication "
         "overhead and a synchronisation point in the latency path, for models that do not need it. Replication is "
         "linear in independent requests, which is what captions are: one phrase in, one translation out.",
         "It forbids tensor or pipeline parallelism for these models, and it forbids the belief that containers "
         "share weights."),
        ("P3. Bound every queue. Drop captions, never memory or media.",
         "BoundedAudio caps each speaker at five seconds of waiting audio and, on overflow, discards the whole "
         "backlog so the pipeline resumes on live speech instead of stitching stale fragments. Above that, the "
         "pipeline sheds in three steps - no partial transcripts, then no Darija model, then originals only with "
         "no translation - and tells listeners. Audio publishing is never touched.",
         "It forbids enlarging a buffer or removing backpressure to hide overload, and any change that lets "
         "caption pressure reach room media."),
        ("P4. Put each job on the host that is good at it.",
         "The VM is good at TLS, signalling, WebRTC relay, the API, Redis and dashboards; 8 GB of RAM is enough for "
         "all of that and not for weights. The DGX is good at CUDA decode and has the model cache. One private "
         "path joins them, and nothing about inference is reachable from the internet.",
         "It forbids model weights on the application VM, and a public /metrics or transcript-upload endpoint."),
        ("P5. Change one dimension per measurement; let evidence choose the next architecture.",
         "One room with ten talkers and ten rooms with one talker are different experiments. Running ten-by-ten "
         "first mixes speaker pressure with room-count pressure and produces a number nobody can act on. Each "
         "stage in this guide ends with the check that makes the next stage decidable.",
         "It forbids choosing the model-server rewrite before Phase 1 numbers exist, and forbids reporting a DGX "
         "capacity that was never measured."),
    ]
    for title, why, forbids in principles:
        s.append(p(title, S["h2"]))
        s.append(p(why, S["body"]))
        s.append(raw("<b>What it rules out.</b> " + forbids, S["small"]))
        s.append(Spacer(1, 2))

    s.append(callout(
        "The asymmetry that justifies the order",
        "Adding a replica that turns out to be unnecessary costs an afternoon and a configuration line. Building "
        "an inference-router tier that turns out to be unnecessary costs weeks, a new failure domain in the "
        "latency path, and a batching delay nobody asked for. So the cheap reversals come first.",
        "info",
    ))

    # ---------------------------------------------------------------- 3
    s.append(PageBreak())
    s.append(p("3. The target architecture", S["h1"]))
    s.append(flow(
        [
            box("Public", "People in a room", "browser, microphone, captions on", "vm", 1.59),
            box("App VM - 8 GB", "Caddy + backend", "LiveKit, Redis, Prometheus, Grafana", "vm", 1.79),
            box("Private link", "Authenticated", "signalling, transcript upload, metrics scrape", "plain", 1.43),
            box("DGX - private host", "One AI process", "room jobs as threads, bounded audio, shedding", "dgx", 1.80),
        ],
        widths=[1.62, 1.82, 1.46, 1.83],
    ))
    s.append(p("Figure 1. Target topology, Phase 1. The DGX holds no public route and no database.", S["caption"]))
    s.append(flow(
        [
            box("GPU 0-3", "Whisper replicas", "one model copy per GPU, 2 workers each", "dgx", 2.12),
            box("GPU 4-5", "MADLAD replicas", "one model copy per GPU, 2 threads each", "dgx", 2.12),
            box("Model volume", "ai_models", "converted weights, mounted, never baked into the image", "dgx", 2.31),
        ],
        widths=[2.15, 2.15, 2.34],
    ))
    s.append(p("Figure 2. Inside the DGX process: replicas are addressed by device index, not by more processes.",
               S["caption"]))

    s.append(p("3.1 What runs where, and why", S["h2"]))
    s.append(table(
        ["Host", "Runs", "Does not run", "Reason"],
        [
            ("Application VM", "Caddy with TLS, Bun backend, Redis, LiveKit, Prometheus and Grafana, database access",
             "Whisper or MADLAD weights, CUDA, model caches",
             "Public entry points and the SFU need stable networking and little memory; the models need neither."),
            ("DGX", "One AI worker process, model replicas on GPUs 0-5, model volume, private metrics endpoint",
             "Public routes, Caddy, Grafana, database ownership",
             "GPU memory and CUDA live here; exposing application routes here would widen the attack surface for "
             "no benefit."),
        ],
        [1.02, 2.42, 1.66, 1.95], bold_first=True, size=7.3,
    ))

    s.append(p("3.2 One phrase, end to end", S["h2"]))
    for step in [
        "The browser publishes microphone audio to LiveKit on the VM. The worker joins the room as an agent "
        "participant and subscribes to audio only.",
        "LiveKit delivers 100 ms chunks. pump() moves them into a BoundedAudio for that speaker, capped at "
        "MAWIID_AGENT_MAX_BACKLOG_S seconds; overflow drops the backlog and increments "
        "mawiid_caption_audio_dropped_seconds_total.",
        "The per-speaker loop runs a voice detector, cuts a phrase, and calls Whisper on the replica chosen by "
        "device index. Grading: partials use beam 1, finals use beam 5.",
        "The final goes to the shared translator, which groups listeners by target language and calls MADLAD once "
        "per language group - so ten listeners of French cost one translation, not ten.",
        "Subtitles are published back into the room and the final transcript is uploaded to the backend over the "
        "private path. The upload failure never blocks captions.",
    ]:
        s.append(p("- " + step, S["bullet"]))

    s.append(p("3.3 The honest cost of one process", S["h2"]))
    s.append(p("Room jobs execute as threads in a single Python process (JobExecutorType.THREAD), and that is what "
               "makes weight sharing real. It has a price worth stating: a process crash ends every room that "
               "worker was captioning, and a Python-level stall is felt by all of them. Phase 1 accepts this "
               "because the alternative - one process per room - multiplies weights by room count, and because "
               "LiveKit re-dispatches a room when a worker's load function reports full. Failure isolation is "
               "bought later, deliberately, by running a second worker replica once the capacity numbers justify "
               "it.", S["body"]))

    # ---------------------------------------------------------------- 4
    s.append(PageBreak())
    s.append(p("4. The build path", S["h1"]))
    s.append(p("Nine stages, each ending in a check that can fail. Nothing in a later stage is allowed to hide a "
               "failure in an earlier one; that rule is what makes the final capacity number trustworthy.", S["lead"]))

    s += stage(
        0, "Record the baseline before touching anything",
        "Make the starting point auditable, so any later number has something to be compared with.",
        "On the DGX: git rev-parse HEAD, nvidia-smi -L, nvidia-smi --query-gpu=index,name,memory.total "
        "--format=csv, the CUDA driver version, and the contents of the model directory. Write it to "
        "docs/dgx-baseline-2026-11-26.md and commit it. On the VM: keep the existing CPU numbers from the load "
        "ramp as the floor, not as a forecast.",
        "The file lists every GPU with its index and memory size, and names which indices will host speech and "
        "which will host translation. If the topology disagrees with GPUs 0-3 / 4-5, the index plan changes here, "
        "not during a test.",
        "docs/dgx-baseline-2026-11-26.md",
    )

    s += stage(
        1, "Prepare the host and the model volume",
        "Have a CUDA image that sees every GPU, and converted weights that live on a volume rather than in the image.",
        "Install the NVIDIA driver and container toolkit. Build the AI image with CUDA enabled (the Dockerfile "
        "takes CUDA as a build argument; infra/compose/docker-compose.yml passes AI_CUDA through). Convert and "
        "keep the models once: make ai-models writes data/models/madlad400-3b-mt-ct2, and make ai-models-darija "
        "writes whisper-darija-ct2 while ar-MA stays enabled. Mount them as ai_models and keep the download cache "
        "as ai_cache.",
        "docker run --rm --gpus all <image> nvidia-smi lists every GPU inside the container. model.bin and "
        "spiece.model exist under madlad400-3b-mt-ct2. One short translation runs on CUDA and appears in the log "
        "as 'loading madlad ... on cuda (int8_bfloat16)'.",
        "infra/compose/Dockerfile.ai, Makefile (ai-models, ai-models-darija)",
    )

    s += stage(
        2, "Split the deployment into two hosts",
        "Describe the VM stack and the DGX worker separately, instead of copying the full Compose stack onto the DGX.",
        "Keep infra/compose/docker-compose.yml as the VM stack. Add infra/compose/docker-compose.dgx.yml that "
        "defines only the ai service, with the NVIDIA device reservation and env_file: ai.dgx.env, and add "
        "infra/compose/ai.dgx.env.example listing every variable the DGX needs. Leave docker-compose.gpu.yml as "
        "the convenience overlay for a single-host development machine.",
        "On the DGX, docker compose -f docker-compose.dgx.yml config renders exactly one service and no Caddy, "
        "LiveKit, Redis or backend. On the VM, the application stack still starts with the ai profile disabled.",
        "infra/compose/docker-compose.dgx.yml (new), ai.dgx.env.example (new)",
    )

    s += stage(
        3, "Open one private path, and only one",
        "Make the DGX able to reach LiveKit and the backend, with nothing of the DGX reachable from the internet.",
        "DGX environment: LIVEKIT_URL=wss://rtc.<domain> for signalling, MAWIID_BACKEND_URL=http://<vm-private-ip>:3000, "
        "INTERNAL_SERVICE_TOKEN with the VM's value, and MAWIID_METRICS_HOST=<dgx-private-ip> so the metrics "
        "endpoint binds the private interface rather than loopback. VM firewall: allow the DGX private address to "
        "the LiveKit ports and 3000 only. DGX firewall: allow the VM private address to 9464 only, outbound to "
        "that VM only.",
        "From the DGX, a request to http://<vm-private-ip>:3000/health succeeds and a caption session publishes "
        "captions into the room. From the public internet, the backend port and 9464 are unreachable, /api/metrics "
        "through Caddy still returns 404, and the internal transcript route is not exposed. Prometheus on the VM "
        "scrapes <dgx-private-ip>:9464.",
        "infra/compose/ai.dgx.env, infra/compose/observability/README.md",
    )

    s += stage(
        4, "Turn on the GPU replicas - the actual capacity change",
        "Give the existing process several decode slots instead of one, without touching application code.",
        "Set AI_CUDA=1, MAWIID_STT_WHISPER_DEVICE=cuda, MAWIID_STT_WHISPER_DEVICE_INDEX=0,1,2,3, "
        "MAWIID_STT_WHISPER_NUM_WORKERS=2, MAWIID_MT_DEVICE=cuda, MAWIID_MT_DEVICE_INDEX=4,5 and "
        "MAWIID_MT_INTER_THREADS=2. Leave MAWIID_STT_INSTANCES unset: on GPU it means one copy, and that copy "
        "already carries one replica per listed GPU. Budget VRAM for two model families, because with "
        "MAWIID_STT_DETECT_DARIJA=1 the Darija engine takes the same index list.",
        "The worker logs 'loading 1 speech-to-text model copy' (not four). During one captioned call, nvidia-smi "
        "shows memory on every listed GPU and no single GPU carrying all of it. French captions are still correct "
        "and still arrive.",
        "services/ai/src/mawiid_ai/stt/config.py, translation/config.py (device_index, num_workers, inter_threads)",
    )

    s += stage(
        5, "Set admission and backpressure to test values",
        "Make overload visible and bounded before any capacity run, so a failure produces evidence rather than an "
        "outage.",
        "MAWIID_AGENT_MAX_ROOMS=10 as a test target (the load function then reports full and LiveKit dispatches "
        "elsewhere or waits), MAWIID_AGENT_MAX_BACKLOG_S=5, MAWIID_STT_PARTIALS=0 and MAWIID_MT_PARTIALS=0 for "
        "the validation runs, and MAWIID_STAGE_TIMINGS=1 only during load tests so per-stage timings appear on "
        "captions without costing production traffic.",
        "An eleventh room does not queue behind the tenth. mawiid_caption_audio_dropped_seconds_total stays at "
        "zero under normal expected load, and mawiid_caption_degraded_rooms stays at zero; if either moves, the "
        "run is a finding, not a nuisance.",
        "services/ai/src/mawiid_ai/agent/worker.py, backlog.py, pipeline.py",
    )

    s += stage(
        6, "Make the DGX visible before measuring it",
        "Replace 'captions feel slow' with panels that say which stage and which GPU.",
        "Point Prometheus at the DGX metrics endpoint and add a per-GPU exporter. Panels: p95 of "
        "mawiid_caption_processing_latency_seconds, mawiid_caption_active_rooms, "
        "mawiid_caption_audio_dropped_seconds_total, mawiid_caption_degraded_rooms, "
        "mawiid_caption_shedding_changes_total, and per-GPU utilisation and memory. The worker already emits all "
        "of the caption signals; only the GPU exporter is new.",
        "A two-minute captioned call produces non-empty series for latency, active rooms, and utilisation on the "
        "intended GPUs. A deliberately idle GPU shows zero while active rooms are above zero - which is how a "
        "silent fallback to GPU 0 is caught.",
        "infra/compose/observability/, services/ai/src/mawiid_ai/metrics.py",
    )

    s += stage(
        7, "Prove capacity in four experiments, in this order",
        "Separate speaker pressure from room-count pressure, then test the real target, then prove nothing regressed.",
        "E1: one room, ramp one to ten simultaneous talkers. E2: many rooms with one talker each, thirty minutes. "
        "E3: ten rooms by ten users, thirty minutes, first with realistic overlap then worst-case overlap. E4: "
        "the French bot before and after, to show the change did not damage quality.",
        "Each experiment has a written gate before it starts: caption p95 at or below 3 s, audio dropped at zero "
        "in expected load, no unexplained reduced or paused state, GPU memory and utilisation recorded per GPU, "
        "VM health flat, French delivery complete. A run that misses a gate is reported as a miss, not repeated "
        "until it passes.",
        "services/ai/data/ (new run bundles)",
    )

    s += stage(
        8, "Decide with one page, then stop or build Phase 2",
        "Convert measurements into a decision instead of an opinion.",
        "Write the four result tables and one recommendation. If the target is met, freeze the configuration and "
        "document it; Phase 2 is not built. If utilisation is high and latency still misses, add replicas or "
        "revisit the model size. If latency grows with rooms while GPUs sit under 60 percent, the limiter is "
        "ingestion and queueing, and Phase 2 is justified by that number.",
        "The page states, in one sentence each: what was measured, on which hardware, against which gate, and "
        "what is therefore being built next. No capacity claim appears without a run bundle behind it.",
        "docs/ (decision record)",
    )

    # ---------------------------------------------------------------- 5
    s.append(p("5. Configuration reference", S["h1"]))
    s.append(p("Defaults are what this checkout does when the variable is absent - not recommendations. The DGX "
               "column is the Phase 1 starting point, to be tuned only after a measured run.", S["lead"]))
    s.append(table(
        ["Variable", "Default in code", "Phase 1 on the DGX", "What it changes"],
        [
            ("AI_CUDA", "0", "1", "Builds the image with CUDA support."),
            ("MAWIID_STT_WHISPER_DEVICE", "auto", "cuda", "Forces the CUDA path instead of detecting it."),
            ("MAWIID_STT_WHISPER_DEVICE_INDEX", "0", "0,1,2,3", "One model replica per listed GPU. The single "
             "most important line for capacity."),
            ("MAWIID_STT_WHISPER_NUM_WORKERS", "1", "2", "Concurrent decodes per replica."),
            ("MAWIID_STT_INSTANCES", "0, which means 1 on GPU", "leave unset", "Number of model copies in the process. On GPU "
             "the default is already one; setting it above one multiplies replicas across the same index list."),
            ("MAWIID_STT_WHISPER_MODEL", "small", "keep small for E1-E3", "Changing model size changes memory and "
             "latency; it is a separate experiment, not a stage."),
            ("MAWIID_STT_DETECT_DARIJA", "1", "1", "Loads the Darija engine, which takes the same index list - "
             "budget VRAM for two STT model families."),
            ("MAWIID_STT_PARTIALS", "1", "0 for validation", "Partials multiply decode demand; finals first."),
            ("MAWIID_MT_DEVICE", "auto", "cuda", "Forces CUDA for translation."),
            ("MAWIID_MT_DEVICE_INDEX", "0", "4,5", "One MADLAD replica per listed GPU."),
            ("MAWIID_MT_INTER_THREADS", "1", "2", "Translation batches in flight per replica."),
            ("MAWIID_MT_MODEL", "3b", "3b", "10b needs about 11 GB and is roughly three times slower; decide with "
             "E4, not with free VRAM."),
            ("MAWIID_MT_PARTIALS", "0", "0", "Live translation of partials; keep off until finals meet the target."),
            ("MAWIID_AGENT_MAX_ROOMS", "0 (no limit)", "10", "Admission control: reports full so LiveKit dispatches "
             "elsewhere."),
            ("MAWIID_AGENT_MAX_BACKLOG_S", "5", "5", "Audio a speaker may have waiting before the backlog is dropped."),
            ("MAWIID_METRICS_HOST / PORT", "127.0.0.1 / 9464", "private IP / 9464", "Keeps the exporter private "
             "while letting Prometheus on the VM scrape it."),
            ("MAWIID_STAGE_TIMINGS", "0", "1 during load tests", "Adds per-stage timings to captions for latency "
             "attribution."),
            ("MAWIID_LANGUAGES", "en-US,fr-FR,ar-SA,ar-MA", "unchanged", "Controls which engines load; turning "
             "ar-MA off removes the Darija model."),
        ],
        [2.18, 1.0, 1.05, 2.84], bold_first=True, size=6.85,
    ))
    s.append(callout(
        "The multiplier nobody expects",
        "MAWIID_STT_INSTANCES counts model copies inside one process, not GPUs. With MAWIID_STT_INSTANCES=4 and an "
        "index list of 0,1,2,3, each of the four copies builds its own engine with four GPU replicas - sixteen "
        "Whisper replicas, plus sixteen Darija replicas. One copy and a four-GPU index list is the intended shape.",
        "warn",
    ))

    # ---------------------------------------------------------------- 6
    s.append(PageBreak())
    s.append(p("6. Phase 2: what it is, and what would justify it", S["h1"]))
    s.append(flow(
        [
            box("LiveKit", "Audio tracks", "per speaker, 100 ms chunks", "vm", 1.47),
            box("Ingest workers", "VAD, bounded audio", "cheap, many, publish captions", "dgx", 1.87),
            box("Inference router", "Bounded queue", "micro-batch across rooms", "dgx", 1.69),
            box("Model servers", "One per GPU", "STT and translation, separately scaled", "dgx", 1.67),
        ],
        widths=[1.5, 1.9, 1.72, 1.7],
    ))
    s.append(p("Figure 3. Phase 2 separates cheap room ingestion from expensive model inference.", S["caption"]))
    s.append(p("The refactor is smaller than it sounds, because the code is already cut along the right seams: the "
               "pipeline talks to an SttRouter and a TranslationEngine rather than to CUDA, and every call is "
               "already funnelled through build_router() and build_translator(). Phase 2 replaces those factories "
               "with clients and moves the engines behind a request queue; the room loop, the shedding ladder and "
               "the publishing path stay as they are.", S["body"]))
    s.append(table(
        ["Measured outcome", "Reading", "Next step"],
        [
            ("Ten by ten holds p95 at or below 3 s with zero drops", "The single process has enough slots",
             "Stop. Document the configuration. Phase 2 is not built."),
            ("Latency misses only when GPU utilisation is above 80 percent", "The GPUs are the limit",
             "Add replicas, or revisit model size (3B vs 10B), before adding architecture."),
            ("Latency grows with room count while GPUs sit under 60 percent", "Ingestion and queueing are the limit",
             "Phase 2: router with micro-batching, ingest workers kept thin."),
            ("One process is a failure-domain problem (a crash takes every room)", "Isolation, not throughput",
             "A second worker replica first; model servers only if isolation is still insufficient."),
        ],
        [2.2, 2.1, 2.77], bold_first=True, size=7.3,
    ))
    s.append(p("Why not build it now: Phase 2 adds a network hop inside the latency path, a serialisation format "
               "for audio, a batching window that can add tens to hundreds of milliseconds by design, and a router "
               "queue that becomes a new place to lose captions. None of that is needed to find out whether six "
               "GPU replicas carry ten rooms. If they do, the router is pure cost.", S["body"]))

    # ---------------------------------------------------------------- 7
    s.append(p("7. Failure modes and how to catch them", S["h1"]))
    s.append(table(
        ["Failure", "How it shows up", "How it is caught, and fixed"],
        [
            ("Silent fallback to GPU 0", "Every GPU but one sits at zero memory while captions are slow",
             "Check nvidia-smi during the first captioned call in stage 4; alert when active rooms are above zero "
             "and a listed GPU is idle. Fix the index list, not the timeout."),
            ("VRAM exhaustion at start", "CUDA out of memory while loading models",
             "Count replicas per model family before choosing indices; start with two STT GPUs and one MT GPU, "
             "then add after a measured run."),
            ("Darija doubles the STT footprint", "Loading succeeds but each STT replica now exists twice",
             "Budget for it in stage 4, or set MAWIID_STT_DETECT_DARIJA=0 during capacity runs and record that the "
             "run did not exercise Darija."),
            ("Cross-host name resolution", "The worker cannot reach ws://livekit:7880 from the DGX",
             "Docker service names do not resolve across hosts. Use the private address or a private DNS name, and "
             "prove it with the stage 3 check before starting a load run."),
            ("Metrics exposed publicly", "9464 reachable from the internet",
             "Bind MAWIID_METRICS_HOST to the private interface and allow only the app VM's address in the firewall."),
            ("The wrong model chosen for the wrong reason", "10B selected because the DGX has spare VRAM",
             "Run E4 on both sizes; the repository's own note is that 10B is about three times slower."),
            ("Overload mistaken for a crash", "Restart loops, no root cause, blame on LiveKit",
             "Read mawiid_caption_audio_dropped_seconds_total and the shedding level before restarting anything; "
             "dropped audio above zero means the pipeline was behind, not broken."),
        ],
        [1.42, 2.14, 3.51], bold_first=True, size=7.2,
    ))

    # ---------------------------------------------------------------- 8
    s.append(p("8. Definition of done", S["h1"]))
    s.append(table(
        ["Signal", "Gate", "Why it is the gate"],
        [
            ("Caption latency", "p95 at or below 3 s, and not rising through the run",
             "A system that meets the target at minute two and misses it at minute twenty is still failing."),
            ("Dropped audio", "Zero in expected load; any non-zero value explained",
             "Drops prove the pipeline is discarding speech to keep up."),
            ("Caption state", "No unexplained reduced or paused state",
             "Degradation is allowed as a designed response; unexplained degradation is a bug."),
            ("GPU use", "Memory and utilisation recorded per GPU, no out-of-memory, no GPU 0-only load",
             "Proves the layout is active rather than assumed."),
            ("VM health", "No LiveKit disconnect cluster; CPU, RAM and network inside agreed limits",
             "Separates AI overload from SFU or network overload."),
            ("French quality", "Delivery complete; word error and chrF recorded and comparable",
             "Capacity work must not quietly damage output quality."),
        ],
        [1.18, 2.62, 3.27], bold_first=True, size=7.3,
    ))

    s.append(p("Evidence this guide stands on", S["h2"]))
    s.append(table(
        ["Artifact", "Used for"],
        [
            ("services/ai/src/mawiid_ai/agent/worker.py", "Process-wide Models cache, stt_plan(), thread jobs, "
             "admission through the load function."),
            ("services/ai/src/mawiid_ai/agent/backlog.py", "Five-second bounded backlog and drop-on-overflow."),
            ("services/ai/src/mawiid_ai/agent/pipeline.py", "Shedding levels 1-3, per-speaker translation chain, "
             "originals kept at maximum shedding."),
            ("services/ai/src/mawiid_ai/stt/config.py, translation/config.py", "device_index default of 0, worker "
             "and thread counts, model sizes."),
            ("services/ai/src/mawiid_ai/stt/whisper_engine.py, translation/madlad_engine.py", "How the index list "
             "becomes replicas; int8 weights and CUDA device selection."),
            ("infra/compose/docker-compose.yml, docker-compose.gpu.yml", "Current single-host AI wiring and the GPU "
             "reservation to carry over."),
            ("infra/compose/observability/README.md", "Intended VM and DGX observability split."),
            ("services/ai/data/loadtest/local-ramp/summary.json", "The CPU load ramp quoted in section 1."),
            ("services/ai/data/translation-bot/20261125-154308/results.json", "French delivery, word error and "
             "latency evidence."),
        ],
        [3.28, 3.79], size=7.2,
    ))
    s.append(Spacer(1, 6))
    s.append(callout(
        "What done looks like",
        "One DGX compose file, one private path, six GPU replicas visible in nvidia-smi, dashboards that show "
        "GPU use and dropped audio, four run bundles, and one page that says either 'ten by ten holds' or exactly "
        "which limit it hit. Until that page exists, no room capacity and no price per meeting-hour is promised to "
        "anyone.",
        "good",
    ))
    s.append(Spacer(1, 6))
    s.append(p("This is a build guide, not a capacity claim. No application source, deployment configuration or "
               "runtime environment was changed while preparing it.", S["small"]))

    doc.build(s, onFirstPage=footer, onLaterPages=footer)
    print(OUT)


if __name__ == "__main__":
    main()
