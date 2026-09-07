"""Aplicação FastAPI. Roda igual no Lambda (Mangum) e local (uvicorn)."""

from __future__ import annotations

from fastapi import FastAPI

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

    app.include_router(admin.router)
    app.include_router(tenants.router)
    app.include_router(meters.router)
    app.include_router(ingest.router)

    @app.get("/health", tags=["infra"])
    def health() -> dict:
        return {"status": "ok", "version": __version__, "repo": settings.repo}

    return app
