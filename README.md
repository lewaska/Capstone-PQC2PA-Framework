# Capstone Design: PQ-C2PA Hybrid Framework

Development of a Hybrid C2PA and Post-Quantum Provenance Framework Based on ML-DSA, SHA-3, and Content Fingerprints<br>
ML-DSA, SHA-3 및 콘텐츠 핑거프린트 기반의 하이브리드 C2PA 출처 검증 프레임워크 개발

## Project Goals

This project aims to develop a web-based **PQ-C2PA transformation and verification framework** that preserves conventional C2PA provenance while introducing post-quantum cryptographic protection.

The framework follows a **hybrid architecture**, maintaining a classic C2PA update manifest and a separate PQC manifest. It preserves the original provenance history instead of completely replacing it with a single post-quantum manifest.

The intended processing flow is as follows:

- Inspect the original C2PA manifest and extract a content fingerprint.
- Create and sign a classic update manifest containing the fingerprint in a **soft-binding assertion**.
- Generate an independent PQC manifest containing the same fingerprint and semantically corresponding provenance information.
- Apply **ML-DSA-65** signatures and a **SHA3-256-based cryptographic profile** to the PQC path.
- Store and associate the classic manifest, PQC manifest, and fingerprint in a database.
- Retrieve associated records and verify integrity, signatures, certificates, and timestamps.

The classic path uses the official C2PA SDK. The PQC path is being developed with a dedicated cryptographic profile and an **X.509-based PKI architecture**, including CA, signer, and TSA components. The current trust architecture uses a project Root CA and end-entity certificates without an intermediate CA.

The project CA is explicitly trusted within the framework. This does not imply recognition by public C2PA trust lists or web browsers. Fingerprints support record association and retrieval; they do not replace cryptographic integrity verification.

Ultimately, the project aims to provide an end-to-end web environment for image submission, hybrid provenance protection, verification, and accessible reporting. **Full PQC manifest generation and integrated verification remain under development.**

## 프로젝트 목표

본 프로젝트는 기존 C2PA 출처 이력을 유지하면서 양자내성 암호 기반 보호 기능을 추가하는 웹 기반 **PQ-C2PA 변환 및 검증 프레임워크** 개발을 목표로 한다.

기존 매니페스트를 단일 PQC 매니페스트로 완전히 교체하지 않고, 클래식 C2PA 업데이트 매니페스트와 독립적인 PQC 매니페스트를 함께 관리하는 **하이브리드 구조**를 따른다.

목표 처리 흐름은 다음과 같다.

- 원본 C2PA 매니페스트 분석 및 콘텐츠 핑거프린트 추출
- **소프트 바인딩 어설션**에 핑거프린트를 포함한 클래식 업데이트 매니페스트 생성·서명
- 동일한 핑거프린트와 의미상 대응하는 출처 정보를 포함한 독립 PQC 매니페스트 생성
- PQC 경로에 **ML-DSA-65** 서명 및 **SHA3-256 기반 암호 프로파일** 적용
- 클래식 매니페스트·PQC 매니페스트·핑거프린트의 DB 저장 및 연결
- 연결된 기록 조회와 무결성·전자서명·인증서·타임스탬프 검증

클래식 경로에는 공식 C2PA SDK를 사용한다. PQC 경로에는 별도의 암호 프로파일과 **X.509 기반 PKI 구조**를 개발하며, CA·서명자·TSA 구성요소를 포함한다. 현재 신뢰 구조는 중간 CA 없이 자체 Root CA와 최종 개체 인증서로 구성한다.

자체 CA는 프레임워크 내부에서 명시적으로 신뢰하도록 설정하며, 공개 C2PA 신뢰 목록이나 웹 브라우저의 신뢰를 의미하지 않는다. 핑거프린트는 기록 연결과 검색을 지원하며 암호학적 무결성 검증을 대체하지 않는다.

최종적으로 이미지 제출부터 하이브리드 출처 보호, 검증 및 결과 보고서 제공까지 연결되는 웹 환경을 구축한다. **전체 PQC 매니페스트 생성 및 통합 검증은 현재 개발 중이다.**

