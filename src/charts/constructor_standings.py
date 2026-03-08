import logging

import numpy as np

from src.config import CHART_STYLE
from src.charts.base import F1Chart

logger = logging.getLogger(__name__)


def generate_constructor_standings(standings: list[dict], round_num: int, season: int) -> str | None:
    """
    Generate a horizontal bar chart of the constructor championship standings.
    Accepts OpenF1-computed standings: [{team, color, points, wins, position}].
    Returns the saved file path or None on failure.
    """
    if not standings:
        return None

    teams = [s["team"] for s in standings]
    points = [s["points"] for s in standings]
    colors = [s["color"] for s in standings]
    wins = [s["wins"] for s in standings]

    title = f"{season} Constructor Championship \u2014 After Round {round_num}"
    chart = F1Chart(title, width=14, height=max(6, len(teams) * 0.7))
    fig, ax = chart.setup()

    y_pos = np.arange(len(teams))
    max_pts = max(points) if points else 1

    bars = ax.barh(
        y_pos, points,
        color=colors,
        edgecolor=colors,
        linewidth=2.5,
        height=0.65,
        alpha=0.9,
    )

    if bars:
        bars[0].set_alpha(1.0)

    # Annotations
    for i, (pts, w) in enumerate(zip(points, wins)):
        label = f"  {pts:.0f} pts"
        if w > 0:
            label += f"  ({w} {'win' if w == 1 else 'wins'})"
        ax.text(
            pts + max_pts * 0.01, i,
            label, va="center", ha="left",
            fontsize=CHART_STYLE["annotation_size"] + 1,
            color=CHART_STYLE["text_color"],
            fontweight="bold" if i < 3 else "normal",
        )

    # Gap to leader — inside bar
    if len(points) > 1:
        for i in range(1, len(points)):
            gap = points[0] - points[i]
            if gap > 0 and points[i] > max_pts * 0.1:
                ax.text(
                    points[i] - max_pts * 0.01, i,
                    f"-{gap:.0f} ",
                    va="center", ha="right",
                    fontsize=10, color="white", alpha=0.6, fontweight="bold",
                )

    ax.set_yticks(y_pos)
    ax.set_yticklabels(
        [f"P{i+1}  {t}" for i, t in enumerate(teams)],
        fontsize=CHART_STYLE["tick_size"] + 1, fontweight="bold",
    )
    ax.invert_yaxis()

    ax.set_xlabel("Championship Points", fontsize=CHART_STYLE["label_size"],
                   color=CHART_STYLE["text_color"])
    ax.set_xlim(0, max_pts * 1.25)

    filename = f"constructor_standings_{season}_{round_num}"
    path = chart.finalize(fig, ax, filename)
    logger.info("Generated constructor standings chart: %s", path)
    return str(path)
