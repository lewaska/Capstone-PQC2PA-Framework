# Capstone Design: PQ-C2PA Hybrid Framework

Development of a hybrid C2PA and post-quantum provenance framework based on
ML-DSA, SHA-3, and content fingerprints.

## Project goal

The framework preserves the conventional C2PA provenance path while creating a
separate post-quantum manifest that protects equivalent provenance assertions
with SHA3-256 and ML-DSA-65.

For each accepted image, the system will:

- validate the existing C2PA manifest;
- calculate a content fingerprint;
- add a standard C2PA update manifest containing a `c2pa.soft-binding`
  assertion with that fingerprint;
- create a separate PQC manifest containing the same fingerprint and
  semantically equivalent assertion data;
- sign and timestamp the PQC claim using the project PKI;
- store the conventional and PQC manifests as one pair in the database; and
- retrieve and cross-validate the pair when an image with the same fingerprint
  is submitted again.

The project retains C2PA structures such as JUMBF, CBOR, COSE, assertions,
claims, ingredients, and timestamping. The standard branch is processed with
the official C2PA SDK. SHA3-256, ML-DSA-65, PQC certificate validation, and PQC
timestamp validation are handled by the framework's own implementation.

## 프로젝트 목표

본 프로젝트는 기존 C2PA 출처 이력을 유지하면서, 동일한 출처 정보를
SHA3-256과 ML-DSA-65로 보호하는 별도의 PQC 매니페스트를 함께 운용하는
하이브리드 프레임워크를 구현한다.

입력 이미지마다 다음 처리를 수행한다.

- 기존 C2PA 매니페스트 검증
- 이미지 콘텐츠 fingerprint 계산
- 같은 fingerprint가 포함된 `c2pa.soft-binding` 기반 C2PA update manifest 생성
- 동일한 fingerprint와 의미상 동등한 어설션을 가진 PQC 매니페스트 생성
- 자체 PKI를 이용한 PQC 클레임 서명 및 타임스탬프 처리
- 두 매니페스트를 하나의 쌍으로 DB에 저장
- 이미지 재입력 시 fingerprint 조회와 교차 검증

표준 C2PA 경로는 공식 SDK를 사용한다. SHA3-256, ML-DSA-65, PQC 인증서
경로 검증 및 PQC 타임스탬프 검증은 프레임워크가 직접 구현한다.

워터마킹은 fingerprint 기반 핵심 구현 이후 검토하는 확장 기능이다.

## Roles

- Frontend: Daegyu
- Backend: mainly Sieun
- Server: Sumin
- Content provenance: C2PA
- Algorithms: ML-DSA-65, SHA3-256

## Status

Architecture migration in progress.

## Team

Capstone Design Project
