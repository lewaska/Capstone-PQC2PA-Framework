import pytest

from app.services.classic_c2pa import (
    ClassicC2PAStructureError,
    classify_assertion,
    parse_active_manifest,
)


def test_classify_assertion() -> None:
    assert classify_assertion("c2pa.actions.v2") == "ACTIONS"
    assert classify_assertion("c2pa.hash.boxes") == "HARD_BINDING"
    assert classify_assertion("c2pa.ingredient.v3__1") == "INGREDIENT"
    assert classify_assertion("example.custom") == "OTHER"


def test_parse_active_manifest_keeps_and_classifies_all_assertions() -> None:
    active_label = "urn:c2pa:test-manifest"
    manifest_store = {
        "active_manifest": active_label,
        "manifests": {
            active_label: {
                "label": active_label,
                "claim_version": 2,
                "instance_id": "xmp:iid:test",
                "claim_generator_info": [{"name": "Example"}],
                "assertions": [
                    {"label": "c2pa.actions.v2", "data": {"actions": []}},
                    {"label": "c2pa.hash.boxes", "data": {"alg": "sha256"}},
                    {"label": "example.custom", "data": {"value": 1}},
                ],
            }
        },
        "validation_status": [],
    }

    parsed = parse_active_manifest(manifest_store)

    assert parsed["active_manifest"] == active_label
    assert parsed["claim"]["claim_version"] == 2
    assert parsed["assertion_count"] == 3
    assert [item["kind"] for item in parsed["assertions"]] == [
        "ACTIONS",
        "HARD_BINDING",
        "OTHER",
    ]
    assert parsed["required_assertions_observed"] == {
        "actions": True,
        "hard_binding": True,
    }


def test_parse_active_manifest_rejects_missing_active_manifest() -> None:
    with pytest.raises(ClassicC2PAStructureError):
        parse_active_manifest({"manifests": {}})
