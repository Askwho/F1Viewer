"""
F1Viewer Pipeline - Main orchestrator.

Fetches latest F1 data from OpenF1 (near-real-time), generates charts,
and sends via Telegram. Jolpica used only for season calendar schedule.

Designed to run on GitHub Actions on a cron schedule.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path

from src.config import CURRENT_SEASON
from src.api.openf1 import OpenF1Client
from src.api.jolpica import JolpicaClient
from src.state import StateTracker
from src.telegram import TelegramBot
from src.charts.race_results import generate_race_results
from src.charts.qualifying import generate_qualifying_results
from src.charts.driver_standings import generate_driver_standings
from src.charts.constructor_standings import generate_constructor_standings
from src.charts.points_progression import generate_points_progression
from src.charts.position_changes import generate_position_changes
from src.charts.season_calendar import generate_season_calendar

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("f1viewer")


def send_chart(bot: TelegramBot, chart_path: str, caption: str, state: StateTracker,
               item_key: str) -> bool:
    """Send a chart via Telegram and update state."""
    if not chart_path:
        return False

    path = Path(chart_path)
    if not path.exists():
        logger.error("Chart file not found: %s", chart_path)
        return False

    success = bot.send_photo(path, caption)
    if success:
        state.mark_sent(item_key)
        logger.info("Sent and marked: %s", item_key)
    else:
        state.mark_failed(item_key)
        logger.warning("Failed to send: %s", item_key)

    return success


def find_latest_completed_round(schedule: list[dict]) -> int:
    """Determine the most recent round whose race date is in the past."""
    now = datetime.now(timezone.utc)
    latest_round = 0
    for race in schedule:
        race_date_str = race.get("date", "")
        race_time_str = race.get("time", "14:00:00Z")
        try:
            dt = datetime.fromisoformat(
                f"{race_date_str}T{race_time_str}".replace("Z", "+00:00")
            )
            if dt < now:
                latest_round = int(race.get("round", 0))
        except (ValueError, TypeError):
            continue
    return latest_round


def run_pipeline():
    """Main pipeline entry point."""
    logger.info("=" * 60)
    logger.info("F1Viewer Pipeline starting - Season %d", CURRENT_SEASON)
    logger.info("=" * 60)

    openf1 = OpenF1Client()
    state = StateTracker()
    bot = TelegramBot()

    if not bot.is_configured:
        logger.warning("Telegram not configured. Charts will be generated but not sent.")
        logger.warning("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.")

    charts_generated = 0
    charts_sent = 0

    # ── 1. Season calendar (uses Jolpica for schedule) ─────────
    try:
        jolpica = JolpicaClient()
        schedule = jolpica.get_schedule()
        if schedule:
            latest_round = find_latest_completed_round(schedule)
            cal_key = f"calendar_{CURRENT_SEASON}_{latest_round}"
            if not state.is_sent(cal_key):
                chart_path = generate_season_calendar(schedule, CURRENT_SEASON, latest_round)
                if chart_path:
                    charts_generated += 1
                    caption = (
                        f"<b>\U0001f4c5 {CURRENT_SEASON} F1 Season Calendar</b>\n"
                        f"{len(schedule)} races \u2014 {latest_round} completed"
                    )
                    if send_chart(bot, chart_path, caption, state, cal_key):
                        charts_sent += 1
    except Exception as e:
        logger.error("Failed to generate calendar: %s", e)

    # ── 2. Process completed race sessions via OpenF1 ──────────
    logger.info("Checking for completed race sessions...")
    completed_races = openf1.get_completed_race_sessions()
    logger.info("Found %d completed race sessions this season", len(completed_races))

    for i, session in enumerate(completed_races):
        sk = session["session_key"]
        circuit = session.get("circuit_short_name", "Unknown")
        round_num = i + 1  # OpenF1 doesn't give round numbers, infer from order

        race_key = f"race_results_{CURRENT_SEASON}_{sk}"
        if state.is_sent(race_key):
            continue

        logger.info("Processing race: %s (session_key=%d, round %d)", circuit, sk, round_num)

        # 2a. Race results
        try:
            results = openf1.get_race_results_enriched(sk)
            if results:
                chart_path = generate_race_results(results, circuit, CURRENT_SEASON, round_num)
                if chart_path:
                    charts_generated += 1
                    winner = results[0]
                    caption = (
                        f"<b>\U0001f3c1 {CURRENT_SEASON} {circuit} Race Results</b>\n"
                        f"\U0001f947 Winner: {winner['full_name']}\n"
                        f"Gap analysis to race winner"
                    )
                    if send_chart(bot, chart_path, caption, state, race_key):
                        charts_sent += 1
        except Exception as e:
            logger.error("Failed to generate race results: %s", e)

        # 2b. Position changes
        pos_key = f"position_changes_{CURRENT_SEASON}_{sk}"
        if not state.is_sent(pos_key):
            try:
                chart_path = generate_position_changes(sk, circuit, CURRENT_SEASON, round_num)
                if chart_path:
                    charts_generated += 1
                    caption = (
                        f"<b>\U0001f504 {CURRENT_SEASON} {circuit} Position Changes</b>\n"
                        f"Lap-by-lap battle throughout the race\n"
                        f"\u25bc = pit stop"
                    )
                    if send_chart(bot, chart_path, caption, state, pos_key):
                        charts_sent += 1
            except Exception as e:
                logger.error("Failed to generate position changes: %s", e)

    # ── 3. Qualifying (process latest) ─────────────────────────
    completed_quali = openf1.get_completed_sessions("Qualifying")
    for i, session in enumerate(completed_quali):
        sk = session["session_key"]
        circuit = session.get("circuit_short_name", "Unknown")
        quali_key = f"qualifying_{CURRENT_SEASON}_{sk}"

        if state.is_sent(quali_key):
            continue

        logger.info("Processing qualifying: %s (session_key=%d)", circuit, sk)
        try:
            results = openf1.get_race_results_enriched(sk)
            if results:
                chart_path = generate_qualifying_results(
                    results, circuit, CURRENT_SEASON, i + 1
                )
                if chart_path:
                    charts_generated += 1
                    pole = results[0] if results else {}
                    caption = (
                        f"<b>\U0001f3ce {CURRENT_SEASON} {circuit} Qualifying</b>\n"
                        f"\U0001f947 Pole: {pole.get('full_name', '???')}"
                    )
                    if send_chart(bot, chart_path, caption, state, quali_key):
                        charts_sent += 1
        except Exception as e:
            logger.error("Failed to generate qualifying chart: %s", e)

    # ── 4. Championship standings (after any new race) ─────────
    if completed_races:
        num_races = len(completed_races)
        standings_key = f"driver_standings_{CURRENT_SEASON}_{num_races}"

        if not state.is_sent(standings_key):
            logger.info("Computing championship standings...")

            # Driver standings
            try:
                driver_standings = openf1.compute_driver_standings()
                if driver_standings:
                    chart_path = generate_driver_standings(
                        driver_standings, num_races, CURRENT_SEASON
                    )
                    if chart_path:
                        charts_generated += 1
                        leader = driver_standings[0]
                        caption = (
                            f"<b>\U0001f3c6 {CURRENT_SEASON} Driver Standings \u2014 "
                            f"Round {num_races}</b>\n"
                            f"Leader: {leader['full_name']} ({leader['points']:.0f} pts)"
                        )
                        if send_chart(bot, chart_path, caption, state, standings_key):
                            charts_sent += 1
            except Exception as e:
                logger.error("Failed to generate driver standings: %s", e)

            # Constructor standings
            const_key = f"constructor_standings_{CURRENT_SEASON}_{num_races}"
            if not state.is_sent(const_key):
                try:
                    const_standings = openf1.compute_constructor_standings()
                    if const_standings:
                        chart_path = generate_constructor_standings(
                            const_standings, num_races, CURRENT_SEASON
                        )
                        if chart_path:
                            charts_generated += 1
                            leader = const_standings[0]
                            caption = (
                                f"<b>\U0001f3ed {CURRENT_SEASON} Constructor Standings \u2014 "
                                f"Round {num_races}</b>\n"
                                f"Leading team: {leader['team']} ({leader['points']:.0f} pts)"
                            )
                            if send_chart(bot, chart_path, caption, state, const_key):
                                charts_sent += 1
                except Exception as e:
                    logger.error("Failed to generate constructor standings: %s", e)

        # Points progression (needs at least 2 races)
        if num_races >= 2:
            prog_key = f"points_progression_{CURRENT_SEASON}_{num_races}"
            if not state.is_sent(prog_key):
                try:
                    logger.info("Fetching all race results for progression...")
                    all_results = openf1.get_season_results_all()
                    if all_results and len(all_results) >= 2:
                        chart_path = generate_points_progression(
                            all_results, CURRENT_SEASON
                        )
                        if chart_path:
                            charts_generated += 1
                            caption = (
                                f"<b>\U0001f4c8 {CURRENT_SEASON} Points Progression</b>\n"
                                f"Championship battle through {num_races} rounds"
                            )
                            if send_chart(bot, chart_path, caption, state, prog_key):
                                charts_sent += 1
                except Exception as e:
                    logger.error("Failed to generate points progression: %s", e)

    # ── 5. Save state ──────────────────────────────────────────
    state.save()

    logger.info("=" * 60)
    logger.info("Pipeline complete. Generated: %d charts, Sent: %d", charts_generated, charts_sent)
    logger.info("=" * 60)


if __name__ == "__main__":
    run_pipeline()
