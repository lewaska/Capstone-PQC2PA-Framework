"""Lossless source evidence extraction and SHA3 asset binding for P1."""
from __future__ import annotations

import hashlib
import io
import struct
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import cbor2

from app.core.config import settings
from app.services.classic_c2pa import read_and_parse_classic_manifest
from app.services.classic_preparation import require_valid_source


class PqcSourceError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Box:
    kind: bytes
    raw: bytes
    payload: bytes


@dataclass(frozen=True, slots=True)
class SourceManifest:
    manifest_id: str
    store_raw: bytes
    manifest_raw: bytes
    claim_raw: bytes
    cose_raw: bytes
    signature_raw: bytes
    certificate_chain: tuple[bytes, ...]
    timestamps: tuple[bytes, ...]
    assertions: tuple[tuple[str, bytes], ...]
    validation_results: dict = field(default_factory=dict)


def boxes(data: bytes) -> tuple[Box, ...]:
    result: list[Box] = []
    offset = 0
    while offset < len(data):
        if len(data) - offset < 8:
            raise PqcSourceError("잘린 ISO box header입니다.")
        size, kind = struct.unpack_from(">I4s", data, offset)
        header_size = 8
        if size == 1:
            if len(data) - offset < 16:
                raise PqcSourceError("잘린 extended ISO box header입니다.")
            size = struct.unpack_from(">Q", data, offset + 8)[0]
            header_size = 16
        elif size == 0:
            size = len(data) - offset
        if size < header_size or offset + size > len(data):
            raise PqcSourceError("ISO box 길이가 올바르지 않습니다.")
        raw = data[offset:offset + size]
        result.append(Box(kind=kind, raw=raw, payload=raw[header_size:]))
        offset += size
    return tuple(result)


def label_of(box: Box) -> str | None:
    if box.kind != b"jumb":
        return None
    children = boxes(box.payload)
    if not children or children[0].kind != b"jumd":
        raise PqcSourceError("JUMBF description box가 없습니다.")
    description = children[0].payload
    if len(description) < 17:
        raise PqcSourceError("잘린 JUMBF description입니다.")
    toggles = description[16]
    if not toggles & 0x02:
        return None
    end = description.find(b"\x00", 17)
    if end < 0:
        raise PqcSourceError("JUMBF label terminator가 없습니다.")
    return description[17:end].decode("utf-8", errors="strict")


def child_map(parent: Box) -> dict[str, Box]:
    result: dict[str, Box] = {}
    for child in boxes(parent.payload):
        label = label_of(child)
        if label is None:
            continue
        if label in result:
            raise PqcSourceError(f"중복 JUMBF label입니다: {label}")
        result[label] = child
    return result


def cbor_payload(box: Box) -> bytes:
    payloads = [child.payload for child in boxes(box.payload) if child.kind == b"cbor"]
    if len(payloads) != 1:
        raise PqcSourceError("CBOR content box를 하나로 결정할 수 없습니다.")
    decoder_stream = io.BytesIO(payloads[0])
    cbor2.CBORDecoder(decoder_stream).decode()
    consumed = decoder_stream.tell()
    if consumed <= 0:
        raise PqcSourceError("빈 CBOR payload입니다.")
    return payloads[0][:consumed]


def decode_cose(raw: bytes) -> tuple[dict, dict, Any, bytes]:
    value = cbor2.loads(raw)
    if isinstance(value, cbor2.CBORTag):
        if value.tag != 18:
            raise PqcSourceError("COSE_Sign1 tag가 아닙니다.")
        value = value.value
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise PqcSourceError("올바른 COSE_Sign1 구조가 아닙니다.")
    protected_raw, unprotected, payload, signature = value
    if not isinstance(protected_raw, bytes) or not isinstance(unprotected, Mapping):
        raise PqcSourceError("COSE header 구조가 올바르지 않습니다.")
    if not isinstance(signature, bytes):
        raise PqcSourceError("COSE signature가 bytes가 아닙니다.")
    protected = cbor2.loads(protected_raw) if protected_raw else {}
    if not isinstance(protected, Mapping):
        raise PqcSourceError("COSE protected header가 map이 아닙니다.")
    return protected, unprotected, payload, signature


def manifest_map(store: bytes) -> dict[str, Box]:
    roots = boxes(store)
    stores = [box for box in roots if label_of(box) == "c2pa"]
    if len(stores) != 1:
        raise PqcSourceError("c2pa Manifest Store를 하나로 결정할 수 없습니다.")
    return child_map(stores[0])


