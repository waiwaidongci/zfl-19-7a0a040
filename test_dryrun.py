#!/usr/bin/env python3
import json, urllib.request

url = "http://127.0.0.1:3019/tunes/tune_demo/sections/batch?dryRun=true"
data = [
    {"startBeat": 200, "endBeat": 210, "laneRange": "1-30"},
    {"startBeat": 110, "endBeat": 120, "laneRange": "1-10"},
    {"startBeat": 115, "endBeat": 125, "laneRange": "1-10"},
    {"startBeat": 140, "endBeat": 150, "laneRange": "1-10"},
]
req = urllib.request.Request(url,
    data=json.dumps(data).encode(),
    headers={"Content-Type": "application/json"},
    method="POST")
with urllib.request.urlopen(req) as resp:
    d = json.loads(resp.read())

print("=== summary ===")
print(json.dumps(d["summary"], indent=2, ensure_ascii=False))
print()
print("duplicateRows:", d["duplicateRows"])
print("fieldErrorRows:", d["fieldErrorRows"])
print("conflictErrorRows:", d["conflictErrorRows"])
print("saveableRowIndexes:", d["saveableRowIndexes"])
print("saveableCount:", d["saveableCount"])
print()
for r in d["rowResults"]:
    beats = f"{r.get('startBeat')}-{r.get('endBeat')}" if r.get("startBeat") is not None else "n/a"
    print(f"--- row {r['index']} status={r['status']} ({beats} {r.get('laneRange')}) ---")
    if r.get("fieldErrors"):
        print("  fieldErrors:", r["fieldErrors"])
    for c in r.get("conflicts", []):
        print(f"  ERROR [{c['type']}]: {c['message']}")
    for w in r.get("warnings", []):
        print(f"  WARN  [{w['type']}]: {w['message']}")
print()
print("=== saveableSections preview ===")
for s in d.get("saveableSections", []):
    print(f"  id={s['id']} {s['startBeat']}-{s['endBeat']} laneRange={s['laneRange']}")
