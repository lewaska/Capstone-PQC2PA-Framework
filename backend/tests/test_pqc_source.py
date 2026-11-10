import struct

import pytest

from app.services.pqc_source import (
    PqcSourceError,
    current_c2pa_exclusions,
    hash_excluding,
)


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + b"\x00\x00\x00\x00"


def test_png_c2pa_exclusion_covers_complete_cabx_chunk():
    prefix = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", b"header")
    cabx = png_chunk(b"caBX", b"manifest-store")
    asset = prefix + cabx + png_chunk(b"IDAT", b"pixels") + png_chunk(b"IEND", b"")

    assert current_c2pa_exclusions(asset) == [
        {"start": len(prefix), "length": len(cabx)}
    ]


def jpeg_segment(marker: int, contents: bytes) -> bytes:
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(contents) + 2) + contents


def test_jpeg_c2pa_exclusion_covers_contiguous_app11_sequence():
    first_contents = b"JP" + b"\x00\x07" + struct.pack(">I", 1) + b"x" * 16 + b"c2pa" + b"one"
    next_contents = b"JP" + b"\x00\x07" + struct.pack(">I", 2) + b"two"
    prefix = b"\xff\xd8" + jpeg_segment(0xE0, b"JFIF")
    c2pa = jpeg_segment(0xEB, first_contents) + jpeg_segment(0xEB, next_contents)
    asset = prefix + c2pa + jpeg_segment(0xDA, b"scan") + b"entropy\xff\xd9"

    assert current_c2pa_exclusions(asset) == [
        {"start": len(prefix), "length": len(c2pa)}
    ]


def test_hash_excluding_ignores_only_declared_c2pa_region():
    asset = b"prefix-C2PA-suffix"
    exclusions = [{"start": 7, "length": 4}]
    digest = hash_excluding(asset, exclusions, "sha3-256")

    assert digest == hash_excluding(b"prefix-xxxx-suffix", exclusions, "sha3-256")
    assert digest != hash_excluding(b"Prefix-C2PA-suffix", exclusions, "sha3-256")


def test_rejects_missing_or_multiple_c2pa_regions():
    without = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IEND", b"")
    with pytest.raises(PqcSourceError, match="정확히 하나"):
        current_c2pa_exclusions(without)

    duplicated = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"caBX", b"one")
        + png_chunk(b"caBX", b"two")
        + png_chunk(b"IEND", b"")
    )
    with pytest.raises(PqcSourceError, match="정확히 하나"):
        current_c2pa_exclusions(duplicated)

