#!/usr/bin/env python3
"""
Helper script to set or check the Telegram Bot Webhook.
Usage:
    uv run scripts/setup_telegram_webhook.py https://<your-vercel-domain>/api/telegram
Or run without arguments to check current webhook status.
"""

import sys
import os
import json
import urllib.request

def main():
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        # Prompt or read
        print("Please set TELEGRAM_BOT_TOKEN environment variable or enter it below.")
        bot_token = input("Enter TELEGRAM_BOT_TOKEN: ").strip()

    if not bot_token:
        print("Error: No bot token provided.")
        sys.exit(1)

    if len(sys.argv) > 1:
        webhook_url = sys.argv[1].strip()
        print(f"Setting webhook to: {webhook_url} ...")
        api_url = f"https://api.telegram.org/bot{bot_token}/setWebhook"
        req = urllib.request.Request(
            api_url,
            headers={"Content-Type": "application/json"},
            data=json.dumps({"url": webhook_url}).encode("utf-8")
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                print("Result:", json.dumps(result, indent=2, ensure_ascii=False))
        except Exception as e:
            print("Failed to set webhook:", e)
    else:
        print("Checking current webhook info...")
        api_url = f"https://api.telegram.org/bot{bot_token}/getWebhookInfo"
        try:
            with urllib.request.urlopen(api_url, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                print("Current Webhook Info:")
                print(json.dumps(result, indent=2, ensure_ascii=False))
                print("\nTo set a new webhook, run:")
                print("  uv run scripts/setup_telegram_webhook.py https://<your-domain>/api/telegram")
        except Exception as e:
            print("Failed to get webhook info:", e)

if __name__ == "__main__":
    main()
