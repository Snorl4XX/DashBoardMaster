"""JMS de mentira (modo demonstração e testes): responde os mesmos endereços que o app consulta, com viagens e pacotes
inventados (bases e códigos reais da planilha de rotas). Nada vai para a internet.

  - Troncal: 10 viagens por dia; secundária: 8 (uma delas para DC GRU-SP, que está na tabela troncal).
  - Hoje: a viagem que ainda não saiu fica "carregando" (fora do painel); a que saiu há menos de 3 h fica Em Trânsito
    e os pacotes bipados só aparecem depois da hora do bipe (o painel cresce ao longo do dia).
  - Cerca de 1 em cada 9 pacotes é de outra rota (o "caminhão errado"); alguns sem código no 3 Segmentos e alguns com
    código que não está na planilha de rotas.
  - A secundária recusa o endereço "loading/scan/page" (como na captura do JMS): o app aprende o "unloading".
"""

from __future__ import annotations

import json
import random
import re
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .coletor import TZ_SP, agora_sp

PADROES_DEMO = {"porta": 3399, "host": "127.0.0.1", "segundosPorRemessa": 0, "consultasSegmentos": 10, "consultasPorSegundo": 200,
                "minutos": 2, "dashmaster": "nao"}
BASE = ("30001", "SP GRU")
LOGINS = ["ana.souza", "bruno.lima", "carla.alves", "diego.rocha", "erika.melo", "fabio.reis", "gabi.costa", "hugo.martins"]

# Rota (próxima parada) → pacotes que pertencem a ela: (1º segmento, 2º segmento, Base Destino, Município)
PACOTES_DA_ROTA = {
    "SP BRE": [("SP", "395-01", "DC SBC-SP", "São Bernardo do Campo"), ("MA", "650-03", "DC SLZ-MA", "São Luís"),
               ("AM", "690-01", "AM MAO", "Manaus"), ("SOD", "180-02", "SOD-SP", "Sorocaba"), ("TO", "770-04", "DC PMW-TO", "Palmas")],
    "RJ SJM": [("RJ", "220-10", "DC NIT-RJ", "Niterói"), ("VDC", "310-02", "BA VDC", "Vitória da Conquista"),
               ("RJ1", "230-01", "DC CBF-RJ", "Cabo Frio")],
    "MG CGE": [("MG", "300-04", "DC BHZ-MG", "Belo Horizonte"), ("CHV", "330-01", "DC CHV-MG", "Uberlândia")],
    "BA FEC": [("BA", "440-02", "DC SSA-BA", "Salvador"), ("SNS", "470-01", "DC SNS-PE", "Petrolina")],
    "DC GRU-SP": [("GRU", "381-02", "DC GRU-SP", "Guarulhos"), ("SP", "395-06", "F GRU 03-SP", "Guarulhos")],
    "PR SJS": [("PR", "800-03", "DC CWB-PR", "Curitiba"), ("CAC", "850-01", "DC CAC-PR", "Cascavel")],
    "CE FOR": [("CE", "600-01", "DC FOR-CE", "Fortaleza")],
    "GO GYN": [("GO", "740-02", "DC GYN-GO", "Goiânia")],
    "PE JGS": [("PE", "540-05", "DC REC-PE", "Recife"), ("BYE", "560-01", "DC BYE-PE", "Caruaru")],
    "DF BSB": [("DF", "720-01", "DC BSB-DF", "Brasília")],
    "S-SRAF-SP": [("GRU", "404-00", "S-SRAF-SP", "São Paulo")],
    "F S-PENHA-SP": [("GRU", "404-05", "F S-PENHA-SP", "São Paulo")],
    "DC SSZ-SP": [("GRU", "378-02", "DC SSZ-SP", "Santos"), ("GRU", "378-05", "F SSZ 02-SP", "Guarujá")],
    "DC S-MOO 02-SP": [("MOO", "430-03", "DC S-MOO 02-SP", "São Paulo"), ("SP", "364-00", "F S-MOO-SP", "São Paulo")],
    "S-MGUE-SP": [("GRU", "404-01", "S-MGUE-SP", "São Paulo")],
    "F S-SAP 02-SP": [("GRU", "404-12", "F S-SAP 02-SP", "São Paulo")],
}
VIAGENS = {
    "troncal": [("SP BRE", 1), ("RJ SJM", 4), ("MG CGE", 7), ("BA FEC", 9), ("DC GRU-SP", 11), ("PR SJS", 13), ("CE FOR", 15),
                ("SP BRE", 17), ("GO GYN", 20), ("PE JGS", 22)],
    "secundaria": [("S-SRAF-SP", 2), ("F S-PENHA-SP", 5), ("DC SSZ-SP", 8), ("DC S-MOO 02-SP", 10), ("S-MGUE-SP", 12),
                   ("DC GRU-SP", 14), ("F S-SAP 02-SP", 18), ("S-SRAF-SP", 21)],
}
CODIGO_DESTINO = {"SP BRE": "30010", "RJ SJM": "30020", "MG CGE": "30030", "BA FEC": "30040", "DC GRU-SP": "30050"}


