"use strict";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const sizes = size => Number.isFinite(size) ? size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB` : "—";
const when = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat("ko-KR", {dateStyle:"medium", timeStyle:"short"}).format(d) : "정보 없음"; };
const FORMAT_EXTENSIONS = new Set(["jpg","jpeg","png","webp","tif","tiff","avif","heic","heif","gif","svg","dng","mp4","mov","avi","mp3","wav","m4a","pdf","c2pa"]);
const SERVER_FORMAT_EXTENSIONS = new Set(["jpg","jpeg","png"]);
const SERVER_MAX_SIZE = 20 * 1024 * 1024;
const BROWSER_MAX_SIZE = 100 * 1024 * 1024;
const state = { results:[], active:0, detail:"overview", checkFilter:"all", selectedManifest:null, localUrls:new Map(), busy:false, mode:"file", explanations:new Map(), explainMode:"simple", explainBusy:false, explainAvailable:null, explainError:"" };
const stateLabels = {Trusted:"신뢰 확인", Valid:"유효 · 신뢰 미확인", Invalid:"검증 실패", NoManifest:"C2PA 없음", RemoteUnavailable:"외부 Manifest 필요", Error:"분석 오류", Unknown:"상태 미확인"};
const stateDescriptions = {
  Trusted:"서명과 파일 결합이 검증되고, 선택한 신뢰 목록에서 서명자를 확인했습니다.",
  Valid:"서명과 파일 결합은 유효하지만, 선택한 목록에서 서명자의 신뢰는 확인되지 않았습니다.",
  Invalid:"Manifest 검증에 실패했습니다. 아래 오류 코드를 확인해 원인을 구분하세요.",
  NoManifest:"파일에 검증 가능한 C2PA Manifest가 없습니다. 이 결과만으로 가짜나 변조라고 판단할 수 없습니다.",
  RemoteUnavailable:"외부 Manifest가 필요하지만 현재 검증 정책에서는 원격 Manifest 요청을 차단합니다.",
  Error:"파일을 분석하는 동안 오류가 발생했습니다. 원본 파일과 형식을 확인하세요."
};
const glossary = {
  "C2PA":"콘텐츠가 어떻게 만들어지고 바뀌었는지 서명된 기록으로 연결하는 표준입니다. 기록의 유무와 사진 속 장면의 진위는 서로 다른 문제입니다.",
  "Manifest":"파일에 연결된 출처 기록 묶음입니다. 제작·편집 정보, 재료, 서명 정보를 담을 수 있으며 현재 파일에 연결된 기록과 이전 기록을 구분해 볼 수 있습니다.",
  "원격 Manifest":"출처 기록이 파일 안이 아닌 외부 주소에 있는 방식입니다. 이 사이트는 자동 외부 조회를 끄므로 원격 기록이 필요하면 검증을 끝내지 못할 수 있습니다.",
  "Assertion":"Manifest 안의 개별 진술 또는 기록입니다. 제작 도구, 편집 작업, 재료 등의 항목이 여기에 들어갈 수 있습니다. 기록된 내용이 현실의 사실이라는 뜻은 아닙니다.",
  "Claim":"어떤 Assertion이 이 콘텐츠의 출처 기록에 속하는지 지정하는 서명 대상입니다. 서명 검사는 이 연결이 임의로 바뀌지 않았는지 확인합니다.",
  "Ingredient":"현재 콘텐츠를 만드는 데 사용했다고 기록된 이전 파일이나 재료입니다. 재료가 0개여도 실제 제작 과정에 재료가 전혀 없었다고 단정할 수 없습니다.",
  "디지털 서명":"서명용 인증서와 암호 기술로 출처 기록에 서명합니다. 검증에 성공하면 기록이 서명 뒤 바뀌지 않았는지 확인할 수 있지만, 화면 속 내용의 사실 여부는 증명하지 않습니다.",
  "무결성":"서명 당시의 기록과 현재 파일이 맞게 연결되는지 확인하는 성질입니다. 통과는 기록과 파일 결합의 유효성을 뜻하며, 장면의 진실성을 뜻하지 않습니다.",
  "메타데이터":"파일에 붙는 부가 정보입니다. 촬영 시각·위치·색상 정보처럼 일반 메타데이터는 수정될 수 있으므로 서명된 C2PA 기록과 따로 읽어야 합니다.",
  "AI 생성 선언":"제작자가 C2PA 기록에 AI 사용을 표시했는지 보여줍니다. 선언이 없더라도 AI를 사용하지 않았다는 증거가 아니며, 이 값은 AI 탐지 결과가 아닙니다.",
  "서명자":"출처 기록에 디지털 서명을 한 주체입니다. 인증서에 적힌 이름을 보여주는 것과 선택한 신뢰 목록에서 그 서명을 신뢰할 수 있는지는 별도의 확인입니다.",
  "발급자":"서명자 인증서를 발급한 기관의 이름입니다. 표시된 이름은 인증서 정보이며, 해당 기관이 현재 신뢰 목록에 있는지는 검증 상태에서 따로 확인해야 합니다.",
  "인증서":"서명자의 공개키와 이름 등을 묶어 발급자가 서명한 전자 증명서입니다. 파일의 서명을 검사하는 데 쓰지만, 사진 내용의 진실이나 저작권을 보증하지 않습니다.",
  "CA":"Certificate Authority의 약자로, 인증기관을 뜻합니다. 서명자가 쓸 인증서를 발급하거나 그 인증서의 신뢰 연결을 형성합니다. CA 이름이 보이거나 자체 인증서가 있다고 해서 모든 사용자에게 공인된 것은 아닙니다.",
  "실험용 CA 포함":"이 프로젝트의 샘플 검증에 쓰는 실험용 인증기관(CA)을 신뢰 기준에 추가합니다. 이 설정으로 샘플이 '신뢰 확인'으로 표시돼도 일반 공개 환경의 신뢰를 뜻하지 않습니다.",
  "기본 SDK 목록":"공식 C2PA SDK의 기본 신뢰 설정으로 검사합니다. 프로젝트의 실험용 CA를 추가하지 않으므로 샘플 파일은 서명이 유효해도 '신뢰 미확인'이 될 수 있습니다.",
  "신뢰 목록":"어떤 인증기관이나 서명자를 신뢰 기준으로 삼을지 정한 목록입니다. 같은 파일도 목록이 달라지면 '신뢰 확인'과 '신뢰 미확인'이 달라질 수 있습니다.",
  "검증 정책":"검사에 사용하는 신뢰 기준과 네트워크 설정입니다. 이 화면에서는 기본 SDK 설정과 실험용 CA 추가 중 하나를 선택하며, 선택값은 결과에 함께 표시됩니다.",
  "신뢰 정책":"어떤 인증기관을 신뢰 기준으로 삼을지 고르는 설정입니다. 샘플을 살펴볼 때만 실험용 CA 포함을 선택하고, 실제 파일은 기본 설정의 결과와 구분해 읽으세요.",
  "서명 알고리즘":"출처 기록의 디지털 서명에 사용한 암호 방식입니다. 이름 자체는 검증 결과가 아니므로 서명 통과 여부와 신뢰 상태를 함께 확인하세요.",
  "알고리즘":"출처 기록의 디지털 서명에 사용한 암호 방식입니다. 알고리즘 이름만으로 서명이 유효하거나 서명자가 신뢰된다고 판단할 수 없습니다.",
  "SDK":"Software Development Kit의 약자로, 개발자가 기능을 구현할 때 쓰는 도구 모음입니다. 이 사이트는 공식 C2PA SDK의 검증 결과를 읽기 쉽게 표시합니다.",
  "OCSP":"Online Certificate Status Protocol의 약자로, 인증서의 폐기 상태를 확인하는 방식입니다. 이 사이트는 검증 중 온라인 OCSP 조회를 요청하지 않습니다. 따라서 조회하지 않았다는 사실을 '폐기되지 않음'으로 해석하면 안 됩니다.",
  "TSA":"Time Stamping Authority의 약자로, 서명 시각을 증명하는 타임스탬프 기관입니다. 단순한 날짜 문자열과 TSA의 서명·신뢰 검증 결과는 다릅니다.",
  "서명 시간 정보":"출처 기록에 연결된 서명 시각 정보입니다. 시간이 표시되어도 검증된 TSA 타임스탬프인지는 별도로 확인해야 합니다.",
  "SHA-256":"파일 바이트로 계산한 고정 길이의 지문(해시)입니다. 두 값이 같으면 같은 바이트인지 비교할 수 있지만 누가 만들었는지는 알 수 없습니다.",
  "SHA3-256":"SHA-256과 계산 방식이 다른 파일 지문입니다. 같은 알고리즘으로 계산한 값끼리 비교하세요. 해시값만으로 콘텐츠의 출처나 진위를 확인할 수는 없습니다.",
  "해시":"파일 내용에서 계산한 디지털 지문입니다. 복사본의 바이트가 같은지 비교하는 데 유용하지만 제작자나 장면의 사실 여부를 알려주지는 않습니다.",
  "JSON":"출처 기록과 검증 결과를 기계가 읽도록 표현한 구조화된 텍스트입니다. 항목을 펼치면 원문 필드를 확인할 수 있습니다.",
  "EXIF":"촬영 시각, 카메라 설정 등이 들어갈 수 있는 이미지의 일반 메타데이터입니다. 편집될 수 있으며 C2PA 서명과는 별개의 정보입니다.",
  "ICC 프로필":"이미지의 색을 기기 간에 비슷하게 표현하도록 돕는 색상 설정입니다. 존재 여부는 출처 검증이나 변조 판정과 직접 관련이 없습니다.",
  "GPS 메타데이터":"이미지에 기록될 수 있는 위치 정보입니다. 개인정보 보호를 위해 이 화면은 좌표를 표시하지 않습니다. 위치 정보가 있어도 실제 촬영 장소라는 증거는 아닙니다.",
  "해상도":"이미지의 가로·세로 픽셀 수입니다. 화면 크기나 선명도와 관련되지만 C2PA 신뢰 상태를 뜻하지 않습니다.",
  "색상 모드":"이미지를 표현하는 색상 방식입니다. 예를 들어 RGB나 흑백이 표시될 수 있으며 출처의 진위와는 별개입니다.",
  "처리 방식":"파일 검증이 브라우저에서 이뤄졌는지 로컬 서버에서 이뤄졌는지 보여줍니다. 브라우저 모드는 파일을 서버에 보내지 않습니다.",
  "제작 도구":"출처 기록에 자신을 남긴 프로그램 또는 기기입니다. 기록된 도구 이름만으로 실제 제작 과정을 모두 확인할 수는 없습니다.",
  "signature_info":"선택한 Manifest의 서명자 이름, 인증서 발급자, 서명 알고리즘 등의 정보입니다. 이름과 실제 신뢰 판정은 구분해야 합니다.",
  "claim_generator":"이 출처 기록을 생성한 프로그램이나 기기 정보입니다. 파일 내용의 사실 여부를 검증하는 항목은 아닙니다.",
  "claim_generator_info":"출처 기록을 생성한 프로그램 또는 기기의 이름과 버전 정보입니다.",
  "assertions":"Manifest 안에 기록된 개별 진술의 목록입니다. 항목 수가 많다고 검증 신뢰도가 높아지는 것은 아닙니다.",
  "ingredients":"콘텐츠 제작에 사용했다고 기록된 이전 재료들의 목록입니다. 기록이 없는 재료는 이 목록에서 알 수 없습니다.",
  "actions":"제작·편집 작업으로 기록된 항목들의 목록입니다. 기록되지 않은 실제 작업까지 보여주지는 않습니다.",
  "alg":"서명에 사용한 암호 알고리즘의 식별자입니다. 유효성은 검증 상태에서 따로 확인하세요.",
  "issuer":"서명자 인증서의 발급기관(CA) 이름입니다. 이름만으로 그 기관의 신뢰 여부가 확정되지는 않습니다.",
  "common_name":"서명자 인증서에 표시된 이름입니다. 표시된 이름과 서명자 신뢰 판정은 별개입니다.",
  "active_manifest":"현재 파일에 직접 연결된 출처 기록의 식별자입니다. 다른 기록은 제작 과정의 이전 단계일 수 있습니다.",
  "validation_state":"공식 SDK가 이 파일의 출처 기록을 검사해 분류한 상태입니다. 신뢰 정책에 따라 판정이 달라질 수 있습니다."
};
function hintText(label,description){return `<span class="term" tabindex="0" data-description="${esc(description)}" aria-label="${esc(label)}: ${esc(description)}">${esc(label)}<span class="term-help" aria-hidden="true">?</span></span>`;}
function term(label) {
  const description=glossary[label];
  return description ? hintText(label,description) : esc(label);
}
const inlineGlossaryTerms=["실험용 CA 포함","기본 SDK 목록","AI 생성 선언","원격 Manifest","ICC 프로필","GPS 메타데이터","서명 시간 정보","서명 알고리즘","디지털 서명","신뢰 목록","검증 정책","SHA3-256","SHA-256","C2PA","Manifest","Assertion","Ingredient","Claim","OCSP","TSA","EXIF","SDK","CA","무결성","메타데이터","인증서","서명자","발급자","해시"];
const inlineTermPattern=new RegExp(`(?<![A-Za-z0-9_])(${inlineGlossaryTerms.sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})(?![A-Za-z0-9_])`,"g");
function annotateTerms(value){return String(value ?? "").split(inlineTermPattern).map(part=>glossary[part] ? term(part) : esc(part)).join("");}
function annotateIssuer(value){return String(value ?? "").split(/(?<![A-Za-z0-9_])(CA)(?![A-Za-z0-9_])/g).map(part=>part === "CA" ? term("CA") : esc(part)).join("");}
let activeTerm=null, glossaryPopover=null;
function positionGlossaryPopover(){
  if(!activeTerm || !activeTerm.isConnected || !glossaryPopover || glossaryPopover.hidden)return;
  const rect=activeTerm.getBoundingClientRect(), width=glossaryPopover.offsetWidth, height=glossaryPopover.offsetHeight;
  glossaryPopover.style.left=`${Math.max(10,Math.min(rect.left,innerWidth-width-10))}px`;
  glossaryPopover.style.top=`${rect.top-height-10>=10 ? rect.top-height-10 : Math.min(rect.bottom+10,innerHeight-height-10)}px`;
}
function showGlossaryPopover(element){
  if(!element?.dataset.description)return;
  if(!glossaryPopover){glossaryPopover=document.createElement("div");glossaryPopover.className="term-popover";glossaryPopover.setAttribute("role","tooltip");document.body.append(glossaryPopover);}
  activeTerm=element;glossaryPopover.textContent=element.dataset.description;glossaryPopover.hidden=false;
  positionGlossaryPopover();
}
function hideGlossaryPopover(){activeTerm=null;if(glossaryPopover)glossaryPopover.hidden=true;}
document.addEventListener("pointerover",event=>{const element=event.target.closest?.(".term");if(element)showGlossaryPopover(element);});
document.addEventListener("pointerout",event=>{const element=event.target.closest?.(".term");if(element === activeTerm && !element.contains(event.relatedTarget))hideGlossaryPopover();});
document.addEventListener("focusin",event=>{const element=event.target.closest?.(".term");if(element)showGlossaryPopover(element);});
document.addEventListener("focusout",event=>{if(event.target === activeTerm)hideGlossaryPopover();});
document.addEventListener("scroll",positionGlossaryPopover,true);
window.addEventListener("resize",positionGlossaryPopover);

function toast(message) {
  const target = $("#toast"); target.textContent = message; target.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => target.classList.remove("show"), 3500);
}
function error(message) { const target = $("#error"); target.textContent = message; target.hidden = false; }
function clearError() { $("#error").hidden = true; $("#error").textContent = ""; }
function progress(message, visible = true) {
  const target = $("#progress"); target.hidden = !visible; target.innerHTML = visible ? `<span class="spinner" aria-hidden="true"></span>${esc(message)}` : "";
  $("#dropzone").setAttribute("aria-busy", String(visible));
}
function startActivity(message) {
  $("#activity-items").replaceChildren();
  $("#activity-log").hidden = false;
  logActivity(message);
}
function logActivity(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString("ko-KR")} · ${message}`;
  $("#activity-items").append(item);
}
function setBusy(value) {
  state.busy = value;
  $("#url-form button").disabled = value;
  $$("[data-sample]").forEach(button => button.disabled = value);
  $("#trust-profile").disabled = value;
  $("#private-mode").disabled = value || $("#browser-mode").checked;
  $("#browser-mode").disabled = value || state.mode === "url";
}
function updateProcessingMode() {
  const browser = $("#browser-mode").checked;
  if (browser) $("#private-mode").checked = true;
  $("#private-mode").disabled = browser || state.busy;
  $("#browser-mode").disabled = state.mode === "url" || state.busy;
  $("#intake-limit").textContent = browser
    ? "한 번에 최대 10개 · 파일당 최대 100 MB"
    : "한 번에 최대 10개 · JPEG/PNG · 파일당 최대 20 MB";
  $("#header-privacy").innerHTML = browser ? '<span aria-hidden="true">♧</span> 파일은 브라우저에서만 처리됩니다' : '<span aria-hidden="true">♧</span> 브라우저 검증 모드를 선택할 수 있습니다';
  $("#privacy-note").textContent = browser
    ? "공식 C2PA 웹 SDK가 브라우저에서 파일을 검사합니다. 서버 전송·보고서 저장 없이 결과를 이 화면에서만 보여줍니다. URL 검증에는 서버 모드를 사용하세요."
    : "기본 모드에서는 로컬 FastAPI 서버가 파일을 분석합니다. 브라우저 검증을 켜면 파일이 서버로 전송되지 않습니다. URL 검증은 서버에서만 가능합니다.";
}
function setMode(mode) {
  state.mode = mode;
  if (mode === "url") $("#browser-mode").checked = false;
  updateProcessingMode();
  $("#panel-file").hidden = mode !== "file"; $("#panel-url").hidden = mode !== "url";
  for (const option of ["file", "url"]) {
    const tab = $(`#tab-${option}`); tab.classList.toggle("active", option === mode);
    tab.setAttribute("aria-selected", String(option === mode));
  }
  (mode === "url" ? $("#url-input") : $("#dropzone")).focus();
}
async function responseJSON(response) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`서버 응답을 읽지 못했습니다 (${response.status}).`); }
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : body.error?.message || `요청 실패 (${response.status})`);
  return body;
}
function checksFromInspect(store, raw) {
  const checks = [];
  function visit(value, scope = "activeManifest") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const kind of ["success", "informational", "failure"])
      for (const entry of value[kind] || []) checks.push({...entry, kind, scope});
    for (const [key, child] of Object.entries(value)) {
      if (["success", "informational", "failure"].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(item => visit(item, key));
      else visit(child, key);
    }
  }
  visit(raw.validation_results || store.validation_results || {});
  for (const entry of raw.validation_status || store.validation_status || [])
    if (!checks.some(item => item.code === entry.code && item.url === entry.url))
      checks.push({...entry, kind:"failure", scope:"legacy"});
  return checks;
}
function normalizeInspectResult(raw, file, trustProfile, elapsedMs) {
  const store = raw.manifest || {};
  const manifests = store.manifests || {};
  const active = manifests[store.active_manifest] || {};
  const resultId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const actions = [];
  for (const assertion of active.assertions || [])
    if (assertion.label?.startsWith("c2pa.actions")) actions.push(...(assertion.data?.actions || []));
  const aiDeclared = actions.some(action => /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicallyEnhanced$/.test(action.digitalSourceType || ""));
  return {
    ...raw,
    id:`server_${resultId.replaceAll("-", "")}`,
    created_at:new Date().toISOString(),
    filename:raw.filename || file.name || "asset",
    size:raw.size ?? file.size,
    mime:raw.content_type || file.type || "",
    trust_profile:trustProfile,
    report_saved:false,
    processing_mode:"server",
    state:raw.state || "Unknown",
    store,
    checks:checksFromInspect(store, raw),
    signature:active.signature_info || raw.claim?.signature_info || {},
    software:active.claim_generator_info || raw.claim?.claim_generator_info || [],
    ingredients:active.ingredients || [],
    actions,
    ai:aiDeclared ? "declared" : "unknown",
    manifest_count:Object.keys(manifests).length,
    embedded:Boolean(raw.has_c2pa),
    thumbnail:null,
    manifest_thumbnails:{},
    network_policy:{remote_manifests:false, ocsp:false},
    elapsed_ms:elapsedMs
  };
}
function addResult(result, file) {
  if (file) state.localUrls.set(result.id, URL.createObjectURL(file));
  state.results.push(result); state.active = state.results.length - 1;
  state.detail = "overview"; state.selectedManifest = result.store?.active_manifest || null;
  showPage("verify", {preserveResult:true});
  render();
  window.scrollTo({top:0, behavior:"instant"});
}
async function verifyFiles(files) {
  if (state.busy) return;
  const list = [...files]; if (!list.length) return;
  if (list.length > 10) return error("한 번에 최대 10개 파일을 선택할 수 있습니다.");
  clearError(); setBusy(true); startActivity(`${list.length}개 파일 검증 시작`);
  const failures = [];
  try {
    for (const [index, file] of list.entries()) {
      progress(`${index + 1}/${list.length} · ${file.name}의 서명과 출처를 확인하고 있습니다.`);
      logActivity(`${file.name} · ${$("#browser-mode").checked ? "브라우저" : "서버"} 검증 중`);
      const suffix = file.name.split(".").pop()?.toLowerCase();
      const browser = $("#browser-mode").checked;
      const allowedExtensions = browser ? FORMAT_EXTENSIONS : SERVER_FORMAT_EXTENSIONS;
      const maxSize = browser ? BROWSER_MAX_SIZE : SERVER_MAX_SIZE;
      if (!allowedExtensions.has(suffix)) { failures.push(`${file.name}: ${browser ? "지원하지 않는 형식" : "서버 검증은 JPEG/PNG만 지원"}입니다.`); logActivity(`${file.name} · 지원하지 않는 형식`); continue; }
      if (file.size > maxSize) { failures.push(`${file.name}: ${browser ? 100 : 20} MB 이하만 허용합니다.`); logActivity(`${file.name} · 크기 제한 초과`); continue; }
      try {
        let result;
        if (browser) {
          const {verifyBrowserAsset} = await import("./browser-verify.js");
          result = await verifyBrowserAsset(file, $("#trust-profile").value);
        } else {
          const body = new FormData(); body.append("file", file, file.name);
          const started = performance.now();
          const inspected = await responseJSON(await fetch("/api/v1/assets/inspect", {method:"POST", body}));
          result = normalizeInspectResult(inspected, file, $("#trust-profile").value, Math.round(performance.now() - started));
        }
        addResult(result, file);
        logActivity(`${file.name} · ${stateLabels[result.state] || result.state} · ${result.elapsed_ms || 0} ms`);
      } catch (cause) { failures.push(`${file.name}: ${cause.message}`); logActivity(`${file.name} · 분석 오류`); }
    }
  } finally { setBusy(false); progress("", false); $("#file-input").value = ""; updateProcessingMode(); }
  if (failures.length) error(failures.join(" / "));
  logActivity(`완료 · ${list.length - failures.length}개 결과, ${failures.length}개 오류`);
}
function validRemote(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("올바른 공개 HTTPS 파일 주소를 입력해 주세요."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || (url.port && url.port !== "443"))
    throw new Error("공개 HTTPS 파일 주소만 사용할 수 있습니다.");
  return url.href;
}
async function verifyURL(raw) {
  if (state.busy) return;
  clearError();
  let url; try { url = validRemote(raw); } catch (cause) { return error(cause.message); }
  setBusy(true); startActivity("공개 HTTPS URL 검증 시작"); progress("공개 파일을 내려받아 Manifest와 서명을 검증하고 있습니다.");
  try {
    const result = await responseJSON(await fetch("/engine/api/verify-url", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({url, trust_profile:$("#trust-profile").value, save_report:!$("#private-mode").checked})
    }));
    addResult(result);
    logActivity(`${result.filename || "원격 파일"} · ${stateLabels[result.state] || result.state}`);
    if (result.report_saved) {
      const locationURL = new URL(location.href); locationURL.search = "";
      locationURL.searchParams.set("url", url);
      locationURL.searchParams.set("trust", result.trust_profile || "standard");
      history.replaceState(null, "", locationURL);
    }
  } catch (cause) { error(cause.message); logActivity(`분석 오류 · ${cause.message}`); }
  finally { setBusy(false); progress("", false); }
}
async function verifySample(sample) {
  if (state.busy) return;
  clearError(); setBusy(true); startActivity(`${sample} 샘플 검증 시작`); progress("실제 C2PA 샘플을 검증하고 있습니다.");
  try {
    if ($("#browser-mode").checked) {
      const names = {signed:"signed.jpg",tampered:"tampered.jpg",unsigned:"unsigned.jpg",ai:"ai-han-river-sunrise.png"};
      const response = await fetch(`/engine/api/samples/${encodeURIComponent(sample)}/file`);
      if (!response.ok) throw new Error("샘플 파일을 불러오지 못했습니다.");
      const blob = await response.blob();
      const file = new File([blob], names[sample] || `${sample}.jpg`, {type:blob.type});
      const {verifyBrowserAsset} = await import("./browser-verify.js");
      const result = await verifyBrowserAsset(file, $("#trust-profile").value);
      addResult(result, file);
      logActivity(`${file.name} · ${stateLabels[result.state] || result.state}`);
      return;
    }
    const params = new URLSearchParams({trust_profile:"lab", save_report:String(!$("#private-mode").checked)});
    const result = await responseJSON(await fetch(`/engine/api/samples/${encodeURIComponent(sample)}/verify?${params}`, {method:"POST"}));
    addResult(result);
    logActivity(`${result.filename} · ${stateLabels[result.state] || result.state}`);
  } catch (cause) { error(cause.message); logActivity(`분석 오류 · ${cause.message}`); }
  finally { setBusy(false); progress("", false); updateProcessingMode(); }
}
async function loadReport(id) {
  clearError(); progress("저장된 보고서를 열고 있습니다.");
  try { addResult(await responseJSON(await fetch(`/engine/api/reports/${encodeURIComponent(id)}`, {cache:"no-store"}))); }
  catch (cause) { error(cause.message); }
  finally { progress("", false); }
}
function result() { return state.results[state.active]; }
function activeManifest(item) { return item?.store?.manifests?.[item.store.active_manifest] || {}; }
function counts(item) {
  const checks = item.checks || [];
  return {success:checks.filter(c => c.kind === "success").length,
    informational:checks.filter(c => c.kind === "informational").length,
    failure:checks.filter(c => c.kind === "failure").length};
}
function previewURL(item) {
  const local = state.localUrls.get(item.id);
  if (local) return local;
  return /^data:image\/(jpeg|png|webp);base64,/i.test(item.thumbnail || "") ? item.thumbnail : null;
}
function renderPreview(item) {
  const source = previewURL(item), mime = item.mime || "";
  let content = `<div class="no-preview"><span>◇</span><strong>미리보기가 없는 파일</strong><small>${esc(mime || "형식을 확인할 수 없습니다.")}</small></div>`;
  if (source && mime.startsWith("image/")) content = `<img src="${esc(source)}" alt="검증 대상 파일 미리보기">`;
  else if (source && mime.startsWith("video/")) content = `<video src="${esc(source)}" controls preload="metadata"></video>`;
  else if (source && mime.startsWith("audio/")) content = `<audio src="${esc(source)}" controls preload="metadata"></audio>`;
  else if (source && mime === "application/pdf") content = `<div class="no-preview"><span>▤</span><strong>PDF 문서</strong><a href="${esc(source)}" target="_blank" rel="noopener">로컬 미리보기 열기 ↗</a></div>`;
  $("#preview-card").innerHTML = `<div class="preview-stage">${content}<span class="preview-tag">${esc(mime || "FILE")}</span></div><div class="preview-caption"><strong>${esc(item.filename || "파일")}</strong><small>${sizes(item.size)} · SHA-256 ${esc((item.sha256 || "").slice(0, 18))}…</small></div>`;
}
function renderSummary(item) {
  const signature = item.signature || {}, total = counts(item), active = activeManifest(item);
  const software = (item.software || []).map(s => s.name).filter(Boolean).join(", ") || active.claim_generator || "정보 없음";
  const ai = item.ai === "declared" ? "Manifest에 선언됨" : "확인 가능한 선언 없음";
  const fields = [["서명자",signature.common_name || "정보 없음"],["발급자",signature.issuer || "정보 없음"],
    ["서명 알고리즘",signature.alg || "정보 없음"],["제작 도구",software],["AI 생성 선언",ai],
    ["Manifest",`${item.manifest_count || 0}개 ${item.embedded ? "· 파일 내장" : ""}`],
    ["처리 방식",item.processing_mode === "browser" ? "브라우저 내부" : "로컬 서버"],
    ["검증 정책",item.trust_profile === "lab" ? "실험용 CA 포함" : "기본 SDK 목록"]];
  $("#summary-card").innerHTML = `<details class="technical-summary"><summary>검증 수치와 기술 정보 펼치기</summary><div class="summary-kicker">VERIFICATION OVERVIEW</div><h3>기술 정보</h3><div class="summary-checks"><span class="pass">✓ ${total.success} 통과</span><span class="info">○ ${total.informational} 안내</span><span class="fail">! ${total.failure} 오류</span></div><div class="summary-fields">${fields.map(([label,value])=>`<div><span>${term(label)}</span><strong>${label === "발급자" ? annotateIssuer(value) : label === "검증 정책" || label === "AI 생성 선언" ? annotateTerms(value) : esc(value)}</strong></div>`).join("")}</div><div class="summary-foot">검증 시각 ${when(item.created_at)}<br>서명 상태는 콘텐츠의 사실 여부를 보증하지 않습니다.</div></details>`;
}
function renderBatch() {
  const target = $("#batch-list"); target.hidden = false;
  target.innerHTML = state.results.map((item,index)=>`<button class="${index === state.active ? "active" : ""}" data-result-index="${index}" type="button"><span>${esc(item.filename)}</span><small>${esc(stateLabels[item.state] || item.state || "상태 미확인")}</small></button>`).join("");
}
function renderVerdict(item) {
  const status = item.state || "Unknown", name = stateLabels[status] || stateLabels.Unknown;
  $("#verdict").className = `verdict ${esc(status.toLowerCase())}`;
  $("#verdict").innerHTML = `<div class="verdict-icon">${status === "Trusted" || status === "Valid" ? "✓" : status === "Invalid" ? "!" : "?"}</div><div><span>파일에 기록된 출처 확인 결과</span><h3>${esc(name)}</h3><p>${annotateTerms(stateDescriptions[status] || "파일의 검증 상태를 세부 근거와 함께 확인하세요.")}</p><small class="verdict-limit">이 결과만으로 사진 속 장면의 사실 여부나 AI 생성 여부를 판정하지 않습니다. 밑줄 친 용어에 마우스를 올리면 설명이 나옵니다.</small></div>`;
}
function renderReadout(item) {
  const status=item.state || "Unknown", present=Number(item.manifest_count || Object.keys(item.store?.manifests || {}).length)>0;
  const records=present ? ["있음","파일에 C2PA 출처 기록이 연결되어 있습니다.","yes"] : status === "NoManifest" ? ["없음","이 파일에서 확인 가능한 C2PA 기록을 찾지 못했습니다.","unknown"] : status === "RemoteUnavailable" ? ["외부 기록 필요","현재 설정에서는 외부 출처 기록을 가져오지 않습니다.","unknown"] : ["판단 불가","분석이 완료되지 않아 출처 기록의 유무를 단정할 수 없습니다.","unknown"];
  const integrity=status === "Trusted" || status === "Valid" ? ["통과","서명과 파일 결합이 검증되었습니다.","yes"] : status === "Invalid" ? ["실패","검사 근거에서 실패한 항목을 확인하세요.","no"] : ["판단 불가","검증할 기록이 없거나 검사를 완료하지 못했습니다.","unknown"];
  const signer=status === "Trusted" ? ["확인","선택한 신뢰 목록에서 서명자를 확인했습니다.","yes"] : status === "Valid" ? ["미확인","서명은 유효하지만 선택한 신뢰 목록에서는 확인되지 않았습니다.","unknown"] : ["판단 불가","이 결과로 서명자의 신뢰를 확인할 수 없습니다.","unknown"];
  const entries=[["출처 기록이 있나요?",records],["서명 검사를 통과했나요?",integrity],["서명자를 확인했나요?",signer]];
  $("#readout").innerHTML=`<div class="readout-heading"><strong>3가지 질문으로 읽기</strong><span>색보다 문장을 먼저 확인하세요</span></div><div class="readout-grid">${entries.map(([question,[answer,detail,tone]])=>`<article class="readout-card ${tone}"><span class="readout-symbol" aria-hidden="true">${tone === "yes" ? "✓" : tone === "no" ? "!" : "?"}</span><div><small>${esc(question)}</small><strong>${esc(answer)}</strong><p>${annotateTerms(detail)}</p></div></article>`).join("")}</div><p class="readout-foot">${status === "NoManifest" ? `${term("C2PA")} 기록이 없다는 사실은 가짜 또는 변조의 증거가 아닙니다. 원본 파일이나 게시자의 설명을 함께 확인하세요.` : "출처 기록의 검증과 콘텐츠 내용의 진위 판단은 다른 질문입니다."}</p>`;
}
function explanationKey(item,mode){return `${item.id || state.active}:${mode}`;}
function localExplanation(item,mode){
  const status=item.state || "Unknown", failures=counts(item).failure;
  const explanations={
    Trusted:["출처 기록과 서명자 확인이 모두 끝났습니다.","서명과 파일의 연결이 검증됐고, 선택한 신뢰 목록에서 서명자도 확인됐습니다.","출처 지도와 변경 이력에서 누가 무엇을 기록했는지 살펴보세요."],
    Valid:["출처 기록은 유효하지만 서명자 신뢰는 확인되지 않았습니다.","서명 검사는 통과했지만 현재 선택한 신뢰 목록에서 서명자를 찾지 못했습니다.","제작자에게 서명 정보를 확인하거나 다른 신뢰 자료와 함께 보세요."],
    Invalid:["출처 기록 검증에 실패했습니다.","기록이나 서명 검사에 실패한 항목이 있습니다. 원인은 검사 근거를 봐야 구분할 수 있습니다.","검사 근거에서 실패한 코드를 확인하고 원본 파일을 다시 받아보세요."],
    NoManifest:["이 파일에서 C2PA 출처 기록을 찾지 못했습니다.","기록이 처음부터 없었거나 전달 과정에서 사라졌을 수 있습니다. 이 결과는 가짜 판정이 아닙니다.","가능하면 원본 파일을 받고 게시자의 설명이나 다른 자료도 확인하세요."],
    RemoteUnavailable:["외부 출처 기록이 필요해 검증을 마치지 못했습니다.","현재 설정은 외부 기록을 가져오지 않으므로 기록의 상태를 확인할 수 없습니다.","제공자에게 출처 기록이 파일 안에 포함된 원본을 요청해 보세요."],
    Error:["파일 분석을 마치지 못했습니다.","파일 형식이나 손상 등으로 검사 결과를 얻지 못했습니다. C2PA 기록 유무도 단정할 수 없습니다.","파일을 다시 다운로드하거나 다른 원본으로 재검증해 보세요."]
  };
  const [summary,meaning,next_step]=explanations[status] || ["검증 상태를 확정하지 못했습니다.","현재 결과만으로 출처 기록의 상태를 단정할 수 없습니다.","원본 파일로 다시 검증해 보세요."];
  const detail=mode === "detail" ? ` 검사 기록에는 통과 ${(item.checks || []).filter(c=>c.kind === "success").length}개, 실패 ${failures}개가 표시됩니다. ${item.ai === "declared" ? "AI 사용 선언이 기록되어 있지만 이것은 독립적인 AI 탐지가 아닙니다." : "AI 사용 선언이 보이지 않아도 AI 사용 여부를 확정할 수는 없습니다."}` : "";
  return {mode,source:"built_in",summary,meaning:meaning+detail,next_step,limit:"출처 검증은 사진 속 장면의 사실 여부, 법적 소유권 또는 AI 생성 여부를 단독으로 증명하지 않습니다."};
}
function renderAiPanel(item) {
  const simple=state.explanations.get(explanationKey(item,"simple")) || localExplanation(item,"simple");
  const detail=state.explanations.get(explanationKey(item,"detail")) || localExplanation(item,"detail");
  const output=state.explainMode === "detail" ? detail : simple;
  const availability=state.explainAvailable === true ? "AI가 검증 상태와 검사 코드만 받아 설명합니다. 파일과 원본 메타데이터는 보내지 않습니다." : "지금은 검증 결과를 바탕으로 만든 기본 설명을 제공합니다. AI 설명은 서버 API 키가 연결되면 이용할 수 있습니다.";
  $("#ai-explanation").innerHTML=`<div class="ai-explanation-head"><div><span class="ai-sparkle">✦</span><strong>AI 결과 보고서</strong><p>${esc(availability)}</p></div><div class="ai-explanation-actions"><button type="button" data-explain="simple" aria-pressed="${state.explainMode === "simple"}" ${state.explainBusy ? "disabled" : ""}>핵심 요약</button><button type="button" data-explain="detail" aria-pressed="${state.explainMode === "detail"}" ${state.explainBusy ? "disabled" : ""}>자세히 설명</button></div></div>${state.explainError ? `<p class="ai-explanation-error" role="alert">${esc(state.explainError)}</p>` : ""}${state.explainBusy ? `<p class="ai-explanation-wait" role="status">결과를 쉬운 말로 바꾸는 중…</p>` : ""}${output ? `<div class="ai-explanation-output"><span>${output.source === "ai" ? "AI가 작성한 설명" : "검증 결과 기본 해설"} · ${state.explainMode === "detail" ? "자세히" : "요약"}</span><h4>${esc(output.summary)}</h4><p><b>무슨 뜻인가요?</b> ${esc(output.meaning)}</p><p><b>다음에는?</b> ${esc(output.next_step)}</p><small>${esc(output.limit)}</small></div>` : ""}`;
}
async function checkExplainAvailability(){
  try {const health=await responseJSON(await fetch("/engine/api/health",{cache:"no-store"}));state.explainAvailable=health.ai_explanation === true;}
  catch {state.explainAvailable=false;}
  if(result())renderAiPanel(result());
}
async function explainCurrent(mode){
  const item=result();if(!item || state.explainBusy)return;
  state.explainMode=mode;
  const key=explanationKey(item,mode);
  const cached=state.explanations.get(key);
  if(cached && (cached.source === "ai" || state.explainAvailable !== true)){renderAiPanel(item);return;}
  if(state.explainAvailable !== true){state.explanations.set(key,localExplanation(item,mode));renderAiPanel(item);return;}
  state.explainBusy=true;state.explainError="";renderAiPanel(item);
  try {
    const checks=(item.checks || []).slice(0,20).filter(check=>["success","failure","informational"].includes(check.kind))
      .map(check=>({kind:check.kind,code:String(check.code || "").replace(/[^A-Za-z0-9_.:-]/g,"").slice(0,100)}));
    const payload={mode,state:stateLabels[item.state] ? item.state : "Unknown",manifest_count:Math.min(1000,Math.max(0,Number(item.manifest_count || 0))),ai_declaration:item.ai === "declared" ? "declared" : item.ai === "not_declared" ? "not_declared" : "unknown",checks};
    const explanation=await responseJSON(await fetch("/engine/api/explain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));
    state.explanations.set(key,explanation);
  } catch(cause){state.explanations.set(key,localExplanation(item,mode));state.explainError="AI 연결이 되지 않아 기본 설명을 표시했습니다.";}
  finally {state.explainBusy=false;if(result())renderAiPanel(result());}
}
function renderActions(item) {
  const labels = {"c2pa.created":"콘텐츠 생성","c2pa.edited":"콘텐츠 편집","c2pa.opened":"파일 열기","c2pa.placed":"재료 삽입","c2pa.resized":"크기 변경","c2pa.cropped":"자르기","c2pa.published":"발행","c2pa.transcoded":"인코딩 변경"};
  const actions = item.actions || [];
  if (!actions.length) return `<p class="empty">Manifest에 기록된 작업 이력이 없습니다.</p>`;
  return `<ol class="timeline">${actions.map(action=>`<li><span>${esc(labels[action.action] || action.action || "작업")}</span><small>${esc(action.action || "")}</small><p>${esc(typeof action.softwareAgent === "object" ? JSON.stringify(action.softwareAgent) : action.softwareAgent || "제작 도구 정보 없음")}${action.when ? ` · ${esc(action.when)}` : ""}</p>${action.digitalSourceType ? `<code>${esc(action.digitalSourceType)}</code>` : ""}</li>`).join("")}</ol>`;
}
function renderChain(item) {
  const store = item.store || {}, manifests = store.manifests || {};
  const keys = Object.keys(manifests).sort((a,b)=>Number(a === store.active_manifest)-Number(b === store.active_manifest));
  if (!keys.length) return `<p class="empty">연결된 Manifest가 없습니다.</p>`;
  return `<div class="chain">${keys.map((id,index)=>{
    const node=manifests[id] || {}, sig=node.signature_info || {}, thumb=item.manifest_thumbnails?.[id];
    const safeThumb=/^data:image\/(jpeg|png|webp);base64,/i.test(thumb || "") ? `<img src="${esc(thumb)}" alt="Manifest 썸네일">` : `<span class="chain-fallback">${index+1}</span>`;
    const parents=(node.ingredients || []).map(x=>x.title || x.relationship || "재료").join(", ");
    return `<article class="chain-card ${id === store.active_manifest ? "active" : ""}"><div class="chain-thumb">${safeThumb}</div><div><span>${id === store.active_manifest ? "활성 Manifest · 현재 파일" : "이전 Manifest / 연결된 재료"}</span><h4>${esc(node.title || item.filename || "파일")}</h4><p>서명자 ${esc(sig.common_name || sig.issuer || "정보 없음")} · ${esc(node.format || item.mime || "형식 미상")}</p>${parents ? `<small>재료: ${esc(parents)}</small>` : ""}<code>${esc(id)}</code></div></article>`;
  }).join("")}</div>`;
}
function renderOverview(item) {
  const c = counts(item), signature = item.signature || {};
  if(item.state === "NoManifest") return `<div class="no-credential"><div class="no-credential-art" aria-hidden="true"><span>▧</span><i></i><b>?</b></div><h3>이 파일에는 확인할 출처 기록이 없습니다</h3><p>${term("C2PA")} 기록이 처음부터 없었거나, 전달·편집 과정에서 사라졌을 수 있습니다. 이 화면만으로 진짜·가짜를 판단할 수 없습니다.</p><ol><li>가능하면 촬영·제작자가 보낸 원본 파일을 확인하세요.</li><li>게시물의 설명이나 다른 신뢰할 수 있는 출처도 함께 살펴보세요.</li><li>원본에 기록이 있다면 다시 업로드해 비교해 보세요.</li></ol><button type="button" data-go-detail="structure">기록이 없는 경우의 그림 보기 →</button></div>`;
  const needsChecks=item.state === "Invalid" || item.state === "Error";
  return `<div class="next-step"><strong>${item.state === "Invalid" ? "다음으로 할 일: 실패 원인 확인" : item.state === "Error" ? "다음으로 할 일: 파일 다시 확인" : item.state === "RemoteUnavailable" ? "다음으로 할 일: 외부 기록 확인" : "다음으로 할 일: 기록 내용 살펴보기"}</strong><p>${item.state === "Invalid" ? "검사 근거에서 어떤 항목이 실패했는지 확인하고 원본 파일을 다시 받아보세요." : item.state === "Error" ? "분석을 마치지 못했습니다. 파일 형식과 손상 여부를 확인한 뒤 다시 검증해 보세요." : item.state === "RemoteUnavailable" ? "이 파일의 기록이 외부에 있어 현재 설정으로는 확인할 수 없습니다. 원본 제공자에게 내장 기록이 있는 파일을 요청해 보세요." : "누가 서명했는지와 어떤 편집이 기록됐는지 출처 지도와 변경 이력에서 확인하세요."}</p><button type="button" data-go-detail="${needsChecks ? "checks" : "structure"}">${needsChecks ? "검사 근거 보기" : "출처 지도 보기"} →</button></div><div class="insight-grid"><article><span>검사 항목</span><strong>${c.success + c.informational + c.failure}</strong><p>${c.failure ? `${c.failure}개 오류를 우선 확인하세요.` : "검사 기록 수"}</p></article><article><span>제작·편집</span><strong>${(item.actions || []).length}</strong><p>기록된 작업 수</p></article><article><span>연결된 출처</span><strong>${(item.ingredients || []).length}</strong><p>이전 재료 수</p></article></div><div class="overview-split"><div><h3>이 파일에서 확인한 것</h3><ul><li>${term("서명자")}: <b>${esc(signature.common_name || "정보 없음")}</b></li><li>${term("AI 생성 선언")}: <b>${item.ai === "declared" ? "있음" : "확인되지 않음"}</b></li><li>${term("신뢰 목록")}: <b>${term(item.trust_profile === "lab" ? "실험용 CA 포함" : "기본 SDK 목록")}</b></li><li>외부 기록 자동 조회: <b>하지 않음</b></li></ul></div><div class="overview-note"><strong>이 결과로 알 수 없는 것</strong><p>서명 검증은 서명 이후 파일의 ${term("무결성")}과 기록된 출처를 확인합니다. 사진 속 장면이 사실인지, 법적 소유권이 누구에게 있는지는 단독으로 증명하지 않습니다.</p></div></div><h3 class="subhead">기록된 출처 연결</h3>${renderChain(item)}`;
}
function renderChecks(item) {
  const list = [...(item.checks || [])].sort((a,b)=>({failure:0,informational:1,success:2}[a.kind] ?? 3)-({failure:0,informational:1,success:2}[b.kind] ?? 3));
  const shown = state.checkFilter === "all" ? list : list.filter(c => c.kind === state.checkFilter);
  return `<div class="filter-bar"><div><button data-check-filter="all" class="${state.checkFilter === "all" ? "active" : ""}">전체 ${list.length}</button><button data-check-filter="failure" class="${state.checkFilter === "failure" ? "active" : ""}">오류 ${list.filter(c=>c.kind === "failure").length}</button><button data-check-filter="informational" class="${state.checkFilter === "informational" ? "active" : ""}">안내 ${list.filter(c=>c.kind === "informational").length}</button><button data-check-filter="success" class="${state.checkFilter === "success" ? "active" : ""}">통과 ${list.filter(c=>c.kind === "success").length}</button></div><small>실패 항목 우선 정렬</small></div>${shown.length ? `<div class="check-rows">${shown.map(check=>`<article class="check ${esc(check.kind)}"><span class="check-mark">${check.kind === "failure" ? "!" : check.kind === "success" ? "✓" : "i"}</span><div><strong>${hintText(check.code || "검증 항목",check.explanation || check.message || "공식 SDK가 제공한 검사 코드입니다.")}</strong><p>${esc(check.explanation || check.message || "설명 정보 없음")}</p><small>${term(check.scope || "Manifest")}</small></div><b>${check.kind === "failure" ? "오류" : check.kind === "success" ? "통과" : "안내"}</b></article>`).join("")}</div>` : `<p class="empty">표시할 검증 항목이 없습니다.</p>`}<p class="small-note">개별 검사 코드와 전체 상태는 공식 SDK 응답을 사용합니다. 인증서 신뢰와 파일 변조는 서로 다른 원인입니다.</p>`;
}
function renderJsonTree(value,depth=0) {
  if(value === null || typeof value !== "object") return `<span class="json-value">${esc(JSON.stringify(value))}</span>`;
  if(depth >= 5) return `<span class="json-value">${esc(Array.isArray(value) ? `[${value.length}개 항목]` : `{${Object.keys(value).length}개 항목}`)}</span>`;
  const entries=Object.entries(value), shown=entries.slice(0,60);
  return `<div class="json-children" data-scroll-region>${shown.map(([key,child])=>`<div class="json-row"><span class="json-key">${term(key)}</span>${child && typeof child === "object" ? `<details class="json-branch"><summary>${Array.isArray(child) ? `[${child.length}개 항목]` : `{${Object.keys(child).length}개 항목}`}</summary>${renderJsonTree(child,depth+1)}</details>` : renderJsonTree(child,depth+1)}</div>`).join("")}${entries.length>shown.length ? `<p class="json-truncated">${entries.length-shown.length}개 항목은 전체 JSON 다운로드에서 확인하세요.</p>` : ""}</div>`;
}
function renderJsonBox(label,value,open=false){return `<details class="code-details" ${open ? "open" : ""}><summary>${esc(label)}</summary><p class="scroll-hint">마우스를 이 영역 위에 놓고 스크롤하면 이 상자만 움직입니다. 끝에 닿으면 바깥 결과가 움직입니다.</p>${renderJsonTree(value)}<details class="json-raw"><summary>원문 텍스트 보기</summary><pre data-scroll-region>${esc(JSON.stringify(value,null,2))}</pre></details></details>`;}
function renderHistory(item) {
  return `<div class="history-intro"><h3>파일의 제작·편집 기록</h3><p>활성 ${term("Manifest")}에 기록된 작업 순서입니다. 파일에 기록되지 않은 단계는 추정하지 않습니다.</p></div>${renderActions(item)}<h3 class="subhead">Manifest와 재료 연결</h3>${renderChain(item)}${(item.ingredients || []).length ? renderJsonBox("이전 재료 기록 보기",item.ingredients) : ""}`;
}
function renderManifest(item) {
  const store = item.store || {}, manifests = store.manifests || {}, ids = Object.keys(manifests);
  if (!ids.length) return `<p class="empty">열 수 있는 C2PA Manifest가 없습니다.</p>`;
  if (!state.selectedManifest || !manifests[state.selectedManifest]) state.selectedManifest = store.active_manifest || ids[0];
  const selected = manifests[state.selectedManifest], sig = selected.signature_info || {};
  const assertionLabels = (selected.assertions || []).map(a=>a.label || "이름 없음");
  return `<div class="manifest-head"><label>${term("Manifest")} 선택 <select id="manifest-select">${ids.map(id=>`<option value="${esc(id)}" ${id === state.selectedManifest ? "selected" : ""}>${esc(id === store.active_manifest ? `활성 · ${id}` : id)}</option>`).join("")}</select></label><button id="manifest-download" type="button">전체 JSON 저장 ↓</button></div><div class="manifest-facts"><div><span>${term("서명자")}</span><strong>${esc(sig.common_name || "정보 없음")}</strong></div><div><span>${term("발급자")}</span><strong>${annotateIssuer(sig.issuer || "정보 없음")}</strong></div><div><span>${term("알고리즘")}</span><strong>${esc(sig.alg || "정보 없음")}</strong></div><div><span>${term("Assertion")}</span><strong>${assertionLabels.length}개</strong></div></div><h3 class="subhead">포함된 기록</h3><div class="assertions">${assertionLabels.length ? assertionLabels.map(label=>`<span>${esc(label)}</span>`).join("") : "<p>표시할 Assertion이 없습니다.</p>"}</div>${renderJsonBox("서명 정보",sig)}${renderJsonBox("선택한 출처 기록",selected,true)}${renderJsonBox("전체 출처 기록 묶음",store)}`;
}
function renderMetadata(item) {
  const image=item.image_info || {}, browser=item.processing_mode === "browser", rows=[
    ["파일명",item.filename],["형식",item.mime],["파일 크기",sizes(item.size)],
    ["해상도",image.width && image.height ? `${image.width} × ${image.height}` : (item.dimensions || []).join(" × ") || "정보 없음"],
    ["색상 모드",image.mode || "정보 없음"],["ICC 프로필",browser ? "브라우저 모드 미확인" : image.has_icc_profile ? "있음" : "확인되지 않음"],
    ["GPS 메타데이터",browser ? "브라우저 모드 미확인" : image.gps_present ? "있음 · 좌표는 표시하지 않음" : "없음 또는 확인 불가"],
    ["SHA-256",item.sha256],["SHA3-256",item.sha3_256],[browser ? "브라우저 검증 시각" : "서버 검증 시각",when(item.created_at)]
  ];
  return `<div class="metadata-table">${rows.map(([name,value])=>`<div><span>${term(name)}</span><strong>${esc(value || "정보 없음")}</strong></div>`).join("")}</div>${Object.keys(image.metadata || {}).length ? `<h3 class="subhead">이미지 ${term("메타데이터")}</h3><div class="metadata-table">${Object.entries(image.metadata).map(([key,value])=>`<div><span>${term(key)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>` : ""}<p class="small-note">${term("EXIF")} 등 일반 ${term("메타데이터")}는 수정될 수 있습니다. 서명된 C2PA 근거와 별도로 읽으세요.</p>`;
}
function shortSvg(value, max=25) {
  const text=String(value ?? "정보 없음");
  return esc(text.length>max ? `${text.slice(0,max-1)}…` : text);
}
function graphNode(id,x,y,width,title,subtitle,tone="neutral") {
  const colors={neutral:["#ffffff","#ccdaec"],good:["#eafbf3","#9edfc2"],bad:["#fff0f0","#efb1b8"],unknown:["#fff8e8","#ebd19a"],blue:["#eef4ff","#a7c2f9"]};
  const [fill,stroke]=colors[tone] || colors.neutral;
  return `<g class="map-node" data-node="${id}" tabindex="0" role="button" aria-label="${esc(title)}: ${esc(subtitle)}"><title>${esc(title)}: ${esc(subtitle)}</title><rect x="${x}" y="${y}" width="${width}" height="96" rx="17" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${x+18}" y="${y+34}" class="node-title">${esc(title)}</text><text x="${x+18}" y="${y+63}" class="node-subtitle">${shortSvg(subtitle,Math.floor(width/11))}</text><circle cx="${x+width-23}" cy="${y+23}" r="11" fill="#fff" stroke="${stroke}"/><text x="${x+width-23}" y="${y+28}" text-anchor="middle" class="node-hint">?</text></g>`;
}
function buildStructureSvg(item) {
  const manifests=Object.keys(item.store?.manifests || {}), hasManifest=manifests.length>0;
  const active=activeManifest(item), signature=active.signature_info || item.signature || {};
  const assertions=(active.assertions || []).length, ingredients=(item.ingredients || []).length, actions=(item.actions || []).length;
  const stateName=stateLabels[item.state] || "상태 미확인";
  const tone=item.state === "Trusted" || item.state === "Valid" ? "good" : item.state === "Invalid" ? "bad" : "unknown";
  const path=(x1,y1,x2,y2,dashed=false)=>`<path d="M${x1} ${y1} L${x2} ${y2}" class="edge${dashed ? " dashed" : ""}" marker-end="url(#arrow)"/>`;
  const common=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 700" role="img" aria-label="${esc(item.filename || "파일")}의 C2PA 출처 지도"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#7185a6" stroke-width="2"/></marker><style>text{font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;fill:#132747}.title{font-size:28px;font-weight:800}.subtitle{font-size:15px;fill:#667a98}.stage{font-size:13px;font-weight:800;fill:#5171a5}.node-title{font-size:18px;font-weight:800}.node-subtitle{font-size:13px;fill:#5f7593}.node-hint{font-size:13px;font-weight:800;fill:#4167a5}.edge{fill:none;stroke:#7185a6;stroke-width:2.5}.dashed{stroke-dasharray:6 7}.footer{font-size:14px;font-weight:700;fill:#5e7391}</style></defs><rect x="1" y="1" width="758" height="698" rx="24" fill="#f7faff" stroke="#dbe7f6" stroke-width="2"/><text x="36" y="49" class="title">이 파일의 출처는 어떻게 연결되나요?</text><text x="36" y="75" class="subtitle">위에서 아래로 읽고, 각 칸에 마우스를 올리면 뜻이 나타납니다.</text><text x="38" y="117" class="stage">1  지금 확인한 파일</text>${graphNode("file",36,128,688,"콘텐츠 파일",item.filename || "파일","blue")}`;
  if(!hasManifest) {
    const absent=item.state === "NoManifest";
    return `${common}<text x="38" y="264" class="stage">2  출처 기록 찾기</text>${path(380,224,380,281,true)}${graphNode("missing",145,284,470,absent ? "C2PA 기록을 찾지 못함" : "기록 확인을 완료하지 못함",absent ? "서명된 출처 정보가 표시되지 않음" : "오류 또는 외부 기록으로 현재 확인 불가","unknown")}${path(380,380,380,434,true)}<text x="38" y="417" class="stage">3  이 결과의 의미</text>${graphNode("result",145,439,470,"진위 판단 불가",absent ? "기록 없음 ≠ 가짜 판정" : "C2PA 유무도 단정하지 않음","unknown")}<text x="38" y="585" class="footer">원본 파일과 다른 근거를 함께 확인하세요.</text><text x="38" y="613" class="subtitle">${absent ? "파일이 C2PA를 지원하지 않거나 유통 중 기록이 사라졌을 수 있습니다." : "검사 근거와 오류 안내를 확인한 뒤 다시 검증해 보세요."}</text></svg>`;
  }
  const signed=item.state === "Trusted" || item.state === "Valid";
  return `${common}<text x="38" y="261" class="stage">2  파일에 연결된 출처 기록</text>${path(380,224,380,272)}${graphNode("manifest",36,283,688,"C2PA 출처 기록",`${manifests.length}개 Manifest ${item.embedded ? "· 파일 내장" : "· 외부 연결 가능"}`,"blue")}<text x="38" y="417" class="stage">3  기록 안에서 확인할 항목</text>${path(380,379,380,418)}<path d="M380 418 L380 431 M134 431 L626 431" class="edge"/>${path(134,431,134,443)}${path(380,431,380,443)}${path(626,431,626,443)}${graphNode("signer",35,446,211,"서명",signature.common_name || "서명자 정보 없음",signed ? "good" : "neutral")}${graphNode("actions",274,446,211,"변경 이력",`${actions}개 작업 · ${assertions}개 기록`,"neutral")}${graphNode("ingredients",513,446,211,"이전 재료",`${ingredients}개 연결`,"neutral")}${path(380,542,380,568)}<text x="38" y="568" class="stage">4  검증 결과</text>${graphNode("result",145,578,470,stateName,item.state === "Invalid" ? "실패 항목을 확인하세요" : "내용의 사실 여부는 별도 확인",tone)}</svg>`;
}
function structureImageSource(item) { return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(buildStructureSvg(item))}`; }
function structureNodeDetails(item){
  const manifest=activeManifest(item), signature=manifest.signature_info || item.signature || {};
  return {
    file:["현재 파일","지금 업로드하거나 주소로 불러온 파일입니다. 출처 정보와 실제 파일이 맞게 연결됐는지 검사합니다."],
    missing:item.state === "NoManifest" ? ["C2PA 기록 없음","이 파일에서 확인 가능한 출처 기록을 찾지 못했습니다. 가짜 또는 변조라는 판정은 아닙니다."] : ["기록 확인 미완료","분석 오류 또는 외부 기록 때문에 출처 기록의 유무를 확인하지 못했습니다."],
    manifest:["출처 기록 묶음",`${Object.keys(item.store?.manifests || {}).length}개 기록이 연결되어 있습니다. 제작·편집·서명 정보가 포함될 수 있습니다.`],
    signer:["누가 서명했나요?",`${signature.common_name || "서명자 정보 없음"}. 서명자의 이름과 신뢰 목록 검사는 별도로 읽어야 합니다.`],
    actions:["어떤 작업이 기록됐나요?",`${(item.actions || []).length}개 작업과 ${(manifest.assertions || []).length}개 세부 기록이 있습니다. 기록에 없는 편집은 추정하지 않습니다.`],
    ingredients:["어떤 재료를 사용했나요?",`${(item.ingredients || []).length}개 이전 재료가 연결되어 있습니다. 0개면 기록된 재료가 없다는 뜻입니다.`],
    result:["무엇을 결론낼 수 있나요?",`${stateLabels[item.state] || "상태 미확인"}. C2PA 검증은 출처 기록의 상태이며 장면의 사실 여부나 AI 생성 여부를 단독 판정하지 않습니다.`]
  };
}
function renderStructure(item) {
  const source=structureImageSource(item), alt=`${item.filename || "콘텐츠 파일"}의 출처 구조 그림. ${Object.keys(item.store?.manifests || {}).length}개 출처 기록.`;
  return `<div class="structure-toolbar"><div><h3>출처 지도</h3><p>파일에서 읽은 기록으로 그렸습니다. 칸에 마우스를 올리거나 Tab 키로 선택해 보세요.</p></div><div class="structure-tools"><button id="structure-expand" type="button">크게 보기 ↗</button><button id="structure-download" type="button">그림 저장 ↓</button></div></div>
    <figure class="structure-figure">${buildStructureSvg(item)}<figcaption>실선은 파일에 기록된 연결입니다. 점선은 기록을 찾지 못해 판단할 수 없음을 뜻합니다.</figcaption></figure><div id="node-inspector" class="node-inspector" aria-live="polite"><strong>그림 읽는 법</strong><p>위에서 아래로 읽으세요. 각 칸에 커서를 올리면 이곳에 쉬운 설명이 나타납니다.</p></div>
    <dialog id="structure-dialog" class="structure-dialog" aria-label="출처 구조 그림 크게 보기"><form method="dialog"><button type="submit" aria-label="닫기">닫기 ×</button></form><img src="${source}" alt="${esc(alt)}"></dialog>
    <p class="structure-warning">이 그림은 결과를 이해하기 위한 요약입니다. 서명 검사 세부 내용은 검사 근거에서 확인하세요.</p>`;
}
function publicReferences(item) {
  const store=item.store || {}, found=[]; const seen=new Set();
  function walk(value,path="",depth=0) {
    if (depth>10 || found.length>=30) return;
    if (typeof value === "string" && /https:\/\//i.test(value) && /(anchor|blockchain|explorer|registry|transaction|txid|proof|timestamp)/i.test(path)) {
      for (const match of value.match(/https:\/\/[^\s<>"']+/g) || []) {
        try {const u=new URL(match); if(u.protocol === "https:" && u.href.length<2000 && !seen.has(u.href)) {seen.add(u.href);found.push({path,url:u.href});}} catch {}
      }
    } else if (Array.isArray(value)) value.forEach((child,index)=>walk(child,`${path}[${index}]`,depth+1));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key,child])=>walk(child,path ? `${path}.${key}` : key,depth+1));
  }
  for (const manifest of Object.values(store.manifests || {})) for (const assertion of manifest.assertions || []) walk(assertion.data, assertion.label || "assertion");
  return found;
}
function renderAnchors(item) {
  const references=publicReferences(item), signature=item.signature || {};
  return `<div class="anchor-intro"><h3>공개 검증 참조</h3><p>${term("Manifest")}에 명시된 공개 참조만 보여줍니다. 외부 사이트의 기록 존재, 블록체인 확정, 소유권은 이 화면에서 자동 검증하지 않습니다.</p></div>${references.length ? `<div class="reference-list">${references.map(ref=>`<article><span>MANIFEST REFERENCE</span><code>${esc(ref.path)}</code><a href="${esc(ref.url)}" target="_blank" rel="noopener noreferrer">공개 참조 열기 ↗</a><small>${esc(ref.url)}</small></article>`).join("")}</div>` : `<div class="empty-anchor"><span>◇</span><h4>공개 앵커 정보가 없습니다.</h4><p>이 파일의 ${term("Manifest")}에서 블록체인 또는 공개 레지스트리 참조를 찾지 못했습니다. C2PA 서명 검증 결과와는 별개의 정보입니다.</p></div>`}<div class="timestamp-note"><strong>${term("서명 시간 정보")}</strong><p>${esc(signature.time || signature.timestamp || "인증된 타임스탬프 정보가 제공되지 않았습니다.")}</p><small>시간 문자열이 있어도 ${term("TSA")} 신뢰 검증 결과와 구분해서 읽어야 합니다.</small></div>`;
}
function renderDetail() {
  const item=result(); if (!item) return;
  $$('[data-detail]').forEach(tab=>tab.classList.toggle("active",tab.dataset.detail===state.detail));
  $("#readout").hidden=state.detail!=="overview";
  const target=$("#detail-panel");
  target.innerHTML = state.detail === "checks" ? renderChecks(item) : state.detail === "history" ? renderHistory(item)
    : state.detail === "structure" ? renderStructure(item) : state.detail === "manifest" ? renderManifest(item) : state.detail === "metadata" ? renderMetadata(item)
    : state.detail === "anchors" ? renderAnchors(item) : renderOverview(item);
}
function compareRow(label,a,b) { return `<div class="compare-row"><span>${esc(label)}</span><strong>${esc(a ?? "—")}</strong><strong>${esc(b ?? "—")}</strong></div>`; }
function renderCompare() {
  const section=$("#compare-section"); section.hidden=state.results.length<2;
  if (section.hidden) return;
  const choices=state.results.map((item,index)=>`<option value="${index}">${esc(item.filename)} · ${esc(stateLabels[item.state] || item.state)}</option>`).join("");
  for(const name of ["a","b"]) {const select=$(`#compare-${name}`), previous=Number(select.value);select.innerHTML=choices;select.value=String(Number.isInteger(previous)&&previous>=0&&previous<state.results.length ? previous : name === "a" ? 0 : state.results.length-1);}
  if($("#compare-a").value===$("#compare-b").value)$("#compare-b").value=$("#compare-a").value===String(state.results.length-1) ? "0" : String(state.results.length-1);
  const a=state.results[Number($("#compare-a").value)],b=state.results[Number($("#compare-b").value)];
  const ca=counts(a),cb=counts(b);
  $("#compare-grid").innerHTML=`<div class="compare-header"><span>비교 항목</span><strong>${esc(a.filename)}</strong><strong>${esc(b.filename)}</strong></div>${compareRow("검증 상태",stateLabels[a.state] || a.state,stateLabels[b.state] || b.state)}${compareRow("서명자",a.signature?.common_name,b.signature?.common_name)}${compareRow("AI 선언",a.ai === "declared" ? "있음" : "확인되지 않음",b.ai === "declared" ? "있음" : "확인되지 않음")}${compareRow("검증 오류",ca.failure,cb.failure)}${compareRow("Manifest",a.manifest_count || 0,b.manifest_count || 0)}${compareRow("SHA-256",a.sha256,b.sha256)}<p>동일한 해시는 동일 파일 바이트를 뜻합니다. 상태 차이가 있으면 신뢰 정책과 검증 시각도 확인하세요.</p>`;
}
function render() {
  const item=result(); $("#results").hidden=!item; if(!item)return;
  document.body.classList.add("has-results");
  $("#file-count").textContent=`${state.results.length} / 10`;
  $("#preview-filename").textContent=item.filename || "파일 미리보기";
  $("#preview-subtitle").textContent=`${(item.mime || "파일").split("/").pop().toUpperCase()} · ${sizes(item.size)}`;
  renderBatch(); renderVerdict(item); renderReadout(item); renderAiPanel(item); renderPreview(item); renderSummary(item); renderDetail(); renderCompare();
  const saved=item.report_saved !== false;
  $("#copy-live").hidden=!saved || !item.source_url;
  $("#copy-report").hidden=!saved || !item.id;
  $("#delete-report").hidden=!saved || !item.id;
}
function exportBlob(data,name,type) {
  const url=URL.createObjectURL(new Blob([data],{type}));
  const link=document.createElement("a"); link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function reportName(item,suffix) {return `${(item.filename || "file").replace(/[^\p{L}\p{N}._-]/gu,"_")}-c2pa-report.${suffix}`;}
function copy(value) {navigator.clipboard.writeText(value).then(()=>toast("링크를 복사했습니다.")).catch(()=>toast(value));}
function reportURL(id) {const url=new URL("/viewer/",location.origin);url.searchParams.set("report",id);return url.href;}
function liveURL(item) {const url=new URL("/viewer/",location.origin);url.searchParams.set("url",item.source_url);url.searchParams.set("trust",item.trust_profile || "standard");return url.href;}

$("#tab-file").onclick=()=>setMode("file"); $("#tab-url").onclick=()=>setMode("url");
$("#browser-mode").onchange=updateProcessingMode;
function updateTrustProfileNote(){
  const selected=$("#trust-profile").value;
  $("#trust-profile-note").innerHTML=selected === "lab"
    ? `${term("실험용 CA 포함")} · ${term("CA")}는 인증서를 발급하는 기관입니다. 이 설정은 프로젝트 샘플용 신뢰 기준을 추가하므로 실제 파일의 공인 신뢰와 구분해서 읽으세요.`
    : `${term("기본 SDK 목록")} · ${term("CA")}는 인증서를 발급하는 기관입니다. 실험용 CA는 추가하지 않으므로 샘플의 서명이 유효해도 신뢰는 미확인일 수 있습니다.`;
}
$("#trust-profile").addEventListener("change",updateTrustProfileNote);
$("#dropzone").onclick=()=>{if(!state.busy)$("#file-input").click();};
$("#dropzone").onkeydown=event=>{if(event.key === "Enter" || event.key === " "){event.preventDefault();$("#file-input").click();}};
$("#file-input").onchange=event=>verifyFiles(event.target.files);
for(const kind of ["dragenter","dragover"])$("#dropzone").addEventListener(kind,event=>{event.preventDefault();$("#dropzone").classList.add("dragging");});
for(const kind of ["dragleave","drop"])$("#dropzone").addEventListener(kind,event=>{event.preventDefault();$("#dropzone").classList.remove("dragging");});
$("#dropzone").addEventListener("drop",event=>verifyFiles(event.dataTransfer.files));
$("#url-form").onsubmit=event=>{event.preventDefault();verifyURL($("#url-input").value.trim());};
$$("[data-sample]").forEach(button=>button.onclick=()=>verifySample(button.dataset.sample));
function showIntake(){navigatePage("verify");window.scrollTo({top:0,behavior:"instant"});setMode(state.mode);}
$("#new-check").onclick=showIntake;
$("#new-check-secondary").onclick=showIntake;
$("#batch-list").onclick=event=>{const button=event.target.closest("[data-result-index]");if(!button)return;state.active=Number(button.dataset.resultIndex);state.selectedManifest=result().store?.active_manifest || null;render();};
$(".detail-tabs").onclick=event=>{const button=event.target.closest("[data-detail]");if(!button)return;state.detail=button.dataset.detail;renderDetail();};
$("#detail-panel").onclick=event=>{const button=event.target.closest("[data-check-filter]");if(button){state.checkFilter=button.dataset.checkFilter;renderDetail();}const jump=event.target.closest("[data-go-detail]");if(jump){state.detail=jump.dataset.goDetail;renderDetail();$("#detail-panel").scrollIntoView({block:"nearest",behavior:"smooth"});}if(event.target.closest("#manifest-download")){const item=result();exportBlob(JSON.stringify(item.store || {},null,2),reportName(item,"manifest.json"),"application/json");}if(event.target.closest("#structure-download")){const item=result();exportBlob(buildStructureSvg(item),reportName(item,"structure.svg"),"image/svg+xml;charset=utf-8");toast("출처 구조 그림을 저장했습니다.");}if(event.target.closest("#structure-expand"))$("#structure-dialog").showModal();};
$("#detail-panel").onchange=event=>{if(event.target.id === "manifest-select"){state.selectedManifest=event.target.value;renderDetail();}};
function describeMapNode(event){
  const node=event.target.closest?.("[data-node]");if(!node || !$("#node-inspector"))return;
  const description=structureNodeDetails(result())[node.dataset.node];if(!description)return;
  $("#node-inspector").innerHTML=`<strong>${esc(description[0])}</strong><p>${esc(description[1])}</p>`;
  $$(".map-node").forEach(part=>part.classList.toggle("selected",part === node));
}
$("#detail-panel").addEventListener("mouseover",describeMapNode);
$("#detail-panel").addEventListener("focusin",describeMapNode);
$("#detail-panel").addEventListener("click",describeMapNode);
$(".report-scroll").addEventListener("wheel",event=>{
  if(Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  let region=event.target.closest?.("[data-scroll-region]");
  while(region && $(".report-scroll").contains(region)){
    const movable=event.deltaY>0 ? region.scrollTop+region.clientHeight<region.scrollHeight-1 : region.scrollTop>1;
    if(movable){event.preventDefault();region.scrollTop+=event.deltaY;return;}
    region=region.parentElement?.closest("[data-scroll-region]");
  }
},{passive:false});
$("#ai-explanation").addEventListener("click",event=>{const button=event.target.closest("[data-explain]");if(button)explainCurrent(button.dataset.explain);});
$("#copy-live").onclick=()=>copy(liveURL(result()));
$("#copy-report").onclick=()=>copy(reportURL(result().id));
$("#download-json").onclick=()=>{const item=result();exportBlob(JSON.stringify(item,null,2),reportName(item,"json"),"application/json");};
$("#download-pdf").onclick=()=>{
  const item=result();if(!item)return;
  $("#report-dialog-file").textContent=`${item.filename || "파일"} · ${stateLabels[item.state] || "상태 미확인"}`;
  $("#report-error").hidden=true;
  $("#report-dialog").showModal();
};
$("#report-close").onclick=()=>$("#report-dialog").close();
$("#report-dialog").addEventListener("click",event=>{if(event.target === $("#report-dialog"))$("#report-dialog").close();});
$("#report-generate").onclick=async()=>{
  const item=result();if(!item)return;
  const type=$("input[name=report-type]:checked")?.value || "summary";
  const button=$("#report-generate"),notice=$("#report-error");
  button.disabled=true;button.textContent="PDF 만드는 중…";notice.hidden=true;
  try{
    const {buildPdfReport}=await import("./pdf-report.js?v=20261021-choices2");
    const bytes=await buildPdfReport(item,type);
    exportBlob(bytes,reportName(item,`${type}.pdf`),"application/pdf");
    $("#report-dialog").close();toast("선택한 PDF 보고서를 저장했습니다.");
  }catch(cause){notice.textContent=`PDF를 만들지 못했습니다: ${cause.message}`;notice.hidden=false;}
  finally{button.disabled=false;button.textContent="선택한 PDF 다운로드 ↓";}
};
$("#download-html").onclick=()=>{const item=result();if(item.report_saved !== false){location.href=`/engine/api/reports/${encodeURIComponent(item.id)}/download?format=html`;return;}const source=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>PQ-C2PA 검증 보고서</title><style>body{font:16px sans-serif;max-width:900px;margin:45px auto;padding:20px;line-height:1.6}pre{overflow:auto;padding:22px;background:#f5eee4;font-size:12px}</style><h1>${esc(item.filename)} · ${esc(stateLabels[item.state] || item.state)}</h1><p>${item.processing_mode === "browser" ? "브라우저 안에서 생성한 보고서입니다. 파일은 서버로 전송되지 않았습니다." : "서버 기록을 저장하지 않은 세션에서 생성한 보고서입니다."}</p><p>출처 검증은 콘텐츠의 사실 여부를 보증하지 않습니다.</p><pre>${esc(JSON.stringify(item,null,2))}</pre></html>`;exportBlob(source,reportName(item,"html"),"text/html");};
$("#delete-report").onclick=async()=>{const item=result();try{await responseJSON(await fetch(`/engine/api/reports/${encodeURIComponent(item.id)}`,{method:"DELETE"}));item.report_saved=false;render();toast("서버 보고서를 삭제했습니다.");}catch(cause){error(cause.message);}};
for(const name of ["a","b"])$(`#compare-${name}`).onchange=()=>renderCompare();

const params=new URLSearchParams(location.search);
if(params.has("trust") && ["standard","lab"].includes(params.get("trust"))) $("#trust-profile").value=params.get("trust");
updateTrustProfileNote();
if(params.has("report")) loadReport(params.get("report"));
else if(params.has("url")){setMode("url");$("#url-input").value=params.get("url");verifyURL(params.get("url"));}



// Top navigation presents the reference material as separate pages while keeping the verifier state in memory.
function routeFromHash(){
  if(location.hash === "#convert") return "convert";
  if(location.hash === "#devices") return "devices";
  if(location.hash === "#guide") return "guide";
  if(location.hash === "#about-c2pa") return "about";
  return "verify";
}
function showPage(page,{preserveResult=false}={}){
  document.body.classList.toggle("show-convert",page === "convert");
  document.body.classList.toggle("show-devices",page === "devices");
  document.body.classList.toggle("show-guide",page === "guide");
  if(!preserveResult)document.body.classList.remove("has-results");
  $$('[data-page]').forEach(link => {
    const active=link.dataset.page === page;
    link.classList.toggle("active",active);
    if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
  });
  if(page === "about")requestAnimationFrame(()=>$("#about-c2pa").scrollIntoView({block:"start"}));
  else if(!preserveResult)window.scrollTo({top:0,behavior:"instant"});
}
function navigatePage(page){
  const hash=page === "about" ? "about-c2pa" : page;
  history.pushState(null,"",`${location.pathname}#${hash}`);
  showPage(page);
}
$$('[data-page]').forEach(link=>link.addEventListener("click",event=>{
  event.preventDefault();navigatePage(link.dataset.page);
}));
$(".logo").addEventListener("click",event=>{event.preventDefault();navigatePage("verify");});
function syncPageFromLocation(){const page=routeFromHash();showPage(page,{preserveResult:page === "verify" && !!result()});}
window.addEventListener("popstate",syncPageFromLocation);
window.addEventListener("hashchange",syncPageFromLocation);
if(!params.has("report")&&!params.has("url"))showPage(routeFromHash());

// The conversion page calls the current local M0 -> P1 -> M1 API.
const conversionState={file:null,busy:false,resultName:""};
function conversionMessage(message,{failure=false}={}){
  const target=$(failure ? "#conversion-error" : "#conversion-progress");
  const other=$(failure ? "#conversion-progress" : "#conversion-error");
  other.hidden=true;target.textContent=message;target.hidden=!message;
}
function selectConversionFile(file){
  const valid=file && /\.(jpe?g|png)$/i.test(file.name) && ["image/jpeg","image/png",""].includes(file.type);
  if(!valid){conversionState.file=null;$("#conversion-filename").textContent="선택한 파일이 없습니다";$("#conversion-submit").disabled=true;conversionMessage("JPEG 또는 PNG 이미지를 선택해 주세요.",{failure:true});return;}
  if(file.size>20*1024*1024){conversionState.file=null;$("#conversion-filename").textContent="선택한 파일이 없습니다";$("#conversion-submit").disabled=true;conversionMessage("파일은 최대 20 MB까지 변환할 수 있습니다.",{failure:true});return;}
  conversionState.file=file;$("#conversion-filename").textContent=`${file.name} · ${sizes(file.size)}`;
  $("#conversion-error").hidden=true;$("#conversion-progress").hidden=true;
  $("#conversion-result").hidden=true;$("#conversion-submit").disabled=conversionState.busy;
}
$("#conversion-drop").onclick=()=>$("#conversion-file").click();
$("#conversion-file").onchange=event=>selectConversionFile(event.target.files[0]);
for(const type of ["dragenter","dragover"])$("#conversion-drop").addEventListener(type,event=>{event.preventDefault();event.currentTarget.classList.add("dragging");});
for(const type of ["dragleave","drop"])$("#conversion-drop").addEventListener(type,event=>{event.preventDefault();event.currentTarget.classList.remove("dragging");});
$("#conversion-drop").addEventListener("drop",event=>selectConversionFile(event.dataTransfer.files[0]));
async function waitForConversion(job){
  if(job.status === "COMPLETED" || job.status === "FAILED")return job;
  const identifier=String(job.conversion_id || "");
  if(!/^conv_[0-9a-f]{32}$/.test(identifier))throw new Error("변환 작업 번호를 확인할 수 없습니다.");
  for(let attempt=0;attempt<80;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1500));
    const response=await responseJSON(await fetch(`/api/v1/conversions/${identifier}`,{cache:"no-store"}));
    job=response.data;
    conversionMessage(`변환 중 · ${job.stage || "처리 중"} (${job.progress_percent || 0}%)`);
    if(job.status === "COMPLETED" || job.status === "FAILED")return job;
  }
  throw new Error("변환이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.");
}
async function renderConversionResult(job){
  const identifier=String(job.conversion_id || "");
  const validationId=String(job.result?.validation_id || "");
  const trusted=job.result?.trust_status === "TRUSTED";
  const safeId=/^conv_[0-9a-f]{32}$/.test(identifier);
  let p1Status="확인 중";
  if(/^val_[0-9a-f]{32}$/.test(validationId)){
    try{const response=await responseJSON(await fetch(`/api/v1/validations/${validationId}`,{cache:"no-store"}));
      const check=response.data?.checks?.find(item=>item.name === "P1_ML_DSA_SIGNATURE");
      p1Status=check?.status === "VALID" ? "서명 확인" : check?.status === "INVALID" ? "서명 오류" : "검사 기록 확인 필요";
    }catch{p1Status="검사 기록을 불러오지 못함";}
  }
  const source=job.source || {},output=job.result || {};
  conversionState.resultName=String(output.filename || "pq-c2pa-result.jpg").split(/[\\/]/).pop();
  const target=$("#conversion-result");
  target.innerHTML=`<div class="conversion-result-head"><span class="conversion-result-icon" aria-hidden="true">${trusted ? "✓" : "!"}</span><div><span class="section-label">CONVERSION RESULT</span><h2>${trusted ? "PQ 변환이 완료되었습니다" : "변환 결과를 확인해 주세요"}</h2><p>${trusted ? "새 이미지의 C2PA와 P1 서명을 검증했습니다." : "최종 신뢰 상태를 확인한 뒤 파일을 사용하세요."}</p></div></div><div class="conversion-result-grid"><div><span>기존 이미지 M0</span><strong>${esc(source.filename || "이미지")}</strong><small>기존 서명 ${source.classic_c2pa?.validation_status === "VALID" ? "확인" : "확인 필요"}</small></div><div><span>P1 양자내성 증거</span><strong>ML-DSA-65</strong><small>${esc(p1Status)}</small></div><div><span>새 이미지 M1</span><strong>${esc(output.filename || "결과 이미지")}</strong><small>최종 상태 ${trusted ? "신뢰 확인" : esc(output.trust_status || "미확인")}</small></div></div><div class="conversion-result-actions">${trusted && safeId ? `<a class="conversion-download" href="/api/v1/conversions/${identifier}/asset" download>변환 이미지 다운로드 ↓</a><button type="button" id="conversion-verify-output" data-conversion-id="${identifier}">새 이미지 다시 검증하기 →</button>` : ""}</div><p class="conversion-result-note">실험용 로컬 CA를 사용한 결과입니다. 공개 신뢰 목록의 인증이나 이미지 내용의 진실성을 보증하지 않습니다.</p>`;
  target.hidden=false;
}
$("#conversion-form").onsubmit=async event=>{
  event.preventDefault();if(conversionState.busy || !conversionState.file)return;
  conversionState.busy=true;$("#conversion-submit").disabled=true;$("#conversion-result").hidden=true;
  conversionMessage("기존 서명을 확인하고 PQ 증거를 생성하는 중입니다…");
  try{
    const form=new FormData();form.append("file",conversionState.file);form.append("preserve_non_c2pa_metadata","true");
    const response=await responseJSON(await fetch("/api/v1/conversions",{method:"POST",body:form}));
    const job=await waitForConversion(response.data);
    if(job.status !== "COMPLETED")throw new Error(job.error?.message || "변환을 완료하지 못했습니다.");
    await renderConversionResult(job);
    conversionMessage("변환과 최종 검증을 마쳤습니다.");
  }catch(cause){
    let message=cause.message || "변환 중 오류가 발생했습니다.";
    if(message.includes("Classic C2PA M0") || message.includes("CLASSIC_C2PA_INVALID"))message="이 이미지에는 변환에 필요한 신뢰되는 기존 C2PA 서명이 없습니다. 먼저 서명 검증 화면에서 결과를 확인해 주세요.";
    else if(message.includes("OpenSSL 3.5") || message.includes("KEY_SERVICE_UNAVAILABLE"))message="이 Mac의 양자내성 서명 환경을 사용할 수 없습니다. OpenSSL 3.5 이상이 설치되어 있는지 확인해 주세요.";
    conversionMessage(message,{failure:true});
  }
  finally{conversionState.busy=false;$("#conversion-submit").disabled=!conversionState.file;}
};
$("#conversion-result").addEventListener("click",async event=>{
  const button=event.target.closest("#conversion-verify-output");if(!button)return;
  const identifier=button.dataset.conversionId;if(!/^conv_[0-9a-f]{32}$/.test(identifier))return;
  button.disabled=true;
  try{const response=await fetch(`/api/v1/conversions/${identifier}/asset`);if(!response.ok)throw new Error("변환 이미지를 불러오지 못했습니다.");
    const blob=await response.blob();const type=blob.type || "image/jpeg";
    const file=new File([blob],conversionState.resultName || `pq-c2pa-result.${type === "image/png" ? "png" : "jpg"}`,{type});
    $("#trust-profile").value="lab";updateTrustProfileNote();
    navigatePage("verify");await verifyFiles([file]);
  }catch(cause){conversionMessage(cause.message,{failure:true});}
  finally{button.disabled=false;}
});

// Image generation uses the existing server endpoint; the secret stays on the server.
const aiState={blob:null,url:null,available:false,busy:false};
function aiError(message){const target=$("#ai-error");target.textContent=message;target.hidden=!message;}
async function checkAiAvailability(){
  const status=$("#ai-api-status"),button=$("#ai-generate");
  status.textContent="생성 API 연결 상태 확인 중…";button.disabled=true;
  try{
    const response=await fetch("/engine/api/health",{cache:"no-store"});
    const health=await responseJSON(response);
    aiState.available=health.ai_generation === true;
    status.textContent=aiState.available ? `생성 API 연결됨 · ${health.ai_model || "이미지 모델"}` : "생성 API 키가 아직 설정되지 않았습니다. 서버에 OPENAI_API_KEY를 설정한 뒤 다시 열어 주세요.";
    status.classList.toggle("unavailable",!aiState.available);
    button.disabled=!aiState.available;
  }catch{
    aiState.available=false;status.textContent="로컬 생성 서버에 연결할 수 없습니다.";status.classList.add("unavailable");button.disabled=true;
  }
}
function closeAiDialog(){if($("#ai-dialog").open)$("#ai-dialog").close();}
$("#ai-fab").addEventListener("click",()=>{
  aiError("");$("#ai-dialog").showModal();checkAiAvailability();$("#ai-prompt").focus();
});
$("#ai-close").addEventListener("click",closeAiDialog);
$("#ai-dialog").addEventListener("click",event=>{if(event.target === $("#ai-dialog"))closeAiDialog();});
$("#ai-form").addEventListener("submit",async event=>{
  event.preventDefault();if(aiState.busy)return;
  const prompt=$("#ai-prompt").value.trim();
  if(prompt.length<8){aiError("이미지 설명을 8자 이상 입력해 주세요.");$("#ai-prompt").focus();return;}
  if(!aiState.available){aiError("생성 API 키를 서버에 설정해야 합니다.");return;}
  const button=$("#ai-generate");aiState.busy=true;button.disabled=true;button.textContent="이미지 생성 중…";aiError("");
  try{
    const response=await fetch("/engine/api/ai/generate",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({prompt,style:$("#ai-style").value,aspect_ratio:$("#ai-ratio").value})
    });
    if(!response.ok){let detail="이미지를 생성하지 못했습니다.";try{detail=(await response.json()).detail || detail;}catch{}throw new Error(detail);}
    const blob=await response.blob();
    if(blob.type !== "image/png" || blob.size === 0 || blob.size > 20*1024*1024)throw new Error("생성 API가 올바른 PNG 이미지를 반환하지 않았습니다.");
    if(aiState.url)URL.revokeObjectURL(aiState.url);
    aiState.blob=blob;aiState.url=URL.createObjectURL(blob);
    $("#ai-preview").src=aiState.url;$("#ai-output").hidden=false;
    $("#ai-api-status").textContent="이미지가 생성되었습니다. 다운로드하거나 C2PA 검증을 시작하세요.";
  }catch(cause){aiError(cause.message);}
  finally{aiState.busy=false;button.disabled=!aiState.available;button.textContent="✦ 이미지 생성하기";}
});
$("#ai-download").addEventListener("click",()=>{
  if(!aiState.url)return;const link=document.createElement("a");link.href=aiState.url;
  link.download=`pq-c2pa-ai-${new Date().toISOString().slice(0,10)}.png`;link.click();
});
$("#ai-verify").addEventListener("click",()=>{
  if(!aiState.blob)return;
  const file=new File([aiState.blob],`pq-c2pa-ai-${Date.now()}.png`,{type:"image/png"});
  closeAiDialog();navigatePage("verify");verifyFiles([file]);
});
window.addEventListener("beforeunload",()=>{if(aiState.url)URL.revokeObjectURL(aiState.url);});
checkExplainAvailability();
