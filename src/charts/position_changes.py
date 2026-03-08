import logging

import numpy as np

from src.config import get_team_color, CHART_STYLE
from src.charts.base import F1Chart
from src.api.openf1 import OpenF1Client

logger = logging.getLogger(__name__)


def generate_position_changes(session_key: int, race_name: str, season: int,
                               round_num: int) -> str | None:
    """
    Generate a bump/spaghetti chart showing position changes throughout the race.
    Uses OpenF1 data. Returns the saved file path or None on failure.
    """
    client = OpenF1Client()

    drivers = client.get_drivers(session_key)
    if not drivers:
        logger.warning("No driver data from OpenF1 for session %d", session_key)
        return None

    # Build driver info lookup
    driver_info = {}
    for d in drivers:
        num = d.get("driver_number")
        if num is not None:
            driver_info[num] = {
                "code": d.get("name_acronym", f"#{num}"),
                "color": "#" + d.get("team_colour", "888888"),
                "team": d.get("team_name", "Unknown"),
            }

    # Get lap-by-lap positions
    lap_positions = client.build_lap_positions(session_key)
    if not lap_positions:
        logger.warning("No position data from OpenF1 for session %d", session_key)
        return None

    # Get pit stops for markers
    pit_stops = client.get_pit_stops(session_key)
    pit_laps = {}
    for pit in (pit_stops or []):
        num = pit.get("driver_number")
        lap = pit.get("lap_number")
        if num and lap:
            pit_laps.setdefault(num, []).append(lap)

    # Determine total laps
    max_laps = max(len(positions) for positions in lap_positions.values())

    title = f"{season} {race_name} \u2014 Position Changes"
    chart = F1Chart(title, width=18, height=10)
    fig, ax = chart.setup()

    for drv_num, positions in lap_positions.items():
        info = driver_info.get(drv_num, {"code": f"#{drv_num}", "color": "#888888"})
        laps = np.arange(1, len(positions) + 1)

        ax.plot(
            laps, positions,
            color=info["color"],
            linewidth=2.2,
            alpha=0.85,
            zorder=5,
        )

        # Pit stop markers
        if drv_num in pit_laps:
            for pit_lap in pit_laps[drv_num]:
                if pit_lap <= len(positions):
                    ax.plot(
                        pit_lap, positions[pit_lap - 1],
                        marker="v", color=info["color"],
                        markersize=8, zorder=7,
                        markeredgecolor="white", markeredgewidth=0.5,
                    )

        # Label at the end
        if positions:
            ax.text(
                laps[-1] + 0.5, positions[-1],
                f" {info['code']}",
                va="center", ha="left",
                fontsize=9, fontweight="bold",
                color=info["color"],
            )

    ax.set_xlabel("Lap", fontsize=CHART_STYLE["label_size"], color=CHART_STYLE["text_color"])
    ax.set_ylabel("Position", fontsize=CHART_STYLE["label_size"], color=CHART_STYLE["text_color"])

    # Invert y-axis so P1 is at the top
    ax.invert_yaxis()
    ax.set_ylim(len(driver_info) + 0.5, 0.5)
    ax.set_xlim(0, max_laps + 3)

    # Integer ticks for positions
    ax.set_yticks(range(1, len(driver_info) + 1))

    # Add start/finish grid lines
    ax.axvline(x=1, color="#ffd700", alpha=0.3, linestyle="--", linewidth=1)
    ax.axvline(x=max_laps, color="#ffd700", alpha=0.3, linestyle="--", linewidth=1)

    filename = f"position_changes_{season}_{round_num}"
    path = chart.finalize(fig, ax, filename)
    logger.info("Generated position changes chart: %s", path)
    return str(path)
