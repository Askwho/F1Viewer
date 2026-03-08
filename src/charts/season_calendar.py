import logging
from datetime import datetime, timezone

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

from src.config import CHART_STYLE, OUTPUT_DIR
from src.charts.base import F1Chart

logger = logging.getLogger(__name__)

# Country flag emoji/abbreviations for visual flair
COUNTRY_FLAGS = {
    "Australia": "AUS", "China": "CHN", "Japan": "JPN", "Bahrain": "BHR",
    "Saudi Arabia": "KSA", "USA": "USA", "United States": "USA",
    "Canada": "CAN", "Monaco": "MON", "Spain": "ESP", "Austria": "AUT",
    "UK": "GBR", "Belgium": "BEL", "Hungary": "HUN", "Netherlands": "NED",
    "Italy": "ITA", "Azerbaijan": "AZE", "Singapore": "SGP",
    "Mexico": "MEX", "Brazil": "BRA", "Qatar": "QAT",
    "UAE": "UAE", "United Arab Emirates": "UAE",
}


def _get_country_code(country: str) -> str:
    """Get 3-letter country code."""
    for key, code in COUNTRY_FLAGS.items():
        if key.lower() in country.lower() or country.lower() in key.lower():
            return code
    return country[:3].upper()


def generate_season_calendar(schedule: list[dict], season: int,
                              latest_round: int = 0) -> str | None:
    """
    Generate a visual season calendar showing all rounds, highlighting
    completed and upcoming races.
    Returns the saved file path or None on failure.
    """
    if not schedule:
        return None

    now = datetime.now(timezone.utc)
    n_races = len(schedule)

    # Layout: grid of cards
    cols = 6
    rows = (n_races + cols - 1) // cols

    title = f"{season} Formula 1 Season Calendar"
    fig_width = cols * 3.2
    fig_height = rows * 2.0 + 1.5
    chart = F1Chart(title, width=fig_width, height=fig_height)

    plt.style.use("dark_background")
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    fig.set_facecolor(CHART_STYLE["bg_color"])
    ax.set_facecolor(CHART_STYLE["bg_color"])

    ax.set_xlim(0, cols)
    ax.set_ylim(0, rows)
    ax.set_aspect("equal")
    ax.axis("off")

    # Title
    fig.suptitle(
        title,
        fontsize=CHART_STYLE["title_size"],
        fontweight="bold",
        color=CHART_STYLE["text_color"],
        y=0.97,
    )

    # Draw race cards
    for i, race in enumerate(schedule):
        col = i % cols
        row = rows - 1 - (i // cols)  # top to bottom

        round_num = int(race.get("round", i + 1))
        race_name = race.get("raceName", "").replace(" Grand Prix", " GP")
        race_date = race.get("date", "")
        country = race.get("Circuit", {}).get("Location", {}).get("country", "")
        country_code = _get_country_code(country)

        # Parse date
        try:
            race_dt = datetime.fromisoformat(race_date + "T23:59:59+00:00")
        except ValueError:
            race_dt = None

        # Determine state
        if round_num <= latest_round:
            state = "completed"
        elif race_dt and race_dt < now:
            state = "completed"
        elif race_dt and (race_dt - now).days <= 7:
            state = "next"
        else:
            state = "upcoming"

        # Card styling
        pad = 0.08
        card_x = col + pad
        card_y = row + pad
        card_w = 1 - 2 * pad
        card_h = 1 - 2 * pad

        if state == "completed":
            card_color = "#1e3a2f"
            border_color = "#27ae60"
            alpha = 0.9
        elif state == "next":
            card_color = "#3a2e1e"
            border_color = "#f39c12"
            alpha = 1.0
        else:
            card_color = CHART_STYLE["axes_color"]
            border_color = CHART_STYLE["grid_color"]
            alpha = 0.6

        # Draw card background
        card = FancyBboxPatch(
            (card_x, card_y), card_w, card_h,
            boxstyle="round,pad=0.05",
            facecolor=card_color,
            edgecolor=border_color,
            linewidth=2 if state == "next" else 1,
            alpha=alpha,
        )
        ax.add_patch(card)

        # Round number (top-left)
        ax.text(
            card_x + 0.1, card_y + card_h - 0.15,
            f"R{round_num}",
            fontsize=9, fontweight="bold",
            color=border_color,
            va="top", ha="left",
        )

        # Country code (top-right)
        ax.text(
            card_x + card_w - 0.1, card_y + card_h - 0.15,
            country_code,
            fontsize=8, fontweight="bold",
            color=CHART_STYLE["text_color"],
            alpha=0.6,
            va="top", ha="right",
        )

        # Race name (center)
        # Shorten if too long
        display_name = race_name
        if len(display_name) > 16:
            display_name = display_name[:15] + "."
        ax.text(
            card_x + card_w / 2, card_y + card_h / 2 + 0.02,
            display_name,
            fontsize=8, fontweight="bold",
            color=CHART_STYLE["text_color"],
            va="center", ha="center",
        )

        # Date (bottom)
        try:
            date_display = datetime.strptime(race_date, "%Y-%m-%d").strftime("%d %b")
        except ValueError:
            date_display = race_date
        ax.text(
            card_x + card_w / 2, card_y + 0.18,
            date_display,
            fontsize=7,
            color=CHART_STYLE["text_color"],
            alpha=0.7,
            va="center", ha="center",
        )

        # Status indicator
        if state == "completed":
            ax.text(
                card_x + card_w / 2, card_y + 0.06,
                "\u2713",
                fontsize=8, color="#27ae60",
                va="center", ha="center",
                fontweight="bold",
            )
        elif state == "next":
            ax.text(
                card_x + card_w / 2, card_y + 0.06,
                "NEXT",
                fontsize=6, color="#f39c12",
                va="center", ha="center",
                fontweight="bold",
            )

    # Legend
    legend_y = -0.3
    for label, color in [("Completed", "#27ae60"), ("Next Race", "#f39c12"),
                          ("Upcoming", CHART_STYLE["grid_color"])]:
        fig.text(0.5, 0.02, "", fontsize=1)  # spacer

    chart.add_watermark(fig)

    OUTPUT_DIR.mkdir(exist_ok=True)
    filename = f"season_calendar_{season}"
    path = OUTPUT_DIR / f"{filename}.png"
    fig.savefig(
        path,
        dpi=CHART_STYLE["dpi"],
        bbox_inches="tight",
        pad_inches=0.3,
        facecolor=fig.get_facecolor(),
        edgecolor="none",
    )
    plt.close(fig)
    logger.info("Generated season calendar chart: %s", path)
    return str(path)
