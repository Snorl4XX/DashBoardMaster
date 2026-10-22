from __future__ import annotations

import asyncio
import base64
import copy
import csv
import json
import os
import re
import secrets
import sys
import threading
import unicodedata
from collections import defaultdict
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from playwright.async_api import Error as PlaywrightError, async_playwright
from pydantic import BaseModel, Field


APP_DIR = Path(__file__).resolve().parent
PROFILE_DIR = APP_DIR / "perfil_jms_local"
JMS_URL = "https://jmsbr.jtjms-br.com/app/operatingplatform/index"
DETAIL_PATH = "/operatingplatform/order/getOrderDetail"
MAX_WAYBILLS = 1000
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
HEADLESS = os.getenv("JMS_SEGMENTOS_HEADLESS") == "1"
# Queries sent to the JMS at the same time, and attempts per waybill. A busy JMS answers empty or refuses,
# so failures are retried; at the end, whatever is still missing is checked again slowly.
PARALLEL = 8
ATTEMPTS = 4
RECHECK_PARALLEL = 2
RECHECK_ATTEMPTS = 2
RECHECK_PAUSE = 2.0
RETRY_PAUSE = 1.0
REQUEST_TIMEOUT_MS = 45000
FIELD_1 = "Código de primeiro segmento"
FIELD_2 = "Código de dois segmentos"
_AUTH_MSG_RE = re.compile(r"token|登录|登陆|login|expired|expirad|过期|失效|unauthori|未授权|无权限|权限不足|没有权限|认证|会话|session|sess[aã]o", re.I)

