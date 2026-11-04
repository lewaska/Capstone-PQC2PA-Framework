# Capstone Design: PQ-C2PA Hybrid Framework

A web-based C2PA provenance verification and post-quantum transformation framework using ML-DSA-65, SHA3-256, and content fingerprints.

ML-DSA-65, SHA3-256 및 콘텐츠 핑거프린트 기반의 웹 기반 C2PA 출처 검증·양자내성 변환 프레임워크

## Project Goals

The project aims to preserve existing C2PA provenance while adding a separate post-quantum protection path. The target architecture maintains a conventional C2PA update manifest and an independent PQC manifest as a linked pair; it does **not** replace the original provenance with a single PQC manifest.

The planned processing flow is:

1. Inspect the original C2PA manifest (M0) and extract a content fingerprint.
2. Preserve the original provenance and create a newly signed classic update manifest (M1) containing the fingerprint in a `c2pa.soft-binding` assertion.
3. Create a separate PQC manifest (P1) with the same fingerprint and semantically corresponding provenance assertions, protected by ML-DSA-65 and the planned SHA3-256 profile.
4. Store and associate M1, P1, and the fingerprint in a database for retrieval and cross-validation.

P1 is an independent artifact, not a custom assertion embedded in M1. Fingerprints support association and retrieval; they do not replace cryptographic signature or hard-binding verification.

The classic path uses the official C2PA SDK. The project develops its own PQC profile and X.509-based trust architecture, including CA, signer, and TSA components. The current design uses a project root CA and end-entity certificates without an intermediate CA. Trust in this CA is explicitly configured within the project and does not imply recognition by public C2PA trust lists or browsers.

SHA3-256 is a target of the PQC profile, not a claim that every existing hash operation has already been migrated. Current timestamp components also use SHA-2. PQC manifest generation, paired storage, and integrated verification remain under development.

## 프로젝트 목표

본 프로젝트는 기존 C2PA 출처 이력을 유지하면서 별도의 양자내성 보호 경로를 추가하는 것을 목표로 한다. 표준 C2PA 업데이트 매니페스트와 독립적인 PQC 매니페스트를 연결된 쌍으로 관리하며, 기존 출처 이력을 단일 PQC 매니페스트로 완전히 교체하지 않는다.

목표 처리 흐름은 다음과 같다.

1. 원본 C2PA 매니페스트(M0)를 분석하고 콘텐츠 핑거프린트를 추출한다.
2. 기존 출처 이력을 보존하고, `c2pa.soft-binding` 어설션에 핑거프린트를 포함한 클래식 업데이트 매니페스트(M1)를 생성·재서명한다.
3. 동일한 핑거프린트와 의미상 대응하는 출처 어설션을 가진 독립 PQC 매니페스트(P1)를 생성하고, ML-DSA-65와 SHA3-256 기반 암호 프로파일을 적용한다.
4. M1·P1·핑거프린트를 DB에 저장·연결하여 조회 및 교차 검증에 활용한다.

P1은 M1의 커스텀 어설션에 삽입하는 데이터가 아닌 독립 산출물이다. 핑거프린트는 연결·검색을 지원하며, 전자서명 및 하드 바인딩 검증을 대체하지 않는다.

클래식 경로는 공식 C2PA SDK를 사용한다. PQC 경로에는 자체 암호 프로파일과 X.509 기반 신뢰 구조를 설계하며, CA·서명자·TSA 구성요소를 포함한다. 현재 설계는 중간 CA 없이 자체 Root CA와 최종 개체 인증서를 사용한다. 자체 CA에 대한 신뢰는 프로젝트 내부에 명시적으로 설정하며, 공개 C2PA 신뢰 목록이나 브라우저의 신뢰를 의미하지 않는다.

SHA3-256은 PQC 프로파일의 적용 목표이며, 현재 모든 해시 연산의 전환이 완료됐다는 뜻은 아니다. 기존 타임스탬프 구성요소에는 SHA-2도 사용된다. PQC 매니페스트 생성, 매니페스트 쌍 저장 및 통합 검증은 개발 중이다.

