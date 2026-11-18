from pathlib import Path
from unittest.mock import patch

import iscc_core as ic
import pytest

from app.services.classic_preparation import (
    PreparationError,
    decode_fingerprint,
    prepare_classic_for_pq,
    select_fingerprint,
)
from app.services.fingerprint import SoftBindingFingerprint


def fingerprint(image=0xAA, data=0xBB, generator=None):
    units = tuple(
        "ISCC:" + ic.encode_component(m, s, 0, 256, bytes([body]) * 32)
        for m, s, body in [(2, 1, image), (3, 0, data), (4, 0, data)]
    )
    kwargs = {}
    if generator:
        kwargs = {"generator_name": generator[0], "generator_version": generator[1]}
    return SoftBindingFingerprint(units, ic.encode_seq(units), **kwargs)


def parsed(fp=None, *, active="m0", state="Valid"):
    return {
        "active_manifest": active,
        "assertions": [] if fp is None else [
            {"kind": "SOFT_BINDING", "data": fp.assertion_definition()["data"]}
        ],
        "raw_manifest_store": {"validation_state": state},
        "validation_results": {
            "activeManifest": {
                "success": [{"code": "claimSignature.validated"}],
                "failure": [],
            }
        },
    }


def test_reuses_existing_value_when_only_data_and_instance_changed():
    existing, current = fingerprint(data=0xAB), fingerprint(data=0xBC)
    selected, mode, reason = select_fingerprint(parsed(existing), current)
    assert selected.value == existing.value
    assert mode == "REUSE_EXISTING"
    assert reason == "IMAGE_CODE_MATCH"


def test_existing_generator_metadata_is_preserved():
    existing = fingerprint(generator=("external-generator", "2.0"))
    selected, _, _ = select_fingerprint(parsed(existing), fingerprint())
    assert selected.generator_name == "external-generator"
    assert selected.generator_version == "2.0"


def test_image_code_mismatch_does_not_silently_resign():
    with pytest.raises(PreparationError, match="Image-Code"):
        select_fingerprint(parsed(fingerprint(image=0xAA)), fingerprint(image=0x55))


@pytest.mark.parametrize("value", [[], [True], [-1], [256], "AA==", [1, 2]])
def test_rejects_malformed_values(value):
    with pytest.raises((ValueError, TypeError)):
        decode_fingerprint(value)


def test_decodes_sdk_and_crjson_base64_forms():
    expected = fingerprint()
    sdk_value = expected.value_base64
    assert decode_fingerprint(sdk_value).value == expected.value
    assert decode_fingerprint(f"b64'{sdk_value}'").value == expected.value


def test_absent_or_unsupported_binding_requires_update():
    current = fingerprint()
    assert select_fingerprint(parsed(), current)[1:] == ("ADD_SOFT_BINDING", "ABSENT")
    source = parsed(current)
    source["assertions"][0]["data"]["blocks"][0]["scope"] = {"extent": 1}
    assert select_fingerprint(source, current)[2] == "UNSUPPORTED_SCOPE"


def test_multiple_assertions_or_blocks_are_ambiguous():
    current = fingerprint()
    source = parsed(current)
    source["assertions"] *= 2
    with pytest.raises(PreparationError) as assertions_error:
        select_fingerprint(source, current)
    assert assertions_error.value.code == "FINGERPRINT_AMBIGUOUS"

    source = parsed(current)
    source["assertions"][0]["data"]["blocks"] *= 2
    with pytest.raises(PreparationError) as blocks_error:
        select_fingerprint(source, current)
    assert blocks_error.value.code == "FINGERPRINT_AMBIGUOUS"


def test_reuse_does_not_sign_and_preserves_all_bytes(tmp_path: Path):
    source, output = tmp_path / "source.png", tmp_path / "output.png"
    source.write_bytes(b"original")
    shared = fingerprint()
    with (
        patch("app.services.classic_preparation.read_and_parse_classic_manifest", side_effect=[parsed(shared), parsed(shared)]),
        patch("app.services.classic_preparation.generate_image_fingerprint", side_effect=[shared, shared]),
        patch("app.services.classic_preparation.build_classic_update_manifest") as build,
    ):
        result = prepare_classic_for_pq(source, output)
    build.assert_not_called()
    assert output.read_bytes() == source.read_bytes()
    assert result.mode == "REUSE_EXISTING"
    assert result.fingerprint.value == shared.value
    assert result.computed_fingerprint.value == shared.value
    assert result.source_validation_state == "Valid"
    assert result.output_validation_state == "Valid"


