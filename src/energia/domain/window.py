"""Janela de demanda como conjunto de amostras, independente da ordem de chegada.

A fila SQS padrão pode entregar fora de ordem. Em vez de integrar energia a cada amostra que chega,
o estado guarda as amostras da janela aberta (offset em segundos, kW, kvar, FP) e a energia é
calculada pelo trapézio sobre as amostras ordenadas quando a janela fecha. Qualquer permutação de
chegada em que cada amostra atrase menos que GRACE produz exatamente a mesma janela.

Bordas: o trecho entre o início da janela e a primeira amostra usa a última amostra da janela
anterior (âncora); o trecho entre a última amostra e o fim usa a primeira amostra da janela
seguinte. Sem vizinho de um lado, aquele trecho fica sem energia: não inventamos dado.
"""

from __future__ import annotations

from datetime import timedelta
from itertools import pairwise

from pydantic import BaseModel

WINDOW = timedelta(minutes=15)
WINDOW_SECONDS = int(WINDOW.total_seconds())

GRACE = timedelta(seconds=60)
"""Uma janela fecha este tempo (relógio da nuvem) depois de vermos a primeira leitura posterior ao fim dela.
Em fluxo normal isso é ~70 s depois do fim da janela. Numa rajada de reenvio, é 60 s depois de a rajada
passar por ela, tempo de sobra para as leituras atrasadas dos outros lotes chegarem."""

MAX_OPEN = 8
"""Teto de janelas abertas por medidor; acima disso a mais antiga fecha sem esperar a carência."""


class Sample(BaseModel):
    o: int
    """offset em segundos desde o início da janela; negativo para a âncora da janela anterior"""
    kw: float
    kvar: float = 0.0
    pf: float | None = None


def _trapezoid(a: Sample, b: Sample) -> tuple[float, float]:
    secs = b.o - a.o
    if secs <= 0:
        return 0.0, 0.0
    return ((a.kw + b.kw) / 2.0) * secs / 3600.0, ((a.kvar + b.kvar) / 2.0) * secs / 3600.0


def _interpolate(a: Sample, b: Sample, o: int) -> Sample:
    if b.o == a.o:
        return Sample(o=o, kw=a.kw, kvar=a.kvar)
    t = (o - a.o) / (b.o - a.o)
    return Sample(o=o, kw=a.kw + (b.kw - a.kw) * t, kvar=a.kvar + (b.kvar - a.kvar) * t)


def integrate(
    samples: list[Sample],
    anchor: Sample | None = None,
    next_first: Sample | None = None,
    until: int | None = None,
) -> tuple[float, float]:
    """Energia (kWh, kvarh) da janela a partir das amostras.

    `anchor` e `next_first` estão no frame desta janela: offset negativo para a âncora, offset >= 900
    para a primeira amostra da janela seguinte (que pode não ser a adjacente).
    `until`: limite superior em segundos (padrão: fim da janela). Para projeção, passe o offset da
    última amostra para obter só a energia até ali.
    """
    end = WINDOW_SECONDS if until is None else until
    ordered = sorted((s for s in samples if s.o <= end), key=lambda s: s.o)
    if not ordered:
        return 0.0, 0.0
    points: list[Sample] = []
    if anchor is not None and ordered[0].o > 0:
        points.append(_interpolate(anchor, ordered[0], 0))
    points.extend(ordered)
    if next_first is not None and ordered[-1].o < end:
        points.append(_interpolate(ordered[-1], next_first, end))
    kwh = kvarh = 0.0
    for a, b in pairwise(points):
        e, r = _trapezoid(a, b)
        kwh += e
        kvarh += r
    return kwh, kvarh


def pf_average(samples: list[Sample]) -> float | None:
    values = [abs(s.pf) for s in samples if s.pf is not None]
    if not values:
        return None
    return sum(values) / len(values)