## Current Status / 현재 진행 상황

### Available Web Features / 사용 가능한 웹 기능

- C2PA image inspection and verification-result display / C2PA 이미지 분석 및 검증 결과 표시
- AI-generated explanations of verification results / AI 기반 검증 결과 설명
- Browser-generated PDF reports / 브라우저 기반 PDF 보고서 생성
- Frontend and backend deployment on AWS Lightsail (Ubuntu) with a static IP / 고정 IP를 연결한 AWS Lightsail Ubuntu 서버에 프론트·백엔드 배포

The current server upload endpoint accepts JPEG/PNG files up to 20 MiB. Broader format and size options shown in the UI do not imply support by this endpoint. AI explanations summarize verification results; they do not independently establish whether depicted content is true.

현재 서버 업로드 API는 최대 20 MiB의 JPEG·PNG를 지원한다. UI에 표시된 다른 형식·용량이 해당 API의 지원 범위를 의미하지는 않는다. AI 설명은 검증 결과를 요약하며, 콘텐츠 내용의 사실 여부를 독립적으로 판정하지 않는다.

### Implemented Components / 개별 구현된 구성요소

- ISCC fingerprint extraction and classic update-manifest insertion/signing / ISCC 핑거프린트 추출 및 클래식 업데이트 매니페스트 삽입·서명
- ML-DSA-65 key generation, signing, and verification utilities / ML-DSA-65 키 생성·서명·검증 모듈
- Signature verification using an X.509 certificate public key / X.509 인증서 공개키를 이용한 서명 검증
- Timestamp issuance and verification components / 타임스탬프 발급·검증 구성요소

These components are not evidence of a completed end-to-end PQC conversion service.

개별 구성요소 구현과 웹에서의 전체 PQC 변환 서비스 완성은 구분한다.

### In Progress and Planned / 진행 중 및 예정

- Independent PQC manifest generation and cryptographic-profile integration / 독립 PQC 매니페스트 생성 및 암호 프로파일 통합
- Database ERD and schema design, followed by paired-manifest persistence / DB ERD·스키마 설계 및 매니페스트 쌍 저장 구현
- Integrated certificate-chain, signature, timestamp, and cross-manifest verification / 인증서 체인·서명·타임스탬프·매니페스트 교차 검증 통합
- End-to-end transformation and validation APIs with frontend integration / 변환·검증 API 및 프론트 연동 완성
- Backend support for report registration, authenticity lookup, and identity checks / 보고서 발급 등록·진위 조회·신원 확인 백엔드 구현
- Cross-browser PDF download validation and HTTPS deployment / 브라우저별 PDF 다운로드 검증 및 HTTPS 적용

Some frontend screens anticipate APIs that are not registered in the current backend. Their presence does not indicate that the corresponding service is operational. Database ERD and explanatory documentation are currently assigned to the DB team member.

일부 프론트 화면은 현재 백엔드에 등록되지 않은 API를 전제로 한다. 화면이 존재한다고 해당 서비스가 운영 중인 것은 아니다. DB ERD와 설명 문서는 DB 담당 팀원이 설계 중이다.

## Roles / 역할

- Frontend / 프론트엔드: Daegyu
- Backend / 백엔드: Sieun
- Database / 데이터베이스: Sumin
- Content Provenance / 콘텐츠 출처 표준: C2PA
- Target PQC Algorithms / 목표 PQC 알고리즘: ML-DSA-65, SHA3-256

## Development Notes / 개발 참고

- Keep API keys, private keys, and runtime environment files outside version control. / API 키·개인키·운영 환경 파일은 Git에 포함하지 않는다.
- Project trust anchors are for research and local trust-policy evaluation. / 자체 신뢰 앵커는 연구 및 프로젝트 신뢰 정책 검증을 위한 것이다.
- This is a research prototype under active development, not a publicly trusted or fully interoperable PQC C2PA implementation. / 본 프로젝트는 개발 중인 연구용 프로토타입이며, 공개 신뢰나 완전한 PQC C2PA 상호운용성을 보장하지 않는다.
