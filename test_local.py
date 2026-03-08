"""
Quick local test - generates all charts from the latest available data.
Run with: python test_local.py [season]

Uses OpenF1 for near-real-time results. Charts saved to output/.
"""

import sys
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)


def main():
    from src.config import CURRENT_SEASON
    from src.api.openf1 import OpenF1Client
    from src.api.jolpica import JolpicaClient
    from src.charts.race_results import generate_race_results
    from src.charts.qualifying import generate_qualifying_results
    from src.charts.driver_standings import generate_driver_standings
    from src.charts.constructor_standings import generate_constructor_standings
    from src.charts.points_progression import generate_points_progression
    from src.charts.season_calendar import generate_season_calendar
    from src.pipeline import find_latest_completed_round

    season = int(sys.argv[1]) if len(sys.argv) > 1 else CURRENT_SEASON
    logger.info("Generating charts for the %d season (OpenF1 = real-time)...", season)

    openf1 = OpenF1Client(season)
    charts = []

    # Season calendar (from Jolpica for the schedule grid)
    logger.info("Fetching season schedule...")
    jolpica = JolpicaClient(season)
    schedule = jolpica.get_schedule()
    if schedule:
        logger.info("  %d races on the calendar", len(schedule))
        latest_round = find_latest_completed_round(schedule)
        path = generate_season_calendar(schedule, season, latest_round)
        if path:
            charts.append(path)

    # Completed race sessions
    logger.info("Checking completed race sessions via OpenF1...")
    completed_races = openf1.get_completed_race_sessions()
    logger.info("  Found %d completed races", len(completed_races))

    if completed_races:
        # Latest race results
        latest = completed_races[-1]
        sk = latest["session_key"]
        circuit = latest.get("circuit_short_name", "Unknown")
        round_num = len(completed_races)

        logger.info("  Latest race: %s (session_key=%d)", circuit, sk)

        results = openf1.get_race_results_enriched(sk)
        if results:
            path = generate_race_results(results, circuit, season, round_num)
            if path:
                charts.append(path)

        # Driver standings
        logger.info("Computing driver standings...")
        standings = openf1.compute_driver_standings()
        if standings:
            path = generate_driver_standings(standings, round_num, season)
            if path:
                charts.append(path)

        # Constructor standings
        logger.info("Computing constructor standings...")
        const_standings = openf1.compute_constructor_standings()
        if const_standings:
            path = generate_constructor_standings(const_standings, round_num, season)
            if path:
                charts.append(path)

        # Points progression (need 2+ races)
        if len(completed_races) >= 2:
            logger.info("Fetching all race results for progression...")
            all_results = openf1.get_season_results_all()
            if all_results and len(all_results) >= 2:
                path = generate_points_progression(all_results, season)
                if path:
                    charts.append(path)

    # Qualifying (latest)
    logger.info("Checking qualifying sessions...")
    completed_quali = openf1.get_completed_sessions("Qualifying")
    if completed_quali:
        latest_q = completed_quali[-1]
        sk = latest_q["session_key"]
        circuit = latest_q.get("circuit_short_name", "Unknown")
        round_num = len(completed_quali)

        logger.info("  Latest qualifying: %s (session_key=%d)", circuit, sk)
        results = openf1.get_race_results_enriched(sk)
        if results:
            path = generate_qualifying_results(results, circuit, season, round_num)
            if path:
                charts.append(path)
    else:
        logger.info("  No qualifying data yet")

    print(f"\n{'='*50}")
    print(f"{season} Season - Generated {len(charts)} charts in output/:")
    for c in charts:
        print(f"  {Path(c).name}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
