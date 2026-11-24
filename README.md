# PQ-C2PA Web Framework

기존 C2PA 출처 기록을 검증·보존하면서 별도의 양자내성 서명 검증 경로를 제공하는 웹 프레임워크입니다. 한림대학교 SW캡스톤디자인 대방어 팀의 연구형 프로젝트로, Classic C2PA 매니페스트와 KpqC HAETAE-3으로 서명한 PQC 매니페스트를 연결하여 관리합니다.

## 배경과 연구 목적

- **C2PA와 이미지 출처 기록**

  디지털 이미지에는 화면에 표시되는 이미지 데이터와 EXIF, 생성 도구 정보 등의 메타데이터가 포함될 수 있습니다. C2PA 매니페스트 스토어는 출처와 수정 이력을 기록하며, 각 매니페스트는 콘텐츠 정보를 담은 어설션(Assertion), 어설션 해시와 참조 관계를 담은 클레임(Claim), 클레임 서명(Claim Signature)으로 구성됩니다. 검증기는 서명·어설션 해시·하드 바인딩을 확인하여 기록의 무결성과 대상 이미지와의 결합을 검사합니다.

- **양자컴퓨팅에 따른 장기 검증 문제**

  기존 RSA·타원곡선 기반 서명은 장기적인 양자컴퓨팅 위협을 고려해야 합니다. 이미 발급된 Classic C2PA 기록을 없애거나 대체하는 대신, 원본 출처 이력을 보존하면서 별도의 양자내성 서명으로 발급 시점의 증거를 추가 보호하는 것이 이 프로젝트의 목표입니다.

## 위협 모델과 설계

- **공격 시나리오 1 — 출처 기록 위조**

  공격자가 기존 서명 체계의 개인키를 확보했다고 가정하면, 출처 어설션을 바꾸고 새 Classic 서명을 만들 수 있습니다. 프레임워크는 검증된 Classic 매니페스트의 원본 증거와 참조 관계를 별도의 PQC 매니페스트(P1)에 담아 HAETAE-3으로 서명합니다. P1은 이후 Classic 기록의 변경 여부를 확인하는 추가 검증 근거입니다. P1 발급 전에 이미 위조된 기록의 진위를 소급하여 증명하는 기능은 아닙니다.

- **공격 시나리오 2 — C2PA 기록 제거**

  이미지에서 C2PA 매니페스트 스토어가 삭제되면 일반적인 내장 기록 검증 경로로는 출처 이력을 읽을 수 없습니다. 프레임워크는 이미지 핑거프린트의 Image-Code로 DB의 보호 기록 후보를 찾고, 저장된 매니페스트를 재연결한 뒤 서명과 하드 바인딩을 다시 검증합니다. 지문 일치만으로 복구나 원본 동일성을 확정하지 않습니다.

- **Classic–PQC 병행 구조**

  결과 이미지에는 기존 Classic 기록과 필요한 경우 생성한 업데이트 매니페스트(M1)를 C2PA 형식으로 유지합니다. P1은 이미지에 삽입하지 않고 DB에 별도 저장합니다. M1은 이전 출처 매니페스트(M0)를 참조하며, Classic 기록과 P1은 공유 소프트 바인딩 핑거프린트와 DB 발급 관계로 연결됩니다. P1에는 원본 증거의 참조와 이미지에 대한 SHA3-256 결합값도 포함됩니다. 따라서 기존 C2PA 검증 경로와 프로젝트 전용 PQC 검증 경로를 함께 운영할 수 있습니다.

## 구현과 처리 흐름

- **업로드 및 후보 검색**

  웹 화면에서 PNG/JPEG 이미지를 업로드하면 백엔드가 형식을 확인하고 이미지 핑거프린트를 계산합니다. 이미지의 시각적 특징을 나타내는 Image-Code로 PostgreSQL의 발급 기록 후보를 조회합니다. Image-Code는 검색 키이며, 검색 결과는 후속 검증을 통과해야 합니다.

