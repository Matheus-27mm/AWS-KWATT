"""Ingestão por HTTP, para gateways sem MQTT ou para carga de histórico. Mesmo processador do Lambda."""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ...domain.models import Alert, Reading, TenantConfig
from ...ports import EventSink, StateRepository
from ...services.processor import process_batch_with_retry
from ..deps import get_repo, get_sink, require_tenant

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["ingestão"])


class IngestResult(BaseModel):
    accepted: int = 0
    rejected: int = 0
    unknown_meters: int = 0
    closed_windows: int = 0
    alerts: list[Alert] = Field(default_factory=list)


@router.post("/ingest", response_model=IngestResult)
def ingest(
    readings: list[Reading],
    tenant: TenantConfig = Depends(require_tenant),
    repo: StateRepository = Depends(get_repo),
    sink: EventSink = Depends(get_sink),
) -> IngestResult:
    if len(readings) > 1000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "no máximo 1000 leituras por chamada")
    out = IngestResult()
    groups: dict[str, list[Reading]] = defaultdict(list)
    for reading in readings:
        if reading.tenant_id != tenant.tenant_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "leitura de outro cliente")
        groups[reading.key.pk].append(reading)
    # um grupo por medidor: uma leitura e uma gravação de estado, como no Lambda
    for items in groups.values():
        meter = repo.get_meter(items[0].key)
        if meter is None:
            out.unknown_meters += len(items)
            continue
        batch = process_batch_with_retry(items, meter, tenant, repo, sink)
        if batch.conflict:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "conflito persistente; tente de novo")
        out.accepted += batch.accepted
        out.rejected += len(items) - batch.accepted
        out.closed_windows += len(batch.closed_windows)
        out.alerts.extend(batch.alerts)
    return out
