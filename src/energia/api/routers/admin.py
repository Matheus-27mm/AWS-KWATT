"""Rotas de administração (chave X-Admin-Key): criar cliente e girar chave de API."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ...domain.models import ID_PATTERN, TenantConfig, hash_api_key, new_api_key
from ...ports import StateRepository
from ..deps import get_repo, require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class TenantIn(BaseModel):
    tenant_id: str = Field(pattern=ID_PATTERN)
    name: str
    tz: str = "America/Manaus"
    ponta_start: str = "18:00"
    ponta_end: str = "21:00"
    ponta_only_weekdays: bool = True
    holidays: list[date] = Field(default_factory=list)
    pf_reference: float = 0.92
    demand_tolerance: float = 0.05


class TenantCreated(BaseModel):
    tenant: TenantConfig
    api_key: str = Field(description="mostrada uma única vez; guarde no gateway e no painel")


@router.post("/tenants", response_model=TenantCreated, status_code=status.HTTP_201_CREATED)
def create_tenant(body: TenantIn, repo: StateRepository = Depends(get_repo)) -> TenantCreated:
    if repo.get_tenant(body.tenant_id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "cliente já existe")
    key = new_api_key()
    tenant = TenantConfig(**body.model_dump(), api_key_hash=hash_api_key(key))
    repo.put_tenant(tenant)
    return TenantCreated(tenant=tenant, api_key=key)


@router.post("/tenants/{tenant_id}/rotate-key", response_model=TenantCreated)
def rotate_key(tenant_id: str, repo: StateRepository = Depends(get_repo)) -> TenantCreated:
    tenant = repo.get_tenant(tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "cliente não encontrado")
    key = new_api_key()
    tenant.api_key_hash = hash_api_key(key)
    repo.put_tenant(tenant)
    return TenantCreated(tenant=tenant, api_key=key)
