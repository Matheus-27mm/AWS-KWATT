"""Cria uma Thing no IoT Core para um gateway, com certificado, e grava os arquivos em edge/certs/<thing>/.

  python scripts/provision_device.py --thing gw-fabrica-01 --tenant demo --site fabrica --region sa-east-1

A política anexada (criada pelo Terraform) só permite publicar em energia/<tenant>/..., usando o atributo
tenant_id da Thing. Um gateway de um cliente nunca consegue publicar em nome de outro.
"""

from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path

import boto3

ROOT_CA_URL = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--thing", required=True)
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--policy", default="energia-dev-gateway", help="nome da política IoT (saída do Terraform)")
    ap.add_argument("--thing-type", default="energia-dev-gateway")
    ap.add_argument("--region", default="sa-east-1")
    ap.add_argument("--out", type=Path, default=Path("edge/certs"))
    args = ap.parse_args()

    iot = boto3.client("iot", region_name=args.region)
    out = args.out / args.thing
    out.mkdir(parents=True, exist_ok=True)

    iot.create_thing(
        thingName=args.thing,
        thingTypeName=args.thing_type,
        attributePayload={"attributes": {"tenant_id": args.tenant, "site_id": args.site}},
    )
    cert = iot.create_keys_and_certificate(setAsActive=True)
    (out / "cert.pem").write_text(cert["certificatePem"], encoding="utf-8")
    (out / "private.key").write_text(cert["keyPair"]["PrivateKey"], encoding="utf-8")
    (out / "public.key").write_text(cert["keyPair"]["PublicKey"], encoding="utf-8")
    iot.attach_policy(policyName=args.policy, target=cert["certificateArn"])
    iot.attach_thing_principal(thingName=args.thing, principal=cert["certificateArn"])

    ca_path = args.out / "AmazonRootCA1.pem"
    if not ca_path.exists():
        with urllib.request.urlopen(ROOT_CA_URL, timeout=30) as resp:
            ca_path.write_bytes(resp.read())

    endpoint = iot.describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
    print(f"Thing {args.thing} criada. Certificado em {out}. Endpoint MQTT: {endpoint}")
    print("Guarde private.key com o mesmo cuidado de uma senha: ele identifica o gateway.")


if __name__ == "__main__":
    main()
