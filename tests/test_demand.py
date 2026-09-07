import pytest

from energia.domain.demand import demand_kw, energy_kwh, projected_demand_kw


def test_energia_trapezio():
    assert energy_kwh(100, 100, 3600) == pytest.approx(100.0)
    assert energy_kwh(100, 200, 1800) == pytest.approx(75.0)
    assert energy_kwh(100, 100, 0) == 0.0
    assert energy_kwh(100, 100, -5) == 0.0


def test_demanda_e_energia_da_janela_dividida_por_quarto_de_hora():
    assert demand_kw(25.0) == pytest.approx(100.0)


def test_projecao_precisa_de_um_minuto():
    assert projected_demand_kw(10.0, 30) is None
    assert projected_demand_kw(10.0, 300) == pytest.approx(120.0)
