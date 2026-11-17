"""Persist one verified M0/M1/P1 conversion in the project PostgreSQL schema.

The stored Classic manifest store is the complete final store. A registration is
activated only after the DB's own activation function accepts its evidence.
"""
from __future__ import annotations

import hashlib
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cbor2
import psycopg
import rfc8785
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from psycopg.types.json import Jsonb

from app.services.classic_preparation import decode_fingerprint
from app.services.fingerprint import generate_image_fingerprint
from app.services.pqc_source import (
    child_map, decode_cose, export_store, manifest_map, boxes, cbor_payload,
    extract_source,
)
from app.services.pqc_manifest import inspect as inspect_p1, PROFILE
from app.services.source_timestamp import timestamp_input_from_cose
from app.services.timestamp_record import read_timestamp_record
from app.core.config import settings


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _fingerprint(cur, fingerprint) -> uuid.UUID:
    units = fingerprint.units
    value = fingerprint.value
    cur.execute(
        """INSERT INTO pq_c2pa.fingerprints
        (id,algorithm,canonical_value,image_code,data_code,instance_code,display,
         image_unit_version,image_unit_bits,data_unit_version,data_unit_bits,
         instance_unit_version,instance_unit_bits,image_featureless,unit_format)
        VALUES (%s,'io.iscc.v0',%s,%s,%s,%s,%s,0,256,0,256,0,256,false,%s)
        ON CONFLICT (algorithm,canonical_value) DO UPDATE SET algorithm=EXCLUDED.algorithm
        RETURNING id""",
        (uuid.uuid4(), value, *units, fingerprint.display, Jsonb([
            {"type": kind, "version": 0, "bits": 256}
            for kind in ("IMAGE", "DATA", "INSTANCE")
        ])),
    )
    return cur.fetchone()[0]


def _asset(cur, data: bytes, filename: str, media_type: str, role: str,
           storage_key: str, parent: uuid.UUID | None = None) -> uuid.UUID:
    asset_id = uuid.uuid4()
    cur.execute(
        """INSERT INTO pq_c2pa.assets
        (id,parent_asset_id,role,original_filename,media_type,size_bytes,sha256,
         storage_key,storage_state)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'AVAILABLE')""",
        (asset_id, parent, role, filename, media_type, len(data), _sha256(data), storage_key),
    )
    return asset_id


