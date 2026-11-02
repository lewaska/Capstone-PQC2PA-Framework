"""Build and sign a classic C2PA Update Manifest."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from app.adapters.c2pa_native import create_c2pa_validation_context

from c2pa import (
    Builder,
    C2paBuilderIntent,
    C2paSignerInfo,
    C2paSigningAlg,
    Signer,
)

from app.core.config import settings
from app.services.classic_c2pa import (
    ClassicC2PAReadError,
    read_and_parse_classic_manifest,
)
from app.services.fingerprint import SoftBindingFingerprint


SUPPORTED_IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


class ClassicUpdateError(Exception):
    """The classic C2PA Update Manifest could not be created."""


@dataclass(frozen=True, slots=True)
class ClassicUpdateResult:
    output_path: Path
    parent_manifest: str
    active_manifest: str
    fingerprint: SoftBindingFingerprint
    manifest_bytes: bytes


def _mime_type(path: Path) -> str:
    try:
        return SUPPORTED_IMAGE_TYPES[path.suffix.lower()]
    except KeyError as exc:
        raise ClassicUpdateError("Classic Update는 JPEG와 PNG만 지원합니다.") from exc


def _create_es256_signer(
    certificate_chain_path: Path,
    private_key_path: Path,
    timestamp_authority_url: str | None,
) -> Signer:
    try:
        certificate_chain = certificate_chain_path.read_bytes()
        private_key = private_key_path.read_bytes()
        tsa_url = (
            timestamp_authority_url.encode("utf-8")
            if timestamp_authority_url
            else None
        )
        return Signer.from_info(
            C2paSignerInfo(
                alg=C2paSigningAlg.ES256,
                sign_cert=certificate_chain,
                private_key=private_key,
                ta_url=tsa_url,
            )
        )
    except Exception as exc:
        raise ClassicUpdateError(
            "Classic Update용 ES256 signer를 만들지 못했습니다."
        ) from exc


def build_classic_update_manifest(
    source_path: Path,
    output_path: Path,
    fingerprint: SoftBindingFingerprint,
    *,
    certificate_chain_path: Path | None = None,
    private_key_path: Path | None = None,
    timestamp_authority_url: str | None = None,
) -> ClassicUpdateResult:
    """Add a soft binding in a newly signed C2PA Update Manifest.

    ``fingerprint`` must be the shared object produced once by the pipeline and
    later passed to the PQC builder as well. This function never recalculates it.
    The signed source asset is added as the sole ``parentOf`` ingredient.
    """

    source = Path(source_path).resolve()
    output = Path(output_path).resolve()
    if not source.is_file():
        raise ClassicUpdateError(f"원본 이미지가 없습니다: {source}")
    if output.exists():
        raise ClassicUpdateError(f"출력 파일이 이미 존재합니다: {output}")
    if source == output:
        raise ClassicUpdateError("원본 이미지와 출력 이미지 경로가 같습니다.")

    mime_type = _mime_type(source)
    if _mime_type(output) != mime_type:
        raise ClassicUpdateError("원본과 출력 이미지 형식이 다릅니다.")

    try:
        parent = read_and_parse_classic_manifest(source)
    except ClassicC2PAReadError as exc:
        raise ClassicUpdateError(
            "Update Manifest의 부모가 될 유효한 C2PA 매니페스트가 없습니다."
        ) from exc

    parent_manifest = parent["active_manifest"]
    manifest_definition = {
        "claim_generator_info": [
            {
                "name": "PQ-C2PA Hybrid Framework",
                "version": "0.1.0",
            }
        ],
        "title": output.name,
        "format": mime_type,
        "assertions": [fingerprint.assertion_definition()],
    }

    cert_path = certificate_chain_path or settings.es256_certificate_chain_path
    key_path = private_key_path or settings.es256_private_key_path
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        with _create_es256_signer(
            cert_path,
            key_path,
            timestamp_authority_url,
        ) as signer:
            with create_c2pa_validation_context(
                disable_thumbnail=True,
        )   as context:
                with Builder(manifest_definition, context=context) as builder:
                    builder.set_intent(C2paBuilderIntent.UPDATE)
                    with source.open("rb") as ingredient_stream:
                        builder.add_ingredient(
                            {
                                "title": source.name,
                                "relationship": "parentOf",
                            },
                            mime_type,
                            ingredient_stream,
                        )

                    with TemporaryDirectory(dir=output.parent) as temp_dir:
                        temporary_output = Path(temp_dir) / output.name
                        manifest_bytes = builder.sign_file(
                            source,
                            temporary_output,
                            signer,
                        )
                        temporary_output.replace(output)
    except ClassicUpdateError:
        raise
    except Exception as exc:
        raise ClassicUpdateError(
            "Classic C2PA Update Manifest 생성 또는 서명에 실패했습니다."
        ) from exc

    try:
        updated = read_and_parse_classic_manifest(output)
        soft_bindings = [
            assertion
            for assertion in updated["assertions"]
            if assertion["kind"] == "SOFT_BINDING"
        ]
        if len(soft_bindings) != 1:
            raise ClassicUpdateError(
                "출력 Update Manifest에서 소프트바인딩을 확인하지 못했습니다."
            )

        raw_store = updated["raw_manifest_store"]
        raw_active = raw_store["manifests"][updated["active_manifest"]]
        parent_ingredients = [
            ingredient
            for ingredient in raw_active.get("ingredients", [])
            if ingredient.get("relationship") == "parentOf"
        ]
        if len(parent_ingredients) != 1:
            raise ClassicUpdateError(
                "출력 Update Manifest의 parentOf ingredient가 올바르지 않습니다."
            )
        if parent_ingredients[0].get("active_manifest") != parent_manifest:
            raise ClassicUpdateError(
                "출력 Update Manifest가 원본 active manifest를 참조하지 않습니다."
            )
    except ClassicC2PAReadError as exc:
        raise ClassicUpdateError(
            "생성된 Classic Update Manifest를 다시 읽지 못했습니다."
        ) from exc

    return ClassicUpdateResult(
        output_path=output,
        parent_manifest=parent_manifest,
        active_manifest=updated["active_manifest"],
        fingerprint=fingerprint,
        manifest_bytes=manifest_bytes,
    )
