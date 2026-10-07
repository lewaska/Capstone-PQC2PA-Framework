const INSPECT_API_URL =
  "http://127.0.0.1:8000/api/v1/assets/inspect";
const AI_API_URL = "/api/ai/generate";
const STORAGE_KEY = "originlab_experiments_v1";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_BYTES = 20 * 1024 * 1024;
const VIEWS = new Set(["home", "result", "detail", "outputs", "history", "guide", "devices", "code", "trust"]);
const RESOURCE_VIEWS = new Set(["guide", "devices", "code", "trust"]);
const state = { file: null, objectUrl: null, imageDimensions: null, generatedBlob: null, generatedName: null, generatedUrl: null, selectedId: null, records: [], toastTimer: null };
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const setText = (id, value) => { $(id).textContent = value; };

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 정보 없음" : new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}
function makeId() {
  return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function loadRecords() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && typeof item.id === "string" && typeof item.name === "string").map(item => ({
      id: item.id, createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      name: item.name, mime: typeof item.mime === "string" ? item.mime : "",
      size: Number.isFinite(item.size) ? item.size : 0,
      width: Number.isSafeInteger(item.width) && item.width > 0 ? item.width : null,
      height: Number.isSafeInteger(item.height) && item.height > 0 ? item.height : null,
     kind:
  item.kind === "demo"
    ? "demo"
    : item.kind === "verified"
      ? "verified"
      : "pending",

status:
  typeof item.status === "string"
    ? item.status
    : item.kind === "demo"
      ? "시연 데이터"
      : "분석 대기",

analysis:
  item.analysis && typeof item.analysis === "object"
    ? item.analysis
    : null,

manifest:
  item.manifest && typeof item.manifest === "object"
    ? item.manifest
    : null,

artifacts:
  Array.isArray(item.artifacts)
    ? item.artifacts
    : []
    }));
  } catch { return []; }
}
function saveRecords() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records)); }
  catch { toast("브라우저 저장 공간을 사용할 수 없어 이번 세션에서만 기록이 보입니다."); }
}
function currentRecord() { return state.records.find(record => record.id === state.selectedId) || null; }

