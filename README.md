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

  본 팀은 연구형 프로젝트의 설계와 검증 결과를 바탕으로 「KpqC를 활용한 C2PA 메타데이터 검증 및 보존 프레임워크 설계 연구」를 작성 중입니다. 2027년 한국정보보호학회 하계학술대회(CISC S'27) 제출을 목표로 합니다.

## 저장소 안내

- **주요 코드**

  [`backend/app/api/routes/conversions.py`](backend/app/api/routes/conversions.py)는 변환 API, [`backend/app/services/classic_preparation.py`](backend/app/services/classic_preparation.py)는 Classic 준비, [`backend/app/services/pqc2pa.py`](backend/app/services/pqc2pa.py)는 P1 생성·검증, [`backend/app/services/haetae.py`](backend/app/services/haetae.py)는 HAETAE 연동을 담당합니다. DB 후보 조회와 발급 등록은 [`conversion_lookup.py`](backend/app/services/conversion_lookup.py) 및 [`conversion_registration.py`](backend/app/services/conversion_registration.py)에 있으며, 웹 화면은 [`frontend/viewer/`](frontend/viewer/)에 있습니다.

- **배포 구성**

  서비스는 웹 프론트엔드, FastAPI 백엔드, PostgreSQL 및 결과 파일 저장소로 구성됩니다. 운영 환경에는 Classic 서명자·TSA 설정, HAETAE 공유 라이브러리와 서명키가 별도로 필요합니다. 비밀키와 환경 설정 파일은 저장소에 포함하지 않습니다.

---

## Team roles

- **Si-eun (Team Lead):** Backend development, project coordination, API specifications, and schedule management.
- **Dae-gyu:** Frontend development and ideation.
- **Su-min:** Database design and project planning.

## Working process

- **Meetings:** We held regular meetings at agreed dates and times and used spare meeting slots when schedules changed.
- **Updates:** We shared project updates through Notion and the KakaoTalk team chat as they arose, regardless of the day or time.
- **Artifacts:** We stored code, documents, plans, and working files in GitHub, Google Drive, Notion, and KakaoTalk according to their purpose.
