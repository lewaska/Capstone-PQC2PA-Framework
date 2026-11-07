// PQ-C2PA PDF reports.
// Each report type copies the layout of a published form instead of a web page:
//  - submission: 국립과학수사연구원 감정서 서식 규정 별지 제10호서식(디지털 감정서)
//                검증물·검증사항 → 1. 방법 2. 고찰 3. 결과 4. 비고 → 기관·일자·서명,
//                공문서 항목 기호(1. 가. 1))·붙임·"끝." 표시, 쪽 번호 "- n -"
//  - technical:  KS Q ISO/IEC 17025 7.8 시험성적서 형식. 첫 장에 의뢰자·대상·방법·환경·결과표,
//                결과와 구분한 의견·해석(7.8.7), 작성자·기술책임자 확인란, "페이지 (n) / (총 N)",
//                이후 별첨에 상세 결과
//  - summary:    한 장짜리 결과 요약
// Monochrome, ruled tables (thick top/bottom, thin inner, open sides), 개조식 문장.
// Pages are drawn on canvas with system fonts and embedded into a PDF with pdf-lib.
import { PDFDocument } from "./pdf-lib.esm.min.js";

const W = 1240, H = 1754, SCALE = 1.5, MM = W / 210;
const L = Math.round(20 * MM), R = W - Math.round(20 * MM), CW = R - L;
const TOP = Math.round(27 * MM), BOTTOM = H - Math.round(25 * MM);
const SERIF = '"Noto Serif KR","Noto Serif CJK KR","Batang","바탕","AppleMyungjo","Nanum Myeongjo",serif';
const SANS = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif';
const MONO = '"Consolas","D2Coding","SFMono-Regular","Menlo","Noto Sans Mono CJK KR",monospace';
const C = {ink:"#000000", text:"#1a1a1a", muted:"#4a4a4a", faint:"#777777", thin:"#a0a0a0", fill:"#eeeeee"};

const TYPES = {
  summary: {code:"SUM", title:"C2PA 출처 확인 결과 요약서", kind:"일반인용", page:"simple"},
  submission: {code:"SUB", title:"디지털 콘텐츠 출처 검증서", kind:"경찰서 제출용", page:"gov"},
  pq: {code:"PQV", title:"PQ 변환본 출처 검증 종합 보고서", kind:"PQ 변환본", page:"kolas"},
  technical: {code:"TEC", title:"C2PA 출처·무결성 분석서", kind:"상세분석", page:"kolas"},
};

const STATES = {
  Trusted: {label:"신뢰 확인", line:"서명과 파일 결합이 유효하고, 선택한 신뢰 기준에서 서명자가 확인됨."},
  Valid: {label:"유효(서명자 미확인)", line:"서명과 파일 결합은 유효하나, 선택한 신뢰 기준에서 서명자는 확인되지 않음."},
  Invalid: {label:"검증 실패", line:"C2PA 검증에서 실패 항목이 보고됨."},
  NoManifest: {label:"C2PA 기록 없음", line:"검증 가능한 C2PA 기록이 없음. 기록이 없다는 사실만으로 변조 여부를 판단할 수 없음."},
  RemoteUnavailable: {label:"검증 미완료", line:"출처 기록이 외부에 있으나 원격 조회를 하지 않아 검증을 완료하지 못함."},
  Error: {label:"분석 오류", line:"파일 분석 중 오류가 발생하여 검증을 완료하지 못함."},
  Unknown: {label:"상태 미확인", line:"검증 상태를 확인할 수 없음."},
};

// C2PA Technical Specification §15 status codes, read in Korean.
const CODE_KO = {
  "claimSignature.validated":"클레임 서명이 유효함",
  "claimSignature.insideValidity":"서명 시점이 인증서 유효기간 안에 있음",
  "claimSignature.outsideValidity":"서명 시점이 인증서 유효기간을 벗어남",
  "claimSignature.missing":"클레임 서명이 없음",
  "claimSignature.mismatch":"클레임 서명이 클레임 내용과 일치하지 않음",
  "signingCredential.trusted":"서명 인증서가 신뢰 기준에 연결됨",
  "signingCredential.untrusted":"서명 인증서가 신뢰 기준에 연결되지 않음",
  "signingCredential.invalid":"서명 인증서의 형식 또는 용도가 유효하지 않음",
  "signingCredential.revoked":"서명 인증서가 폐지됨",
  "signingCredential.expired":"서명 인증서가 만료됨",
  "signingCredential.ocsp.skipped":"인증서 폐지 여부(OCSP)를 조회하지 않음",
  "signingCredential.ocsp.notRevoked":"OCSP 조회 결과 폐지되지 않음",
  "signingCredential.ocsp.revoked":"OCSP 조회 결과 폐지됨",
  "signingCredential.ocsp.inaccessible":"OCSP 응답을 받지 못함",
  "timeStamp.validated":"타임스탬프 서명과 해시가 일치함",
  "timeStamp.trusted":"타임스탬프 기관이 신뢰 기준에 연결됨",
  "timeStamp.untrusted":"타임스탬프 기관이 신뢰 기준에서 확인되지 않음",
  "timeStamp.mismatch":"타임스탬프가 서명과 일치하지 않음",
  "timeStamp.outsideValidity":"타임스탬프가 인증서 유효기간 밖에 있음",
  "timeStamp.malformed":"타임스탬프 형식 오류",
  "assertion.hashedURI.match":"참조 Assertion 해시 일치",
  "assertion.hashedURI.mismatch":"참조 Assertion 해시 불일치",
  "assertion.dataHash.match":"파일 데이터 해시가 서명 당시와 일치함",
  "assertion.dataHash.mismatch":"파일 데이터 해시가 서명 당시와 다름",
  "assertion.bmffHash.match":"BMFF 데이터 해시가 서명 당시와 일치함",
  "assertion.bmffHash.mismatch":"BMFF 데이터 해시가 서명 당시와 다름",
  "assertion.boxesHash.match":"박스 단위 해시가 서명 당시와 일치함",
  "assertion.boxesHash.mismatch":"박스 단위 해시가 서명 당시와 다름",
  "assertion.collectionHash.match":"묶음 해시 일치",
  "assertion.collectionHash.mismatch":"묶음 해시 불일치",
  "assertion.missing":"참조 Assertion이 없음",
  "assertion.accessible":"Assertion 접근 가능",
  "assertion.inaccessible":"Assertion에 접근할 수 없음",
  "assertion.action.ingredientMismatch":"작업 기록과 재료 정보가 맞지 않음",
  "ingredient.claimSignature.validated":"재료 Manifest 서명이 유효함",
  "ingredient.claimSignature.mismatch":"재료 Manifest 서명 불일치",
  "ingredient.manifest.validated":"재료 Manifest 검증 통과",
  "ingredient.manifest.mismatch":"재료 Manifest가 기록과 다름",
  "ingredient.hashedURI.match":"재료 참조 해시 일치",
  "ingredient.hashedURI.mismatch":"재료 참조 해시 불일치",
  "claim.missing":"클레임이 없음",
  "claim.multiple":"클레임이 여러 개임",
  "manifest.inaccessible":"Manifest에 접근할 수 없음",
  "manifest.missing":"Manifest가 없음",
  "manifest.multipleParents":"부모 재료가 둘 이상임",
  "algorithm.unsupported":"지원하지 않는 서명 알고리즘",
  "algorithm.deprecated":"사용 중단 예정 알고리즘",
  "general.error":"검증 중 일반 오류",
};
const ACTION_KO = {"c2pa.created":"생성","c2pa.edited":"편집","c2pa.opened":"열기","c2pa.placed":"재료 삽입","c2pa.resized":"크기 변경",
  "c2pa.cropped":"자르기","c2pa.published":"발행","c2pa.transcoded":"인코딩 변경","c2pa.converted":"형식 변환",
  "c2pa.color_adjustments":"색 보정","c2pa.filtered":"필터 적용","c2pa.drawing":"그리기","c2pa.removed":"일부 제거",
  "c2pa.repackaged":"재포장","c2pa.watermarked":"워터마크 삽입","c2pa.watermarked.bound":"워터마크 삽입(결합)",
  "c2pa.watermarked.unbound":"워터마크 삽입(비결합)","c2pa.redacted":"가림 처리","c2pa.orientation":"방향 변경",
  "c2pa.translated":"번역","c2pa.deleted":"삭제","c2pa.produced":"제작","c2pa.unknown":"알 수 없는 작업"};
const SOURCE_KO = {digitalCapture:"디지털 촬영", negativeFilm:"네거티브 필름 스캔", positiveFilm:"포지티브 필름 스캔",
  print:"인쇄물 스캔", minorHumanEdits:"사람의 경미한 편집", humanEdits:"사람의 편집", compositeCapture:"촬영물 합성",
  algorithmicallyEnhanced:"알고리즘 보정", dataDrivenMedia:"데이터 기반 생성", digitalArt:"사람이 만든 디지털 아트",
  virtualRecording:"가상 녹화", composite:"합성", trainedAlgorithmicMedia:"생성형 AI 생성",
  compositeWithTrainedAlgorithmicMedia:"생성형 AI 요소를 포함한 합성", compositeSynthetic:"합성 생성물",
  algorithmicMedia:"알고리즘 생성", screenCapture:"화면 캡처"};
const ALGS = {
  es256:{name:"ECDSA P-256 / SHA-256", family:"타원곡선", pq:false},
  es384:{name:"ECDSA P-384 / SHA-384", family:"타원곡선", pq:false},
  es512:{name:"ECDSA P-521 / SHA-512", family:"타원곡선", pq:false},
  ps256:{name:"RSA-PSS / SHA-256", family:"RSA", pq:false},
  ps384:{name:"RSA-PSS / SHA-384", family:"RSA", pq:false},
  ps512:{name:"RSA-PSS / SHA-512", family:"RSA", pq:false},
  ed25519:{name:"EdDSA Ed25519", family:"타원곡선", pq:false},
  "ml-dsa-44":{name:"ML-DSA-44 (FIPS 204)", family:"격자 기반", pq:true},
  "ml-dsa-65":{name:"ML-DSA-65 (FIPS 204)", family:"격자 기반", pq:true},
  "ml-dsa-87":{name:"ML-DSA-87 (FIPS 204)", family:"격자 기반", pq:true},
};
const OPINION_SCALE = [
  ["H1을 강하게 지지", "관찰 결과가 H2보다 H1에서 훨씬 잘 설명됨"],
  ["H1을 지지", "관찰 결과가 H2보다 H1에서 더 잘 설명됨"],
  ["판단 유보", "관찰 결과로 두 명제를 구분할 수 없음"],
  ["H2를 지지", "관찰 결과가 H1보다 H2에서 더 잘 설명됨"],
  ["H2를 강하게 지지", "관찰 결과가 H1보다 H2에서 훨씬 잘 설명됨"],
];
const REFERENCES = [
  ["국립과학수사연구원, 「국립과학수사연구원 감정서 서식 규정」(예규 제591호, 2026. 7. 1. 시행) 별지 제10호서식 디지털 감정서", "https://www.law.go.kr/행정규칙/국립과학수사연구원감정서서식규정"],
  ["경찰청, 「디지털 증거의 처리 등에 관한 규칙」(경찰청훈령 제1178호, 2026. 1. 25. 시행) 제30조 결과보고서", "https://www.law.go.kr/admRulLsInfoP.do?admRulId=48364&efYd=0"],
  ["KS Q ISO/IEC 17025:2017, 시험기관 및 교정기관의 자격에 대한 일반 요구사항 — 7.8 결과 보고", "https://www.iso.org/standard/66912.html"],
  ["ISO 21043-5:2025, Forensic sciences — Part 5: Reporting", "https://www.iso.org/standard/73896.html"],
  ["SWGDE 18-Q-002, Requirements for Report Writing in Digital and Multimedia Forensics", "https://www.swgde.org/documents/published-complete-listing/18-q-002-swgde-requirements-for-report-writing-in-digital-and-multimedia-forensics/"],
  ["SWGDE 18-I-001-2.0, Best Practices for Image Authentication (2025)", "https://www.swgde.org/wp-content/uploads/2025/03/2025-03-03-Best-Practices-for-Image-Authentication-18-I-001-2.0.pdf"],
  ["C2PA, Content Credentials: C2PA Technical Specification 2.4, 15. Validation", "https://spec.c2pa.org/specifications/specifications/2.4/"],
  ["C2PA Conformance Program, Trust Lists", "https://opensource.contentauthenticity.org/docs/conformance/trust-lists"],
  ["NIST FIPS 204, Module-Lattice-Based Digital Signature Standard (2024)", "https://doi.org/10.6028/NIST.FIPS.204"],
  ["NIST IR 8547, Transition to Post-Quantum Cryptography Standards", ""],
  ["IETF RFC 9881, Algorithm Identifiers for ML-DSA in X.509 PKI (2025)", "https://www.rfc-editor.org/info/rfc9881"],
  ["대법원 2013. 7. 26. 선고 2013도2511 판결(디지털 증거의 무결성·동일성)", ""],
];