def _dia_viagens(tipo: str, dia: str, agora: datetime) -> list[dict]:
    """Viagens do dia (com os pacotes), sempre iguais para o mesmo dia: o sorteio usa o dia como semente."""
    sorteio = random.Random(f"{dia}|{tipo}")
    todos_codigos = [p for lista in PACOTES_DA_ROTA.values() for p in lista]
    out = []
    for i, (rota, hora) in enumerate(VIAGENS[tipo]):
        saida = datetime.fromisoformat(f"{dia}T{hora:02d}:{sorteio.randint(0, 50):02d}:00").replace(tzinfo=TZ_SP)
        chegada = saida + timedelta(hours=3 if tipo == "troncal" else 1, minutes=sorteio.randint(0, 50))
        if agora < saida:
            estado = "2"  # carregando: ainda não saiu (fica fora do painel)
        elif agora < chegada:
            estado = "3"
        else:
            estado = "4"
        sid = f"{'T' if tipo == 'troncal' else 'S'}{dia.replace('-', '')}{i + 1:03d}"
        pacotes = []
        n = sorteio.randint(30, 90) if tipo == "troncal" else sorteio.randint(20, 55)
        sacas = [f"BR{sorteio.randint(10 ** 9, 10 ** 10 - 1)}" for _ in range(max(2, n // 12))]
        for k in range(n):
            certo = sorteio.random() > 0.11
            s1, s2, base_dest, cidade = sorteio.choice(PACOTES_DA_ROTA[rota] if certo else todos_codigos)
            bipe = saida - timedelta(minutes=sorteio.randint(5, 150))
            tres = f"{sorteio.randint(1, 60):03d}"
            sorte = sorteio.random()
            if sorte < 0.015:
                s1, s2 = "XYZ", "999-01"  # código fora da planilha de rotas
            seg = "" if sorte > 0.99 else f"{s1},{s2},{tres}"  # sem código no 3 Segmentos
            pacotes.append({"billCode": f"{88 if tipo == 'troncal' else 89}{dia.replace('-', '')[2:]}{i:02d}{k:04d}{sorteio.randint(10, 99)}",
                            "packageCode": "" if sorteio.random() < 0.15 else sorteio.choice(sacas),
                            "networkCode": BASE[0], "networkName": BASE[1], "nextStation": rota, "destsite": base_dest,
                            "destsiteCity": cidade, "scanType": "1", "scanTypeName": "Bipe de carregamento",
                            "scanUser": sorteio.choice(LOGINS), "scanTime": bipe.strftime("%Y-%m-%d %H:%M:%S") + ".0",
                            "_seg": seg, "_bipe": bipe})
        out.append({"shipmentNo": sid, "shipmentName": f"{BASE[1]}-{rota}", "startCode": BASE[0], "startName": BASE[1], "endName": rota,
                    "endCode": CODIGO_DESTINO.get(rota, "39999"), "plannedDepartureTime": saida.strftime("%Y-%m-%d %H:%M:%S"),
                    "actualDepartureTime": saida.strftime("%Y-%m-%d %H:%M:%S") if estado != "2" else "",
                    "actualArrivalTime": chegada.strftime("%Y-%m-%d %H:%M:%S") if estado == "4" else "", "shipmentState": estado,
                    "plateNumber": f"{sorteio.choice('BFGR')}{sorteio.choice('ABCRT')}{sorteio.choice('XYZ')}{sorteio.randint(1000, 9999)}",
                    "carrierShortName": sorteio.choice(["TRANSLOG", "RODOSUL", "VIA BR"]),
                    "_pacotes": [p for p in pacotes if p["_bipe"] <= agora]})
    return out


class JmsFalso:
    """Servidor do JMS de mentira em 127.0.0.1 (porta livre). .url, .token, .pedidos (contagem por endereço), .parar()."""

    def __init__(self, *, token: str = "token-demo", agora=None, recusar_loading_secundaria: bool = True) -> None:
        self.token = token
        self.agora = agora or agora_sp
        self.recusar_loading_secundaria = recusar_loading_secundaria
        self.bloquear_rastreio = False  # testes: o Rastreamento devolve uma página (bloqueio)
        self.ocupado = 0  # testes: as próximas N consultas ao Rastreamento do pacote respondem "sistema ocupado"
        self.pedidos: dict[str, int] = {}
        self._trava = threading.Lock()
        self._cache: dict[tuple, tuple] = {}
        falso = self

        class Pedido(BaseHTTPRequestHandler):
            def log_message(self, *a) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                falso._responder(self, None)

            def do_POST(self) -> None:  # noqa: N802
                n = int(self.headers.get("Content-Length") or 0)
                falso._responder(self, json.loads(self.rfile.read(n) or b"{}"))

        self.servidor = ThreadingHTTPServer(("127.0.0.1", 0), Pedido)
        self.servidor.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.servidor.server_address[1]}"
        threading.Thread(target=self.servidor.serve_forever, daemon=True, name="jms-falso").start()

    def parar(self) -> None:
        self.servidor.shutdown()
        self.servidor.server_close()

    # ---------------------------------------------------------------- dados
    def viagens(self, tipo: str, dia: str) -> list[dict]:
        agora = self.agora()
        chave = (tipo, dia, agora.strftime("%Y-%m-%d %H:%M"))
        with self._trava:
            if chave not in self._cache:
                self._cache = {k: v for k, v in self._cache.items() if k[:2] != (tipo, dia)}
                self._cache[chave] = (_dia_viagens(tipo, dia, agora),)
            return self._cache[chave][0]

    def _viagem(self, sid: str) -> dict | None:
        tipo = "troncal" if sid.startswith("T") else "secundaria"
        dia = f"{sid[1:5]}-{sid[5:7]}-{sid[7:9]}"
        return next((v for v in self.viagens(tipo, dia) if v["shipmentNo"] == sid), None)

    def pacote(self, remessa: str) -> tuple[dict, dict] | None:
        """(viagem, pacote) da remessa (o dia vem no próprio número: 88/89 + AAMMDD…)."""
        if not re.fullmatch(r"8[89]\d{6}\d+", remessa):
            return None
        dia = f"20{remessa[2:4]}-{remessa[4:6]}-{remessa[6:8]}"
        for tipo in ("troncal", "secundaria"):
            for v in self.viagens(tipo, dia):
                for p in v["_pacotes"]:
                    if p["billCode"] == remessa:
                        return v, p
        return None

    def bipes(self, remessa: str) -> list[dict]:
        """Rastreamento do pacote de uma remessa (do mais novo para o mais antigo, como o JMS)."""
        achado = self.pacote(remessa)
        if not achado:
            return []
        v, p = achado
        bipe = p["_bipe"]
        chegou = bipe - timedelta(hours=3, minutes=int(remessa[-2:]) % 50)
        d = [{"billCode": remessa, "waybillNo": remessa, "scanTime": chegou.strftime("%Y-%m-%d %H:%M:%S"), "scanTypeName": "Encomenda recebida",
              "scanNetworkName": BASE[1], "scanByName": "RECEBEDOR DEMO", "imgType": 8, "code": 2,
              "waybillTrackingContent": f"O expresso chegou [{BASE[1]}] A parada anterior foi [SP SPO], escaneador [RECEBEDOR DEMO], o número do pedido []"},
             {"billCode": remessa, "waybillNo": remessa, "scanTime": bipe.strftime("%Y-%m-%d %H:%M:%S"), "scanTypeName": "Encomenda carregada",
              "scanNetworkName": BASE[1], "scanByName": p["scanUser"], "imgType": 0 if int(remessa[-1]) % 4 == 0 else 8, "code": 1,
              "nextStopName": v["endName"],
              "waybillTrackingContent": f"A encomenda expressa está [{BASE[1]}] sendo enviada, para [{v['endName']}], escaneador [{p['scanUser']}], "
                                        f"o número do pedido [{v['shipmentNo']}], número do voo []"}]
        return sorted(d, key=lambda x: x["scanTime"], reverse=True)

    def segmento(self, remessa: str) -> str | None:
        achado = self.pacote(remessa)
        return achado[1]["_seg"] if achado else None

    # ---------------------------------------------------------------- respostas
    @staticmethod
    def _enviar(req: BaseHTTPRequestHandler, corpo, status: int = 200, tipo: str = "application/json") -> None:
        dados = (corpo if isinstance(corpo, str) else json.dumps(corpo, ensure_ascii=False)).encode("utf-8")
        req.send_response(status)
        req.send_header("Content-Type", tipo + ";charset=UTF-8")
        req.send_header("Content-Length", str(len(dados)))
        req.end_headers()
        req.wfile.write(dados)

    @staticmethod
    def _pagina(itens: list, atual, tamanho) -> dict:
        atual, tamanho = max(1, int(atual or 1)), max(1, int(tamanho or 20))
        limpos = [{k: v for k, v in x.items() if not k.startswith("_")} for x in itens]
        return {"code": 1, "msg": "success", "data": {"records": limpos[(atual - 1) * tamanho:atual * tamanho], "total": len(itens),
                                                      "size": tamanho, "current": atual, "pages": (len(itens) + tamanho - 1) // tamanho}}

    def _responder(self, req: BaseHTTPRequestHandler, corpo: dict | None) -> None:
        u = urlsplit(req.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        caminho = u.path
        with self._trava:
            self.pedidos[caminho] = self.pedidos.get(caminho, 0) + 1
        if req.headers.get("AuthToken") != self.token:
            return self._enviar(req, {"code": 135010037, "msg": "token失效，请重新登录", "fail": True, "data": None})
        if caminho == "/transportation/tmsShipment/page":
            v = [x for x in self.viagens("troncal", q["startDateTime"][:10]) if x["startCode"] == q.get("startCode")]
            return self._enviar(req, self._pagina(v, q.get("current"), q.get("size")))
        if caminho == "/transportation/tmsBranchTrackingDetail/page":
            v = [x for x in self.viagens("secundaria", corpo["startDepartureTime"][:10]) if x["startCode"] == corpo.get("startCode")]
            return self._enviar(req, self._pagina(v, corpo.get("current"), corpo.get("size")))
        if caminho.endswith("/loading/scan/list"):
            v = self._viagem(q.get("shipmentNo", ""))
            if not v:
                return self._enviar(req, {"code": 1, "data": []})
            n = len(v["_pacotes"])
            regs = [{"loadingTypeName": "1", "scanNetworkCode": BASE[0], "scanNetworkName": BASE[1], "scanWaybillNum": n,
                     "scanWaybillSingleNum": n}]
            if v["shipmentState"] == "4":
                regs.append({"loadingTypeName": "2", "scanNetworkCode": v["endCode"], "scanNetworkName": v["endName"], "scanWaybillNum": n})
            return self._enviar(req, {"code": 1, "msg": "success", "data": regs})
        if caminho.endswith("/scan/page"):
            secundaria = "tmsBranchTrackingDetail" in caminho
            if secundaria and self.recusar_loading_secundaria and "/loading/" in caminho:
                return self._enviar(req, {"code": 500, "msg": "系统繁忙", "fail": True})
            v = self._viagem(q.get("shipmentNo", ""))
            return self._enviar(req, self._pagina(v["_pacotes"] if v else [], q.get("current"), q.get("size")))
        if caminho == "/operatingplatform/podTracking/inner/query/keywordList":
            with self._trava:
                if self.ocupado > 0:
                    self.ocupado -= 1
                    return self._enviar(req, {"code": 500, "msg": "系统繁忙，请稍后再试", "fail": True})
            if corpo.get("trackingTypeEnum") != "WAYBILL":
                return self._enviar(req, {"code": 500, "msg": "parâmetro inválido", "fail": True})
            kws = [str(x).upper() for x in (corpo.get("keywordList") or [])][:1]  # o JMS devolve só a primeira remessa
            dados = [{"keyword": w, "details": self.bipes(w)} for w in kws if self.pacote(w)]
            return self._enviar(req, {"code": 1, "msg": "1:Solicitação concluída", "succ": True, "data": dados})
        if caminho == "/operatingplatform/order/getOrderDetail":
            if self.bloquear_rastreio:
                return self._enviar(req, "<html><head><title>Acesso negado · WAF</title></head><body>bloqueado</body></html>", 200, "text/html")
            seg = self.segmento(str(corpo.get("waybillNo")))
            if seg is None:
                return self._enviar(req, {"code": 1, "data": None})
            return self._enviar(req, {"code": 1, "msg": "success", "data": {"details": {
                "terminalDispatchCode": seg or None, "destinationDistributeName": "DEMO"}}})
        return self._enviar(req, {"code": 404, "msg": "não existe", "fail": True}, 404)
