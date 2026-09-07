# Arquitetura

## Fluxo de uma leitura

1. O gateway lê o medidor por Modbus a cada 10 s e publica em `energia/{tenant}/{site}/{meter}`
   por MQTT com TLS mútuo. Se a conexão cair, a leitura fica numa fila SQLite e sai depois, em ordem.
2. O IoT Core aplica uma regra sobre o tópico e entrega a mensagem na fila SQS. Não chama Lambda
   direto: a fila absorve rajada, dá retry e tem DLQ.
3. A Lambda processadora consome lotes de até 100 mensagens com concorrência máxima de 2,
   agrupa por medidor e ordena cada grupo por timestamp. Cada grupo faz uma leitura e uma escrita
   de estado, em vez de uma escrita por amostra.
4. Estado, janelas, mês, alertas e eventos de outbox são gravados juntos com
   `TransactWriteItems`. O DynamoDB Stream entrega a outbox a outra Lambda, que publica no
   EventBridge. O notificador escuta `Alerta` e envia por SNS e WhatsApp.
5. Antes de alterar o plano operacional, a mesma Lambda grava todas as leituras válidas no lake como um arquivo JSON
   Lines gzip por partição tocada, em `s3://lake/leituras/tenant_id=.../site_id=.../dt=AAAA-MM-DD/`.
   O Athena lê por projeção de partições, sem crawler. Se o S3 falhar, nenhuma leitura é processada
   e o lote volta à fila. A chave do objeto é um hash do conteúdo: uma redelivery idêntica
   sobrescreve o mesmo arquivo. Ainda convém deduplicar por (meter_id, ts) quando leituras iguais
   atravessarem lotes diferentes. A projeção de `dt` vai até `NOW` em UTC,
   então dado com data futura (só acontece em simulação) fica invisível até o dia chegar.

## Modelo de dados no DynamoDB

Tabela única, chaves `PK`/`SK`, cobrança sob demanda, TTL em janelas e alertas.

| PK                    | SK                    | Item          | Observação |
|-----------------------|-----------------------|---------------|------------|
| `TENANT#{t}`          | `META`                | TenantConfig  | calendário de ponta, FP de referência, hash da chave |
| `TENANT#{t}`          | `SITE#{s}`            | SiteConfig    | |
| `TENANT#{t}`          | `METER#{s}#{m}`       | MeterConfig   | modalidade e demanda contratada |
| `TENANT#{t}`          | `ALERT#{ts}#{id}`     | Alert         | TTL 180 dias; listagem do painel é uma query |
| `METER#{t}#{s}#{m}`   | `STATE`               | MeterState    | uma escrita por amostra, condicional à versão |
| `METER#{t}#{s}#{m}`   | `WINDOW#{início ISO}` | DemandWindow  | TTL 90 dias; o lake guarda o histórico |
| `METER#{t}#{s}#{m}`   | `MONTH#{AAAA-MM}`     | MonthRollup   | o que a fatura vai mostrar |
| `OUTBOX#{event_id}`   | `EVENT`               | OutboxEvent   | gravado na transação e removido após publicar |

Partições quentes: o item de estado recebe 6 escritas por minuto por medidor. O limite de uma
partição é 1.000 WCU por segundo. Um cliente com 100 medidores gera 10 escritas por segundo
espalhadas em 100 partições. Não há cenário realista deste produto que esquente uma partição.

## Ordem, idempotência e concorrência

A fila SQS padrão entrega pelo menos uma vez e sem garantia de ordem, e a regra do IoT Core não
aceita fila FIFO. O processador foi desenhado para isso em vez de fingir que não acontece:

- O estado guarda as **janelas abertas com suas amostras** (offset em segundos, kW, kvar, FP),
  não um acumulador. A energia é integrada pelo trapézio sobre as amostras ordenadas no
  fechamento. Qualquer ordem de chegada dentro da carência produz exatamente a mesma janela
  (testes `test_desordem_leve_em_tempo_real_da_a_mesma_janela` e
  `test_rajada_de_reenvio_embaralhada_em_minutos_nao_perde_amostras`).
- Uma janela fecha **60 s de relógio da nuvem** depois de vermos a primeira leitura posterior ao
  fim dela. Em fluxo normal isso dá ~70 s depois do fim. Numa rajada de reenvio (gateway voltando
  de uma queda de internet e descarregando horas em segundos), dá 60 s depois de a rajada passar
  por ela, tempo de sobra para os lotes embaralhados dos outros consumidores chegarem. Até 8
  janelas ficam abertas por medidor; acima disso a mais antiga fecha sem esperar.
  A primeira amostra da janela seguinte serve de ponte para integrar o último trecho.
