"""Modelos do domínio.

Vocabulário (ver docs/DOMINIO-ENERGIA.md):
- Leitura: amostra instantânea do medidor (kW, kvar, FP...), enviada a cada N segundos.
- Janela de demanda: intervalo de 15 minutos alinhado ao relógio. A distribuidora fatura
  a maior média de potência em 15 minutos do mês, por posto tarifário.
- Posto tarifário: ponta (3 horas consecutivas definidas pela distribuidora, dias úteis)
  ou fora ponta.
- Modalidade: verde (uma demanda contratada) ou azul (demanda contratada por posto).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, date, datetime
from enum import Enum
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .window import Sample

ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"


class TariffModality(str, Enum):
    VERDE = "verde"
    AZUL = "azul"


class TariffPeriod(str, Enum):
    PONTA = "ponta"
    FORA_PONTA = "fora_ponta"


class AlertKind(str, Enum):
    ULTRAPASSAGEM = "ultrapassagem_demanda"
    PROJECAO = "projecao_demanda"
    FATOR_POTENCIA = "fator_potencia"
    MEDIDOR_OFFLINE = "medidor_offline"


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


def to_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        raise ValueError("timestamp precisa ter fuso horário; envie em UTC, ex.: 2026-09-04T12:00:00Z")
    return ts.astimezone(UTC)


def now_utc() -> datetime:
    return datetime.now(UTC)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_api_key() -> str:
    return "ek_" + secrets.token_urlsafe(32)


class MeterKey(BaseModel):
    model_config = ConfigDict(frozen=True)

    tenant_id: str = Field(pattern=ID_PATTERN)
    site_id: str = Field(pattern=ID_PATTERN)
    meter_id: str = Field(pattern=ID_PATTERN)

    @property
    def pk(self) -> str:
        return f"METER#{self.tenant_id}#{self.site_id}#{self.meter_id}"

    def __str__(self) -> str:
        return f"{self.tenant_id}/{self.site_id}/{self.meter_id}"


class Reading(BaseModel):
    """Uma amostra do medidor. Chega por MQTT (IoT Core) ou pelo endpoint HTTP de ingestão."""

    tenant_id: str = Field(pattern=ID_PATTERN)
    site_id: str = Field(pattern=ID_PATTERN)
    meter_id: str = Field(pattern=ID_PATTERN)
    ts: datetime = Field(description="instante da amostra, UTC")
    kw: float = Field(ge=0, description="potência ativa instantânea, kW")
    kvar: float = Field(default=0.0, description="potência reativa, kvar (positivo = indutivo)")
    kwh_total: float | None = Field(default=None, ge=0, description="registrador acumulado do medidor, kWh")
    v: float | None = Field(default=None, ge=0, description="tensão de linha média, V")
    a: float | None = Field(default=None, ge=0, description="corrente média, A")
    pf: float | None = Field(default=None, ge=-1, le=1, description="fator de potência")
    hz: float | None = Field(default=None, ge=0)
    seq: int | None = Field(default=None, ge=0, description="contador do gateway, para diagnóstico")

    @field_validator("ts")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return to_utc(v)

    @property
    def key(self) -> MeterKey:
        return MeterKey(tenant_id=self.tenant_id, site_id=self.site_id, meter_id=self.meter_id)


class TenantConfig(BaseModel):
    """Empresa cliente. Guarda o calendário tarifário e os parâmetros de alerta."""

    tenant_id: str = Field(pattern=ID_PATTERN)
    name: str
    tz: str = "America/Manaus"
    ponta_start: str = Field(default="18:00", pattern=r"^\d{2}:\d{2}$")
    ponta_end: str = Field(default="21:00", pattern=r"^\d{2}:\d{2}$")
    ponta_only_weekdays: bool = True
    holidays: list[date] = Field(default_factory=list)
    pf_reference: float = Field(default=0.92, gt=0, le=1)
    demand_tolerance: float = Field(default=0.05, ge=0, le=0.5, description="tolerância antes da ultrapassagem")
    projection_min_elapsed_s: int = Field(default=300, description="segundos de janela antes de projetar demanda")
    api_key_hash: str | None = None
    created_at: datetime = Field(default_factory=now_utc)

    @model_validator(mode="after")
    def _valid_calendar(self) -> TenantConfig:
        try:
            ZoneInfo(self.tz)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"fuso horário inválido: {self.tz}") from exc
        start_h, start_m = map(int, self.ponta_start.split(":"))
        end_h, end_m = map(int, self.ponta_end.split(":"))
        if start_h > 23 or end_h > 23 or start_m > 59 or end_m > 59:
            raise ValueError("horário de ponta precisa estar entre 00:00 e 23:59")
        if self.ponta_start == self.ponta_end:
            raise ValueError("início e fim do horário de ponta precisam ser diferentes")
        if not 60 <= self.projection_min_elapsed_s < 900:
            raise ValueError("projection_min_elapsed_s precisa estar entre 60 e 899")
        return self


class SiteConfig(BaseModel):
    tenant_id: str = Field(pattern=ID_PATTERN)
    site_id: str = Field(pattern=ID_PATTERN)
    name: str
    distributor: str = "Amazonas Energia"
    created_at: datetime = Field(default_factory=now_utc)


class MeterConfig(BaseModel):
    tenant_id: str = Field(pattern=ID_PATTERN)
    site_id: str = Field(pattern=ID_PATTERN)
    meter_id: str = Field(pattern=ID_PATTERN)
    name: str
    line: str | None = Field(default=None, description="linha, setor ou máquina que o medidor cobre")
    modality: TariffModality = TariffModality.VERDE
    contracted_kw: float | None = Field(default=None, gt=0, description="demanda contratada (verde)")
    contracted_kw_ponta: float | None = Field(default=None, gt=0, description="demanda contratada na ponta (azul)")
    contracted_kw_fora_ponta: float | None = Field(
        default=None, gt=0, description="demanda contratada fora ponta (azul)"
    )
    sample_interval_s: int = Field(default=10, ge=1, le=300)
    created_at: datetime = Field(default_factory=now_utc)

    @model_validator(mode="after")
    def _valid_contract(self) -> MeterConfig:
        if self.modality == TariffModality.AZUL and (
            self.contracted_kw_ponta is None or self.contracted_kw_fora_ponta is None
        ):
            raise ValueError("modalidade azul exige contracted_kw_ponta e contracted_kw_fora_ponta")
        return self

    @property
    def key(self) -> MeterKey:
        return MeterKey(tenant_id=self.tenant_id, site_id=self.site_id, meter_id=self.meter_id)

    def contracted_for(self, period: TariffPeriod) -> float | None:
        if self.modality == TariffModality.VERDE:
            return self.contracted_kw
        if period == TariffPeriod.PONTA:
            return self.contracted_kw_ponta
        return self.contracted_kw_fora_ponta


class OpenWindow(BaseModel):
    """Janela ainda não fechada: amostras recebidas e o instante (relógio da nuvem) em que vimos a
    primeira leitura posterior ao fim dela. A janela fecha GRACE depois desse instante."""

    start: datetime
    samples: list[Sample] = Field(default_factory=list)
    beyond_seen_at: datetime | None = None

    @property
    def last_sample(self) -> Sample | None:
        return max(self.samples, key=lambda s: s.o) if self.samples else None

    @property
    def first_sample(self) -> Sample | None:
        return min(self.samples, key=lambda s: s.o) if self.samples else None


class MeterState(BaseModel):
    """Estado operacional de um medidor. Um item no DynamoDB, atualizado a cada leitura.

    Guarda as janelas abertas (normalmente uma ou duas; numa rajada de reenvio, algumas) com suas
    amostras. A energia é calculada no fechamento (ver domain/window.py), então a ordem de chegada
    não importa, e a carência é em tempo de relógio da nuvem, então a velocidade da rajada também não.
    """

    key: MeterKey
    last_ts: datetime | None = Field(default=None, description="maior timestamp já visto")
    last_ingested_at: datetime | None = Field(default=None, description="relógio da nuvem da última ingestão")
    anchor: Sample | None = Field(
        default=None, description="última amostra da janela fechada antes da mais antiga aberta, no frame dela"
    )
    open: list[OpenWindow] = Field(default_factory=list, description="ordenadas por início")
    closed_before: datetime | None = Field(
        default=None, description="janelas com início anterior a isto já fecharam; leitura delas é descartada"
    )
    projection_alerted_window: datetime | None = None
    pf_alert_hour: str | None = None
    offline_alerted_at: datetime | None = None
    version: int = 0

    @property
    def current(self) -> OpenWindow | None:
        """A janela mais recente aberta: é sobre ela que se projeta demanda."""
        return self.open[-1] if self.open else None


class DemandWindow(BaseModel):
    """Janela de 15 minutos fechada. É o grão que a distribuidora fatura."""

    key: MeterKey
    start: datetime
    end: datetime
    period: TariffPeriod
    kwh: float
    kvarh: float
    demand_kw: float
    max_kw: float
    samples: int
    pf_avg: float | None = None
    contracted_kw: float | None = None
    exceeded: bool = False


class MonthRollup(BaseModel):
    """Consolidado mensal por medidor: o que aparece na fatura."""

    key: MeterKey
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    max_demand_kw: dict[str, float] = Field(default_factory=dict)
    max_demand_at: dict[str, datetime] = Field(default_factory=dict)
    kwh: dict[str, float] = Field(default_factory=dict)
    windows: int = 0
    exceeded_windows: int = 0
    pf_below_windows: int = 0

    def apply(self, w: DemandWindow, pf_reference: float) -> None:
        p = w.period.value
        self.kwh[p] = self.kwh.get(p, 0.0) + w.kwh
        if w.demand_kw > self.max_demand_kw.get(p, 0.0):
            self.max_demand_kw[p] = w.demand_kw
            self.max_demand_at[p] = w.start
        self.windows += 1
        if w.exceeded:
            self.exceeded_windows += 1
        if w.pf_avg is not None and abs(w.pf_avg) < pf_reference:
            self.pf_below_windows += 1


class Alert(BaseModel):
    id: str
    tenant_id: str
    site_id: str
    meter_id: str
    ts: datetime
    kind: AlertKind
    severity: Severity
    message: str
    data: dict = Field(default_factory=dict)

    @classmethod
    def for_meter(cls, key: MeterKey, ts: datetime, kind: AlertKind, severity: Severity, message: str, **data) -> Alert:
        identity = f"{key.pk}|{to_utc(ts).isoformat()}|{kind.value}"
        return cls(
            id=hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32],
            tenant_id=key.tenant_id,
            site_id=key.site_id,
            meter_id=key.meter_id,
            ts=ts,
            kind=kind,
            severity=severity,
            message=message,
            data=data,
        )
