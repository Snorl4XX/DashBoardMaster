from __future__ import annotations

import asyncio
import copy
import base64
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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from openpyxl import Workbook
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
# A busy JMS answers empty or refuses: query several at once, try again, then take a slow second look.
PARALLEL = 8
ATTEMPTS = 5
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
_lock = threading.RLock()
_playwright = None
_context = None
_page = None
_capture: dict[str, Any] | None = None
_uploaded_sheets: dict[str, dict[str, Any]] = {}
_pw_loop: asyncio.AbstractEventLoop | None = None
_pw_thread: threading.Thread | None = None
_pw_ready = threading.Event()


def _run_pw_loop() -> None:
    global _pw_loop
    # Playwright's sync API cannot run inside uvicorn's asyncio loop ("It looks like you are using Playwright Sync API
    # inside the asyncio loop"), so the browser lives in this thread, on its own loop (Proactor on Windows).
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
        blocked = {"cookie", "host", "content-length", "connection", "accept-encoding", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"}
        # HTTP/2 pseudo-headers (":authority", ":path"...) are refused when sent again.
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
    suggested = next((i for i, value in enumerate(first_row) if re.fullmatch(r"\d{8,24}", str(value or "").strip())), 0 if width else None)
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


def build_result(rows: list[dict[str, Any]]) -> dict[str, Any]:
    fields = [
        ("Código de primeiro segmento", "codigo_primeiro_segmento"),
        ("Código de dois segmentos", "codigo_dois_segmentos"),
    ]
    details: list[dict[str, Any]] = []
    counts: dict[tuple[str, str], set[str]] = defaultdict(set)
    errors = []
    for shipment in rows:
        if shipment.get("erro"):
            errors.append({"remessa": shipment["remessa"], "erro": shipment["erro"]})
            details.append({"remessa": shipment["remessa"], "codigo_primeiro_segmento": "", "codigo_dois_segmentos": ""})
            continue
        parts = _split_segments(shipment.get("terminalDispatchCode"))
        row = {"remessa": shipment["remessa"], "codigo_primeiro_segmento": parts[0] if len(parts) > 0 else "", "codigo_dois_segmentos": parts[1] if len(parts) > 1 else ""}
        details.append(row)
        for label, key in fields:
            code = row[key]
            if code:
                counts[(label, code)].add(row["remessa"])

    summary = [
        {"campo": field, "codigo": code, "repeticoes": len(shipments), "remessas_unicas": len(shipments)}
        for (field, code), shipments in sorted(counts.items(), key=lambda entry: (-len(entry[1]), entry[0][0], entry[0][1].casefold()))
    ]
    chart = [{"campo": item["campo"], "codigo": item["codigo"], "quantidade": item["repeticoes"]} for item in summary]
    return {
        "gerado_em": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "remessas_consultadas": len(rows),
        "remessas_com_erro": len(errors),
        "remessas_com_dados": len(details),
        "codigos_retornados": sum(bool(row[key]) for row in details for _, key in fields),
        "segmentos_extraidos": details,
        "resumo": summary,
        "grafico": chart,
        "erros": errors,
    }


@app.get("/", response_class=HTMLResponse)
async def home():
    return HTMLResponse("""<!doctype html><html lang='pt-BR'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Agente JMS Segmentos</title><style>body{font:16px/1.6 'Segoe UI',Arial,sans-serif;background:#f5f6f8;color:#20232a;margin:0;padding:8vh 20px}.card{max-width:680px;margin:auto;background:#fff;border:1px solid #e5e8ed;border-radius:16px;padding:32px;box-shadow:0 4px 18px #0000000c}.red{color:#e31e24}a{display:inline-block;background:#e31e24;color:white;text-decoration:none;padding:11px 16px;border-radius:9px;font-weight:700}.muted{color:#667085;font-size:14px}</style><main class='card'><h1><span class='red'>J&amp;T</span> Agente JMS Segmentos</h1><p>O agente local está ativo. Use o site para carregar uma aba da planilha, pesquisar remessas e exportar os códigos dos dois primeiros segmentos.</p><p class='muted'>A sessão JMS e as consultas permanecem neste computador.</p><a href='https://jms-segmentos.caikeoliveiradealenc.chatgpt.site/'>Abrir JMS Segmentos</a></main></html>""")


async def _open_browser():
    global _playwright, _context, _page, _capture
    if _context is not None:
        return {"ok": True, "message": "Sessão JMS já está aberta."}
    try:
        _capture = None
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        if _playwright is None:
            _playwright = await async_playwright().start()
        _context = await _playwright.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            args=["--start-maximized"],
            no_viewport=True,
        )
    except PlaywrightError as exc:
        _page = None
        _context = None
        if _playwright:
            try:
                await _playwright.stop()
            except Exception:
                pass
            _playwright = None
        raise HTTPException(status_code=500, detail=f"Não foi possível abrir o Chromium. Execute instalar.bat e tente novamente. Detalhe: {exc}")
    # Listen on every tab: Rastreamento do pacote may open in a new one.
    _context.on("request", _on_request)
    _context.on("close", _on_context_close)
    _page = _context.pages[0] if _context.pages else await _context.new_page()
    try:
        await _page.goto(JMS_URL, wait_until="domcontentloaded", timeout=90000)
    except PlaywrightError:
        pass  # a slow JMS page does not close the browser; the user can keep going in it
    return {"ok": True, "message": "Navegador aberto. Entre no JMS e faça uma consulta de teste."}


