import re
import logging

import numpy as np

from src.config import CHART_STYLE
from src.charts.base import F1Chart

logger = logging.getLogger(__name__)


def _parse_gap(gap_str) -> float | None:
    """Parse OpenF1 gap_to_leader into seconds. Returns None for lapped/DNF."""
    if gap_str is None:
        return None
    if isinstance(gap_str, (int, float)):
        return float(gap_str)
    s = str(gap_str).strip()
    if "LAP" in s.upper():
        return None
    try:
        return float(s)
    except ValueError:
        return None


def generate_race_results(results: list[dict], circuit: str, season: int,
                           round_num: int) -> str | None:
    """
    Generate a horizontal bar chart showing gap to winner for each driver.
    Accepts OpenF1 enriched results format.
    Returns the saved file path or None on failure.
    """
    if not results:
        return None

    drivers = []
    gaps = []
    colors = []
    statuses = []
    gap_labels = []

    for r in results:
        pos = r.get("position")
        if pos is None and not r.get("dnf") and not r.get("dns"):
            continue

        drivers.append(r["code"])
        colors.append(r["color"])

        raw_gap = r.get("gap_to_leader")
        gap_sec = _parse_gap(raw_gap)

        if r.get("dnf"):
            gaps.append(None)
            statuses.append("DNF")
            gap_labels.append("DNF")
        elif r.get("dns"):
            gaps.append(None)
            statuses.append("DNS")
            gap_labels.append("DNS")
        elif r.get("dsq"):
            gaps.append(None)
            statuses.append("DSQ")
            gap_labels.append("DSQ")
        elif pos == 1:
            gaps.append(0.0)
            statuses.append("WINNER")
            gap_labels.append("WINNER")
        elif gap_sec is not None:
            gaps.append(gap_sec)
            statuses.append("")
            gap_labels.append(f"+{gap_sec:.3f}s")
        elif raw_gap and "LAP" in str(raw_gap).upper():
            gaps.append(None)
            statuses.append(str(raw_gap))
            gap_labels.append(str(raw_gap))
        else:
            gaps.append(None)
            statuses.append("?")
            gap_labels.append("")

    if not drivers:
        return None

    # Calculate display values
    max_gap = max((g for g in gaps if g is not None), default=10)
    dnf_gap = max_gap * 1.3 if max_gap > 0 else 30
    display_gaps = [g if g is not None else dnf_gap for g in gaps]
    is_dnf = [g is None for g in gaps]

    # Build chart
    title = f"{season} Round {round_num} \u2014 {circuit}"
    chart = F1Chart(title, width=14, height=max(8, len(drivers) * 0.45))
    fig, ax = chart.setup()

    y_pos = np.arange(len(drivers))

    bars = ax.barh(
        y_pos, display_gaps,
        color=colors,
        edgecolor=[c if not dnf else "#555555" for c, dnf in zip(colors, is_dnf)],
        linewidth=0.8,
        height=0.7,
    )

    for bar, dnf in zip(bars, is_dnf):
        if dnf:
            bar.set_alpha(0.4)
            bar.set_hatch("///")

    # Annotations
    for i, (gap, status, label) in enumerate(zip(gaps, statuses, gap_labels)):
        if status in ("DNF", "DNS", "DSQ"):
            ax.text(
                dnf_gap + max_gap * 0.02, i,
                f"  {label}",
                va="center", ha="left",
                fontsize=CHART_STYLE["annotation_size"],
                color="#ff6b6b", fontweight="bold",
            )
        elif status == "WINNER":
            ax.text(
                display_gaps[i] + max_gap * 0.02, i,
                f"  WINNER",
                va="center", ha="left",
                fontsize=CHART_STYLE["annotation_size"],
                color="#ffd700", fontweight="bold",
            )
        elif gap is None:
            # Lapped
            ax.text(
                dnf_gap + max_gap * 0.02, i,
                f"  {label}",
                va="center", ha="left",
                fontsize=CHART_STYLE["annotation_size"],
                color="#ffaa55",
            )
        else:
            ax.text(
                gap + max_gap * 0.02, i,
                f"  {label}",
                va="center", ha="left",
                fontsize=CHART_STYLE["annotation_size"],
                color=CHART_STYLE["text_color"],
            )

    position_labels = [f"P{i+1}  {d}" for i, d in enumerate(drivers)]
    ax.set_yticks(y_pos)
    ax.set_yticklabels(position_labels, fontsize=CHART_STYLE["tick_size"], fontweight="bold")
    ax.invert_yaxis()

    ax.set_xlabel("Gap to Winner (seconds)", fontsize=CHART_STYLE["label_size"],
                   color=CHART_STYLE["text_color"])

    for i in range(min(3, len(y_pos))):
        ax.axhspan(i - 0.4, i + 0.4, alpha=0.05, color="#ffd700")

    if max_gap > 0:
        ax.set_xlim(-max_gap * 0.02, dnf_gap + max_gap * 0.15)

    filename = f"race_results_{season}_{round_num}"
    path = chart.finalize(fig, ax, filename)
    logger.info("Generated race results chart: %s", path)
    return str(path)
