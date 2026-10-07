from app.services.mldsa import (
    generate_mldsa65_keypair,
    sign_mldsa65,
    verify_mldsa65,
)


def test_mldsa65_sign_and_verify(tmp_path):
    private_key = tmp_path / "private.pem"
    public_key = tmp_path / "public.pem"

    generate_mldsa65_keypair(private_key, public_key)

    claim_bytes = b"temporary canonical CBOR claim bytes"
    signature = sign_mldsa65(claim_bytes, private_key)

    assert verify_mldsa65(claim_bytes, signature, public_key)
    assert not verify_mldsa65(
        b"tampered claim bytes",
        signature,
        public_key,
    )