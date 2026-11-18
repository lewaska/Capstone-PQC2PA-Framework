from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.classic_update import (
    ClassicUpdateError,
    build_classic_update_manifest,
)
from app.services.fingerprint import SoftBindingFingerprint


def _fingerprint() -> SoftBindingFingerprint:
    return SoftBindingFingerprint(
        units=("ISCC:EEDUMMY",),
        value=b"shared-fingerprint",
    )


def test_classic_update_refuses_to_overwrite_output(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    output = tmp_path / "output.png"
    source.write_bytes(b"source")
    output.write_bytes(b"existing")

    with pytest.raises(ClassicUpdateError, match="이미 존재"):
        build_classic_update_manifest(source, output, _fingerprint())


@patch("app.services.classic_update.read_and_parse_classic_manifest")
@patch("app.services.classic_update.Builder")
@patch("app.services.classic_update.create_c2pa_validation_context")
@patch("app.services.classic_update._create_es256_signer")
def test_classic_update_uses_shared_fingerprint_and_update_intent(
    create_signer: MagicMock,
    create_context: MagicMock,
    builder_class: MagicMock,
    read_manifest: MagicMock,
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.png"
    output = tmp_path / "output.png"
    source.write_bytes(b"source")
    fingerprint = _fingerprint()

    read_manifest.side_effect = [
        {"active_manifest": "parent", "assertions": []},
        {
            "active_manifest": "update",
            "assertions": [{"kind": "SOFT_BINDING"}],
            "raw_manifest_store": {
                "manifests": {
                    "update": {
                        "ingredients": [
                            {
                                "relationship": "parentOf",
                                "active_manifest": "parent",
                            }
                        ]
                    }
                }
            },
        },
    ]

    signer = create_signer.return_value.__enter__.return_value
    context = create_context.return_value.__enter__.return_value
    builder = builder_class.return_value.__enter__.return_value

    def fake_sign_file(
        source_path: Path,
        destination_path: Path,
        passed_signer: object,
    ) -> bytes:
        assert source_path == source.resolve()
        assert passed_signer is signer
        destination_path.write_bytes(b"signed")
        return b"manifest"

    builder.sign_file.side_effect = fake_sign_file

    result = build_classic_update_manifest(source, output, fingerprint)

    manifest_definition = builder_class.call_args.args[0]
    assert manifest_definition["assertions"] == [
        fingerprint.assertion_definition()
    ]
    create_context.assert_called_once_with(disable_thumbnail=True)
    builder.set_intent.assert_called_once()
    ingredient = builder.add_ingredient.call_args.args[0]
    assert ingredient["relationship"] == "parentOf"
    assert result.fingerprint is fingerprint
    assert result.parent_manifest == "parent"
    assert result.active_manifest == "update"
    assert output.read_bytes() == b"signed"