- Duplicata é amostra com o mesmo offset dentro da janela: descartada. Leitura de janela já
  fechada: descartada do plano operacional, o lake bruto tem todas. Redelivery de um lote inteiro
  não muda um byte do estado (teste `test_redelivery_do_lote_inteiro_nao_muda_nada`).
- A Lambda **agrupa o lote por medidor** e aplica cada grupo com uma leitura e uma gravação de
  estado (`process_batch`). Numa rajada, 100 mensagens de 3 medidores viram 3 gravações em vez
  de 100: menos custo de DynamoDB e menos chance de colidir com o outro consumidor.
- Toda mudança derivada é gravada numa única transação com
  `ConditionExpression: version = :esperada`. Dois consumidores
  processando o mesmo medidor ao mesmo tempo: um grava, o outro recebe conflito, **relê e
  reaplica o grupo na hora**, até oito vezes com jitter. Só depois disso as mensagens do grupo
  voltam à fila, e o visibility timeout é de 45 s para que voltem dentro da carência.
- Concorrência da Lambda fixada em 2, o mínimo. Com poucos medidores, mais instâncias só
  produzem conflitos no mesmo item. Sobe quando houver dezenas de medidores.
- Amostra que chega depois de mais de 30 min de silêncio não integra energia sobre o buraco.
  A janela anterior fecha com o que tinha e `samples` menor que o esperado denuncia o furo.
- Custo dessa robustez: o alerta de ultrapassagem sai ~70 s depois do fim da janela. O alerta de
  projeção, aos 5 min de janela, continua sendo o que chega a tempo de desligar carga.
- Um varredor agendado consulta o índice `states-by-ingestion` a cada minuto. Após 2 minutos sem
  ingestão, dispara uma vez o alerta de **medidor mudo**. A janela só é finalizada após 2 horas,
  preservando o horizonte de atraso suportado pelas oito janelas abertas; uma nova leitura rearma
  o alerta. Backlogs maiores continuam íntegros no lake, mas não são recalculados no plano operacional.

## Limites e como crescer

| Ponto                  | Hoje                               | Quando mudar |
|------------------------|------------------------------------|--------------|
| IoT Core → SQS         | 1 mensagem = 1 item SQS            | acima de ~2.000 medidores a 10 s, agregar no gateway (lote por publicação) |
| SQS → Lambda           | lotes de 100, concorrência 2       | subir quando a idade da fila crescer e houver muitos medidores distintos |
| Lake                   | 1 arquivo JSON gzip por lote e partição (~20 KB) | acima de ~50 medidores, compactar por dia em Parquet com um job agendado; até lá o Athena lê os arquivos pequenos sem problema |
| Athena                 | corte de 1 GB por consulta         | subir o corte quando houver anos de dado |
| Outbox → EventBridge   | 1 `put_events` por evento          | agrupar em lotes de 10 quando alertas passarem de centenas por minuto |

## Custo estimado

Um medidor a cada 10 s gera 259 mil mensagens por mês. Somando IoT Core (mensagens e ação de
regra), SQS, Lambda, DynamoDB sob demanda e S3 (cerca de 2.600 PUTs por medidor por mês), a conta
fica na ordem de US$ 1 a 3 por medidor por mês em sa-east-1, dominada por IoT Core e DynamoDB.

O item de estado é reescrito uma vez por grupo de medidor em cada lote e o DynamoDB cobra por KB gravado. Com uma janela
aberta de 90 amostras o item tem uns 2 a 3 KB (as amostras vão como listas compactas, não como
mapas com nome de campo); numa rajada com 8 janelas abertas chega a 20 KB, e cada gravação custa
proporcionalmente mais. Se o custo do DynamoDB dominar, os dois caminhos são publicar a cada 30 s
em vez de 10 s (três vezes menos gravações) ou guardar as amostras da janela num item separado.
Medir na fatura do primeiro mês antes de otimizar. Nada fica ligado
parado: sem instância, sem cluster, sem NAT. Conferir no AWS Pricing Calculator antes de
prometer preço a cliente.

## Segurança

- Cada gateway tem certificado X.509 próprio. A política IoT usa o atributo `tenant_id` da
  Thing: o dispositivo só publica em `energia/{seu tenant}/*` e só conecta com o próprio nome.
- A IoT Rule substitui `tenant_id`, `site_id` e `meter_id` pelos segmentos do tópico autorizado;
  identidade enviada dentro do JSON nunca atravessa a fronteira de confiança.
- A API autentica por chave por cliente (hash SHA-256 no DynamoDB) e chave de administração em
  variável de ambiente. Cognito entra quando houver painel com usuários.
- Lambdas fora de VPC: não há recurso privado a alcançar e NAT Gateway custaria mais que o resto.
- O token do WhatsApp vai como variável de ambiente sensível no Terraform. Mover para Secrets
  Manager quando houver mais de um ambiente.