@app.post("/api/browser/open")
async def open_browser():
    return await _in_browser_thread(_open_browser())


@app.get("/api/status")
async def browser_status():
    global _capture
    opened = _context is not None
    current_url = ""
    if opened and _page is not None:
        try:
            if not _page.is_closed():
                current_url = _page.url
        except Exception:
            pass
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
async def inspect_sheet(request: SheetInspectRequest):
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
async def read_sheet(request: SheetReadRequest):
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
    global _playwright, _context, _page, _capture
    try:
        if _context:
            await _context.close()
    except Exception:
        pass
    try:
        if _playwright:
            await _playwright.stop()
    except Exception:
        pass
    _context = None
    _page = None
    _playwright = None
    _capture = None


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
        context = _context
    if not capture:
        raise HTTPException(status_code=400, detail="Faça primeiro uma consulta de teste no navegador JMS para o app capturar o formato da requisição.")
    if context is None:
        raise HTTPException(status_code=400, detail="A sessão do navegador foi fechada. Abra novamente o JMS e refaça a captura.")

    rows = await _in_browser_thread(_query_waybills(context, capture, waybills))
    result = build_result(rows)
    result["_raw_rows"] = rows
    return result


async def _fetch_waybill(context, capture: dict[str, Any], waybill: str) -> tuple[dict[str, Any], bool]:
    """One query to the JMS. Returns the row and whether it is worth trying again (busy JMS)."""
    body = _replace_seed(capture.get("body"), capture.get("seed_waybill"), waybill)
    try:
        response = await context.request.post(
            capture["url"],
            data=body,
            headers=capture.get("headers") or {},
            timeout=60000,
        )
        try:
            status = response.status
            text_body = await response.text()
        finally:
            # Without dispose() every answer stays in memory until the browser closes.
            await response.dispose()
    except Exception as exc:
        return {"remessa": waybill, "erro": str(exc)[:240]}, True
    try:
        payload = json.loads(text_body)
    except json.JSONDecodeError:
        payload = {}
    message = str((payload.get("msg") if isinstance(payload, dict) else "") or "")
    refused = isinstance(payload, dict) and payload.get("succ") is False
    if status in (401, 403) or (refused and _AUTH_MSG_RE.search(message)):
        return {"remessa": waybill, "erro": f"Acesso negado ou sessão expirada: {message or f'HTTP {status}'}"}, False
    if refused:
        # A busy JMS also refuses ("系统繁忙"...): that is not an expired session, so try again.
        return {"remessa": waybill, "erro": f"JMS recusou a consulta: {message or 'sem mensagem'}"}, True
    if not 200 <= status < 300:
        return {"remessa": waybill, "erro": f"JMS respondeu HTTP {status}."}, True
    detail = _extract_details(payload)
    if not detail:
        # A busy JMS also answers empty: try again before giving up on the waybill.
        return {"remessa": waybill, "erro": "Resposta sem dados de Informação Básica"}, True
    return {
        "remessa": waybill,
        "terminalDispatchCode": detail.get("terminalDispatchCode"),
        "waybillNo": detail.get("waybillNo") or detail.get("waybillId") or waybill,
    }, False


