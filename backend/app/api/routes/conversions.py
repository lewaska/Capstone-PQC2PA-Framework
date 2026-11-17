"""Compatibility endpoints for the deployed conversion page."""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
import psycopg
from cryptography import x509
from cryptography.x509.oid import NameOID

from app.core.config import settings
from app.services.conversion_registration import persist_conversion
from app.services.conversion_lookup import CandidateResolutionError, resolve_existing
from app.services.pqc2pa import build_p1

router = APIRouter(prefix="/conversions", tags=["conversions"])
validation_router = APIRouter(prefix="/validations", tags=["validations"])
_LOG = logging.getLogger(__name__)
_ID = re.compile(r"^conv_[0-9a-f]{32}$")
_MAX = 20 * 1024 * 1024


def _display_validation(validation: dict) -> dict:
    """Describe the pinned HAETAE public key used by P1 verification."""
    from app.services.haetae import public_key
    import hashlib
    key_hash = hashlib.sha256(public_key()).hexdigest()
    return {
        **validation,
        "signature_algorithm": "HAETAE-3",
        "signature_info": {
            "alg": "HAETAE-3",
            "common_name": "PQ-C2PA HAETAE-3 Signer",
            "issuer": "Local pinned public key (not an X.509 certificate)",
            "key_reference": "haetae3:sha256:" + key_hash,
        },
        "soft_binding_assertion": {"label": "c2pa.soft-binding", "algorithm": "io.iscc.v0"},
    }


