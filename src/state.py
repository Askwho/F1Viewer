import json
import logging
from pathlib import Path

from src.config import STATE_FILE

logger = logging.getLogger(__name__)


class StateTracker:
    def __init__(self, state_file: Path = STATE_FILE):
        self.state_file = state_file
        self._load()

    def _load(self):
        try:
            with open(self.state_file) as f:
                self.data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.data = {
                "last_race_round": 0,
                "last_qualifying_round": 0,
                "last_standings_round": 0,
                "sent_items": [],
                "failed_items": [],
            }

    def is_sent(self, item_key: str) -> bool:
        return item_key in self.data.get("sent_items", [])

    def mark_sent(self, item_key: str):
        if item_key not in self.data["sent_items"]:
            self.data["sent_items"].append(item_key)
        # Remove from failed if it was there
        if item_key in self.data.get("failed_items", []):
            self.data["failed_items"].remove(item_key)

    def mark_failed(self, item_key: str):
        if item_key not in self.data.get("failed_items", []):
            self.data.setdefault("failed_items", []).append(item_key)

    def get_last_race_round(self) -> int:
        return self.data.get("last_race_round", 0)

    def set_last_race_round(self, round_num: int):
        self.data["last_race_round"] = round_num

    def get_last_qualifying_round(self) -> int:
        return self.data.get("last_qualifying_round", 0)

    def set_last_qualifying_round(self, round_num: int):
        self.data["last_qualifying_round"] = round_num

    def get_last_standings_round(self) -> int:
        return self.data.get("last_standings_round", 0)

    def set_last_standings_round(self, round_num: int):
        self.data["last_standings_round"] = round_num

    def get_failed_items(self) -> list[str]:
        return self.data.get("failed_items", [])

    def save(self):
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w") as f:
            json.dump(self.data, f, indent=2)
        logger.info("State saved to %s", self.state_file)