def export_store(image: Path) -> bytes:
    cli = settings.pqc2pa_cli_path.resolve()
    if not cli.is_file():
        raise PqcSourceError(f"pqc2pa-cli 실행 파일이 없습니다: {cli}")
    with TemporaryDirectory(prefix="pqc-store-") as directory:
        output = Path(directory) / "classic.jumbf"
        process = subprocess.run(
            [str(cli), "export-store", "--input", str(image), "--output", str(output)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=120,
        )
        if process.returncode != 0 or not output.is_file():
            raise PqcSourceError(
                (process.stderr or "").strip() or "Manifest Store 추출에 실패했습니다."
            )
        return output.read_bytes()


def _timestamp_tokens(unprotected: Mapping) -> tuple[bytes, ...]:
    result: list[bytes] = []
    for key in ("sigTst", "sigTst2"):
        container = unprotected.get(key)
        if container is None:
            continue
        if not isinstance(container, Mapping):
            raise PqcSourceError(f"{key} 구조가 map이 아닙니다.")
        tokens = container.get("tstTokens", [])
        if not isinstance(tokens, (list, tuple)):
            raise PqcSourceError(f"{key}.tstTokens가 배열이 아닙니다.")
        for item in tokens:
            if not isinstance(item, Mapping) or not isinstance(item.get("val"), bytes):
                raise PqcSourceError("타임스탬프 토큰이 DER bytes가 아닙니다.")
            result.append(item["val"])
    return tuple(result)


def extract_source(image: Path) -> SourceManifest:
    parsed = read_and_parse_classic_manifest(image)
    require_valid_source(parsed)
    store = export_store(image)
    manifests = manifest_map(store)
    manifest_id = parsed["active_manifest"]
    manifest = manifests.get(manifest_id)
    if manifest is None:
        raise PqcSourceError("활성 M0를 원본 Store에서 찾지 못했습니다.")
    children = child_map(manifest)
    claim_boxes = [
        box for label, box in children.items()
        if label in {"c2pa.claim", "c2pa.claim.v2"}
    ]
    if len(claim_boxes) != 1:
        raise PqcSourceError("M0 Claim을 하나로 결정할 수 없습니다.")
    signature_box = children.get("c2pa.signature")
    assertion_store = children.get("c2pa.assertions")
    if signature_box is None or assertion_store is None:
        raise PqcSourceError("M0 signature 또는 assertion store가 없습니다.")
    claim_raw = cbor_payload(claim_boxes[0])
    cose_raw = cbor_payload(signature_box)
    protected, unprotected, _, signature = decode_cose(cose_raw)
    if 33 in protected and 33 in unprotected:
        raise PqcSourceError("x5chain이 protected/unprotected에 중복되어 있습니다.")
    chain = protected.get(33, unprotected.get(33))
    if isinstance(chain, bytes):
        chain = [chain]
    if not isinstance(chain, (list, tuple)) or not chain:
        raise PqcSourceError("M0 X.509 인증서 체인이 없습니다.")
    if not all(isinstance(cert, bytes) for cert in chain):
        raise PqcSourceError("x5chain 항목이 DER bytes가 아닙니다.")
    assertion_boxes = child_map(assertion_store)
    return SourceManifest(
        validation_results=parsed.get("validation_results") or {},
        manifest_id=manifest_id,
        store_raw=store,
        manifest_raw=manifest.raw,
        claim_raw=claim_raw,
        cose_raw=cose_raw,
        signature_raw=signature,
        certificate_chain=tuple(chain),
        timestamps=_timestamp_tokens(unprotected),
        assertions=tuple((label, box.raw) for label, box in assertion_boxes.items()),
    )


def hash_excluding(asset: bytes, exclusions: list[dict], algorithm: str) -> bytes:
    names = {
        "sha256": "sha256",
        "sha384": "sha384",
        "sha512": "sha512",
        "sha3-256": "sha3_256",
        "sha3_256": "sha3_256",
    }
    try:
        digest = hashlib.new(names[algorithm.lower()])
    except KeyError as exc:
        raise PqcSourceError(f"지원하지 않는 해시 알고리즘입니다: {algorithm}") from exc
    normalized: list[tuple[int, int]] = []
    for item in exclusions:
        if not isinstance(item, dict):
            raise PqcSourceError("제외 범위가 map이 아닙니다.")
        start, length = item.get("start"), item.get("length")
        if type(start) is not int or type(length) is not int:
            raise PqcSourceError("제외 범위가 정수가 아닙니다.")
        normalized.append((start, length))
    normalized.sort()
    cursor = 0
    for start, length in normalized:
        if start < cursor or length <= 0 or start + length > len(asset):
            raise PqcSourceError("제외 범위가 겹치거나 파일 밖에 있습니다.")
        digest.update(asset[cursor:start])
        cursor = start + length
    digest.update(asset[cursor:])
    return digest.digest()


def _normalize_exclusions(value: Any) -> list[dict]:
    if not isinstance(value, list):
        raise PqcSourceError("data-hash exclusions가 배열이 아닙니다.")
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise PqcSourceError("data-hash exclusion이 map이 아닙니다.")
        start, length = item.get("start"), item.get("length")
        if type(start) is not int or type(length) is not int:
            raise PqcSourceError("data-hash exclusion 범위가 정수가 아닙니다.")
        result.append({"start": start, "length": length})
    return result


def _png_c2pa_exclusions(asset: bytes) -> list[dict]:
    """Return the complete PNG caBX chunk as the C2PA exclusion."""
    if not asset.startswith(b"\x89PNG\r\n\x1a\n"):
        raise PqcSourceError("PNG signature가 올바르지 않습니다.")
    offset = 8
    matches: list[dict] = []
    while offset < len(asset):
        if offset + 12 > len(asset):
            raise PqcSourceError("잘린 PNG chunk입니다.")
        payload_length = struct.unpack_from(">I", asset, offset)[0]
        end = offset + 12 + payload_length
        if end > len(asset):
            raise PqcSourceError("PNG chunk 길이가 파일 밖을 가리킵니다.")
        chunk_type = asset[offset + 4:offset + 8]
        if chunk_type == b"caBX":
            matches.append({"start": offset, "length": end - offset})
        offset = end
        if chunk_type == b"IEND":
            break
    if len(matches) != 1:
        raise PqcSourceError(
            f"PNG caBX C2PA chunk가 정확히 하나여야 합니다: {len(matches)}개"
        )
    return matches


def _jpeg_c2pa_exclusions(asset: bytes) -> list[dict]:
    """Locate the contiguous ISO 19566-5 APP11 sequence carrying C2PA JUMBF."""
    if not asset.startswith(b"\xff\xd8"):
        raise PqcSourceError("JPEG SOI marker가 없습니다.")
    segments: list[tuple[int, int, int, bytes]] = []
    offset = 2
    while offset < len(asset):
        if asset[offset] != 0xFF:
            raise PqcSourceError("JPEG marker 경계가 올바르지 않습니다.")
        marker_start = offset
        while offset < len(asset) and asset[offset] == 0xFF:
            offset += 1
        if offset >= len(asset):
            raise PqcSourceError("잘린 JPEG marker입니다.")
        marker = asset[offset]
        offset += 1
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            if marker == 0xD9:
                break
            continue
        if offset + 2 > len(asset):
            raise PqcSourceError("잘린 JPEG segment length입니다.")
        declared = struct.unpack_from(">H", asset, offset)[0]
        if declared < 2:
            raise PqcSourceError("JPEG segment length가 올바르지 않습니다.")
        end = offset + declared
        if end > len(asset):
            raise PqcSourceError("JPEG segment가 파일 밖을 가리킵니다.")
        contents = asset[offset + 2:end]
        segments.append((marker_start, end - marker_start, marker, contents))
        offset = end
        if marker == 0xDA:  # Start of Scan: the remaining bytes are entropy-coded data.
            break

    groups: list[tuple[int, int]] = []
    index = 0
    while index < len(segments):
        start, length, marker, contents = segments[index]
        if marker != 0xEB or len(contents) <= 28 or contents[24:28] != b"c2pa":
            index += 1
            continue
        en = contents[2:4]
        group_start = start
        group_end = start + length
        index += 1
        while index < len(segments):
            next_start, next_length, next_marker, next_contents = segments[index]
            if (
                next_marker != 0xEB
                or next_start != group_end
                or len(next_contents) < 8
                or next_contents[2:4] != en
            ):
                break
            group_end = next_start + next_length
            index += 1
        groups.append((group_start, group_end - group_start))
    if len(groups) != 1:
        raise PqcSourceError(
            f"JPEG C2PA APP11 연속 영역이 정확히 하나여야 합니다: {len(groups)}개"
        )
    return [{"start": groups[0][0], "length": groups[0][1]}]


def current_c2pa_exclusions(asset: bytes) -> list[dict]:
    if asset.startswith(b"\x89PNG\r\n\x1a\n"):
        return _png_c2pa_exclusions(asset)
    if asset.startswith(b"\xff\xd8"):
        return _jpeg_c2pa_exclusions(asset)
    raise PqcSourceError(
        "현재 P1 SHA3 하드바인딩은 PNG와 JPEG 컨테이너만 지원합니다."
    )


def make_hard_binding(final_image: Path) -> dict:
    parsed = read_and_parse_classic_manifest(final_image)
    require_valid_source(parsed)
    asset = final_image.read_bytes()
    exclusions = current_c2pa_exclusions(asset)
    return {
        "alg": "sha3-256",
        "hash": hash_excluding(asset, exclusions, "sha3-256"),
        "exclusions": exclusions,
        "pad": b"",
    }
