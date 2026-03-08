import time
import logging
from datetime import datetime, timezone

import requests

from src.config import OPENF1_BASE, CURRENT_SEASON

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RATE_LIMIT_DELAY = 0.35  # OpenF1 allows 3 req/s


def _request(endpoint: str, params: dict = None) -> list | None:
    """Make a GET request to OpenF1. Returns list of records or None."""
    url = f"{OPENF1_BASE}/{endpoint}"
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            time.sleep(RATE_LIMIT_DELAY)
            data = resp.json()
            return data if isinstance(data, list) else None
        except requests.RequestException as e:
            logger.warning("OpenF1 request failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    return None


class OpenF1Client:
    def __init__(self, year: int = CURRENT_SEASON):
        self.year = year

    # ── Session discovery ───────────────────────────────────────

    def get_all_sessions(self, session_name: str = None) -> list[dict]:
        """Get all sessions for the year, optionally filtered by type."""
        params = {"year": self.year}
        if session_name:
            params["session_name"] = session_name
        return _request("sessions", params) or []

    def get_completed_race_sessions(self) -> list[dict]:
        """Get all completed Race sessions this year, sorted by date."""
        now = datetime.now(timezone.utc).isoformat()
        sessions = self.get_all_sessions("Race")
        completed = [s for s in sessions if s.get("date_end") and s["date_end"] < now]
        return sorted(completed, key=lambda s: s.get("date_start", ""))

    def get_completed_sessions(self, session_name: str) -> list[dict]:
        """Get all completed sessions of a given type this year."""
        now = datetime.now(timezone.utc).isoformat()
        sessions = self.get_all_sessions(session_name)
        completed = [s for s in sessions if s.get("date_end") and s["date_end"] < now]
        return sorted(completed, key=lambda s: s.get("date_start", ""))

    def get_latest_session(self, session_name: str) -> dict | None:
        """Get the most recent completed session of a given type."""
        completed = self.get_completed_sessions(session_name)
        return completed[-1] if completed else None

    # ── Core data endpoints ─────────────────────────────────────

    def get_session_results(self, session_key: int) -> list[dict]:
        """
        Get official session classification.
        Returns list of {position, driver_number, gap_to_leader, points,
                         number_of_laps, duration, dnf, dns, dsq}.
        """
        results = _request("session_result", {"session_key": session_key})
        return results or []

    def get_drivers(self, session_key: int) -> list[dict]:
        """Get driver info for a session (includes team_colour, team_name, name_acronym)."""
        return _request("drivers", {"session_key": session_key}) or []

    def get_driver_map(self, session_key: int) -> dict[int, dict]:
        """Build a {driver_number: driver_info} lookup for a session."""
        drivers = self.get_drivers(session_key)
        result = {}
        for d in drivers:
            num = d.get("driver_number")
            if num is not None:
                result[num] = {
                    "code": d.get("name_acronym", f"#{num}"),
                    "full_name": d.get("full_name", "Unknown"),
                    "team": d.get("team_name", "Unknown"),
                    "color": "#" + d.get("team_colour", "888888"),
                    "number": num,
                }
        return result

    def get_positions(self, session_key: int) -> list[dict]:
        """Get position data sampled throughout the session."""
        return _request("position", {"session_key": session_key}) or []

    def get_laps(self, session_key: int, driver_number: int = None) -> list[dict]:
        """Get lap data for a session."""
        params = {"session_key": session_key}
        if driver_number:
            params["driver_number"] = driver_number
        return _request("laps", params) or []

    def get_intervals(self, session_key: int) -> list[dict]:
        """Get interval data (gaps between cars)."""
        return _request("intervals", {"session_key": session_key}) or []

    def get_pit_stops(self, session_key: int) -> list[dict]:
        """Get pit stop data for a session."""
        return _request("pit", {"session_key": session_key}) or []

    def get_stints(self, session_key: int) -> list[dict]:
        """Get stint data (tyre compounds and lap ranges)."""
        return _request("stints", {"session_key": session_key}) or []

    # ── Composite helpers ───────────────────────────────────────

    def get_race_results_enriched(self, session_key: int) -> list[dict] | None:
        """
        Get full race results with driver info merged in.
        Returns sorted list of dicts with position, code, full_name, team, color,
        gap_to_leader, points, number_of_laps, dnf, dns, dsq, duration.
        """
        raw_results = self.get_session_results(session_key)
        if not raw_results:
            return None

        driver_map = self.get_driver_map(session_key)

        enriched = []
        for r in raw_results:
            drv = driver_map.get(r.get("driver_number"), {})
            enriched.append({
                "position": r.get("position"),
                "driver_number": r.get("driver_number"),
                "code": drv.get("code", "???"),
                "full_name": drv.get("full_name", "Unknown"),
                "team": drv.get("team", "Unknown"),
                "color": drv.get("color", "#888888"),
                "gap_to_leader": r.get("gap_to_leader"),
                "points": r.get("points", 0),
                "number_of_laps": r.get("number_of_laps"),
                "duration": r.get("duration"),
                "dnf": r.get("dnf", False),
                "dns": r.get("dns", False),
                "dsq": r.get("dsq", False),
            })

        # Sort by position (None positions = DNF/DNS at the end)
        enriched.sort(key=lambda x: x["position"] if x["position"] is not None else 999)
        return enriched

    def get_season_results_all(self) -> list[dict]:
        """
        Get results for all completed races this season.
        Returns list of {session_key, circuit, date, results: [...]}.
        """
        race_sessions = self.get_completed_race_sessions()
        all_results = []

        for session in race_sessions:
            sk = session["session_key"]
            results = self.get_race_results_enriched(sk)
            if results:
                all_results.append({
                    "session_key": sk,
                    "circuit": session.get("circuit_short_name", "Unknown"),
                    "country": session.get("country_name", ""),
                    "date": session.get("date_start", ""),
                    "results": results,
                })

        return all_results

    def compute_driver_standings(self) -> list[dict]:
        """
        Compute current driver championship standings by summing points
        across all completed race and sprint sessions.
        Returns sorted list of {code, full_name, team, color, points, wins, position}.
        """
        standings = {}  # code -> {points, wins, team, color, full_name}

        # Sum from races
        for session_type in ["Race", "Sprint"]:
            completed = self.get_completed_sessions(session_type)
            for session in completed:
                sk = session["session_key"]
                results = self.get_race_results_enriched(sk)
                if not results:
                    continue
                for r in results:
                    code = r["code"]
                    pts = r.get("points") or 0
                    if code not in standings:
                        standings[code] = {
                            "code": code,
                            "full_name": r["full_name"],
                            "team": r["team"],
                            "color": r["color"],
                            "points": 0,
                            "wins": 0,
                        }
                    standings[code]["points"] += pts
                    # Update team/color to latest
                    standings[code]["team"] = r["team"]
                    standings[code]["color"] = r["color"]
                    if r.get("position") == 1 and session_type == "Race":
                        standings[code]["wins"] += 1

        # Sort by points descending
        sorted_standings = sorted(standings.values(), key=lambda x: x["points"], reverse=True)
        for i, entry in enumerate(sorted_standings):
            entry["position"] = i + 1

        return sorted_standings

    def compute_constructor_standings(self) -> list[dict]:
        """
        Compute constructor championship standings by summing driver points per team.
        Returns sorted list of {team, color, points, wins, position}.
        """
        team_points = {}  # team -> {points, wins, color}

        for session_type in ["Race", "Sprint"]:
            completed = self.get_completed_sessions(session_type)
            for session in completed:
                sk = session["session_key"]
                results = self.get_race_results_enriched(sk)
                if not results:
                    continue
                for r in results:
                    team = r["team"]
                    pts = r.get("points") or 0
                    if team not in team_points:
                        team_points[team] = {"team": team, "color": r["color"],
                                             "points": 0, "wins": 0}
                    team_points[team]["points"] += pts
                    team_points[team]["color"] = r["color"]
                    if r.get("position") == 1 and session_type == "Race":
                        team_points[team]["wins"] += 1

        sorted_standings = sorted(team_points.values(), key=lambda x: x["points"], reverse=True)
        for i, entry in enumerate(sorted_standings):
            entry["position"] = i + 1

        return sorted_standings

    def build_lap_positions(self, session_key: int) -> dict[int, list[int]]:
        """
        Build per-lap position data for each driver.
        Returns {driver_number: [pos_lap_1, pos_lap_2, ...]}.
        """
        positions = self.get_positions(session_key)
        laps = self.get_laps(session_key)

        if not positions or not laps:
            return {}

        driver_numbers = sorted(set(p["driver_number"] for p in positions))

        result = {}
        for drv in driver_numbers:
            drv_laps = [l for l in laps if l["driver_number"] == drv]
            drv_positions = [p for p in positions if p["driver_number"] == drv]

            if not drv_laps or not drv_positions:
                continue

            lap_pos = []
            for lap_data in sorted(drv_laps, key=lambda x: x.get("lap_number", 0)):
                lap_num = lap_data.get("lap_number")
                if lap_num is None:
                    continue
                lap_date = lap_data.get("date_start")
                if lap_date:
                    relevant = [p for p in drv_positions if p.get("date", "") <= lap_date]
                    if relevant:
                        lap_pos.append(relevant[-1].get("position", 0))
                    elif drv_positions:
                        lap_pos.append(drv_positions[0].get("position", 0))

            if lap_pos:
                result[drv] = lap_pos

        return result
