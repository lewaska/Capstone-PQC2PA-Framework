from c2pa import Context

from app.core.config import settings


def create_c2pa_validation_context(
    *,
    disable_thumbnail: bool = False,
) -> Context:
    root_ca_pem = settings.c2pa_trust_anchor_path.read_text(
        encoding="utf-8"
    )

    config = {
        "version": 1,
        "trust": {
            "user_anchors": root_ca_pem,
        },
        "verify": {
            "verify_after_reading": True,
            "verify_after_sign": True,
            "verify_trust": True,
            "verify_timestamp_trust": True,
            "remote_manifest_fetch": False,
        },
    }

    if disable_thumbnail:
        config["builder"] = {
            "thumbnail": {
                "enabled": False,
            }
        }

    return Context.from_dict(config)