async def _query_waybills(context, capture: dict[str, Any], waybills: list[str]) -> list[dict[str, Any]]:
    async def run(waybill: str, gate: asyncio.Semaphore, attempts: int, pause: float) -> dict[str, Any]:
        row: dict[str, Any] = {}
        for attempt in range(attempts):
            async with gate:
                row, again = await _fetch_waybill(context, capture, waybill)
            if not again:
                return row
            if attempt < attempts - 1:
                await asyncio.sleep(pause * (attempt + 1))
        return row

    fast = asyncio.Semaphore(PARALLEL)
    rows = list(await asyncio.gather(*(run(waybill, fast, ATTEMPTS, 1.0) for waybill in waybills)))
    # Slow second look at what still failed.
    failed = [i for i, row in enumerate(rows) if row.get("erro") and not row["erro"].startswith("Acesso negado")]
    if failed:
        await asyncio.sleep(3)
        slow = asyncio.Semaphore(2)
        again = await asyncio.gather(*(run(rows[i]["remessa"], slow, 3, 2.0) for i in failed))
        for i, row in zip(failed, again):
            if not row.get("erro"):
                rows[i] = row
    return rows


@app.post("/api/aggregate")
async def aggregate_results(request: AggregateRequest):
    return build_result(request.rows)


@app.post("/api/export")
async def export_xlsx(request: ExportRequest):
    result = request.result
    workbook = Workbook()
    ws = workbook.active
    ws.title = "Resultado"
    ws.append(["Remessa", "Código de primeiro segmento", "Código de dois segmentos"])
    for row in result.get("segmentos_extraidos", []):
        ws.append([row.get("remessa"), row.get("codigo_primeiro_segmento"), row.get("codigo_dois_segmentos")])

    red = "E31E24"
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for cell in ws[1]:
        cell.fill = PatternFill("solid", fgColor=red)
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for col in ws.columns:
        width = min(max(max(len(str(c.value or "")) for c in col) + 2, 12), 52)
        ws.column_dimensions[get_column_letter(col[0].column)].width = width
    ws.row_dimensions[1].height = 24

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
<title>JMS | Pesquisa de Segmentos</title>
<style>
:root{--red:#e31e24;--red-dark:#b8141a;--ink:#1c2025;--muted:#667085;--line:#e7e9ed;--surface:#fff;--bg:#f4f5f7;--green:#16845b;--amber:#9a6500}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI",Arial,sans-serif}header{background:#fff;border-bottom:1px solid var(--line);padding:20px clamp(18px,4vw,56px);display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:12px}.mark{width:42px;height:42px;background:var(--red);border-radius:12px;color:white;font-size:17px;font-weight:800;display:grid;place-items:center;letter-spacing:-1px}.brand h1{font-size:19px;line-height:1.2;margin:0}.brand p{color:var(--muted);margin:3px 0 0;font-size:12px}.local{font-size:12px;color:#475467;background:#f5f6f8;border:1px solid var(--line);border-radius:20px;padding:7px 11px}.wrap{max-width:1360px;margin:26px auto;padding:0 20px 56px}.intro{margin:0 0 18px}.intro h2{font-size:22px;margin:0 0 4px}.intro p{margin:0;color:var(--muted)}.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;margin:14px 0;box-shadow:0 2px 8px #10182808}.step{display:flex;gap:14px}.number{width:30px;height:30px;border-radius:50%;background:#fff0f0;color:var(--red);display:grid;place-items:center;font-weight:800;flex:none}.stepmain{flex:1;min-width:0}.stephead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.stephead h3{font-size:16px;margin:0}.pill{font-size:12px;border-radius:20px;background:#f1f2f4;color:#667085;padding:5px 10px;white-space:nowrap}.pill.ok{background:#eaf7f1;color:var(--green)}.pill.wait{background:#fff5e5;color:var(--amber)}.small{font-size:12px;color:var(--muted)}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:13px}button,.button{border:0;border-radius:9px;padding:10px 15px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px}button.primary{background:var(--red);color:#fff}button.primary:hover{background:var(--red-dark)}button.secondary{background:#f4f5f7;color:#252a31;border:1px solid var(--line)}button:disabled{opacity:.55;cursor:wait}textarea{display:block;width:100%;min-height:105px;resize:vertical;padding:12px 13px;border:1px solid #d0d5dd;border-radius:9px;font:13px/1.5 Consolas,"Courier New",monospace;outline:none}textarea:focus{border-color:#e31e24;box-shadow:0 0 0 3px #e31e241a}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:15px}.field label{display:block;font-weight:700;margin-bottom:7px}.field .hint{font-size:12px;color:var(--muted);margin-top:5px}.notice{background:#fff8e8;border:1px solid #f4d58a;color:#694a00;border-radius:9px;padding:10px 12px;font-size:12px;margin-top:12px}.info{background:#f6f8fa;border:1px solid var(--line);border-radius:9px;padding:11px 12px;color:#475467;font-size:12px}.statusline{font-size:12px;color:var(--muted);min-height:18px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:15px 0}.metric{background:white;border:1px solid var(--line);border-radius:12px;padding:15px}.metric span{display:block;font-size:12px;color:var(--muted)}.metric strong{display:block;font-size:23px;margin-top:3px}.sectionTitle{font-size:16px;margin:0 0 12px}.chart{display:flex;flex-direction:column;gap:9px}.barrow{display:grid;grid-template-columns:minmax(120px,220px) 1fr 48px;gap:10px;align-items:center;font-size:12px}.barlabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Consolas,monospace}.track{height:13px;background:#f0f1f3;border-radius:12px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#f05a5f,var(--red));border-radius:12px}.barcount{text-align:right;font-weight:700}.tablewrap{overflow:auto;border:1px solid var(--line);border-radius:9px;max-height:420px}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th{position:sticky;top:0;background:#f7f7f8;text-align:left;color:#475467;font-weight:700;padding:10px;border-bottom:1px solid var(--line)}td{padding:9px 10px;border-bottom:1px solid #eef0f2}tr:last-child td{border-bottom:0}.empty{padding:20px;text-align:center;color:var(--muted)}.tabs{display:flex;gap:8px;margin:14px 0 10px}.tab{background:#f1f2f4;border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12px;font-weight:700}.tab.active{background:#fff0f0;border-color:#ffd0d1;color:var(--red)}.hidden{display:none!important}.error{color:#b42318}.footer{text-align:center;color:#98a2b3;font-size:11px;margin-top:22px}
@media(max-width:760px){header{padding:15px 16px;align-items:flex-start}.local{display:none}.wrap{padding:0 12px 34px;margin-top:18px}.card{padding:15px}.grid2{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.step{gap:10px}.barrow{grid-template-columns:95px 1fr 36px}.brand h1{font-size:16px}}
</style>
</head>
<body>
<header><div class="brand"><div class="mark">J&amp;T</div><div><h1>Pesquisa de Segmentos</h1><p>JMS · Informação Básica · 3 Segmentos</p></div></div><div class="local">🔒 Processamento local neste computador</div></header>
<main class="wrap">
<div class="intro"><h2>Pesquisa de códigos por remessa</h2><p>Consulte os segmentos do JMS, conte repetições de caracteres e veja em quais segmentos aparecem.</p></div>
<section class="card step"><div class="number">1</div><div class="stepmain"><div class="stephead"><h3>Conectar ao JMS</h3><span id="browserPill" class="pill">Navegador não iniciado</span></div><div class="info">O app abre um Chromium local. Entre no JMS por ele; senha e token não são pedidos pelo app.</div><div class="actions"><button id="openBtn" class="primary" onclick="openBrowser()">Abrir sessão do JMS</button><button class="secondary" onclick="closeBrowser()">Fechar navegador</button><span id="browserMsg" class="statusline"></span></div></div></section>
<section class="card step"><div class="number">2</div><div class="stepmain"><div class="stephead"><h3>Capturar a consulta do próprio JMS</h3><span id="capturePill" class="pill">Aguardando consulta de teste</span></div><p class="small">No navegador aberto, faça login, vá até a consulta de pacote e consulte uma remessa. O app detecta automaticamente a chamada de “Informação Básica”.</p><div class="notice">Faça esta captura uma vez por sessão: no JMS, abra <b>Operação → Consulta do pacote → Rastreamento do pacote</b>, informe uma remessa e clique em <b>Consultar</b>. Aguarde o status mudar para “Consulta capturada”.</div><div class="actions"><button class="secondary" onclick="refreshStatus()">Verificar conexão</button><span id="captureInfo" class="statusline"></span></div></div></section>
<section class="card step"><div class="number">3</div><div class="stepmain"><div class="stephead"><h3>Pesquisar remessas e padrões</h3><span class="pill">Blocos JMS de até 1.000 remessas</span></div><div class="grid2"><div class="field"><label for="waybills">Remessas</label><textarea id="waybills" placeholder="Cole uma remessa por linha ou separado por vírgula; também aceita colar uma coluna do Excel"></textarea><div class="hint">Listas maiores são divididas automaticamente em blocos de 1.000; remessas duplicadas são removidas.</div></div><div class="field"><label for="patterns">Caracteres ou códigos padrão (opcional)</label><textarea id="patterns" placeholder="Exemplo:&#10;956&#10;MT&#10;00"></textarea><div class="hint">Um padrão por linha. A busca ignora maiúsculas/minúsculas. Se deixar vazio, o app lista todos os segmentos extraídos.</div></div></div><div class="actions"><button id="queryBtn" class="primary" onclick="runQuery()">Consultar e analisar</button><button class="secondary" onclick="clearForm()">Limpar</button><span id="queryMsg" class="statusline"></span></div></div></section>
<section id="results" class="hidden">
<div class="metrics"><div class="metric"><span>Remessas consultadas</span><strong id="mShipments">0</strong></div><div class="metric"><span>Segmentos extraídos</span><strong id="mSegments">0</strong></div><div class="metric"><span>Segmento 565 ignorado</span><strong id="mIgnored">0</strong></div><div class="metric"><span>Remessas com erro</span><strong id="mErrors">0</strong></div></div>
<section class="card"><h3 class="sectionTitle">Códigos de segmento mais repetidos</h3><div id="chart" class="chart"></div><div class="small" style="margin-top:9px">O gráfico conta cada ocorrência do código por remessa, excluindo o valor exato <b>565</b>.</div></section>
<section class="card"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><h3 class="sectionTitle" style="margin:0">Tabelas da pesquisa</h3><button class="primary" onclick="downloadXlsx()">Baixar planilha Excel</button></div><div class="tabs"><button class="tab active" data-tab="summary" onclick="showTab('summary')">Resumo</button><button class="tab" data-tab="segments" onclick="showTab('segments')">Todos os segmentos</button><button class="tab" data-tab="occ" onclick="showTab('occ')">Ocorrências encontradas</button><button class="tab" data-tab="errors" onclick="showTab('errors')">Erros</button></div><div id="tab-summary" class="tablewrap"></div><div id="tab-segments" class="tablewrap hidden"></div><div id="tab-occ" class="tablewrap hidden"></div><div id="tab-errors" class="tablewrap hidden"></div><div id="exportMsg" class="statusline" style="margin-top:9px"></div></section>
<div class="small" id="generated"></div></section>
<div class="footer">JMS Segmentos · App local · Fonte: Informação Básica → terminalDispatchCode</div>
</main>
<script>
let resultData=null;let statusTimer=null;
async function api(path,body){const opts=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};const res=await fetch(path,opts);let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.detail||'Falha ao comunicar com o app local');return data}
function msg(id,text,error=false){const el=document.getElementById(id);el.textContent=text||'';el.className='statusline'+(error?' error':'')}
async function openBrowser(){const b=document.getElementById('openBtn');b.disabled=true;msg('browserMsg','Abrindo Chromium...');try{const r=await api('/api/browser/open',{});msg('browserMsg',r.message);await refreshStatus();if(!statusTimer)statusTimer=setInterval(refreshStatus,3000)}catch(e){msg('browserMsg',e.message,true)}finally{b.disabled=false}}
async function closeBrowser(){try{const r=await api('/api/browser/close',{});msg('browserMsg',r.message);await refreshStatus()}catch(e){msg('browserMsg',e.message,true)}}
async function refreshStatus(){try{const s=await api('/api/status');const bp=document.getElementById('browserPill'),cp=document.getElementById('capturePill');bp.textContent=s.browser_open?'Navegador aberto':'Navegador não iniciado';bp.className='pill '+(s.browser_open?'ok':'');cp.textContent=s.captured?'Consulta capturada':'Aguardando consulta de teste';cp.className='pill '+(s.captured?'ok':'wait');msg('captureInfo',s.captured?`Captura concluída em ${s.captured_at}. Remessa de teste: ${s.seed_waybill||'identificada'}.`:(s.browser_open?'Faça uma consulta de remessa no JMS.':'Abra a sessão do JMS acima.'));}catch(e){msg('captureInfo',e.message,true)}}
function parseBox(id){return document.getElementById(id).value.split(/[\n,;\t]+/).map(x=>x.trim()).filter(Boolean)}
async function runQuery(){const pasted=parseBox('waybills'),waybills=[...new Set(pasted)],patterns=parseBox('patterns');if(!waybills.length){msg('queryMsg','Cole pelo menos uma remessa.',true);return}const b=document.getElementById('queryBtn');b.disabled=true;const batchSize=1000,totalBatches=Math.ceil(waybills.length/batchSize),allRows=[];try{for(let i=0;i<totalBatches;i++){const batch=waybills.slice(i*batchSize,(i+1)*batchSize);msg('queryMsg',`Consultando bloco ${i+1}/${totalBatches} · ${batch.length.toLocaleString('pt-BR')} remessas · ${Math.min((i+1)*batchSize,waybills.length).toLocaleString('pt-BR')}/${waybills.length.toLocaleString('pt-BR')} processadas`);const part=await api('/api/query',{waybills:batch,patterns});allRows.push(...(part._raw_rows||[]))}msg('queryMsg','Consolidando todos os blocos e montando o resultado...');resultData=await api('/api/aggregate',{rows:allRows,patterns});render(resultData);document.getElementById('results').classList.remove('hidden');msg('queryMsg',`Pesquisa concluída: ${resultData.remessas_consultadas.toLocaleString('pt-BR')} remessas em ${totalBatches} bloco(s).`);document.getElementById('results').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){msg('queryMsg',e.message,true)}finally{b.disabled=false}}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function table(target,headers,rows,values){const el=document.getElementById(target);if(!rows||!rows.length){el.innerHTML='<div class="empty">Nenhum registro para exibir.</div>';return}let html='<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>';for(const row of rows){html+='<tr>'+values.map(k=>'<td>'+esc(row[k])+'</td>').join('')+'</tr>'}el.innerHTML=html+'</tbody></table>'}
function render(d){document.getElementById('mShipments').textContent=d.remessas_consultadas;document.getElementById('mSegments').textContent=d.segmentos_extraidos.length;document.getElementById('mIgnored').textContent=d.segmento_565_ignorado;document.getElementById('mErrors').textContent=d.remessas_com_erro;const max=Math.max(1,...d.grafico.map(x=>x.quantidade));document.getElementById('chart').innerHTML=d.grafico.length?d.grafico.map(x=>`<div class="barrow"><div class="barlabel" title="${esc(x.codigo)}">${esc(x.codigo)}</div><div class="track"><div class="fill" style="width:${Math.max(2,x.quantidade/max*100)}%"></div></div><div class="barcount">${x.quantidade}</div></div>`).join(''):'<div class="empty">Nenhum segmento encontrado.</div>';table('tab-summary',['Padrão','Segmento JMS','Código','Repetições','Remessas únicas'],d.resumo,['padrao','segmento','codigo','repeticoes','remessas_unicas']);table('tab-segments',['Remessa','Segmento JMS','Posição','Código'],d.segmentos_extraidos,['remessa','segmento','ordem','codigo']);table('tab-occ',['Remessa','Padrão encontrado','Segmento JMS','Posição','Código'],d.ocorrencias,['remessa','padrao','segmento','ordem','codigo']);table('tab-errors',['Remessa','Erro'],d.erros,['remessa','erro']);document.getElementById('generated').textContent='Gerado em '+d.gerado_em+'. O código 565 foi descartado somente quando apareceu como um segmento completo.'}
function showTab(name){document.querySelectorAll('[id^="tab-"]').forEach(x=>x.classList.toggle('hidden',x.id!=='tab-'+name));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name))}
async function downloadXlsx(){if(!resultData)return;msg('exportMsg','Preparando Excel...');try{const res=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:resultData})});if(!res.ok){const err=await res.json();throw new Error(err.detail||'Falha ao gerar Excel')}const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='JMS_Segmentos.xlsx';a.click();URL.revokeObjectURL(url);msg('exportMsg','Planilha Excel baixada com as abas Resumo, Segmentos, Ocorrências e Erros.')}catch(e){msg('exportMsg',e.message,true)}}
function clearForm(){document.getElementById('waybills').value='';document.getElementById('patterns').value='';document.getElementById('results').classList.add('hidden');msg('queryMsg','');resultData=null}
refreshStatus();
</script>
</body></html>'''


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8765, log_level="warning")
