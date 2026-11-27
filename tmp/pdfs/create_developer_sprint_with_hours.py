from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


OUTPUT = Path("output/pdf/developer_sprint_with_hours.pdf")

INK = HexColor("#18191D")
NAVY = INK
DAY_BLUE = INK
TEXT = INK
SUBTLE = INK
BORDER = INK
FILL = HexColor("#F8FAFD")
FOOTER = INK

SPRINT = [
    (
        "MONDAY",
        [
            ("Placeholder", "1h"),
            ("Placeholder", "2h"),
            ("Placeholder", "5h"),
        ],
    ),
    (
        "TUESDAY",
        [
            ("Placeholder", "3h"),
            ("Placeholder", "3h"),
            ("Placeholder", "2h"),
        ],
    ),
    (
        "WEDNESDAY",
        [
            ("Placeholder", "4h"),
            ("Placeholder", "2h"),
            ("Placeholder", "2h"),
        ],
    ),
    (
        "THURSDAY",
        [
            ("Placeholder", "3h"),
            ("Placeholder", "2h"),
            ("Placeholder", "3h"),
        ],
    ),
    (
        "FRIDAY",
        [
            ("Test the completed features and verify that they meet the acceptance criteria.", "3h"),
            ("Recap the sprint: review completed tasks, discuss blockers, and identify lessons learned.", "2h"),
            ("Build and prioritize the next week's sprint backlog.", "3h"),
        ],
    ),
]


def fit_task_font(task_label: str, body: str, maximum_width: float) -> float:
    """Return the largest consistent-looking size which keeps a task on one line."""
    for size in (10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4):
        width = (
            pdfmetrics.stringWidth(task_label, "Arial-Bold", size)
            + pdfmetrics.stringWidth(body, "Arial", size)
        )
        if width <= maximum_width:
            return size
    return 9.4


def draw_task(c: canvas.Canvas, x: float, y: float, row_width: float, number: int, task: str, hours: str) -> None:
    label = f"Task {number} ({hours}): "
    body = task
    font_size = fit_task_font(label, body, row_width - 20)
    c.setFillColor(TEXT)
    c.setFont("Arial-Bold", font_size)
    c.drawString(x + 10, y + 9.3, label)
    label_width = pdfmetrics.stringWidth(label, "Arial-Bold", font_size)
    c.setFont("Arial", font_size)
    c.drawString(x + 10 + label_width, y + 9.3, body)


def create_pdf() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Bold", r"C:\Windows\Fonts\arialbd.ttf"))

    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    page_width, _ = A4
    left = 56
    table_width = page_width - (2 * left)
    table_top = 696
    row_height = 27

    c.setTitle("Developer Sprint - Hours")
    c.setAuthor("Codex")

    c.setFillColor(NAVY)
    c.setFont("Arial-Bold", 24)
    c.drawCentredString(page_width / 2, 778, "DEVELOPER SPRINT")
    c.setFillColor(SUBTLE)
    c.setFont("Arial", 12)
    c.drawCentredString(page_width / 2, 758, "Example weekly sprint plan - Monday to Friday")

    for day_index, (day, tasks) in enumerate(SPRINT):
        heading_y = 705 - (day_index * 130)
        current_table_top = table_top - (day_index * 130)
        table_bottom = current_table_top - (row_height * len(tasks))

        c.setFillColor(DAY_BLUE)
        c.setFont("Arial-Bold", 14)
        c.drawString(left + 6, heading_y, day)

        c.setFillColor(FILL)
        c.rect(left, table_bottom, table_width, row_height * len(tasks), fill=1, stroke=0)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.7)
        c.rect(left, table_bottom, table_width, row_height * len(tasks), fill=0, stroke=1)
        for rule_index in range(1, len(tasks)):
            rule_y = current_table_top - (row_height * rule_index)
            c.line(left, rule_y, left + table_width, rule_y)

        for task_index, (task, hours) in enumerate(tasks, 1):
            row_bottom = current_table_top - (task_index * row_height)
            draw_task(c, left, row_bottom, table_width, task_index, task, hours)

    c.setFillColor(FOOTER)
    c.setFont("Arial", 8.5)
    c.drawCentredString(page_width / 2, 28, "Developer Sprint Example - Page 1")
    c.save()


if __name__ == "__main__":
    create_pdf()
