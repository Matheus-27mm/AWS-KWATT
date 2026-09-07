"""Publica eventos de domínio no barramento EventBridge do projeto."""

from __future__ import annotations

import json
from typing import Any

import boto3


class EventBridgeSink:
    SOURCE = "energia"

    def __init__(self, bus_name: str, client: Any | None = None) -> None:
        self._bus = bus_name
        self._client = client or boto3.client("events")

    def emit(self, detail_type: str, detail: dict) -> None:
        response = self._client.put_events(
            Entries=[
                {
                    "Source": self.SOURCE,
                    "DetailType": detail_type,
                    "Detail": json.dumps(detail, default=str),
                    "EventBusName": self._bus,
                }
            ]
        )
        if response.get("FailedEntryCount", 0):
            entry = response.get("Entries", [{}])[0]
            raise RuntimeError(f"EventBridge rejeitou evento: {entry.get('ErrorCode')} {entry.get('ErrorMessage')}")
