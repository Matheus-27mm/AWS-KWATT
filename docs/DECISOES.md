# Decisões, inclusive as contra

A parte difícil de arquitetura não é adicionar componente, é justificar ausência. Cada linha abaixo
tem um número ou um fato por trás.

## Usamos

| Decisão | Por quê |
|---------|---------|
| **IoT Core com certificado por gateway** | MQTT com TLS mútuo é o padrão de campo. Política por atributo da Thing isola clientes sem código. |
| **SQS entre o IoT Core e a Lambda** | Rajada de 100 gateways reconectando ao mesmo tempo vira fila, não erro. Retry e DLQ vêm de graça. Concorrência máxima de 2 reduz colisões por medidor e faz backpressure. |
| **DynamoDB tabela única, sob demanda** | Acesso é sempre por chave (medidor, janela, mês). Sob demanda custa zero parado e escala sem provisionar. |
| **Transação DynamoDB + outbox** | Estado e derivados são atômicos; eventos ficam duráveis na mesma transação e saem pelo DynamoDB Stream. Não existe janela entre salvar estado e publicar evento. |
| **Índice de estados + varredor agendado** | Detecta silêncio em 2 min sem scan da tabela. Só finaliza após 2 h para não destruir o backlog curto guardado pelo gateway. |
| **Lake escrito pela própria Lambda, em JSON Lines gzip** | O lote de até 100 leituras já está na memória da Lambda; virar um arquivo por partição é uma chamada `PutObject`. Zero serviço a mais, funciona no plano gratuito. Parquet fica para um job de compactação quando o volume justificar. |
| **Glue com projeção de partições** | Sem crawler, sem `MSCK REPAIR`. O Athena calcula os caminhos a partir do filtro. |
| **Athena** | Volume de gigabytes por cliente por ano. Paga por consulta, com corte de 1 GB no workgroup. |
| **EventBridge** | Alertas e janelas viram eventos. Amanhã um consumidor novo (painel em tempo real, integração com o CLP) se inscreve sem tocar no processador. |
| **FastAPI no Lambda com Mangum** | Decisão do projeto: Python de ponta a ponta. Custo zero em repouso. Se um endpoint precisar ficar quente, migra para Fargate sem mudar a aplicação. |
| **Terraform** | Aparece em mais vagas e propostas que CDK; `destroy` entre testes é o que mantém a conta perto de zero. |
| **sa-east-1** | Dado de operação industrial fica no Brasil. A diferença de preço para us-east-1 nesta escala é de centavos. |

## Não usamos

| Descartado | Por quê |
|------------|---------|
| **Kinesis Data Streams** | Cobra por hora de shard ou por stream ligado. A fila SQS entrega o mesmo desacoplamento por fração de centavo nesta escala. Entra se um dia houver consumidores que precisem reler o stream. |
| **Kinesis Data Firehose** | Era o desenho original para o lake: agregação e conversão para Parquet sem código. Caiu em 07/09/2026 no primeiro `apply`: o plano gratuito da AWS devolve `SubscriptionRequiredException` para Kinesis e Firehose. A Lambda gravar o lote direto no S3 resolve com menos peças; o custo é arquivo pequeno em JSON em vez de Parquet, irrelevante até dezenas de medidores. Se a conta migrar para o plano pago, o Firehose continua sendo a forma mais simples de compactar. |
| **Timestream** | Seria a escolha óbvia para série temporal, mas a AWS fechou o Timestream for LiveAnalytics para novos clientes em junho de 2025. DynamoDB para o quente e Parquet no S3 para o frio cobrem o caso. |
| **MSK / Kafka** | Cluster ligado 24 horas, centenas de dólares por mês. Nenhum requisito aqui pede ordenação global ou replay. |
| **Redshift** | Resolve dezenas de terabytes com concorrência alta. Temos gigabytes e um analista. |
| **QuickSight** | Assinatura por usuário que alguém esquece. Painel estático em S3 e notebook resolvem até o cliente pedir BI. |
| **Lambda direto na regra IoT** | Funciona, mas sem fila não há retry controlado nem DLQ, e uma rajada vira throttling silencioso. |
| **VPC e NAT Gateway** | Nada privado a alcançar. NAT custaria mais que todo o resto da conta. |
| **Kubernetes / ECS permanente** | Nenhum processo precisa ficar de pé. |
| **Step Functions** | A máquina de estados do medidor cabe numa função pura com teste unitário. Orquestração visual não paga o custo cognitivo aqui. |
| **Cognito** | Chave por cliente basta até existir painel com vários usuários por cliente. |
| **Hardware próprio** | Medidores e gateways de prateleira. O produto é o software e o serviço; fabricar hardware é outro negócio. |