def _asset_fingerprint(cur, asset_id, fingerprint_id, purpose, fingerprint) -> None:
    cur.execute(
        """INSERT INTO pq_c2pa.asset_fingerprints
        (id,asset_id,fingerprint_id,purpose,calculated_at,profile_version,
         input_basis,generator_name,generator_version)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (uuid.uuid4(), asset_id, fingerprint_id, purpose,
         datetime.now(timezone.utc), "iscc-v0-image-data-instance-256",
         "FILE_BYTES", fingerprint.generator_name or "iscc-sdk",
         fingerprint.generator_version or "unknown"),
    )


def _certificate(cur, der: bytes) -> uuid.UUID:
    cert = x509.load_der_x509_certificate(der)
    try:
        is_ca = cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    except x509.ExtensionNotFound:
        is_ca = False
    try:
        eku = [oid.dotted_string for oid in cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value]
    except x509.ExtensionNotFound:
        eku = []
    try:
        usage = cert.extensions.get_extension_for_class(x509.KeyUsage).value
        key_usage = {"digital_signature": usage.digital_signature, "key_cert_sign": usage.key_cert_sign}
    except x509.ExtensionNotFound:
        key_usage = {}
    cur.execute(
        """INSERT INTO pq_c2pa.certificates
        (id,der_bytes,der_sha256,subject_dn,issuer_dn,serial_hex,
         public_key_algorithm,certificate_signature_algorithm,spki_der,
         not_before,not_after,is_ca,key_usage,extended_key_usage)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (der_sha256) DO UPDATE SET der_sha256=EXCLUDED.der_sha256
        RETURNING id""",
        (uuid.uuid4(), der, _sha256(der), cert.subject.rfc4514_string(),
         cert.issuer.rfc4514_string(), format(cert.serial_number, "x"),
         cert.public_key_algorithm_oid.dotted_string,
         cert.signature_algorithm_oid.dotted_string,
         cert.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo),
         cert.not_valid_before_utc, cert.not_valid_after_utc, is_ca,
         Jsonb(key_usage), Jsonb(eku)),
    )
    return cur.fetchone()[0]


def _signature(cur, manifest_id, claim: bytes, cose: bytes, raw: bytes,
               chain: tuple[bytes, ...], algorithm: str) -> None:
    if not chain:
        raise ValueError("Signing certificate chain is absent")
    cur.execute(
        "SELECT raw_signature,cose_sign1,signed_payload FROM pq_c2pa.signatures WHERE manifest_id=%s",
        (manifest_id,),
    )
    existing = cur.fetchone()
    if existing:
        if tuple(bytes(value) for value in existing) != (raw, cose, claim):
            raise ValueError("Stored Classic signature differs from current bytes")
        return
    certificate_ids = [_certificate(cur, der) for der in chain]
    signature_id = uuid.uuid4()
    value = cbor2.loads(cose)
    if isinstance(value, cbor2.CBORTag):
        value = value.value
    protected_raw = value[0]
    cur.execute(
        """INSERT INTO pq_c2pa.signatures
        (id,manifest_id,algorithm,raw_signature,cose_sign1,protected_headers,
         signed_payload,payload_format,signer_certificate_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,'CBOR',%s)""",
        (signature_id, manifest_id, algorithm, raw, cose, protected_raw,
         claim, certificate_ids[0]),
    )
    for position, cert_id in enumerate(certificate_ids):
        cur.execute(
            "INSERT INTO pq_c2pa.signature_certificates (signature_id,position,certificate_id) VALUES (%s,%s,%s)",
            (signature_id, position, cert_id),
        )


def _haetae_signature(cur, manifest_id, claim: bytes, cose: bytes, raw: bytes) -> None:
    """P1 uses a pinned raw HAETAE key, not an unrelated X.509 credential."""
    from app.services.haetae import public_key
    key_reference = "haetae3:sha256:" + hashlib.sha256(public_key()).hexdigest()
    value = cbor2.loads(cose)
    protected_raw = value.value[0]
    cur.execute(
        """INSERT INTO pq_c2pa.signatures
        (id,manifest_id,algorithm,raw_signature,cose_sign1,protected_headers,
         signed_payload,payload_format,signer_certificate_id,key_reference)
        VALUES (%s,%s,'HAETAE-3',%s,%s,%s,%s,'CBOR',NULL,%s)""",
        (uuid.uuid4(), manifest_id, raw, cose, protected_raw, claim, key_reference),
    )


def _classic_signature(store: bytes, label: str):
    manifest = manifest_map(store)[label]
    children = child_map(manifest)
    claim = next(v for k, v in children.items() if k in {"c2pa.claim", "c2pa.claim.v2"})
    cose = cbor_payload(children["c2pa.signature"])
    protected, unprotected, _, signature = decode_cose(cose)
    chain = protected.get(33, unprotected.get(33))
    if isinstance(chain, bytes):
        chain = [chain]
    if not chain:
        raise ValueError("Classic signer certificate is missing")
    algorithm = protected.get(1, "UNKNOWN")
    return cbor_payload(claim), cose, signature, tuple(chain), str(algorithm)


def _policy(cur) -> uuid.UUID:
    from app.services.haetae import public_key
    version = "lab-pq-c2pa-haetae3-1"
    cur.execute("SELECT id FROM pq_c2pa.trust_policies WHERE version=%s", (version,))
    existing = cur.fetchone()
    if existing:
        return existing[0]
    rules = {"scope": "local-pinned-haetae3-key", "p1_profile": PROFILE,
             "public_key_sha256": _sha256(public_key()).hex()}
    policy_id = uuid.uuid4()
    cur.execute(
        """INSERT INTO pq_c2pa.trust_policies
        (id,version,scope,rules,rules_sha256,validator_version)
        VALUES (%s,%s,'LOCAL',%s,%s,'pqc2pa-backend-1')""",
        (policy_id, version, Jsonb(rules), _sha256(rfc8785.dumps(rules))),
    )
    return policy_id


def _register_timestamp(cur, pair_id, p1_id, source_manifest_id,
                        binding_manifest_id, source_label, final_label,
                        final_store: bytes, source_timestamp: dict | None) -> str:
    """Persist a sigTst2 token only after its signed-input imprint matches."""
    if source_timestamp is None:
        return "NOT_APPLICABLE"
    if source_timestamp["storage"] != "sigTst2":
        # Legacy sigTst remains recoverable from the preserved Classic store/P1.
        return "NOT_APPLICABLE"
    issued = source_timestamp["source"] == "ISSUED"
    label = final_label if issued else source_label
    target_manifest_id = binding_manifest_id if issued else source_manifest_id
    if source_timestamp["sourceManifest"] != label:
        raise ValueError("Timestamp target manifest does not match stored Classic signature")
    _, cose, signature, _, _ = _classic_signature(final_store, label)
    if (source_timestamp["targetSignatureHash"]["hash"]
            != hashlib.sha3_256(signature).digest()):
        raise ValueError("Timestamp target signature hash differs from stored signature")
    from app.services.pqc_source import decode_cose, _timestamp_tokens
    _, unprotected, _, _ = decode_cose(cose)
    token = source_timestamp["token"]
    if token not in _timestamp_tokens(unprotected):
        raise ValueError("P1 timestamp is absent from the stored Classic signature")
    payload = timestamp_input_from_cose(cose)
    try:
        record = read_timestamp_record(token, payload)
    except ValueError:
        if issued:
            raise
        # External sigTst2 evidence is preserved byte-for-byte in M0 and P1.
        # Its imprint input may differ from our local TSA profile; do not
        # fabricate a timestamp_evidence row with an unverified payload.
        return "NOT_APPLICABLE"
    tsa_cert_id = None
    if issued:
        from app.services.rfc3161 import verify_rfc3161_token
        if not verify_rfc3161_token(payload, token):
            raise ValueError("Newly issued sigTst2 did not verify against the project TSA")
        raw_cert = settings.tsa_certificate_path.read_bytes()
        cert = x509.load_pem_x509_certificate(raw_cert)
        tsa_cert_id = _certificate(cur, cert.public_bytes(Encoding.DER))
    cur.execute(
        """INSERT INTO pq_c2pa.timestamp_tokens
        (id,token_der,token_sha256,generation_time,serial_hex,policy_oid,
         message_imprint_algorithm,message_imprint,tsa_signer_certificate_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (token_sha256) DO UPDATE SET token_sha256=EXCLUDED.token_sha256
        RETURNING id,token_der""",
        (uuid.uuid4(), token, _sha256(token), record.generation_time,
         record.serial_hex, record.policy_oid, record.message_imprint_algorithm,
         record.message_imprint, tsa_cert_id),
    )
    timestamp_id, stored_token = cur.fetchone()
    if bytes(stored_token) != token:
        raise ValueError("Timestamp digest collision or stored token mismatch")
    cur.execute("SELECT id FROM pq_c2pa.signatures WHERE manifest_id=%s", (target_manifest_id,))
    signature_id = cur.fetchone()[0]
    cur.execute(
        """INSERT INTO pq_c2pa.timestamp_evidence
        (id,pair_id,timestamp_id,target_signature_id,purpose,origin,storage_kind,
         payload_format,timestamped_payload,carrier_manifest_id)
        VALUES (%s,%s,%s,%s,%s,%s,'sigTst2','COSE_COUNTERSIGNATURE',%s,%s)""",
        (uuid.uuid4(), pair_id, timestamp_id, signature_id,
         "CLASSIC_UPDATE_SIGNATURE" if issued else "SOURCE_SIGNATURE",
         "ISSUED_BY_FRAMEWORK" if issued else "EXISTING", payload, p1_id),
    )
    return "VALID" if issued else "NOT_APPLICABLE"


def persist_conversion(source_path: Path, output_path: Path, p1_path: Path,
                       filename: str, conversion_id: str, build: dict) -> dict:
    """Store verified bytes and activate atomically; never mark an incomplete pair active."""
    password = os.environ.get("PQC2PA_DB_PASSWORD")
    if not password:
        raise RuntimeError("PQC2PA_DB_PASSWORD is not configured")
    source_bytes, output_bytes, p1_bytes = (
        source_path.read_bytes(), output_path.read_bytes(), p1_path.read_bytes()
    )
    source = extract_source(source_path)
    final = extract_source(output_path)
    final_store = export_store(output_path)
    p1 = inspect_p1(p1_bytes)
    shared = decode_fingerprint(build["fingerprint_base64"])
    computed_input = generate_image_fingerprint(source_path)
    observed_output = generate_image_fingerprint(output_path)
    media_type = "image/png" if output_path.suffix.lower() == ".png" else "image/jpeg"
    now = datetime.now(timezone.utc)
    with psycopg.connect(host="127.0.0.1", port=5432, dbname="pqc2pa_db",
                         user="pqc2pa_user", password=password) as connection:
        with connection.cursor() as cur:
            source_id = _asset(cur, source_bytes, filename, media_type, "SOURCE", str(source_path))
            output_id = _asset(cur, output_bytes, output_path.name, media_type,
                               "AUGMENTED", str(output_path), source_id)
            shared_id = _fingerprint(cur, shared)
            input_fp_id = _fingerprint(cur, computed_input)
            output_fp_id = _fingerprint(cur, observed_output)
            _asset_fingerprint(cur, source_id, input_fp_id, "ISSUANCE_INPUT", computed_input)
            _asset_fingerprint(cur, output_id, output_fp_id, "OUTPUT_OBSERVATION", observed_output)
            if shared_id != input_fp_id and build["classic_action"] == "ADD_SOFT_BINDING":
                raise ValueError("New fingerprint differs from input observation")
            cur.execute(
                """INSERT INTO pq_c2pa.manifest_stores
                (id,raw_store,sha256,sha3_256,size_bytes,container_format,
                 active_manifest_label,evidence_completeness)
                VALUES (%s,%s,%s,%s,%s,'JUMBF',%s,'COMPLETE')
                ON CONFLICT (sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id""",
                (uuid.uuid4(), final_store, _sha256(final_store),
                 hashlib.sha3_256(final_store).digest(), len(final_store), final.manifest_id),
            )
            store_id = cur.fetchone()[0]
            classic_ids = {}
            final_manifests = manifest_map(final_store)
            for label in final_manifests:
                if label == final.manifest_id and label != source.manifest_id:
                    continue
                cur.execute(
                    """INSERT INTO pq_c2pa.manifests
                    (id,kind,manifest_label,profile_version,store_id,manifest_locator,manifest_type)
                    VALUES (%s,'CLASSIC',%s,'c2pa-classic',%s,%s,'UNKNOWN')
                    ON CONFLICT (store_id,manifest_locator) DO UPDATE SET manifest_label=EXCLUDED.manifest_label
                    RETURNING id""",
                    (uuid.uuid4(), label, store_id, f"self#jumbf=/c2pa/{label}"),
                )
                classic_ids[label] = cur.fetchone()[0]
            if final.manifest_id != source.manifest_id:
                cur.execute(
                    """INSERT INTO pq_c2pa.manifests
                    (id,kind,manifest_label,parent_manifest_id,profile_version,store_id,
                     manifest_locator,manifest_type)
                    VALUES (%s,'CLASSIC',%s,%s,'c2pa-classic',%s,%s,'UPDATE') RETURNING id""",
                    (uuid.uuid4(), final.manifest_id, classic_ids[source.manifest_id],
                     store_id, f"self#jumbf=/c2pa/{final.manifest_id}"),
                )
                classic_ids[final.manifest_id] = cur.fetchone()[0]
            source_manifest_id = classic_ids[source.manifest_id]
            binding_manifest_id = classic_ids[final.manifest_id]
            pair_id = uuid.uuid4()
            pair_public = "pair_" + pair_id.hex
            cur.execute(
                """INSERT INTO pq_c2pa.manifest_pairs
                (id,source_asset_id,output_asset_id,shared_fingerprint_id,source_manifest_id,
                 profile_version,state,public_id,issuance_mode,binding_classic_manifest_id,classic_store_id)
                VALUES (%s,%s,%s,%s,%s,%s,'STAGED',%s,%s,%s,%s)""",
                (pair_id, source_id, output_id, shared_id, source_manifest_id,
                 PROFILE, pair_public, build["classic_action"], binding_manifest_id, store_id),
            )
            p1_manifest = manifest_map(p1_bytes)[p1["manifest_id"]].raw
            pqc_id = uuid.uuid4()
            cur.execute(
                """INSERT INTO pq_c2pa.manifests
                (id,pair_id,kind,manifest_label,profile_version,raw_manifest,
                 raw_sha256,raw_sha3_256,claim_bytes,claim_hash_algorithm,manifest_type)
                VALUES (%s,%s,'PQC',%s,%s,%s,%s,%s,%s,'sha3-256','PROJECT_PQC')""",
                (pqc_id, pair_id, p1["manifest_id"], PROFILE, p1_manifest,
                 _sha256(p1_manifest), hashlib.sha3_256(p1_manifest).digest(),
                 p1["claim_raw"]),
            )
            for manifest_id in {source_manifest_id, binding_manifest_id}:
                label = source.manifest_id if manifest_id == source_manifest_id else final.manifest_id
                claim, cose, signature, chain, algorithm = _classic_signature(final_store, label)
                _signature(cur, manifest_id, claim, cose, signature, chain, algorithm)
            pqc_cose = p1["signature_raw"]
            value = cbor2.loads(pqc_cose)
            _haetae_signature(cur, pqc_id, p1["claim_raw"], pqc_cose, value.value[3])
            timestamp_trust = _register_timestamp(
                cur, pair_id, pqc_id, source_manifest_id, binding_manifest_id,
                source.manifest_id, final.manifest_id, final_store,
                p1["source_timestamp"],
            )
            for manifest_id, assertion_name in (
                (binding_manifest_id, "c2pa.soft-binding"),
                (pqc_id, "c2pa.soft-binding"),
            ):
                cur.execute(
                    """INSERT INTO pq_c2pa.manifest_fingerprints
                    (id,manifest_id,fingerprint_id,assertion_locator,block_index,scope)
                    VALUES (%s,%s,%s,%s,0,%s)
                    ON CONFLICT (manifest_id,assertion_locator,block_index) DO NOTHING""",
                    (uuid.uuid4(), manifest_id, shared_id,
                     f"self#jumbf=c2pa.assertions/{assertion_name}", Jsonb({})),
                )
                cur.execute(
                    """SELECT fingerprint_id FROM pq_c2pa.manifest_fingerprints
                       WHERE manifest_id=%s AND assertion_locator=%s AND block_index=0""",
                    (manifest_id, f"self#jumbf=c2pa.assertions/{assertion_name}"),
                )
                if cur.fetchone()[0] != shared_id:
                    raise ValueError("Stored signed fingerprint differs from current value")
            job_id = uuid.uuid4()
            cur.execute(
                """INSERT INTO pq_c2pa.jobs
                (id,public_id,type,input_asset_id,status,stage,progress_percent,attempt_count,
                 started_at)
                VALUES (%s,%s,'AUGMENTATION',%s,'PROCESSING','VALIDATION',90,1,%s)""",
                (job_id, conversion_id, source_id, now),
            )
            policy_id = _policy(cur)
            validation_id = uuid.uuid4()
            validation_public = "val_" + validation_id.hex
            report = {"conversion_id": conversion_id, "pair_id": pair_public,
                      "classic": "VALID", "p1": "VALID", "trust_scope": "LOCAL_PINNED_HAETAE_KEY",
                      "timestamp": build["validation"]["timestamp"],
                      "timestamp_trust": timestamp_trust}
            cur.execute(
                """INSERT INTO pq_c2pa.validation_runs
                (id,public_id,job_id,asset_id,observed_fingerprint_id,resolved_pair_id,
                 policy_id,profile_version,validator_version,validated_at,resolution_status,
                 candidate_count,overall_status,report_json,report_sha256,search_mode,
                 candidates_truncated,classic_presence,pqc_presence,classic_integrity,
                 pqc_integrity,content_binding,signer_trust,timestamp_trust)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pqc2pa-backend-1',%s,'MATCHED',1,
                        'TRUSTED',%s,%s,'exact_only',false,'PRESENT','PRESENT','VALID',
                        'VALID','VALID','VALID',%s)""",
                (validation_id, validation_public, job_id, output_id, output_fp_id,
                 pair_id, policy_id, PROFILE, now, Jsonb(report),
                 _sha256(rfc8785.dumps(report)), timestamp_trust),
            )
            cur.execute(
                """INSERT INTO pq_c2pa.resolution_candidates
                (validation_id,pair_id,matching_basis,resolver_version,rank,decision,reason_code,evidence)
                VALUES (%s,%s,'IMAGE_CODE','pqc2pa-backend-1',1,'SELECTED',
                        'ISSUANCE_OUTPUT',%s)""",
                (validation_id, pair_id, Jsonb({"image_code": shared.units[0]})),
            )
            for ordinal, (component, name) in enumerate((
                ("CLASSIC", "CLASSIC_M1_SIGNATURE"),
                ("PQC", "P1_HAETAE3_SIGNATURE"),
                ("PAIR", "CLASSIC_P1_FINGERPRINT"),
                ("PQC", "P1_SHA3_HARD_BINDING"),
            )):
                cur.execute(
                    """INSERT INTO pq_c2pa.validation_checks
                    (id,validation_id,component,name,code,message,status,ordinal)
                    VALUES (%s,%s,%s,%s,%s,%s,'VALID',%s)""",
                    (uuid.uuid4(), validation_id, component, name, name,
                     "Verified by conversion pipeline", ordinal),
                )
            cur.execute("SELECT pq_c2pa.activate_registration(%s,%s,%s)",
                        (pair_id, job_id, validation_id))
            if cur.fetchone()[0] != pair_public:
                raise RuntimeError("Registration activation did not return the pair")
    return {"pair_id": pair_public, "validation_id": validation_public,
            "source_asset_id": str(source_id), "output_asset_id": str(output_id),
            "fingerprint_id": str(shared_id)}
