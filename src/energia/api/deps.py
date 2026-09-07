"""Dependências da API: repositório, sink e autenticação por chave."""

from __future__ import annotations

import secrets

from fastapi import Depends, Header, HTTPException, Request, status

from ..domain.models import TenantConfig, hash_api_key
from ..ports import EventSink, StateRepository


def get_repo(request: Request) -> StateRepository:
    return request.app.state.repo


def get_sink(request: Request) -> EventSink:
    return request.app.state.sink


def require_admin(request: Request, x_admin_key: str = Header(alias="X-Admin-Key")) -> None:
    expected: str = request.app.state.settings.admin_api_key
    if not secrets.compare_digest(x_admin_key.encode(), expected.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "chave de administração inválida")


def require_tenant(
    tenant_id: str,
    x_api_key: str = Header(alias="X-API-Key"),
    repo: StateRepository = Depends(get_repo),
) -> TenantConfig:
    tenant = repo.get_tenant(tenant_id)
    if tenant is None or tenant.api_key_hash is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "cliente ou chave inválidos")
    if not secrets.compare_digest(hash_api_key(x_api_key), tenant.api_key_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "cliente ou chave inválidos")
    return tenant
