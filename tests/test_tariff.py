from datetime import date

from energia.domain.models import TariffPeriod, TenantConfig
from energia.domain.tariff import month_key, period_for, window_start
from tests.conftest import utc


def _tenant(**kw) -> TenantConfig:
    return TenantConfig(tenant_id="acme", name="ACME", **kw)


def test_sexta_18h30_manaus_e_ponta():
    # 2026-09-04 é sexta; 18:30 em Manaus = 22:30 UTC
    assert period_for(utc(2026, 9, 4, 22, 30), _tenant()) == TariffPeriod.PONTA


def test_limites_da_ponta():
    assert period_for(utc(2026, 9, 4, 22, 0), _tenant()) == TariffPeriod.PONTA  # 18:00 local
    assert period_for(utc(2026, 9, 4, 21, 59), _tenant()) == TariffPeriod.FORA_PONTA  # 17:59 local
    assert period_for(utc(2026, 9, 5, 1, 0), _tenant()) == TariffPeriod.FORA_PONTA  # 21:00 local


def test_sabado_e_fora_ponta():
    assert period_for(utc(2026, 9, 5, 23, 0), _tenant()) == TariffPeriod.FORA_PONTA  # sábado 19:00 local


def test_feriado_e_fora_ponta():
    t = _tenant(holidays=[date(2026, 9, 7)])  # segunda, 7 de setembro
    assert period_for(utc(2026, 9, 7, 23, 0), t) == TariffPeriod.FORA_PONTA


def test_ponta_configuravel():
    t = _tenant(ponta_start="17:30", ponta_end="20:30")
    assert period_for(utc(2026, 9, 4, 21, 30), t) == TariffPeriod.PONTA  # 17:30 local
    assert period_for(utc(2026, 9, 5, 0, 30), t) == TariffPeriod.FORA_PONTA  # 20:30 local


def test_window_start_alinha_em_15_min():
    assert window_start(utc(2026, 9, 4, 12, 17, 43)) == utc(2026, 9, 4, 12, 15)
    assert window_start(utc(2026, 9, 4, 12, 0, 0)) == utc(2026, 9, 4, 12, 0)
    assert window_start(utc(2026, 9, 4, 12, 59, 59)) == utc(2026, 9, 4, 12, 45)


def test_month_key_usa_fuso_local():
    # 1º de outubro 02:00 UTC ainda é 30 de setembro 22:00 em Manaus
    assert month_key(utc(2026, 10, 1, 2, 0), "America/Manaus") == "2026-09"