def test_invalid_source_never_generates_or_signs(tmp_path: Path):
    source = tmp_path / "source.png"
    source.write_bytes(b"source")
    with (
        patch("app.services.classic_preparation.read_and_parse_classic_manifest", return_value=parsed(state="Invalid")),
        patch("app.services.classic_preparation.generate_image_fingerprint") as generate,
        patch("app.services.classic_preparation.build_classic_update_manifest") as build,
    ):
        with pytest.raises(PreparationError):
            prepare_classic_for_pq(source, tmp_path / "out.png")
    generate.assert_not_called()
    build.assert_not_called()


def test_update_is_committed_only_after_output_validation(tmp_path: Path):
    source, output = tmp_path / "source.png", tmp_path / "out.png"
    source.write_bytes(b"original")
    shared = fingerprint()

    def build(_source, candidate, _fingerprint):
        candidate.write_bytes(b"signed")

    with (
        patch("app.services.classic_preparation.read_and_parse_classic_manifest", side_effect=[parsed(), parsed(shared, active="m1")]),
        patch("app.services.classic_preparation.generate_image_fingerprint", side_effect=[shared, fingerprint(data=0xCC)]),
        patch("app.services.classic_preparation.build_classic_update_manifest", side_effect=build),
    ):
        result = prepare_classic_for_pq(source, output)
    assert output.read_bytes() == b"signed"
    assert result.mode == "ADD_SOFT_BINDING"
    assert result.active_manifest == "m1"


def test_failed_output_validation_leaves_no_final_file(tmp_path: Path):
    source, output = tmp_path / "source.png", tmp_path / "out.png"
    source.write_bytes(b"original")
    shared = fingerprint()

    def build(_source, candidate, _fingerprint):
        candidate.write_bytes(b"bad-output")

    with (
        patch("app.services.classic_preparation.read_and_parse_classic_manifest", side_effect=[parsed(), parsed(fingerprint(data=0xCC), active="m1")]),
        patch("app.services.classic_preparation.generate_image_fingerprint", side_effect=[shared, shared]),
        patch("app.services.classic_preparation.build_classic_update_manifest", side_effect=build),
    ):
        with pytest.raises(PreparationError, match="선택한 값"):
            prepare_classic_for_pq(source, output)
    assert not output.exists()


def test_changed_output_image_code_leaves_no_final_file(tmp_path: Path):
    source, output = tmp_path / "source.png", tmp_path / "out.png"
    source.write_bytes(b"original")
    shared = fingerprint()

    def build(_source, candidate, _fingerprint):
        candidate.write_bytes(b"changed")

    with (
        patch("app.services.classic_preparation.read_and_parse_classic_manifest", side_effect=[parsed(), parsed(shared, active="m1")]),
        patch("app.services.classic_preparation.generate_image_fingerprint", side_effect=[shared, fingerprint(image=0x55)]),
        patch("app.services.classic_preparation.build_classic_update_manifest", side_effect=build),
    ):
        with pytest.raises(PreparationError) as error:
            prepare_classic_for_pq(source, output)
    assert error.value.code == "OUTPUT_IMAGE_CODE_CHANGED"
    assert not output.exists()


def test_rejects_missing_source_and_format_mismatch(tmp_path: Path):
    with pytest.raises(PreparationError) as missing:
        prepare_classic_for_pq(tmp_path / "missing.png", tmp_path / "out.png")
    assert missing.value.code == "SOURCE_NOT_FOUND"

    source = tmp_path / "source.png"
    source.write_bytes(b"source")
    with pytest.raises(PreparationError) as mismatch:
        prepare_classic_for_pq(source, tmp_path / "out.jpg")
    assert mismatch.value.code == "OUTPUT_FORMAT_MISMATCH"