- **Classic 매니페스트 검증 및 업데이트**

  C2PA가 있는 입력은 C2PA SDK로 클레임 서명, 어설션 및 이미지 하드 바인딩을 검증합니다. 기존 소프트 바인딩 어설션의 지문을 확인하고, 필요한 경우 지문을 기록한 Classic 업데이트 매니페스트(M1)를 자체 Classic 서명자로 발급합니다. M1은 M0을 이전 출처로 참조하여 원본 서명과 어설션 이력을 보존합니다. 이미 유효한 지문이 있으면 기존 Classic 매니페스트를 유지할 수 있습니다.

- **KpqC HAETAE-3 매니페스트 발급**

  백엔드는 Classic 증거를 파싱하고 어설션 참조 해시를 포함한 P1 클레임을 CBOR로 직렬화한 뒤 JUMBF 매니페스트를 구성합니다. 공개된 HAETAE C 참조 구현을 공유 라이브러리로 빌드하고 Python에서 호출하여 P1 클레임에 HAETAE-3 서명을 적용합니다. 생성 직후 서명, 참조 및 결합 관계를 재검증한 P1 바이너리를 DB에 저장합니다. 이 P1은 프로젝트 전용 구조이므로 일반 C2PA 검증기의 P1 해석·검증을 전제로 하지 않습니다.

- **타임스탬프 증거**

  Classic 서명에 연결된 타임스탬프 토큰(TST)이 있으면 이를 P1의 커스텀 어설션에 보존합니다. TST가 없고 자체 TSA를 사용할 수 있으면 Classic 서명의 `sigTst2`에 토큰을 연결한 뒤 P1에도 해당 증거를 기록합니다. 발급·조회 과정에서 토큰이 대상 서명과 연결되는지 확인하며, Classic 서명자와 TSA의 X.509 인증서는 자체 Root CA를 기준으로 검증합니다.

- **기존 기록 확인과 복구**

  DB에 보호 기록이 있으면 Classic 서명·하드 바인딩·P1 서명 및 두 기록의 연결을 재검증합니다. C2PA가 제거된 이미지는 저장된 Classic 매니페스트 스토어를 재연결한 결과를 다시 검증한 경우에만 복구 이미지로 제공합니다. 후보가 불명확하거나 검증에 실패하면 복구 성공으로 표시하지 않습니다.

- **저장 및 결과 제공**

  PostgreSQL은 핑거프린트, Classic 매니페스트 스토어, P1 바이너리, 발급 쌍, 타임스탬프 증거 및 검증 결과를 연결해 관리합니다. 백엔드는 처리 상태와 검증 결과를 웹 화면에 반환하며, 사용자는 Classic·P1 결과를 확인하고 결과 이미지와 보고서를 받을 수 있습니다. P1 서명은 로컬에 고정한 HAETAE 공개키로 검증합니다. 자체 Root CA에 대한 신뢰 판정은 내부 신뢰 앵커에 한정되며, 공식 C2PA 신뢰 리스트의 외부 신뢰와는 구분됩니다.

## 활용과 연구 기여

- **기존 출처 이력의 보존과 추가 보호**

  원본 Classic 매니페스트의 서명 이력을 유지하면서 별도의 HAETAE-3 서명 검증 경로를 구성했습니다. 이를 통해 장기 보관 이미지의 출처 이력을 Classic 및 양자내성 관점에서 함께 확인할 수 있습니다.

- **검증을 조건으로 하는 소프트 바인딩 복구**

  Image-Code 기반 조회와 저장된 증거의 재검증을 결합했습니다. C2PA 기록이 삭제되어도 검증 가능한 보호 기록이 남아 있는 경우 재연결을 시도할 수 있으며, 유사한 지문만 발견한 경우는 성공으로 취급하지 않습니다.

- **웹 기반 시연과 보고서**

  새 C2PA 이미지의 검증·PQC 변환과 C2PA 청크가 제거된 이미지의 복구를 시연할 수 있습니다. 화면에서는 처리 분기와 Classic·P1 검증 상태를 보여주고, 결과 이미지 및 PDF/JSON 보고서를 제공합니다.