function clearInputPreview() {
  $("fileInput").value = "";
  $("uploadPreview").removeAttribute("src");
  $("uploadEmpty").hidden = false;
  $("uploadSelected").hidden = true;
  $("inspectButton").disabled = true;
  $("removeButton").disabled = true;
  setText("selectedName", "—");
  setText("selectedMeta", "—");
}
function releaseSelectedFile() {
  $("uploadPreview").removeAttribute("src");
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.file = null;
  state.imageDimensions = null;
  clearInputPreview();
}
function clearGeneratedImage() {
  $("aiPreview").removeAttribute("src");
  if (state.generatedUrl) URL.revokeObjectURL(state.generatedUrl);
  state.generatedBlob = null;
  state.generatedName = null;
  state.generatedUrl = null;
  $("aiPreview").hidden = true;
  $("aiEmpty").hidden = false;
  $("useAiImage").disabled = true;
  setText("aiStatus", "생성 API 연결 대기");
}
function selectFile(file) {
  if (!file) return;
  if (!ALLOWED_TYPES.has(file.type)) { toast("JPG, PNG 이미지만 사용할 수 있습니다."); return; }
  if (file.size > MAX_BYTES) { toast("20 MB 이하의 이미지를 선택해 주세요."); return; }
  releaseSelectedFile();
  state.file = file;
  state.objectUrl = URL.createObjectURL(file);
  state.imageDimensions = null;
  $("uploadPreview").src = state.objectUrl;
  $("uploadEmpty").hidden = true;
  $("uploadSelected").hidden = false;
  setText("selectedName", file.name);
  setText("selectedMeta", `${file.type.replace("image/", "").toUpperCase()} · ${formatSize(file.size)}`);
  $("inspectButton").disabled = false;
  $("removeButton").disabled = false;
  toast("이미지가 선택되었습니다. 검사 실행 전까지 미리볼 수 있습니다.");
}
function addRecord(record) {
  state.records.unshift(record);
  state.selectedId = record.id;
  saveRecords();
  renderRecord();
  renderOutputs();
  renderHistory();
  view("result");
}
async function inspectImage() {
  if (!state.file) return;

  const file = state.file;
  const width =
    state.imageDimensions?.width ||
    $("uploadPreview").naturalWidth ||
    null;
  const height =
    state.imageDimensions?.height ||
    $("uploadPreview").naturalHeight ||
    null;

  const button = $("inspectButton");
  button.disabled = true;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(INSPECT_API_URL, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || `HTTP ${response.status}`);
    }

    console.log("C2PA 분석 결과:", result);

    const record = {
  id: makeId(),
  createdAt: new Date().toISOString(),
  name: result.filename || file.name,
  mime: result.content_type || file.type,
  size: result.size || file.size,
  width,
  height,
  kind: "verified",
  status: result.state || "Unknown",
  analysis: {
    hasC2pa: result.has_c2pa === true,
    state: result.state || "Unknown",
    activeManifest: result.active_manifest || null,
    claim: result.claim || null,
    assertions: Array.isArray(result.assertions)
      ? result.assertions
      : [],
    validationStatus: Array.isArray(result.validation_status)
      ? result.validation_status
      : [],
    validationResults: result.validation_results || null,
  },
  manifest: result.manifest || null,
  artifacts: ["Classic C2PA 검증 결과"],
};

    releaseSelectedFile();
    clearGeneratedImage();
    addRecord(record);

    toast("Classic C2PA 분석이 완료되었습니다.");
  } catch (error) {
    console.error("C2PA 분석 실패:", error);
    toast(`분석 실패: ${error.message}`);
    button.disabled = false;
  }
}
function showSample() {
  releaseSelectedFile();
  clearGeneratedImage();
  addRecord({
    id: makeId(), createdAt: new Date().toISOString(), name: "시연용 예시",
    mime: "", size: 0, width: null, height: null, kind: "demo", status: "시연 데이터", artifacts: []
  });
}
function removeFile() { releaseSelectedFile(); toast("선택한 이미지를 화면에서 제거했습니다."); }
function setInputMode(mode, clearSelection = true) {
  if (clearSelection && state.file) releaseSelectedFile();
  $("dropzone").hidden = mode !== "file";
  $("urlInputPanel").hidden = mode !== "url";
  $$("[data-input-mode]").forEach(button => {
    const active = button.dataset.inputMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (mode === "url") $("urlInput").focus();
}
async function loadFromUrl() {
  const raw = $("urlInput").value.trim();
  let parsed;
  try {
    parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch { toast("http 또는 https 이미지 주소를 입력해 주세요."); return; }
  const button = $("urlLoadButton");
  button.disabled = true;
  button.textContent = "불러오는 중…";
  try {
    const response = await fetch(parsed.href, { credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const reportedSize = Number(response.headers.get("content-length") || 0);
    if (!ALLOWED_TYPES.has(type)) throw new Error("image type");
    if (reportedSize > MAX_BYTES) throw new Error("image size");
    const blob = await response.blob();
    if (blob.size > MAX_BYTES) throw new Error("image size");
    const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
    let name = decodeURIComponent(parsed.pathname.split("/").pop() || "").replace(/[^\w.\-\u3131-\uD79D]/g, "_");
    if (!name || name === "_") name = `linked-image.${extension}`;
    if (!name.includes(".")) name += `.${extension}`;
    selectFile(new File([blob], name, { type }));
    setInputMode("file", false);
    $("urlInput").value = "";
  } catch {
    toast("이 주소의 이미지를 브라우저에서 불러올 수 없습니다. 파일을 직접 선택해 주세요.");
  } finally {
    button.disabled = false;
    button.innerHTML = '이미지 불러오기 <svg><use href="#i-arrow"/></svg>';
  }
}

function renderRecord() {
  const record = currentRecord();

  const demo = record?.kind === "demo";
  const pending = record?.kind === "pending";
  const verified = record?.kind === "verified";

  const analysis = record?.analysis || {};
  const claim = analysis.claim || {};
  const signature = claim.signature_info || {};

  const assertions = Array.isArray(analysis.assertions)
    ? analysis.assertions
    : [];

  const validationStatus = Array.isArray(analysis.validationStatus)
    ? analysis.validationStatus
    : [];

  /*
   * validation_results 안에는 success, informational, failure 배열이
   * 여러 단계로 들어올 수 있으므로 모든 검증 코드를 하나로 모읍니다.
   */
  const validationEntries = [];

  function collectValidationEntries(value, kind = "") {
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (item && typeof item === "object") {
          validationEntries.push({
            ...item,
            kind: kind || item.kind || "",
          });
        }
      });
      return;
    }

    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (["success", "informational", "failure"].includes(key)) {
        collectValidationEntries(child, key);
      } else {
        collectValidationEntries(child, kind);
      }
    }
  }

  collectValidationEntries(analysis.validationResults);

  for (const item of validationStatus) {
    validationEntries.push({
      ...item,
      kind: item.kind || "failure",
    });
  }

  const validationCodes = validationEntries.map(item =>
    String(item.code || "")
  );

  const hasCode = code =>
    validationCodes.includes(code);

  const hasCodeStartingWith = prefix =>
    validationCodes.some(code => code.startsWith(prefix));

  const hasFailureStartingWith = prefix =>
    validationEntries.some(item =>
      item.kind === "failure" &&
      String(item.code || "").startsWith(prefix)
    );

  const hasDataHashMatch =
    hasCode("assertion.dataHash.match") ||
    hasCode("assertion.hashedURI.match");

  const hasDataHashFailure =
    hasCode("assertion.dataHash.mismatch") ||
    hasFailureStartingWith("assertion.dataHash");

  const hasSignatureValid =
    hasCode("claimSignature.validated") ||
    hasCode("claimSignature.insideValidity");

  const hasSignatureFailure =
    hasFailureStartingWith("claimSignature.");

  const hasTimestamp =
    Boolean(signature.time) ||
    hasCodeStartingWith("timeStamp.");

  const hasTimestampValid =
    hasCode("timeStamp.validated");

  const hasTimestampFailure =
    hasFailureStartingWith("timeStamp.");

  const hasUntrustedCredential =
    hasCode("signingCredential.untrusted") ||
    hasCode("timeStamp.untrusted");

  const aiDeclared = assertions.some(assertion => {
    const actions = assertion?.data?.actions;

    return Array.isArray(actions) && actions.some(action => {
      const sourceType = String(
        action.digitalSourceType || ""
      );

      return (
        sourceType.includes("trainedAlgorithmicMedia") ||
        sourceType.includes(
          "compositeWithTrainedAlgorithmicMedia"
        ) ||
        sourceType.includes("algorithmicallyEnhanced")
      );
    });
  });

  const signer =
    signature.common_name ||
    signature.issuer ||
    "확인 불가";

  /*
   * 결과 배너
   */
  $("resultBanner").classList.toggle("is-demo", demo);

  setText(
    "bannerLabel",
    demo ? "화면 예시" : "검증 상태"
  );

  let bannerTitle = "검사 기록이 없습니다";
  let bannerText = "이미지를 선택하고 검사를 실행해 주세요.";
  let bannerTag = "대기";

  if (demo) {
    bannerTitle = "결과 화면 예시";
    bannerText =
      "아래 값은 화면 구성을 위한 시연 데이터입니다. 실제 검증 결과가 아닙니다.";
    bannerTag = "시연 데이터";
  } else if (pending) {
    bannerTitle = "분석 서버 연결 대기";
    bannerText =
      "파일 정보만 기록됐으며 아직 C2PA 검증을 수행하지 않았습니다.";
    bannerTag = "미검증";
  } else if (verified) {
    bannerTag = analysis.state || "Unknown";

    if (analysis.state === "NoManifest") {
      bannerTitle = "C2PA Manifest가 없습니다";
      bannerText =
        "파일은 정상적으로 읽었지만 이미지 내부에서 C2PA Manifest를 찾지 못했습니다.";
    } else if (analysis.state === "Invalid") {
      bannerTitle = "Classic C2PA 검증 실패";
      bannerText =
        "서명 또는 데이터 무결성 검증에서 실패 항목이 발견됐습니다. 상세 결과를 확인해 주세요.";
    } else if (analysis.state === "Valid") {
      bannerTitle = "서명 유효 · 신뢰 미확인";
      bannerText =
        "C2PA 서명과 데이터 연결은 유효하지만 서명 인증서의 신뢰 여부는 별도로 확인해야 합니다.";
    } else if (analysis.state === "Trusted") {
      bannerTitle = "Classic C2PA 신뢰 확인";
      bannerText =
        "C2PA 서명, 데이터 무결성 및 선택한 신뢰 정책의 인증서 검증을 통과했습니다.";
    } else {
      bannerTitle =
        `Classic C2PA 검증 결과: ${analysis.state || "Unknown"}`;
      bannerText =
        "상세 화면에서 SDK가 반환한 검증 코드와 Manifest를 확인해 주세요.";
    }
  }

  setText("bannerTitle", bannerTitle);
  setText("bannerText", bannerText);
  setText("bannerTag", bannerTag);

  /*
   * 핵심 결과
   */
  setText(
    "resultSigner",
    verified ? signer : demo ? "시연용" : "확인 전"
  );

  let integrityText = "확인 전";

  if (demo) {
    integrityText = "시연용";
  } else if (verified && analysis.state === "NoManifest") {
    integrityText = "검증 불가";
  } else if (verified && hasDataHashFailure) {
    integrityText = "해시 불일치";
  } else if (verified && hasDataHashMatch) {
    integrityText = "해시 일치";
  } else if (verified) {
    integrityText = "세부 결과 확인";
  }

  setText("resultIntegrity", integrityText);

  setText(
    "resultAiFlag",
    verified
      ? aiDeclared
        ? "AI 생성·편집 선언 있음"
        : "선언 확인 안 됨"
      : demo
        ? "시연용"
        : "확인 전"
  );

  /*
   * 파일 정보
   */
  setText(
    "resultEmptyTitle",
    record
      ? "업로드 원본은 보관하지 않습니다"
      : "결과 이미지가 없습니다"
  );

  setText(
    "resultEmptyText",
    record
      ? "검증 결과와 Manifest 정보만 브라우저 기록에 저장됩니다."
      : "이미지를 검사하면 결과 상태가 표시됩니다."
  );

  setText("resultFileName", record?.name || "—");

  setText(
    "resultFileMeta",
    demo
      ? "화면 시연용 기록"
      : record?.mime
        ? record.mime.replace("image/", "").toUpperCase()
        : "선택된 파일 없음"
  );

  setText(
    "resultFileSize",
    record ? formatSize(record.size) : "—"
  );

  setText(
    "resultImageDimensions",
    demo
      ? "예시"
      : record?.width && record?.height
        ? `${record.width} × ${record.height}`
        : "크기 정보 없음"
  );

  /*
   * 요약 항목
   */
  const summaryValues = demo
    ? ["구조 예시", "연결 예시", "서명 예시", "신뢰 예시"]
    : verified
      ? [
          analysis.hasC2pa ? "존재" : "없음",
          assertions.length
            ? `${assertions.length}개`
            : analysis.hasC2pa
              ? "확인되지 않음"
              : "없음",
          hasSignatureFailure
            ? "검증 실패"
            : hasSignatureValid
              ? signature.alg || "유효"
              : Object.keys(signature).length
                ? signature.alg || "서명 있음"
                : "확인 불가",
          hasTimestampFailure
            ? "검증 실패"
            : hasTimestampValid
              ? "유효"
              : hasTimestamp
                ? "정보 있음"
                : "없음",
        ]
      : ["확인 전", "확인 전", "확인 전", "확인 전"];

  [
    "summaryManifest",
    "summaryClaim",
    "summarySignature",
    "summaryTimestamp",
  ].forEach((id, index) => {
    setText(id, summaryValues[index]);
  });

  /*
   * 상세 화면 상단
   */
  setText(
    "detailFileName",
    record?.name || "선택된 파일 없음"
  );

  setText(
    "detailMode",
    demo
      ? "시연 데이터 · 실제 검증 아님"
      : verified
        ? `Classic C2PA · ${analysis.state || "Unknown"}`
        : pending
          ? "분석 서버 연결 대기"
          : "분석 결과 대기"
  );

  setText(
    "detailRecordMeta",
    record
      ? `${formatDate(record.createdAt)} · 기록 ID ${record.id}`
      : "기록 없음"
  );

  setText(
    "evidenceTag",
    verified
      ? analysis.state || "Unknown"
      : demo
        ? "시연 데이터"
        : "분석 대기"
  );

  /*
   * 항목별 근거
   */
  setText(
    "evidenceManifest",
    verified
      ? analysis.hasC2pa
        ? "확인"
        : "없음"
      : demo
        ? "시연용"
        : "미실행"
  );

  setText(
    "evidenceAssertion",
    verified
      ? assertions.length
        ? `${assertions.length}개 확인`
        : "없음"
      : demo
        ? "시연용"
        : "미실행"
  );

  setText(
    "evidenceClaim",
    verified
      ? claim && Object.keys(claim).length
        ? "확인"
        : "없음"
      : demo
        ? "시연용"
        : "미실행"
  );

  setText(
    "evidenceSignature",
    verified
      ? hasSignatureFailure
        ? "실패"
        : hasSignatureValid
          ? "유효"
          : Object.keys(signature).length
            ? "정보 있음"
            : "확인 불가"
      : demo
        ? "시연용"
        : "미실행"
  );

  setText(
    "evidenceTimestamp",
    verified
      ? hasTimestampFailure
        ? "실패"
        : hasTimestampValid
          ? "유효"
          : hasTimestamp
            ? "정보 있음"
            : "없음"
      : demo
        ? "시연용"
        : "미실행"
  );

  setText(
    "evidenceTrust",
    verified
      ? hasUntrustedCredential
        ? "신뢰 미확인"
        : analysis.state === "Trusted"
          ? "신뢰 확인"
          : analysis.hasC2pa
            ? "세부 결과 확인"
            : "검증 불가"
      : demo
        ? "시연용"
        : "미실행"
  );

  setText(
    "checkCount",
    verified
      ? `${validationEntries.length}개 SDK 검증 결과`
      : demo
        ? "6개 항목 · 시연 데이터"
        : "6개 항목 · 분석 대기"
  );

  /*
   * Manifest JSON
   */
  const hasManifest =
    verified &&
    record?.manifest &&
    typeof record.manifest === "object";

  $("manifestEmpty").hidden = Boolean(hasManifest);
  $("manifestJson").hidden = !hasManifest;

  $("manifestJson").textContent = hasManifest
    ? JSON.stringify(record.manifest, null, 2)
    : "";

  setText(
    "manifestDataTag",
    hasManifest
      ? "SDK 추출 완료"
      : verified && analysis.state === "NoManifest"
        ? "Manifest 없음"
        : "데이터 대기"
  );

  /*
   * 버튼 활성화
   */
  $("detailButton").disabled = !record;
  $("exportRecordButton").disabled = !record;

  filterChecks(
    $("[data-check-filter].is-active")?.dataset.checkFilter ||
      "all"
  );
}
function matchesRecord(record, query) {
  if (!query) return true;
  return [record.name, record.id, formatDate(record.createdAt), record.status, record.mime]
    .some(value => String(value).toLocaleLowerCase("ko-KR").includes(query));
}
function filteredRecords(searchId, filterId, sortId) {
  const query = $(searchId).value.trim().toLocaleLowerCase("ko-KR");
  const status = $(filterId).value;
  const sort = $(sortId).value;
  const result = state.records.filter(record => matchesRecord(record, query) && (status === "all" || record.kind === status));
  if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  else result.sort((a, b) => sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  return result;
}
function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}
function openRecord(id, page) { state.selectedId = id; renderRecord(); view(page); }

function renderOutputs() {
  const filtered = filteredRecords("outputSearch", "outputFilter", "outputSort");
  const container = $("outputCards");
  container.replaceChildren();
  filtered.forEach(record => {
    const card = document.createElement("article");
    card.className = "output-card";
    const top = node("div", "output-top", "");
    top.append(node("span", "output-icon", "▧"), node("span", `record-status ${record.kind === "demo" ? "is-demo" : ""}`, record.status));
    const artifact = node("div", "artifact-placeholder", "");
    artifact.append(node("strong", "", "결과물 미생성"), node("span", "", "분석 서버 연결 후 생성 파일이 이곳에 표시됩니다."));
    const footer = node("div", "output-footer", "");
    const button = node("button", "text-action", "결과 보기 →");
    button.type = "button";
    button.addEventListener("click", () => openRecord(record.id, "result"));
    footer.append(node("span", "record-id", `ID ${record.id}`), button);
    const dimensions = record.width && record.height ? ` · ${record.width} × ${record.height}` : "";
    card.append(top, node("h2", "", record.name), node("p", "output-meta", `${formatDate(record.createdAt)} · ${formatSize(record.size)}${dimensions}`), artifact, footer);
    container.append(card);
  });
  setText("outputCount", `${filtered.length}개 기록`);
  $("outputEmpty").hidden = filtered.length !== 0;
}
function renderHistory() {
  const filtered = filteredRecords("historySearch", "historyFilter", "historySort");
  const container = $("historyRows");
  container.replaceChildren();
  filtered.forEach(record => {
    const row = node("div", "history-row", "");
    row.setAttribute("role", "row");
    const date = node("span", "", formatDate(record.createdAt));
    date.setAttribute("role", "cell");
    const image = node("span", "history-image", "");
    image.setAttribute("role", "cell");
    image.append(node("strong", "", record.name), node("small", "", `ID ${record.id}`));
    const status = node("span", `record-status ${record.kind === "demo" ? "is-demo" : ""}`, record.status);
    status.setAttribute("role", "cell");
    const artifact = node("span", "history-artifact", "없음");
    artifact.setAttribute("role", "cell");
    const action = node("span", "", "");
    action.setAttribute("role", "cell");
    const button = node("button", "text-action", "상세 보기 →");
    button.type = "button";
    button.addEventListener("click", () => openRecord(record.id, "detail"));
    action.append(button);
    row.append(date, image, status, artifact, action);
    container.append(row);
  });
  setText("historyCount", `${filtered.length}개 기록`);
  $("historyEmpty").hidden = filtered.length !== 0;
}
function view(name) {
  if (!VIEWS.has(name)) name = "home";
  if (name === "outputs") renderOutputs();
  if (name === "history") renderHistory();
  $("resourceNav").hidden = !RESOURCE_VIEWS.has(name);
  $$("[data-view]").forEach(element => { element.hidden = element.dataset.view !== name; });
  $$("[data-nav]").forEach(button => {
    const active = button.dataset.nav === name || (name === "detail" && button.dataset.nav === "result") || (RESOURCE_VIEWS.has(name) && button.dataset.nav === "guide");
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $$("[data-resource-nav]").forEach(button => {
    const active = button.dataset.resourceNav === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  window.scrollTo(0, 0);
}
function filterChecks(kind) {
  $$("[data-check]").forEach(row => { row.hidden = kind !== "all" && row.dataset.check !== kind; });
  $$("[data-check-filter]").forEach(button => {
    const active = button.dataset.checkFilter === kind;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const visibleCount = $$("[data-check]").filter(row => !row.hidden).length;
  setText("checkCount", `${visibleCount}개 항목 · ${currentRecord()?.kind === "demo" ? "시연 데이터" : "분석 대기"}`);
}
function exportRecord() {
  const record = currentRecord();
  if (!record) return;
  const payload = {
    recordId: record.id,
    createdAt: record.createdAt,
    file: { name: record.name, type: record.mime, bytes: record.size, width: record.width, height: record.height },
    status: record.status,
    checks: {
      manifest: "미실행", assertion: "미실행", claim: "미실행",
      claimSignature: "미실행", timestamp: "미실행", tsaCa: "미실행"
    },
    note: "브라우저 기록만 내보낸 파일입니다. C2PA 검증 결과나 이미지 원본은 포함되지 않습니다."
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `originlab-record-${record.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("원본 이미지가 없는 기록 JSON 저장을 요청했습니다.");
}
function toggleAi(force) {
  const opening = typeof force === "boolean" ? force : $("aiPanel").hidden;
  $("aiPanel").hidden = !opening;
  $("aiToggle").classList.toggle("is-open", opening);
  $("aiToggle").setAttribute("aria-expanded", String(opening));
  $("aiToggle").setAttribute("aria-label", opening ? "AI 이미지 생성 창 닫기" : "AI 이미지 생성 창 열기");
  if (opening) $("aiPrompt").focus();
}
async function generateAiImage() {
  const prompt = $("aiPrompt").value.trim();
  if (prompt.length < 8) { toast("이미지 설명을 8자 이상 입력해 주세요."); $("aiPrompt").focus(); return; }
  const button = $("aiGenerate");
  button.disabled = true;
  setText("aiStatus", "생성 요청 중…");
  try {
    const response = await fetch(AI_API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style: $("aiStyle").value, aspect_ratio: $("aiRatio").value })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    let blob;
    let name = "ai-generated.png";
    if (contentType.startsWith("image/")) {
      blob = await response.blob();
      name = `ai-generated.${blob.type.split("/")[1] || "png"}`;
    } else if (contentType.includes("application/json")) {
      const data = await response.json();
      if (typeof data.image_url !== "string") throw new Error("image_url missing");
      const imageResponse = await fetch(data.image_url);
      if (!imageResponse.ok) throw new Error("image download failed");
      blob = await imageResponse.blob();
      name = data.file_name || name;
    } else throw new Error("unsupported content type");
    if (!ALLOWED_TYPES.has(blob.type) || blob.size > MAX_BYTES) throw new Error("unsupported image");
    clearGeneratedImage();
    state.generatedBlob = blob;
    state.generatedName = name;
    state.generatedUrl = URL.createObjectURL(blob);
    $("aiPreview").src = state.generatedUrl;
    $("aiPreview").hidden = false;
    $("aiEmpty").hidden = true;
    $("useAiImage").disabled = false;
    toast("이미지가 생성되었습니다. 검사에 사용할 수 있습니다.");
  } catch (error) {
    setText("aiStatus", "생성 API 연결 대기");
    toast("AI 이미지 생성 서버가 아직 연결되지 않았습니다.");
    console.info("AI endpoint unavailable:", error.message);
  } finally { button.disabled = false; }
}
function useGenerated() {
  if (!state.generatedBlob) return;
  selectFile(new File([state.generatedBlob], state.generatedName || "ai-generated.png", { type: state.generatedBlob.type }));
  clearGeneratedImage();
  toggleAi(false);
  view("home");
}
function init() {
  state.records = loadRecords();
  state.selectedId = state.records[0]?.id || null;
  const dropzone = $("dropzone");
  dropzone.addEventListener("click", () => $("fileInput").click());
  dropzone.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("fileInput").click(); } });
  $("fileInput").addEventListener("change", event => selectFile(event.target.files?.[0]));
  $("uploadPreview").addEventListener("load", () => {
    if (state.file) state.imageDimensions = { width: $("uploadPreview").naturalWidth, height: $("uploadPreview").naturalHeight };
  });
  ["dragenter", "dragover"].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove("is-dragging"); }));
  dropzone.addEventListener("drop", event => selectFile(event.dataTransfer?.files?.[0]));
  $("sampleButton").addEventListener("click", showSample);
  $$("[data-input-mode]").forEach(button => button.addEventListener("click", () => setInputMode(button.dataset.inputMode)));
  $("urlLoadButton").addEventListener("click", loadFromUrl);
  $("urlInput").addEventListener("keydown", event => { if (event.key === "Enter") loadFromUrl(); });
  $("removeButton").addEventListener("click", removeFile);
  $("inspectButton").addEventListener("click", inspectImage);
  $("detailButton").addEventListener("click", () => view("detail"));
  $("outputSearch").addEventListener("input", renderOutputs);
  $("historySearch").addEventListener("input", renderHistory);
  $("outputFilter").addEventListener("change", renderOutputs);
  $("outputSort").addEventListener("change", renderOutputs);
  $("historyFilter").addEventListener("change", renderHistory);
  $("historySort").addEventListener("change", renderHistory);
  $$("[data-check-filter]").forEach(button => button.addEventListener("click", () => filterChecks(button.dataset.checkFilter)));
  $$("[data-jump]").forEach(button => button.addEventListener("click", () => $(button.dataset.jump).scrollIntoView({ behavior: "smooth", block: "start" })));
  $("exportRecordButton").addEventListener("click", exportRecord);
  $$("[data-nav]").forEach(button => button.addEventListener("click", () => view(button.dataset.nav)));
  $$("[data-resource-nav]").forEach(button => button.addEventListener("click", () => view(button.dataset.resourceNav)));
  $$("[data-go]").forEach(button => button.addEventListener("click", () => view(button.dataset.go)));
  $("aiToggle").addEventListener("click", () => toggleAi());
  $("aiClose").addEventListener("click", () => toggleAi(false));
  $("aiGenerate").addEventListener("click", generateAiImage);
  $("useAiImage").addEventListener("click", useGenerated);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("aiPanel").hidden) toggleAi(false); });
  window.addEventListener("hashchange", () => view(location.hash.slice(1)));
  window.addEventListener("beforeunload", () => { releaseSelectedFile(); clearGeneratedImage(); });
  clearInputPreview();
  renderRecord();
  filterChecks("all");
  renderOutputs();
  renderHistory();
  view(location.hash.slice(1) || "home");
}
document.addEventListener("DOMContentLoaded", init);
