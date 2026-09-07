"""Configuração por variáveis de ambiente (prefixo ENERGIA_)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENERGIA_", env_file=".env", extra="ignore")

    repo: Literal["memory", "dynamodb"] = "memory"
    table_name: str = "energia-dev"
    event_bus: str = "energia-dev"
    lake_bucket: str | None = None
    admin_api_key: str = "dev-admin-key"
    # Notificações (Lambda notifier)
    sns_topic_arn: str | None = None
    whatsapp_token: str | None = None
    whatsapp_phone_id: str | None = None
    whatsapp_template: str = "alerta_energia"
    whatsapp_to: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
