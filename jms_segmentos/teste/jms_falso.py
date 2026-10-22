"""JMS de mentira para testar o app JMS_Segmentos: tela de login/rastreamento e getOrderDetail com falhas de propósito.

Tudo fictício: remessas 777xxxxxxxxxxxx, códigos XA/XB/XC/XD, token "tok-ficticio-N".
"""
import json
import random
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

S1 = ["XA", "XB", "XC", "XD"]


def esperado(waybill: str):
    """(s1, s2) que o JMS falso devolve; None = remessa não existe; ('', '') = sem código."""
    n = int(waybill[-6:])
    if n % 50 == 0:
        return None
    if n % 37 == 0:
        return ("", "")
    return (S1[n % 4], f"{100 + n % 7}-0{n % 3}")


class Estado:
    def __init__(self):
        self.token = "tok-ficticio-1"
        self.falha = 0.0          # chance de falha passageira por consulta
        self.max_juntas = 12      # acima disso o JMS responde "ocupado"
        self.juntas = 0
        self.pico = 0
        self.consultas = 0
        self.expira_em = None     # depois de N consultas o token vence
        self.lock = threading.Lock()
        self.rnd = random.Random(7)


PAGINA = """<!doctype html><html><head><meta charset="utf-8"><title>JMS falso</title></head><body>
<h1>JMS falso</h1><input id="w" value="777000000000001"><button id="b">Consultar</button><pre id="out"></pre>
<script>
const p=new URLSearchParams(location.hash.slice(1));
async function consultar(){
  const r=await fetch('/operatingplatform/order/getOrderDetail',{method:'POST',
    headers:{'Content-Type':'application/json;charset=UTF-8','authToken':p.get('tok')||'tok-ficticio-1','routeName':'trackingExpress','lang':'PT'},
    body:JSON.stringify({waybillNo:document.getElementById('w').value,countryId:'1'})});
  document.getElementById('out').textContent=await r.text();
}
document.getElementById('b').onclick=consultar;
if(p.get('tab')) window.open('/app/tracking#auto=1&tok='+(p.get('tok')||'tok-ficticio-1'));
if(p.get('auto')) consultar();
</script></body></html>"""


def criar(porta: int) -> tuple[ThreadingHTTPServer, Estado]:
    est = Estado()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body.encode() if isinstance(body, str) else body
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send(200, PAGINA, "text/html; charset=utf-8")

        def do_POST(self):
            size = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(size)
            if not self.path.startswith("/operatingplatform/order/getOrderDetail"):
                self._send(404, "{}")
                return
            with est.lock:
                est.consultas += 1
                est.juntas += 1
                est.pico = max(est.pico, est.juntas)
                juntas = est.juntas
                if est.expira_em is not None and est.consultas > est.expira_em:
                    est.token = "tok-vencido"
                    est.expira_em = None
                token_ok = self.headers.get("authToken") == est.token
                sorte = est.rnd.random()
                tipo = est.rnd.randrange(4)
            try:
                import time
                time.sleep(0.05)
                if not token_ok:
                    self._send(200, json.dumps({"code": 135010037, "msg": "token失效，请重新登录", "succ": False, "data": None}))
                    return
                if juntas > est.max_juntas or sorte < est.falha:
                    if tipo == 0:
                        self._send(502, "<html>Bad Gateway</html>", "text/html")
                    elif tipo == 1:
                        self._send(200, json.dumps({"code": 0, "msg": "系统繁忙，请稍后再试", "succ": False}))
                    elif tipo == 2:
                        self._send(200, "")
                    else:
                        self._send(200, json.dumps({"code": 1, "msg": "success", "succ": True, "data": {}}))
                    return
                body = json.loads(raw or b"{}")
                w = str(body.get("waybillNo") or "")
                exp = esperado(w) if w[-6:].isdigit() else None
                if exp is None:
                    self._send(200, json.dumps({"code": 1, "msg": "success", "succ": True, "data": {"details": None}}))
                    return
                code = f"{exp[0]},{exp[1]},900" if exp[0] else None
                det = {"waybillNo": w, "terminalDispatchCode": code, "outros": "x" * 2000}
                self._send(200, json.dumps({"code": 1, "msg": "success", "succ": True, "data": {"details": det}}))
            finally:
                with est.lock:
                    est.juntas -= 1

    srv = ThreadingHTTPServer(("127.0.0.1", porta), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, est