app = FastAPI(title="JMS - Pesquisa de Segmentos", docs_url=None, redoc_url=None)
_allowed_origins = [origin.strip() for origin in os.getenv("JMS_SEGMENTOS_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
if _allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def _private_network_access(request: Request, call_next):
        # Chrome asks before a public site may call 127.0.0.1 (Private Network Access preflight).
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network"):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

_lock = threading.RLock()
_playwright = None
_context = None
_capture: dict[str, Any] | None = None
_uploaded_sheets: dict[str, dict[str, Any]] = {}
_pw_loop: asyncio.AbstractEventLoop | None = None
_pw_thread: threading.Thread | None = None
_pw_ready = threading.Event()


class QueryRequest(BaseModel):
    waybills: list[str] = Field(default_factory=list)


class ExportRequest(BaseModel):
    result: dict[str, Any]


class AggregateRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(default_factory=list)


class SheetInspectRequest(BaseModel):
    filename: str
    content_base64: str


class SheetReadRequest(BaseModel):
    upload_id: str
    sheet_name: str
    column_index: int


def _run_pw_loop() -> None:
    global _pw_loop
    # Playwright's sync API cannot run inside uvicorn's asyncio loop, nor be shared between threads.
    # The browser lives in this thread, on its own loop that never stops (Proactor on Windows starts the driver).
    loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _pw_loop = loop
    _pw_ready.set()
    loop.run_forever()


async def _in_browser_thread(coro):
    global _pw_thread
    with _lock:
        if _pw_thread is None:
            _pw_thread = threading.Thread(target=_run_pw_loop, name="jms-playwright", daemon=True)
            _pw_thread.start()
    _pw_ready.wait(30)
    return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(coro, _pw_loop))


def _extract_waybill_from_body(body: Any) -> str | None:
    if isinstance(body, dict):
        for key, value in body.items():
            if key.lower() in {"waybillno", "waybillid", "billcode", "keyword"} and isinstance(value, (str, int)):
                candidate = str(value).strip()
                if re.fullmatch(r"\d{8,24}", candidate):
                    return candidate
        for value in body.values():
            found = _extract_waybill_from_body(value)
            if found:
                return found
    elif isinstance(body, list):
        for value in body:
            found = _extract_waybill_from_body(value)
            if found:
                return found
    elif isinstance(body, str):
        match = re.search(r"\b\d{8,24}\b", body)
        return match.group(0) if match else None
    return None


async def _on_request(request) -> None:
    global _capture
    try:
        if request.method.upper() != "POST" or DETAIL_PATH.casefold() not in request.url.casefold():
            return
        raw = request.post_data or ""
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = raw
        headers = await request.all_headers()
        # Browser-managed cookies are intentionally not copied into app state;
        # the Playwright context's API client shares the browser cookie jar.
        # HTTP/2 pseudo-headers (":authority", ":path"...) are refused when sent again, so they are dropped too.
        blocked = {"cookie", "host", "content-length", "connection", "accept-encoding", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"}
        safe_headers = {k: v for k, v in headers.items() if not k.startswith(":") and k.lower() not in blocked}
        with _lock:
            _capture = {
                "url": request.url,
                "headers": safe_headers,
                "body": body,
                "seed_waybill": _extract_waybill_from_body(body),
                "captured_at": datetime.now().isoformat(timespec="seconds"),
            }
    except Exception:
        # Do not let a diagnostic capture interfere with the JMS page.
        return


def _on_context_close(context) -> None:
    global _context
    with _lock:
        if _context is context:
            _context = None


def _normalize_inputs(waybills: list[str], patterns: list[str]) -> tuple[list[str], list[str]]:
    normalized_waybills: list[str] = []
    seen: set[str] = set()
    for raw in waybills:
        value = re.sub(r"\s+", "", str(raw or "")).strip()
        if value and value not in seen:
            normalized_waybills.append(value)
            seen.add(value)
    normalized_patterns: list[str] = []
    p_seen: set[str] = set()
    for raw in patterns:
        value = str(raw or "").strip()
        key = value.casefold()
        if value and key not in p_seen:
            normalized_patterns.append(value)
            p_seen.add(key)
    return normalized_waybills, normalized_patterns


def _normalize_header(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", text.casefold())


_WAYBILL_HEADERS = {"remessa", "waybill", "waybillno", "waybillid", "billcode", "encomenda", "encomendano", "numerodaremessa", "numerodaencomenda", "codigodaremessa"}


def _is_waybill_header(value: Any) -> bool:
    return _normalize_header(value) in _WAYBILL_HEADERS


def _parse_uploaded_file(filename: str, content: bytes) -> dict[str, list[list[Any]]]:
    suffix = Path(filename).suffix.casefold()
    if suffix in {".xlsx", ".xlsm"}:
        from openpyxl import load_workbook
        try:
            workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Não foi possível abrir a planilha: {exc}")
        sheets: dict[str, list[list[Any]]] = {}
        for sheet in workbook.worksheets:
            # Files exported in streaming mode declare a size of "A1"; read the real size instead.
            if hasattr(sheet, "reset_dimensions"):
                sheet.reset_dimensions()
            sheets[sheet.title] = [list(row) for row in sheet.iter_rows(values_only=True)]
        workbook.close()
        return sheets
    if suffix in {".csv", ".tsv", ".txt"}:
        try:
            decoded = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            decoded = content.decode("cp1252", errors="replace")
        delimiter = "\t" if suffix == ".tsv" else None
        if delimiter is None:
            try:
                delimiter = csv.Sniffer().sniff(decoded[:8192], delimiters=",;\t|").delimiter
            except csv.Error:
                delimiter = ";" if decoded.count(";") > decoded.count(",") else ","
        return {"Dados": [list(row) for row in csv.reader(decoded.splitlines(), delimiter=delimiter)]}
    raise HTTPException(status_code=400, detail="Use uma planilha .xlsx, .xlsm, .csv ou .tsv.")


def _sheet_header(rows: list[list[Any]]) -> tuple[int, list[str], int | None]:
    if not rows:
        return -1, [], None
    nonempty = [(i, row) for i, row in enumerate(rows[:50]) if any(value not in (None, "") for value in row)]
    if not nonempty:
        return -1, [], None
    header_index = -1
    for i, row in nonempty:
        if any(_is_waybill_header(value) for value in row):
            header_index = i
            break
    if header_index >= 0:
        raw_headers = rows[header_index]
        width = max((len(row) for row in rows[header_index:]), default=len(raw_headers))
        labels = [str(raw_headers[i]).strip() if i < len(raw_headers) and raw_headers[i] not in (None, "") else f"Coluna {i + 1}" for i in range(width)]
        selected = next((i for i, value in enumerate(raw_headers) if _is_waybill_header(value)), None)
        return header_index, labels, selected
    # If there is no header row, treat the first nonempty row as data and expose generic columns.
    width = max((len(row) for _, row in nonempty), default=0)
    labels = [f"Coluna {i + 1}" for i in range(width)]
    first_row = nonempty[0][1]
    suggested = next((i for i, value in enumerate(first_row) if re.fullmatch(r"\d{8,24}", _cell_text(value))), 0 if width else None)
    return -1, labels, suggested


def _cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _replace_seed(value: Any, seed: str | None, target: str) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key.lower() in {"waybillno", "waybillid", "billcode", "keyword"}:
                result[key] = target if isinstance(item, (str, int)) else _replace_seed(item, seed, target)
            else:
                result[key] = _replace_seed(item, seed, target)
        return result
    if isinstance(value, list):
        return [_replace_seed(item, seed, target) for item in value]
    if seed and isinstance(value, (str, int)) and str(value) == seed:
        return target
    return value


def _extract_details(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data") or {}
    if isinstance(data, dict):
        detail = data.get("details")
        if isinstance(detail, dict):
            return detail
        if any(key in data for key in ("terminalDispatchCode", "waybillNo", "waybillId")):
            return data
    return {}


def _split_segments(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_parts = value
    else:
        raw_parts = re.split(r"[,，;；|]", str(value))
    return [str(part).strip() for part in raw_parts if str(part).strip()]


def _session_row(waybill: str, reason: str) -> dict[str, Any]:
    return {"remessa": waybill, "erro": f"Sessão do JMS expirada: {reason}", "sessao": True}


async def _fetch_waybill(context, capture: dict[str, Any], waybill: str) -> dict[str, Any]:
    body = _replace_seed(capture.get("body"), capture.get("seed_waybill"), waybill)
    try:
        response = await context.request.post(
            capture["url"],
            data=body,
            headers=capture.get("headers") or {},
            timeout=REQUEST_TIMEOUT_MS,
            max_redirects=0,
        )
        try:
            status = response.status
            text_body = await response.text()
        finally:
            # Without dispose() every response body stays in memory until the browser closes.
            await response.dispose()
    except Exception as exc:
        if _context is not context:
            return _session_row(waybill, "o navegador do JMS foi fechado")
        return {"remessa": waybill, "erro": f"Falha de conexão com o JMS: {str(exc)[:160]}", "_retry": True}

    if status in (401, 403) or 300 <= status < 400:
        return _session_row(waybill, f"HTTP {status}")
    if status == 429 or status >= 500:
        return {"remessa": waybill, "erro": f"JMS ocupado (HTTP {status})", "_retry": True}
    if not 200 <= status < 300:
        return {"remessa": waybill, "erro": f"JMS respondeu HTTP {status}", "_retry": True}
    try:
        payload = json.loads(text_body)
    except json.JSONDecodeError:
        if text_body.lstrip().startswith("<"):
            return _session_row(waybill, "o JMS devolveu a tela de login")
        return {"remessa": waybill, "erro": "JMS respondeu vazio", "_retry": True}
    if not isinstance(payload, dict):
        return {"remessa": waybill, "erro": "Resposta inválida do JMS", "_retry": True}

    code = payload.get("code")
    succeeded = payload.get("succ") is True or (
        payload.get("succ") is not False and payload.get("fail") is not True and (code is None or str(code) in {"1", "200"})
    )
    if not succeeded:
        message = str(payload.get("msg") or payload.get("message") or "").strip()[:160]
        if str(code) in {"401", "403"} or _AUTH_MSG_RE.search(message):
            return _session_row(waybill, message or f"código {code}")
        # A busy JMS also refuses: try again instead of giving up on the waybill.
        return {"remessa": waybill, "erro": f"JMS recusou a consulta ({code}: {message or 'sem mensagem'})", "_retry": True}

    detail = _extract_details(payload)
    if not detail:
        # A busy JMS also answers "success" with no data: only after every attempt is the waybill "not found".
        return {"remessa": waybill, "erro": "Não encontrada no JMS (respondeu sem a Informação básica)", "nao_encontrada": True, "_retry": True}
    parts = _split_segments(detail.get("terminalDispatchCode"))
    row = {
        "remessa": waybill,
        "terminalDispatchCode": detail.get("terminalDispatchCode"),
        "waybillNo": detail.get("waybillNo") or detail.get("waybillId") or waybill,
        "codigo_primeiro_segmento": parts[0] if len(parts) > 0 else "",
        "codigo_dois_segmentos": parts[1] if len(parts) > 1 else "",
    }
    if not row["codigo_primeiro_segmento"] and not row["codigo_dois_segmentos"]:
        row["_recheck"] = True
    return row


def _row_rank(row: dict[str, Any]) -> int:
    if not row.get("erro"):
        return 3 if row.get("codigo_primeiro_segmento") or row.get("codigo_dois_segmentos") else 2
    return 1 if row.get("nao_encontrada") else 0


async def _query_waybills(waybills: list[str], capture: dict[str, Any]) -> list[dict[str, Any]]:
    context = _context
    if context is None:
        raise HTTPException(status_code=400, detail="A sessão do navegador foi fechada. Abra novamente o JMS e refaça a captura.")
    expired = asyncio.Event()
    empty_answers: dict[str, int] = defaultdict(int)

    async def run(waybill: str, attempts: int, gate: asyncio.Semaphore, pause: float) -> dict[str, Any]:
        best: dict[str, Any] = {}
        for attempt in range(attempts):
            if expired.is_set():
                return _session_row(waybill, "remessa não consultada")
            async with gate:
                row = await _fetch_waybill(context, capture, waybill)
            if row.get("sessao"):
                expired.set()
                return row
            if row.get("nao_encontrada"):
                empty_answers[waybill] += 1
            if not row.get("_retry"):
                return row
            # Keep the best answer of all attempts ("not found" beats a later "busy").
            if not best or _row_rank(row) >= _row_rank(best):
                best = row
            if attempt < attempts - 1:
                await asyncio.sleep(pause * (attempt + 1))
        return best

    gate = asyncio.Semaphore(PARALLEL)
    rows = list(await asyncio.gather(*(run(waybill, ATTEMPTS, gate, RETRY_PAUSE) for waybill in waybills)))

    # Slow second look at what came back failed, empty or without a code (the JMS under load does that).
    pending = [i for i, row in enumerate(rows) if not row.get("sessao") and (row.get("erro") or row.get("_recheck"))]
    if pending and not expired.is_set():
        await asyncio.sleep(RECHECK_PAUSE)
        slow = asyncio.Semaphore(RECHECK_PARALLEL)
        again = await asyncio.gather(*(run(rows[i]["remessa"], RECHECK_ATTEMPTS, slow, RETRY_PAUSE * 2) for i in pending))
        for i, row in zip(pending, again):
            if row.get("sessao") and rows[i].get("erro"):
                rows[i] = row
            elif not row.get("sessao") and _row_rank(row) >= _row_rank(rows[i]):
                rows[i] = row
    for i, row in enumerate(rows):
        row.pop("_retry", None)
        row.pop("_recheck", None)
        # One empty answer among failures is not proof: leave it as an error, so "Consultar as que faltaram" tries again.
        if row.get("nao_encontrada") and empty_answers[row["remessa"]] < 2:
            rows[i] = {"remessa": row["remessa"], "erro": "JMS ocupado: sem resposta certa depois de várias tentativas"}
    return rows


def _status_text(shipment: dict[str, Any], has_code: bool) -> str:
    if shipment.get("erro"):
        return "Não encontrada no JMS" if shipment.get("nao_encontrada") else str(shipment["erro"])
    return "OK" if has_code else "Sem código no JMS"


def build_result(rows: list[dict[str, Any]]) -> dict[str, Any]:
    fields = [
        (FIELD_1, "codigo_primeiro_segmento"),
        (FIELD_2, "codigo_dois_segmentos"),
    ]
    details: list[dict[str, Any]] = []
    counts: dict[tuple[str, str], set[str]] = defaultdict(set)
    errors = []
    with_code = without_code = not_found = 0
    for shipment in rows:
        waybill = str(shipment.get("remessa") or "")
        if shipment.get("erro"):
            errors.append({"remessa": waybill, "erro": _status_text(shipment, False)})
            details.append({"remessa": waybill, "codigo_primeiro_segmento": "", "codigo_dois_segmentos": "", "situacao": _status_text(shipment, False)})
            not_found += bool(shipment.get("nao_encontrada"))
            continue
        parts = _split_segments(shipment.get("terminalDispatchCode"))
        row = {"remessa": waybill, "codigo_primeiro_segmento": parts[0] if len(parts) > 0 else "", "codigo_dois_segmentos": parts[1] if len(parts) > 1 else ""}
        has_code = bool(row["codigo_primeiro_segmento"] or row["codigo_dois_segmentos"])
        row["situacao"] = _status_text(shipment, has_code)
        with_code += has_code
        without_code += not has_code
        details.append(row)
        for label, key in fields:
            code = row[key]
            if code:
                counts[(label, code)].add(waybill)

    order = {label: i for i, (label, _) in enumerate(fields)}
    summary = [
        {"campo": field, "codigo": code, "repeticoes": len(shipments), "remessas_unicas": len(shipments)}
        for (field, code), shipments in sorted(counts.items(), key=lambda entry: (order[entry[0][0]], -len(entry[1]), entry[0][1].casefold()))
    ]
    chart = [{"campo": item["campo"], "codigo": item["codigo"], "quantidade": item["repeticoes"]} for item in summary]
    return {
        "gerado_em": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "remessas_consultadas": len(rows),
        "remessas_com_erro": len(errors),
        "remessas_com_dados": with_code,
        "remessas_sem_codigo": without_code,
        "remessas_nao_encontradas": not_found,
        "codigos_retornados": sum(bool(row[key]) for row in details for _, key in fields),
        "segmentos_extraidos": details,
        "resumo": summary,
        "grafico": chart,
        "erros": errors,
    }


@app.get("/", response_class=HTMLResponse)
async def home():
    return HTMLResponse(PAGE)


async def _open_browser() -> dict[str, Any]:
    global _playwright, _context, _capture
    if _context is not None:
        return {"ok": True, "message": "Sessão JMS já está aberta."}
    with _lock:
        _capture = None
    try:
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        if _playwright is None:
            _playwright = await async_playwright().start()
        context = await _playwright.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=HEADLESS,
            args=["--start-maximized"],
            no_viewport=True,
        )
    except PlaywrightError as exc:
        raise HTTPException(status_code=500, detail=f"Não foi possível abrir o Chromium. Execute instalar.bat e tente novamente. Detalhe: {exc}")
    # Listen on the whole browser: the tracking screen may open in another tab.
    context.on("request", _on_request)
    context.on("close", _on_context_close)
    with _lock:
        _context = context
    page = context.pages[0] if context.pages else await context.new_page()
    try:
        await page.goto(JMS_URL, wait_until="domcontentloaded", timeout=90000)
    except PlaywrightError:
        pass
    return {"ok": True, "message": "Navegador aberto. Entre no JMS e faça uma consulta de teste."}


@app.post("/api/browser/open")
async def open_browser():
    return await _in_browser_thread(_open_browser())


async def _current_url() -> str:
    context = _context
    pages = context.pages if context is not None else []
    return pages[-1].url if pages else ""


@app.get("/api/status")
async def browser_status():
    opened = _context is not None
    current_url = ""
    if opened:
        try:
            current_url = await _in_browser_thread(_current_url())
        except Exception:
            current_url = ""
    with _lock:
        capture = copy.deepcopy(_capture)
    return {
        "browser_open": opened,
        "current_url": current_url,
        "captured": bool(capture),
        "captured_at": capture.get("captured_at") if capture else None,
        "seed_waybill": capture.get("seed_waybill") if capture else None,
        "endpoint": DETAIL_PATH if capture else None,
    }


@app.post("/api/sheets/inspect")
def inspect_sheet(request: SheetInspectRequest):
    try:
        content = base64.b64decode(request.content_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="O arquivo enviado não pôde ser lido.")
    if not content:
        raise HTTPException(status_code=400, detail="O arquivo está vazio.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="O limite para a planilha é de 25 MB.")
    parsed = _parse_uploaded_file(request.filename, content)
    upload_id = secrets.token_urlsafe(18)
    sheets = {}
    for name, rows in parsed.items():
        header_index, columns, suggested = _sheet_header(rows)
        sheets[name] = {"rows": rows, "header_index": header_index, "columns": columns, "suggested_index": suggested}
    with _lock:
        _uploaded_sheets.clear()
        _uploaded_sheets[upload_id] = sheets
    summary = [{"name": name, "columns": item["columns"], "suggested_index": item["suggested_index"], "header_row": item["header_index"] + 1 if item["header_index"] >= 0 else None} for name, item in sheets.items()]
    return {"upload_id": upload_id, "filename": Path(request.filename).name, "sheets": summary}


@app.post("/api/sheets/read")
def read_sheet(request: SheetReadRequest):
    with _lock:
        upload = _uploaded_sheets.get(request.upload_id)
        sheet = upload.get(request.sheet_name) if upload else None
    if not sheet:
        raise HTTPException(status_code=404, detail="Arquivo expirado. Selecione a planilha novamente.")
    if request.column_index < 0 or request.column_index >= len(sheet["columns"]):
        raise HTTPException(status_code=400, detail="Selecione uma coluna válida para as remessas.")
    start = sheet["header_index"] + 1
    waybills = []
    for row in sheet["rows"][start:]:
        if request.column_index < len(row):
            value = _cell_text(row[request.column_index])
            if value:
                waybills.append(value)
    unique, _ = _normalize_inputs(waybills, [])
    return {"waybills": unique, "count": len(unique), "column": sheet["columns"][request.column_index], "sheet_name": request.sheet_name}


async def _close_browser() -> None:
    global _playwright, _context, _capture
    context, playwright = _context, _playwright
    with _lock:
        _context = None
        _playwright = None
        _capture = None
    try:
        if context:
            await context.close()
    except Exception:
        pass
    try:
        if playwright:
            await playwright.stop()
    except Exception:
        pass


@app.post("/api/browser/close")
async def close_browser():
    await _in_browser_thread(_close_browser())
    return {"ok": True, "message": "Navegador fechado. A sessão local do JMS permanece salva neste computador."}


@app.post("/api/query")
async def query_jms(request: QueryRequest):
    waybills, _ = _normalize_inputs(request.waybills, [])
    if not waybills:
        raise HTTPException(status_code=400, detail="Informe pelo menos uma remessa.")
    if len(waybills) > MAX_WAYBILLS:
        raise HTTPException(status_code=400, detail=f"O limite é de {MAX_WAYBILLS} remessas por consulta. Remessas recebidas: {len(waybills)}.")
    with _lock:
        capture = copy.deepcopy(_capture)
    if not capture:
        raise HTTPException(status_code=400, detail="Faça primeiro uma consulta de teste no navegador JMS para o app capturar o formato da requisição.")
    if _context is None:
        raise HTTPException(status_code=400, detail="A sessão do navegador foi fechada. Abra novamente o JMS e refaça a captura.")

    rows = await _in_browser_thread(_query_waybills(waybills, capture))
    result = build_result(rows)
    result["_raw_rows"] = rows
    result["sessao_expirada"] = any(row.get("sessao") for row in rows)
    return result


@app.post("/api/aggregate")
def aggregate_results(request: AggregateRequest):
    return build_result(request.rows)


def _style_header(ws, row: int = 1) -> None:
    for cell in ws[row]:
        if cell.value is None:
            continue
        cell.fill = PatternFill("solid", fgColor="E31E24")
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[row].height = 24


def _fit_columns(ws) -> None:
    for col in ws.columns:
        width = min(max(max(len(str(c.value or "")) for c in col) + 2, 12), 52)
        ws.column_dimensions[get_column_letter(col[0].column)].width = width


def _summary_sheet(workbook: Workbook, result: dict[str, Any]) -> None:
    ws = workbook.create_sheet("Resumo")
    for n, label in enumerate((FIELD_1, FIELD_2)):
        col = 1 + n * 3
        items = [item for item in result.get("resumo", []) if item.get("campo") == label]
        ws.cell(row=1, column=col, value=label)
        ws.cell(row=1, column=col + 1, value="Remessas")
        for i, item in enumerate(items, start=2):
            ws.cell(row=i, column=col, value=item.get("codigo"))
            ws.cell(row=i, column=col + 1, value=item.get("repeticoes"))
        if not items:
            continue
        top = min(len(items), 15)
        chart = BarChart()
        chart.type = "bar"
        chart.title = f"{label} (mais remessas)"
        chart.legend = None
        chart.add_data(Reference(ws, min_col=col + 1, min_row=1, max_row=1 + top), titles_from_data=True)
        chart.set_categories(Reference(ws, min_col=col, min_row=2, max_row=1 + top))
        chart.x_axis.scaling.orientation = "maxMin"
        chart.x_axis.tickLblPos = "low"
        chart.y_axis.scaling.min = 0
        chart.y_axis.majorGridlines = None
        chart.x_axis.delete = False
        chart.y_axis.delete = False
        chart.series[0].graphicalProperties.solidFill = "E31E24"
        chart.series[0].graphicalProperties.line.solidFill = "E31E24"
        chart.dataLabels = DataLabelList(showVal=True, showCatName=False, showSerName=False, showLegendKey=False, showPercent=False)
        chart.height = max(7.5, 0.6 * top + 2)
        chart.width = 16
        ws.add_chart(chart, f"H{1 + n * 22}")
    _style_header(ws)
    _fit_columns(ws)
    ws.freeze_panes = "A2"


@app.post("/api/export")
def export_xlsx(request: ExportRequest):
    result = request.result
    workbook = Workbook()
    ws = workbook.active
    ws.title = "Resultado"
    ws.append(["Remessa", FIELD_1, FIELD_2])
    pending = []
    for row in result.get("segmentos_extraidos", []):
        ws.append([row.get("remessa"), row.get("codigo_primeiro_segmento"), row.get("codigo_dois_segmentos")])
        if row.get("situacao") and row.get("situacao") != "OK":
            pending.append([row.get("remessa"), row.get("situacao")])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    _style_header(ws)
    _fit_columns(ws)

    _summary_sheet(workbook, result)
    if pending:
        wp = workbook.create_sheet("Sem código")
        wp.append(["Remessa", "Situação"])
        for item in pending:
            wp.append(item)
        wp.freeze_panes = "A2"
        wp.auto_filter.ref = wp.dimensions
        _style_header(wp)
        _fit_columns(wp)

    output = BytesIO()
    workbook.save(output)
    content = output.getvalue()
    name = f"JMS_Segmentos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


PAGE = r'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JMS | Códigos de Segmento</title>
<style>
:root{--red:#e31e24;--red-dark:#b8141a;--ink:#1c2025;--muted:#667085;--line:#e7e9ed;--surface:#fff;--bg:#f4f5f7;--green:#16845b;--amber:#9a6500}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI",Arial,sans-serif}header{background:#fff;border-bottom:1px solid var(--line);padding:20px clamp(18px,4vw,56px);display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:12px}.mark{width:42px;height:42px;background:var(--red);border-radius:12px;color:white;font-size:17px;font-weight:800;display:grid;place-items:center;letter-spacing:-1px}.brand h1{font-size:19px;line-height:1.2;margin:0}.brand p{color:var(--muted);margin:3px 0 0;font-size:12px}.local{font-size:12px;color:#475467;background:#f5f6f8;border:1px solid var(--line);border-radius:20px;padding:7px 11px}.wrap{max-width:1360px;margin:26px auto;padding:0 20px 56px}.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;margin:14px 0;box-shadow:0 2px 8px #10182808}.step{display:flex;gap:14px}.number{width:30px;height:30px;border-radius:50%;background:#fff0f0;color:var(--red);display:grid;place-items:center;font-weight:800;flex:none}.stepmain{flex:1;min-width:0}.stephead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.stephead h3{font-size:16px;margin:0}.pill{font-size:12px;border-radius:20px;background:#f1f2f4;color:#667085;padding:5px 10px;white-space:nowrap}.pill.ok{background:#eaf7f1;color:var(--green)}.pill.wait{background:#fff5e5;color:var(--amber)}.small{font-size:12px;color:var(--muted)}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:13px}button{border:0;border-radius:9px;padding:10px 15px;font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:8px}button.primary{background:var(--red);color:#fff}button.primary:hover{background:var(--red-dark)}button.secondary{background:#f4f5f7;color:#252a31;border:1px solid var(--line)}button:disabled{opacity:.55;cursor:not-allowed}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:15px}.field label{display:block;font-weight:700;margin-bottom:7px}select,input[type=search]{width:100%;padding:9px 11px;border:1px solid #d0d5dd;border-radius:9px;font:13px "Segoe UI",Arial,sans-serif;background:#fff}input[type=file]{font-size:13px;max-width:100%}.notice{background:#fff8e8;border:1px solid #f4d58a;color:#694a00;border-radius:9px;padding:10px 12px;font-size:12px;margin-top:12px}.info{background:#f6f8fa;border:1px solid var(--line);border-radius:9px;padding:11px 12px;color:#475467;font-size:12px}.statusline{font-size:12px;color:var(--muted);min-height:18px}.progress{height:8px;background:#f0f1f3;border-radius:8px;overflow:hidden;margin-top:12px}.progress>div{height:100%;width:0;background:var(--red);border-radius:8px;transition:width .3s}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:15px 0}.metric{background:white;border:1px solid var(--line);border-radius:12px;padding:15px}.metric span{display:block;font-size:12px;color:var(--muted)}.metric strong{display:block;font-size:23px;margin-top:3px}.sectionTitle{font-size:16px;margin:0 0 12px}.chart{display:flex;flex-direction:column;gap:9px}.barrow{display:grid;grid-template-columns:minmax(70px,140px) 1fr 92px;gap:10px;align-items:center;font-size:12px}.barlabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Consolas,monospace;font-weight:700}.track{height:12px;background:#f0f1f3;border-radius:4px;overflow:hidden}.fill{height:100%;background:var(--red);border-radius:0 4px 4px 0}.barcount{text-align:right;font-weight:700;white-space:nowrap}.barcount small{color:var(--muted);font-weight:400}.tablewrap{overflow:auto;border:1px solid var(--line);border-radius:9px;max-height:460px}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th{position:sticky;top:0;background:#f7f7f8;text-align:left;color:#475467;font-weight:700;padding:10px;border-bottom:1px solid var(--line)}td{padding:9px 10px;border-bottom:1px solid #eef0f2}td.code{font-family:Consolas,monospace;font-weight:700}tr:last-child td{border-bottom:0}.empty{padding:20px;text-align:center;color:var(--muted)}.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 10px}.tab{background:#f1f2f4;border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12px;font-weight:700}.tab.active{background:#fff0f0;border-color:#ffd0d1;color:var(--red)}.tools{display:flex;gap:10px;align-items:center;margin-bottom:10px}.tools input{max-width:320px}.hidden{display:none!important}.error{color:#b42318}.footer{text-align:center;color:#98a2b3;font-size:11px;margin-top:22px}
@media(max-width:760px){header{padding:15px 16px;align-items:flex-start}.local{display:none}.wrap{padding:0 12px 34px;margin-top:18px}.card{padding:15px}.grid2{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.step{gap:10px}.stephead{flex-wrap:wrap}.pill{white-space:normal}.barrow{grid-template-columns:70px 1fr 78px}.brand h1{font-size:16px}}
</style>
</head>
<body>
<header><div class="brand"><div class="mark">J&amp;T</div><div><h1>Códigos de Segmento</h1><p>JMS · Informação básica · 3 Segmentos</p></div></div><div class="local">🔒 Tudo roda neste computador</div></header>
<main class="wrap">
<section class="card step"><div class="number">1</div><div class="stepmain"><div class="stephead"><h3>Conectar ao JMS</h3><span id="browserPill" class="pill">Navegador não iniciado</span></div><div class="info">O app abre um Chromium. Entre no JMS por ele; o app não pede senha nem token.</div><div class="notice">Depois do login, no Chromium: <b>Operação → Consulta do pacote → Rastreamento do pacote</b>, digite 1 remessa e clique em <b>Consultar</b>. Espere aparecer “Consulta capturada”.</div><div class="actions"><button id="openBtn" class="primary" onclick="openBrowser()">Abrir sessão do JMS</button><button class="secondary" onclick="closeBrowser()">Fechar navegador</button><span id="capturePill" class="pill wait">Aguardando consulta de teste</span><span id="browserMsg" class="statusline"></span></div></div></section>
<section class="card step"><div class="number">2</div><div class="stepmain"><div class="stephead"><h3>Planilha com as remessas</h3><span class="pill">.xlsx, .xlsm, .csv · até 25 MB</span></div><input id="file" type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" onchange="lerArquivo(this)"><div id="pickers" class="grid2 hidden" style="margin-top:14px"><div class="field"><label for="aba">Aba</label><select id="aba" onchange="escolherAba()"></select></div><div class="field"><label for="coluna">Coluna das remessas</label><select id="coluna" onchange="lerColuna()"></select></div></div><div id="sheetMsg" class="statusline" style="margin-top:10px"></div></div></section>
<section class="card step"><div class="number">3</div><div class="stepmain"><div class="stephead"><h3>Consultar no JMS</h3><span class="pill">Várias ao mesmo tempo · tenta de novo quando o JMS falha</span></div><div class="actions" style="margin-top:0"><button id="queryBtn" class="primary" onclick="consultar(false)" disabled>Consultar remessas</button><button id="stopBtn" class="secondary hidden" onclick="pararPesquisa()">Parar</button><button id="retryBtn" class="secondary hidden" onclick="consultar(true)">Consultar as que faltaram</button></div><div class="progress"><div id="bar"></div></div><div id="queryMsg" class="statusline" style="margin-top:8px"></div></div></section>
<section id="results" class="hidden">
<div class="metrics"><div class="metric"><span>Remessas da aba</span><strong id="mTotal">0</strong></div><div class="metric"><span>Com código</span><strong id="mOk">0</strong></div><div class="metric"><span>Sem código no JMS</span><strong id="mSem">0</strong></div><div class="metric"><span>Não encontradas ou com erro</span><strong id="mErro">0</strong></div></div>
<div class="grid2"><section class="card" style="margin:0"><h3 class="sectionTitle">Código de primeiro segmento</h3><div id="chart1" class="chart"></div></section><section class="card" style="margin:0"><h3 class="sectionTitle">Código de dois segmentos</h3><div id="chart2" class="chart"></div></section></div>
<section class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><h3 class="sectionTitle" style="margin:0">Tabelas</h3><button class="primary" onclick="downloadXlsx()">Baixar planilha Excel</button></div><div class="tabs"><button class="tab active" data-tab="rows" onclick="showTab('rows')">Remessas</button><button class="tab" data-tab="summary" onclick="showTab('summary')">Resumo por código</button><button class="tab" data-tab="errors" onclick="showTab('errors')">Sem código</button></div><div class="tools" id="searchBox"><input id="search" type="search" placeholder="Procurar remessa ou código" oninput="tabelaRemessas()"><span id="rowsInfo" class="small"></span></div><div id="tab-rows" class="tablewrap"></div><div id="tab-summary" class="tablewrap hidden"></div><div id="tab-errors" class="tablewrap hidden"></div><div id="exportMsg" class="statusline" style="margin-top:9px"></div></section>
<div class="small" id="generated"></div></section>
<div class="footer">JMS Segmentos · App local · Fonte: Informação básica → terminalDispatchCode (1º e 2º códigos; o 3º fica de fora)</div>
</main>
<script>
const BLOCO=500,LIMITE_TABELA=1000;
let lista=[],linhas=new Map(),resultado=null,upload=null,rodando=false,parar=false;
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('pt-BR');
async function api(path,body){const opts=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};let res;try{res=await fetch(path,opts)}catch{throw new Error('o app local não respondeu (a janela do servidor foi fechada?)')}let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.detail||'Falha ao comunicar com o app local');return data}
function msg(id,text,error=false){const el=$(id);el.textContent=text||'';el.className='statusline'+(error?' error':'')}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function openBrowser(){const b=$('openBtn');b.disabled=true;msg('browserMsg','Abrindo Chromium...');try{const r=await api('/api/browser/open',{});msg('browserMsg',r.message);await refreshStatus()}catch(e){msg('browserMsg',e.message,true)}finally{b.disabled=false}}
async function closeBrowser(){try{const r=await api('/api/browser/close',{});msg('browserMsg',r.message);await refreshStatus()}catch(e){msg('browserMsg',e.message,true)}}
async function refreshStatus(){try{const s=await api('/api/status');const bp=$('browserPill'),cp=$('capturePill');bp.textContent=s.browser_open?'Navegador aberto':'Navegador não iniciado';bp.className='pill '+(s.browser_open?'ok':'');cp.textContent=s.captured?'Consulta capturada às '+String(s.captured_at||'').slice(11,16):'Aguardando consulta de teste';cp.className='pill '+(s.captured?'ok':'wait')}catch(e){}}
async function lerArquivo(input){const f=input.files[0];if(!f)return;if(f.size>25*1024*1024){msg('sheetMsg','O limite é 25 MB.',true);return}msg('sheetMsg','Lendo a planilha...');lista=[];atualizarBotoes();try{const b64=await new Promise((ok,err)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>err(new Error('não deu para ler o arquivo'));r.readAsDataURL(f)});upload=await api('/api/sheets/inspect',{filename:f.name,content_base64:b64});const pref=Math.max(0,upload.sheets.findIndex(s=>s.suggested_index!==null&&s.header_row));$('aba').innerHTML=upload.sheets.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join('');$('aba').value=pref;$('pickers').classList.remove('hidden');escolherAba()}catch(e){msg('sheetMsg',e.message,true)}}
function escolherAba(){const s=upload.sheets[$('aba').value];$('coluna').innerHTML=s.columns.map((c,i)=>`<option value="${i}">${esc(c)}</option>`).join('');if(s.suggested_index!==null)$('coluna').value=s.suggested_index;lerColuna()}
async function lerColuna(){const s=upload.sheets[$('aba').value];lista=[];if(!s.columns.length){msg('sheetMsg','Esta aba está vazia.',true);atualizarBotoes();return}try{const r=await api('/api/sheets/read',{upload_id:upload.upload_id,sheet_name:s.name,column_index:Number($('coluna').value)});lista=r.waybills;msg('sheetMsg',`${fmt(r.count)} remessas na aba “${r.sheet_name}”, coluna “${r.column}” (as repetidas contam uma vez).`,!r.count)}catch(e){msg('sheetMsg',e.message,true)}atualizarBotoes()}
function falta(r){return !r||(!!r.erro&&!r.nao_encontrada)}
function contar(){let ok=0,sem=0,nao=0,erro=0;for(const w of lista){const r=linhas.get(w);if(!r)continue;if(r.erro){r.nao_encontrada?nao++:erro++}else if(r.codigo_primeiro_segmento||r.codigo_dois_segmentos)ok++;else sem++}return{ok,sem,nao,erro}}
function atualizarBotoes(){$('queryBtn').disabled=rodando||!lista.length;$('stopBtn').classList.toggle('hidden',!rodando);const faltam=linhas.size?lista.filter(w=>falta(linhas.get(w))).length:0;$('retryBtn').classList.toggle('hidden',rodando||!faltam);$('retryBtn').textContent=`Consultar as que faltaram (${fmt(faltam)})`}
function progresso(feitas,total,inicio){const c=contar();$('bar').style.width=(total?feitas/total*100:0)+'%';let eta='';if(feitas&&feitas<total){const s=(Date.now()-inicio)/feitas*(total-feitas)/1000;eta=' · faltam ~'+(s<90?Math.ceil(s)+' s':Math.ceil(s/60)+' min')}msg('queryMsg',`Consultando ${fmt(feitas)} de ${fmt(total)}${eta} · com código ${fmt(c.ok)} · sem código ${fmt(c.sem)} · não encontradas ${fmt(c.nao)} · com erro ${fmt(c.erro)}`)}
function pararPesquisa(){parar=true;msg('queryMsg','Parando depois do bloco atual...')}
async function consultar(soFaltam){if(rodando)return;const alvo=soFaltam?lista.filter(w=>falta(linhas.get(w))):lista.slice();if(!alvo.length){msg('queryMsg','Escolha a planilha, a aba e a coluna das remessas.',true);return}if(!soFaltam){linhas=new Map();resultado=null;$('results').classList.add('hidden')}rodando=true;parar=false;atualizarBotoes();const inicio=Date.now();let feitas=0,motivo='';progresso(0,alvo.length,inicio);try{for(let i=0;i<alvo.length&&!parar;i+=BLOCO){const bloco=alvo.slice(i,i+BLOCO);const part=await api('/api/query',{waybills:bloco});for(const r of part._raw_rows||[])linhas.set(r.remessa,r);feitas+=bloco.length;progresso(feitas,alvo.length,inicio);if(part.sessao_expirada){motivo='sessao';break}}}catch(e){motivo=e.message}rodando=false;try{await montar()}catch(e){motivo=motivo||e.message}const faltam=lista.filter(w=>falta(linhas.get(w))).length;if(motivo==='sessao')msg('queryMsg',`A sessão do JMS expirou. No Chromium, entre de novo no JMS, consulte 1 remessa e clique em “Consultar as que faltaram” (${fmt(faltam)}).`,true);else if(motivo)msg('queryMsg',`A pesquisa parou: ${motivo}. Clique em “Consultar as que faltaram” para continuar.`,true);else if(parar)msg('queryMsg',`Pesquisa parada. Faltam ${fmt(faltam)} remessas.`);else msg('queryMsg',`Pesquisa concluída: ${fmt(lista.length)} remessas.`+(faltam?` ${fmt(faltam)} ficaram com erro: clique em “Consultar as que faltaram”.`:''),!!faltam);atualizarBotoes()}
async function montar(){if(!linhas.size)return;const rows=lista.map(w=>linhas.get(w)||{remessa:w,erro:'Ainda não consultada'});resultado=await api('/api/aggregate',{rows});render(resultado);$('results').classList.remove('hidden')}
function grafico(id,campo,d){const itens=d.grafico.filter(x=>x.campo===campo),base=Math.max(1,d.remessas_com_dados),top=itens.slice(0,15),resto=itens.slice(15),max=Math.max(1,...top.map(x=>x.quantidade));let html=top.map(x=>{const p=(x.quantidade/base*100).toLocaleString('pt-BR',{maximumFractionDigits:1});return`<div class="barrow" title="${esc(x.codigo)}: ${fmt(x.quantidade)} remessas (${p}%)"><div class="barlabel">${esc(x.codigo)}</div><div class="track"><div class="fill" style="width:${Math.max(1,x.quantidade/max*100)}%"></div></div><div class="barcount">${fmt(x.quantidade)} <small>${p}%</small></div></div>`}).join('');if(resto.length)html+=`<div class="small">+ ${fmt(resto.length)} outros códigos com ${fmt(resto.reduce((a,x)=>a+x.quantidade,0))} remessas (veja “Resumo por código”).</div>`;$(id).innerHTML=html||'<div class="empty">Nenhum código encontrado.</div>'}
function table(target,headers,rows,values,codeCols=[]){const el=$(target);if(!rows||!rows.length){el.innerHTML='<div class="empty">Nenhum registro para exibir.</div>';return}let html='<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>';for(const row of rows){html+='<tr>'+values.map(k=>'<td'+(codeCols.includes(k)?' class="code"':'')+'>'+esc(row[k])+'</td>').join('')+'</tr>'}el.innerHTML=html+'</tbody></table>'}
function tabelaRemessas(){if(!resultado)return;const q=$('search').value.trim().toLowerCase();const todas=resultado.segmentos_extraidos;const achadas=q?todas.filter(r=>[r.remessa,r.codigo_primeiro_segmento,r.codigo_dois_segmentos,r.situacao].some(v=>String(v||'').toLowerCase().includes(q))):todas;table('tab-rows',['Remessa','Código de primeiro segmento','Código de dois segmentos','Situação'],achadas.slice(0,LIMITE_TABELA),['remessa','codigo_primeiro_segmento','codigo_dois_segmentos','situacao'],['codigo_primeiro_segmento','codigo_dois_segmentos']);$('rowsInfo').textContent=achadas.length>LIMITE_TABELA?`Mostrando ${fmt(LIMITE_TABELA)} de ${fmt(achadas.length)}. A planilha Excel traz todas.`:`${fmt(achadas.length)} remessas`}
function render(d){$('mTotal').textContent=fmt(d.remessas_consultadas);$('mOk').textContent=fmt(d.remessas_com_dados);$('mSem').textContent=fmt(d.remessas_sem_codigo);$('mErro').textContent=fmt(d.remessas_com_erro);grafico('chart1','Código de primeiro segmento',d);grafico('chart2','Código de dois segmentos',d);tabelaRemessas();table('tab-summary',['Campo','Código','Remessas'],d.resumo,['campo','codigo','repeticoes'],['codigo']);table('tab-errors',['Remessa','Situação'],d.segmentos_extraidos.filter(r=>r.situacao!=='OK'),['remessa','situacao']);$('generated').textContent='Gerado em '+d.gerado_em+'. O 3º código (campo “3 Segmentos”) fica de fora.'}
function showTab(name){document.querySelectorAll('[id^="tab-"]').forEach(x=>x.classList.toggle('hidden',x.id!=='tab-'+name));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));$('searchBox').classList.toggle('hidden',name!=='rows')}
async function downloadXlsx(){if(!resultado)return;msg('exportMsg','Preparando Excel...');try{const res=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:resultado})});if(!res.ok){let err={};try{err=await res.json()}catch{}throw new Error(err.detail||'Falha ao gerar Excel')}const blob=await res.blob();const nome=((res.headers.get('Content-Disposition')||'').match(/filename="([^"]+)"/)||[])[1]||'JMS_Segmentos.xlsx';const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);msg('exportMsg','Planilha baixada: aba Resultado (remessa e os 2 códigos), Resumo com gráficos e Sem código.')}catch(e){msg('exportMsg',e.message,true)}}
refreshStatus();setInterval(refreshStatus,3000);
</script>
</body></html>'''


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8765, log_level="warning")
