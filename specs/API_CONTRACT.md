# PQ-C2PA Web Framework API Contract v1

이 문서는 프런트엔드와 백엔드 사이의 고정 인터페이스다. 실제 코어가 완성되기 전에는 같은 형식의 Mock JSON을 사용한다.

## 1. 기본 규칙

- Base URL: `/api/v1`
- JSON Content-Type: `application/json`
- 파일 업로드: `multipart/form-data`
- 시간: UTC RFC 3339 문자열(예: `2026-10-04T06:30:00Z`)
- ID는 문자열이며 프런트에서 내부 형식을 해석하지 않는다.
- 이미지 입력은 1차 버전에서 `image/jpeg`, `image/png`만 허용한다.
- 성공한 변환 결과는 기존 Classic C2PA manifest만 제거하고 단일 PQ-C2PA manifest를 삽입한다. EXIF, 일반 XMP, IPTC, ICC 등 다른 metadata는 유지한다.
- HTTP 상태와 도메인 상태는 구분한다. HTTP 200이어도 검증 결과는 `UNTRUSTED`일 수 있다.

## 2. 공통 응답 형태

성공 응답:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

오류 응답:

```json
{
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "JPEG 또는 PNG 파일만 업로드할 수 있습니다.",
    "stage": "UPLOAD_VALIDATION",
    "retryable": false,
    "details": {}
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

프런트는 `message`를 그대로 신뢰하기보다 `code`를 기준으로 사용자 문구를 선택할 수 있다.

## 3. 변환 API

### 3.1 변환 생성

`POST /api/v1/conversions`

`multipart/form-data` 필드:

| 이름 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `file` | binary | O | Classic C2PA가 포함된 JPEG 또는 PNG |
| `preserve_non_c2pa_metadata` | boolean | X | 기본값 `true`; v1에서는 `false`를 거부해도 됨 |

HTTP `202 Accepted`:

```json
{
  "data": {
    "conversion_id": "conv_01J...",
    "status": "QUEUED",
    "stage": "UPLOADED",
    "progress_percent": 0,
    "created_at": "2026-10-04T06:30:00Z"
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

### 3.2 변환 상태 및 결과 조회

`GET /api/v1/conversions/{conversion_id}`

처리 중:

```json
{
  "data": {
    "conversion_id": "conv_01J...",
    "status": "PROCESSING",
    "stage": "CLAIM_SIGNING",
    "progress_percent": 62,
    "created_at": "2026-10-04T06:30:00Z",
    "updated_at": "2026-10-04T06:30:03Z",
    "completed_at": null,
    "source": null,
    "result": null,
    "error": null
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

완료:

```json
{
  "data": {
    "conversion_id": "conv_01J...",
    "status": "COMPLETED",
    "stage": "COMPLETED",
    "progress_percent": 100,
    "created_at": "2026-10-04T06:30:00Z",
    "updated_at": "2026-10-04T06:30:07Z",
    "completed_at": "2026-10-04T06:30:07Z",
    "source": {
      "filename": "input.jpg",
      "media_type": "image/jpeg",
      "size_bytes": 1530021,
      "file_sha3_256": "hex-string",
      "classic_c2pa": {
        "present": true,
        "validation_status": "VALID",
        "active_manifest": "urn:uuid:...",
        "claim_generator": "Example Generator/1.0",
        "assertion_count": 3,
        "warning_codes": []
      }
    },
    "result": {
      "filename": "input.pq-c2pa.jpg",
      "media_type": "image/jpeg",
      "size_bytes": 1548880,
      "file_sha3_256": "hex-string",
      "manifest_id": "manifest_01J...",
      "validation_id": "val_01J...",
      "trust_status": "TRUSTED",
      "manifest_url": "/api/v1/conversions/conv_01J.../manifest",
      "validation_url": "/api/v1/validations/val_01J...",
      "download_url": "/api/v1/conversions/conv_01J.../asset"
    },
    "error": null
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

실패:

```json
{
  "data": {
    "conversion_id": "conv_01J...",
    "status": "FAILED",
    "stage": "ASSERTIONS_REBUILDING",
    "progress_percent": 24,
    "created_at": "2026-10-04T06:30:00Z",
    "updated_at": "2026-10-04T06:30:01Z",
    "completed_at": "2026-10-04T06:30:01Z",
    "source": null,
    "result": null,
    "error": {
      "code": "CLASSIC_C2PA_PARSE_FAILED",
      "message": "기존 C2PA manifest를 읽을 수 없습니다.",
      "stage": "CLASSIC_C2PA_READING",
      "retryable": false,
      "details": {}
    }
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

### 3.3 변환된 이미지 다운로드

`GET /api/v1/conversions/{conversion_id}/asset`

- 성공: `200`과 JPEG/PNG binary
- 미완료: `409 CONVERSION_NOT_COMPLETED`
- 실패 또는 없음: `404`

### 3.4 생성된 manifest 조회

`GET /api/v1/conversions/{conversion_id}/manifest`

```json
{
  "data": {
    "manifest_id": "manifest_01J...",
    "format": "PQ-C2PA",
    "profile_version": "1.0",
    "active_manifest": true,
    "claim": {
      "label": "c2pa.claim.v2",
      "claim_generator": "Internal PQ-C2PA Framework/0.1.0",
      "format": "image/jpeg",
      "instance_id": "xmp:iid:...",
      "hash_algorithm": "SHA3-256",
      "signature_algorithm": "ML-DSA-65",
      "cose_algorithm_id": -49,
      "signature_uri": "self#jumbf=.../c2pa.signature",
      "assertion_references": [
        {
          "label": "c2pa.actions.v2",
          "uri": "self#jumbf=.../c2pa.assertions/c2pa.actions.v2",
          "hash_algorithm": "SHA3-256",
          "hash": "hex-string"
        },
        {
          "label": "c2pa.hash.data",
          "uri": "self#jumbf=.../c2pa.assertions/c2pa.hash.data",
          "hash_algorithm": "SHA3-256",
          "hash": "hex-string"
        }
      ]
    },
    "assertions": [
      {
        "label": "c2pa.actions.v2",
        "kind": "ACTIONS",
        "data": {},
        "hash_algorithm": "SHA3-256",
        "hash": "hex-string"
      },
      {
        "label": "c2pa.hash.data",
        "kind": "HARD_BINDING",
        "data": {
          "algorithm": "SHA3-256",
          "hash": "hex-string",
          "exclusions": []
        },
        "hash_algorithm": "SHA3-256",
        "hash": "hex-string"
      }
    ],
    "signature": {
      "algorithm": "ML-DSA-65",
      "cose_algorithm_id": -49,
      "valid": true,
      "signer_certificate": {
        "subject": "CN=PQ-C2PA Claim Signer",
        "issuer": "CN=PQ-C2PA Development Root CA",
        "serial_number": "hex-string",
        "fingerprint_sha256": "hex-string",
        "not_before": "2026-10-01T00:00:00Z",
        "not_after": "2027-10-01T00:00:00Z"
      }
    },
    "timestamp": {
      "present": true,
      "generation_time": "2026-10-04T06:30:06Z",
      "message_imprint_algorithm": "SHA3-256",
      "message_imprint": "hex-string",
      "token_serial_number": "hex-string",
      "tsa_certificate": {
        "subject": "CN=PQ-C2PA Development TSA",
        "issuer": "CN=PQ-C2PA Development Root CA",
        "serial_number": "hex-string",
        "fingerprint_sha256": "hex-string",
        "not_before": "2026-10-01T00:00:00Z",
        "not_after": "2027-10-01T00:00:00Z"
      }
    }
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

민감한 원시 인증서, 서명 바이트 및 전체 CBOR은 기본 응답에 포함하지 않는다. 필요하면 관리자용 별도 API로 제공한다.

## 4. 독립 검증 API

### 4.1 검증 생성

`POST /api/v1/validations`

`multipart/form-data`:

| 이름 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `file` | binary | O | 검증할 PQ-C2PA JPEG 또는 PNG |

HTTP `202 Accepted`:

```json
{
  "data": {
    "validation_id": "val_01J...",
    "job_status": "QUEUED",
    "stage": "UPLOADED",
    "progress_percent": 0,
    "created_at": "2026-10-04T06:40:00Z"
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

### 4.2 검증 상태 및 결과 조회

`GET /api/v1/validations/{validation_id}`

```json
{
  "data": {
    "validation_id": "val_01J...",
    "job_status": "COMPLETED",
    "stage": "COMPLETED",
    "progress_percent": 100,
    "trust_status": "TRUSTED",
    "policy_version": "trust-policy-1.0",
    "profile_version": "1.0",
    "validated_at": "2026-10-04T06:40:03Z",
    "checks": [
      {
        "name": "MANIFEST_STRUCTURE",
        "status": "VALID",
        "code": "OK",
        "message": "PQ-C2PA manifest 구조가 유효합니다."
      },
      {
        "name": "ASSERTION_INTEGRITY",
        "status": "VALID",
        "code": "OK",
        "message": "모든 Assertion SHA3-256 해시가 일치합니다."
      },
      {
        "name": "ASSET_BINDING",
        "status": "VALID",
        "code": "OK",
        "message": "이미지 콘텐츠 hard binding이 유효합니다."
      },
      {
        "name": "CLAIM_SIGNATURE",
        "status": "VALID",
        "code": "OK",
        "message": "ML-DSA-65 Claim 서명이 유효합니다."
      },
      {
        "name": "SIGNER_CERTIFICATE_PATH",
        "status": "VALID",
        "code": "OK",
        "message": "서명자 인증서가 내부 Root CA까지 연결됩니다."
      },
      {
        "name": "TIMESTAMP_TOKEN",
        "status": "VALID",
        "code": "OK",
        "message": "TimestampToken과 message imprint가 유효합니다."
      },
      {
        "name": "TSA_CERTIFICATE_PATH",
        "status": "VALID",
        "code": "OK",
        "message": "TSA 인증서가 내부 Root CA까지 연결됩니다."
      }
    ],
    "failures": [],
    "warnings": [],
    "manifest_url": "/api/v1/validations/val_01J.../manifest",
    "error": null
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

`UNTRUSTED` 예:

```json
{
  "data": {
    "validation_id": "val_01J...",
    "job_status": "COMPLETED",
    "stage": "COMPLETED",
    "progress_percent": 100,
    "trust_status": "UNTRUSTED",
    "policy_version": "trust-policy-1.0",
    "profile_version": "1.0",
    "validated_at": "2026-10-04T06:40:03Z",
    "checks": [
      {
        "name": "ASSET_BINDING",
        "status": "INVALID",
        "code": "ASSET_HASH_MISMATCH",
        "message": "이미지 콘텐츠가 PQ-C2PA 생성 이후 변경되었습니다."
      }
    ],
    "failures": [
      {
        "code": "ASSET_HASH_MISMATCH",
        "message": "이미지 콘텐츠 hard binding이 일치하지 않습니다.",
        "stage": "ASSET_BINDING_VALIDATION",
        "retryable": false,
        "details": {}
      }
    ],
    "warnings": [],
    "manifest_url": null,
    "error": null
  },
  "meta": {
    "request_id": "req_01J...",
    "api_version": "v1"
  }
}
```

## 5. 상태 enum

### 작업 상태

```text
QUEUED
PROCESSING
COMPLETED
FAILED
CANCELLED
```

### 처리 단계

```text
UPLOADED
UPLOAD_VALIDATION
CLASSIC_C2PA_READING
ASSERTIONS_REBUILDING
ASSERTIONS_HASHING
ASSET_HASHING
CLAIM_BUILDING
CLAIM_SIGNING
TIMESTAMPING
MANIFEST_EMBEDDING
FINAL_VALIDATION
MANIFEST_READING
MANIFEST_STRUCTURE_VALIDATION
ASSERTION_INTEGRITY_VALIDATION
ASSET_BINDING_VALIDATION
CLAIM_SIGNATURE_VALIDATION
SIGNER_CERTIFICATE_VALIDATION
TIMESTAMP_VALIDATION
TSA_CERTIFICATE_VALIDATION
COMPLETED
```

### 최종 신뢰 상태

```text
TRUSTED
UNTRUSTED
INDETERMINATE
```

- `TRUSTED`: 모든 필수 검사를 통과했다.
- `UNTRUSTED`: 변조, 서명 불일치, 미신뢰 Root, 폐기 등 명확한 실패가 있다.
- `INDETERMINATE`: 시스템 장애나 필요한 정보 부족으로 신뢰 여부를 결정할 수 없다.

### 개별 검사 상태

```text
VALID
INVALID
INDETERMINATE
NOT_PRESENT
NOT_APPLICABLE
```

## 6. 오류 코드

| 코드 | HTTP | 의미 | 재시도 |
|---|---:|---|---:|
| `INVALID_REQUEST` | 400 | 요청 필드 오류 | X |
| `FILE_REQUIRED` | 400 | 파일 누락 | X |
| `FILE_TOO_LARGE` | 413 | 파일 크기 제한 초과 | X |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | JPEG/PNG가 아님 | X |
| `INVALID_IMAGE` | 422 | 이미지가 손상됨 | X |
| `CLASSIC_C2PA_NOT_FOUND` | 422 | 변환 입력에 Classic C2PA가 없음 | X |
| `CLASSIC_C2PA_PARSE_FAILED` | 422 | 기존 manifest 파싱 실패 | X |
| `CLASSIC_C2PA_INVALID` | 422 | 기존 manifest가 정책상 변환 불가 | X |
| `ASSERTION_UNSUPPORTED` | 422 | 필수 Assertion을 변환할 수 없음 | X |
| `PQ_C2PA_NOT_FOUND` | 422 | 검증 입력에 PQ-C2PA가 없음 | X |
| `MANIFEST_STRUCTURE_INVALID` | 200 | 구조 검증 실패; trust는 UNTRUSTED | X |
| `ASSERTION_HASH_MISMATCH` | 200 | Assertion 변조 | X |
| `ASSET_HASH_MISMATCH` | 200 | 콘텐츠 변조 | X |
| `CLAIM_SIGNATURE_INVALID` | 200 | ML-DSA 서명 불일치 | X |
| `UNSUPPORTED_ALGORITHM` | 200 | 지원하지 않는 알고리즘 | X |
| `SIGNER_CERTIFICATE_UNTRUSTED` | 200 | signer 체인 미신뢰 | X |
| `SIGNER_CERTIFICATE_EXPIRED` | 200 | signer 인증서 만료 | X |
| `SIGNER_CERTIFICATE_REVOKED` | 200 | signer 인증서 폐기 | X |
| `TIMESTAMP_INVALID` | 200 | TimestampToken 검증 실패 | X |
| `TSA_CERTIFICATE_UNTRUSTED` | 200 | TSA 체인 미신뢰 | X |
| `KEY_SERVICE_UNAVAILABLE` | 503 | signer/KMS 일시 장애 | O |
| `TSA_UNAVAILABLE` | 503 | TSA 일시 장애 | O |
| `STORAGE_ERROR` | 500 | 파일 저장 실패 | O |
| `INTERNAL_ERROR` | 500 | 예상하지 못한 오류 | 경우에 따라 |

검증 실패는 정상적인 API 처리 결과이므로 HTTP 200과 `trust_status=UNTRUSTED`를 사용한다. API 자체가 요청을 처리하지 못한 경우에만 4xx/5xx를 사용한다.

## 7. 프런트엔드 동작 규칙

1. 업로드 후 `conversion_id` 또는 `validation_id`를 저장한다.
2. `QUEUED`/`PROCESSING` 동안 1~2초 간격으로 조회한다.
3. `COMPLETED`, `FAILED`, `CANCELLED`이면 조회를 중지한다.
4. `TRUSTED`만 녹색 신뢰 상태로 표시한다.
5. `UNTRUSTED`는 빨간색으로 표시하고 `failures`를 보여준다.
6. `INDETERMINATE`는 노란색으로 표시하고 신뢰된 것으로 취급하지 않는다.
7. `progress_percent`는 진행 표시용이며 보안 판단에 사용하지 않는다.
8. 프런트가 자체적으로 trust를 계산하지 않고 백엔드의 `trust_status`를 표시한다.
9. 인증서 원문, 개인키, 서명 원시 바이트는 화면에 노출하지 않는다.

## 8. 백엔드 동작 규칙

1. 파일 확장자가 아니라 실제 파일 형식을 검사한다.
2. 변환 결과를 반환하기 전에 저장된 출력 파일을 PQ-C2PA 검증 엔진으로 다시 검증한다.
3. 최종 검증이 `TRUSTED`가 아니면 결과 파일 다운로드를 허용하지 않는다.
4. Classic C2PA만 제거하고 비-C2PA metadata는 보존한다.
5. 출력 manifest는 하나의 active PQ-C2PA manifest만 포함한다.
6. 로그에 개인키, 원본 이미지 내용, 원시 인증서 비밀정보를 기록하지 않는다.
7. 동일한 오류는 항상 동일한 오류 코드를 사용한다.
8. 알 수 없는 예외를 `UNTRUSTED`로 위장하지 않고 작업 `FAILED` 또는 검증 `INDETERMINATE`로 처리한다.

## 9. v1 범위 밖

- 관리자용 인증서 발급·폐기 API
- Root CA private key 관리 API
- 브라우저 WASM 독립 검증
- 배치 변환
- WebSocket 진행 알림
- 외부 C2PA 호환성 보장
- 원시 CBOR/JUMBF 편집 API
