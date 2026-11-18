"""Manual independent layout check, using standard algorithms only.

Run from backend: python -m tests.p1_sdk_probe --image path/to/prepared.png
Never deploy this SHA256/ES256 test artifact as a PQ artifact.
"""
import argparse
import io
import json
from pathlib import Path

import cbor2
from c2pa import Reader
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

from app.adapters.c2pa_native import create_c2pa_validation_context
from app.core.config import settings
from app.services import pqc_manifest as pm
from app.services.pqc_source import cbor_payload, extract_source, hash_excluding, make_hard_binding


def probe(image):
    source = extract_source(image)
    key = serialization.load_pem_private_key(settings.es256_private_key_path.read_bytes(), password=None)
    chain = [cert.public_bytes(serialization.Encoding.DER) for cert in
             x509.load_pem_x509_certificates(settings.es256_certificate_chain_path.read_bytes())]

    def sign(claim):
        protected = pm.encode({1: -7, 33: chain})
        signature = key.sign(pm.encode(["Signature1", protected, b"", claim]), ec.ECDSA(hashes.SHA256()))
        r, s = utils.decode_dss_signature(signature)
        return pm.encode(cbor2.CBORTag(18, [protected, {}, None, r.to_bytes(32, "big") + s.to_bytes(32, "big")]))

    binding = make_hard_binding(image)
    binding.update(alg="sha256", hash=hash_excluding(image.read_bytes(), binding["exclusions"], "sha256"))
    soft = next(cbor2.loads(cbor_payload(pm.one_box(raw))) for label, raw in source.assertions
                if label == "c2pa.soft-binding")
    original_algorithm = pm.ALGORITHM
    try:
        pm.ALGORITHM = "sha256"  # isolated test process; production remains SHA3
        raw = pm.assemble(source, soft, binding, sign)
    finally:
        pm.ALGORITHM = original_algorithm
    with Reader("image/png" if image.suffix == ".png" else "image/jpeg", io.BytesIO(image.read_bytes()),
                manifest_data=raw, context=create_c2pa_validation_context()) as reader:
        report = json.loads(reader.json())
    results = report.get("validation_results", {})
    print(json.dumps({"state": report.get("validation_state"), "results": results}, indent=2))
    assert report.get("validation_state") in {"Valid", "Trusted"}
    assert not results.get("activeManifest", {}).get("failure")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, type=Path)
    probe(parser.parse_args().image)
