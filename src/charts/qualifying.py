import logging

import numpy as np
from matplotlib.patches import Patch

from src.config import CHART_STYLE
from src.charts.base import F1Chart

logger = logging.getLogger(__name__)


def generate_qualifying_results(results: list[dict], circuit: str, season: int,
                                 round_num: int) -> str | None:
    """
    Generate a horizontal bar chart showing qualifying gaps to pole.
    Accepts OpenF1 enriched results. For qualifying sessions, gap_to_leader
    and duration are lists of [Q1, Q2, Q3] values (None if knocked out).
    Returns the saved file path or None on failure.
    """
    if not results:
        return None

    classified = [r for r in results if r.get("position") is not None]
    if not classified:
        return None

    drivers = []
    best_gaps = []
    colors = []
    sessions_reached = []  # "Q3", "Q2", or "Q1"
    pole_time = None

    for r in classified:
        drivers.append(r["code"])
        colors.append(r["color"])

        gap_data = r.get("gap_to_leader")
        dur_data = r.get("duration")

        # Determine which session they reached and their best gap
        if isinstance(gap_data, list):
            if len(gap_data) >= 3 and gap_data[2] is not None:
                best_gaps.append(gap_data[2])  # Q3 gap
                sessions_reached.append("Q3")
                if r["position"] == 1 and isinstance(dur_data, list) and dur_data[2] is not None:
                    pole_time = dur_data[2]
            elif len(gap_data) >= 2 and gap_data[1] is not None:
                best_gaps.append(gap_data[1])  # Q2 gap
                sessions_reached.append("Q2")
            elif gap_data[0] is not None:
                best_gaps.append(gap_data[0])  # Q1 gap
                sessions_reached.append("Q1")
            else:
                best_gaps.append(None)
                sessions_reached.append("Q1")
        elif isinstance(gap_data, (int, float)):
            best_gaps.append(float(gap_data))
            sessions_reached.append("Q3")
        else:
            best_gaps.append(None)
            sessions_reached.append("Q1")

    # Session colors for edges
    session_edge = {
        "Q3": "#ffd700",
        "Q2": "#c0c0c0",
        "Q1": "#cd7f32",
    }

    title = f"{season} Round {round_num} \u2014 {circuit} Qualifying"
    chart = F1Chart(title, width=14, height=max(8, len(drivers) * 0.45))
    fig, ax = chart.setup()

    y_pos = np.arange(len(drivers))
    valid_gaps = [g for g in best_gaps if g is not None and g > 0]
    max_gap = max(valid_gaps) if valid_gaps else 1

    display_gaps = [g if g is not None else max_gap * 1.1 for g in best_gaps]

    bars = ax.barh(
        y_pos, display_gaps,
        color=colors,
        edgecolor=[session_edge.get(s, "#555") for s in sessions_reached],
        linewidth=1.5,
        height=0.7,
    )

    # Annotations
    for i, (gap, session) in enumerate(zip(best_gaps, sessions_reached)):
        if gap is not None:
            if gap == 0 and i == 0:
                pole_str = ""
                if pole_time:
                    mins = int(pole_time // 60)
                    secs = pole_time % 60
                    pole_str = f" \u2014 {mins}:{secs:06.3f}" if mins > 0 else f" \u2014 {secs:.3f}s"
                label = f"  POLE{pole_str}"
                color = "#ffd700"
                weight = "bold"
            else:
                label = f"  +{gap:.3f}s ({session})"
                color = CHART_STYLE["text_color"]
                weight = "normal"
            ax.text(
                display_gaps[i] + max_gap * 0.01, i,
                label, va="center", ha="left",
                fontsize=CHART_STYLE["annotation_size"],
                color=color, fontweight=weight,
            )
        else:
            ax.text(
                display_gaps[i] + max_gap * 0.01, i,
                "  No Time", va="center", ha="left",
                fontsize=CHART_STYLE["annotation_size"],
                color="#ff6b6b",
            )

    position_labels = [f"P{i+1}  {d}" for i, d in enumerate(drivers)]
    ax.set_yticks(y_pos)
    ax.set_yticklabels(position_labels, fontsize=CHART_STYLE["tick_size"], fontweight="bold")
    ax.invert_yaxis()

    ax.set_xlabel("Gap to Pole (seconds)", fontsize=CHART_STYLE["label_size"],
                   color=CHART_STYLE["text_color"])
    ax.set_xlim(-max_gap * 0.02, max(display_gaps) + max_gap * 0.2)

    # Legend
    legend_elements = [
        Patch(facecolor="#333", edgecolor="#ffd700", linewidth=2, label="Q3"),
        Patch(facecolor="#333", edgecolor="#c0c0c0", linewidth=2, label="Q2"),
        Patch(facecolor="#333", edgecolor="#cd7f32", linewidth=2, label="Q1"),
    ]
    ax.legend(handles=legend_elements, loc="lower right", fontsize=10,
              facecolor=CHART_STYLE["axes_color"], edgecolor=CHART_STYLE["grid_color"],
              labelcolor=CHART_STYLE["text_color"])

    filename = f"qualifying_{season}_{round_num}"
    path = chart.finalize(fig, ax, filename)
    logger.info("Generated qualifying chart: %s", path)
    return str(path)
