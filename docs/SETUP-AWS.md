# Setup da conta AWS e primeiro deploy

Ordem importa: alarme de orçamento antes de qualquer recurso, MFA antes de qualquer chave.

## 1. Conta e acesso

1. Crie a conta em aws.amazon.com com um e-mail que só você controla. Cartão é obrigatório.
2. Entre como **root** uma única vez: ative MFA (aplicativo autenticador) em *Security credentials*.
   Não gere access key para o root. Nunca mais use o root no dia a dia.
3. Crie um usuário de trabalho. O caminho recomendado é o **IAM Identity Center** (login por
   navegador com sessão temporária). O caminho rápido é um usuário IAM com a política
   `AdministratorAccess`, MFA ativado e uma access key gerada em *Security credentials*.
4. Na raiz do console, em *Billing preferences*, ative os alertas de faturamento por e-mail.

## 2. Ferramentas na máquina

```powershell
winget install --id Hashicorp.Terraform -e
winget install --id Amazon.AWSCLI -e
```

Se o winget não achar o Terraform, baixe o zip em https://developer.hashicorp.com/terraform/install,
extraia `terraform.exe` em `%USERPROFILE%\tools\terraform` e adicione essa pasta ao PATH do usuário.
Foi assim que a máquina de desenvolvimento ficou em 07/09/2026, com a versão 1.16.1.

Feche e abra o terminal. Configure as credenciais:

```powershell
aws configure            # access key, secret, região sa-east-1, saída json
aws sts get-caller-identity
```

Se usar Identity Center: `aws configure sso` e depois `aws sso login`.

## 3. Créditos e plano da conta

Contas novas escolhem entre **plano gratuito** e **plano pago**. Os dois recebem US$ 100 de crédito
na criação e até US$ 100 completando as atividades do widget "Explorar a AWS" na página inicial.
O gratuito não cobra o cartão, dura até seis meses ou até os créditos acabarem, e bloqueia alguns
serviços. Confirmado em 07/09/2026 nesta conta: **Kinesis Data Streams e Firehose ficam bloqueados**
(`SubscriptionRequiredException`); IoT Core, Athena, Glue, DynamoDB, Lambda, SQS, SNS, EventBridge,
API Gateway e Budgets funcionam. O desenho do projeto não usa Kinesis nem Firehose por isso.

Para ver o plano e o saldo:

```powershell
aws freetier get-account-plan-state
```

Peça também o **AWS Activate Founders** (US$ 1.000) em aws.amazon.com/startups/credits com o site da
empresa.

## 4. Deploy

```powershell
cd C:\AWS
.venv\Scripts\activate
python scripts\build_lambdas.py          # gera build\core.zip e build\api.zip
cd infra
copy terraform.tfvars.example terraform.tfvars
# edite terraform.tfvars: alert_email e admin_api_key
terraform init
terraform plan
terraform apply
```

Depois do apply:

1. Confirme a assinatura do SNS no e-mail que chegar, senão nenhum alerta é entregue.
2. Anote as saídas: `api_url`, `iot_endpoint`, `iot_policy_name`, `athena_workgroup`.

## 5. Primeiro cliente e primeiro gateway

```powershell
# cliente
curl -X POST "$(terraform output -raw api_url)/admin/tenants" -H "X-Admin-Key: SUA_CHAVE" `
     -H "Content-Type: application/json" -d '{"tenant_id":"demo","name":"Demo Plásticos"}'
# guarde o api_key da resposta; ele não aparece de novo

# unidade e medidor (X-API-Key = api_key acima)
curl -X POST ".../tenants/demo/sites"  -H "X-API-Key: ek_..." -d '{"site_id":"fabrica","name":"Fábrica"}'
curl -X POST ".../tenants/demo/meters" -H "X-API-Key: ek_..." `
     -d '{"site_id":"fabrica","meter_id":"injetoras","name":"Injetoras","contracted_kw":115}'

# gateway (cria Thing, certificado e grava em edge\certs\gw-fabrica-01)
cd ..
python scripts\provision_device.py --thing gw-fabrica-01 --tenant demo --site fabrica `
    --policy energia-dev-gateway --thing-type energia-dev-gateway
```

O `tenant_id` da Thing tem de ser igual ao `tenant_id` do cliente na API: é isso que a política
IoT usa para impedir que um gateway publique em nome de outro cliente.

## 6. Carga de teste

```powershell
python -m simulator.simulate --mode mqtt --mqtt-host (terraform -chdir=infra output -raw iot_endpoint) `
    --ca edge\certs\AmazonRootCA1.pem --cert edge\certs\gw-fabrica-01\cert.pem `
    --key edge\certs\gw-fabrica-01\private.key --tenant demo --site fabrica --meters 3 --speed 60
```

O simulador publica com QoS 1 e espera a confirmação de cada mensagem, como um gateway real faz.
Isso limita a uns 10 mensagens por segundo até São Paulo; duas horas simuladas de três medidores
(2.160 leituras) levam três a quatro minutos. Não tente acelerar com centenas de mensagens em voo:
o IoT Core derruba conexões acima de 100 publicações por segundo e o cliente entra em espiral de
reconexão e reenvio (aconteceu em 07/09/2026).

Para ver o resultado sem abrir o console:

```powershell
python scripts\status.py --tenant demo --site fabrica --day 2026-09-07 --since-minutes 30
```

Mostra fila e DLQ, lotes processados pela Lambda com aceitas, atrasadas e rejeitadas, janelas
fechadas por medidor, estado da janela aberta, alertas e arquivos no lake. Consulte o histórico
no Athena com `analytics/queries.sql` usando o workgroup `energia-dev`.

## 7. Desligar

```powershell
cd infra
terraform destroy
```

O bucket do lake tem objetos; o destroy vai falhar até esvaziá-lo (`aws s3 rm s3://... --recursive`).
Isso é proposital: dado de cliente não some por acidente.

## Custos a vigiar

- O alarme de orçamento dispara em 50%, 90% e 100% (previsto) de `budget_usd`, padrão US$ 20.
- Nada neste desenho tem custo por hora ligada. Se a conta subir com tudo parado, procure por
  algo criado fora do Terraform.
- Athena tem corte de 1 GB por consulta no workgroup. Uma consulta sem filtro de partição para.
