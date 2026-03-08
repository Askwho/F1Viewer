import logging

import numpy as np

from src.config import CHART_STYLE
from src.charts.base import F1Chart

logger = logging.getLogger(__name__)


def generate_points_progression(all_race_data: list[dict], season: int) -> str | None:
    """
    Generate a multi-line chart showing cumulative championship points over the season.
    Accepts list of {circuit, results: [{code, color, points, ...}]}.
    Shows top 10 drivers to avoid clutter.
    Returns the saved file path or None on failure.
    """
    if not all_race_data or len(all_race_data) < 2:
        return None

    driver_points = {}  # code -> [cumulative_pts_r1, r2, ...]
    driver_colors = {}
    round_labels = []

    for race in all_race_data:
        round_labels.append(race.get("circuit", "?"))

        round_scorers = set()
        for r in race.get("results", []):
            code = r["code"]
            pts = r.get("points") or 0

            if code not in driver_points:
                driver_points[code] = []
                driver_colors[code] = r.get("color", "#888888")

            round_scorers.add(code)
            prev = driver_points[code][-1] if driver_points[code] else 0
            driver_points[code].append(prev + pts)

            # Update color to latest
            driver_colors[code] = r.get("color", driver_colors[code])

        # Carry forward for drivers not in this race
        for code in driver_points:
            if code not in round_scorers:
                prev = driver_points[code][-1] if driver_points[code] else 0
                driver_points[code].append(prev)

    if not driver_points:
        return None

    sorted_drivers = sorted(driver_points.keys(),
                             key=lambda c: driver_points[c][-1], reverse=True)
    top_drivers = sorted_drivers[:10]

    round_num = len(all_race_data)
    title = f"{season} Championship Points Progression \u2014 Rounds 1-{round_num}"
    chart = F1Chart(title, width=16, height=9)
    fig, ax = chart.setup()

    x = np.arange(1, len(round_labels) + 1)

    # Collect label positions and de-overlap
    label_data = []
    for code in top_drivers:
        pts = driver_points[code]
        color = driver_colors[code]

        padded = [0] * (len(round_labels) - len(pts)) + pts

        ax.plot(x, padded, color=color, linewidth=2.5, alpha=0.9, zorder=5)
        ax.plot(x, padded, "o", color=color, markersize=4, alpha=0.7, zorder=6)

        label_data.append((padded[-1], code, color))

    # De-overlap labels
    label_data.sort(key=lambda t: -t[0])
    label_y_positions = []
    min_gap = max(label_data[0][0] * 0.035, 5) if label_data else 5
    for raw_y, code, color in label_data:
        adjusted_y = raw_y
        for prev_y in label_y_positions:
            if abs(adjusted_y - prev_y) < min_gap:
                adjusted_y = prev_y - min_gap
        label_y_positions.append(adjusted_y)
        ax.text(
            x[-1] + 0.3, adjusted_y,
            f" {code} ({raw_y:.0f})",
            va="center", ha="left",
            fontsize=10, fontweight="bold", color=color,
        )

    ax.set_xlabel("Round", fontsize=CHART_STYLE["label_size"], color=CHART_STYLE["text_color"])
    ax.set_ylabel("Cumulative Points", fontsize=CHART_STYLE["label_size"],
                   color=CHART_STYLE["text_color"])

    ax.set_xticks(x)
    ax.set_xticklabels(round_labels, rotation=45, ha="right", fontsize=9)
    ax.set_xlim(0.5, len(round_labels) + 2)
    ax.set_ylim(bottom=0)

    filename = f"points_progression_{season}_{round_num}"
    path = chart.finalize(fig, ax, filename)
    logger.info("Generated points progression chart: %s", path)
    return str(path)
