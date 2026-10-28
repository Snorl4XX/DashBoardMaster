"""Tailscale de mentira para os testes (o comando tailscale.exe). Estado num JSON (variável TAILSCALE_FALSO):
{"conectado": true, "liberado": false, "funnel": {"8443": "http://127.0.0.1:3300"}}."""
import json
import os
import sys
import time

ARQ = os.environ["TAILSCALE_FALSO"]
NOME = "pc-expedicao.tail1234.ts.net"
e = json.load(open(ARQ, encoding="utf-8"))
a = sys.argv[1:]


def salvar():
    json.dump(e, open(ARQ, "w", encoding="utf-8"))


if a[:2] == ["status", "--json"]:
    print(json.dumps({"BackendState": "Running" if e["conectado"] else "NeedsLogin",
                      "Self": {"DNSName": NOME + "." if e["conectado"] else "", "Online": e["conectado"]}}))
elif a[:3] == ["funnel", "status", "--json"]:
    cfg = {}
    if e["funnel"]:
        cfg = {"TCP": {p: {"HTTPS": True} for p in e["funnel"]},
               "Web": {f"{NOME}:{p}": {"Handlers": {"/": {"Proxy": alvo}}} for p, alvo in e["funnel"].items()},
               "AllowFunnel": {f"{NOME}:{p}": True for p in e["funnel"]}}
    print(json.dumps(cfg))
elif a and a[0] == "funnel" and a[-1] == "off":
    porta = a[1].split("=")[1]
    e["funnel"].pop(porta, None)
    salvar()
elif a and a[0] == "funnel":
    porta, alvo = [x.split("=")[1] for x in a if x.startswith("--https=")][0], a[-1]
    if not e["liberado"]:
        print("Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/funnel?node=nFake123CNTRL\n", flush=True)
        time.sleep(60)  # o de verdade fica esperando a liberação
        sys.exit(1)
    e["funnel"][porta] = f"http://127.0.0.1:{alvo}"
    salvar()
    print(f"Available on the internet:\n\nhttps://{NOME}:{porta}/\n|-- proxy http://127.0.0.1:{alvo}\n\nFunnel started and running in the background.")
else:
    print("comando desconhecido", a)
    sys.exit(2)
