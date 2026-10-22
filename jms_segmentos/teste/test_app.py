"""Teste do app JMS_Segmentos (consulta ao JMS) contra o JMS falso. Tudo fictício.

Uso: python -I test_app.py <pasta do app>   (precisa de fastapi, uvicorn, playwright e openpyxl)
Roda uma cópia do app.py com o Chromium sem janela (headless), numa pasta temporária.
"""
import asyncio, json, sys, tempfile, threading, time, urllib.error, urllib.request
from pathlib import Path
_copia = Path(tempfile.mkdtemp(prefix="app_teste_"))
(_copia / "app.py").write_text((Path(sys.argv[1]) / "app.py").read_text(encoding="utf-8").replace("headless=False,", "headless=True,"), encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent)); sys.path.insert(1, str(_copia))
import uvicorn, jms_falso, app as m

PJ, PA = 8795, 8796
falhas = 0
def check(ok, nome, extra=""):
    global falhas
    print(("OK   " if ok else "FALHOU ") + nome + ("" if ok else f"  -> {extra}")); falhas += (not ok)
def api(path, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PA}{path}", data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def esperar(cond, s=30):
    fim = time.time() + s
    while time.time() < fim:
        if cond(): return True
        time.sleep(0.2)
    return False
def conferir(rows, nome):
    det = {r["remessa"]: r for r in m.build_result(rows)["segmentos_extraidos"]}
    raw = {r["remessa"]: r for r in rows}
    errados = []
    for w, r in det.items():
        e = jms_falso.esperado(w)
        if e is None:
            if not raw[w].get("erro"): errados.append((w, "deveria faltar"))
        elif (r["codigo_primeiro_segmento"], r["codigo_dois_segmentos"]) != e or (e[0] and raw[w].get("erro")):
            errados.append((w, raw[w]))
    check(not errados, nome, errados[:4]); return errados

fake, est = jms_falso.criar(PJ)
m.JMS_URL = f"http://127.0.0.1:{PJ}/app/operatingplatform/index#tab=1"
m.PROFILE_DIR = Path(tempfile.mkdtemp(prefix="perfil_"))
srv = uvicorn.Server(uvicorn.Config(m.app, host="127.0.0.1", port=PA, log_level="warning"))
threading.Thread(target=srv.run, daemon=True).start()
check(esperar(lambda: srv.started, 15), "servidor sobe")
st, r = api("/api/browser/open", {})
check(st == 200 and r.get("ok"), "abre o Chromium (o original dava 'Sync API inside the asyncio loop')", r)
check(esperar(lambda: api("/api/status")[1].get("captured")), "captura a consulta de teste feita em OUTRA aba")
check(not any(k.startswith(":") for k in m._capture["headers"]), "sem cabeçalhos ':' na captura")
N = 3000
lista = [f"777{i:012d}" for i in range(1, N + 1)]
est.falha = 0.25
t0 = time.time(); rows = []
for i in range(0, N, 1000):
    st, part = api("/api/query", {"waybills": lista[i:i + 1000], "patterns": []})
    check(st == 200 and len(part["_raw_rows"]) == 1000, f"bloco {i // 1000 + 1} de 1.000 respondeu", (st, part.get("detail")))
    rows += part["_raw_rows"]
print(f"     {N} remessas em {time.time() - t0:.0f}s, {est.consultas} consultas, no máximo {est.pico} ao mesmo tempo (JMS falhando 25%)")
conferir(rows, "todas as remessas que existem vieram com os 2 códigos certos")
res = m.build_result(rows)
check(not any(r["codigo"] == "900" for r in res["grafico"]), "3º código fica de fora")
# Token vence: as remessas viram "Acesso negado ou sessão expirada"; nova consulta de teste e de novo: vêm todas.
est.falha = 0.0; est.token = "tok-ficticio-2"
lote = [f"777{i:012d}" for i in range(5001, 5201)]
st, part = api("/api/query", {"waybills": lote})
check(all(r.get("erro", "").startswith("Acesso negado") for r in part["_raw_rows"]), "token vencido: avisa 'Acesso negado ou sessão expirada'")
async def nova(): await m._context.pages[-1].goto(f"http://127.0.0.1:{PJ}/app/tracking?n=2#auto=1&tok=tok-ficticio-2")
asyncio.run_coroutine_threadsafe(nova(), m._pw_loop).result(60)
check(esperar(lambda: m._capture["headers"].get("authtoken") == "tok-ficticio-2"), "nova consulta de teste atualiza a captura")
st, part = api("/api/query", {"waybills": lote})
conferir(part["_raw_rows"], "depois da nova captura, vêm todas")
st, r = api("/api/browser/close", {})
check(st == 200 and not api("/api/status")[1]["browser_open"], "fecha o navegador")
print("\nRESULTADO:", "tudo certo" if not falhas else f"{falhas} falha(s)")
srv.should_exit = True
sys.exit(1 if falhas else 0)
