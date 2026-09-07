"""Camada bruta do lake: cada lote de leituras vira um arquivo JSON Lines comprimido no S3.

Substitui o Firehose, que o plano gratuito da AWS bloqueia. O caminho segue o padrão Hive que o
Glue e o Athena entendem por projeção de partições:

    leituras/tenant_id={t}/site_id={s}/dt={AAAA-MM-DD}/{primeiro ts}-{hash}.jsonl.gz

Um lote SQS de até 100 leituras vira um objeto por partição tocada. Com 3 medidores a 10 s isso
dá um arquivo a cada ~5 min por unidade. É a camada bruta: se o SQS reentregar um lote, o mesmo
a chave determinística evita duplicar uma redelivery idêntica. Leituras repetidas entre lotes
diferentes ainda exigem deduplicação por (meter_id, ts) em consultas exatas.
"""

from __future__ import annotations

import gzip
import hashlib
import io
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

import boto3

from ..domain.models import Reading

LAKE_COLUMNS = ("meter_id", "ts", "kw", "kvar", "kwh_total", "v", "a", "pf", "hz", "seq")


def partition_key(reading: Reading) -> str:
    return f"leituras/tenant_id={reading.tenant_id}/site_id={reading.site_id}/dt={reading.ts:%Y-%m-%d}/"


def encode_batch(readings: Iterable[Reading]) -> dict[str, bytes]:
    """Agrupa por partição e devolve {prefixo: conteúdo gzip} pronto para gravar."""
    groups: dict[str, list[Reading]] = defaultdict(list)
    for r in readings:
        groups[partition_key(r)].append(r)
    out: dict[str, bytes] = {}
    for prefix, items in groups.items():
        items.sort(key=lambda r: r.ts)
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
            for r in items:
                line = r.model_dump_json(include=set(LAKE_COLUMNS), exclude_none=True)
                gz.write(line.encode("utf-8"))
                gz.write(b"\n")
        first = items[0].ts.strftime("%Y%m%dT%H%M%SZ")
        body = buf.getvalue()
        digest = hashlib.sha256(body).hexdigest()[:16]
        out[f"{prefix}{first}-{digest}.jsonl.gz"] = body
    return out


class S3Lake:
    def __init__(self, bucket: str, client: Any | None = None) -> None:
        self._bucket = bucket
        self._s3 = client or boto3.client("s3")

    def write_batch(self, readings: Iterable[Reading]) -> list[str]:
        keys: list[str] = []
        for key, body in encode_batch(readings).items():
            self._s3.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=body,
                ContentType="application/x-ndjson",
                ContentEncoding="gzip",
            )
            keys.append(key)
        return keys


class MemoryLake:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def write_batch(self, readings: Iterable[Reading]) -> list[str]:
        encoded = encode_batch(readings)
        self.objects.update(encoded)
        return list(encoded)
