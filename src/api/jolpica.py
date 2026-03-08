import time
import logging
import requests

from src.config import JOLPICA_BASE, CURRENT_SEASON

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 30
RATE_LIMIT_DELAY = 0.3
MAX_RETRIES = 3


def _request(url: str) -> dict | None:
    """Make a GET request with retries and rate limiting."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            time.sleep(RATE_LIMIT_DELAY)
            return resp.json()
        except requests.RequestException as e:
            logger.warning("Request failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    return None


class JolpicaClient:
    def __init__(self, season: int = CURRENT_SEASON):
        self.season = season
        self.base = f"{JOLPICA_BASE}/{season}"

    def get_schedule(self) -> list[dict]:
        """Get the full race schedule for the season."""
        data = _request(f"{self.base}.json?limit=30")
        if not data:
            return []
        try:
            return data["MRData"]["RaceTable"]["Races"]
        except (KeyError, IndexError):
            return []

    def get_race_results(self, round_num: int | str = "last") -> dict | None:
        """Get race results for a specific round. Returns the Race dict or None."""
        data = _request(f"{self.base}/{round_num}/results.json?limit=30")
        if not data:
            return None
        try:
            races = data["MRData"]["RaceTable"]["Races"]
            return races[0] if races else None
        except (KeyError, IndexError):
            return None

    def get_sprint_results(self, round_num: int | str = "last") -> dict | None:
        """Get sprint race results for a specific round."""
        data = _request(f"{self.base}/{round_num}/sprint.json?limit=30")
        if not data:
            return None
        try:
            races = data["MRData"]["RaceTable"]["Races"]
            return races[0] if races else None
        except (KeyError, IndexError):
            return None

    def get_qualifying_results(self, round_num: int | str = "last") -> dict | None:
        """Get qualifying results for a specific round."""
        data = _request(f"{self.base}/{round_num}/qualifying.json?limit=30")
        if not data:
            return None
        try:
            races = data["MRData"]["RaceTable"]["Races"]
            return races[0] if races else None
        except (KeyError, IndexError):
            return None

    def get_driver_standings(self) -> list[dict]:
        """Get current driver championship standings."""
        data = _request(f"{self.base}/driverStandings.json?limit=30")
        if not data:
            return []
        try:
            standings = data["MRData"]["StandingsTable"]["StandingsLists"]
            return standings[0]["DriverStandings"] if standings else []
        except (KeyError, IndexError):
            return []

    def get_constructor_standings(self) -> list[dict]:
        """Get current constructor championship standings."""
        data = _request(f"{self.base}/constructorStandings.json?limit=30")
        if not data:
            return []
        try:
            standings = data["MRData"]["StandingsTable"]["StandingsLists"]
            return standings[0]["ConstructorStandings"] if standings else []
        except (KeyError, IndexError):
            return []

    def get_all_race_results(self) -> list[dict]:
        """Get results for all completed rounds this season (for points progression)."""
        all_races = []
        offset = 0
        limit = 100

        # First, get the schedule to know how many rounds
        schedule = self.get_schedule()
        if not schedule:
            return []

        for race_info in schedule:
            round_num = race_info["round"]
            race = self.get_race_results(round_num)
            if race and "Results" in race and race["Results"]:
                all_races.append(race)

        return all_races

    def get_standings_round(self) -> int:
        """Get the round number of the latest standings update."""
        data = _request(f"{self.base}/driverStandings.json")
        if not data:
            return 0
        try:
            standings = data["MRData"]["StandingsTable"]["StandingsLists"]
            return int(standings[0]["round"]) if standings else 0
        except (KeyError, IndexError, ValueError):
            return 0
