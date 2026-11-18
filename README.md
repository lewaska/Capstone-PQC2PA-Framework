# PQ-C2PA Hybrid Framework

기존 C2PA 이미지의 출처 기록을 검증하고, 별도의 양자내성 보호 기록을 생성·조회하는 캡스톤 연구용 웹 프레임워크입니다.

## 현재 처리 흐름

1. 업로드한 PNG/JPEG에서 이미지 지문을 계산하고 DB의 보호 기록 후보를 조회합니다.
2. C2PA 기록이 있으면 공식 C2PA SDK로 Classic 서명과 이미지 결합을 검증합니다.
3. 새 보호 기록이 필요하면 지문을 담은 Classic 업데이트 매니페스트(M1)를 생성하고, 원본 기록(M0)을 참조하는 P1을 만듭니다. 기존 매니페스트에 지문이 있으면 Classic 기록을 유지할 수 있습니다.
4. P1의 클레임은 SHA3-256 참조와 HAETAE-3 서명으로 보호하고 JUMBF 형태로 DB에 별도 저장합니다. P1은 결과 이미지에 삽입되지 않습니다.
5. 기존 보호 기록이 조회되면 Classic·P1 증거를 다시 검증합니다. C2PA 기록이 삭제된 경우에는 이미지 결합과 서명 검증을 통과할 때만 복구 이미지를 제공합니다.

P1의 HAETAE 공개키는 서버에 고정된 로컬 신뢰 기준입니다. 이 프로젝트의 P1 프로파일은 연구용 확장이며 외부 C2PA 검증기의 상호운용성을 보장하지 않습니다. 이미지 지문 일치는 후보 검색 근거이며, 원본 확정이나 복구 성공을 단독으로 증명하지 않습니다.

## 주요 코드

- `backend/app/api/routes/conversions.py`: 변환 API와 처리 흐름
- `backend/app/services/classic_preparation.py`: Classic 매니페스트 준비
- `backend/app/services/pqc2pa.py`: P1 생성 및 검증
- `backend/app/services/haetae.py`: HAETAE C 라이브러리 연동
- `backend/app/services/conversion_lookup.py`, `conversion_registration.py`: DB 조회·등록
- `native/haetae/build-linux.sh`: 공식 HAETAE 참조 구현을 고정 해시로 확인하고 Linux 공유 라이브러리 빌드
- `frontend/viewer/`: 웹 화면

운영 비밀키와 환경 파일은 저장소에 포함하지 않습니다. 배포에는 PostgreSQL, Classic 서명자·TSA 설정, HAETAE 서명키 및 공유 라이브러리가 별도로 필요합니다.
