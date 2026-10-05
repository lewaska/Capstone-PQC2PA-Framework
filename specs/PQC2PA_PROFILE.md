# PQ-C2PA Internal Profile v0.1

## 1. 목적

Classic C2PA manifest가 포함된 JPEG/PNG 이미지에서 기존 C2PA manifest만 제거하고, 내부 전용 PQ-C2PA manifest를 생성하여 삽입한다.

다른 이미지 메타데이터(EXIF, XMP 등)는 가능한 한 보존한다.

본 프로파일은 내부 시스템 전용이며 외부 C2PA 검증기와의 호환성을 보장하지 않는다.

## 2. 지원 파일

- JPEG
- PNG

## 3. 암호 알고리즘

- 해시: SHA3-256
- Claim 서명: ML-DSA-65
- 키 형식: PKCS#8 개인키, SubjectPublicKeyInfo 공개키
- 구현체: OpenSSL 3.5 이상

## 4. Claim 및 Assertion

- Claim과 Assertion의 기본 구조는 기존 C2PA 구조를 유지한다.
- Assertion reference hash에는 SHA3-256을 사용한다.
- Asset hard-binding hash에는 SHA3-256을 사용한다.
- Claim은 canonical CBOR로 직렬화한다.
- 세부 필수 필드와 Assertion 선택 규칙은 추후 확정한다.

## 5. 서명

- canonical CBOR Claim을 COSE Sig_structure의 payload로 사용한다.
- Sig_structure 바이트를 ML-DSA-65로 서명한다.
- ML-DSA-65 COSE 알고리즘 ID는 내부 전용 값으로 추후 확정한다.

## 6. Timestamp

- Claim 서명 생성 후 RFC 3161 TimestampToken을 발급한다.
- Timestamp message imprint의 정확한 대상 바이트는 추후 확정한다.
- TSA 인증서 체인은 Claim 서명 인증서 체인과 별도로 검증한다.

## 7. 신뢰 체인

- 자체 Root CA를 trust anchor로 사용한다.
- Root CA, Intermediate CA, Leaf 인증서 구조를 사용한다.
- Claim 서명 인증서와 TSA 인증서를 구분한다.
- 개인키는 Git 저장소에 저장하지 않는다.

## 8. 검증 정책

필수 검증 항목 중 하나라도 실패하면 `trusted=false`로 처리한다.

- Assertion hash 검증
- Asset hard-binding hash 검증
- Claim ML-DSA-65 서명 검증
- Claim signer 인증서 경로 검증
- TimestampToken 검증
- TSA 인증서 경로 검증

검증기는 fail-closed 정책을 사용한다.

## 9. 미확정 사항

- 파싱하여 이전할 Assertion 목록
- Claim 필수 필드
- ML-DSA-65 내부 COSE 알고리즘 ID
- Timestamp message imprint 대상
- PQ-C2PA manifest 식별용 label 및 version
- 인증서 EKU와 정책 OID