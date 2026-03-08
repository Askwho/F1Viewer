import os
from datetime import datetime
from pathlib import Path

CURRENT_SEASON = datetime.now().year

JOLPICA_BASE = "http://api.jolpi.ca/ergast/f1"
OPENF1_BASE = "https://api.openf1.org/v1"

PROJECT_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"
STATE_FILE = PROJECT_ROOT / "state" / "sent_data.json"

OUTPUT_DIR.mkdir(exist_ok=True)

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# 2025/2026 F1 team colors - keyed by Jolpica constructorId
TEAM_COLORS = {
    "red_bull":      {"primary": "#3671C6", "secondary": "#1B2641"},
    "mercedes":      {"primary": "#27F4D2", "secondary": "#00A19C"},
    "ferrari":       {"primary": "#E8002D", "secondary": "#FFEB00"},
    "mclaren":       {"primary": "#FF8000", "secondary": "#47473F"},
    "aston_martin":  {"primary": "#229971", "secondary": "#CEDC00"},
    "alpine":        {"primary": "#0093CC", "secondary": "#FF87BC"},
    "williams":      {"primary": "#64C4FF", "secondary": "#00285F"},
    "rb":            {"primary": "#6692FF", "secondary": "#1B3763"},
    "sauber":        {"primary": "#52E252", "secondary": "#000000"},
    "haas":          {"primary": "#B6BABD", "secondary": "#B6161D"},
}

# Aliases for fuzzy matching (OpenF1 uses full names, Jolpica uses IDs)
_TEAM_ALIASES = {
    "red bull racing": "red_bull",
    "red bull": "red_bull",
    "redbull": "red_bull",
    "mercedes": "mercedes",
    "mercedes-amg": "mercedes",
    "ferrari": "ferrari",
    "scuderia ferrari": "ferrari",
    "mclaren": "mclaren",
    "aston martin": "aston_martin",
    "aston_martin": "aston_martin",
    "alpine": "alpine",
    "alpine f1": "alpine",
    "williams": "williams",
    "rb": "rb",
    "racing bulls": "rb",
    "visa cashapp rb": "rb",
    "visa cash app rb": "rb",
    "alphatauri": "rb",
    "sauber": "sauber",
    "kick sauber": "sauber",
    "stake f1": "sauber",
    "cadillac": "sauber",
    "haas": "haas",
    "haas f1": "haas",
    "moneygrm haas": "haas",
}

FALLBACK_COLOR = "#888888"


def get_team_color(name: str, variant: str = "primary") -> str:
    """Get team color by constructorId or team name. Case-insensitive fuzzy match."""
    key = name.lower().strip()

    # Direct match on constructorId
    if key in TEAM_COLORS:
        return TEAM_COLORS[key][variant]

    # Alias match
    if key in _TEAM_ALIASES:
        return TEAM_COLORS[_TEAM_ALIASES[key]][variant]

    # Substring match
    for alias, team_id in _TEAM_ALIASES.items():
        if alias in key or key in alias:
            return TEAM_COLORS[team_id][variant]

    return FALLBACK_COLOR


# Chart styling constants
CHART_STYLE = {
    "bg_color": "#1a1a2e",
    "axes_color": "#16213e",
    "grid_color": "#333355",
    "text_color": "#e0e0e0",
    "accent_color": "#e94560",
    "title_size": 18,
    "label_size": 13,
    "tick_size": 11,
    "annotation_size": 10,
    "dpi": 200,
    "watermark": "@F1Viewer",
}