- **논문 작성**

  본 팀은 연구형 프로젝트의 설계와 검증 결과를 바탕으로 논문을 작성 중입니다. 2027년 한국정보보호학회 하계학술대회(CISC S'27) 제출을 목표로 합니다.

## 저장소 안내

- **주요 코드**

  [`backend/app/api/routes/conversions.py`](backend/app/api/routes/conversions.py)는 변환 API, [`backend/app/services/classic_preparation.py`](backend/app/services/classic_preparation.py)는 Classic 준비, [`backend/app/services/pqc2pa.py`](backend/app/services/pqc2pa.py)는 P1 생성·검증, [`backend/app/services/haetae.py`](backend/app/services/haetae.py)는 HAETAE 연동을 담당합니다. DB 후보 조회와 발급 등록은 [`conversion_lookup.py`](backend/app/services/conversion_lookup.py) 및 [`conversion_registration.py`](backend/app/services/conversion_registration.py)에 있으며, 웹 화면은 [`frontend/viewer/`](frontend/viewer/)에 있습니다.

- **배포 구성**

  서비스는 웹 프론트엔드, FastAPI 백엔드, PostgreSQL 및 결과 파일 저장소로 구성됩니다. 운영 환경에는 Classic 서명자·TSA 설정, HAETAE 공유 라이브러리와 서명키가 별도로 필요합니다. 비밀키와 환경 설정 파일은 저장소에 포함하지 않습니다.

---

# PQ-C2PA Web Framework

This web framework verifies and preserves existing C2PA provenance records while providing a separate post-quantum signature verification path. Developed by Team Daebangeo for Hallym University’s Software Capstone Design project, it links Classic C2PA manifests with a PQC manifest signed using KpqC HAETAE-3.

## Background and Research Objective

- **C2PA and Image Provenance**

  A digital image may contain pixel data as well as metadata such as EXIF information and details about the tool used to create it. A C2PA manifest store records provenance and edit history. Each manifest consists of assertions describing the content, a claim containing assertion hashes and references, and a digital signature over the claim. A verifier checks the signature, assertion hashes, and hard binding to assess the integrity of the record and its connection to the image.

- **Long-Term Verification under Quantum-Computing Threats**

  Conventional RSA and elliptic-curve signatures face a long-term threat from quantum computing. Rather than replacing previously issued Classic C2PA records, this project aims to preserve their provenance history and add a separately signed post-quantum record covering the evidence available at issuance.

## Threat Model and Design

- **Attack Scenario 1 — Provenance Forgery**

  If an attacker obtains a private key used by a conventional signature scheme, they may alter provenance assertions and produce a new Classic signature. The framework preserves evidence and references from a verified Classic manifest in a separate PQC manifest (P1), signed with HAETAE-3. P1 provides additional evidence for detecting subsequent changes to the Classic record. It cannot retroactively establish the authenticity of a record that was already forged before P1 was issued.

- **Attack Scenario 2 — Removal of C2PA Records**

  When an image’s C2PA manifest store is removed, its embedded provenance can no longer be read through the usual verification path. The framework uses the Image-Code component of an image fingerprint to search the database for candidate protection records. It then reconnects a stored manifest and verifies its signature and hard binding. A fingerprint match alone does not establish identity or authorize recovery.

- **Parallel Classic and PQC Records**

  The output image retains its Classic C2PA records and, when needed, contains a newly signed update manifest (M1). P1 is stored separately in the database rather than embedded in the image. M1 references the earlier provenance manifest (M0), while the Classic record and P1 are linked through a shared soft-binding fingerprint and a database issuance record. P1 also contains references to the original evidence and a SHA3-256 content binding. This design supports both the existing C2PA verification path and the project’s dedicated PQC verification path.

## Implementation and Processing Flow

- **Upload and Candidate Search**

  After a user uploads a PNG or JPEG image, the backend checks its format and computes an image fingerprint. It uses Image-Code, which represents visual image features, to find candidate issuance records in PostgreSQL. Image-Code serves as a search key; every candidate must pass further verification.

- **Classic Manifest Verification and Update**

  For an image containing C2PA data, the C2PA SDK verifies the claim signature, assertions, and image hard binding. The backend checks the existing soft-binding assertion and, when necessary, creates a Classic update manifest (M1) containing the fingerprint and signs it with the project’s Classic signer. M1 references M0 as prior provenance, preserving the original assertions and signature history. A Classic manifest with a valid existing fingerprint can be retained without creating M1.

- **PQC Manifest Issuance with KpqC HAETAE-3**

  The backend parses the Classic evidence, serializes the P1 claim and its assertion references as CBOR, and assembles a JUMBF manifest. It builds the published HAETAE C reference implementation as a shared library and invokes it from Python to sign the P1 claim with HAETAE-3. Before storing the P1 bytes in the database, it verifies the new signature, references, and binding. P1 is a project-specific structure; ordinary C2PA verifiers are not expected to parse or verify it.

- **Timestamp Evidence**

  If a timestamp token (TST) is attached to the Classic signature, the framework preserves it in a P1 custom assertion. If the token is absent and the local timestamp authority (TSA) is available, it attaches a token to the Classic signature’s `sigTst2` field and records the corresponding evidence in P1. During issuance and lookup, it checks the token’s relationship to its target signature. The Classic signer and TSA use X.509 certificates verified against the project’s Root CA.

- **Existing-Record Verification and Recovery**

  For an existing protection record, the framework re-verifies the Classic signature, hard binding, P1 signature, and linkage between the records. When C2PA data has been removed, it provides a recovered image only after reconnecting the stored Classic manifest store and verifying the result. Ambiguous candidates or failed checks are never reported as successful recovery.

- **Storage and Results**

  PostgreSQL links fingerprints, Classic manifest stores, P1 bytes, issuance pairs, timestamp evidence, and validation results. The backend returns processing and verification results to the web interface, where users can inspect the Classic and P1 status and download the output image and reports. P1 signatures are verified with a locally pinned HAETAE public key. Trust in the project’s Root CA is limited to the configured local trust anchor and is distinct from trust under the official C2PA trust list.

## Applications and Research Contributions

- **Preserving Provenance while Adding Protection**

  The framework retains the signature history of the original Classic manifest and adds a HAETAE-3 verification path. Long-lived image provenance can therefore be examined through both Classic and post-quantum records.

- **Verification-Gated Soft-Binding Recovery**

  Image-Code lookup is combined with verification of stored evidence. If a C2PA record has been removed but a verifiable protection record remains in the database, the framework can attempt reconnection. A visually similar fingerprint alone is never treated as proof of recovery.

- **Web Demonstration and Reports**

  The web application demonstrates verification and PQC conversion of a new C2PA image, as well as recovery after removal of a C2PA chunk. It displays the processing path and Classic/P1 verification results and provides an output image and PDF/JSON reports.

- **Paper in Progress**

  The team is writing *Design of a Framework for C2PA Metadata Verification and Preservation Using KpqC* based on this research project. We plan to submit it to the 2027 Summer Conference of the Korea Institute of Information Security & Cryptology (CISC S’27).

## Repository Guide

- **Key Components**

  `backend/app/api/routes/conversions.py` handles the conversion API; `backend/app/services/classic_preparation.py` prepares Classic manifests; `backend/app/services/pqc2pa.py` builds and verifies P1; and `backend/app/services/haetae.py` integrates the HAETAE library. Database lookup and registration are implemented in `conversion_lookup.py` and `conversion_registration.py`. The web interface is in `frontend/viewer/`.

- **Deployment Components**

  The service comprises a web frontend, a FastAPI backend, PostgreSQL, and file storage for results. Deployment also requires separate configuration for the Classic signer and TSA, the HAETAE shared library, and its signing key. Private keys and environment files are not included in this repository.

---


## Team roles

- **Sieun (Team Lead):** Backend development, project coordination, API specifications, and schedule management.
- **Daegyu:** Frontend development and ideation.
- **Sumin:** Database design and project planning.

## Working process

- **Meetings:** We held regular meetings at agreed dates and times and used spare meeting slots when schedules changed.
- **Updates:** We shared project updates through Notion and the KakaoTalk team chat as they arose, regardless of the day or time.
- **Artifacts:** We stored code, documents, plans, and working files in GitHub, Google Drive, Notion, and KakaoTalk according to their purpose.

