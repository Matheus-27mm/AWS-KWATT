"""Aritmética de demanda.

A distribuidora mede energia acumulada em cada intervalo de 15 minutos e divide por 0,25 h.
Aqui reconstruímos isso a partir de amostras de potência: energia entre duas amostras é a média
das duas potências vezes o intervalo (regra do trapézio). Com amostra a cada 10 s o erro é
desprezível frente à incerteza do próprio medidor.
"""

from __future__ import annotations

from datetime import timedelta

from .tariff import WINDOW_SECONDS

MAX_GAP = timedelta(minutes=30)
"""Acima disso não se integra energia entre amostras: o medidor ficou mudo e não sabemos o que houve."""


def energy_kwh(kw_a: float, kw_b: float, seconds: float) -> float:
    if seconds <= 0:
        return 0.0
    return ((kw_a + kw_b) / 2.0) * (seconds / 3600.0)


def demand_kw(kwh: float, window_seconds: int = WINDOW_SECONDS) -> float:
    return kwh / (window_seconds / 3600.0)


def projected_demand_kw(window_kwh: float, elapsed_seconds: float) -> float | None:
    """Demanda que a janela fechará se a potência média se mantiver. None se cedo demais para dizer."""
    if elapsed_seconds < 60:
        return None
    return window_kwh / (elapsed_seconds / 3600.0)
