"""Lambda da API: FastAPI atrás do API Gateway HTTP API via Mangum."""

from __future__ import annotations

from mangum import Mangum

from ..api.app import create_app

app = create_app()
handler = Mangum(app, lifespan="off")