def _record_display(pair_public_id: str) -> dict:
    """Read registered times and verified timestamp evidence for a pair."""
    password = os.environ.get("PQC2PA_DB_PASSWORD")
    if not password:
        return {}
    with psycopg.connect(host="127.0.0.1", port=5432, dbname="pqc2pa_db",
                         user="pqc2pa_user", password=password) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT p.activated_at,t.generation_time,c.der_bytes
                   FROM pq_c2pa.manifest_pairs p
                   LEFT JOIN pq_c2pa.timestamp_evidence e ON e.pair_id=p.id
                   LEFT JOIN pq_c2pa.timestamp_tokens t ON t.id=e.timestamp_id
                   LEFT JOIN pq_c2pa.certificates c ON c.id=t.tsa_signer_certificate_id
                   WHERE p.public_id=%s
                   ORDER BY e.created_at DESC NULLS LAST LIMIT 1""",
                (pair_public_id,),
            )
            row = cursor.fetchone()
    if row is None:
        return {}
    activated_at, generation_time, tsa_der = row
    display = {"registered_at": activated_at.isoformat() if activated_at else None}
    if generation_time is not None:
        issuer = None
        if tsa_der is not None:
            cert = x509.load_der_x509_certificate(bytes(tsa_der))
            common_names = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
            issuer = common_names[0].value if common_names else cert.subject.rfc4514_string()
        timestamp = {"generation_time": generation_time.isoformat(), "issuer": issuer}
        display.update(classic_timestamp=timestamp, p1_timestamp=timestamp)
    return display


def _directory(identifier: str) -> Path:
    if not _ID.fullmatch(identifier):
        raise HTTPException(404, "Unknown conversion")
    return settings.conversion_storage_path / identifier


def _state(identifier: str) -> dict:
    path = _directory(identifier) / "state.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(404, "Unknown conversion") from exc


def _save(identifier: str, state: dict) -> None:
    directory = _directory(identifier)
    directory.mkdir(parents=True, exist_ok=True)
    pending = directory / "state.json.pending"
    pending.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    pending.replace(directory / "state.json")


def _run(identifier: str, filename: str, suffix: str) -> None:
    directory = _directory(identifier)
    source = directory / ("source" + suffix)
    output = directory / ("output" + suffix)
    p1 = directory / "p1.jumbf"
    state = _state(identifier)
    state.update(status="PROCESSING", stage="P1 생성 및 검증", progress_percent=20)
    _save(identifier, state)
    try:
        state.update(stage="기존 보호 기록 검색 및 재검증", progress_percent=10)
        _save(identifier, state)
        existing = resolve_existing(source, output)
        if existing is not None:
            state.update(
                status="COMPLETED", stage="완료", progress_percent=100,
                source={"filename": filename, "classic_c2pa": {
                    "validation_status": "VALID"}},
                result={"filename": output.name, "trust_status": "TRUSTED",
                        "validation_id": existing["validation_id"],
                        "manifest_pair_id": existing["pair_id"],
                        "fingerprint_base64": existing["fingerprint_base64"],
                        "classic_action": existing["mode"],
                        "resolution_mode": existing["mode"],
                        "p1_validation": _display_validation(existing["validation"])},
                error=None,
            )
            _save(identifier, state)
            return
        build = build_p1(source, output, p1)
        state.update(stage="DB 등록 및 최종 검증", progress_percent=80)
        _save(identifier, state)
        registered = persist_conversion(source, output, p1, filename, identifier, build)
        state.update(
            status="COMPLETED", stage="완료", progress_percent=100,
            source={"filename": filename, "classic_c2pa": {"validation_status": "VALID"}},
            result={"filename": output.name, "trust_status": "TRUSTED",
                    "validation_id": registered["validation_id"],
                    "manifest_pair_id": registered["pair_id"],
                    "fingerprint_base64": build["fingerprint_base64"],
                    "classic_action": build["classic_action"],
                    "p1_validation": _display_validation(build["validation"])},
            error=None,
        )
    except Exception as exc:
        _LOG.exception("Conversion %s failed", identifier)
        state.update(status="FAILED", stage="실패", progress_percent=100,
                     error={"code": (exc.code if isinstance(exc, CandidateResolutionError)
                                     else type(exc).__name__), "message": str(exc)})
    _save(identifier, state)


@router.post("")
async def create_conversion(background: BackgroundTasks,
                            file: UploadFile = File(...),
                            preserve_non_c2pa_metadata: bool = Form(True)) -> dict:
    del preserve_non_c2pa_metadata
    filename = Path(file.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png"}:
        raise HTTPException(415, "JPEG 또는 PNG 이미지만 변환할 수 있습니다")
    raw = await file.read(_MAX + 1)
    if not raw or len(raw) > _MAX:
        raise HTTPException(413, "파일 크기는 1~20 MB여야 합니다")
    if not ((suffix == ".png" and raw.startswith(b"\x89PNG\r\n\x1a\n"))
            or (suffix in {".jpg", ".jpeg"} and raw.startswith(b"\xff\xd8\xff"))):
        raise HTTPException(415, "이미지 내용과 확장자가 일치하지 않습니다")
    identifier = "conv_" + uuid.uuid4().hex
    directory = _directory(identifier)
    directory.mkdir(parents=True, exist_ok=False)
    (directory / ("source" + suffix)).write_bytes(raw)
    state = {"conversion_id": identifier, "status": "QUEUED", "stage": "대기",
             "progress_percent": 0, "source": {"filename": filename},
             "result": None, "error": None}
    _save(identifier, state)
    background.add_task(_run, identifier, filename, suffix)
    return {"data": state}


@router.get("/{identifier}")
def get_conversion(identifier: str) -> dict:
    state = _state(identifier)
    result = state.get("result")
    if state.get("status") == "COMPLETED" and result and result.get("manifest_pair_id"):
        try:
            display = _record_display(result["manifest_pair_id"])
            state = {**state, "result": {**result, **display}}
        except (psycopg.Error, ValueError) as exc:
            _LOG.warning("Could not load timestamp display for %s: %s", identifier, exc)
    return {"data": state}


@router.get("/{identifier}/asset")
def download_conversion(identifier: str):
    state = _state(identifier)
    if state.get("status") != "COMPLETED":
        raise HTTPException(409, "Conversion is not complete")
    result = state.get("result") or {}
    name = result.get("filename")
    if name not in {"output.png", "output.jpg", "output.jpeg"}:
        raise HTTPException(500, "Invalid output filename")
    path = _directory(identifier) / name
    if not path.is_file():
        raise HTTPException(404, "Converted asset is unavailable")
    return FileResponse(path, filename=name,
                        media_type="image/png" if name.endswith(".png") else "image/jpeg")


@validation_router.get("/{identifier}")
def get_validation(identifier: str) -> dict:
    if not re.fullmatch(r"val_[0-9a-f]{32}", identifier):
        raise HTTPException(404, "Unknown validation")
    password = os.environ.get("PQC2PA_DB_PASSWORD")
    if not password:
        raise HTTPException(503, "Database is not configured")
    with psycopg.connect(host="127.0.0.1", port=5432, dbname="pqc2pa_db",
                         user="pqc2pa_user", password=password) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT overall_status,report_json FROM pq_c2pa.validation_runs WHERE public_id=%s",
                (identifier,),
            )
            row = cursor.fetchone()
            if row is None:
                raise HTTPException(404, "Unknown validation")
            cursor.execute(
                """SELECT component,name,code,message,status FROM pq_c2pa.validation_checks
                   WHERE validation_id=(SELECT id FROM pq_c2pa.validation_runs WHERE public_id=%s)
                   ORDER BY ordinal""",
                (identifier,),
            )
            checks = [dict(zip(("component", "name", "code", "message", "status"), item))
                      for item in cursor.fetchall()]
            cursor.execute(
                """SELECT e.purpose,e.origin,e.storage_kind,t.generation_time,
                          t.message_imprint_algorithm,encode(t.token_sha256,'hex')
                   FROM pq_c2pa.timestamp_evidence e
                   JOIN pq_c2pa.timestamp_tokens t ON t.id=e.timestamp_id
                   JOIN pq_c2pa.validation_runs v ON v.resolved_pair_id=e.pair_id
                   WHERE v.public_id=%s ORDER BY e.created_at,e.id""",
                (identifier,),
            )
            timestamps = [
                {"purpose": purpose, "origin": origin, "storage_kind": storage_kind,
                 "generation_time": generation_time.isoformat(),
                 "message_imprint_algorithm": algorithm, "token_sha256": token_hash}
                for purpose, origin, storage_kind, generation_time, algorithm, token_hash
                in cursor.fetchall()
            ]
    return {"data": {"validation_id": identifier, "overall_status": row[0],
                     "report": row[1], "checks": checks,
                     "timestamp_evidence": timestamps}}