## Architecture / 아키텍처

| Component / 구성요소 | Description / 설명 |
|---|---|
| Original Manifest — M0 | Existing C2PA provenance / 기존 C2PA 출처 이력 |
| Classic Update Manifest — M1 | Newly signed update manifest containing a fingerprint / 핑거프린트를 포함하고 새로 서명한 업데이트 매니페스트 |
| PQC Manifest — P1 | Independent post-quantum provenance manifest / 독립적인 양자내성 출처 매니페스트 |
| Fingerprint | Association and retrieval of related records / 관련 기록 연결 및 검색 |
| Project PKI | Root CA, end-entity certificates, and TSA / 자체 Root CA·최종 개체 인증서·TSA |
| Database | Planned storage and association of manifests and fingerprints / 매니페스트·핑거프린트 저장 및 연결 구현 예정 |

## Status / 진행 상황

### Available Web Features / 사용 가능한 웹 기능

- C2PA image inspection and verification-result display / C2PA 이미지 분석 및 검증 결과 표시
- AI explanations of verification results / AI 기반 검증 결과 설명
- PDF report generation / PDF 보고서 생성
- Frontend–backend integration and AWS Lightsail deployment / 프론트·백엔드 연동 및 AWS Lightsail 배포
- Static IP configuration / 고정 IP 설정

### Implemented Components / 개별 구현된 기능

- Fingerprint extraction and insertion into classic update manifests / 핑거프린트 추출 및 클래식 업데이트 매니페스트 삽입
- Classic update-manifest signing / 클래식 업데이트 매니페스트 서명
- ML-DSA-65 key generation, signing, and verification utilities / ML-DSA-65 키 생성·서명·검증 모듈
- Signature verification using X.509 certificate public keys / X.509 인증서 공개키 기반 서명 검증
- Timestamp issuance and verification components / 타임스탬프 발급·검증 구성요소

### In Progress / 진행 중

- Independent PQC manifest generation / 독립 PQC 매니페스트 생성
- PQC cryptographic-profile integration / PQC 암호 프로파일 통합
- Database ERD and schema design / DB ERD 및 스키마 설계
- PDF report refinement and cross-browser compatibility checks / PDF 보고서 개선 및 브라우저 호환성 확인

### Planned / 앞으로 할 일

- Database storage and retrieval of paired manifests and fingerprints / 매니페스트 쌍·핑거프린트 DB 저장 및 조회
- Integrated trust-chain and cross-manifest verification / 신뢰 체인 및 매니페스트 교차 검증 통합
- End-to-end PQC transformation and verification integration / PQC 변환·검증 전체 흐름 연동
- Backend implementation for report registration and authenticity lookup / 보고서 발급 등록·진위 조회 백엔드 구현
- HTTPS configuration / HTTPS 적용

Individual cryptographic components do not yet constitute a complete end-to-end PQC service. SHA3-256 is the target hash profile for the PQC path; existing timestamp components also use SHA-2.<br>
개별 암호 구성요소 구현이 전체 PQC 서비스 완성을 의미하지는 않는다. SHA3-256은 PQC 경로의 목표 해시 프로파일이며, 기존 타임스탬프 구성요소에는 SHA-2도 사용된다.

## Roles / 역할

- **Frontend / 프론트엔드:** Daegyu
- **Backend / 백엔드:** Sieun
- **Database / 데이터베이스:** Sumin
- **Content Provenance / 콘텐츠 출처 표준:** C2PA
- **PQC Algorithms / PQC 알고리즘:** ML-DSA-65, SHA3-256

## Project Scope / 프로젝트 범위

This project is a research prototype under active development. Verification results describe the integrity and provenance of content credentials; they do not establish the factual truth of the depicted content. API keys, private keys, and runtime secrets are managed outside the repository.

본 프로젝트는 개발 중인 연구용 프로토타입이다. 검증 결과는 콘텐츠 자격 증명의 무결성과 출처 정보를 설명하며, 콘텐츠에 묘사된 내용의 사실 여부를 보장하지 않는다. API 키·개인키·운영 비밀정보는 저장소 외부에서 관리한다.
