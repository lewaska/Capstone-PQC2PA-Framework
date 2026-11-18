import base64
from pathlib import Path

import iscc_core as ic
import pytest
from PIL import Image

from app.services.fingerprint import (
    FingerprintGenerationError,
    SOFT_BINDING_ALGORITHM,
    generate_image_fingerprint,
)


def _write_test_image(path: Path) -> None:
    image = Image.new("RGB", (64, 64))
    pixels = image.load()
    assert pixels is not None
    for y in range(64):
        for x in range(64):
            pixels[x, y] = (x * 4, y * 4, (x + y) * 2)
    image.save(path)


def test_generate_image_fingerprint_is_deterministic_and_decodable(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "sample.png"
    _write_test_image(image_path)

    first = generate_image_fingerprint(image_path)
    second = generate_image_fingerprint(image_path)

    assert first == second
    assert first.algorithm == SOFT_BINDING_ALGORITHM
    assert len(first.units) == 3
    assert tuple(ic.decode_seq(first.value)) == first.units
    assert base64.b64decode(first.value_base64) == first.value
    assert first.display.startswith("ISCC:")
    assert first.generator_name == "iscc-sdk"
    assert first.generator_version


def test_fingerprint_produces_c2pa_assertion_definition(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.jpg"
    _write_test_image(image_path)

    fingerprint = generate_image_fingerprint(image_path)
    assertion = fingerprint.assertion_definition()

    assert assertion["label"] == "c2pa.soft-binding"
    assert assertion["created"] is True
    assert assertion["data"]["alg"] == "io.iscc.v0"
    assert assertion["data"]["bindingMetadata"]["io.iscc.generator"]["name"] == "iscc-sdk"
    assert assertion["data"]["blocks"][0]["scope"] == {}
    assert bytes(assertion["data"]["blocks"][0]["value"]) == fingerprint.value


def test_reused_fingerprint_does_not_claim_an_unknown_generator() -> None:
    from app.services.fingerprint import SoftBindingFingerprint

    fingerprint = SoftBindingFingerprint(
        units=("ISCC:EEDUMMY",),
        value=b"existing-value",
    )
    assertion = fingerprint.assertion_definition()
    assert "bindingMetadata" not in assertion["data"]


def test_generate_image_fingerprint_rejects_missing_file(
    tmp_path: Path,
) -> None:
    with pytest.raises(FingerprintGenerationError):
        generate_image_fingerprint(tmp_path / "missing.png")
