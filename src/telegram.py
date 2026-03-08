import logging
import time
from pathlib import Path

import requests

from src.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger(__name__)

MAX_RETRIES = 3


class TelegramBot:
    def __init__(self, token: str = TELEGRAM_BOT_TOKEN, chat_id: str = TELEGRAM_CHAT_ID):
        self.token = token
        self.chat_id = chat_id
        self.base_url = f"https://api.telegram.org/bot{token}"

    @property
    def is_configured(self) -> bool:
        return bool(self.token and self.chat_id)

    def send_photo(self, image_path: Path, caption: str = "") -> bool:
        """Send a photo to the configured chat. Returns True on success."""
        if not self.is_configured:
            logger.warning("Telegram not configured, skipping send")
            return False

        url = f"{self.base_url}/sendPhoto"

        for attempt in range(MAX_RETRIES):
            try:
                with open(image_path, "rb") as photo:
                    resp = requests.post(
                        url,
                        data={
                            "chat_id": self.chat_id,
                            "caption": caption,
                            "parse_mode": "HTML",
                        },
                        files={"photo": photo},
                        timeout=60,
                    )
                if resp.status_code == 200:
                    logger.info("Sent photo: %s", image_path.name)
                    return True
                else:
                    logger.warning("Telegram API error %d: %s", resp.status_code, resp.text)
            except requests.RequestException as e:
                logger.warning("Send failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)

            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)

        logger.error("Failed to send photo after %d attempts: %s", MAX_RETRIES, image_path)
        return False

    def send_message(self, text: str) -> bool:
        """Send a text message."""
        if not self.is_configured:
            logger.warning("Telegram not configured, skipping message")
            return False

        url = f"{self.base_url}/sendMessage"
        try:
            resp = requests.post(
                url,
                data={
                    "chat_id": self.chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                },
                timeout=30,
            )
            return resp.status_code == 200
        except requests.RequestException as e:
            logger.error("Failed to send message: %s", e)
            return False
