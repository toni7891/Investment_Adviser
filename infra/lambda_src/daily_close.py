"""
Triggered by EventBridge every weekday at 4pm ET.
Calls POST /api/internal/daily-close on the app, which:
  - Records a market-close NAV snapshot for every portfolio
  - Sends a daily summary email via SES
"""
import json
import os
import urllib.request


def handler(event, context):
    url = os.environ["APP_URL"].rstrip("/") + "/api/internal/daily-close"
    key = os.environ["INTERNAL_API_KEY"]

    req = urllib.request.Request(
        url,
        method="POST",
        headers={
            "X-Internal-Key": key,
            "Content-Length": "0",
        },
    )

    with urllib.request.urlopen(req, timeout=55) as r:
        body = json.loads(r.read())

    print(f"Snapshotted {body['snapshotted']} portfolios")
    for result in body.get("results", []):
        print(f"  {result['portfolio']}: {result['status']}")

    return {"statusCode": 200, "body": body}