// ---------- data helpers ----------
const safe = (value, max = 600) => String(value ?? "").replace(/[\r\t]+/g, " ").replace(/\u0000/g, "").slice(0, max);
const filled = (value, fallback = "정보 없음") => {
  const text = typeof value === "object" && value !== null ? JSON.stringify(value) : safe(value);
  return text.trim() ? text : fallback;
};
const pad = n => String(n).padStart(2, "0");
const toDate = value => { const d = value instanceof Date ? value : new Date(value); return !value || Number.isNaN(d.getTime()) ? null : d; };
function stamp(value) {
  const d = toDate(value);
  if (!d) return "정보 없음";
  const offset = -d.getTimezoneOffset(), sign = offset >= 0 ? "+" : "-", abs = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`;
}
const dotDate = value => { const d = toDate(value); return d ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.` : ""; };
const longDate = value => { const d = toDate(value); return d ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` : ""; };
const bytes = n => Number.isFinite(n) ? `${n.toLocaleString("ko-KR")} B${n >= 1024 ? ` (${n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : (n / 1024).toFixed(1) + " KB"})` : ""}` : "정보 없음";
const agent = value => !value ? "" : typeof value === "object" ? [value.name, value.version].filter(Boolean).join(" ") || JSON.stringify(value) : String(value);
const sourceKey = uri => String(uri || "").split("/").pop();
const sourceType = uri => { const key = sourceKey(uri); return key ? `${SOURCE_KO[key] || key}(${key})` : ""; };
const algInfo = alg => ALGS[String(alg || "").toLowerCase()] || null;
const algLabel = alg => alg ? `${String(alg).toUpperCase()}${algInfo(alg) ? ` (${algInfo(alg).name})` : ""}` : "확인되지 않음";
const stateOf = item => STATES[item.state] || STATES.Unknown;
const activeManifest = item => { const store = item.store || {}; return (store.manifests || {})[store.active_manifest] || {}; };
const manifestCount = item => Number(item.manifest_count || Object.keys(item.store?.manifests || {}).length || 0);
const softwareName = item => (item.software || activeManifest(item).claim_generator_info || []).map(agent).filter(Boolean).join(", ") || activeManifest(item).claim_generator || "";
const checksOf = item => (item.checks || []).filter(c => ["success", "informational", "failure"].includes(c.kind));
const SCOPE_KO = {activeManifest:"활성 Manifest", ingredientDeltas:"재료 Manifest", validationDeltas:"재료 Manifest", legacy:"기존 형식"};
const kindKo = kind => ({success:"통과", informational:"참고", failure:"실패"}[kind] || kind);
const trustKo = item => item.trust_profile === "lab" ? "프로젝트 자체 CA를 Trust Anchor로 등록한 신뢰 기준" : "공식 C2PA SDK 기본 신뢰 설정";
const modeKo = item => item.processing_mode === "browser" ? "브라우저 내부 검증(공식 C2PA 웹 SDK, 파일 서버 미전송)" : "로컬 서버 검증(공식 C2PA SDK)";
const engineKo = (item, env) => item.processing_mode === "browser" ? "@contentauth/c2pa-web (WASM)" : env?.sdk ? `${env.sdk} ${env.sdk_version || ""}`.trim() : "c2pa-python";
const specVersion = item => item.store?.validation_results?.specVersion || "";
const dimsOf = item => item.dimensions || (item.image_info?.width && item.image_info?.height ? [item.image_info.width, item.image_info.height] : null);
const fileLine = item => [filled(item.mime), bytes(item.size), dimsOf(item) ? `${dimsOf(item)[0]} × ${dimsOf(item)[1]} px` : ""].filter(Boolean).join(", ");
const uniq = list => [...new Set(list)];
function period(start, end) {
  const a = stamp(start), b = stamp(end);
  if (a === "정보 없음" || b === "정보 없음") return `검증 ${a}, 발급 ${b}`;
  return a.slice(0, 10) === b.slice(0, 10) ? `${a.slice(0, 19)} 검증, ${b.slice(11, 19)} 발급 ${a.slice(20)}` : `${a.slice(0, 19)} 검증, ${b.slice(0, 19)} 발급 ${b.slice(20)}`;
}
const codeList = list => uniq(list.map(c => c.code)).join(", ");
const spaced = name => /^[가-힣]{2,4}$/.test(name || "") ? name.split("").join(" ") : (name || "");
const LETTERS = "가나다라마바사아자차카타파하";
const ga = i => `${LETTERS[i] || i + 1}.`;
// Backend messages are written politely; the report uses 개조식 endings.
const terse = text => safe(text, 400).replace(/했습니다/g, "함").replace(/되었습니다/g, "됨").replace(/못했습니다/g, "못함")
  .replace(/없습니다/g, "없음").replace(/다릅니다/g, "다름").replace(/입니다/g, "임").replace(/합니다/g, "함").replace(/습니다/g, "음");

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
async function sha256Hex(text) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  } catch { return ""; }
}
// The record the report is drawn from; thumbnails are excluded to keep it small.
function recordSnapshot(item) {
  const {thumbnail, manifest_thumbnails, ...rest} = item;
  return rest;
}

function pqEvidence(item) {
  if (item.pq_evidence && item.pq_evidence.status) return item.pq_evidence;
  for (const assertion of activeManifest(item).assertions || []) {
    if (String(assertion.label || "").startsWith("org.pq-c2pa.p1")) {
      const data = assertion.data || {}, payload = data.payload || {};
      return {present:true, status:"UNVERIFIED", schema:data.schema, signature_algorithm:data.signature_algorithm,
        payload_sha3_256:data.payload_sha3_256, m0_active_manifest:payload.m0_active_manifest, m0_validation_state:payload.m0_validation_state,
        source_file_sha3_256:payload.source_file_sha3_256, created_at:payload.created_at, public_key_pem:data.public_key_pem,
        reason:item.processing_mode === "browser" ? "브라우저 검증에서는 P1 ML-DSA-65 서명을 검사하지 않음. 서버 검증으로 다시 확인 필요." : "P1 서명 검사 결과가 기록에 없음."};
    }
  }
  return {present:false, status:"NOT_PRESENT"};
}
const PQ_STATUS = {VALID:"유효", INVALID:"검증 실패", UNVERIFIED:"검사하지 못함", NOT_PRESENT:"없음"};

// Status codes grouped by what they say about the active manifest.
function facts(item) {
  const all = checksOf(item);
  const isActive = c => !c.scope || c.scope === "activeManifest" || c.scope === "legacy";
  const active = all.filter(isActive);
  const by = re => active.filter(c => re.test(String(c.code || "")));
  return {
    sigOk: by(/^claimSignature\.validated$/).length > 0,
    sigBad: by(/^claimSignature\.(mismatch|missing)$/),
    inside: by(/^claimSignature\.insideValidity$/).length > 0,
    outside: by(/^claimSignature\.outsideValidity$/),
    hashMatch: by(/^assertion\.hashedURI\.match$/).length,
    hashBad: by(/^assertion\.(hashedURI\.mismatch|missing|inaccessible)$/),
    bindOk: by(/^assertion\.(dataHash|bmffHash|boxesHash|collectionHash)\.match$/),
    bindBad: by(/^assertion\.(dataHash|bmffHash|boxesHash|collectionHash)\.mismatch$/),
    trusted: by(/^signingCredential\.trusted$/).length > 0,
    untrusted: by(/^signingCredential\.untrusted$/).length > 0,
    credBad: by(/^signingCredential\.(invalid|revoked|expired)$/),
    ocsp: by(/^signingCredential\.ocsp\./),
    ts: by(/^timeStamp\./),
    ingredient: all.filter(c => !isActive(c) || /^ingredient\./.test(String(c.code || ""))),
    failures: active.filter(c => c.kind === "failure"),
    counts: {success:all.filter(c => c.kind === "success").length, informational:all.filter(c => c.kind === "informational").length, failure:all.filter(c => c.kind === "failure").length},
  };
}

// Opinion on two competing propositions (SWGDE 18-I-001; no numerical probability).
function opinion(item, f = facts(item)) {
  const recordBad = [...f.sigBad, ...f.hashBad, ...f.ingredient.filter(c => c.kind === "failure")];
  if (item.state === "NoManifest") return {level:"판단 불가", statement:"검증할 C2PA 기록이 없어 두 명제를 평가할 수 없음. 기록이 없다는 사실은 변조의 근거가 되지 않음.", basis:["C2PA Manifest가 확인되지 않음"]};
  if (["RemoteUnavailable", "Error", "Unknown"].includes(item.state) || !STATES[item.state]) return {level:"판단 유보", statement:"검증을 완료하지 못하여 두 명제를 구분할 수 없음.", basis:[stateOf(item).line]};
  if (f.bindBad.length) {
    const basis = [`파일 데이터 해시가 서명 당시와 다름(${codeList(f.bindBad)})`];
    if (f.sigOk) basis.push("클레임 서명은 유효하므로 기록이 아닌 파일 데이터가 서명 이후 바뀐 것으로 해석됨");
    return {level:"H2를 강하게 지지", statement:"검증물은 C2PA 서명 이후 파일 데이터가 변경된 것으로 판단됨. 변경 내용은 해시 비교만으로 특정할 수 없음.", basis};
  }
  if (recordBad.length) return {level:"H2를 강하게 지지", statement:"C2PA 출처 기록이 서명 이후 변경되었거나 손상된 것으로 판단됨.", basis:[`서명된 기록과 실제 기록이 일치하지 않음(${codeList(recordBad)})`]};
  const credentialOnly = f.failures.every(c => /^(signingCredential|timeStamp)\./.test(String(c.code || "")));
  if (f.sigOk && f.bindOk.length && credentialOnly) {
    const basis = ["클레임 서명이 유효함(claimSignature.validated)", `파일 데이터 해시가 서명 당시와 일치함(${codeList(f.bindOk)})`];
    if (item.state === "Trusted" && !f.failures.length) {
      basis.push("서명 인증서가 선택한 신뢰 기준에 연결됨(signingCredential.trusted)");
      return {level:"H1을 강하게 지지", statement:"검증물과 C2PA 기록은 서명 이후 변경되지 않았으며, 선택한 신뢰 기준의 서명자가 기록한 것으로 판단됨.", basis};
    }
    basis.push(`서명자 또는 타임스탬프 기관의 신뢰는 확인되지 않음${f.failures.length ? `(${codeList(f.failures)})` : ""}`);
    return {level:"H1을 지지", statement:"서명 이후 검증물과 기록은 변경되지 않은 것으로 보이나, 서명자의 신뢰는 확인되지 않음.", basis};
  }
  return {level:"판단 유보", statement:"보고된 검사 결과만으로는 두 명제를 구분할 수 없음.", basis:f.failures.length ? [`실패 항목: ${codeList(f.failures)}`] : ["핵심 검사(서명·데이터 해시) 결과가 충분하지 않음"]};
}

function changeConclusion(item, f, op) {
  if (item.state === "NoManifest") return "C2PA 기록이 없어 판단할 수 없음.";
  if (op.level === "H2를 강하게 지지") return op.statement;
  if (f.sigOk && f.bindOk.length) return "C2PA 서명 이후 검증물과 출처 기록은 변경되지 않은 것으로 판단됨.";
  return "검증을 완료하지 못하여 판단할 수 없음.";
}
function trustConclusion(item, f) {
  const who = filled(item.signature?.common_name, "서명자");
  if (item.state === "NoManifest") return "C2PA 기록이 없어 해당 없음.";
  if (f.credBad.length) return `서명 인증서에 문제가 보고되어 서명자를 신뢰할 수 없음(${codeList(f.credBad)}).`;
  if (f.trusted) return `서명자 '${who}'은(는) 선택한 신뢰 기준에서 확인됨${item.trust_profile === "lab" ? "(프로젝트 CA Trust Anchor 기준)" : ""}.`;
  if (f.untrusted) return `서명자 '${who}'은(는) 선택한 신뢰 기준에서 확인되지 않음. 서명 자체의 유효성과 별개로 서명자를 신뢰할 근거는 확인되지 않음.`;
  return "서명자 신뢰 여부를 판단할 수 없음.";
}
function pqConclusion(pq) {
  if (pq.status === "VALID") return `P1 증거의 ML-DSA-65 서명은 유효함${pq.m0_active_manifest ? `. 연결된 원본 Manifest는 ${pq.m0_active_manifest}임` : ""}.`;
  if (pq.status === "INVALID") return `P1 증거의 서명 검사에 실패함. ${terse(pq.reason || "")}`.trim();
  if (pq.status === "UNVERIFIED") return `P1 증거의 서명을 검사하지 못함. ${terse(pq.reason || "")}`.trim();
  return "P1 증거가 없음.";
}

function notes(item, f) {
  const out = [];
  if (item.trust_profile === "lab" && manifestCount(item)) out.push("신뢰 판정은 프로젝트 자체 CA를 Trust Anchor로 등록한 기준으로 수행했으며, 서명자 인증서가 이 Trust Anchor까지 연결됨을 확인함.");
  if (manifestCount(item) && (f.ocsp.some(c => c.code === "signingCredential.ocsp.skipped") || item.network_policy?.ocsp === false)) out.push("인증서 폐지 여부(OCSP)를 조회하지 않았으며, 이를 ‘폐지되지 않음’으로 해석하지 않음.");
  if (item.ai === "declared") out.push("생성형 AI 사용 선언은 서명자가 기록한 내용으로, 독립적인 딥페이크·AI 탐지 결과가 아님.");
  if (item.state === "NoManifest") out.push("유통 과정에서 메타데이터가 제거되는 경우가 많으므로, C2PA 기록이 없다는 사실은 조작의 근거가 되지 않음.");
  if (item.error) out.push(`분석 오류 메시지: ${safe(item.error, 300)}`);
  out.push("본 검증은 C2PA 출처 기록의 서명·결합 상태를 확인한 것으로, 검증물에 담긴 내용의 사실 여부, 제작자의 실제 신원, 권리관계를 판단하지 않음.");
  out.push(`신뢰 판정은 검증 시점(${stamp(item.created_at)})의 신뢰 기준과 인증서 상태에 따름.`);
  return out;
}

function limitations() {
  return [
    "C2PA 검증은 기록이 파일에 결합되어 있고 서명 이후 바뀌지 않았는지를 확인함. 기록된 내용(촬영 장소, 제작자, AI 사용 여부 등)의 사실 여부는 보증하지 않음.",
    "신뢰 판정은 사용한 신뢰 기준과 검증 시각에 따라 달라질 수 있음. 인증서 만료·폐지 또는 신뢰 목록 갱신 이후에는 같은 파일도 결과가 달라질 수 있음.",
    "C2PA 기록이 없는 파일은 이 방법으로 평가할 수 없으며, 기록 부재는 변조의 근거가 아님.",
    "AI 생성 선언이 없다는 사실이 AI를 사용하지 않았다는 뜻은 아님.",
    "ECDSA·RSA 서명은 양자컴퓨터에 취약한 계열로, NIST IR 8547에 따라 2030년 이후 사용 자제(deprecated), 2035년 이후 사용 금지(disallowed) 대상임.",
    "본 문서는 연구용 도구가 자동 생성한 것으로, 수사기관 공식 서식, 공인 감정서 또는 KOLAS 인정 시험성적서가 아님.",
  ];
}

// ---------- who vouches for what: system-checked, server-issued, or typed in ----------
// KS Q ISO/IEC 17025 7.8.2.2: information supplied by the customer is identified as such.
const DECLARED_NOTE = "‘*’ 표시 항목은 신청인이 기재한 사항으로, 발급 시스템이 사실 여부를 확인하지 않음(KS Q ISO/IEC 17025 7.8.2.2). 이 정보는 검증 결과에 영향을 주지 않음.";
// Only what the applicant (the person submitting the image) can state. Case number, receipt
// date and the receiving officer are left blank on the submission form for the police to fill in.
const DECLARED_KEYS = {applicant:"applicant", submitTo:"submit_to", purpose:"purpose"};
const typed = value => safe(value, 400).trim();
const declared = (value, fallback = "기재하지 않음") => typed(value) ? `${typed(value)} *` : fallback;
function identityOf(options) {
  const identity = options.issuance?.offline ? {} : options.issuance?.record?.identity || {};
  return {phone:identity.applicant_phone?.status === "VERIFIED" ? identity.applicant_phone : null};
}
function requesterText(options) {
  const phone = identityOf(options).phone;
  const name = `${declared(options.applicant)}${phone ? `, 휴대폰 인증 ${phone.phone_masked}` : ""}`;
  return typed(options.submitTo) ? `${name}\n제출처 ${declared(options.submitTo)}` : name;
}
const caseText = () => "";
const orgName = () => "";
const POLICE_BLANK = "(접수 기관 기재)";
const signedName = value => typed(value) ? `${typed(value)} *` : "";
// Server times keep the offset they were issued with.
function isoParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const [, Y, M, D, h, mi, sec, off] = m, zone = off === "Z" ? "+00:00" : off;
  return {text:`${Y}-${M}-${D} ${h}:${mi}:${sec} (UTC${zone})`, short:`${Y}-${M}-${D} ${h}:${mi}`, dot:`${Y}. ${+M}. ${+D}.`, long:`${Y}년 ${+M}월 ${+D}일`};
}
function identityRemarks(options) {
  const {phone} = identityOf(options), signed = options.issuance?.signature?.status === "SIGNED";
  if (phone) return [`신청인의 휴대폰 번호(${phone.phone_masked})는 ${isoParts(phone.verified_at)?.short || phone.verified_at}에 문자 인증번호로 확인되었으며, 이 신청인이 본 보고서를 발급했다는 기록이 서버 발급 기록${signed ? "(ML-DSA-65 서명)" : ""}에 남음. 신청인 이름은 기재 사항임.`];
  return ["신청인의 신원은 시스템이 확인하지 않았으며, 신청인의 자필 서명으로 확인함."];
}
function issuanceRemark(meta) {
  if (!meta.issuance) return `이 문서는 발급 서버에 등록되지 않았음${meta.offlineReason ? `(${meta.offlineReason})` : ""}. 문서번호와 발급 시각은 작성자 PC에서 생성됨.`;
  const signed = meta.issuance.signature?.status === "SIGNED";
  return `이 문서는 발급 서버에 등록되었으며(확인번호 ${meta.issuance.verification_code}), 발급 기록은 ${signed ? "ML-DSA-65로 서명됨" : "서명되지 않았음(서버 ML-DSA 미지원)"}. 발급 당시 PDF의 SHA-256이 발급 서버에 등록됨.`;
}
function issuanceRows(meta, options) {
  const s = meta.issuance, {phone} = identityOf(options);
  return [
    ["문서번호", `${s.doc_no}    확인번호  ${s.verification_code}`],
    ["발급 시각", `${meta.issuedText}, 발급 서버 시각`],
    ["발급 기록 서명", s.signature?.status === "SIGNED" ? `ML-DSA-65 (FIPS 204), 서버 공개키 SHA-256 ${String(s.signature.public_key_sha256).slice(0, 16)}…` : "서명하지 않음(발급 서버 OpenSSL이 ML-DSA-65 미지원)"],
    ["신청인 확인", phone ? `휴대폰 문자 인증 ${phone.phone_masked} (${isoParts(phone.verified_at)?.short || ""}), 발급 기록에 남김` : "확인하지 않음(신청인 자필 서명으로 확인)"],
  ];
}
function drawIssuance(r, meta, options, {compact = false} = {}) {
  if (meta.issuance) r.issueBox(null, "발급 확인", issuanceRows(meta, options), {compact});
  else r.issueBox(null, "발급 확인 · 미등록", [["상태", `발급 서버에 등록하지 못함${meta.offlineReason ? `(${meta.offlineReason})` : ""}`],
    ["발급 시각", meta.issuedText], ["비고", "서버에 연결된 상태에서 다시 발급하면 문서번호·발급 시각을 서버가 부여함"]]);
}

// ---------- canvas renderer ----------
function createRenderer(meta) {
  const pages = [];
  let ctx = null, y = TOP, figNo = 0, tableNo = 0;
  let BODY = meta.serif ? SERIF : SANS;
  const font = (size, weight = 400, family = SANS) => `${weight} ${size}px ${family}`;
  function newPage() {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * SCALE); canvas.height = Math.round(H * SCALE);
    ctx = canvas.getContext("2d"); ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    pages.push(canvas); y = TOP;
  }
  // Headings wait in `pending` and are drawn by the next block, so a heading
  // always moves to the next page together with the content that follows it.
  let pending = [];
  function ensure(height) {
    const held = pending.reduce((sum, p) => sum + p.height, 0);
    if (y + held + height > BOTTOM) newPage();
    const list = pending; pending = [];
    for (const p of list) { if (y > TOP) y += p.gap; p.draw(); y += p.height - p.gap; }
  }
  // A short table that does not fit moves to the next page only when little room is
  // left; with plenty of room it splits, so pages are not left half empty.
  function keepTogether(total) {
    const room = BOTTOM - y - pending.reduce((sum, p) => sum + p.height, 0), page = BOTTOM - TOP;
    return total <= room || (total <= page * 0.45 && room < page * 0.3);
  }
  function heading(height, gap, drawAt) { pending.push({height, gap, draw:() => drawAt(y)}); }
  function hrule(x, yy, w, t = 1, color = C.ink) { ctx.fillStyle = color; ctx.fillRect(x, yy, w, t); }
  function vrule(x, yy, h, t = 1, color = C.thin) { ctx.fillStyle = color; ctx.fillRect(x, yy, t, h); }
  function measure(text, f) { ctx.font = f; return ctx.measureText(text).width; }
  function wrap(text, width, f) {
    ctx.font = f;
    const out = [];
    for (const paragraph of safe(text, 4000).split("\n")) {
      let line = "";
      for (const token of paragraph.split(/(\s+)/)) {
        if (!token) continue;
        if (ctx.measureText(line + token).width <= width) { line += token; continue; }
        if (line.trim()) { out.push(line.trimEnd()); line = ""; }
        if (/^\s+$/.test(token)) continue;
        if (ctx.measureText(token).width <= width) { line = token; continue; }
        for (const char of token) {
          if (ctx.measureText(line + char).width > width && line) { out.push(line); line = char; } else line += char;
        }
      }
      out.push(line.trimEnd());
    }
    return out.length ? out : [""];
  }
  function draw(text, x, yy, f, color = C.text, align = "left") {
    ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, yy); ctx.textAlign = "left";
  }

  function title(main, sub, {after = 30} = {}) {
    y = Math.max(y, TOP + 10);
    const f = font(40, 700, SERIF);
    ctx.save(); ctx.letterSpacing = "4px";
    for (const line of wrap(main, CW, f)) { draw(line, W / 2, y + 40, f, C.ink, "center"); y += 56; }
    ctx.restore();
    if (sub) { draw(sub, W / 2, y + 20, font(19, 400, SANS), C.muted, "center"); y += 34; }
    y += after;
  }
  // "label : value" lines at the head of a 감정서.
  function fields(rows, {size = 21, labelW = 118} = {}) {
    const lf = font(size, 700, BODY), vf = font(size, 400, BODY), step = Math.round(size * 1.6), x = L + labelW;
    for (const [label, value] of rows) {
      const lines = wrap(value, R - x - 26, vf);
      ensure(step * lines.length);
      draw(label, L, y + size, lf, C.ink); draw(":", x, y + size, vf, C.ink);
      lines.forEach((line, i) => draw(line, x + 22, y + size + i * step, vf, C.text));
      y += step * lines.length + 4;
    }
    y += 8;
  }
  function boxHead(label) { heading(58, 16, at => draw(`□ ${label}`, L, at + 23, font(23, 700, BODY), C.ink)); }
  function numHead(label) { heading(64, 22, at => draw(label, L, at + 23, font(23, 700, BODY), C.ink)); }
  function subHead(label) { heading(46, 10, at => draw(label, L, at + 21, font(20, 700, BODY), C.ink)); }
  // Tag box + title, used for 붙임 / 별첨.
  function annexHead(tag, label, {page = false} = {}) {
    if (page === true || (page === "auto" && y > TOP + (BOTTOM - TOP) * 0.6)) newPage();
    heading(page === "auto" ? 102 : 84, page === "auto" ? 44 : 26, at => {
      const tf = font(17, 700, SANS), tw = measure(tag, tf) + 26;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.strokeRect(L, at, tw, 34);
      draw(tag, L + 13, at + 24, tf, C.ink);
      draw(label, L + tw + 18, at + 26, font(23, 700, BODY), C.ink);
    });
  }
  // One marked item with a hanging indent: "가. text", "1) text", "※ text".
  function item(mark, text, {level = 1, size = 21, family = BODY, color = C.text, after = 5, markW} = {}) {
    const f = font(size, 400, family), step = Math.round(size * 1.62), x = L + level * size * 1.2;
    const mw = markW || Math.max(measure(mark, f) + size * 0.5, size * 1.6), textX = x + (mark || markW ? mw : 0);
    const lines = wrap(text, R - textX, f);
    lines.forEach((line, i) => {
      ensure(i ? step : step * Math.min(lines.length, 2));
      if (!i && mark) draw(mark, x, y + size, f, C.ink);
      draw(line, textX, y + size, f, color); y += step;
    });
    y += after;
  }
  function para(text, {size = 21, weight = 400, family = BODY, color = C.text, indent = 0, after = 8, align = "left"} = {}) {
    const f = font(size, weight, family), step = Math.round(size * 1.62);
    const x = align === "center" ? W / 2 : align === "right" ? R : L + indent;
    for (const line of wrap(text, CW - indent, f)) { ensure(step); draw(line, x, y + size, f, color, align); y += step; }
    y += after;
  }
  // Ruled grid: thick top/bottom, thin inner rules, no outer side rules.
  function grid(cols, rows, {size = 18, caption, note, indent = 0, padY = 9, numbered = false} = {}) {
    if (caption && numbered) caption = `표 ${++tableNo}. ${caption}`;
    const x0 = L + indent, tw = CW - indent;
    const widths = cols.map(col => Math.round(tw * col.w));
    widths[widths.length - 1] = tw - widths.slice(0, -1).reduce((a, b) => a + b, 0);
    const padX = 10, step = Math.round(size * 1.5), hf = font(size, 700, SANS);
    const headLines = cols.map((col, i) => wrap(col.title, widths[i] - padX * 2, hf));
    const headH = Math.max(...headLines.map(l => l.length)) * step + padY * 2;
    const header = () => {
      hrule(x0, y, tw, 2.2); ctx.fillStyle = C.fill; ctx.fillRect(x0, y + 2.2, tw, headH);
      let x = x0;
      headLines.forEach((lines, i) => {
        const top = y + 2.2 + (headH - lines.length * step) / 2;
        lines.forEach((line, j) => draw(line, x + widths[i] / 2, top + j * step + size - 1, hf, C.ink, "center"));
        if (i) vrule(x, y + 2.2, headH); x += widths[i];
      });
      y += 2.2 + headH; hrule(x0, y, tw, 1, C.ink);
    };
    const prepared = rows.map(row => {
      const cells = row.map((cell, i) => {
        const rich = typeof cell === "object" && cell !== null, col = cols[i], text = rich ? cell.text : cell;
        const f = col.mono || (rich && cell.mono) ? font(size - 2, 400, MONO) : font(size, rich && cell.bold ? 700 : 400, SANS);
        return {lines:wrap(text === "" ? "" : filled(text, "—"), widths[i] - padX * 2, f), f, align:col.align || "left"};
      });
      return {cells, h:Math.max(...cells.map(c => c.lines.length)) * step + padY * 2};
    });
    const noteLines = note ? wrap(note, tw, font(17, 400, SANS)) : [];
    const capH = (caption ? 34 : 0) + noteLines.length * 27 + (note ? 6 : 0), total = capH + headH + 6 + prepared.reduce((sum, row) => sum + row.h, 0);
    ensure(keepTogether(total) ? total : capH + headH + (prepared[0]?.h || 0) + 8);
    if (caption) { draw(caption, x0, y + 20, font(19, 700, SANS), C.ink); y += 34; }
    noteLines.forEach(line => { draw(line, x0, y + 18, font(17, 400, SANS), C.muted); y += 27; });
    if (note) y += 6;
    header();
    prepared.forEach(({cells, h}, r) => {
      if (y + h > BOTTOM) { hrule(x0, y, tw, 2.2); newPage(); header(); }
      let x = x0;
      cells.forEach((cell, i) => {
        const tx = cell.align === "center" ? x + widths[i] / 2 : x + padX;
        cell.lines.forEach((line, j) => draw(line, tx, y + padY + size + j * step - 1, cell.f, C.text, cell.align));
        if (i) vrule(x, y, h); x += widths[i];
      });
      y += h;
      if (r < rows.length - 1) hrule(x0, y, tw, 0.8, C.thin);
    });
    hrule(x0, y, tw, 2.2); y += 2.2 + 20;
  }
  // Label/value table in the same ruled style.
  function kv(rows, {labelW = 0.2, size = 19, labelAlign = "center", indent = 0, padY = 10, image = null, imageW = 250} = {}) {
    const x0 = L + indent, tw = CW - indent - (image ? imageW + 26 : 0), lw = Math.round(tw * labelW), padX = 14, step = Math.round(size * 1.52);
    const lf = font(size, 700, SANS);
    const prepared = rows.map(([label, value, opts = {}]) => {
      const vf = opts.mono ? font(size - 2, 400, MONO) : font(size, opts.bold ? 700 : 400, SANS);
      const vLines = wrap(filled(value), tw - lw - padX * 2, vf), lLines = wrap(label, lw - padX * 2, lf);
      return {vf, vLines, lLines, h:Math.max(vLines.length, lLines.length) * step + padY * 2};
    });
    const total = prepared.reduce((sum, row) => sum + row.h, 0) + 6;
    ensure(keepTogether(total) ? total : (prepared[0]?.h || 40) + 8);
    const top = y; hrule(x0, y, tw, 2.2); y += 2.2;
    prepared.forEach(({vf, vLines, lLines, h}, r) => {
      if (y + h > BOTTOM) { hrule(x0, y, tw, 2.2); newPage(); hrule(x0, y, tw, 2.2); y += 2.2; }
      ctx.fillStyle = C.fill; ctx.fillRect(x0, y, lw, h); vrule(x0 + lw, y, h);
      const lx = labelAlign === "center" ? x0 + lw / 2 : x0 + padX;
      lLines.forEach((line, i) => draw(line, lx, y + padY + size + i * step - 1, lf, C.ink, labelAlign));
      vLines.forEach((line, i) => draw(line, x0 + lw + padX, y + padY + size + i * step - 1, vf, C.text));
      y += h;
      if (r < rows.length - 1) hrule(x0, y, tw, 0.8, C.thin);
    });
    hrule(x0, y, tw, 2.2);
    if (image) {
      const bx = x0 + tw + 26, bh = y + 2.2 - top, ratio = Math.min((imageW - 16) / image.naturalWidth, (bh - 16) / image.naturalHeight);
      const iw = image.naturalWidth * ratio, ih = image.naturalHeight * ratio;
      ctx.strokeStyle = C.thin; ctx.lineWidth = 1; ctx.strokeRect(bx, top, imageW, bh);
      ctx.drawImage(image, bx + (imageW - iw) / 2, top + (bh - ih) / 2, iw, ih);
    }
    y += 2.2 + 20;
  }
  // Images in thin frames with "(가) …" labels and a numbered caption.
  function figure(entries, caption, {maxH = 320, keepAfter = 0} = {}) {
    const usable = entries.filter(([img]) => img);
    if (!usable.length) return;
    const gap = 30, multi = usable.length > 1;
    const boxW = multi ? (CW - gap * (usable.length - 1)) / usable.length : Math.round(CW * 0.6);
    const ratio = img => Math.min((boxW - 20) / img.naturalWidth, maxH / img.naturalHeight, 1.5);
    const h = Math.max(...usable.map(([img]) => img.naturalHeight * ratio(img))) + 20;
    ensure(h + (multi ? 40 : 0) + 56 + keepAfter);
    usable.forEach(([img, label], i) => {
      const x = multi ? L + i * (boxW + gap) : L + (CW - boxW) / 2, r = ratio(img), iw = img.naturalWidth * r, ih = img.naturalHeight * r;
      ctx.strokeStyle = C.thin; ctx.lineWidth = 1; ctx.strokeRect(x, y, boxW, h);
      ctx.drawImage(img, x + (boxW - iw) / 2, y + (h - ih) / 2, iw, ih);
      if (multi) draw(`(${LETTERS[i]}) ${label}`, x + boxW / 2, y + h + 28, font(17, 400, SANS), C.text, "center");
    });
    y += h + (multi ? 40 : 0) + 14;
    figNo++; draw(`그림 ${figNo}. ${caption}`, W / 2, y + 20, font(18, 700, SANS), C.ink, "center"); y += 46;
  }
  // Double-ruled box holding the overall result (summary sheet).
  function resultBox(label, value, line) {
    const lf = font(20, 400, SANS), lines = wrap(line, CW - 64, lf), h = 98 + lines.length * 32;
    ensure(h + 20);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(L, y, CW, h); ctx.lineWidth = 0.8; ctx.strokeRect(L + 6, y + 6, CW - 12, h - 12);
    const tf = font(20, 700, SANS); draw(label, L + 32, y + 54, tf, C.muted);
    draw(value, L + 32 + measure(label, tf) + 22, y + 56, font(30, 700, SANS), C.ink);
    lines.forEach((text, i) => draw(text, L + 32, y + 94 + i * 32, lf, C.text));
    y += h + 22;
  }
  // Bordered "발급 확인" box with an optional QR code on the left.
  function issueBox(qr, heading, rows, {compact = false} = {}) {
    const qrSize = qr ? (compact ? 138 : 168) : 0, pad = compact ? 14 : 18, gap = qr ? 22 : 0, x0 = L + pad + qrSize + gap, lw = compact ? 116 : 128, vw = R - pad - x0 - lw;
    const size = compact ? 15 : 16, vf = font(size, 400, SANS), lf = font(size, 700, SANS), step = compact ? 21 : 24;
    const lines = rows.map(([, value]) => wrap(value, vw, vf));
    const textH = (compact ? 30 : 34) + lines.reduce((sum, l) => sum + l.length * step + 4, 0);
    const h = Math.max(qrSize, textH) + pad * 2;
    ensure(h + 16);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.strokeRect(L, y, CW, h);
    if (qr) {
      const quiet = 2, cell = qrSize / (qr.size + quiet * 2), qx = L + pad, qy = y + (h - qrSize) / 2;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(qx, qy, qrSize, qrSize); ctx.fillStyle = C.ink;
      for (let row = 0; row < qr.size; row++) for (let col = 0; col < qr.size; col++) {
        if (qr.dark(row, col)) ctx.fillRect(qx + (col + quiet) * cell, qy + (row + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    let ty = y + pad;
    draw(heading, x0, ty + 20, font(compact ? 18 : 20, 700, SANS), C.ink); ty += compact ? 30 : 34;
    rows.forEach(([label], i) => {
      draw(label, x0, ty + size + 1, lf, C.ink);
      lines[i].forEach((line, j) => draw(line, x0 + lw, ty + size + 1 + j * step, vf, C.text));
      ty += lines[i].length * step + 4;
    });
    y += h + 16;
  }
  // 시험성적서 "확인" row.
  function confirmRow(cells) {
    const h = 58, lw = Math.round(CW * 0.12), cw = (CW - lw) / cells.length;
    ensure(h + 24);
    hrule(L, y, CW, 2.2); y += 2.2;
    ctx.fillStyle = C.fill; ctx.fillRect(L, y, lw, h);
    draw("확 인", L + lw / 2, y + 37, font(19, 700, SANS), C.ink, "center");
    cells.forEach(([role, name], i) => {
      const x = L + lw + i * cw; vrule(x, y, h);
      draw(`${role}  성명 : ${name || ""}`, x + 18, y + 37, font(19, 400, SANS), C.text);
      draw("(서명)", x + cw - 16, y + 37, font(17, 400, SANS), C.muted, "right");
    });
    y += h; hrule(L, y, CW, 2.2); y += 2.2 + 24;
  }
  // Date, organisation and signer lines at the end of a 감정서.
  function signatures({date, org, signers}) {
    ensure(64 + (org ? 60 : 0) + signers.length * 54 + 20);
    y += 26;
    draw(date, W / 2, y + 22, font(22, 400, BODY), C.ink, "center"); y += 58;
    if (org) { ctx.save(); ctx.letterSpacing = "2px"; draw(org, W / 2, y + 25, font(25, 700, BODY), C.ink, "center"); ctx.restore(); y += 62; }
    const x = R - 470;
    for (const [role, name] of signers) {
      draw(role, x, y + 23, font(21, 400, BODY), C.ink);
      if (name) draw(spaced(name), x + 120, y + 23, font(22, 700, BODY), C.ink);
      else hrule(x + 120, y + 28, 220, 0.8, C.thin);
      draw("(서명)", R, y + 23, font(18, 400, BODY), C.muted, "right");
      y += 52;
    }
  }
  function center(text, {size = 18, color = C.muted, after = 10, squeeze = false} = {}) { if (!(squeeze && y + size * 1.6 < H - 16 * MM)) ensure(size * 2); draw(text, W / 2, y + size, font(size, 400, SANS), color, "center"); y += size * 1.6 + after; }
  function space(n) { y += n; }
  function pageBreak() { newPage(); }
  function setSerif(on) { BODY = on ? SERIF : SANS; }
  function pageNo() { return pages.length; }
  function cursor() { return y; }
  // Draw on an earlier page (used for the table of contents once page numbers are known).
  function at(page, yy, fn) {
    const saved = [ctx, y]; ctx = pages[page - 1].getContext("2d"); y = yy;
    try { fn(); } finally { [ctx, y] = saved; }
  }
  // Black tag at the top of each part of a combined report.
  function partLabel(tag, text) {
    const tf = font(17, 700, SANS), tw = measure(tag, tf) + 26;
    ctx.fillStyle = C.ink; ctx.fillRect(L, y, tw, 34);
    draw(tag, L + 13, y + 24, tf, "#ffffff");
    draw(text, L + tw + 16, y + 24, font(18, 400, SANS), C.muted);
    y += 52;
  }
  // Boxes joined by arrows, e.g. M0 → P1 → M1.
  function flow(steps, caption) {
    const n = steps.length, arrow = 54, bw = (CW - arrow * (n - 1)) / n, lf = font(17, 400, SANS);
    const lines = steps.map(step => step.lines.flatMap(line => wrap(line, bw - 28, lf)));
    const bh = 112 + Math.max(...lines.map(l => l.length)) * 26;
    ensure(bh + 70);
    steps.forEach((step, i) => {
      const x = L + i * (bw + arrow);
      ctx.fillStyle = C.fill; ctx.fillRect(x, y, bw, 44);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.strokeRect(x, y, bw, bh); hrule(x, y + 44, bw, 1);
      draw(step.tag, x + bw / 2, y + 29, font(18, 700, SANS), C.ink, "center");
      draw(step.title, x + 14, y + 76, font(19, 700, SANS), C.ink);
      lines[i].forEach((line, j) => draw(line, x + 14, y + 106 + j * 26, lf, C.text));
      if (i < n - 1) {
        const ax = x + bw + 8, ay = y + bh / 2, ex = x + bw + arrow - 8;
        hrule(ax, ay - 1, ex - ax - 8, 2, C.ink);
        ctx.beginPath(); ctx.moveTo(ex, ay); ctx.lineTo(ex - 12, ay - 7); ctx.lineTo(ex - 12, ay + 7); ctx.closePath(); ctx.fillStyle = C.ink; ctx.fill();
      }
    });
    y += bh + 14;
    figNo++; draw(`그림 ${figNo}. ${caption}`, W / 2, y + 20, font(18, 700, SANS), C.ink, "center"); y += 46;
  }
  function finish() {
    const total = pages.length, hy = Math.round(13 * MM), fy = H - Math.round(12 * MM);
    pages.forEach((canvas, i) => {
      const c = canvas.getContext("2d");
      c.save(); c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      c.textBaseline = "alphabetic"; c.font = font(15, 400, SANS); c.fillStyle = C.muted;
      c.textAlign = "left"; c.fillText(meta.headerLeft, L, hy);
      c.textAlign = "right"; c.fillText(meta.page === "kolas" ? `페이지 (${i + 1}) / (총 ${total})` : meta.headerRight, R, hy);
      c.fillStyle = C.ink; c.fillRect(L, hy + 11, CW, 1);
      c.fillStyle = C.thin; c.fillRect(L, fy - 27, CW, 0.8);
      c.font = font(14, 400, SANS); c.fillStyle = C.faint;
      c.textAlign = "left"; c.fillText(meta.footerLeft, L, fy);
      c.textAlign = "right"; c.fillText(meta.footerRight, R, fy);
      if (meta.page !== "kolas") {
        c.font = font(16, 400, SANS); c.fillStyle = C.text; c.textAlign = "center";
        c.fillText(meta.page === "gov" ? `- ${i + 1} -` : `${i + 1} / ${total}`, W / 2, fy);
      }
      c.restore();
    });
    return pages;
  }
  newPage();
  return {ensure, title, fields, boxHead, numHead, subHead, annexHead, item, para, grid, kv, figure, resultBox, issueBox, confirmRow, signatures, center, space, pageBreak,
    setSerif, pageNo, cursor, at, partLabel, flow, finish};
}

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ---------- shared tables ----------
function identityRows(item) {
  const rows = [["파일명", filled(item.filename)], ["형식(MIME)", filled(item.mime)], ["크기", bytes(item.size)]];
  if (dimsOf(item)) rows.push(["해상도", `${dimsOf(item)[0]} × ${dimsOf(item)[1]} px`]);
  rows.push(["SHA-256", filled(item.sha256), {mono:true}]);
  if (item.sha3_256) rows.push(["SHA3-256", item.sha3_256, {mono:true}]);
  if (item.source_url) rows.push(["수집 URL", item.source_url]);
  return rows;
}
function environmentRows(item, env) {
  const results = item.store?.validation_results || {};
  const rows = [["검증 방식", modeKo(item)], ["검증 엔진", engineKo(item, env)]];
  if (results.specVersion) rows.push(["C2PA 사양 버전", results.specVersion]);
  rows.push(["신뢰 기준", trustKo(item)]);
  if (results.trustListUri) rows.push(["신뢰 앵커", results.trustListUri === "user_anchors" ? "사용자 지정 신뢰 앵커(user_anchors)" : results.trustListUri]);
  rows.push(["네트워크 정책", `원격 Manifest 조회 ${item.network_policy?.remote_manifests ? "허용" : "차단"}, OCSP 조회 ${item.network_policy?.ocsp ? "수행" : "하지 않음"}`]);
  rows.push(["P1 서명 검사", item.pq_evidence?.verifier || env?.pq_evidence_verifier || (item.processing_mode === "browser" ? "브라우저 검증에서는 사용하지 않음" : "OpenSSL 3.5 이상 필요(이 서버에서 확인되지 않음)")]);
  return rows;
}
function signatureRows(item) {
  const sig = item.signature || {};
  return [
    ["서명자(CN)", filled(sig.common_name, "확인되지 않음")],
    ["인증서 발급자", filled(sig.issuer, "확인되지 않음")],
    ["인증서 일련번호", filled(sig.cert_serial_number, "확인되지 않음"), {mono:true}],
    ["서명 알고리즘", algLabel(sig.alg)],
    ["서명 시각", sig.time ? stamp(sig.time) : "기록 없음"],
    ["기록 생성 도구", filled(softwareName(item), "기록 없음")],
  ];
}
function historyRows(item, meta) {
  return [
    [stamp(item.created_at), `파일 접수 및 해시 계산(${item.processing_mode === "browser" ? "브라우저 내부 처리" : "로컬 서버 처리"})`],
    [stamp(item.created_at), `C2PA 검증 수행${Number.isFinite(item.elapsed_ms) ? `(소요 ${item.elapsed_ms.toLocaleString("ko-KR")} ms)` : ""}`],
    [stamp(item.created_at), item.report_saved === false ? "검증 기록 서버 미저장(개인정보 보호 모드)" : `검증 기록 서버 저장(기록 ID ${filled(item.id)})`],
    [meta.issuedText, `문서 발급(문서번호 ${meta.docNo}, ${meta.issuance ? "발급 서버 등록" : "미등록"})`],
  ];
}
const historyCols = [{title:"일시", w:0.38, align:"center"}, {title:"처리 내용", w:0.62}];
function actionRows(item) {
  return (item.actions || []).map((action, i) => [String(i + 1), `${ACTION_KO[action.action] || "기타"}\n${filled(action.action, "—")}`,
    action.when ? stamp(action.when) : "—", filled(agent(action.softwareAgent), "—"), filled(sourceType(action.digitalSourceType), "—")]);
}
const actionCols = [{title:"순번", w:0.07, align:"center"}, {title:"작업", w:0.23}, {title:"시각", w:0.25}, {title:"도구", w:0.2}, {title:"출처 유형", w:0.25}];
function checkRows(item) {
  const order = {failure:0, informational:1, success:2};
  return checksOf(item).slice().sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))
    .map((c, i) => [String(i + 1), {text:kindKo(c.kind), bold:c.kind === "failure"}, filled(c.code, "—"), CODE_KO[c.code] || filled(c.explanation, "—"), filled(SCOPE_KO[c.scope] || c.scope, "—")]);
}
const checkCols = [{title:"순번", w:0.07, align:"center"}, {title:"결과", w:0.08, align:"center"}, {title:"상태 코드", w:0.33, mono:true}, {title:"내용", w:0.36}, {title:"범위", w:0.16, align:"center"}];

// Result table of the analysis report: item, criterion, result, judgement.
function resultRows(item, f) {
  const n = manifestCount(item), pq = pqEvidence(item), rows = [];
  rows.push(["C2PA 기록", "Manifest Store 판독", n ? `Manifest ${n}개` : "없음", n ? "확인" : "없음"]);
  if (!n) {
    rows.push(["서명·결합 검사", "C2PA 2.4 제15장", "기록이 없어 수행하지 않음", "해당 없음"]);
  } else {
    const when = f.outside.length ? ", 인증서 유효기간 밖" : f.inside ? ", 인증서 유효기간 안" : "";
    rows.push(["클레임 서명", "claimSignature.validated", f.sigOk ? `유효${when}` : f.sigBad.length ? "불일치 또는 없음" : "결과 없음", f.sigOk && !f.outside.length ? "통과" : f.sigBad.length || f.outside.length ? "실패" : "—"]);
    rows.push(["Assertion 무결성", "assertion.hashedURI.match", f.hashBad.length ? `${f.hashBad.length}건 불일치` : f.hashMatch ? `${f.hashMatch}건 일치` : "결과 없음", f.hashBad.length ? "실패" : f.hashMatch ? "통과" : "—"]);
    const bind = [...f.bindBad, ...f.bindOk][0]?.code?.replace(/\.(match|mismatch)$/, "") || "assertion.dataHash";
    rows.push(["파일 결합(하드 바인딩)", `${bind}.match`, f.bindBad.length ? "서명 당시와 다름" : f.bindOk.length ? "서명 당시와 일치" : "결과 없음", f.bindBad.length ? "실패" : f.bindOk.length ? "통과" : "—"]);
    rows.push(["서명자 신뢰", "signingCredential.trusted", f.credBad.length ? codeList(f.credBad) : f.trusted ? `연결됨${item.trust_profile === "lab" ? "(프로젝트 CA 기준)" : ""}` : f.untrusted ? "연결되지 않음" : "결과 없음", f.credBad.length ? "실패" : f.trusted ? "확인" : "미확인"]);
    const ocsp = f.ocsp[0]?.code;
    rows.push(["인증서 폐지 조회", "signingCredential.ocsp", ocsp === "signingCredential.ocsp.notRevoked" ? "폐지되지 않음" : ocsp === "signingCredential.ocsp.revoked" ? "폐지됨" : "조회하지 않음", ocsp === "signingCredential.ocsp.revoked" ? "실패" : ocsp === "signingCredential.ocsp.notRevoked" ? "통과" : "미수행"]);
    const tsCodes = f.ts.map(c => c.code);
    rows.push(["타임스탬프", "timeStamp.validated", !tsCodes.length ? "기록 없음" : [tsCodes.includes("timeStamp.validated") ? "서명·해시 일치" : "", tsCodes.includes("timeStamp.untrusted") ? "기관 신뢰 미확인" : tsCodes.includes("timeStamp.trusted") ? "기관 신뢰 확인" : ""].filter(Boolean).join(", ") || codeList(f.ts),
      !tsCodes.length ? "해당 없음" : f.ts.some(c => c.kind === "failure") ? "실패" : tsCodes.includes("timeStamp.untrusted") ? "참고" : "통과"]);
    if (f.ingredient.length || (item.ingredients || []).length) rows.push(["재료 Manifest", "ingredient.*", f.ingredient.some(c => c.kind === "failure") ? "실패 항목 있음" : f.ingredient.length ? "검증 통과" : `재료 ${(item.ingredients || []).length}건 기록`, f.ingredient.some(c => c.kind === "failure") ? "실패" : f.ingredient.length ? "통과" : "참고"]);
    rows.push(["AI 생성 선언", "digitalSourceType", item.ai === "declared" ? "선언 있음" : "선언 없음", "참고"]);
  }
  rows.push(["양자내성 보조 서명(P1)", "ML-DSA-65 (FIPS 204)", pq.present ? PQ_STATUS[pq.status] || pq.status : "증거 없음", pq.status === "VALID" ? "통과" : pq.status === "INVALID" ? "실패" : pq.status === "UNVERIFIED" ? "미수행" : "해당 없음"]);
  return rows.map((row, i) => [String(i + 1), ...row.slice(0, 3), {text:row[3], bold:row[3] === "실패"}]);
}
const resultCols = [{title:"번호", w:0.07, align:"center"}, {title:"분석 항목", w:0.22}, {title:"검사 기준", w:0.3, mono:true}, {title:"결과", w:0.27}, {title:"판정", w:0.14, align:"center"}];

function pqRows(item) {
  const sig = item.signature || {}, alg = algInfo(sig.alg), pq = pqEvidence(item), rows = [];
  const classical = alg ? !alg.pq : Boolean(sig.alg);
  if (sig.alg) rows.push(["C2PA 클레임 서명", algLabel(sig.alg), alg ? alg.family : "확인 불가", classical ? "없음" : "있음", classical ? "2030년 이후 사용 자제, 2035년 이후 사용 금지" : "양자내성 표준"]);
  if (pq.present) rows.push(["PQ-C2PA P1 증거", filled(pq.signature_algorithm, "ML-DSA-65"), "격자 기반", "있음", `서명 검사: ${PQ_STATUS[pq.status] || pq.status}`]);
  return rows;
}
const pqCols = [{title:"서명 대상", w:0.19}, {title:"알고리즘", w:0.27}, {title:"계열", w:0.12, align:"center"}, {title:"양자내성", w:0.11, align:"center"}, {title:"NIST IR 8547 기준", w:0.31}];

function observations(item, f) {
  const out = [], sig = item.signature || {}, n = manifestCount(item);
  if (!n) {
    out.push("검증물에서 C2PA Manifest가 확인되지 않음.");
    if (item.state === "RemoteUnavailable") out.push("출처 기록이 외부(원격 Manifest)에 있는 것으로 표시되었으나, 원격 조회를 하지 않아 검증하지 못함.");
    out.push("일반 메타데이터(EXIF 등)는 서명으로 보호되지 않으므로 출처 판단에 사용하지 않음.");
    return out;
  }
  out.push(`검증물에는 C2PA Manifest ${n}개가 내장되어 있으며, 활성 Manifest 식별자는 ${filled(item.store?.active_manifest)}임.`);
  out.push("SIGNATURE_TABLE");
  if (f.sigOk) out.push(`클레임 서명은 유효함(claimSignature.validated).${f.inside ? " 서명 시점은 인증서 유효기간 안에 있음(claimSignature.insideValidity)." : ""}`);
  else if (f.sigBad.length) out.push(`클레임 서명이 클레임 내용과 일치하지 않거나 없음(${codeList(f.sigBad)}).`);
  if (f.outside.length) out.push("서명 시점이 인증서 유효기간을 벗어남(claimSignature.outsideValidity).");
  if (f.hashBad.length) out.push(`클레임이 참조하는 Assertion 중 ${f.hashBad.length}건의 해시가 일치하지 않음(${codeList(f.hashBad)}).`);
  else if (f.hashMatch) out.push(`클레임이 참조하는 Assertion ${f.hashMatch}건의 해시가 모두 일치함(assertion.hashedURI.match).`);
  if (f.bindBad.length) out.push(`파일 데이터 해시가 서명 당시 기록된 값과 일치하지 않음(${codeList(f.bindBad)}).`);
  else if (f.bindOk.length) out.push(`파일 데이터 해시가 서명 당시 기록된 값과 일치함(${codeList(f.bindOk)}).`);
  const trust = f.trusted ? `서명 인증서는 선택한 신뢰 기준(${trustKo(item)})에 연결됨(signingCredential.trusted).`
    : f.untrusted ? "서명 인증서는 선택한 신뢰 기준에 연결되지 않음(signingCredential.untrusted)." : "";
  const ocsp = f.ocsp.some(c => c.code === "signingCredential.ocsp.skipped") ? " 인증서 폐지 여부(OCSP)는 조회하지 않음." : "";
  if (trust || ocsp) out.push((trust + ocsp).trim());
  if (f.credBad.length) out.push(`서명 인증서 상태에 문제가 보고됨(${codeList(f.credBad)}).`);
  const ts = f.ts.map(c => c.code);
  if (ts.length) out.push(`타임스탬프는 ${[ts.includes("timeStamp.validated") ? "서명과 해시가 일치함(timeStamp.validated)" : "", ts.includes("timeStamp.untrusted") ? "발급 기관이 신뢰 기준에서 확인되지 않음(timeStamp.untrusted)" : "", ts.includes("timeStamp.trusted") ? "발급 기관이 신뢰 기준에 연결됨(timeStamp.trusted)" : ""].filter(Boolean).join(". 다만 ") || codeList(f.ts)}.`);
  else out.push(sig.time ? "서명 시각은 기록되어 있으나 이를 보증하는 타임스탬프 검사 결과는 없음." : "서명 시각을 보증하는 타임스탬프 기록은 없음.");
  const acts = item.actions || [];
  if (acts.length) {
    const names = acts.map(a => `${ACTION_KO[a.action] || "기타"}(${a.action})`).join(", ");
    const src = uniq(acts.map(a => a.digitalSourceType).filter(Boolean).map(sourceType));
    out.push(`기록된 제작·편집 작업은 ${names}${src.length ? `이며, 출처 유형은 ${src.join(", ")}로 기록됨.` : "임."}`);
  } else out.push("기록된 제작·편집 작업은 없음.");
  out.push(item.ai === "declared" ? "Manifest에 생성형 AI 사용이 선언되어 있음(서명자가 기록한 선언임)." : "생성형 AI 사용 선언은 확인되지 않음.");
  const ings = item.ingredients || [];
  if (ings.length) out.push(`재료(Ingredient) ${ings.length}건이 기록됨: ${ings.map(i => `${filled(i.title, "제목 없음")}(${filled(i.relationship, "관계 미기재")})`).join(", ")}.`);
  const alg = algInfo(sig.alg), pq = pqEvidence(item);
  const algText = sig.alg ? `클레임 서명 알고리즘 ${algLabel(sig.alg)}은 ${alg && alg.pq ? "양자내성 표준 방식임" : "양자내성이 없는 방식임"}.` : "서명 알고리즘을 확인하지 못함.";
  out.push(`${algText} ${pq.present ? `PQ-C2PA P1 증거가 있으며, ML-DSA-65 서명 검사 결과는 ‘${PQ_STATUS[pq.status] || pq.status}’임.` : "PQ-C2PA P1 증거는 없음."}`);
  const covered = /^(claimSignature|assertion\.(hashedURI|dataHash|bmffHash|boxesHash|collectionHash|missing|inaccessible)|signingCredential|timeStamp)/;
  const others = f.failures.filter(c => !covered.test(String(c.code || "")));
  if (others.length) out.push(`그 밖의 실패 항목: ${others.map(c => `${c.code}${CODE_KO[c.code] ? `(${CODE_KO[c.code]})` : ""}`).join(", ")}.`);
  return out;
}

// ---------- report bodies ----------
function summaryReport(r, item, ctx) {
  const {meta, preview} = ctx, f = facts(item), op = opinion(item, f), sig = item.signature || {}, pq = pqEvidence(item), n = manifestCount(item);
  r.title(TYPES.summary.title);
  r.kv([["확인 대상", `${filled(item.filename)}\n${fileLine(item)}`], ["SHA-256", filled(item.sha256), {mono:true}],
    ["확인 일시", stamp(item.created_at)], ["확인 방법", `${modeKo(item)}\n신뢰 기준: ${trustKo(item)}`]], {labelW:0.2, image:preview});
  const changed = item.state === "NoManifest" ? "판단 불가" : f.bindBad.length || f.sigBad.length || f.hashBad.length ? "변경됨" : f.sigOk && f.bindOk.length ? "변경 없음" : "판단 불가";
  r.resultBox("확인 결과", stateOf(item).label, op.level === "판단 유보" || op.level === "판단 불가" ? stateOf(item).line : op.statement);
  r.grid([{title:"번호", w:0.07, align:"center"}, {title:"확인 항목", w:0.22}, {title:"결과", w:0.15, align:"center"}, {title:"내용", w:0.56}], [
    ["1", "출처 기록(C2PA)", {text:n ? "있음" : "없음", bold:true}, n ? `C2PA Manifest ${n}개 확인` : "확인 가능한 기록 없음. 기록이 없다는 이유만으로 조작으로 판단할 수 없음"],
    ["2", "서명 이후 변경", {text:changed, bold:changed === "변경됨"}, changed === "변경됨" ? (f.bindBad.length ? "파일 데이터 해시가 서명 당시와 다름" : "서명된 기록과 실제 기록이 다름") : changed === "변경 없음" ? "서명과 파일 데이터 해시가 서명 당시와 일치" : "검사하지 못함"],
    ["3", "서명자 확인", {text:item.state === "NoManifest" ? "해당 없음" : f.trusted ? "확인" : "미확인", bold:false}, item.state === "NoManifest" ? "—" : f.trusted ? `${filled(sig.common_name)}${item.trust_profile === "lab" ? "(프로젝트 CA 기준)" : ""}` : `${filled(sig.common_name, "서명자")}: 선택한 신뢰 기준에서 확인되지 않음`],
    ["4", "AI 생성 선언", {text:item.ai === "declared" ? "있음" : "없음", bold:false}, item.ai === "declared" ? "서명자가 생성형 AI 사용을 기록함(AI 탐지 결과 아님)" : "확인 가능한 선언 없음"],
    ["5", "양자내성 서명", {text:pq.present ? PQ_STATUS[pq.status] : "없음", bold:false}, pq.present ? "PQ-C2PA P1(ML-DSA-65) 증거 확인" : "PQ-C2PA P1(ML-DSA-65) 증거 없음"],
  ]);
  if (n) r.kv([["생성 도구", filled(softwareName(item), "기록 없음")], ["서명자", `${filled(sig.common_name, "확인되지 않음")}${sig.issuer ? ` (발급자 ${sig.issuer})` : ""}`],
    ["기록된 작업", (item.actions || []).length ? item.actions.map(a => ACTION_KO[a.action] || a.action).join(" → ") : "기록 없음"],
    ["출처 유형", uniq((item.actions || []).map(a => a.digitalSourceType).filter(Boolean).map(sourceType)).join(", ") || "기록 없음"]], {labelW:0.18});
  const caution = ["이 결과는 C2PA 기록의 서명·결합 상태를 확인한 것으로, 사진·영상 내용의 사실 여부를 판정하지 않음.",
    "C2PA 기록이 없다는 사실만으로 조작 여부를 판단할 수 없음.", "AI 생성 선언은 서명자가 기록한 내용으로, AI 탐지 결과가 아님."];
  if (item.trust_profile === "lab") caution.push("프로젝트 자체 CA를 Trust Anchor로 등록한 신뢰 기준으로 서명자를 확인함.");
  if (!ctx.composite) drawIssuance(r, meta, ctx.options);
  caution.forEach(text => r.item("※", text, {level:0, size:17, family:SANS, color:C.muted, after:2}));
  r.space(14); r.center("- 이하 여백 -", {squeeze:true});
}

function submissionReport(r, item, ctx) {
  const {meta, options, env, preview, manifestThumb, currentImage} = ctx, f = facts(item), op = opinion(item, f), pq = pqEvidence(item);
  const showCompare = Boolean(manifestThumb && currentImage), showImage = showCompare || Boolean(preview);
  r.title(TYPES.submission.title, "C2PA Content Credentials");
  const head = [["문서번호", `${meta.docNo} (${meta.issuedDot}${meta.issuance ? "" : ", 미등록"})`], ["신청인", requesterText(options)]];
  if (typed(options.purpose)) head.push(["확인 요청", declared(options.purpose)]);
  head.push(["사건번호", POLICE_BLANK], ["접수 일자", POLICE_BLANK]);
  r.fields(head);

  r.boxHead("검증물");
  r.item("1.", filled(item.filename), {level:1});
  r.item("-", `형식·크기 : ${fileLine(item)}`, {level:2, size:20});
  r.item("-", `SHA-256 : ${filled(item.sha256)}`, {level:2, size:20});
  if (item.sha3_256) r.item("-", `SHA3-256 : ${item.sha3_256}`, {level:2, size:20});
  if (item.source_url) r.item("-", `수집 URL : ${item.source_url}`, {level:2, size:20});

  r.boxHead("검증사항");
  const asks = ["검증물에 C2PA 출처 기록(Manifest)이 있는지 여부", "C2PA 서명 이후 검증물 또는 출처 기록이 변경되었는지 여부", "서명자가 선택한 신뢰 기준에서 확인되는지 여부"];
  if (pq.present) asks.push("양자내성 보조 서명(PQ-C2PA P1, ML-DSA-65)이 유효한지 여부");
  asks.forEach((text, i) => r.item(`${i + 1}.`, text, {level:1}));

  r.numHead("1. 검증 방법");
  const methods = [
    "검증물 전체 바이트의 SHA-256·SHA3-256 해시를 계산하여 검증물을 특정함.",
    `공식 C2PA SDK(${engineKo(item, env)})로 검증물에 내장된 Manifest를 판독하고, C2PA 기술 사양${specVersion(item) ? ` ${specVersion(item)}` : ""} 제15장(검증)에 따라 클레임 서명, Assertion 참조 해시, 파일 데이터 해시를 검사함.`,
    `서명 인증서를 신뢰 기준(${trustKo(item)})에 대조하여 서명자 신뢰 여부를 판정함.`,
    `원격 Manifest 조회는 ${item.network_policy?.remote_manifests ? "허용" : "하지 않았고"}, 인증서 폐지(OCSP) 조회는 ${item.network_policy?.ocsp ? "수행함" : "하지 않음"}.`,
  ];
  if (pq.present) methods.push(`P1 증거의 ML-DSA-65 서명을 ${pq.verifier || env?.pq_evidence_verifier || "OpenSSL"}로 검사함.`);
  methods.push("검증 환경과 처리 이력은 붙임 2와 같음.");
  methods.forEach((text, i) => r.item(ga(i), text));

  r.numHead("2. 검증 고찰");
  let i = 0;
  for (const text of observations(item, f)) {
    if (text === "SIGNATURE_TABLE") { r.ensure(330); r.item(ga(i++), "활성 Manifest의 서명 정보는 다음과 같음.", {after:8}); r.kv(signatureRows(item), {labelW:0.2, size:18, indent:52}); continue; }
    r.item(ga(i++), text);
  }
  if (showImage) r.item(ga(i++), showCompare ? "서명 당시 Manifest에 저장된 썸네일과 현재 검증물 화면은 붙임 3과 같음." : "검증물 화면은 붙임 3과 같음.");
  r.item(ga(i++), "검증 과정에서 보고된 상태 코드 전체는 붙임 1과 같음.");

  r.numHead("3. 검증 결과");
  const results = [`검증사항 1 : 검증물에는 C2PA 출처 기록이 ${manifestCount(item) ? `있음(Manifest ${manifestCount(item)}개).` : "없음."}`,
    `검증사항 2 : ${changeConclusion(item, f, op)}`, `검증사항 3 : ${trustConclusion(item, f)}`];
  if (pq.present) results.push(`검증사항 4 : ${pqConclusion(pq)}`);
  results.forEach((text, j) => r.item(ga(j), text));

  r.numHead("4. 비고");
  const remarks = notes(item, f);
  remarks.push(DECLARED_NOTE, ...identityRemarks(options), issuanceRemark(meta));
  remarks.push(`검증 기록 원본(verification-record.json)과 발급 기록(issuance-record.json)을 이 문서에 전자 첨부함. 기록 스냅샷 SHA-256은 ${meta.snapshotHash || "계산 불가"}임.`);
  remarks.push("본 문서는 연구용 도구(PQ-C2PA Viewer)로 작성한 것으로, 공인 감정서 또는 KOLAS 인정 시험성적서가 아님.");
  remarks.forEach((text, j) => r.item(ga(j), text));

  const annexes = ["검증 상태 코드 목록 1부.", "검증 환경 및 처리 이력 1부."];
  if (showImage) annexes.push("검증물 화면 1부.");
  r.space(16); r.ensure(annexes.length * 36 + 270);
  annexes.forEach((text, j) => r.item(j ? "" : "붙임", `${j + 1}. ${text}${j === annexes.length - 1 ? "  끝." : ""}`, {level:0, markW:76, after:2}));

  r.signatures({date:meta.issuedDot, org:orgName(options), signers:[["신 청 인", options.applicant], ["접 수 자", ""]]});
  if (!ctx.composite) { r.space(6); drawIssuance(r, meta, options); }

  r.annexHead("붙임 1", "검증 상태 코드 목록", {page:"auto", keep:200});
  const counts = f.counts;
  const note = `공식 SDK가 보고한 상태 코드 원문과 그 내용(통과 ${counts.success}건, 참고 ${counts.informational}건, 실패 ${counts.failure}건)`;
  const rows = checkRows(item);
  if (rows.length) r.grid(checkCols, rows, {note}); else r.para(`${note}. 보고된 상태 코드 없음.`, {size:19, family:SANS});

  r.annexHead("붙임 2", "검증 환경 및 처리 이력", {keep:300});
  r.kv(environmentRows(item, env), {labelW:0.2, size:18});
  r.grid(historyCols, historyRows(item, meta));

  if (showImage) {
    r.annexHead("붙임 3", "검증물 화면", {keep:showCompare ? 470 : 520});
    if (showCompare) {
      r.figure([[manifestThumb, "서명 당시 썸네일(Manifest)"], [currentImage, "현재 검증물"]], "서명 당시 썸네일과 현재 검증물", {maxH:330, keepAfter:80});
      r.para("썸네일은 서명으로 보호되는 Manifest 안에 저장된 이미지로, 서명 당시의 모습을 나타냄. 차이가 있는 영역은 검증자가 직접 확인하여 기재하며, 이 비교만으로 변경 수단을 특정할 수 없음.", {size:18, family:SANS, color:C.muted});
    } else r.figure([[preview, "검증물"]], "검증물(축소)", {maxH:420});
  }
}

function technicalReport(r, item, ctx) {
  const {meta, options, env, preview, manifestThumb, currentImage, composite, m0Thumb} = ctx, f = facts(item), op = opinion(item, f), pq = pqEvidence(item), n = manifestCount(item);
  const annexes = [
    ["분석 대상 및 환경", annexTarget], ["C2PA 기록 구조", annexStructure, n > 0], ["검증 상태 코드", annexCodes],
    ["제작·편집 이력 및 재료", annexHistory, n > 0], ["콘텐츠 비교", annexCompare, Boolean((manifestThumb && currentImage) || preview)],
    ["서명 알고리즘 및 양자내성 평가", annexPq], ["파일 메타데이터", annexMeta], ["평가 방법 및 한계", annexMethod], ["참고 기준", annexRefs],
  ].filter(([, , show = true]) => show).map(([label, fn], i) => ({no:i + 1, label, fn}));
  const annexNo = label => annexes.find(a => a.label === label)?.no;

  r.title(TYPES.technical.title, "C2PA Provenance and Integrity Analysis", {after:12});
  const purpose = typed(options.purpose) ? declared(options.purpose) : "C2PA 출처 기록의 존재, 서명·파일 결합의 유효성, 서명자 신뢰 여부 확인";
  r.kv([
    ["1. 신청인", requesterText(options)],
    ["2. 분석 목적", purpose],
    ["3. 분석 대상", `${filled(item.filename)} (${fileLine(item)})\nSHA-256 : ${filled(item.sha256)}`],
    ["4. 분석 일시", period(item.created_at, meta.issued)],
    ["5. 분석 방법", `C2PA 기술 사양${specVersion(item) ? ` ${specVersion(item)}` : ""} 제15장(검증), 의견 표현 SWGDE 18-I-001, P1 서명 NIST FIPS 204`],
    ["6. 분석 환경", `${item.processing_mode === "browser" ? "브라우저 검증" : "로컬 서버 검증"}, ${engineKo(item, env)}, 신뢰 기준 ${trustKo(item)}`],
  ], {labelW:0.17, size:18, labelAlign:"left", padY:6});
  r.grid(resultCols, resultRows(item, f), {padY:5, caption:`7. 분석 결과${annexNo("검증 상태 코드") ? ` (상태 코드 전체는 별첨 ${annexNo("검증 상태 코드")})` : ""}`});
  r.subHead("8. 의견 및 해석", 110);
  r.para(`※ 아래는 분석 결과에 근거한 의견으로, 결과와 구분하여 기재함(KS Q ISO/IEC 17025 7.8.7). 명제와 척도는 별첨 ${annexNo("평가 방법 및 한계")} 참조.`, {size:17, family:SANS, color:C.muted, after:4});
  r.item("가.", `의견 : ${op.level}`, {level:1, size:20, family:SANS});
  r.item("나.", op.statement, {level:1, size:20, family:SANS, after:12});
  r.confirmRow([["신청인", signedName(options.applicant)], ["확인자", ""]]);
  [DECLARED_NOTE, "이 분석서의 결과는 제시된 파일에 한정되며, 연구용 도구가 생성한 문서로 KOLAS 인정 시험성적서 또는 공인 감정서가 아님."]
    .forEach(text => r.item("※", text, {level:0, size:15, family:SANS, color:C.muted, after:1}));
  r.space(6);
  if (!composite) drawIssuance(r, meta, options, {compact:true});
  r.center(meta.issuedLong, {size:20, color:C.ink, after:2, squeeze:true});
  if (orgName(options)) r.center(orgName(options), {size:22, color:C.ink, after:4, squeeze:true});

  for (const annex of annexes) annex.fn(r, annex);
  r.space(12); r.center("- 이하 여백 -", {squeeze:true});

  function annexTarget(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label, {page:true});
    r.subHead("가. 분석 대상"); r.kv(identityRows(item), {size:18});
    r.subHead("나. 분석 환경"); r.kv(environmentRows(item, env), {size:18});
    r.subHead("다. 처리 이력"); r.grid(historyCols, historyRows(item, meta));
    r.para("분석은 업로드된 작업 사본으로 수행하였으며, 파일을 수정하지 않음.", {size:18, family:SANS, color:C.muted});
  }
  function annexStructure(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    r.subHead("가. 활성 Manifest 서명 정보");
    r.kv([["활성 Manifest", filled(item.store?.active_manifest, "없음"), {mono:true}], ["Manifest 수", `${n}개`], ...signatureRows(item),
      ["AI 생성 선언", item.ai === "declared" ? "Manifest에 선언됨" : "확인 가능한 선언 없음"]], {size:18});
    r.subHead("나. Manifest 목록", 130);
    r.grid([{title:"Manifest 식별자", w:0.36, mono:true}, {title:"구분", w:0.1, align:"center"}, {title:"생성 도구", w:0.2}, {title:"서명자 / 알고리즘", w:0.22}, {title:"Assertion", w:0.12, align:"center"}],
      Object.entries(item.store?.manifests || {}).map(([label, m]) => [label, label === item.store?.active_manifest ? "활성" : "이전",
        filled((m.claim_generator_info || []).map(agent).join(", ") || m.claim_generator, "—"),
        `${filled(m.signature_info?.common_name, "—")} / ${filled(m.signature_info?.alg, "—")}`, `${(m.assertions || []).length}건`]), {size:17});
    const labels = (activeManifest(item).assertions || []).map(x => x.label).filter(Boolean);
    if (labels.length) { r.subHead("다. 활성 Manifest의 Assertion", 100); r.grid([{title:"순번", w:0.08, align:"center"}, {title:"Assertion 레이블", w:0.92, mono:true}], labels.map((label, i) => [String(i + 1), label]), {size:17}); }
  }
  function annexCodes(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    const note = `공식 SDK가 보고한 상태 코드 원문과 그 내용(통과 ${f.counts.success}건, 참고 ${f.counts.informational}건, 실패 ${f.counts.failure}건)`;
    const rows = checkRows(item);
    if (rows.length) r.grid(checkCols, rows, {note}); else r.para(`${note}. 보고된 상태 코드 없음.`, {size:19, family:SANS});
  }
  function annexHistory(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    r.subHead("가. 제작·편집 이력");
    if ((item.actions || []).length) r.grid(actionCols, actionRows(item), {size:17}); else r.para("Manifest에 기록된 작업 이력 없음.", {size:19, family:SANS});
    r.subHead("나. 재료(Ingredient)");
    const ings = item.ingredients || [];
    if (ings.length) r.grid([{title:"제목", w:0.3}, {title:"관계", w:0.14, align:"center"}, {title:"형식", w:0.16, align:"center"}, {title:"연결 Manifest", w:0.4, mono:true}],
      ings.map(ing => [filled(ing.title, "—"), filled(ing.relationship, "—"), filled(ing.format, "—"), filled(ing.active_manifest || ing.manifest, "—")]), {size:17});
    else r.para("기록된 재료 없음. 재료가 기록되지 않았다고 실제 제작 과정에 재료가 없었다고 단정할 수 없음.", {size:19, family:SANS});
  }
  function annexCompare(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    if (composite && m0Thumb && manifestThumb && currentImage) {
      r.figure([[m0Thumb, "원본 기록(M0) 썸네일"], [manifestThumb, "변환본 기록(M1) 썸네일"], [currentImage, "현재 파일"]], "원본 기록, 변환본 기록의 썸네일과 현재 파일", {maxH:260, keepAfter:60});
      r.para("두 썸네일은 각각 원본(M0)과 변환본(M1)의 서명으로 보호되는 Manifest 안에 저장된 이미지로, 각 서명 당시의 모습을 나타냄.", {size:18, family:SANS, color:C.muted});
    } else if (manifestThumb && currentImage) {
      r.figure([[manifestThumb, "서명 당시 썸네일(Manifest)"], [currentImage, "현재 파일"]], "서명 당시 썸네일과 현재 파일", {maxH:330, keepAfter:80});
      r.para(f.bindBad.length ? "파일 데이터 해시가 서명 당시와 다르므로, 서명으로 보호되는 Manifest 썸네일과 현재 파일을 나란히 표시함. 차이가 있는 영역은 분석자가 직접 확인하여 기재하며, 이 비교만으로 변경 수단을 특정할 수 없음." : "서명으로 보호되는 Manifest 썸네일과 현재 파일을 나란히 표시함.", {size:18, family:SANS, color:C.muted});
    } else {
      r.figure([[preview, "분석 대상"]], "분석 대상(축소)", {maxH:380});
      if (f.bindBad.length) r.para("서명 당시 썸네일 또는 현재 파일 이미지를 불러오지 못해 나란히 비교하지 않음.", {size:18, family:SANS, color:C.muted});
    }
  }
  function annexPq(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    const rows = pqRows(item);
    r.subHead("가. 서명 알고리즘");
    if (rows.length) r.grid(pqCols, rows, {size:17}); else r.para("검증할 서명이 없어 평가하지 않음.", {size:19, family:SANS});
    if (composite) { r.para("P1 증거의 상세 내용, 원본·변환본 연결 검증과 양자내성 해석은 제1편 PQ 변환 확인서 참조.", {size:18, family:SANS, color:C.muted}); return; }
    r.subHead("나. 양자내성 보조 서명(P1)", 120);
    if (pq.present) {
      r.kv([["검사 결과", PQ_STATUS[pq.status] || pq.status, {bold:true}], ["사유", terse(pq.reason || "—")], ["스키마", filled(pq.schema)], ["서명 알고리즘", filled(pq.signature_algorithm)],
        ["페이로드 SHA3-256", filled(pq.payload_sha3_256), {mono:true}],
        ["페이로드 해시 일치", pq.payload_hash_valid === true ? "일치" : pq.payload_hash_valid === false ? "불일치" : "확인하지 않음"],
        ["원본 M0 Manifest", filled(pq.m0_active_manifest), {mono:true}], ["원본 파일 SHA3-256", filled(pq.source_file_sha3_256), {mono:true}],
        ["P1 생성 시각", pq.created_at ? stamp(pq.created_at) : "정보 없음"], ["P1 공개키 SHA-256", filled(pq.public_key_sha256), {mono:true}],
        ["P1 서명 크기", pq.signature_bytes ? `${pq.signature_bytes.toLocaleString("ko-KR")} B` : "정보 없음"]], {labelW:0.24, size:18});
    } else r.para("PQ-C2PA P1(ML-DSA-65) 증거 없음.", {size:19, family:SANS});
    r.subHead("다. 표준화 현황", 200);
    ["C2PA 사양 2.4는 ML-DSA(FIPS 204)를 향후 지원 알고리즘으로만 언급하므로, P1은 사용자 정의 Assertion(org.pq-c2pa.p1)으로 기록한 실험적 확장임.",
      "증거 파일을 다시 서명하면 파일이 바뀌어 동일성이 깨지므로, 원본 M0 기록은 재료(Ingredient)로 보존하고 새 M1에 P1을 연결함.",
      "ML-DSA 인증서 형식은 IETF RFC 9881로 표준화됨."].forEach((text, i) => r.item(`${i + 1})`, text, {level:2, size:19, family:SANS}));
    r.grid([{title:"알고리즘", w:0.4}, {title:"공개키 크기(B)", w:0.3, align:"center"}, {title:"서명 크기(B)", w:0.3, align:"center"}],
      [["ES256 (ECDSA P-256)", "65", "64"], ["ML-DSA-44", "1,312", "2,420"], ["ML-DSA-65", "1,952", "3,309"], ["ML-DSA-87", "2,592", "4,627"]], {size:17, caption:"서명 알고리즘별 크기(FIPS 204)", numbered:true});
  }
  function annexMeta(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    const info = item.image_info || {};
    r.kv([["형식", filled(info.format || item.mime)], ["색상 모드", filled(info.mode)], ["ICC 프로필", info.has_icc_profile ? "있음" : "없음 또는 확인 불가"],
      ["GPS 정보", info.gps_present ? "있음(개인정보 보호를 위해 좌표 미표시)" : "없음 또는 확인 불가"],
      ...Object.entries(info.metadata || {}).slice(0, 20).map(([k, v]) => [safe(k, 80), filled(v)])], {size:18});
    r.para("일반 메타데이터(EXIF 등)는 C2PA 서명으로 보호되지 않을 수 있으므로 서명된 Assertion과 구분하여 해석함.", {size:18, family:SANS, color:C.muted});
  }
  function annexMethod(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    r.subHead("가. 명제");
    r.kv([["H1", "현재 파일과 C2PA 기록은 서명 이후 변경되지 않았으며, 기록은 서명자가 서명한 그대로임."], ["H2", "현재 파일 또는 C2PA 기록이 서명 이후 변경되었음."]], {labelW:0.1, size:18});
    r.subHead("나. 의견 척도", 200);
    r.grid([{title:"해당", w:0.08, align:"center"}, {title:"척도", w:0.24}, {title:"의미", w:0.68}], OPINION_SCALE.map(([level, desc]) => [level === op.level ? "●" : "", {text:level, bold:level === op.level}, desc]), {size:17});
    r.para("결과는 수치 확률이 아닌 단계형 의견으로 표현함(SWGDE 18-I-001).", {size:17, family:SANS, color:C.muted});
    r.subHead("다. 의견의 근거");
    op.basis.forEach((text, i) => r.item(`${i + 1})`, `${text}.`.replace(/\.\.$/, "."), {level:2, size:19, family:SANS}));
    r.subHead("라. 특기사항");
    notes(item, f).forEach((text, i) => r.item(`${i + 1})`, text, {level:2, size:19, family:SANS}));
    r.subHead("마. 한계");
    limitations().forEach((text, i) => r.item(`${i + 1})`, text, {level:2, size:19, family:SANS}));
    r.subHead("바. 정보의 출처");
    r.grid([{title:"구분", w:0.16}, {title:"항목", w:0.46}, {title:"확인 방법", w:0.38}], [
      ["시스템 확인", "파일 해시, C2PA 검증 결과·상태 코드, P1 서명, 검증 시각, 도구 버전", "공식 C2PA SDK와 OpenSSL로 직접 계산·검사"],
      ["서버 발급", "문서번호, 확인번호, 발급 시각, PDF 등록 해시", meta.issuance ? "발급 서버가 부여하고 발급 기록을 ML-DSA-65로 서명" : "미등록(작성자 PC에서 생성)"],
      ["신청인 기재(*)", "신청인 이름, 제출처, 확인 요청 사항", "확인하지 않음"],
      ["신청인 확인(선택)", "신청인 휴대폰 번호", identityOf(options).phone ? "문자 인증번호 확인, 발급 기록에 남김" : "사용하지 않음"],
    ], {size:17});
  }
  function annexRefs(r, a) {
    r.annexHead(`별첨 ${a.no}`, a.label);
    REFERENCES.forEach(([text, url], i) => r.item(`[${i + 1}]`, `${text}${url ? `\n${url}` : ""}`, {level:0, size:16, family:SANS, after:4, markW:46}));
  }
}


// ---------- PQ converted asset ----------
// What the converted file (M1) says about its original (M0): the P1 payload names the
// M0 manifest and the original file hash, and M1 keeps M0 as a parentOf ingredient.
function m0Info(item, conversion) {
  const pq = pqEvidence(item), manifests = item.store?.manifests || {}, ings = item.ingredients || [];
  const label = pq.m0_active_manifest || ings.find(i => i.relationship === "parentOf")?.active_manifest || "";
  const manifest = manifests[label] || null, ingredient = ings.find(i => i.active_manifest === label) || null;
  const actions = (manifest?.assertions || []).filter(a => String(a.label || "").startsWith("c2pa.actions")).flatMap(a => a.data?.actions || []);
  return {pq, label, manifest, ingredient, actions, sig:manifest?.signature_info || {}, src:conversion?.source || {}, job:conversion || null,
    tool:(manifest?.claim_generator_info || []).map(agent).filter(Boolean).join(", ") || manifest?.claim_generator || ""};
}
const hasP1 = item => pqEvidence(item).present === true;

function linkRows(item, f, m) {
  const pq = m.pq, deltas = checksOf(item).filter(c => c.scope && !["activeManifest", "legacy"].includes(c.scope));
  const deltaFail = deltas.filter(c => c.kind === "failure"), linked = Boolean(m.label && m.manifest && m.ingredient);
  const srcHash = m.src.file_sha3_256, srcMatch = srcHash && srcHash === pq.source_file_sha3_256;
  const rows = [
    ["P1 서명", "ML-DSA-65 공개키 검증(FIPS 204)", PQ_STATUS[pq.status] || pq.status, pq.status === "VALID" ? "통과" : pq.status === "INVALID" ? "실패" : "미수행"],
    ["P1 내용 무결성", "정규화 JSON의 SHA3-256 대조", pq.payload_hash_valid === true ? "일치" : pq.payload_hash_valid === false ? "불일치" : "확인하지 않음",
      pq.payload_hash_valid === true ? "통과" : pq.payload_hash_valid === false ? "실패" : "미수행"],
    ["원본 기록 연결", "P1의 M0 식별자와 M1 재료 Manifest 대조", linked ? "일치" : m.label ? "재료에서 찾지 못함" : "식별자 없음", linked ? "통과" : "실패"],
    ["원본 기록 보존", "M1 재료 검증(ingredient.*)", deltaFail.length ? `실패(${codeList(deltaFail)})` : deltas.length ? "재료 Manifest 검증 통과" : m.ingredient ? "재료 기록 있음" : "재료 없음",
      deltaFail.length ? "실패" : deltas.length ? "통과" : m.ingredient ? "참고" : "실패"],
    ["변환본 서명", "claimSignature.validated", f.sigOk ? "유효" : "유효하지 않음", f.sigOk ? "통과" : "실패"],
    ["변환본 파일 결합", "assertion.dataHash.match", f.bindBad.length ? "서명 당시와 다름" : f.bindOk.length ? "서명 당시와 일치" : "결과 없음", f.bindBad.length ? "실패" : f.bindOk.length ? "통과" : "—"],
    ["변환본 서명자", "signingCredential.trusted", f.trusted ? `연결됨${item.trust_profile === "lab" ? "(프로젝트 CA 기준)" : ""}` : "연결되지 않음", f.trusted ? "확인" : "미확인"],
    ["원본 파일 대조", "원본 SHA3-256과 P1 기록값 대조", srcHash ? (srcMatch ? "일치(변환 기록)" : "불일치") : "원본 파일 제출 시 대조 가능", srcHash ? (srcMatch ? "통과" : "실패") : "해당 없음"],
    ["변환 당시 원본 상태", "P1의 m0_validation_state", pq.m0_validation_state ? STATES[pq.m0_validation_state]?.label || pq.m0_validation_state : "기록 없음", "참고"],
  ];
  return rows;
}
function pqVerdict(item, rows) {
  const pq = pqEvidence(item), failed = rows.filter(row => row[3] === "실패").map(row => row[0]);
  if (failed.length) return `연결 검증에서 실패 항목(${failed.join(", ")})이 확인되어, 변환본의 원본 연결과 양자내성 증거를 신뢰할 수 없음.`;
  if (pq.status === "UNVERIFIED") return "P1 서명을 검사하지 못하여 양자내성 연결 여부를 판단할 수 없음. OpenSSL 3.5 이상 환경에서 다시 검증해야 함.";
  if (pq.status === "VALID") return "변환본은 원본 C2PA 기록(M0)을 보존한 상태로 양자내성 증거(P1)가 연결된 파일로 확인됨. P1의 ML-DSA-65 서명과 변환본의 C2PA 서명·파일 결합이 모두 유효함.";
  return "양자내성 증거의 상태를 판단할 수 없음.";
}

function pqConversionReport(r, item, ctx) {
  const {options} = ctx, f = facts(item), m = m0Info(item, options.conversion), pq = m.pq, sig = item.signature || {};
  r.title("양자내성(PQ) 변환 확인서", "PQ-C2PA  M0 → P1 (ML-DSA-65) → M1", {after:18});
  const delta = Number.isFinite(m.src.size_bytes) && Number.isFinite(item.size) ? item.size - m.src.size_bytes : null;
  r.kv([
    ["1. 신청인", requesterText(options)],
    ["2. 변환본(M1)", `${filled(item.filename)} (${fileLine(item)})\nSHA-256 : ${filled(item.sha256)}`],
    ["3. 원본(M0)", `${filled(m.src.filename || m.ingredient?.title, "파일명 기록 없음")}${m.src.size_bytes ? ` (${m.src.size_bytes.toLocaleString("ko-KR")} B)` : ""}\nSHA3-256 : ${filled(pq.source_file_sha3_256)}`],
    ["4. 변환 일시", `${pq.created_at ? stamp(pq.created_at) : "기록 없음"} (P1 생성)${m.job?.conversion_id ? `\n변환 작업 번호 : ${m.job.conversion_id}` : ""}`],
    ["5. 변환 방식", "원본 C2PA 기록(M0)을 재료로 보존하고, 원본 기록 식별자와 원본 파일 해시를 ML-DSA-65로 서명한 P1 증거를 새 C2PA 기록(M1)에 담아 서명"],
    ["6. 변환 도구", `${filled(softwareName(item), "기록 없음")}, P1 검사 ${item.pq_evidence?.verifier || "도구 정보 없음"}`],
  ], {labelW:0.17, size:18, labelAlign:"left", padY:8});
  r.flow([
    {tag:"M0 원본 기록", title:filled(m.sig.common_name, "원본 서명자"), lines:[`${String(m.sig.alg || "").toUpperCase() || "알고리즘 미확인"} 서명`, `도구 ${filled(m.tool, "미기재")}`, "M1의 재료(parentOf)로 보존"]},
    {tag:"P1 양자내성 증거", title:"ML-DSA-65 (FIPS 204)", lines:["M0 식별자, 원본 SHA3-256,", "생성 시각을 서명", pq.signature_bytes ? `서명 ${pq.signature_bytes.toLocaleString("ko-KR")} B` : "서명 크기 미확인"]},
    {tag:"M1 변환본 기록", title:filled(sig.common_name, "변환본 서명자"), lines:[`${String(sig.alg || "").toUpperCase() || "알고리즘 미확인"} 서명`, "P1을 Assertion으로 포함", "파일 결합(dataHash) 서명"]},
  ], "PQ 변환 구조");

  r.grid([{title:"구분", w:0.17}, {title:"원본(M0)", w:0.415}, {title:"변환본(M1)", w:0.415}], [
    ["파일명", filled(m.src.filename || m.ingredient?.title, "기록 없음"), filled(item.filename)],
    ["크기", m.src.size_bytes ? bytes(m.src.size_bytes) : "변환 기록 없음", `${bytes(item.size)}${delta !== null ? `\n원본 대비 ${delta >= 0 ? "+" : ""}${delta.toLocaleString("ko-KR")} B` : ""}`],
    ["SHA-256", m.src.file_sha256 ? {text:m.src.file_sha256, mono:true} : "변환 기록 없음", {text:filled(item.sha256), mono:true}],
    ["SHA3-256", pq.source_file_sha3_256 ? {text:pq.source_file_sha3_256, mono:true} : "기록 없음", item.sha3_256 ? {text:item.sha3_256, mono:true} : "정보 없음"],
    ["활성 Manifest", m.label ? {text:m.label, mono:true} : "확인되지 않음", {text:filled(item.store?.active_manifest), mono:true}],
    ["서명자", filled(m.sig.common_name, "확인되지 않음"), filled(sig.common_name, "확인되지 않음")],
    ["서명 알고리즘", algLabel(m.sig.alg), algLabel(sig.alg)],
    ["기록된 작업", m.actions.length ? m.actions.map(a => ACTION_KO[a.action] || a.action).join(", ") : "기록 없음", (item.actions || []).length ? item.actions.map(a => ACTION_KO[a.action] || a.action).join(", ") : "기록 없음"],
    ["양자내성 서명", "없음", `P1 ML-DSA-65 (${PQ_STATUS[pq.status] || pq.status})`],
    ["검증 상태", `${pq.m0_validation_state ? STATES[pq.m0_validation_state]?.label || pq.m0_validation_state : "기록 없음"}(변환 당시)`, `${stateOf(item).label}(이번 검증)`],
  ], {size:17, padY:7, caption:"7. 원본·변환본 대조"});

  const rows = linkRows(item, f, m);
  r.grid([{title:"번호", w:0.07, align:"center"}, {title:"확인 항목", w:0.19}, {title:"확인 방법", w:0.32}, {title:"결과", w:0.27}, {title:"판정", w:0.15, align:"center"}],
    rows.map((row, i) => [String(i + 1), ...row.slice(0, 3), {text:row[3], bold:row[3] === "실패"}]), {size:17, padY:7, caption:"8. 원본 연결 및 양자내성 증거 검증"});

  const classical = alg => { const info = algInfo(alg); return info ? !info.pq : Boolean(alg); };
  const rule = alg => classical(alg) ? "2030년 이후 사용 자제, 2035년 이후 사용 금지" : "양자내성 표준";
  r.grid([{title:"서명", w:0.16}, {title:"알고리즘", w:0.23}, {title:"보호 대상", w:0.28}, {title:"양자내성", w:0.1, align:"center"}, {title:"NIST IR 8547 기준", w:0.23}], [
    ["원본 서명(M0)", algLabel(m.sig.alg), "원본 기록", classical(m.sig.alg) ? "없음" : "있음", rule(m.sig.alg)],
    ["P1 증거", "ML-DSA-65 (FIPS 204)", "원본 기록 식별자, 원본 파일 해시, 생성 시각", "있음", "양자내성 표준"],
    ["변환본 서명(M1)", algLabel(sig.alg), "변환본 기록 전체(P1 포함), 파일 결합", classical(sig.alg) ? "없음" : "있음", rule(sig.alg)],
  ], {size:17, padY:7, caption:"9. 양자내성 평가"});
  [
    "P1은 원본 기록 식별자와 원본 파일 SHA3-256을 ML-DSA-65로 서명하므로, 향후 ECDSA 서명을 신뢰할 수 없게 되더라도 원본 파일·원본 기록과 이 증거의 대응 관계를 양자내성 서명으로 확인할 수 있음.",
    classical(sig.alg) ? `변환본(M1)의 외곽 서명과 파일 결합은 ${String(sig.alg).toUpperCase()}에 의존하므로, 변환본 기록 전체의 장기 보호에는 ML-DSA 기반 C2PA 서명 또는 문서 재서명이 추가로 필요함.` : "변환본(M1)의 외곽 서명도 양자내성 알고리즘으로 서명됨.",
    `P1 공개키는 인증서 체계(PKI)로 발급자가 확인되지 않으므로, 공개키 지문(SHA-256 ${pq.public_key_sha256 || "기록 없음"})을 변환 기관이 공시한 값과 별도로 대조해야 함.`,
    "C2PA 2.4 사양은 ML-DSA를 서명 알고리즘으로 아직 채택하지 않았으므로 P1은 사용자 정의 Assertion(org.pq-c2pa.p1)이며, 일반 C2PA 검증 도구는 P1을 해석하지 않음.",
  ].forEach((text, i) => r.item(ga(i), text, {level:1, size:19, family:SANS}));

  r.subHead("10. 의견 및 해석", 110);
  r.para("※ 아래는 위 검증 결과에 근거한 의견으로, 결과와 구분하여 기재함(KS Q ISO/IEC 17025 7.8.7).", {size:17, family:SANS, color:C.muted, after:4});
  r.item("가.", pqVerdict(item, rows), {level:1, size:20, family:SANS, after:12});
  r.confirmRow([["신청인", signedName(options.applicant)], ["확인자", ""]]);
}

function pqCompositeReport(r, item, ctx) {
  const {meta, options} = ctx, m = m0Info(item, options.conversion);
  r.title(TYPES.pq.title, "PQ-C2PA Converted Asset · Provenance Verification Report", {after:26});
  r.kv([
    ["문서번호", `${meta.docNo}${meta.issuance ? "" : " (미등록)"}`, {mono:true}], ["발급 시각", `${meta.issuedText}${meta.issuance ? ", 발급 서버 시각" : ""}`],
    ["신청인", requesterText(options)],
    ["변환본(M1)", `${filled(item.filename)}\nSHA-256 : ${filled(item.sha256)}`],
    ["원본(M0)", `${filled(m.src.filename || m.ingredient?.title, "파일명 기록 없음")}\nSHA3-256 : ${filled(m.pq.source_file_sha3_256)}`],
    ["검증 결과", `C2PA ${stateOf(item).label}, P1 양자내성 증거 ${PQ_STATUS[m.pq.status] || m.pq.status}`, {bold:true}],
  ], {labelW:0.18});
  r.subHead("목 차"); r.ensure(300);
  const tocPage = r.pageNo(), tocY = r.cursor();
  r.space(300);
  [`각 편은 같은 검증 기록(기록 스냅샷 SHA-256 ${meta.snapshotHash ? `${meta.snapshotHash.slice(0, 16)}…` : "—"})으로 작성됨.`,
    `전자 첨부: verification-record.json(변환본 검증 기록), issuance-record.json(발급 기록)${m.job ? ", conversion-record.json(변환 작업 기록)" : ""}.`,
    DECLARED_NOTE].forEach(text => r.item("※", text, {level:0, size:17, family:SANS, color:C.muted, after:2}));
  r.space(10);
  drawIssuance(r, meta, options);
  r.center(meta.issuedLong, {size:21, color:C.ink, after:4});
  if (orgName(options)) r.center(orgName(options), {size:23, color:C.ink});

  const parts = [
    ["제1편", "PQ 변환 확인서", "원본·변환본 대조, M0–P1–M1 연결 검증, 양자내성 평가", () => pqConversionReport(r, item, ctx)],
    ["제2편", "일반인용 요약서", "1쪽 결과 요약", () => summaryReport(r, item, ctx)],
    ["제3편", "경찰서 제출용 검증서", "국과수 디지털 감정서 서식", () => { r.setSerif(true); submissionReport(r, item, ctx); r.setSerif(false); }],
    ["제4편", "상세 분석서", "KS Q ISO/IEC 17025 7.8 시험성적서 형식", () => technicalReport(r, item, ctx)],
  ];
  const starts = parts.map(([tag, label, , run]) => { r.pageBreak(); const page = r.pageNo(); r.partLabel(tag, label); run(); return page; });
  r.at(tocPage, tocY, () => r.grid([{title:"편", w:0.11, align:"center"}, {title:"제목", w:0.27}, {title:"내용·서식 기준", w:0.48}, {title:"쪽", w:0.14, align:"center"}],
    parts.map(([tag, label, basis], i) => [tag, label, basis, String(starts[i])]), {size:18}));
}

// ---------- entry ----------
// Values sent to the issuance server: hashes and the result summary only. Names, case
// numbers and the request text stay in the browser; only their SHA-256 is registered.
function declaredValues(options) {
  return Object.fromEntries(Object.entries(DECLARED_KEYS).map(([key, field]) => [field, typed(options[key])]).filter(([, value]) => value));
}
export async function prepareIssuance(item, reportType, options = {}) {
  const record = recordSnapshot(item), values = declaredValues(options), pq = pqEvidence(item);
  const hex64 = value => /^[0-9a-f]{64}$/.test(String(value || "")) ? value : null;
  return {
    report_type:TYPES[reportType] ? reportType : "technical",
    snapshot_sha256:await sha256Hex(stableStringify(record)),
    declared_sha256:await sha256Hex(stableStringify(values)),
    declared_fields:Object.keys(values),
    verification_id:/^[0-9a-f]{32}$/.test(String(item.id || "")) && item.report_saved !== false ? item.id : null,
    file:{sha256:hex64(item.sha256) || "0".repeat(64), sha3_256:hex64(item.sha3_256), size:Number.isFinite(item.size) ? item.size : 0, mime:safe(item.mime, 120)},
    result:{state:STATES[item.state] ? item.state : "Unknown", manifest_count:manifestCount(item), pq_status:PQ_STATUS[pq.status] ? pq.status : "NOT_PRESENT",
      trust_profile:item.trust_profile === "lab" ? "lab" : "standard", processing_mode:item.processing_mode === "browser" ? "browser" : "server"},
    phone_token:options.phoneToken || null,
  };
}

export async function buildPdfReport(source, reportType = "technical", options = {}) {
  const type = TYPES[reportType] ? reportType : "technical", spec = TYPES[type];
  const issuance = options.issuance && !options.issuance.offline && options.issuance.doc_no ? options.issuance : null;
  const record = recordSnapshot(source), recordJson = JSON.stringify(record, null, 2);
  const snapshotHash = await sha256Hex(stableStringify(record));
  // Browser verification does not fingerprint the P1 public key; compute it the same way as the server.
  let item = source;
  const p1 = pqEvidence(source);
  if (p1.present && !p1.public_key_sha256 && p1.public_key_pem) item = {...source, pq_evidence:{...p1, public_key_sha256:await sha256Hex(p1.public_key_pem)}};
  if (type === "pq" && !hasP1(item)) throw new Error("PQ 변환본 보고서는 P1 양자내성 증거가 있는 변환본에서만 만들 수 있습니다.");
  // Issue time and number come from the server; without it the PC clock is used and marked.
  const server = issuance ? isoParts(issuance.issued_at) : null;
  const issued = server ? new Date(issuance.issued_at) : new Date();
  const day = `${issued.getFullYear()}${pad(issued.getMonth() + 1)}${pad(issued.getDate())}`;
  const docNo = issuance ? issuance.doc_no : `PQC-${spec.code}-${day}-L${(snapshotHash || "00000000").slice(0, 7).toUpperCase()}`;
  const meta = {docNo, kind:spec.kind, issued, snapshotHash, page:spec.page, serif:type === "submission", issuance,
    offlineReason:options.issuance?.offline ? safe(options.issuance.reason || "", 120) : options.register === false ? "작성자가 등록하지 않음" : "",
    issuedText:server ? server.text : `${stamp(issued)}, 작성자 PC 시각`, issuedDot:server ? server.dot : dotDate(issued), issuedLong:server ? server.long : longDate(issued),
    headerLeft:`문서번호 : ${docNo}`, headerRight:orgName(options) || "PQ-C2PA Viewer",
    footerLeft:issuance ? `확인번호 ${issuance.verification_code}` : `미등록 발급 · 기록 스냅샷 SHA-256 ${snapshotHash ? `${snapshotHash.slice(0, 24)}…` : "—"}`,
    footerRight:`PQC-F-${spec.code} · A4(210×297)`};
  const includePreview = options.includePreview !== false;
  const isImage = String(item.mime || "").startsWith("image/");
  const currentImage = includePreview && isImage ? await loadImage(options.currentImageUrl) : null;
  const manifestThumbUrl = item.manifest_thumbnails?.[item.store?.active_manifest];
  const manifestThumb = includePreview ? await loadImage(manifestThumbUrl) : null;
  const preview = includePreview ? (currentImage || await loadImage(item.thumbnail)) : null;
  const m0Thumb = includePreview && type === "pq" ? await loadImage(item.manifest_thumbnails?.[pqEvidence(item).m0_active_manifest]) : null;
  const r = createRenderer(meta);
  const context = {meta, options, env:options.environment || null, preview, currentImage, manifestThumb, m0Thumb, composite:type === "pq"};
  if (type === "summary") summaryReport(r, item, context);
  else if (type === "submission") submissionReport(r, item, context);
  else if (type === "pq") pqCompositeReport(r, item, context);
  else technicalReport(r, item, context);
  const pages = r.finish();

  const doc = await PDFDocument.create();
  doc.setTitle(`${spec.title} · ${safe(item.filename, 120)}`);
  doc.setSubject(`C2PA ${spec.kind} · 문서번호 ${docNo}`);
  doc.setAuthor(typed(options.applicant) || "PQ-C2PA Viewer");
  doc.setKeywords(["C2PA", "Content Credentials", "PQ-C2PA", docNo, `sha256:${item.sha256 || ""}`, `snapshot:${snapshotHash}`]);
  doc.setCreator("PQ-C2PA Viewer");
  doc.setProducer("PQ-C2PA report engine (pdf-lib)");
  doc.setLanguage("ko-KR");
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);
  for (const canvas of pages) {
    const png = await doc.embedPng(canvas.toDataURL("image/png"));
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(png, {x:0, y:0, width:595.28, height:841.89});
  }
  const attach = (data, name, description) => doc.attach(new TextEncoder().encode(data), name,
    {mimeType:"application/json", description:`${description} · 문서번호 ${docNo}`, creationDate:issued, modificationDate:issued});
  if (type !== "summary") await attach(recordJson, "verification-record.json", "C2PA 검증 기록 원본");
  await attach(JSON.stringify(issuance ? {doc_no:issuance.doc_no, verification_code:issuance.verification_code, verify_url:issuance.verify_url,
    issued_at:issuance.issued_at, record:issuance.record, record_sha256:issuance.record_sha256, signature:issuance.signature}
    : {registered:false, reason:meta.offlineReason || null, local_doc_no:docNo, issued_at_pc:issued.toISOString(), snapshot_sha256:snapshotHash}, null, 2),
    "issuance-record.json", "발급 기록(서버 등록·ML-DSA-65 서명)");
  if (type === "pq" && options.conversion) await attach(JSON.stringify(options.conversion, null, 2), "conversion-record.json", "PQ 변환 작업 기록");
  return await doc.save();
}

export {hasP1};
export const REPORT_TYPES = Object.fromEntries(Object.entries(TYPES).map(([key, value]) => [key, {title:value.title, kind:value.kind}]));
