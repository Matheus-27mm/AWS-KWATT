# Domínio: como a fábrica paga energia

Referência regulatória: Resolução Normativa ANEEL 1.000/2021 e a fatura do próprio cliente. Antes
de configurar um medidor, abra a última fatura e confirme modalidade, demanda contratada e horário
de ponta. Os valores abaixo são o padrão nacional; a fatura manda.

## Grupo A e Grupo B

Indústrias e fornecedores médios são atendidos em média tensão, **Grupo A**, com tarifa binômia:
pagam **demanda** (kW) e **energia** (kWh). Consumidores em baixa tensão, **Grupo B**, pagam só
energia. O produto mira o Grupo A, onde a demanda é uma conta separada e controlável. Fornecedores
menores em Grupo B entram no roadmap de novembro de 2027, quando podem migrar para o mercado livre.

## Modalidades tarifárias

- **Verde:** uma demanda contratada única, válida em qualquer horário. A energia tem preço
  diferente na ponta e fora dela. É a modalidade mais comum em indústria média.
- **Azul:** demanda contratada por posto, uma para ponta e outra para fora ponta. Faz sentido
  quando a fábrica consegue baixar carga na ponta.

No sistema: `MeterConfig.modality`, `contracted_kw` (verde) ou `contracted_kw_ponta` e
`contracted_kw_fora_ponta` (azul).

## Posto tarifário

**Ponta** são três horas consecutivas definidas pela distribuidora, em dias úteis, dentro da
faixa das 17h às 22h. Sábado, domingo e feriado nacional são fora ponta o dia inteiro. O padrão
do sistema é 18h às 21h em `America/Manaus`; ajuste em `TenantConfig.ponta_start` e
`ponta_end` conforme a fatura. Feriados vão em `holidays`.

## Demanda medida

A distribuidora integra a energia em cada intervalo de **15 minutos** e divide por 0,25 h. A
**demanda faturável** do mês é a maior dessas médias, por posto. A tolerância é de **5%** sobre o
contratado: até 105% paga-se o contratado; acima, a diferença inteira é cobrada como
**ultrapassagem**, com tarifa cerca de duas vezes maior. Uma única janela ruim em um mês inteiro
custa o mês inteiro.

É por isso que o sistema:

- fecha janelas alinhadas ao relógio (00, 15, 30, 45), iguais às do medidor da distribuidora;
- avisa por **projeção** aos 5 minutos de janela, quando ainda dá tempo de desligar carga;
- registra a **maior demanda do mês por posto** no consolidado, que é o número da fatura.

## Fator de potência

Referência **0,92**, avaliada hora a hora. Abaixo disso a distribuidora cobra **excedente
reativo** (energia e demanda reativas). Indutivo é verificado das 6h às 23h30; capacitivo das
23h30 às 6h. Causas típicas em fábrica: motores em vazio, compressores ciclando, bancos de
capacitores desligados ou queimados. O sistema alerta uma vez por hora por medidor quando a média
da janela fica abaixo da referência.

## O que o medidor entrega

Medidores multifunção Modbus (Kron Mult-K, Embrasul, Schneider PM, ABB M4M) expõem potência ativa
(kW), reativa (kvar), tensão, corrente, fator de potência, frequência e energia acumulada (kWh).
O mapa de registradores muda por modelo e por firmware. `edge/config.example.yaml` mostra a forma;
os endereços têm de vir do manual.

## Vocabulário na fatura

| Na fatura                      | No sistema                        |
|--------------------------------|-----------------------------------|
| Demanda contratada             | `contracted_kw*`                  |
| Demanda medida / registrada    | `MonthRollup.max_demand_kw`       |
| Demanda de ultrapassagem       | `MonthRollup.exceeded_windows` e alertas `ultrapassagem_demanda` |
| Consumo ponta / fora ponta     | `MonthRollup.kwh[posto]`          |
| UFER / DMCR (excedente reativo)| `MonthRollup.pf_below_windows` e alertas `fator_potencia` |
| Bandeira tarifária             | fora do escopo desta versão       |
