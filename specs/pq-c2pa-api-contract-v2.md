# PQ-C2PA Hybrid Framework API Contract v2

Status: Frontend integration draft
OpenAPI: `specs/openapi-v2.yaml`
Base URL: `/api/v1`
Profile: `pq-c2pa-hybrid-1`

## 1. What changed from v1

The previous contract placed an ML-DSA object inside a custom assertion of one
Classic C2PA Update Manifest. That design is no longer used.

The framework now creates and stores one **manifest pair**:

1. A Classic C2PA Update Manifest, embedded in the returned image and also
   stored in the database.
2. A separate PQC Manifest, stored in the database and validated by the
   framework's custom validator.
3. One `io.iscc.v0` ISCC-SEQ fingerprint shared by both manifests.

The image contains the Classic Update Manifest. It does not embed the PQC
Manifest in v2. The database relation is the authoritative pairing record.

## 2. Manifest construction rules

### 2.1 Shared fingerprint

The fingerprint is generated once before either manifest is built.

```text
Image-Code (256-bit)
Data-Code (256-bit)
Instance-Code (256-bit)
        │
        └── encode_seq() → canonical ISCC-SEQ bytes
```

The API exposes four views of the same fingerprint:

- `algorithm`: always `io.iscc.v0`.
- `units`: the three ISCC unit strings.
- `display`: a human-readable `ISCC:...` encoding of the complete sequence.
- `value_base64`: RFC 4648 base64 of the canonical ISCC-SEQ bytes.

`value_base64` is not a second fingerprint. The Classic and PQC records must
contain byte-identical ISCC-SEQ values. DB resolution primarily indexes the
Image-Code unit because Data-Code and Instance-Code can change when a file is
repackaged or a manifest is stripped.

### 2.2 Classic Update Manifest

The Classic output is created with the official C2PA SDK as an Update Manifest.
It does not modify the signed bytes of the existing manifest.

It contains:

- exactly one `parentOf` ingredient pointing to the input-active manifest;
- one `c2pa.soft-binding` assertion containing the shared ISCC-SEQ;
- source timestamp evidence when the source did not already carry a valid
  timestamp;
- a new ES256 claim signature;
- no new hard-binding or thumbnail assertion.

The framework Root CA is a local SDK `user_anchors` entry. A `TRUSTED` result
therefore means trusted by the PQ-C2PA Framework policy, not globally trusted.

### 2.3 Source timestamp rule

The source active-manifest signature is checked before construction.

| Source state | Action | `origin` |
|---|---|---|
| Valid timestamp exists | Preserve and reference its token | `EXISTING` |
| Timestamp absent | Request a token from the framework TSA and attach evidence | `ISSUED_BY_FRAMEWORK` |
| Timestamp exists but is invalid | Reject augmentation | N/A |

The timestamp token is also placed in a PQC-only timestamp-evidence assertion.
That assertion is hashed by SHA3-256 and covered by the ML-DSA signed PQC claim.
Raw DER tokens are not returned to the frontend. `token_sha256` is returned for
display and correlation.

### 2.4 PQC Manifest

The PQC builder reads every assertion from the input-active Classic manifest.
It recreates the assertions in a separate PQC assertion store.

- Semantic assertion data is preserved where possible.
- The hard-binding digest is recomputed using SHA3-256.
- Every serialized PQC assertion is referenced from the PQC claim using a
  SHA3-256 digest.
- The shared `c2pa.soft-binding` value is added.
- The source timestamp-evidence assertion is added.
- The PQC claim declares SHA3-256 as its hash algorithm.
- The final claim is signed with ML-DSA-65.
- The ML-DSA signature receives its own framework RFC 3161 timestamp.

The PQC Manifest is not claimed to be readable by an unmodified C2PA SDK. The
framework validator is authoritative for its structure, SHA3 hashes, ML-DSA
signature, certificate path, and timestamp.

## 3. Common rules

- JSON responses use `application/json`.
- Uploads use `multipart/form-data`.
- Supported images are `image/jpeg` and `image/png`.
- Time values are UTC RFC 3339 strings.
- IDs are opaque strings; the frontend must not parse their internal format.
- Hash strings are lowercase hexadecimal unless the field is named
  `value_base64`.
