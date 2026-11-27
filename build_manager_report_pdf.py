"""Builds the Backlog 1 manager report as a PDF.

Every figure comes from a recorded artifact in this repository:
  services/ai/data/loadtest/local-ramp/summary.json   (1 room, 5 speakers, 15 min, CPU)
  services/ai/data/translation-bot/*/report.md        (translation quality and delivery)
  output/report-assets/grafana-latency-2026-11-25.jpeg (live dashboard, 10 active tracks)
  docs/backlog-1-stress-security.md, Mawiid_Report.md (security fixes and retests)

Where no measurement exists the report says "not measured" instead of estimating.
"""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output/pdf/mawiid-test-status-report-2026-11-25.pdf"
SCREENSHOT = ROOT / "output/report-assets/grafana-latency-2026-11-25.jpeg"

NAVY = colors.HexColor("#17324D")
PALE_BLUE = colors.HexColor("#EAF2F8")
PALE_GRAY = colors.HexColor("#F4F6F8")
GRID = colors.HexColor("#D9D9D9")
TEXT = colors.HexColor("#111111")
MUTED = colors.HexColor("#4D4D4D")
GREEN = colors.HexColor("#E2F0D9")
YELLOW = colors.HexColor("#FFF2CC")
RED = colors.HexColor("#FCE4D6")


def p(text, style):
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def status_background(value):
    value = str(value).lower()
    if "high" in value or "critical" in value or "failed" in value:
        return RED
    if "validated" in value or "fixed" in value or "pass" in value:
        return GREEN
    if "pending" in value or "partial" in value or "not tested" in value or "medium" in value or "low" in value:
        return YELLOW
    return colors.white


