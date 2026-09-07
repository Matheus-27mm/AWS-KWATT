"""Raio-x do ambiente na AWS: filas, lotes da Lambda, janelas, alertas e lake.

  python scripts/status.py --tenant demo --site fabrica --day 2026-09-07 --since-minutes 30

Lê a URL da API e os nomes dos recursos das saídas do Terraform (infra/) e a chave do cliente de
.secrets/<tenant>-api-key.txt. Não altera nada.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

import boto3
import httpx

ROOT = Path(__file__).resolve().parents[1]
BATCH_RE = re.compile(r"aceitas=(\d+) \(atrasadas=(\d+)\) rejeitadas=(\d+) reentregar=(\d+) lake=(\d+)")


def tf_outputs() -> dict[str, str]:
    tf = Path.home() / "tools" / "terraform" / "terraform.exe"
    exe = str(tf) if tf.exists() else "terraform"
    out = subprocess.run(
        [exe, f"-chdir={ROOT / 'infra'}", "output", "-json"], capture_output=True, text=True, check=True
    )
    return {k: v["value"] for k, v in json.loads(out.stdout).items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="demo")
    ap.add_argument("--site", default="fabrica")
    ap.add_argument("--day", default=datetime.now(UTC).strftime("%Y-%m-%d"), help="dia UTC das janelas")
    ap.add_argument("--since-minutes", type=int, default=30)
    ap.add_argument("--region", default="sa-east-1")
    args = ap.parse_args()

    outs = tf_outputs()
    api = outs["api_url"]
    key = (ROOT / ".secrets" / f"{args.tenant}-api-key.txt").read_text(encoding="utf-8").strip()
    h = {"X-API-Key": key}
    session = boto3.Session(region_name=args.region)
    sqs, logs, s3 = session.client("sqs"), session.client("logs"), session.client("s3")

    print("== filas ==")
    q = sqs.get_queue_attributes(
        QueueUrl=outs["readings_queue_url"],
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]
    dlq_url = outs["readings_queue_url"] + "-dlq"
    dlq = sqs.get_queue_attributes(QueueUrl=dlq_url, AttributeNames=["ApproximateNumberOfMessages"])["Attributes"]
    visible, inflight = q["ApproximateNumberOfMessages"], q["ApproximateNumberOfMessagesNotVisible"]
    print(f"pendentes: {visible}  em voo: {inflight}  DLQ: {dlq['ApproximateNumberOfMessages']}")

    print(f"\n== lotes da Lambda processadora (últimos {args.since_minutes} min) ==")
    since = int((datetime.now(UTC) - timedelta(minutes=args.since_minutes)).timestamp() * 1000)
    group = f"/aws/lambda/{outs['table_name']}-processador"
    totals = Counter()
    batches = 0
    token: str | None = None
    while True:
        kwargs = {"logGroupName": group, "startTime": since, "filterPattern": "lote"}
        if token:
            kwargs["nextToken"] = token
        page = logs.filter_log_events(**kwargs)
        for ev in page["events"]:
            m = BATCH_RE.search(ev["message"])
            if m:
                batches += 1
                for name, val in zip(
                    ("aceitas", "atrasadas", "rejeitadas", "reentregar", "lake"), m.groups(), strict=True
                ):
                    totals[name] += int(val)
        token = page.get("nextToken")
        if not token:
            break
    print(f"lotes: {batches}  " + "  ".join(f"{k}: {v}" for k, v in totals.items()))
    warns = Counter()
    page = logs.filter_log_events(logGroupName=group, startTime=since, filterPattern="?WARNING ?ERROR")
    for ev in page["events"]:
        text = re.sub(r"\s+", " ", ev["message"]).strip()
        text = re.sub(r"^\[\w+\]\s+\S+\s+\S+\s+", "", text)
        warns[text[:110]] += 1
    for text, n in warns.most_common(5):
        print(f"  x{n}: {text}")

    print(f"\n== janelas fechadas em {args.day} ==")
    meters = httpx.get(f"{api}/tenants/{args.tenant}/meters", headers=h, timeout=30).json()
    for meter in meters:
        mid = meter["meter_id"]
        ws = httpx.get(
            f"{api}/tenants/{args.tenant}/meters/{args.site}/{mid}/windows",
            params={"day": args.day},
            headers=h,
            timeout=30,
        ).json()
        ws.sort(key=lambda w: w["start"])
        cells = []
        for w in ws:
            start = datetime.fromisoformat(w["start"]).strftime("%H:%M")
            flag = "!" if w["exceeded"] else ""
            cells.append(f"{start}={w['demand_kw']:.1f}{flag}/{w['samples']}")
        print(f"{mid:<14} contratado {meter.get('contracted_kw')} kW  janelas {len(ws)}: {'  '.join(cells)}")
        st = httpx.get(f"{api}/tenants/{args.tenant}/meters/{args.site}/{mid}/state", headers=h, timeout=30).json()
        state = st.get("state") or {}
        if state.get("open"):
            opened = ", ".join(f"{w['start'][11:16]}({len(w['samples'])})" for w in state["open"])
            print(f"{'':<14} abertas: {opened}  projeção da mais recente {st['projected_kw']} kW")

    print("\n== alertas ==")
    alerts = httpx.get(f"{api}/tenants/{args.tenant}/alerts", params={"limit": 500}, headers=h, timeout=30).json()
    print(f"total: {len(alerts)}  " + "  ".join(f"{k}: {v}" for k, v in Counter(a["kind"] for a in alerts).items()))
    for a in sorted(alerts, key=lambda a: a["ts"])[:4]:
        print(f"  {a['ts'][5:16]} {a['meter_id']:<13} {a['kind']:<22} {a['message']}")

    print("\n== lake ==")
    prefix = f"leituras/tenant_id={args.tenant}/site_id={args.site}/"
    n = size = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=outs["lake_bucket"], Prefix=prefix):
        for obj in page.get("Contents", []):
            n += 1
            size += obj["Size"]
    print(f"arquivos: {n}  bytes: {size:,}  prefixo s3://{outs['lake_bucket']}/{prefix}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
