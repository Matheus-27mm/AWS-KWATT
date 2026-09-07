import gzip
import json
from datetime import timedelta

from energia.adapters.lake import MemoryLake, encode_batch
from energia.domain.models import Reading
from tests.conftest import utc


def _reading(meter: str, ts, site: str = "fabrica", **kw) -> Reading:
    return Reading(tenant_id="acme", site_id=site, meter_id=meter, ts=ts, kw=kw.get("kw", 10.0), pf=kw.get("pf"))


def test_lote_vira_um_arquivo_por_particao_em_ordem_cronologica():
    t0 = utc(2026, 9, 7, 3, 59, 50)  # 23:59:50 do dia 6 em Manaus, mas o lake particiona em UTC
    readings = [
        _reading("a", t0 + timedelta(seconds=10)),
        _reading("a", t0),
        _reading("b", t0 + timedelta(seconds=20)),
        _reading("a", utc(2026, 9, 8, 12, 0), site="deposito"),
    ]
    encoded = encode_batch(readings)
    assert len(encoded) == 2
    keys = sorted(encoded)
    assert keys[0].startswith("leituras/tenant_id=acme/site_id=deposito/dt=2026-09-08/20260908T120000Z-")
    assert keys[1].startswith("leituras/tenant_id=acme/site_id=fabrica/dt=2026-09-07/20260907T035950Z-")
    assert all(k.endswith(".jsonl.gz") for k in keys)

    lines = gzip.decompress(encoded[keys[1]]).decode().splitlines()
    rows = [json.loads(line) for line in lines]
    assert [r["meter_id"] for r in rows] == ["a", "a", "b"]
    assert rows[0]["ts"] == "2026-09-07T03:59:50Z"
    assert "tenant_id" not in rows[0]  # partição vem do caminho, não do conteúdo
    assert "pf" not in rows[0]  # None é omitido; o JSON SerDe do Athena lê como NULL


def test_memory_lake_acumula_objetos():
    lake = MemoryLake()
    keys = lake.write_batch([_reading("a", utc(2026, 9, 7, 12, 0))])
    assert len(keys) == 1
    assert keys[0] in lake.objects
    assert lake.write_batch([]) == []


def test_mesmo_lote_gera_chave_deterministica():
    readings = [_reading("a", utc(2026, 9, 7, 12, 0)), _reading("a", utc(2026, 9, 7, 12, 0, 10))]
    assert encode_batch(readings) == encode_batch(reversed(readings))