## Aprendido no primeiro dia em produção (07/09/2026)

| Fato | Consequência no desenho |
|------|-------------------------|
| O plano gratuito da AWS bloqueia Kinesis e Firehose (`SubscriptionRequiredException`). | Lake escrito pela Lambda processadora. Menos uma peça. |
| A fila SQS padrão não garante ordem e a regra do IoT Core não aceita FIFO. Um teste com lote embaralhado perdeu 87% da energia de uma janela. | Estado guarda as amostras da janela; energia integrada no fechamento; carência de 60 s. Ordem de chegada deixou de importar. |
| Publicar centenas de mensagens MQTT em voo derruba a conexão (limite de 100/s por conexão) e o cliente entra em espiral de reenvio ao reconectar. | Gateway e simulador publicam com QoS 1 e esperam o PUBACK de cada mensagem. |
| O relógio do notebook estava uma hora atrasado (fuso Brasília com hora de Manaus). A AWS rejeita assinaturas com mais de 15 min de diferença. | Fuso corrigido para Manaus e serviço de hora ligado. Gateways de campo precisam de NTP; sem isso o TLS e as janelas de 15 min ficam errados. |
| Primeira carga real (2.160 leituras, 3 medidores, Lambda com 10 instâncias): 61% das leituras chegaram fora de ordem, 94 conflitos de versão voltaram à fila e reapareceram 3 min depois, já fora da carência. Janelas fecharam com 77 a 89 amostras em vez de 90. | Conflito de versão passa a ser resolvido na hora, relendo o estado (até 5 tentativas). Concorrência da Lambda baixada para 2. O lake, que recebe tudo, não perdeu nada: 2.160 leituras em 194 arquivos. |
| Segunda carga (mesmo volume, 2 instâncias, retry): zero conflitos devolvidos à fila, janelas com 90 de 90. Mas a primeira janela do lote perdeu até 16 amostras: o simulador manda 2 h em 3 min, os lotes embaralham em escala de minutos e a carência de 60 s em tempo de dado não cobre. É o mesmo cenário de um gateway descarregando a fila em disco depois de uma queda. | Carência passa a contar no relógio da nuvem, com várias janelas abertas por medidor (teto 8). Teste `test_rajada_de_reenvio_embaralhada_em_minutos_nao_perde_amostras` reproduz 2 h embaralhadas em lotes de 3 min e exige 90 de 90 em todas. |
| Terceira carga (ponta): janelas com 88 a 90 amostras; 9 leituras esgotaram as 5 tentativas porque o outro consumidor gravava o mesmo item leitura a leitura, e voltaram à fila com visibility timeout de 3 min, fora da carência. | Lote agrupado por medidor: uma leitura e uma gravação de estado por grupo (`process_batch`), 8 tentativas, visibility timeout de 45 s e timeout da Lambda de 15 s. |
| Quarta carga: zero rejeitadas, zero devolvidas, 90 de 90 em todas as janelas menos duas com 89. As duas leituras que faltam foram as duas primeiras publicadas após conectar: o IoT Core respondeu PUBACK com "Unspecified error" e descartou, e a biblioteca marcou como publicadas. Elas não chegaram nem ao lake. | `energia/mqtt_client.py`: espera o CONNACK antes de publicar, lê o código de motivo do PUBACK e reenvia quando não é sucesso. Gateway e simulador usam o mesmo publicador. PUBACK não é entrega; código de motivo é. |

## O que revisitar e quando

- **Agregação no gateway:** acima de ~2.000 medidores a 10 s, publicar lotes por segundo em vez
  de uma mensagem por amostra corta o custo do IoT Core em dez vezes.
- **Secrets Manager:** quando houver mais de um ambiente ou mais de uma pessoa fazendo apply.
- **Estado do Terraform em S3 com lock:** no mesmo momento.
- **Kinesis Data Streams:** quando um segundo consumidor precisar do stream bruto em tempo real.
