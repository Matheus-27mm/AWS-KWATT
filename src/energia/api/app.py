"""Aplicação FastAPI. Roda igual no Lambda (Mangum) e local (uvicorn)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__
from ..config import Settings, get_settings
from ..ports import EventSink, StateRepository
from .routers import admin, ingest, meters, tenants


def _build_repo(settings: Settings) -> StateRepository:
    if settings.repo == "dynamodb":
        from ..adapters.dynamodb import DynamoRepository

        return DynamoRepository(settings.table_name)
    from ..adapters.memory import MemoryRepository

    return MemoryRepository()


def _build_sink(settings: Settings) -> EventSink:
    if settings.repo == "dynamodb":
        from ..adapters.eventbridge import EventBridgeSink

        return EventBridgeSink(settings.event_bus)
    from ..adapters.memory import MemorySink

    return MemorySink()


def create_app(
    repo: StateRepository | None = None,
    sink: EventSink | None = None,
    settings: Settings | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="Energia Industrial",
        version=__version__,
        description="Medição de energia por linha e turno, janelas de demanda de 15 minutos e alertas.",
    )
    app.state.settings = settings
    app.state.repo = repo or _build_repo(settings)
    app.state.sink = sink or _build_sink(settings)

    # O painel roda no navegador e chama a API com a chave do cliente no cabeçalho.
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["X-API-Key", "X-Admin-Key", "Content-Type"],
        max_age=600,
    )

    app.include_router(admin.router)
    app.include_router(tenants.router)
    app.include_router(meters.router)
    app.include_router(ingest.router)

    @app.get("/health", tags=["infra"])
    def health() -> dict:
        return {"status": "ok", "version": __version__, "repo": settings.repo}

    return app
