import logging

import numpy as np

from src.config import CHART_STYLE
from src.charts.base import F1Chart

logger = logging.getLogger(__name__)


def generate_driver_standings(standings: list[dict], round_num: int, season: int) -> str | None:
    """
    Generate a horizontal bar chart of the driver championship standings.
    Accepts OpenF1-computed standings: [{code, full_name, team, color, points, wins, position}].
    Returns the saved file path or None on failure.
    """
    if not standings:
        return None

    drivers = [s["code"] for s in standings]
    points = [s["points"] for s in standings]
    colors = [s["color"] for s in standings]
    wins = [s["wins"] for s in standings]

    title = f"{season} Driver Championship \u2014 After Round {round_num}"
    chart = F1Chart(title, width=14, height=max(8, len(drivers) * 0.42))
    fig, ax = chart.setup()

    y_pos = np.arange(len(drivers))
    max_pts = max(points) if points else 1

    bars = ax.barh(
        y_pos, points,
        color=colors,
        edgecolor=colors,
        linewidth=0.5,
        height=0.72,
        alpha=0.9,
    )

    if points:
        bars[0].set_alpha(1.0)
        bars[0].set_edgecolor("#ffd700")
        bars[0].set_linewidth(2)

    # Points + wins annotations
    for i, (pts, w) in enumerate(zip(points, wins)):
        label = f"  {pts:.0f} pts"
        if w > 0:
            label += f"  ({w} {'win' if w == 1 else 'wins'})"
        ax.text(
            pts + max_pts * 0.01, i,
            label, va="center", ha="left",
            fontsize=CHART_STYLE["annotation_size"],
            color=CHART_STYLE["text_color"],
            fontweight="bold" if i < 3 else "normal",
        )

    # Gap to leader — inside bar
    if len(points) > 1:
        for i in range(1, len(points)):
            gap = points[0] - points[i]
            if gap > 0 and points[i] > max_pts * 0.12:
                ax.text(
                    points[i] - max_pts * 0.01, i,
                    f"-{gap:.0f} ",
                    va="center", ha="right",
                    fontsize=9, color="white", alpha=0.6, fontweight="bold",
                )

    position_labels = [f"P{i+1}  {d}" for i, d in enumerate(drivers)]
    ax.set_yticks(y_pos)
    ax.set_yticklabels(position_labels, fontsize=CHART_STYLE["tick_size"], fontweight="bold")
    ax.invert_yaxis()

    ax.set_xlabel("Championship Points", fontsize=CHART_STYLE["label_size"],
                   color=CHART_STYLE["text_color"])
    ax.set_xlim(0, max_pts * 1.25)

    for i in range(min(3, len(y_pos))):
        ax.axhspan(i - 0.4, i + 0.4, alpha=0.05, color="#ffd700")

    filename = f"driver_standings_{season}_{round_num}"
    path = chart.finalize(fig, ax, filename)
    logger.info("Generated driver standings chart: %s", path)
    return str(path)