def table(headers, rows, widths, base, *, status_col=None, font_size=None):
    body = []
    body.append([p(h, base["table_head"]) for h in headers])
    cell_style = base["table_cell"]
    center_style = base["table_cell_center"]
    if font_size:
        cell_style = ParagraphStyle("cell-small", parent=cell_style, fontSize=font_size, leading=font_size + 2.3)
        center_style = ParagraphStyle("cell-small-center", parent=center_style, fontSize=font_size, leading=font_size + 2.3)
    for row in rows:
        body.append([
            p(str(value), center_style if (i == 0 or i == status_col) else cell_style)
            for i, value in enumerate(row)
        ])
    tbl = Table(body, colWidths=[w * inch for w in widths], repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.45, GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    for r, row in enumerate(rows, 1):
        commands.append(("BACKGROUND", (0, r), (-1, r), colors.white if r % 2 else PALE_GRAY))
        if status_col is not None:
            commands.append(("BACKGROUND", (status_col, r), (status_col, r), status_background(row[status_col])))
    tbl.setStyle(TableStyle(commands))
    return tbl


def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.4)
    canvas.line(0.55 * inch, 0.52 * inch, 7.95 * inch, 0.52 * inch)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawString(0.55 * inch, 0.32 * inch, "Mawiid Backlog 1 test report | 25 November 2026")
    canvas.drawRightString(7.95 * inch, 0.32 * inch, f"Page {doc.page}")
    canvas.restoreState()


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.72 * inch,
        title="Mawiid Backlog 1 Test Report",
        author="Mawiid",
        subject="Test status for management, 25 November 2026",
    )
    styles = getSampleStyleSheet()
    base = {
        "title": ParagraphStyle("MawiidTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=23, leading=27, textColor=TEXT, alignment=TA_LEFT, spaceAfter=2),
        "subtitle": ParagraphStyle("MawiidSubtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=10.8, leading=14.5, textColor=MUTED, spaceAfter=9),
        "body": ParagraphStyle("MawiidBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.9, leading=13.0, textColor=TEXT, spaceAfter=6),
        "small": ParagraphStyle("MawiidSmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.4, leading=11.0, textColor=MUTED, spaceAfter=4),
        "heading": ParagraphStyle("MawiidHeading", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=13.6, leading=17, textColor=TEXT, spaceBefore=10, spaceAfter=4, keepWithNext=True),
        "subheading": ParagraphStyle("MawiidSubheading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.8, leading=13.6, textColor=TEXT, spaceBefore=6, spaceAfter=3, keepWithNext=True),
        "table_head": ParagraphStyle("MawiidTableHead", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5, leading=10.3, textColor=colors.white, alignment=TA_CENTER),
        "table_cell": ParagraphStyle("MawiidTableCell", parent=styles["Normal"], fontName="Helvetica", fontSize=8.4, leading=10.8, textColor=TEXT, alignment=TA_LEFT),
        "table_cell_center": ParagraphStyle("MawiidTableCellCenter", parent=styles["Normal"], fontName="Helvetica", fontSize=8.4, leading=10.8, textColor=TEXT, alignment=TA_CENTER),
        "bullet": ParagraphStyle("MawiidBullet", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.7, leading=12.8, leftIndent=15, firstLineIndent=-9, textColor=TEXT, spaceAfter=2),
        "caption": ParagraphStyle("MawiidCaption", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=8.1, leading=10, textColor=MUTED, alignment=TA_CENTER, spaceBefore=3),
    }

    story = []
    story += [
        p("Mawiid Backlog 1 - Test Status Report", base["title"]),
        p("Prepared for management  |  25 November 2026  |  Scope: Backlog 1, 16-20 November 2026", base["subtitle"]),
        p(
            "This report answers the five questions asked on Thursday and separates three things that must not be mixed: "
            "what was tested and validated, what was tested and failed, and what was not tested at all. Every number comes "
            "from a recorded test file; where no measurement exists, the report says so. The short version: captions work for "
            "a single speaker, the system degrades as soon as two people speak at once, and no load test has yet run on the "
            "target GPU server, so no production capacity figure can be given today.",
            base["body"],
        ),
        p("Management summary", base["heading"]),
        table(
            ["Area", "Status", "What it means"],
            [
                ("Caption quality", "Validated, small sample", "15-sentence test in three languages: 30 of 30 captions delivered in the best run, mean quality score 47.6 against a 54 text-only reference."),
                ("Load capacity", "Failed above 1 speaker", "On the development machine, p95 latency is 6.54 s with one speaker and 23.34 s with five; 30.9% of captions are lost at five."),
                ("10 rooms x 10 users", "Failed at about 10 min", "The run did not produce a usable summary. Code review identifies a shared model lock and an unbounded audio queue, not the network."),
                ("Security fixes", "3 fixed, retested", "Login burst, public internal routes and rate-limit expiry are fixed; no external penetration test has been done."),
                ("One-hour endurance", "Not tested", "The DGX test matrix was not run, so sustained stability is unproven."),
                ("Multi-tenancy and cost", "Not tested", "Cross-tenant testing and the cost-per-meeting-hour measurement are outstanding."),
            ],
            [1.25, 1.25, 4.4], base, status_col=1,
        ),
        p(
            "All load figures below come from a 16 GB development machine running the AI worker on CPU. They are a lower "
            "bound, not a forecast of the DGX. No capacity or price should be promised to a customer from this report.",
            base["small"],
        ),
        p("1. Tests performed", base["heading"]),
        table(
            ["Test area", "What was run", "Environment", "Status"],
            [
                ("Load ramp", "1 room, 5 bots, 1 to 5 speakers at once, 15 minutes, 238 clips", "Development machine, CPU only", "Completed, failed"),
                ("High load", "10 rooms x 10 users, captions on", "Development machine", "Failed at about 10 min"),
                ("Translation latency", "15 and 23 sentence bot runs, 3 languages, 6 directions", "Development machine", "Completed"),
                ("Multi-tenancy", "Smoke tests: non-member, invalid token, unknown room", "Local stack", "Partial"),
                ("Resource use", "Host and container sample every 5 seconds", "Development machine", "Completed, dev only"),
                ("Security", "Unit tests, 30-request login burst, Caddy route probe, Redis expiry, JWT probes", "Local stack", "Partial"),
            ],
            [1.1, 3.0, 1.55, 1.25], base, status_col=3,
        ),
        p("2. Measured results", base["heading"]),
        p("2.1 Load ramp - where captions stop keeping up", base["subheading"]),
        table(
            ["Speakers at once", "p50", "p95", "Max", "Captions lost", "Verdict"],
            [
                ("1", "1.66 s", "6.54 s", "8.75 s", "0 of 60 (0%)", "p95 over the 3 s limit"),
                ("2", "4.44 s", "13.11 s", "21.82 s", "4 of 136 (2.9%)", "Fail"),
                ("3", "10.89 s", "19.17 s", "21.62 s", "14 of 188 (7.4%)", "Fail"),
                ("4", "12.77 s", "21.38 s", "23.69 s", "60 of 264 (22.7%)", "Fail"),
                ("5", "15.94 s", "23.34 s", "27.03 s", "94 of 304 (30.9%)", "Fail"),
            ],
            [1.1, 0.8, 0.85, 0.8, 1.35, 1.9], base,
        ),
        p(
            "The service level used for this test is caption p95 at or below 3.0 s, no more than 2% of captions lost, and no "
            "p50 rising for five minutes in a row. The run never met it: even one speaker produced a p95 of 6.54 s. Over the "
            "whole run, 172 of 952 expected captions were lost (18.1%).",
            base["body"],
        ),
        p("2.2 Where the delay is", base["subheading"]),
        table(
            ["Stage", "1 speaker (p50 / p95)", "5 speakers (p50 / p95)", "Reading"],
            [
                ("Speech to text", "0.68 s / 2.17 s", "9.63 s / 15.61 s", "Grows with load; one shared decoder"),
                ("Translation", "2.38 s / 6.73 s", "5.87 s / 13.21 s", "Already the largest delay at one speaker"),
                ("Queue wait", "0.00 s / 0.00 s", "0.00 s / 0.00 s", "Hidden inside the stages, not measured separately"),
            ],
            [1.15, 1.7, 1.7, 2.3], base,
        ),
        p(
            "Translation, not speech recognition, is the first bottleneck: at one speaker it takes 2.38 s at the median while "
            "speech recognition takes 0.68 s. Fixing only the speech model will not fix the meeting.",
            base["body"],
        ),
        p("2.3 Translation quality and delivery", base["subheading"]),
        table(
            ["Direction", "Delivered", "chrF (higher is better)", "BLEU", "Delay p50", "Delay max"],
            [
                ("French to English", "5 of 5", "54.6", "23.9", "3.94 s", "6.09 s"),
                ("French to Arabic", "5 of 5", "47.7", "7.1", "3.94 s", "6.09 s"),
                ("English to French", "5 of 5", "55.8", "30.7", "3.39 s", "3.87 s"),
                ("English to Arabic", "5 of 5", "40.3", "11.4", "3.39 s", "3.87 s"),
                ("Arabic to French", "5 of 5", "39.4", "10.4", "5.56 s", "13.28 s"),
                ("Arabic to English", "5 of 5", "47.6", "19.6", "5.56 s", "13.28 s"),
            ],
            [1.45, 1.0, 1.5, 0.85, 0.95, 1.0], base,
        ),
        p(
            "This is the best run (15 sentences, 25 November 15:38). Speech recognition word error rate was 10% for English, "
            "26% for French and 33% for Arabic. Mean chrF was 47.6 against 54 for a text-only translation of the same "
            "sentences, so the live pipeline keeps about 88% of the text-only quality. Arabic is the weakest language on "
            "both accuracy and delay.",
            base["body"],
        ),
        p(
            "Delivery is not yet stable. Of four runs on 25 November, one passed and three failed: one lost English captions "
            "and two lost one or two Arabic-to-European captions. The 23-sentence run scored 43.2 chrF, lost 1 of 9 "
            "Arabic-to-English captions, and reached 15.25 s at the maximum. A caption that never arrives is worse for a "
            "meeting than a caption that arrives late.",
            base["body"],
        ),
        p("2.4 Live dashboard", base["subheading"]),
        p(
            "The Grafana view provided for this update shows 10 active caption tracks. Caption processing p95 sits at about "
            "4.0 s, above the 3.0 s limit; transcription p95 stays between 0.2 s and 0.8 s; translation plus queue p95 "
            "reaches about 2.5 s. Caption errors show no data, and all four services report healthy. The dashboard therefore "
            "confirms the same pattern as the load test: the pipeline stays up, but the end-to-end delay exceeds the target.",
            base["body"],
        ),
        p("2.5 Resource use and cost", base["subheading"]),
        table(
            ["Measure", "Observed on the development machine", "Status"],
            [
                ("CPU", "35% to 56% busy during the ramp", "Measured, dev only"),
                ("Memory", "10.1 GB used of 15.7 GB", "Measured, dev only"),
                ("LiveKit container", "72 MB", "Measured, dev only"),
                ("Redis container", "14 MB", "Measured, dev only"),
                ("GPU", "No GPU on this machine", "Not measured"),
                ("Cost per meeting-hour", "DGX hourly rate not supplied; rooms per worker not measured", "Not measured"),
            ],
            [1.45, 3.55, 1.9], base,
        ),
        p(
            "The cost formula is ready but cannot be filled: cost per meeting-hour = DGX hourly cost divided by the number "
            "of rooms one worker carries within the 3 s limit. The second number comes from run E, which has not run. No "
            "cost figure is given here because inventing one would be worse than leaving it blank.",
            base["body"],
        ),
    ]

    story += [
        p("3. Vulnerabilities identified and fixed", base["heading"]),
        table(
            ["Finding", "Risk before the fix", "Fix", "Retest"],
            [
                ("Login limit could be bypassed", "A parallel burst got 30 of 30 password guesses checked instead of 10", "Each attempt is counted first, atomically", "Regression test: 10 of 30 checked; recorded as passing"),
                ("Internal routes were public", "The AI save route, LiveKit webhook and full API map were reachable from the internet", "Caddy returns 404 publicly; services call the backend directly", "Route probe: 404 through Caddy, reachable directly; recorded as passing"),
                ("Rate-limit counters could live forever", "A crash between create and expire left a permanent lockout", "Expiry is set before the counter is incremented", "Redis scan: 0 counters without expiry; recorded as passing"),
                ("All AI models used one GPU", "Every room queued on GPU 0 while seven GPUs sat idle", "Optional multi-GPU settings, defaults unchanged", "Not retested; needs the DGX"),
            ],
            [1.5, 2.0, 2.0, 1.4], base, font_size=8.0,
        ),
        p(
            "Also checked and holding: a user who knows a room ID still needs membership; a participant cannot forge their "
            "user ID or language; internal tokens are compared in constant time; LiveKit webhooks are verified and "
            "de-duplicated; login codes are returned only when the server runs in development mode.",
            base["body"],
        ),
        p(
            "Retest caveat: the full backend suite could not be re-run for this report because the local dependency links "
            "are broken; 31 of 39 tests execute and 8 cannot load the web framework. The results above are the team's "
            "recorded runs (the last full run reports 267 passing tests). They must be repeated on the test server before "
            "any security sign-off.",
            base["small"],
        ),
        p("4. Outstanding issues", base["heading"]),
        table(
            ["Issue", "Severity", "Impact", "Target"],
            [
                ("Captions fall behind above one concurrent speaker", "High", "p95 6.54 s at one speaker, 23.34 s at five; the 10x10 run fails at about 10 minutes", "S1 and S2 this week; DGX retest next"),
                ("Session token expires after 5 minutes", "High", "A short network drop becomes permanent: the client cannot rejoin", "S1 this week"),
                ("Audio queue has no limit", "High", "About 190 MB per minute at 100 tracks; memory grows until the process fails", "S2 this week"),
                ("Arabic accuracy and delay", "Medium", "Word error 33%; chrF 39 to 48 against a 54 reference; median delay 5.56 s", "Tuning; date to be agreed"),
                ("Arabic captions sometimes never arrive", "Medium", "2 of 4 runs on 25 November lost one or two Arabic-to-European captions", "S2 and S5 this week"),
                ("One database token opens every tenant", "Critical", "A leaked token or compromised backend exposes all customers", "Per-database tokens; outside Backlog 1, date to be agreed"),
                ("More than 100 active tenants", "Medium", "The oldest database connection can be closed mid-query", "Raise the limit or close only idle clients; date to be agreed"),
                ("Anyone can lock a known account", "Medium", "10 wrong passwords block a user for 15 minutes", "Per-IP limit or CAPTCHA; date to be agreed"),
                ("API accepts any website origin", "Low", "Low risk while login uses a bearer header", "Restrict to the app domain; date to be agreed"),
                ("Deploy script picks the 10b translation model", "Medium", "About 3 times slower than 3b", "Decide after run G on the DGX"),
                ("One AI unit test fails", "Low", "No production impact; a test helper is out of date", "Fix with the next AI change"),
            ],
            [1.7, 0.7, 2.6, 1.9], base, status_col=1, font_size=7.9,
        ),
        p("5. Tests not completed", base["heading"]),
        p(
            "Sunday's request covered the weekend programme: one-hour sessions, the 10x10 run, multi-tenancy, resource and "
            "cost, and security. The items below are the parts that could not be completed.",
            base["body"],
        ),
        table(
            ["Work item", "Why it is incomplete", "When"],
            [
                ("One-hour sessions with 5 and 10 users", "The development machine already fails at one speaker; the DGX runs have not started", "First DGX slot; target 26 November"),
                ("DGX runs A to G, including multi-GPU and 3b versus 10b", "DGX not available and the models are not converted", "2 days after access"),
                ("Video and SFU load (10 publishers, 10 subscribers, 1 hour)", "The bots send audio only; video load is not automated", "Alongside the next load run"),
                ("Cross-tenant test, organisation A against organisation B", "Needs two seeded organisations; not automated", "1 day"),
                ("Token still accepted after logout or password reset", "Not automated", "1 day"),
                ("Lobby flood and room locked/closed transitions", "Not automated", "1 day"),
                ("LiveKit token reuse after removal, or join with another room's token", "Not automated", "1 day"),
                ("Resource and cost baseline on the DGX", "No DGX measurements and no hourly rate supplied", "With the DGX runs"),
                ("Microintégrèle weekend feedback", "No written answer was received; the input field is empty", "Add when received"),
            ],
            [2.1, 3.0, 1.8], base, font_size=8.0,
        ),
    ]

    story += [
        p("6. Status at a glance", base["heading"]),
        table(
            ["Validated", "Needs fixing", "Not tested"],
            [
                ("Caption pipeline end to end: 15 sentences, 3 languages, 30 of 30 captions delivered in the best run", "Load above one concurrent speaker; 10x10 fails at about 10 minutes", "One-hour endurance at 5 and 10 users"),
                ("Speech recognition: word error 10% English, 26% French, 33% Arabic", "Token expiry and no rejoin after a drop", "DGX and GPU capacity, including multi-GPU"),
                ("Translation: mean chrF 47.6 against a 54 text-only reference", "Unbounded audio buffer", "Video and SFU load"),
                ("Security fixes 1 to 3, with recorded regression tests", "Arabic accuracy and intermittent Arabic caption loss", "Cross-tenant penetration test"),
                ("Room membership, development-only login codes, token attributes, webhook verification", "Multi-GPU deployment not proven; no load retest after the S1 and S2 fixes", "Token after logout, lobby flood, token reuse, DGX resource use and cost per meeting-hour, Microintégrèle feedback"),
            ],
            [2.4, 2.25, 2.25], base, font_size=7.9,
        ),
        p("7. What this means", base["heading"]),
        p("- Mawiid can translate a normal single-speaker meeting on a development machine. It cannot yet carry two people speaking at once, and it has not been measured on the target hardware.", base["bullet"]),
        p("- The 10x10 failure is a software bottleneck with a written eight-step fix. The two steps that stop the observed failure are S1 (token lifecycle) and S2 (bounded audio buffer), both scheduled this week.", base["bullet"]),
        p("- No capacity figure and no cost per meeting-hour should be given to a customer until runs A to G on the DGX are complete. The numbers in this report are a floor measured on CPU, not a ceiling.", base["bullet"]),
        PageBreak(),
        p("Appendix - Live latency evidence", base["heading"]),
        p(
            "The screenshot below is the Grafana view supplied on 25 November. It shows 10 active caption tracks, caption "
            "processing p95 at about 4.0 s, transcription p95 between 0.2 s and 0.8 s, and translation plus queue p95 up to "
            "about 2.5 s. All four services report healthy, which is why the failure is a latency problem rather than an "
            "outage.",
            base["body"],
        ),
    ]
    if SCREENSHOT.exists():
        image = Image(str(SCREENSHOT))
        image.drawWidth = 7.15 * inch
        image.drawHeight = image.imageHeight * image.drawWidth / image.imageWidth
        story += [Spacer(1, 4), image, p("Figure 1. Live Grafana latency dashboard, 25 November 2026.", base["caption"])]
    else:
        story.append(p("Dashboard image not available in this checkout.", base["body"]))

    story += [
        p("Where the numbers come from", base["heading"]),
        p("- Load ramp: services/ai/data/loadtest/local-ramp/summary.json and captions.csv (1 room, 5 bots, 15 minutes).", base["bullet"]),
        p("- Translation quality: services/ai/data/translation-bot/20261125-153357/report.md and 20261120-114942/report.md.", base["bullet"]),
        p("- Delivery stability: the five translation-bot runs dated 25 November 2026.", base["bullet"]),
        p("- Security: docs/backlog-1-stress-security.md and Mawiid_Report.md, commit f6c6202.", base["bullet"]),
        p("- Breaking-point definition: caption p95 above 3.0 s, more than 2% of captions lost, or p50 rising for five minutes.", base["bullet"]),
    ]

    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(OUT)


if __name__ == "__main__":
    main()
