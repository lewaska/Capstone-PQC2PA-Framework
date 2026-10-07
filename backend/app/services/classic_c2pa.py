import json
from pathlib import Path
from typing import Any

from c2pa import Reader


HARD_BINDING_LABELS = {
    "c2pa.hash.data",
    "c2pa.hash.boxes",
    "c2pa.hash.collection.data",
    "c2pa.hash.bmff.v2",
    "c2pa.hash.bmff.v3",
}


class ClassicC2PAReadError(Exception):
    """Classic C2PA manifest를 읽지 못했습니다."""


class ClassicC2PAStructureError(ClassicC2PAReadError):
    """SDK가 반환한 manifest 구조에서 Active Manifest를 찾지 못했습니다."""


def read_classic_manifest(image_path: Path) -> dict[str, Any]:
    """공식 SDK로 Classic C2PA Manifest Store 전체를 읽습니다."""

    try:
        reader = Reader(str(image_path))
        return json.loads(reader.json())
    except Exception as exc:
        raise ClassicC2PAReadError(
            "이미지에서 Classic C2PA manifest를 읽지 못했습니다."
        ) from exc


def classify_assertion(label: str) -> str:
    """표시와 변환 정책에 사용할 수 있도록 Assertion 종류를 분류합니다."""

    base_label = label.split("__", 1)[0]

    if base_label in {"c2pa.actions", "c2pa.actions.v2"}:
        return "ACTIONS"
    if base_label in HARD_BINDING_LABELS:
        return "HARD_BINDING"
    if base_label in {
        "c2pa.ingredient",
        "c2pa.ingredient.v2",
        "c2pa.ingredient.v3",
    }:
        return "INGREDIENT"
    if base_label.startswith("c2pa.thumbnail"):
        return "THUMBNAIL"
    if base_label in {"c2pa.metadata", "c2pa.ai-disclosure"}:
        return "METADATA"
    return "OTHER"


def parse_active_manifest(manifest_store: dict[str, Any]) -> dict[str, Any]:
    """Manifest Store에서 Active Manifest의 Claim과 모든 Assertion을 분리합니다.

    JSON은 SDK가 제공하는 검증·표시용 표현입니다. 이 함수의 결과를 다시
    직렬화해 Claim 서명 입력이나 hard binding 입력으로 사용하면 안 됩니다.
    해당 바이트 처리는 향후 c2pa-rs Fork가 담당합니다.
    """

    active_label = manifest_store.get("active_manifest")
    manifests = manifest_store.get("manifests")

    if not isinstance(active_label, str) or not active_label:
        raise ClassicC2PAStructureError("Active Manifest 식별자가 없습니다.")
    if not isinstance(manifests, dict):
        raise ClassicC2PAStructureError("manifests 항목이 객체가 아닙니다.")

    active_manifest = manifests.get(active_label)
    if not isinstance(active_manifest, dict):
        raise ClassicC2PAStructureError(
            "Active Manifest를 manifests 항목에서 찾을 수 없습니다."
        )

    raw_assertions = active_manifest.get("assertions", [])
    if not isinstance(raw_assertions, list):
        raise ClassicC2PAStructureError("assertions 항목이 배열이 아닙니다.")

    assertions: list[dict[str, Any]] = []
    for assertion in raw_assertions:
        if not isinstance(assertion, dict):
            raise ClassicC2PAStructureError(
                "assertions 배열에 객체가 아닌 값이 포함되어 있습니다."
            )

        label = assertion.get("label")
        if not isinstance(label, str) or not label:
            raise ClassicC2PAStructureError("Assertion label이 없습니다.")

        assertions.append(
            {
                "label": label,
                "kind": classify_assertion(label),
                "data": assertion.get("data"),
                "raw": assertion,
            }
        )

    kinds = {assertion["kind"] for assertion in assertions}

    return {
        "active_manifest": active_label,
        "claim": {
            "label": active_manifest.get("label"),
            "claim_version": active_manifest.get("claim_version"),
            "title": active_manifest.get("title"),
            "format": active_manifest.get("format"),
            "instance_id": active_manifest.get("instance_id"),
            "claim_generator_info": active_manifest.get(
                "claim_generator_info", []
            ),
            "signature_info": active_manifest.get("signature_info"),
        },
        "assertions": assertions,
        "assertion_count": len(assertions),
        "required_assertions_observed": {
            "actions": "ACTIONS" in kinds,
            "hard_binding": "HARD_BINDING" in kinds,
        },
        "validation_status": manifest_store.get("validation_status", []),
        "validation_results": manifest_store.get("validation_results"),
        "raw_manifest_store": manifest_store,
    }


def read_and_parse_classic_manifest(image_path: Path) -> dict[str, Any]:
    """Classic C2PA를 읽고 Active Manifest의 표시용 모델을 반환합니다."""

    return parse_active_manifest(read_classic_manifest(image_path))
