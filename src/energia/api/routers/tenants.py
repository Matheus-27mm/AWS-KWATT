"""Cadastro do cliente: unidades, medidores e alertas."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from ...domain.models import ID_PATTERN, Alert, MeterConfig, SiteConfig, TariffModality, TenantConfig
from ...ports import StateRepository
from ..deps import get_repo, require_tenant

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["cadastro"])


class SiteIn(BaseModel):
    site_id: str = Field(pattern=ID_PATTERN)
    name: str
    distributor: str = "Amazonas Energia"


class MeterIn(BaseModel):
    site_id: str = Field(pattern=ID_PATTERN)
    meter_id: str = Field(pattern=ID_PATTERN)
    name: str
    line: str | None = None
    modality: TariffModality = TariffModality.VERDE
    contracted_kw: float | None = Field(default=None, gt=0)
    contracted_kw_ponta: float | None = Field(default=None, gt=0)
    contracted_kw_fora_ponta: float | None = Field(default=None, gt=0)
    sample_interval_s: int = Field(default=10, ge=1, le=300)


@router.get("", response_model=TenantConfig, response_model_exclude={"api_key_hash"})
def get_tenant(tenant: TenantConfig = Depends(require_tenant)) -> TenantConfig:
    return tenant


@router.post("/sites", response_model=SiteConfig, status_code=status.HTTP_201_CREATED)
def create_site(
    body: SiteIn, tenant: TenantConfig = Depends(require_tenant), repo: StateRepository = Depends(get_repo)
) -> SiteConfig:
    site = SiteConfig(tenant_id=tenant.tenant_id, **body.model_dump())
    repo.put_site(site)
    return site


@router.get("/sites", response_model=list[SiteConfig])
def list_sites(tenant: TenantConfig = Depends(require_tenant), repo: StateRepository = Depends(get_repo)):
    return repo.list_sites(tenant.tenant_id)


@router.post("/meters", response_model=MeterConfig, status_code=status.HTTP_201_CREATED)
def create_meter(
    body: MeterIn, tenant: TenantConfig = Depends(require_tenant), repo: StateRepository = Depends(get_repo)
) -> MeterConfig:
    meter = MeterConfig(tenant_id=tenant.tenant_id, **body.model_dump())
    repo.put_meter(meter)
    return meter


@router.get("/meters", response_model=list[MeterConfig])
def list_meters(tenant: TenantConfig = Depends(require_tenant), repo: StateRepository = Depends(get_repo)):
    return repo.list_meters(tenant.tenant_id)


@router.get("/alerts", response_model=list[Alert])
def list_alerts(
    limit: int = Query(default=50, ge=1, le=500),
    tenant: TenantConfig = Depends(require_tenant),
    repo: StateRepository = Depends(get_repo),
):
    return repo.list_alerts(tenant.tenant_id, limit=limit)
