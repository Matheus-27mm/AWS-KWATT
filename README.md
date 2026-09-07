# Energia Industrial

Medição de energia por linha e turno para a indústria média do Polo Industrial de Manaus.
Um medidor Modbus por linha, um gateway na fábrica, e na nuvem: janelas de demanda de 15 minutos
iguais às que a distribuidora fatura, alerta de ultrapassagem antes de a janela fechar, fator de
potência abaixo de 0,92, consolidado mensal e um lake bruto em JSON Lines gzip para análise,
com compactação futura em Parquet quando o volume justificar.

Contexto de negócio e alternativas descartadas: [análise de mercado de 4 de setembro de 2026](https://claude.ai/code/artifact/0a2f0333-ffba-4a05-9fef-97f43c22910d).

## Arquitetura

```
 fábrica                      AWS (sa-east-1)
 ───────                      ──────────────────────────────────────────────────────────────
 medidores ──Modbus──▶ gateway ──MQTT/TLS──▶ IoT Core ──regra──▶ SQS ──▶ Lambda processador ──▶ DynamoDB
 (Kron, Embrasul,      (Python,                                              │        │         (estado, janelas,
  Schneider...)         fila em disco)                                       │        │          mês, alertas)
                                                                             │        ▼
                                                                             │   outbox transacional ──▶ EventBridge ──▶ Lambda notificador ──▶ SNS / WhatsApp
                                                                             ▼
                                                              S3 lake (JSON Lines gzip por lote) ──▶ Glue ──▶ Athena ──▶ notebook / painel

 API (FastAPI no Lambda, API Gateway HTTP): cadastro, estado do medidor, janelas, mês, alertas, ingestão HTTP
```

Dois planos sobre o mesmo dado. O operacional responde em segundos e vive no DynamoDB. O analítico
guarda tudo no S3 particionado por cliente, unidade e dia, e responde perguntas de meses. A mesma
Lambda alimenta os dois: o plano gratuito da AWS bloqueia Kinesis e Firehose, então o lote que ela
já tem em mãos vira um arquivo no lake.
Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md); o que não usamos e por quê em
[docs/DECISOES.md](docs/DECISOES.md); tarifa, demanda e fator de potência em
[docs/DOMINIO-ENERGIA.md](docs/DOMINIO-ENERGIA.md).

## Rodar local, sem AWS

```bash
python -m venv .venv && .venv/Scripts/activate
pip install -e ".[dev,edge]"
pytest
python scripts/local_runner.py --hours 24
```

O runner passa um dia de fábrica simulada pelo processador em memória e imprime janelas, consolidado
do mês e alertas. A API sobe com `uvicorn energia.api.app:create_app --factory --reload`; crie um cliente
com `POST /admin/tenants` (cabeçalho `X-Admin-Key`, valor de `ENERGIA_ADMIN_API_KEY` em `.env`) e alimente
com `python -m simulator.simulate --mode http --api-key ek_...`. Documentação interativa em `/docs`.

## Subir na AWS

Passo a passo completo, incluindo criação da conta, MFA e alarme de orçamento, em
[docs/SETUP-AWS.md](docs/SETUP-AWS.md). Resumo:

```bash
python scripts/build_lambdas.py                 # build/core.zip e build/api.zip com wheels Linux
cd infra && cp terraform.tfvars.example terraform.tfvars   # preencha e-mail e chave admin
terraform init && terraform plan && terraform apply
python ../scripts/provision_device.py --thing gw-fabrica-01 --tenant demo --site fabrica
python -m simulator.simulate --mode mqtt --mqtt-host $(terraform output -raw iot_endpoint) \
    --ca edge/certs/AmazonRootCA1.pem --cert edge/certs/gw-fabrica-01/cert.pem \
    --key edge/certs/gw-fabrica-01/private.key --client-id gw-fabrica-01 --hours 2
python scripts/status.py --tenant demo --day 2026-09-07   # filas, lotes, janelas, alertas, lake
terraform destroy                               # entre testes, para não pagar por nada parado
```

## Estrutura

```
src/energia/domain      modelos, calendário tarifário, aritmética de demanda, regras de alerta
src/energia/services    processor.py: a única função que muda estado
src/energia/adapters    memória (testes), DynamoDB, EventBridge, lake S3, SNS e WhatsApp
src/energia/mqtt_client publicador MQTT 5 confiável (CONNACK antes de publicar, PUBACK com código de sucesso)
src/energia/lambdas     handlers: processador (SQS), outbox (DynamoDB Stream), notificador e API
src/energia/api         FastAPI: admin, cadastro, medidores, ingestão
edge/                   gateway Modbus -> MQTT com fila em disco
simulator/              gerador de carga: perfil de fábrica de três turnos
scripts/                runner local, build das Lambdas, provisionamento de gateway, status do ambiente
infra/                  Terraform: budget, storage, processing, iot, api
analytics/              consultas Athena
tests/                  pytest, sem AWS
```

## Roadmap

1. **Agora:** medição, janelas, alertas, lake. Primeiro cliente via SENAI, CITS ou FIEAM, com o projeto
   financiado por verba obrigatória de PD&I da Lei de Informática. Próximo item técnico: varredor
   agendado que fecha janelas com carência vencida e alerta **medidor mudo**.
2. **Produção por turno:** contagem de peças do CLP ou apontamento manual, para kWh por peça e OEE.
3. **Novembro de 2027:** curva de carga de 12 meses pronta para decidir a migração ao mercado livre.
4. **2027 a 2029:** relato de emissões (SBCE) como módulo, a partir da mesma medição.
