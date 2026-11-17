"""Resolve existing PQ evidence before issuing a new conversion.

Image-Code is only a discovery key. A candidate is returned only after its
stored bytes, Classic SDK result, P1 signature and asset bindings validate.
"""
from __future__ import annotations

import hashlib
import base64
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import psycopg

from app.core.config import settings
from app.services.classic_c2pa import ClassicC2PANotFoundError, read_classic_manifest
from app.services.fingerprint import generate_image_fingerprint
from app.services.pqc2pa import verify_p1
from app.services.pqc_jumbf import superbox
from app.services.pqc_manifest import EVIDENCE, inspect as inspect_p1, one_box, strict_cbor
from app.services.pqc_source import (
    boxes, child_map, export_store, extract_source, label_of, manifest_map,
)

_LOG = logging.getLogger(__name__)


class CandidateResolutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Candidate:
    pair_id: str
    public_id: str
    source_sha256: bytes
    output_sha256: bytes
    output_path: Path
    classic_store: bytes
    classic_store_sha256: bytes
    p1_manifest: bytes
    p1_sha256: bytes
    validation_id: str | None
    fingerprint: bytes


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _candidates(image_code: str) -> list[Candidate]:
    password = os.environ.get("PQC2PA_DB_PASSWORD")
    if not password:
        raise CandidateResolutionError("DB_UNAVAILABLE", "DB 접속 설정이 없습니다.")
    with psycopg.connect(host="127.0.0.1", port=5432, dbname="pqc2pa_db",
                         user="pqc2pa_user", password=password) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT p.id,p.public_id,src.sha256,dst.sha256,dst.storage_key,
                          s.raw_store,s.sha256,m.raw_manifest,m.raw_sha256,f.canonical_value,
                          (SELECT v.public_id FROM pq_c2pa.validation_runs v
                           WHERE v.resolved_pair_id=p.id AND v.overall_status='TRUSTED'
                           ORDER BY v.validated_at DESC LIMIT 1)
                   FROM pq_c2pa.fingerprints f
                   JOIN pq_c2pa.manifest_pairs p ON p.shared_fingerprint_id=f.id
                   JOIN pq_c2pa.assets src ON src.id=p.source_asset_id
                   JOIN pq_c2pa.assets dst ON dst.id=p.output_asset_id
                   JOIN pq_c2pa.manifest_stores s ON s.id=p.classic_store_id
                   JOIN pq_c2pa.manifests m ON m.pair_id=p.id AND m.kind='PQC'
                   WHERE f.algorithm='io.iscc.v0' AND f.image_code=%s
                     AND p.profile_version='pq-c2pa-jumbf-haetae3-1'
                     AND p.activated_at IS NOT NULL AND p.withdrawn_at IS NULL
                   ORDER BY p.activated_at DESC,p.id LIMIT 21""",
                (image_code,),
            )
            rows = cursor.fetchall()
    if len(rows) > 20:
        raise CandidateResolutionError("TOO_MANY_CANDIDATES", "후보가 너무 많아 자동으로 선택할 수 없습니다.")
    return [Candidate(str(pair_id), public_id, source_sha, output_sha, Path(path),
                      store, store_sha, p1, p1_sha, validation_id, fingerprint)
            for pair_id, public_id, source_sha, output_sha, path, store, store_sha,
            p1, p1_sha, fingerprint, validation_id in rows]


def _p1_store(candidate: Candidate) -> bytes:
    # DB keeps the P1 manifest box only. Its signed evidence contains the
    # original Classic store, from which the detached P1 store is rebuilt.
    p1 = one_box(candidate.p1_manifest)
    assertions = child_map(p1)["c2pa.assertions"]
    evidence, _ = strict_cbor(child_map(assertions)[EVIDENCE])
    source_store = one_box(evidence["manifest_store_raw"])
    source_children = [box.raw for box in boxes(source_store.payload)
                       if box.kind != b"jumd"]
    if label_of(source_store) != "c2pa":
        raise ValueError("P1 source store label mismatch")
    return superbox("c2pa", b"c2pa", source_children + [candidate.p1_manifest])


def _stored_output(candidate: Candidate) -> Path:
    path = candidate.output_path.resolve()
    root = settings.conversion_storage_path.resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Stored output file is unavailable")
    if _sha256(path.read_bytes()) != candidate.output_sha256:
        raise ValueError("Stored output checksum mismatch")
    return path


def _validate(candidate: Candidate, image: Path, p1: bytes) -> dict:
    if _sha256(candidate.classic_store) != candidate.classic_store_sha256:
        raise ValueError("Stored Classic checksum mismatch")
    if _sha256(candidate.p1_manifest) != candidate.p1_sha256:
        raise ValueError("Stored P1 checksum mismatch")
    if export_store(image) != candidate.classic_store:
        raise ValueError("Classic store differs from registered store")
    if manifest_map(p1)[list(manifest_map(p1))[-1]].raw != candidate.p1_manifest:
        raise ValueError("P1 manifest differs from registered bytes")
    soft = inspect_p1(p1)["soft_binding"]
    if soft["blocks"][0]["value"] != candidate.fingerprint:
        raise ValueError("P1 fingerprint differs from registered pair")
    return verify_p1(p1, image)


def _restore(source: Path, output: Path, store: bytes) -> None:
    cli = settings.pqc2pa_cli_path.resolve()
    if not cli.is_file():
        raise ValueError("Native restore tool is unavailable")
    with tempfile.TemporaryDirectory(prefix="pqc-restore-") as directory:
        store_path = Path(directory) / "classic.jumbf"
        store_path.write_bytes(store)
        result = subprocess.run(
            [str(cli), "restore-store", "--input", str(source),
             "--store", str(store_path), "--output", str(output)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, check=False,
        )
    if result.returncode or not output.is_file():
        output.unlink(missing_ok=True)
        raise ValueError("Classic store insertion failed: " + result.stderr.strip()[:300])


def resolve_existing(source: Path, output: Path) -> dict | None:
    """Return a verified existing pair, or None only if no Image-Code matches.

    If a candidate exists but cannot be verified, never fall through to new
    issuance. In particular Image-Code alone never proves a stripped asset.
    """
    image_code = generate_image_fingerprint(source).units[0]
    candidates = _candidates(image_code)
    if not candidates:
        return None
    source_hash = _sha256(source.read_bytes())
    try:
        read_classic_manifest(source)
        has_manifest = True
    except ClassicC2PANotFoundError:
        has_manifest = False
    accepted = []
    legacy_exact_rejections = []
    for candidate in candidates:
        trial = output.with_name(output.stem + "-" + candidate.pair_id + output.suffix)
        try:
            p1 = _p1_store(candidate)
            if has_manifest:
                if source_hash == candidate.output_sha256:
                    trial.write_bytes(source.read_bytes())
                    mode = "EXISTING_OUTPUT"
                elif source_hash == candidate.source_sha256:
                    extract_source(source)  # Revalidate the uploaded M0 itself.
                    trial.write_bytes(_stored_output(candidate).read_bytes())
                    mode = "EXISTING_SOURCE"
                else:
                    continue
            else:
                _restore(source, trial, candidate.classic_store)
                mode = "RESTORED_CLASSIC"
            validation = _validate(candidate, trial, p1)
            # A source with stripped metadata must also preserve the protected
            # content. A successful Classic + P1 hard binding proves this.
            accepted.append((candidate, trial, mode, validation))
        except Exception as exc:
            _LOG.warning("Candidate %s rejected: %s: %s", candidate.public_id,
                         type(exc).__name__, exc)
            if (has_manifest and source_hash == candidate.source_sha256
                    and source_hash != candidate.output_sha256):
                legacy_exact_rejections.append(
                    str(exc) == "P1 omitted an available Classic timestamp"
                )
            trial.unlink(missing_ok=True)
            continue
    # An old P1 without the Classic timestamp is not valid evidence. If the
    # uploaded file is byte-for-byte the previously registered source, the
    # SDK can validate that source and a new P1 can be issued. This exception
    # never applies to a stripped or merely similar image.
    if not accepted and legacy_exact_rejections and all(legacy_exact_rejections):
        extract_source(source)
        return None
    if len(accepted) != 1:
        for _, trial, _, _ in accepted:
            trial.unlink(missing_ok=True)
        code = "AMBIGUOUS_MATCH" if len(accepted) > 1 else "MATCH_UNVERIFIED"
        raise CandidateResolutionError(code, "유사한 보호 기록은 찾았지만 검증 가능한 복구 결과를 확정하지 못했습니다.")
    candidate, trial, mode, validation = accepted[0]
    trial.replace(output)
    return {"pair_id": candidate.public_id, "validation_id": candidate.validation_id,
            "fingerprint_base64": base64.b64encode(candidate.fingerprint).decode("ascii"),
            "mode": mode,
            "validation": validation, "image_code": image_code}
