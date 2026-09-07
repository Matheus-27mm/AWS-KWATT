from datetime import timedelta

from fastapi.testclient import TestClient

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.api.app import create_app
from energia.config import Settings
from tests.conftest import utc

ADMIN = {"X-Admin-Key": "admin-test"}


def _client() -> TestClient:
    settings = Settings(repo="memory", admin_api_key="admin-test", _env_file=None)
    return TestClient(create_app(MemoryRepository(), MemorySink(), settings))


class _Clock:
    """Substitui datetime no processador para controlar o relógio da nuvem nos testes da API."""

    now_value = utc(2026, 9, 4, 12, 20)

    @classmethod
    def now(cls, tz=None):
        return cls.now_value


def test_fluxo_completo_cadastro_ingestao_consulta(monkeypatch):
    monkeypatch.setattr("energia.services.processor.datetime", _Clock)
    c = _client()
    assert c.get("/health").json()["status"] == "ok"

    r = c.post("/admin/tenants", json={"tenant_id": "acme", "name": "ACME"}, headers=ADMIN)
    assert r.status_code == 201, r.text
    key = r.json()["api_key"]
    assert key.startswith("ek_")
    h = {"X-API-Key": key}

    assert c.post("/tenants/acme/sites", json={"site_id": "fabrica", "name": "Fábrica"}, headers=h).status_code == 201
    body = {"site_id": "fabrica", "meter_id": "linha-1", "name": "Linha 1", "contracted_kw": 100}
    assert c.post("/tenants/acme/meters", json=body, headers=h).status_code == 201

    start = utc(2026, 9, 4, 12, 0)
    readings = [
        {
            "tenant_id": "acme",
            "site_id": "fabrica",
            "meter_id": "linha-1",
            "ts": (start + timedelta(seconds=10 * i)).isoformat().replace("+00:00", "Z"),
            "kw": 120,
            "pf": 0.95,
        }
        for i in range(6 * 20)  # 20 min: fecha a janela 12:00 (carência de 60 s depois das 12:15)
    ]
    r = c.post("/tenants/acme/ingest", json=readings, headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["accepted"] == 120
    # carga em lote: tudo chegou "no mesmo instante", então a carência ainda não correu e nada fechou
    assert out["closed_windows"] == 0
    assert {a["kind"] for a in out["alerts"]} == {"projecao_demanda"}

    # 61 s depois no relógio da nuvem, mais uma leitura fecha a janela das 12:00
    _Clock.now_value = utc(2026, 9, 4, 12, 21, 1)
    extra = dict(readings[-1], ts="2026-09-04T12:20:00Z")
    out = c.post("/tenants/acme/ingest", json=[extra], headers=h).json()
    assert out["closed_windows"] == 1
    # fecha a das 12:00 (ultrapassagem) e, aos 5 min da janela das 12:15, projeta a próxima
    assert {a["kind"] for a in out["alerts"]} == {"ultrapassagem_demanda", "projecao_demanda"}

    r = c.get("/tenants/acme/meters/fabrica/linha-1/state", headers=h)
    assert r.status_code == 200
    st = r.json()
    assert st["contracted_kw_now"] == 100
    assert len(st["state"]["open"]) >= 1
    assert len(st["state"]["open"][-1]["samples"]) > 0

    r = c.get("/tenants/acme/meters/fabrica/linha-1/windows", params={"day": "2026-09-04"}, headers=h)
    assert len(r.json()) == 1
    assert abs(r.json()[0]["demand_kw"] - 120) < 0.05

    r = c.get("/tenants/acme/meters/fabrica/linha-1/months/2026-09", headers=h)
    assert r.json()["exceeded_windows"] == 1

    assert len(c.get("/tenants/acme/alerts", headers=h).json()) >= 2


def test_chaves_erradas_sao_rejeitadas():
    c = _client()
    assert (
        c.post("/admin/tenants", json={"tenant_id": "x", "name": "X"}, headers={"X-Admin-Key": "nope"}).status_code
        == 401
    )
    c.post("/admin/tenants", json={"tenant_id": "acme", "name": "ACME"}, headers=ADMIN)
    assert c.get("/tenants/acme", headers={"X-API-Key": "ek_errada"}).status_code == 401
    assert c.get("/tenants/outro", headers={"X-API-Key": "ek_errada"}).status_code == 401


def test_ingestao_de_outro_cliente_e_proibida():
    c = _client()
    key = c.post("/admin/tenants", json={"tenant_id": "acme", "name": "ACME"}, headers=ADMIN).json()["api_key"]
    reading = {"tenant_id": "rival", "site_id": "s", "meter_id": "m", "ts": "2026-09-04T12:00:00Z", "kw": 1}
    assert c.post("/tenants/acme/ingest", json=[reading], headers={"X-API-Key": key}).status_code == 403
