-- Consultas Athena sobre o lake (workgroup energia-dev, banco energia_dev).
-- Sempre filtre tenant_id, site_id e dt: são partições e o corte de 1 GB por consulta depende disso.

-- 1. Consumo diário por medidor (kWh aproximado por integração das amostras de 10 s)
WITH base AS (
  SELECT meter_id, from_iso8601_timestamp(ts) AS t, kw
  FROM energia_dev.leituras
  WHERE tenant_id = 'demo' AND site_id = 'fabrica'
    AND dt BETWEEN '2026-09-01' AND '2026-09-30'
)
SELECT meter_id, date(t AT TIME ZONE 'America/Manaus') AS dia,
       round(sum(kw) * 10 / 3600.0, 1) AS kwh
FROM base
GROUP BY 1, 2
ORDER BY 1, 2;

-- 2. Demanda máxima do mês por medidor e posto, em janelas de 15 min iguais às da distribuidora
WITH base AS (
  SELECT meter_id, from_iso8601_timestamp(ts) AS t, kw
  FROM energia_dev.leituras
  WHERE tenant_id = 'demo' AND site_id = 'fabrica'
    AND dt BETWEEN '2026-09-01' AND '2026-09-30'
),
janelas AS (
  SELECT meter_id,
         date_add('minute', -(minute(t) % 15), date_trunc('minute', t)) AS janela_utc,
         avg(kw) AS demanda_kw
  FROM base
  GROUP BY 1, 2
),
classificadas AS (
  SELECT *,
         CASE WHEN day_of_week(janela_utc AT TIME ZONE 'America/Manaus') <= 5
                   AND hour(janela_utc AT TIME ZONE 'America/Manaus') BETWEEN 18 AND 20
              THEN 'ponta' ELSE 'fora_ponta' END AS posto
  FROM janelas
)
SELECT meter_id, posto, round(max(demanda_kw), 1) AS demanda_maxima_kw,
       max_by(janela_utc, demanda_kw) AS quando_utc
FROM classificadas
GROUP BY 1, 2
ORDER BY 1, 2;

-- 3. Fator de potência médio por hora local: onde a fábrica paga reativo
SELECT meter_id,
       hour(from_iso8601_timestamp(ts) AT TIME ZONE 'America/Manaus') AS hora_local,
       round(avg(abs(pf)), 3) AS fp_medio,
       round(avg(kvar), 1) AS kvar_medio
FROM energia_dev.leituras
WHERE tenant_id = 'demo' AND site_id = 'fabrica'
  AND dt BETWEEN '2026-09-01' AND '2026-09-30'
  AND pf IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- 4. Curva de carga média por hora do dia e dia da semana: o insumo da decisão de mercado livre
SELECT meter_id,
       day_of_week(from_iso8601_timestamp(ts) AT TIME ZONE 'America/Manaus') AS dia_semana,
       hour(from_iso8601_timestamp(ts) AT TIME ZONE 'America/Manaus') AS hora_local,
       round(avg(kw), 1) AS kw_medio,
       round(approx_percentile(kw, 0.95), 1) AS kw_p95
FROM energia_dev.leituras
WHERE tenant_id = 'demo' AND site_id = 'fabrica'
  AND dt BETWEEN '2026-01-01' AND '2026-12-31'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 5. Furos de medição: horas com menos amostras do que o esperado (360 por hora a 10 s)
SELECT meter_id,
       date_trunc('hour', from_iso8601_timestamp(ts)) AS hora_utc,
       count(*) AS amostras
FROM energia_dev.leituras
WHERE tenant_id = 'demo' AND site_id = 'fabrica'
  AND dt BETWEEN '2026-09-01' AND '2026-09-30'
GROUP BY 1, 2
HAVING count(*) < 300
ORDER BY 2;