- Raw private keys, full signatures, certificates, CBOR, and timestamp tokens
  are never returned.
- The frontend displays backend trust results; it does not calculate trust.

Success envelope:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

Error envelope:

```json
{
  "error": {
    "code": "SOURCE_TIMESTAMP_INVALID",
    "message": "The source timestamp is present but invalid.",
    "stage": "SOURCE_TIMESTAMP_CHECK",
    "retryable": false,
    "details": {}
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

## 4. Job model

Job status:

```text
QUEUED
PROCESSING
COMPLETED
FAILED
CANCELLED
```

Frontend polling stops on `COMPLETED`, `FAILED`, or `CANCELLED`.

Important processing stages:

```text
UPLOADED
UPLOAD_VALIDATION
SOURCE_C2PA_READING
SOURCE_C2PA_VALIDATION
FINGERPRINT_GENERATION
SOURCE_TIMESTAMP_CHECK
SOURCE_TIMESTAMP_ISSUANCE
CLASSIC_UPDATE_BUILDING
CLASSIC_UPDATE_SIGNING
CLASSIC_UPDATE_VALIDATION
ASSERTION_EXTRACTION
PQC_ASSERTION_REBUILDING
PQC_ASSERTION_HASHING
PQC_CLAIM_BUILDING
ML_DSA_SIGNING
PQC_TIMESTAMPING
PAIR_PERSISTING
FINAL_VALIDATION
FINGERPRINT_RESOLUTION
CLASSIC_VALIDATION
PQC_VALIDATION
CROSS_MANIFEST_VALIDATION
COMPLETED
```

## 5. Synchronous inspection

### `POST /api/v1/assets/inspect`

Request: `multipart/form-data`, field `file`.

This endpoint does not sign or persist anything. It gives the frontend a source
preview before augmentation.

```json
{
  "data": {
    "asset": {
      "filename": "source.png",
      "media_type": "image/png",
      "size_bytes": 1889625,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    "classic_c2pa": {
      "present": true,
      "validation_status": "TRUSTED",
      "active_manifest_id": "urn:c2pa:source-manifest",
      "manifest_count": 1,
      "assertion_count": 3,
      "timestamp": {
        "present": true,
        "origin": "EXISTING",
        "status": "VALID",
        "target_manifest_id": "urn:c2pa:source-manifest",
        "generation_time": "2026-10-31T06:00:00Z",
        "message_imprint_algorithm": "SHA-256",
        "token_sha256": "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      }
    },
    "fingerprint": {
      "algorithm": "io.iscc.v0",
      "display": "ISCC:EED...",
      "value_base64": "AAc...==",
      "units": [
        { "type": "IMAGE", "iscc": "ISCC:EED..." },
        { "type": "DATA", "iscc": "ISCC:GAD..." },
        { "type": "INSTANCE", "iscc": "ISCC:IAD..." }
      ]
    }
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

An image without C2PA still returns a fingerprint and uses:

```json
{
  "present": false,
  "validation_status": "INDETERMINATE",
  "active_manifest_id": null,
  "manifest_count": 0,
  "assertion_count": 0,
  "timestamp": {
    "present": false,
    "origin": "NOT_PRESENT",
    "status": "NOT_PRESENT",
    "target_manifest_id": null,
    "generation_time": null,
    "message_imprint_algorithm": null,
    "token_sha256": null
  }
}
```

## 6. Create a manifest pair

### `POST /api/v1/augmentations`

Request: `multipart/form-data`, field `file` containing a Classic C2PA image.

Response: `202 Accepted`.

```json
{
  "data": {
    "augmentation_id": "aug_01J...",
    "status": "QUEUED",
    "stage": "UPLOADED",
    "progress_percent": 0,
    "created_at": "2026-10-31T06:10:00Z",
    "status_url": "/api/v1/augmentations/aug_01J..."
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

### `GET /api/v1/augmentations/{augmentation_id}`

Completed response:

```json
{
  "data": {
    "augmentation_id": "aug_01J...",
    "status": "COMPLETED",
    "stage": "COMPLETED",
    "progress_percent": 100,
    "created_at": "2026-10-31T06:10:00Z",
    "updated_at": "2026-10-31T06:10:08Z",
    "completed_at": "2026-10-31T06:10:08Z",
    "source": {},
    "result": {
      "asset": {
        "filename": "source.pq-c2pa.png",
        "media_type": "image/png",
        "size_bytes": 1895427,
        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      "manifest_pair_id": "pair_01J...",
      "fingerprint": {
        "algorithm": "io.iscc.v0",
        "display": "ISCC:EED...",
        "value_base64": "AAc...==",
        "units": [
          { "type": "IMAGE", "iscc": "ISCC:EED..." },
          { "type": "DATA", "iscc": "ISCC:GAD..." },
          { "type": "INSTANCE", "iscc": "ISCC:IAD..." }
        ]
      },
      "source_timestamp": {
        "present": true,
        "origin": "EXISTING",
        "status": "VALID",
        "target_manifest_id": "urn:c2pa:source-manifest",
        "generation_time": "2026-10-31T06:00:00Z",
        "message_imprint_algorithm": "SHA-256",
        "token_sha256": "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      },
      "overall_status": "TRUSTED",
      "trust_scope": "FRAMEWORK_LOCAL",
      "download_url": "/api/v1/augmentations/aug_01J.../asset",
      "pair_url": "/api/v1/manifest-pairs/pair_01J...",
      "validation_id": "val_01J...",
      "validation_url": "/api/v1/validations/val_01J...",
      "report_url": "/api/v1/validations/val_01J.../report"
    },
    "error": null
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

The output is downloadable only after `FINAL_VALIDATION` returns `TRUSTED`.

### `GET /api/v1/augmentations/{augmentation_id}/asset`

- `200`: augmented JPEG/PNG binary.
- `409 AUGMENTATION_NOT_COMPLETED`: still processing.
- `404 AUGMENTATION_NOT_FOUND`: unknown job.
- `410 ASSET_EXPIRED`: retained job exists, binary expired.

## 7. Manifest-pair read API

### `GET /api/v1/manifest-pairs/{manifest_pair_id}`

```json
{
  "data": {
    "manifest_pair_id": "pair_01J...",
    "fingerprint": {
      "algorithm": "io.iscc.v0",
      "display": "ISCC:EED...",
      "value_base64": "AAc...==",
      "units": [
        { "type": "IMAGE", "iscc": "ISCC:EED..." },
        { "type": "DATA", "iscc": "ISCC:GAD..." },
        { "type": "INSTANCE", "iscc": "ISCC:IAD..." }
      ]
    },
    "source_active_manifest_id": "urn:c2pa:source-manifest",
    "classic": {
      "manifest_id": "urn:c2pa:update-manifest",
      "manifest_type": "CLASSIC_UPDATE",
      "storage": "EMBEDDED_AND_DB",
      "detail_url": "/api/v1/manifest-pairs/pair_01J.../classic"
    },
    "pqc": {
      "manifest_id": "urn:pq-c2pa:pqc-manifest",
      "manifest_type": "PQC",
      "storage": "DB_ONLY",
      "detail_url": "/api/v1/manifest-pairs/pair_01J.../pqc"
    },
    "source_timestamp": {
      "present": true,
      "origin": "ISSUED_BY_FRAMEWORK",
      "status": "VALID",
      "target_manifest_id": "urn:c2pa:source-manifest",
      "generation_time": "2026-10-31T06:10:03Z",
      "message_imprint_algorithm": "SHA-256",
      "token_sha256": "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    },
    "created_at": "2026-10-31T06:10:08Z"
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

### `GET /api/v1/manifest-pairs/{manifest_pair_id}/classic`

Returns normalized Classic Update information:

- update manifest ID;
- `parent_manifest_id`;
- shared soft binding;
- source timestamp summary;
- ES256 signature and framework-local trust status;
- normalized assertion list.

### `GET /api/v1/manifest-pairs/{manifest_pair_id}/pqc`

Returns the normalized PQC Manifest. Important fields:

```json
{
  "data": {
    "manifest_id": "urn:pq-c2pa:pqc-manifest",
    "manifest_pair_id": "pair_01J...",
    "format": "PQ-C2PA",
    "profile_version": "pq-c2pa-hybrid-1",
    "fingerprint": {},
    "claim": {
      "label": "c2pa.claim.v2",
      "profile_version": "pq-c2pa-hybrid-1",
      "source_manifest_id": "urn:c2pa:source-manifest",
      "hash_algorithm": "SHA3-256",
      "signature_algorithm": "ML-DSA-65",
      "assertion_references": [
        {
          "label": "c2pa.actions.v2",
          "uri": "self#jumbf=pqc.assertions/c2pa.actions.v2",
          "hash_algorithm": "SHA3-256",
          "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      ]
    },
    "assertions": [
      {
        "label": "c2pa.actions.v2",
        "kind": "ACTIONS",
        "source_uri": "self#jumbf=c2pa.assertions/c2pa.actions.v2",
        "data": {},
        "hash_algorithm": "SHA3-256",
        "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      {
        "label": "c2pa.hash.data",
        "kind": "HARD_BINDING",
        "source_uri": "self#jumbf=c2pa.assertions/c2pa.hash.data",
        "data": {
          "alg": "SHA3-256",
          "hash": "hex-string",
          "exclusions": []
        },
        "hash_algorithm": "SHA3-256",
        "hash": "hex-string"
      },
      {
        "label": "c2pa.soft-binding",
        "kind": "SOFT_BINDING",
        "source_uri": null,
        "data": { "alg": "io.iscc.v0", "value_base64": "AAc...==" },
        "hash_algorithm": "SHA3-256",
        "hash": "hex-string"
      },
      {
        "label": "org.pq-c2pa.source-timestamp",
        "kind": "TIMESTAMP_EVIDENCE",
        "source_uri": null,
        "data": {
          "target_manifest_id": "urn:c2pa:source-manifest",
          "origin": "EXISTING",
          "token_sha256": "hex-string"
        },
        "hash_algorithm": "SHA3-256",
        "hash": "hex-string"
      }
    ],
    "source_timestamp_evidence": {},
    "signature": {
      "algorithm": "ML-DSA-65",
      "cryptographic_status": "VALID",
      "trust_status": "VALID",
      "trust_scope": "FRAMEWORK_LOCAL",
      "certificate": {}
    },
    "timestamp": {
      "present": true,
      "origin": "ISSUED_BY_FRAMEWORK",
      "status": "VALID",
      "target_manifest_id": "urn:pq-c2pa:pqc-manifest",
      "generation_time": "2026-10-31T06:10:07Z",
      "message_imprint_algorithm": "SHA3-256",
      "token_sha256": "hex-string"
    }
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

The frontend must render unknown assertion labels generically. It must not
assume that only the labels shown above exist.

## 8. Independent validation

### `POST /api/v1/validations`

Request: `multipart/form-data`, field `file`.

Response: `202 Accepted`.

```json
{
  "data": {
    "validation_id": "val_01J...",
    "status": "QUEUED",
    "stage": "UPLOADED",
    "progress_percent": 0,
    "created_at": "2026-10-31T06:30:00Z",
    "status_url": "/api/v1/validations/val_01J..."
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

### `GET /api/v1/validations/{validation_id}`

Returns the job status. `overall_status` is null until a result exists.

### `GET /api/v1/validations/{validation_id}/report`

```json
{
  "data": {
    "validation_id": "val_01J...",
    "validated_at": "2026-10-31T06:30:03Z",
    "policy_version": "pq-c2pa-local-policy-1",
    "profile_version": "pq-c2pa-hybrid-1",
    "overall_status": "TRUSTED",
    "trust_scope": "FRAMEWORK_LOCAL",
    "asset": {},
    "fingerprint": {},
    "resolution": {
      "status": "MATCHED",
      "manifest_pair_id": "pair_01J...",
      "matched_unit": "IMAGE",
      "candidates": 1
    },
    "manifest_pair": {},
    "checks": [
      {
        "component": "FINGERPRINT",
        "name": "SOFT_BINDING_RESOLUTION",
        "status": "VALID",
        "code": "OK",
        "message": "The image fingerprint resolved to one manifest pair.",
        "manifest_id": null,
        "assertion_label": "c2pa.soft-binding"
      },
      {
        "component": "CLASSIC",
        "name": "EXPECTED_CLASSIC_MANIFEST_PRESENT",
        "status": "VALID",
        "code": "OK",
        "message": "The expected Classic Update Manifest is embedded.",
        "manifest_id": "urn:c2pa:update-manifest",
        "assertion_label": null
      },
      {
        "component": "PQC",
        "name": "PQC_ASSERTION_INTEGRITY",
        "status": "VALID",
        "code": "OK",
        "message": "All SHA3-256 assertion references match.",
        "manifest_id": "urn:pq-c2pa:pqc-manifest",
        "assertion_label": null
      },
      {
        "component": "PQC",
        "name": "ML_DSA_CLAIM_SIGNATURE",
        "status": "VALID",
        "code": "OK",
        "message": "The ML-DSA-65 claim signature is valid.",
        "manifest_id": "urn:pq-c2pa:pqc-manifest",
        "assertion_label": null
      },
      {
        "component": "PAIR",
        "name": "PAIR_FINGERPRINT_EQUAL",
        "status": "VALID",
        "code": "OK",
        "message": "Classic, PQC, and uploaded asset fingerprints agree.",
        "manifest_id": null,
        "assertion_label": "c2pa.soft-binding"
      }
    ],
    "failures": [],
    "warnings": []
  },
  "meta": { "request_id": "req_01J...", "api_version": "v1" }
}
```

## 9. Deletion detection

Deletion detection requires a DB match. When the uploaded image's Image-Code
resolves to a stored pair but its expected Classic Update Manifest is absent,
validation completes normally with `UNTRUSTED`:

```json
{
  "overall_status": "UNTRUSTED",
  "resolution": {
    "status": "MATCHED",
    "manifest_pair_id": "pair_01J...",
    "matched_unit": "IMAGE",
    "candidates": 1
  },
  "checks": [
    {
      "component": "CLASSIC",
      "name": "EXPECTED_CLASSIC_MANIFEST_PRESENT",
      "status": "INVALID",
      "code": "CLASSIC_MANIFEST_MISSING",
      "message": "The registered Classic Update Manifest is missing.",
      "manifest_id": "urn:c2pa:update-manifest",
      "assertion_label": null
    }
  ]
}
```

If no DB pair is found, use `resolution.status=NOT_FOUND` and
`overall_status=INDETERMINATE`. Absence of a DB record is not cryptographic
proof of deletion.

## 10. Trust policy

`TRUSTED` requires all of the following:

1. Exactly one DB pair is resolved from the fingerprint.
2. The expected Classic Update Manifest is present.
3. The Classic Update has one correct `parentOf` ingredient.
4. Its `c2pa.soft-binding` equals the stored pair value.
5. Its ES256 signature and local certificate path are valid.
6. Source timestamp evidence is present and valid.
7. The PQC Manifest structure is valid.
8. Every expected source assertion was recreated or explicitly reported as
   unsupported.
9. Every PQC assertion SHA3-256 digest matches its claim reference.
10. The PQC hard binding matches the uploaded asset under the profile rules.
11. The ML-DSA-65 claim signature and local certificate path are valid.
12. The PQC signature timestamp is valid.
13. The Classic, PQC, DB, and recomputed fingerprints agree.

`UNTRUSTED` means a definite structural, cryptographic, trust, pair-consistency,
or expected-presence failure. `INDETERMINATE` means that no decision is possible,
for example because no DB pair exists or an infrastructure dependency failed.

## 11. Error codes

| Code | Result | Meaning |
|---|---|---|
| `INVALID_REQUEST` | HTTP 400 | Invalid request fields |
| `FILE_REQUIRED` | HTTP 400 | Upload missing |
| `FILE_TOO_LARGE` | HTTP 413 | Upload limit exceeded |
| `UNSUPPORTED_MEDIA_TYPE` | HTTP 415 | Not JPEG/PNG |
| `INVALID_IMAGE` | Job failed/report | Image cannot be decoded |
| `SOURCE_C2PA_NOT_FOUND` | Augmentation failed | No source C2PA |
| `SOURCE_C2PA_INVALID` | Augmentation failed | Source validation failed |
| `SOURCE_TIMESTAMP_INVALID` | Augmentation failed | Existing timestamp invalid |
| `TSA_UNAVAILABLE` | HTTP/job 503 | TSA unavailable |
| `FINGERPRINT_GENERATION_FAILED` | Job failed | ISCC generation failed |
| `CLASSIC_UPDATE_BUILD_FAILED` | Job failed | Update construction failed |
| `CLASSIC_UPDATE_SIGNING_FAILED` | Job failed | ES256 signing failed |
| `ASSERTION_PARSE_FAILED` | Job failed | Source assertion unreadable |
| `ASSERTION_UNSUPPORTED` | Job failed/report | Assertion cannot be recreated |
| `PQC_MANIFEST_BUILD_FAILED` | Job failed | PQC construction failed |
| `ML_DSA_SIGNING_FAILED` | HTTP/job 503 | ML-DSA signer failed |
| `PAIR_PERSIST_FAILED` | Job failed | DB pair transaction failed |
| `PAIR_NOT_FOUND` | Report 200 | No fingerprint match |
| `PAIR_AMBIGUOUS` | Report 200 | Multiple candidates remain |
| `CLASSIC_MANIFEST_MISSING` | Report 200 | Expected embedded update deleted |
| `CLASSIC_SIGNATURE_INVALID` | Report 200 | ES256 validation failed |
| `SOFT_BINDING_MISMATCH` | Report 200 | Classic/PQC/DB values differ |
| `PQC_ASSERTION_HASH_MISMATCH` | Report 200 | SHA3 assertion digest mismatch |
| `PQC_HARD_BINDING_MISMATCH` | Report 200 | Asset binding mismatch |
| `ML_DSA_SIGNATURE_INVALID` | Report 200 | PQC signature invalid |
| `SOURCE_TIMESTAMP_EVIDENCE_INVALID` | Report 200 | Source token evidence invalid |
| `PQC_TIMESTAMP_INVALID` | Report 200 | PQC timestamp invalid |
| `AUGMENTATION_NOT_COMPLETED` | HTTP 409 | Asset is not ready |
| `VALIDATION_NOT_COMPLETED` | HTTP 409 | Report is not ready |
| `ASSET_EXPIRED` | HTTP 410 | Binary retention expired |
| `INTERNAL_ERROR` | HTTP/job 500 | Unexpected server failure |

Validation failures use HTTP 200 reports because the API successfully reached a
security conclusion. HTTP 4xx/5xx is reserved for request or infrastructure
failure.

## 12. Frontend implementation rules

1. Generate client types from `openapi-v2.yaml`.
2. Poll only while status is `QUEUED` or `PROCESSING`.
3. Stop on `COMPLETED`, `FAILED`, or `CANCELLED`.
4. Use `stage` and `progress_percent` only for progress UI.
5. Show `TRUSTED` as green only with the label "Framework Local Trust".
6. Show `UNTRUSTED` as red and render every failure/check code.
7. Show `INDETERMINATE` as yellow; never treat it as trusted.
8. Display Classic and PQC manifests as two separate panels.
9. Display the fingerprint once at pair level and show equality status.
10. Render assertion arrays dynamically; unknown labels are allowed.
11. Distinguish source timestamp from PQC signature timestamp.
12. Do not show or request raw signatures, private keys, CBOR, certificates, or
    timestamp tokens.
13. Escape all server strings before rendering.

## 13. Backend implementation rules relevant to the frontend

- Pair persistence is atomic: the pair is visible only after both manifests and
  the shared fingerprint have been stored successfully.
- A completed augmentation always has a `manifest_pair_id`.
- A downloadable asset is exposed only after final validation is `TRUSTED`.
- A validation job is `FAILED` only if infrastructure prevents a report.
- Cryptographic failure completes with a report and `UNTRUSTED`.
- The same field names and enum values must be returned for mock and real core
  implementations.
