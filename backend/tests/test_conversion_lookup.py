"""A soft-binding candidate must never be promoted without full validation."""
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from app.services.conversion_lookup import (
    Candidate, CandidateResolutionError, _p1_store, resolve_existing,
)
from app.services.pqc2pa import PqcBuildError
from app.services.pqc_source import manifest_map
from backend.tests.test_pqc_manifest import artifact


def test_p1_is_reconstructed_from_database_manifest_box(tmp_path: Path):
    full = artifact()
    p1_box = list(manifest_map(full).values())[-1].raw
    candidate = Candidate(
        pair_id="pair-id", public_id="pair_public", source_sha256=b"0" * 32,
        output_sha256=b"1" * 32, output_path=tmp_path / "output.png",
        classic_store=b"store", classic_store_sha256=b"2" * 32,
        p1_manifest=p1_box, p1_sha256=b"3" * 32,
        validation_id="val_public", fingerprint=b"fingerprint",
    )
    assert _p1_store(candidate) == full


def test_unverified_stripped_candidate_does_not_issue_or_return_image(tmp_path: Path):
    source = tmp_path / "source.png"
    Image.new("RGB", (64, 64), (20, 40, 60)).save(source)
    output = tmp_path / "output.png"
    candidate = Candidate(
        pair_id="pair-id", public_id="pair_public", source_sha256=b"0" * 32,
        output_sha256=b"1" * 32, output_path=tmp_path / "missing.png",
        classic_store=b"store", classic_store_sha256=b"2" * 32,
        p1_manifest=b"p1", p1_sha256=b"3" * 32,
        validation_id="val_public", fingerprint=b"fingerprint",
    )
    with (patch("app.services.conversion_lookup._candidates", return_value=[candidate]),
          patch("app.services.conversion_lookup._p1_store", return_value=b"p1-store"),
          patch("app.services.conversion_lookup._restore", side_effect=ValueError("invalid"))):
        with pytest.raises(CandidateResolutionError, match="검증 가능한 복구 결과") as error:
            resolve_existing(source, output)
    assert error.value.code == "MATCH_UNVERIFIED"
    assert not output.exists()


def test_exact_valid_source_can_replace_legacy_p1_missing_timestamp(tmp_path: Path):
    source, output = tmp_path / "source.png", tmp_path / "output.png"
    Image.new("RGB", (64, 64), (20, 40, 60)).save(source)
    from hashlib import sha256
    candidate = Candidate(
        pair_id="pair-id", public_id="pair_public",
        source_sha256=sha256(source.read_bytes()).digest(),
        output_sha256=b"1" * 32, output_path=tmp_path / "registered.png",
        classic_store=b"store", classic_store_sha256=b"2" * 32,
        p1_manifest=b"p1", p1_sha256=b"3" * 32,
        validation_id="val_public", fingerprint=b"fingerprint",
    )
    with (patch("app.services.conversion_lookup._candidates", return_value=[candidate]),
          patch("app.services.conversion_lookup.read_classic_manifest", return_value={}),
          patch("app.services.conversion_lookup.extract_source") as validate_source,
          patch("app.services.conversion_lookup._p1_store", return_value=b"old-p1"),
          patch("app.services.conversion_lookup._stored_output", return_value=source),
          patch("app.services.conversion_lookup._validate",
                side_effect=PqcBuildError("P1 omitted an available Classic timestamp"))):
        assert resolve_existing(source, output) is None
    assert validate_source.call_count == 2
    assert not output.exists()
