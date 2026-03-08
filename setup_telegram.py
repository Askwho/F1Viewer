"""
Interactive Telegram Bot setup helper.
Run: python setup_telegram.py

Walks you through getting your bot token and chat ID,
then sends a test image to confirm everything works.
"""

import sys
import requests
from pathlib import Path


def main():
    print()
    print("=" * 55)
    print("  F1Viewer — Telegram Bot Setup")
    print("=" * 55)
    print()
    print("Step 1: Create a Telegram bot")
    print("  1. Open Telegram on your phone")
    print("  2. Search for @BotFather and start a chat")
    print("  3. Send: /newbot")
    print("  4. Give it a name like: F1Viewer Bot")
    print("  5. Give it a username like: f1viewer_yourname_bot")
    print("  6. BotFather will give you a token like:")
    print("     7123456789:AAH1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q")
    print()

    token = input("Paste your bot token here: ").strip()
    if not token or ":" not in token:
        print("That doesn't look like a valid token. Try again.")
        return

    # Verify token works
    resp = requests.get(f"https://api.telegram.org/bot{token}/getMe", timeout=10)
    if resp.status_code != 200:
        print(f"Token verification failed (HTTP {resp.status_code}). Check the token.")
        return

    bot_info = resp.json().get("result", {})
    print(f"\n  Bot verified: @{bot_info.get('username', '???')}")

    print()
    print("Step 2: Get your Chat ID")
    print("  1. Open Telegram and find your new bot")
    print("  2. Send it any message (just say 'hi')")
    input("  Press Enter after you've sent a message to the bot...")

    resp = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", timeout=10)
    if resp.status_code != 200:
        print("Failed to get updates. Try again.")
        return

    updates = resp.json().get("result", [])
    if not updates:
        print("No messages found. Make sure you sent a message to the bot, then try again.")
        return

    chat_id = str(updates[-1]["message"]["chat"]["id"])
    chat_name = updates[-1]["message"]["chat"].get("first_name", "You")
    print(f"\n  Chat ID found: {chat_id} ({chat_name})")

    # Test send
    print()
    print("Step 3: Sending test message...")

    test_resp = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data={
            "chat_id": chat_id,
            "text": "🏎️ F1Viewer Bot is connected! You'll receive race charts here automatically.",
            "parse_mode": "HTML",
        },
        timeout=10,
    )

    if test_resp.status_code == 200:
        print("  Test message sent! Check your Telegram.")
    else:
        print(f"  Failed to send test message (HTTP {test_resp.status_code})")
        return

    # Check if there are any charts to send as a preview
    output_dir = Path(__file__).parent / "output"
    pngs = sorted(output_dir.glob("*.png")) if output_dir.exists() else []
    if pngs:
        print(f"\n  Sending a preview chart: {pngs[0].name}...")
        with open(pngs[0], "rb") as photo:
            img_resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data={
                    "chat_id": chat_id,
                    "caption": "<b>🏁 F1Viewer Preview</b>\nYour bot is working!",
                    "parse_mode": "HTML",
                },
                files={"photo": photo},
                timeout=30,
            )
        if img_resp.status_code == 200:
            print("  Preview chart sent!")
        else:
            print(f"  Preview send failed ({img_resp.status_code}), but text worked — good enough.")

    print()
    print("=" * 55)
    print("  SETUP COMPLETE!")
    print("=" * 55)
    print()
    print("  Your credentials:")
    print(f"    TELEGRAM_BOT_TOKEN = {token}")
    print(f"    TELEGRAM_CHAT_ID   = {chat_id}")
    print()
    print("  Now add these as GitHub repository secrets:")
    print("    1. Go to your repo on GitHub")
    print("    2. Settings > Secrets and variables > Actions")
    print("    3. Click 'New repository secret'")
    print("    4. Add TELEGRAM_BOT_TOKEN with the token above")
    print("    5. Add TELEGRAM_CHAT_ID with the chat ID above")
    print()
    print("  To test locally with Telegram:")
    print(f'    set TELEGRAM_BOT_TOKEN={token}')
    print(f'    set TELEGRAM_CHAT_ID={chat_id}')
    print("    python -m src.pipeline")
    print()
    print("  Once pushed to GitHub, charts will be sent to you")
    print("  automatically within ~10 minutes of each session ending.")
    print()


if __name__ == "__main__":
    main()
