import pytest

from energia.domain.window import Sample, integrate, pf_average


def test_integra_trapezio_entre_amostras():
    samples = [Sample(o=0, kw=100), Sample(o=900, kw=100)]
    kwh, _ = integrate(samples)
    assert kwh == pytest.approx(25.0)


def test_ordem_das_amostras_nao_importa():
    a = [Sample(o=0, kw=100), Sample(o=300, kw=200), Sample(o=600, kw=100), Sample(o=890, kw=100)]
    b = [a[2], a[0], a[3], a[1]]
    assert integrate(a) == integrate(b)


def test_ancora_e_proxima_completam_as_bordas():
    samples = [Sample(o=10, kw=100), Sample(o=890, kw=100)]
    sem_bordas, _ = integrate(samples)
    # âncora 10 s antes do início e primeira amostra da próxima janela exatamente no fim (offset 900)
    com_bordas, _ = integrate(samples, anchor=Sample(o=-10, kw=100), next_first=Sample(o=900, kw=100))
    assert sem_bordas == pytest.approx(100 * 880 / 3600)
    assert com_bordas == pytest.approx(25.0)


def test_proxima_nao_adjacente_interpola_ate_o_fim():
    # última amostra a 890 s com 100 kW; próxima só 30 min depois (offset 2700) com 0 kW:
    # no fim da janela (900 s) a reta dá 100 - 100*(10/1810) kW
    samples = [Sample(o=0, kw=100), Sample(o=890, kw=100)]
    kwh, _ = integrate(samples, next_first=Sample(o=2700, kw=0))
    kw_fim = 100 - 100 * (10 / 1810)
    assert kwh == pytest.approx(100 * 890 / 3600 + ((100 + kw_fim) / 2) * 10 / 3600)


def test_interpolacao_na_borda_usa_a_reta_entre_vizinhos():
    # 0 kW na âncora (-10 s) e 100 kW na primeira amostra (10 s): na borda 0 s a potência é 50 kW
    samples = [Sample(o=10, kw=100), Sample(o=900, kw=100)]
    kwh, _ = integrate(samples, anchor=Sample(o=-10, kw=0))
    cabeca = ((50 + 100) / 2) * 10 / 3600
    corpo = 100 * 890 / 3600
    assert kwh == pytest.approx(cabeca + corpo)


def test_until_limita_a_projecao():
    samples = [Sample(o=0, kw=100), Sample(o=300, kw=100), Sample(o=600, kw=100)]
    kwh, _ = integrate(samples, until=300)
    assert kwh == pytest.approx(100 * 300 / 3600)


def test_media_de_fp_ignora_ausentes_e_usa_modulo():
    assert pf_average([Sample(o=0, kw=1, pf=-0.9), Sample(o=10, kw=1), Sample(o=20, kw=1, pf=0.7)]) == pytest.approx(
        0.8
    )
    assert pf_average([Sample(o=0, kw=1)]) is None
