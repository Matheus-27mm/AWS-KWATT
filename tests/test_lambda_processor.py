import json

from energia.adapters.memory import MemoryRepository, MemorySink
from energia.domain.models import Reading
from energia.lambdas import processor
from tests.conftest import utc


class FailingLake:
    def write_batch(self, readings):
        raise RuntimeError("S3 indisponível")


def test_falha_no_lake_reentrega_e_nao_altera_estado(monkeypatch, tenant, meter):
    repo = MemoryRepository()
    repo.put_tenant(tenant)
    repo.put_meter(meter)
    monkeypatch.setattr(processor, "_deps", lambda: (repo, MemorySink(), FailingLake()))
    monkeypatch.setattr(processor, "_cache", {})
    reading = Reading(
        tenant_id="acme", site_id="fabrica", meter_id="linha-1", ts=utc(2026, 9, 7, 12), kw=50
    )
    event = {"Records": [{"messageId": "msg-1", "body": json.dumps(reading.model_dump(mode="json"))}]}

    assert processor.handler(event, None) == {"batchItemFailures": [{"itemIdentifier": "msg-1"}]}
    assert repo.get_state(meter.key) is None
