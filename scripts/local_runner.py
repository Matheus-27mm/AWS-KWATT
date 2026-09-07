"""Roda a pipeline inteira em memória: simulador -> processador -> janelas, consolidado e alertas.

Nada de AWS. Serve para ver o comportamento do domínio antes de gastar um centavo.

  python scripts/local_runner.py --hours 24
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from simulator.simulate import default_profiles, generate

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.domain.models import MeterConfig, SiteConfig, TenantConfig
from energia.services.processor import process_reading

# Contratos calibrados para o perfil do simulador: injetoras só estouram na ponta, compressores
# encostam no limite de dia, climatização fica folgada.
CONTRACTED = {"injetoras": 115.0, "compressores": 57.0, "climatizacao": 50.0, "extrusoras": 90.0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--interval", type=int, default=10)
    ap.add_argument("--meters", type=int, default=3)
    ap.add_argument("--start", default="2026-09-03T04:00:00Z", help="UTC; padrão = 00:00 de quinta em Manaus")
    args = ap.parse_args()

    repo, sink = MemoryRepository(), MemorySink()
    tenant = TenantConfig(tenant_id="demo", name="Demo Plásticos", api_key_hash="local")
    repo.put_tenant(tenant)
    repo.put_site(SiteConfig(tenant_id="demo", site_id="fabrica", name="Fábrica Distrito"))
    profiles = default_profiles("demo", "fabrica", args.meters)
    meters = {}
    for p in profiles:
        m = MeterConfig(
            tenant_id="demo",
            site_id="fabrica",
            meter_id=p.meter_id,
            name=p.meter_id.title(),
            contracted_kw=CONTRACTED[p.meter_id],
        )
        repo.put_meter(m)
        meters[p.meter_id] = m

    start = datetime.fromisoformat(args.start).astimezone(UTC)
    end = start + timedelta(hours=args.hours)
    t0 = time.perf_counter()
    n = accepted = 0
    for reading in generate(profiles, start, end, args.interval):
        n += 1
        # relógio da nuvem = timestamp da leitura: simula fluxo em tempo real, não uma rajada
        if process_reading(reading, meters[reading.meter_id], tenant, repo, sink, now=reading.ts).accepted:
            accepted += 1
    elapsed = time.perf_counter() - t0

    print(f"leituras: {n} (aceitas {accepted}) em {elapsed:.1f}s -> {n / max(elapsed, 1e-6):,.0f} leituras/s")
    print()
    header = f"{'medidor':<14}{'contratado':>11}{'janelas':>9}{'max fora':>10}{'max ponta':>11}"
    print(header + f"{'kWh':>10}{'ultrap.':>9}{'FP<ref':>8}")
    for meter_id, m in meters.items():
        months = [r for (pk, _), r in repo.months.items() if pk == m.key.pk]
        windows = sum(r.windows for r in months)
        max_fora = max((r.max_demand_kw.get("fora_ponta", 0) for r in months), default=0)
        max_ponta = max((r.max_demand_kw.get("ponta", 0) for r in months), default=0)
        kwh = sum(sum(r.kwh.values()) for r in months)
        exceeded = sum(r.exceeded_windows for r in months)
        pf_below = sum(r.pf_below_windows for r in months)
        print(
            f"{meter_id:<14}{m.contracted_kw:>11.0f}{windows:>9}{max_fora:>10.1f}{max_ponta:>11.1f}"
            f"{kwh:>10.0f}{exceeded:>9}{pf_below:>8}"
        )

    alerts = repo.alerts["demo"]
    print()
    print("alertas por tipo:", dict(Counter(a.kind.value for a in alerts)))
    print("eventos emitidos:", dict(Counter(t for t, _ in sink.events)))
    print()
    for a in sorted(alerts, key=lambda a: a.ts)[:6]:
        print(f"  {a.ts:%d/%m %H:%M} UTC  {a.meter_id:<13} {a.kind.value:<22} {a.message}")


if __name__ == "__main__":
    main()
