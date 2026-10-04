# Origin Lab · 이미지 검증 화면

이미지 검증 연구를 위한 **프런트엔드 시안**입니다. [Metadata View의 C2PA Viewer](https://metadataview.com/c2pa)와 [C2PA Viewer](https://c2paviewer.com/)의 입력 → 상태 요약 → 검증 항목 → 출처 흐름을 참고해 흰색과 파란색 중심의 화면으로 구성했습니다. 이미지 입력·결과·결과물·실험 기록·상세 결과·AI 이미지 생성 창에 사용 가이드, 기기·서비스 목록, 개발 예제와 신뢰 안내를 더했습니다.

## 실행

이 폴더에서 로컬 웹 서버를 실행한 뒤 브라우저로 엽니다.

```bash
cd pqc-c2pa-web
python3 -m http.server 8765
```

주소: `http://127.0.0.1:8765/`

## 화면과 동작

1. 이미지 입력: JPG, PNG, WebP, AVIF 파일을 선택·드래그하거나 이미지 URL에서 불러오고, 검사 실행 전까지 미리봅니다. 파일당 최대 20 MB입니다. URL 입력은 해당 사이트가 브라우저의 교차 출처 접근을 허용해야 동작합니다.
2. 결과 요약: 검사 실행 시 파일 정보와 이미지 가로·세로 크기만 기록하고 미리보기와 브라우저의 파일 참조를 해제합니다. 서명자·데이터 무결성·AI 생성 선언과 Manifest, Assertion·Claim, Claim Signature, Timestamp의 상태를 보여줍니다.
3. 상세 결과: Manifest 안의 Assertion, Claim, Claim Signature 관계와 Timestamp → TSA → CA 신뢰 경로를 연구 도식으로 보여줍니다. 검증 항목을 무결성·서명·시간 및 신뢰로 필터링할 수 있고, 원본 이미지를 포함하지 않는 기록 JSON을 저장할 수 있습니다. Manifest 데이터 영역은 실제 서버 결과를 연결하기 전까지 비어 있습니다.
4. 결과물: 모든 실행 기록을 카드로 살펴보고 파일명, 기록 ID, 날짜, 상태로 검색하며 상태별 필터와 정렬을 사용할 수 있습니다. 현재는 실제 결과 파일이 생성되지 않았다는 점을 표시합니다.
5. 실험 기록: 실행 시각, 이미지 파일명, 상태, 결과물 유무를 표로 살펴보고 검색·상태 필터·정렬을 사용합니다. 각 기록에서 해당 상세 결과를 열 수 있습니다.
6. AI 버튼: 입력창이 펼쳐지고 이미지 생성 API를 호출합니다. 생성된 이미지를 검사 입력에 사용할 수 있습니다.
7. 사용 가이드: 검사 순서, 결과 상태의 뜻, 실험 가이드라인, 자주 묻는 질문을 보여줍니다. 분석 서버가 없는 현재 시안의 상태도 분명하게 안내합니다.
8. 지원 기기·서비스: [C2PA Viewer 지원 목록](https://c2paviewer.com/supported-devices)의 2026년 9월 18일 자료를 카메라·휴대폰, 앱·플랫폼, 워터마크로 정리했습니다. 이름 검색과 종류 필터를 제공하며 관련 안내 링크를 연결합니다. 외부 목록 수록은 개별 모델의 지원 또는 우리 뷰어와의 호환성 보증이 아닙니다. 워터마크 항목은 참고용이며 이 시안은 SynthID를 검사하지 않습니다.
9. 개발 예제: 공식 [c2pa-web](https://github.com/contentauth/c2pa-js/blob/main/packages/c2pa-web/README.md)과 [c2patool](https://github.com/contentauth/c2patool/blob/main/docs/usage.md) 문서를 바탕으로 만든 짧은 읽기 예제, 코드 복사, 앞으로 사용할 수 있는 JSON 응답 초안을 보여줍니다.
10. 신뢰 안내: 검증 근거와 상태를 명확히 보여주겠다는 연구 목표를 설명합니다. TSA·CA의 운영 세부 내용은 게시하지 않았고, 아직 인증이나 독립 검증을 받은 것으로 표시하지 않습니다.

**예시 결과 보기**는 레이아웃 확인을 위한 가상 데이터입니다. 실제 C2PA 검사 결과가 아닙니다. 일반 파일을 넣고 검사 실행을 눌러도 현재는 검증 판정이나 변환 파일을 만들지 않습니다. 분석 서버가 연결되기 전에는 `분석 대기`로 기록됩니다.

실험 기록은 브라우저 `localStorage`에 **파일명, 종류, 바이트 크기, 가로·세로 크기, 실행 시각, 상태, 기록 ID만** 저장합니다. 원본 파일·미리보기·이미지 데이터는 기록에 저장하지 않습니다. 검사 실행 뒤 앱이 가진 파일 참조와 미리보기 URL을 해제합니다. 브라우저 앱에서 사용자 기기의 원본 파일 자체를 삭제할 수는 없습니다. 이후 서버를 연결할 때는 업로드 원본의 임시 저장과 삭제 정책을 서버에서 구현해야 합니다.

## 백엔드 연결

현재 AI 버튼은 아래 요청을 보냅니다. 비밀 키는 브라우저 코드에 넣지 않고 서버에서 관리합니다.

```http
POST /api/ai/generate
Content-Type: application/json

{"prompt":"...","style":"photo","aspect_ratio":"4:3"}
```

응답은 `image/png`, `image/jpeg`, `image/webp`, `image/avif` 이미지 바이너리이거나 아래 JSON이면 됩니다.

```json
{"image_url":"/generated/example.png","file_name":"example.png"}
```

검증 서버를 구현할 때는 결과 요약과 상세 표에 **실제 항목별 판정, 사용 알고리즘, 실패 사유, 검증 근거**를 전달하도록 연결합니다. 단순한 성공/실패 한 값으로 전체 이미지를 판정하지 않도록 화면을 구성했습니다.

SHA3-256과 ML-DSA는 이 연구의 확장 항목입니다. [현행 C2PA 2.4 규격](https://spec.c2pa.org/specifications/specifications/2.4/specs/ContentCredentials.html)의 허용 알고리즘 목록과 구분해서 표시합니다. 타임스탬프의 요청·응답 및 TSA 인증서 검증은 [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161)을 참고하세요.

## 전체 파일

```text
pqc-c2pa-web/
├── index.html
├── styles.css
├── app.js
├── resources.js
├── assets/
│   └── favicon.svg
└── README.md
```
