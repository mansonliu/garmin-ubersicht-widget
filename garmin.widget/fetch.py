#!/usr/bin/env python3
"""Garmin Connect 桌面小工具的資料抓取腳本（給 Übersicht 呼叫）。

透過本機 gc-personal CLI（Garmin Personal API）抓四張卡片的資料：
心率、HRV 狀態、本週跑步、本週騎乘。輸出一份 JSON 到 stdout。
任一段抓失敗就沿用上次快取（cache.json）並標記 stale，讓小工具不會整片空白。
不帶任何參數；API key 由 gc-personal 自己從預設路徑讀取。
"""
import datetime as dt
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache.json")
GC = os.path.expanduser("~/garmin-env/bin/gc-personal")
WEEK_START = 6  # Python weekday：0=一 … 6=日；Garmin 設定的每週起始日是星期日

RUN_PARENT = 17     # Garmin activityType.parentTypeId：跑步
BIKE_PARENT = 2     # 騎乘
RUN_KEYS = ("running",)
BIKE_KEYS = ("cycling", "biking")


def gc(*args, timeout=40):
    r = subprocess.run([GC, "--no-color", "--quiet", *args],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[:300] or f"exit {r.returncode}")
    return json.loads(r.stdout)


def load_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def week_bounds(today):
    offset = (today.weekday() - WEEK_START) % 7
    this_start = today - dt.timedelta(days=offset)
    return this_start, this_start - dt.timedelta(days=7)


def is_run(a):
    t = a.get("activityType") or {}
    return t.get("parentTypeId") == RUN_PARENT or any(k in (t.get("typeKey") or "") for k in RUN_KEYS)


def is_bike(a):
    t = a.get("activityType") or {}
    return t.get("parentTypeId") == BIKE_PARENT or any(k in (t.get("typeKey") or "") for k in BIKE_KEYS)


def summarize(acts, start):
    """一週的彙總：次數、公里、分鐘、爬升，加上週日到週六每天的公里數。"""
    days = [0.0] * 7
    total = {"count": 0, "km": 0.0, "min": 0.0, "elev": 0.0, "days": days, "items": []}
    for a in acts:
        d = dt.datetime.strptime(a["startTimeLocal"][:10], "%Y-%m-%d").date()
        idx = (d - start).days
        if not 0 <= idx < 7:
            continue
        km = (a.get("distance") or 0) / 1000.0
        mins = (a.get("movingDuration") or a.get("duration") or 0) / 60.0
        total["count"] += 1
        total["km"] += km
        total["min"] += mins
        total["elev"] += a.get("elevationGain") or 0
        days[idx] += km
        total["items"].append({
            "date": a["startTimeLocal"][:10],
            "name": a.get("activityName") or "",
            "type": (a.get("activityType") or {}).get("typeKey", ""),
            "km": round(km, 2),
            "min": round(mins),
        })
    total["km"] = round(total["km"], 2)
    total["min"] = round(total["min"])
    total["elev"] = round(total["elev"])
    total["days"] = [round(x, 2) for x in days]
    return total


def fetch_heart_rate(today):
    d = gc("heart-rate")
    vals = [v for v in (d.get("heartRateValues") or []) if v and v[1] is not None]
    latest = None
    if vals:
        ts, hr = vals[-1]
        latest = {"hr": hr,
                  "time": dt.datetime.fromtimestamp(ts / 1000).strftime("%H:%M")}
    # 畫 sparkline 用：每 2 分鐘一點太密，降到約 120 點
    step = max(1, len(vals) // 120)
    series = [v[1] for v in vals[::step]]
    return {
        "date": d.get("calendarDate"),
        "resting": d.get("restingHeartRate"),
        "resting7d": d.get("lastSevenDaysAvgRestingHeartRate"),
        "min": d.get("minHeartRate"),
        "max": d.get("maxHeartRate"),
        "latest": latest,
        "series": series,
    }


def fetch_hrv(today):
    d = gc("hrv")
    s = d.get("hrvSummary") or {}
    base = s.get("baseline") or {}
    start = today - dt.timedelta(days=6)
    hist = []
    try:
        h = gc("hrv-summaries", "--start-date", start.isoformat(), "--end-date", today.isoformat())
        for x in h.get("hrvSummaries") or []:
            hist.append({"date": x.get("calendarDate"),
                         "avg": x.get("lastNightAvg"),
                         "status": x.get("status")})
    except Exception as e:  # 歷史抓不到不影響主卡
        hist = [{"error": str(e)[:120]}]
    return {
        "date": s.get("calendarDate"),
        "lastNight": s.get("lastNightAvg"),
        "high5min": s.get("lastNight5MinHigh"),
        "weekly": s.get("weeklyAvg"),
        "status": s.get("status"),
        "balancedLow": base.get("balancedLow"),
        "balancedUpper": base.get("balancedUpper"),
        "lowUpper": base.get("lowUpper"),
        "history": hist,
    }


def fetch_activities(today):
    this_start, last_start = week_bounds(today)
    acts = gc("activities", "--start-date", last_start.isoformat(),
              "--end-date", today.isoformat(), "--limit", "100")
    runs = [a for a in acts if is_run(a)]
    bikes = [a for a in acts if is_bike(a)]
    return {
        "weekStart": this_start.isoformat(),
        "run": {"this": summarize(runs, this_start), "last": summarize(runs, last_start)},
        "bike": {"this": summarize(bikes, this_start), "last": summarize(bikes, last_start)},
    }


def main():
    today = dt.date.today()
    cache = load_cache()
    out = {"updated": dt.datetime.now().strftime("%m/%d %H:%M"), "errors": {}, "stale": []}
    for key, fn in (("hr", fetch_heart_rate), ("hrv", fetch_hrv), ("acts", fetch_activities)):
        try:
            out[key] = fn(today)
        except Exception as e:
            out["errors"][key] = str(e)[:200]
            if key in cache:
                out[key] = cache[key]
                out["stale"].append(key)
            else:
                out[key] = None
    if not os.path.exists(GC):
        out["errors"]["gc"] = "找不到 gc-personal：" + GC
    try:
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
    except Exception:
        pass
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
