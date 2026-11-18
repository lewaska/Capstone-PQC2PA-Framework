from c2pa import Context

from app.core.config import PROJECT_ROOT, settings


def create_c2pa_validation_context(
    *,
    disable_thumbnail: bool = False,
) -> Context:
    trust_dir = PROJECT_ROOT / "certs" / "trust-lists"

    # 공식 공개 서명자 인증서 목록
    public_signer_pem = (
        trust_dir / "C2PA-TRUST-LIST.pem"
    ).read_text(encoding="utf-8")

    # 공식 공개 타임스탬프 인증서 목록
    public_tsa_pem = (
        trust_dir / "C2PA-TSA-TRUST-LIST.pem"
    ).read_text(encoding="utf-8")

    # 기존 프로젝트 자체 CA 유지
    project_root_pem = settings.c2pa_trust_anchor_path.read_text(
        encoding="utf-8"
    )

    config = {
        "version": 1,
        "trust": {
            "trust_anchors": (
                public_signer_pem.strip()
                + "\n"
                + public_tsa_pem.strip()
                + "\n"
            ),
            "user_anchors": project_root_pem,
            "trust_config": "\n".join([
                "1.3.6.1.4.1.62558.2.1",  # C2PA claim signing
                "1.3.6.1.5.5.7.3.36",    # Document signing
                "1.3.6.1.5.5.7.3.4",     # Email protection: 기존 인증서 호환
            ]),
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