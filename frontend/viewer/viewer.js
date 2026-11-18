"use strict";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const sizes = size => Number.isFinite(size) ? size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB` : "—";
const when = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat("ko-KR", {dateStyle:"medium", timeStyle:"short"}).format(d) : "정보 없음"; };
const FORMAT_EXTENSIONS = new Set(["jpg","jpeg","png"]);
const SERVER_MAX_SIZE = 500 * 1024 * 1024;
const BROWSER_MAX_SIZE = 100 * 1024 * 1024;
const state = { results:[], active:0, detail:"pqc", checkFilter:"all", selectedManifest:null, localUrls:new Map(), busy:false, mode:"file", explanations:new Map(), explainMode:"simple", explainBusy:"", explainErrors:new Map() };
let v4Module=null;
const unifiedTasks=new Map();
let activeUnifiedTask=null;
const stateLabels = {Trusted:"신뢰 확인", Valid:"유효 · 신뢰 미확인", Invalid:"검증 실패", NoManifest:"C2PA 없음", RemoteUnavailable:"외부 Manifest 필요", Error:"분석 오류", Unknown:"상태 미확인"};
const stateDescriptions = {
  Trusted:"서명과 파일 결합이 검증되고, 선택한 신뢰 목록에서 서명자를 확인했습니다.",
  Valid:"서명과 파일 결합은 유효하지만, 선택한 목록에서 서명자의 신뢰는 확인되지 않았습니다.",
  Invalid:"Manifest 검증에 실패했습니다. 검사 상세에서 실패 항목을 확인해 원인을 구분하세요.",
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
  "자체 CA 신뢰":"자체 인증기관(CA)을 Trust Anchor(신뢰의 기준점)로 등록해 검사합니다. 자체 CA가 발급한 인증서로 서명된 파일은 서명자를 신뢰할 수 있는 것으로 확인됩니다.",
  "기본 SDK 목록":"공식 C2PA SDK의 기본 신뢰 설정만으로 검사합니다. 자체 CA를 Trust Anchor로 쓰지 않으므로, 자체 CA로 서명된 파일은 서명이 유효해도 '신뢰 미확인'으로 표시됩니다.",
  "신뢰 목록":"어떤 인증기관이나 서명자를 신뢰 기준으로 삼을지 정한 목록입니다. 같은 파일도 목록이 달라지면 '신뢰 확인'과 '신뢰 미확인'이 달라질 수 있습니다.",
  "검증 정책":"어떤 인증기관(CA)을 Trust Anchor로 삼아 서명자를 신뢰할지 정한 기준입니다. 기본값은 자체 CA를 Trust Anchor로 등록한 '자체 CA 신뢰'이며, 이 기준으로 서명자의 인증서 체인을 확인합니다.",
  "신뢰 정책":"어떤 인증기관을 Trust Anchor로 삼을지 고르는 설정입니다. '자체 CA 신뢰'는 자체 CA를 Trust Anchor로 등록해 서명자를 신뢰하고, '기본 SDK 목록'은 SDK 기본 설정만 사용합니다.",
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
function hintText(label,description){return `<span class="term" tabindex="0" data-description="${esc(description)}" aria-label="${esc(label)}: ${esc(description)}">${esc(label)}</span>`;}
function term(label) {
  const description=glossary[label];
  return description ? hintText(label,description) : esc(label);
}
const inlineGlossaryTerms=["자체 CA 신뢰","기본 SDK 목록","AI 생성 선언","원격 Manifest","ICC 프로필","GPS 메타데이터","서명 시간 정보","서명 알고리즘","디지털 서명","신뢰 목록","검증 정책","SHA3-256","SHA-256","C2PA","Manifest","Assertion","Ingredient","Claim","OCSP","TSA","EXIF","SDK","CA","무결성","메타데이터","인증서","서명자","발급자","해시"];
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
document.addEventListener("pointerout",event=>{const element=event.target.closest?.(".term");if(element && element === activeTerm && !element.contains(event.relatedTarget))hideGlossaryPopover();});
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
let liveActivity=[];
function activityTime(value){
  const d=new Date(value);if(!value||Number.isNaN(d.getTime()))return "시각 기록 없음";
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}).format(d)+' (UTC+09:00)';
}
function renderActivity(item=null,entries=null,label=''){
  const run=item?.verification_run,timing=item?.verification_timing;
  const events=entries||run?.events||(timing?[{at:timing.started_at,message:'서버 C2PA 검사 시작',clock_source:'server'},{at:timing.completed_at,message:'서버 C2PA 검사 종료',clock_source:'server'}]:[]);
  $('#activity-log').hidden=!events.length;
  $('#activity-context').textContent=label|| (item ? `${item.filename} · 이 파일의 검사 기록${run?.started_at ? ` · 시작 ${activityTime(run.started_at)}`:''}` : '');
  $('#activity-items').innerHTML=events.map(e=>`<li><time datetime="${esc(e.at)}">${esc(activityTime(e.at))}${e.clock_source==='server'?' · 서버':''}</time><div><strong>${esc(e.message)}</strong>${e.filename?`<small>${esc(e.filename)}</small>`:''}${e.server_timing?`<small>서버 C2PA 검사: ${esc(activityTime(e.server_timing.started_at))} ~ ${esc(activityTime(e.server_timing.completed_at))}</small>`:''}${e.job_id?`<small>작업 ID ${esc(e.job_id)}</small>`:''}</div></li>`).join('');
}
function startActivity(message){liveActivity=[];logActivity(message);}
function logActivity(message){liveActivity.push({at:new Date().toISOString(),clock_source:'browser',code:'VIEWER_EVENT',message});renderActivity(null,liveActivity,'현재 실행 중인 검사');}
function setBusy(value){
  state.busy=value;$('#url-form button').disabled=value;
  $$('[data-sample]').forEach(button=>button.disabled=value);
}
function updateProcessingMode(){
  $('#intake-limit').textContent='자동 미리보기 · 최대 10개 · PQC 처리 20 MiB 이하';
}
function setMode(mode) {
  state.mode = mode;
  updateProcessingMode();
  $("#panel-file").hidden = mode !== "file"; $("#panel-url").hidden = mode !== "url";
  $(".intake").classList.toggle("url-mode", mode === "url");
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
  raw = raw.data || raw;
  const store = raw.manifest || raw.store || {};
  const manifests = store.manifests || {};
  const active = manifests[store.active_manifest] || {};
  const resultId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const actions = [];
  for (const assertion of active.assertions || [])
    if (assertion.label?.startsWith("c2pa.actions")) actions.push(...(assertion.data?.actions || []));
  const aiDeclared = actions.some(action => isAiSourceType(action.digitalSourceType));
  return {
    ...raw,
    id:raw.id || `server_${resultId.replaceAll("-", "")}`,
    sha256:raw.sha256 || raw.asset?.sha256 || null,
    sha3_256:raw.sha3_256 || raw.asset?.sha3_256 || null,
    created_at:raw.created_at || raw.verification_timing?.completed_at || null,
    filename:raw.filename || raw.asset?.filename || file.name || "asset",
    size:raw.size ?? raw.asset?.size_bytes ?? file.size,
    mime:raw.content_type || raw.mime || raw.asset?.media_type || file.type || "",
    trust_profile:raw.trust_profile || trustProfile,
    report_saved:raw.report_saved === true,
    processing_mode:"server",
    state:raw.state || "Unknown",
    store,
    checks:Array.isArray(raw.checks) ? raw.checks : checksFromInspect(store, raw),
    signature:raw.signature || active.signature_info || raw.claim?.signature_info || {},
    software:raw.software || active.claim_generator_info || raw.claim?.claim_generator_info || [],
    ingredients:raw.ingredients || active.ingredients || [],
    actions:raw.actions || actions,
    ai:raw.ai || (aiDeclared ? "declared" : "unknown"),
    manifest_count:Object.keys(manifests).length,
    embedded:raw.embedded ?? Boolean(raw.has_c2pa),
    thumbnail:raw.thumbnail || null,
    manifest_thumbnails:raw.manifest_thumbnails || {},
    network_policy:raw.network_policy || {remote_manifests:false, ocsp:false},
    elapsed_ms:raw.elapsed_ms ?? raw.verification_timing?.elapsed_ms ?? null,
    request_elapsed_ms:elapsedMs
  };
}
function addResult(result, file) {
  if (file) state.localUrls.set(result.id, URL.createObjectURL(file));
  state.results.push(result); state.active = state.results.length - 1;
  state.detail = "pqc"; state.selectedManifest = result.store?.active_manifest || null;
  showPage("verify", {preserveResult:true});
  render();
  window.scrollTo({top:0, behavior:"instant"});
}
async function ensureAssetSha256(item, file) {
  if (/^[0-9a-f]{64}$/i.test(String(item.sha256 || ""))) return;
  try {
    const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
    item.sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  } catch { item.sha256=null;item.sha256_error="파일 해시를 계산하지 못했습니다."; }
}
async function inspectUnifiedFile(file,{browser=false,trustProfile='lab',saveReport=false}={}){
  let item;
  if(browser){const {verifyBrowserAsset}=await import('./browser-verify.js');item=await verifyBrowserAsset(file,trustProfile);}
  else{
    const body=new FormData();body.append('file',file,file.name);body.append('trust_profile',trustProfile);body.append('save_report',String(saveReport));
    const started=performance.now();
    item=normalizeInspectResult(await responseJSON(await fetch('/api/v1/assets/inspect',{method:'POST',body})),file,trustProfile,Math.round(performance.now()-started));
  }
  await ensureAssetSha256(item,file);return item;
}
function unifiedProgress(snapshot){
  const job=snapshot.job;
  $('#unified-stop').hidden=!snapshot.busy||!job||['COMPLETED','FAILED'].includes(job.status);
  if(job && !['COMPLETED','FAILED'].includes(job.status))progress(`C2PA·PQC 통합 검사 · ${job.stage||'기존 기록 확인 및 보호 처리 중'}`);
}
async function verifyFiles(files) {
  if(state.busy)return;
  const list=[...files];if(!list.length)return;
  if(list.length>10)return error('한 번에 최대 10개 파일을 선택할 수 있습니다.');
  clearError();setBusy(true);startActivity(`${list.length}개 이미지 통합 검사 시작`);
  const failures=[];
  try{
    for(const [index,file] of list.entries()){
      const browser=false,trustProfile='lab';
      const suffix=file.name.split('.').pop()?.toLowerCase();
      if(!FORMAT_EXTENSIONS.has(suffix)||!file.size||file.size>(browser?BROWSER_MAX_SIZE:SERVER_MAX_SIZE)){failures.push(`${file.name}: 지원하는 JPG·PNG 형식과 용량을 확인해 주세요.`);continue;}
      progress(`${index+1}/${list.length} · ${file.name}의 C2PA와 PQC를 함께 확인하고 있습니다.`);
      try{
        const {createUnifiedTask}=await unifiedReady;
        const skipReason=file.size>20*1024*1024?'PQC 자동 처리는 20 MiB 이하 파일만 지원합니다. 이 파일의 C2PA 검사는 별도로 수행했습니다.':'';
        const fileEvents=[];
        const task=createUnifiedTask({inspect:asset=>inspectUnifiedFile(asset,{browser,trustProfile,saveReport:false}),loadAsset:async job=>{const blob=await v4Asset(job);return new File([blob],job.result.filename,{type:blob.type});},onProgress:unifiedProgress,onEvent:entry=>{fileEvents.push(entry);renderActivity(null,fileEvents,`${file.name} · 현재 실행 중인 검사`);},skipReason});
        activeUnifiedTask=task;
        const processed=await task.start(file);
        if(!processed.item.id)processed.item.id=`unified_${crypto.randomUUID().replaceAll('-','')}`;
        processed.item.report_saved=false;
        unifiedTasks.set(processed.item.id,task);addResult(processed.item,processed.file);
        renderActivity(processed.item);
      }catch(cause){failures.push(`${file.name}: ${cause.message}`);}
      finally{activeUnifiedTask=null;$('#unified-stop').hidden=true;}
    }
  }finally{setBusy(false);progress('',false);$('#file-input').value='';updateProcessingMode();}
  if(failures.length)error(failures.join(' / '));
}
function intakeFiles(files){
  const list=[...files];
  return stageFiles(list);
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
      body:JSON.stringify({url, trust_profile:"lab", save_report:false})
    }));
    result.pqc_process={status:"SKIPPED",message:"URL에서는 C2PA만 검사했습니다. PQC 자동 보호는 원본 이미지 파일을 업로드해 진행하세요."};
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
// Public-page discovery uses server-side HTML extraction; no screenshots or page content are sent to AI.
const pageState={images:[], controller:null};
function pageMessage(selector,message){const node=$(selector);node.textContent=message;node.hidden=!message;}
function pageFileLabel(image,index){
  let name="";try{name=decodeURIComponent(new URL(image.url).pathname.split("/").pop() || "");}catch{}
  return (image.alt || name || `이미지 ${index+1}`).slice(0,180);
}
function renderPageCandidates(){
  $("#page-image-count").textContent=`${pageState.images.length}개`;
  $("#page-image-list").innerHTML=pageState.images.map((image,index)=>{
    let host="";try{host=new URL(image.url).hostname;}catch{}
    return `<li><label><input type="checkbox" data-page-image="${index}" checked><span><strong>${esc(pageFileLabel(image,index))}</strong><small>${esc(image.source || "이미지")} · ${esc(host)}</small></span></label></li>`;
  }).join("");
  $("#page-candidates").hidden=!pageState.images.length;
}
async function discoverPageImages(raw){
  if(state.busy)return;
  let url;try{url=validRemote(raw);}catch(cause){pageMessage("#page-error",cause.message);return;}
  pageMessage("#page-error","");pageMessage("#page-status","게시물에서 이미지 주소를 찾고 있습니다…");
  $("#page-discover").disabled=true;$("#page-candidates").hidden=true;pageState.images=[];setBusy(true);
  try{
    const response=await responseJSON(await fetch("/api/v1/web-images/discover",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})}));
    pageState.images=Array.isArray(response.images) ? response.images : [];
    renderPageCandidates();
    const scope=response.scope === "추정 본문 영역" ? "페이지 구조에서 추정한 본문" : "본문";
    const found=`${scope}에서 사진 ${pageState.images.length}개를 찾았습니다. 광고나 추천 이미지가 섞였는지 확인해 주세요.`;
    const missing=response.scope === "unavailable" ? "공개 페이지에서 본문 사진 영역을 확인하지 못했습니다. 전체 페이지의 광고·추천 이미지는 가져오지 않았습니다. 원본 이미지 주소나 파일로 다시 확인해 주세요." : "본문에서 사진을 찾지 못했습니다. 로그인하거나 스크롤해야 나타나는 사진은 확인할 수 없습니다.";
    pageMessage("#page-status",pageState.images.length ? found : missing);
  }catch(cause){pageMessage("#page-status","");pageMessage("#page-error",cause.message || "게시물을 불러오지 못했습니다.");}
  finally{setBusy(false);$("#page-discover").disabled=false;updateProcessingMode();}
}
async function analyzePageImages(){
  if(state.busy)return;
  const chosen=$$("[data-page-image]:checked").map(input=>pageState.images[Number(input.dataset.pageImage)]).filter(Boolean);
  if(!chosen.length){pageMessage("#page-error","분석할 사진을 한 장 이상 선택해 주세요.");return;}
  pageMessage("#page-error","");setBusy(true);$("#page-analyze").disabled=true;$("#page-discover").disabled=true;$("#page-cancel").hidden=false;
  const controller=new AbortController();pageState.controller=controller;
  const results=[], failures=[];let aiEnabled=$("#page-ai-summary").checked, aiFailed=false, stopped=false;
  try{
    for(const [index,image] of chosen.entries()){
      pageMessage("#page-status",`${index+1} / ${chosen.length} · 이미지 파일을 가져와 검사 중입니다.`);
      try{
        const response=await fetch("/engine/api/verify-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:image.url,trust_profile:"lab",save_report:false}),signal:controller.signal});
        if(response.status === 413)throw new Error("파일이 500 MB를 초과했습니다.");
        const item=await responseJSON(response);
        if(!String(item.mime || "").startsWith("image/"))throw new Error("이미지 파일이 아닙니다.");
        if(item.state === "Error")throw new Error("파일 형식 또는 내용 때문에 검사하지 못했습니다.");
        item.pqc_process={status:"SKIPPED",message:"게시물 사진은 C2PA만 검사했습니다. PQC 자동 보호는 원본 이미지 파일을 업로드해 진행하세요."};
        results.push(item);
        if(aiEnabled){
          pageMessage("#page-status",`${index+1} / ${chosen.length} · 검사 결과의 AI 설명을 생성 중입니다.`);
          try{state.explanations.set(explanationKey(item,"simple"),await requestAiSummary(item,"simple",controller.signal));}
          catch(cause){if(controller.signal.aborted)throw cause;aiEnabled=false;aiFailed=true;}
        }
      }catch(cause){
        if(controller.signal.aborted){stopped=true;break;}
        failures.push(`${pageFileLabel(image,index)}: ${cause.message || "이미지를 가져오지 못했습니다."}`);
      }
    }
  }finally{
    pageState.controller=null;setBusy(false);$("#page-discover").disabled=false;$("#page-analyze").disabled=false;$("#page-cancel").hidden=true;updateProcessingMode();
  }
  const notice={total:chosen.length,completed:results.length,stopped,aiFailed,failures};
  pageMessage("#page-status",`${results.length} / ${chosen.length}개 검사 완료${stopped ? " · 중단됨" : ""}${failures.length ? ` · ${failures.length}개 실패` : ""}`);
  if(!results.length){
    pageMessage("#page-status",stopped ? "분석을 중단했습니다." : "");
    pageMessage("#page-error",failures.length ? `분석을 완료한 사진이 없습니다. ${failures.join(" / ")}` : "");return;
  }
  for(const item of results)item.page_analysis=notice;
  for(const item of results.slice(0,-1))state.results.push(item);
  state.explainMode="simple";addResult(results[results.length-1]);
}
$("#page-url-form").addEventListener("submit",event=>{event.preventDefault();discoverPageImages($("#page-url-input").value.trim());});
$("#page-select-all").addEventListener("click",()=>{$$("[data-page-image]").forEach(input=>input.checked=true);});
$("#page-select-none").addEventListener("click",()=>{$$("[data-page-image]").forEach(input=>input.checked=false);});
$("#page-analyze").addEventListener("click",analyzePageImages);
$("#page-cancel").addEventListener("click",()=>{if(pageState.controller){pageMessage("#page-status","분석을 중단하고 있습니다…");pageState.controller.abort();}});

async function verifySample(sample) {
  if(state.busy)return;
  const names={signed:'signed.jpg',tampered:'tampered.jpg',unsigned:'unsigned.jpg',ai:'ai-han-river-sunrise.png'};
  try{
    const response=await fetch(`/engine/api/samples/${encodeURIComponent(sample)}/file`);
    if(!response.ok)throw Error('샘플 파일을 불러오지 못했습니다.');
    const blob=await response.blob();await verifyFiles([new File([blob],names[sample]||'sample.jpg',{type:blob.type})]);
  }catch(cause){error(cause.message);}
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
// Trust-list availability is distinct from a failed signature or content hash.
// Preserve SDK kinds and codes in the original record and expose them in details.
function checkPresentation(check) {
  const code=check.code || "";
  const trustOnly=["signingCredential.untrusted","timeStamp.untrusted"].includes(code) && check.kind !== "success";
  const tone=trustOnly ? "warning" : check.kind === "failure" ? "failure" : check.kind === "success" ? "success" : "informational";
  const [label,icon]={success:["통과","✓"],failure:["실패","×"],warning:["신뢰 미확인","!"],informational:["안내","i"]}[tone];
  const titles={
    "claimSignature.validated":"출처 기록의 서명 검증", "claimSignature.mismatch":"출처 기록의 서명 검증",
    "claimSignature.insideValidity":"인증서 유효기간 확인", "claimSignature.outsideValidity":"인증서 유효기간 확인",
    "assertion.hashedURI.match":"출처 기록 간 연결 확인", "assertion.hashedURI.mismatch":"출처 기록 간 연결 확인",
    "assertion.dataHash.match":"파일과 출처 기록의 일치 확인", "assertion.dataHash.mismatch":"파일과 출처 기록의 일치 확인",
    "assertion.bmffHash.match":"미디어와 출처 기록의 일치 확인", "assertion.bmffHash.mismatch":"미디어와 출처 기록의 일치 확인",
    "signingCredential.trusted":"서명자 신뢰 확인", "signingCredential.untrusted":"서명자 신뢰 확인",
    "signingCredential.ocsp.skipped":"인증서 취소 여부 조회", "timeStamp.validated":"타임스탬프 검증", "timeStamp.untrusted":"타임스탬프 발급기관 신뢰 확인"
  };
  const descriptions={
    "claimSignature.validated":"출처 기록의 전자서명이 올바르게 검증되었습니다.",
    "claimSignature.mismatch":"출처 기록의 전자서명이 일치하지 않습니다. 서명된 기록이나 서명이 변경됐을 수 있습니다.",
    "claimSignature.insideValidity":"서명 검증에 사용된 시점이 인증서의 유효기간 안에 있습니다.",
    "claimSignature.outsideValidity":"서명 검증에 사용된 시점이 인증서의 유효기간 밖에 있습니다.",
    "assertion.hashedURI.match":"출처 기록이 참조하는 데이터의 해시값이 일치합니다.",
    "assertion.hashedURI.mismatch":"출처 기록이 참조하는 데이터의 해시값이 일치하지 않습니다.",
    "assertion.dataHash.match":"파일 내용이 출처 기록에 저장된 해시값과 일치합니다.",
    "assertion.dataHash.mismatch":"파일 내용이 출처 기록에 저장된 해시값과 다릅니다. 서명 이후 변경됐을 수 있습니다.",
    "signingCredential.trusted":"선택한 신뢰 목록에서 서명자의 인증서 경로를 확인했습니다.",
    "signingCredential.ocsp.skipped":"인증서 취소 여부를 외부 서버에 조회하지 않았습니다. 통과한 검사에 포함하지 않습니다.",
    "timeStamp.validated":"타임스탬프에 기록된 해시값이 검증 대상과 일치합니다. 발급기관의 신뢰 여부는 별도 항목입니다."
  };
  const detail=trustOnly ? (code === "timeStamp.untrusted" ? "선택한 신뢰 목록에서 시간 인증 기관을 확인하지 못했습니다. 시간 정보의 신뢰를 별도로 확인해야 합니다." : "선택한 신뢰 목록에서 서명자를 확인하지 못했습니다. 파일이나 서명이 변조됐다는 뜻은 아닙니다.") : descriptions[code] || check.explanation || check.message || "원본 검사 코드를 펼쳐 세부 정보를 확인하세요.";
  return {tone,label,icon,title:titles[code] || "추가 검증 항목",detail};
}
function displayCounts(item) {
  const totals={success:0,failure:0,warning:0,informational:0};
  for(const check of item.checks || [])totals[checkPresentation(check).tone]++;
  return totals;
}
// 표시 내용은 출처 기록의 선언만 사용합니다. 선언 부재는 비생성의 증거가 아닙니다.
function sourceTypeCode(value){return typeof value === "string" ? value.split(/[\/#]/).pop() : "";}
function isAiSourceType(value){return ["trainedAlgorithmicMedia","compositeWithTrainedAlgorithmicMedia","compositedWithTrainedAlgorithmicMedia"].includes(sourceTypeCode(value));}
function aiActionTool(action,agents){
  let agent=action.softwareAgent;
  if(!agent && Number.isInteger(action.softwareAgentIndex) && action.softwareAgentIndex>=0)agent=agents?.[action.softwareAgentIndex];
  if(typeof agent === "string")return agent.trim();
  if(agent && typeof agent === "object"){
    const name=typeof agent.name === "string" ? agent.name.trim() : "";
    const version=typeof agent.version === "string" || typeof agent.version === "number" ? String(agent.version).trim() : "";
    return name ? [name,version].filter(Boolean).join(" · ") : "";
  }
  return "";
}
function aiRecordManifests(item){
  const store=item.store || {}, manifests=store.manifests || {}, root=store.active_manifest;
  if(!root || !manifests[root])return [];
  const found=[], queue=[{id:root,depth:0}], seen=new Set();
  while(queue.length && found.length<100){
    const next=queue.shift();if(seen.has(next.id) || !manifests[next.id])continue;
    seen.add(next.id);const manifest=manifests[next.id];found.push({...next,manifest});
    for(const ingredient of Array.isArray(manifest.ingredients) ? manifest.ingredients : []){
      const id=ingredient?.active_manifest;
      if(ingredient?.relationship === "parentOf" && typeof id === "string" && manifests[id] && !seen.has(id))queue.push({id,depth:next.depth+1});
    }
  }
  return found;
}
function aiRecordWriter(item,manifests){
  const manifest=manifests[0]?.manifest || {};
  const info=Array.isArray(manifest.claim_generator_info) ? manifest.claim_generator_info : Array.isArray(item.software) ? item.software : [];
  const names=info.map(agent=>typeof agent === "string" ? agent : typeof agent?.name === "string" ? agent.name : "").filter(Boolean);
  return [...new Set(names)].join(", ") || (typeof manifest.claim_generator === "string" ? manifest.claim_generator : "");
}
function aiOrigin(item){
  const manifests=aiRecordManifests(item);
  let entries=manifests.flatMap(({manifest,id,depth})=>{
    const groups=(Array.isArray(manifest.assertions) ? manifest.assertions : []).filter(a=>String(a?.label || "").startsWith("c2pa.actions"));
    return groups.flatMap(a=>{
      const data=a?.data || {}, agents=Array.isArray(data.softwareAgents) ? data.softwareAgents : [];
      return (Array.isArray(data.actions) ? data.actions : []).map(action=>({action:action || {},agents,manifestId:id,depth}));
    });
  });
  if(!entries.length)entries=(Array.isArray(item.actions) ? item.actions : []).map(action=>({action:action || {},agents:[],depth:0}));
  const generated=entries.filter(({action})=>action.action === "c2pa.created" && sourceTypeCode(action.digitalSourceType) === "trainedAlgorithmicMedia");
  const here=generated.filter(entry=>entry.depth === 0), previous=generated.filter(entry=>entry.depth > 0);
  const edited=entries.find(({action,depth})=>depth === 0 && ["compositeWithTrainedAlgorithmicMedia","compositedWithTrainedAlgorithmicMedia"].includes(sourceTypeCode(action.digitalSourceType)));
  const media=entries.find(({action,depth})=>depth === 0 && sourceTypeCode(action.digitalSourceType) === "trainedAlgorithmicMedia");
  const capture=entries.find(({action,depth})=>depth === 0 && action.action === "c2pa.created" && sourceTypeCode(action.digitalSourceType) === "digitalCapture");
  const candidates=here.length ? here : previous.length ? previous : edited ? [edited] : media ? [media] : [];
  const tools=[...new Set(candidates.map(entry=>aiActionTool(entry.action,entry.agents)).filter(Boolean))];
  const tool=tools.join(", "), writer=aiRecordWriter(item,manifests);
  const creation=entries.find(({action,depth,agents})=>depth === 0 && action.action === "c2pa.created" && aiActionTool(action,agents));
  const creationTool=creation ? aiActionTool(creation.action,creation.agents) : "";
  const rawSoftware=item.image_info?.metadata?.Software;
  const metadataSoftware=typeof rawSoftware === "string" ? rawSoftware.trim() : "";
  const alert=item.state === "Invalid" ? "검증에 실패한 기록입니다. 검사 상세를 확인하세요." : "출처 기록 기준이며, 기록이 없어도 AI를 사용했을 수 있습니다.";
  const base={tool,writer,metadataSoftware,creationTool,alert};
  if(here.length)return {...base,kind:"created",label:"AI 생성으로 기록됨",caption:"현재 출처 기록에 AI가 생성한 이미지로 표시되어 있습니다.",toolLabel:"AI 생성 작업에 기록된 도구"};
  if(previous.length)return {...base,kind:"inherited",label:"이전 이미지의 AI 생성 기록",caption:"연결된 이전 이미지에 AI 생성 기록이 있습니다.",toolLabel:"이전 생성 작업에 기록된 도구",extra:edited ? "현재 기록에는 AI 편집·합성 작업도 표시되어 있습니다." : "이전 이미지의 기록이므로 현재 파일의 모든 편집 과정까지 뜻하지 않습니다."};
  if(edited)return {...base,kind:"edited",label:"AI 편집·합성으로 기록됨",caption:"출처 기록에 AI를 이용한 편집 또는 합성이 표시되어 있습니다.",toolLabel:"AI 편집 작업에 기록된 도구"};
  if(media)return {...base,kind:"media",label:"AI 생성 매체 사용 기록",caption:"출처 기록에 AI 생성 매체 사용이 표시되어 있습니다.",toolLabel:"AI 관련 작업에 기록된 도구"};
  if(capture)return {...base,kind:"unknown",label:"촬영으로 기록됨 · AI 생성 여부 미확인",caption:"촬영 기록은 있지만 AI 사용 여부는 확인할 수 없습니다."};
  return {...base,kind:"unknown",label:"AI 생성 기록 미확인",caption:"출처 기록에서 AI 생성 여부를 확인하지 못했습니다."};
}
function renderAiOrigin(item){
  const info=aiOrigin(item), relevant=info.kind !== "unknown";
  const unknownReason=["Error","Unknown","RemoteUnavailable"].includes(item.state) ? "출처 기록을 확인하지 못했습니다." : item.state === "NoManifest" ? "파일에 C2PA 출처 기록이 없습니다." : "AI 사용 여부가 출처 기록에 명시되지 않았습니다.";
  const toolLine=relevant ? `<p><span>${esc(info.toolLabel)}</span> <strong>${esc(info.tool || "기록되지 않음")}</strong></p>` : `<p>${esc(unknownReason)}</p>${info.creationTool ? `<p>생성 작업에 기록된 도구 <strong>${esc(info.creationTool)}</strong> <small>AI 사용 여부는 확인되지 않았습니다.</small></p>` : ""}`;
  const writer=info.writer ? `<p>기록 작성 도구 <strong>${esc(info.writer)}</strong> <small>이미지 생성 도구와 다를 수 있습니다.</small></p>` : "";
  const metadata=info.metadataSoftware ? `<p>일반 파일 정보 <strong>${esc(info.metadataSoftware)}</strong> <small>생성 도구의 증거는 아닙니다.</small></p>` : "";
  return `<section class="ai-origin-card ${esc(info.kind)}" aria-label="AI 이미지 생성 기록"><div><span>AI 이미지 생성 기록</span><strong>${esc(info.label)}</strong></div>${toolLine}${info.extra ? `<p>${esc(info.extra)}</p>` : ""}${writer}${metadata}<small>${esc(info.alert)}</small></section>`;
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
  else if (source && mime === "application/pdf") content = `<div class="no-preview"><span>▤</span><strong>PDF 문서</strong><a href="${esc(source)}" target="_blank" rel="noopener">미리보기 열기 ↗</a></div>`;
  $("#preview-card").innerHTML = `<div class="preview-stage">${content}<span class="preview-tag">${esc(mime || "FILE")}</span></div><div class="preview-caption"><strong>${esc(item.filename || "파일")}</strong><small>${sizes(item.size)} · SHA-256 ${esc((item.sha256 || "").slice(0, 18))}…</small><p class="preview-ai-caption">${esc(aiOrigin(item).caption)}</p></div>`;
}
function renderSummary(item) {
  const signature = item.signature || {}, active = activeManifest(item);
  const software = (item.software || []).map(s => s.name).filter(Boolean).join(", ") || active.claim_generator || "정보 없음";
  const ai = aiOrigin(item).label;
  const fields = [["서명자",signature.common_name || "정보 없음"],["발급자",signature.issuer || "정보 없음"],
    ["서명 알고리즘",signature.alg || "정보 없음"],["제작 도구",software],["AI 생성 선언",ai],
    ["Manifest",`${item.manifest_count || 0}개 ${item.embedded ? "· 파일 내장" : ""}`],
    ["검증 정책",item.trust_profile === "lab" ? "자체 CA 신뢰" : "기본 SDK 목록"]];
  return `<div class="summary-fields">${fields.map(([label,value])=>`<div><span>${term(label)}</span><strong>${label === "발급자" ? annotateIssuer(value) : label === "검증 정책" || label === "AI 생성 선언" ? annotateTerms(value) : esc(value)}</strong></div>`).join("")}</div><p class="small-note">검증 시각 ${when(item.created_at)}</p>`;
}
function renderBatch() {
  const target = $("#batch-list"); target.hidden = false;
  target.innerHTML = state.results.map((item,index)=>`<button class="${index === state.active ? "active" : ""}" data-result-index="${index}" type="button"><span>${esc(item.filename)}</span><small>${esc(stateLabels[item.state] || item.state || "상태 미확인")}</small></button>`).join("");
}
function renderVerdict(item) {
  const status = item.state || "Unknown";
  const name = {Trusted:"검증 통과 · 서명자 신뢰 확인",Valid:"파일 검증 통과 · 신뢰 미확인",Invalid:"검증 실패",NoManifest:"검증할 출처 기록 없음",RemoteUnavailable:"외부 기록이 필요해 검증 보류",Error:"파일 분석 오류",Unknown:"검증 상태 확인 불가"}[status] || "검증 상태 확인 불가";
  $("#verdict").className = `verdict ${esc(status.toLowerCase())}`;
  const icon=status === "Trusted" ? "✓" : status === "Invalid" || status === "Error" ? "×" : status === "Valid" ? "!" : "−";
  $("#verdict").innerHTML = `<div class="verdict-icon" aria-hidden="true">${icon}</div><div><span>C2PA 검증 결과</span><h3>${esc(name)}</h3><p>${esc(stateDescriptions[status] || "검사를 완료하지 못했습니다. 검사 상세에서 원인을 확인하세요.")}</p></div>`;
}
function renderReadout(item) {
  const status=item.state || "Unknown", present=Number(item.manifest_count || Object.keys(item.store?.manifests || {}).length)>0;
  const records=present ? ["있음","파일에 C2PA 출처 기록이 연결되어 있습니다.","yes"] : status === "NoManifest" ? ["없음","이 파일에서 확인 가능한 C2PA 기록을 찾지 못했습니다.","unknown"] : status === "RemoteUnavailable" ? ["외부 기록 필요","현재 설정에서는 외부 출처 기록을 가져오지 않습니다.","unknown"] : ["판단 불가","분석이 완료되지 않아 출처 기록의 유무를 단정할 수 없습니다.","unknown"];
  const integrity=status === "Trusted" || status === "Valid" ? ["통과","서명과 파일 결합이 검증되었습니다.","yes"] : status === "Invalid" ? ["실패","검사 상세에서 실패한 항목을 확인하세요.","no"] : ["판단 불가","검증할 기록이 없거나 검사를 완료하지 못했습니다.","unknown"];
  const activeChecks=(item.checks || []).filter(check=>check.scope === "activeManifest");
  const signerConfirmed=status === "Trusted" || (activeChecks.some(check=>check.code === "signingCredential.trusted" && check.kind === "success") && !activeChecks.some(check=>check.kind === "failure" && check.code?.startsWith("signingCredential.")));
  const signerUnconfirmed=status === "Valid" || activeChecks.some(check=>check.code === "signingCredential.untrusted");
  const signer=signerConfirmed ? ["확인","선택한 신뢰 목록에서 서명자를 확인했습니다. 파일 검증 결과는 별도 항목입니다.","yes"] : signerUnconfirmed ? ["미확인","선택한 신뢰 목록에서 서명자를 확인하지 못했습니다.","unknown"] : ["판단 불가","이 결과로 서명자의 신뢰를 확인할 수 없습니다.","unknown"];
  const entries=[["출처 기록",records],["파일·기록 검증",integrity],["서명자 신뢰",signer]];
  $("#readout").innerHTML=`<div class="readout-heading"><strong>항목별 확인 결과</strong></div><div class="readout-grid">${entries.map(([question,[answer,detail,tone]])=>`<article class="readout-card ${tone}"><span class="readout-symbol" aria-hidden="true">${tone === "yes" ? "✓" : tone === "no" ? "×" : "−"}</span><div class="readout-copy"><div class="readout-title"><strong>${esc(question)}</strong><b class="readout-status">${esc(answer)}</b></div><p>${esc(detail)}</p></div></article>`).join("")}</div>`;
}
function pqDetails(item){
  if(item.conversion_v4){const r=item.conversion_v4.result || {},p=r.p1_validation || {};
    return {present:true,embedded:false,detached:true,status:p.claim_signature === "VALID" && p.hard_binding === "VALID" && p.soft_binding === "VALID" ? "VALID" : "UNVERIFIED",schema:p.profile,signatureValid:p.claim_signature === "VALID",reason:"V4 변환 응답의 DB P1 검증 결과입니다. 이미지 안의 P1을 검사한 결과가 아닙니다."};
  }
  if(item.pqc_process)return {present:false,status:'UNVERIFIED',reason:item.pqc_process.message||'PQC 처리를 완료하지 못했습니다.'};
  const store=item.store || {}, active=store.manifests?.[store.active_manifest] || {};
  const assertion=(active.assertions || []).find(a=>String(a.label || "").startsWith("org.pq-c2pa.p1"));
  const data=assertion?.data || {}, payload=data.payload || {};
  const ev=item.pq_evidence || {};
  const present=Boolean(ev.present || assertion || ["VALID","INVALID"].includes(ev.status));
  let status=ev.status || (present ? "UNVERIFIED" : "UNKNOWN");
  if (!present && (["Error","RemoteUnavailable","Unknown"].includes(item.state) || item.processing_mode === "browser")) status="UNVERIFIED";
  return {present,status,embedded:!!assertion,reason:ev.reason || "",algorithm:ev.signature_algorithm || data.signature_algorithm,
    hashValid:ev.payload_hash_valid, payloadHash:ev.payload_sha3_256 || data.payload_sha3_256,
    sourceHash:ev.source_file_sha3_256 || payload.source_file_sha3_256,
    sourceManifest:ev.m0_active_manifest || payload.m0_active_manifest,
    sourceState:ev.m0_validation_state || payload.m0_validation_state,
    created:ev.created_at || payload.created_at,schema:ev.schema || data.schema,
    signatureValid:ev.signature_valid,verifier:ev.verifier,publicKeyHash:ev.public_key_sha256};
}
function pqPlain(item){
  if(item.pqc_process && !item.conversion_v4)return item.pqc_process.message||'PQC 처리를 완료하지 못했습니다. C2PA 검사 결과는 별도 항목에서 확인하세요.';
  const pq=pqDetails(item);
  if(pq.detached)return "V4 서버가 DB에 별도로 저장된 P1의 서명·바인딩을 검증한 결과입니다. 자체 루트 기준이며 실험용 PQ 프로파일입니다.";
  return ({VALID:"이미지에 포함된 기존 형식의 P1 서명 검사를 통과했습니다. 외부 DB의 P1은 조회하지 않았으며 공개키 소유자 신뢰도 별도로 확인해야 합니다.",
    INVALID:"양자내성 P1 검사에서 오류가 확인되었습니다. 검사 상세의 사유를 확인하세요.",
    UNVERIFIED:"양자내성 증거 또는 서명을 확인하지 못했습니다. 검사하지 못한 항목을 통과로 해석할 수 없습니다.",
    NOT_PRESENT:"이미지 내 P1은 확인되지 않았습니다. 외부 DB의 P1은 조회하지 않아 유무와 서명 상태를 확인할 수 없습니다.",
    UNKNOWN:"양자내성 증거의 검사 상태를 확인할 수 없습니다."})[pq.status] || "양자내성 검사 상태를 확인할 수 없습니다.";
}
function explanationKey(item,mode){return `${item.id || state.active}:${mode}`;}
function localExplanation(item,mode){
  const status=item.state || "Unknown", totals=displayCounts(item);
  const explanations={
    Trusted:["출처 기록과 서명자 확인이 모두 끝났습니다.","서명과 파일의 연결이 검증됐고, 선택한 신뢰 목록에서 서명자도 확인됐습니다.","출처 이력에서 누가 무엇을 기록했는지 살펴보세요."],
    Valid:["출처 기록은 유효하지만 서명자 신뢰는 확인되지 않았습니다.","서명 검사는 통과했지만 현재 선택한 신뢰 목록에서 서명자를 찾지 못했습니다.","제작자에게 서명 정보를 확인하거나 다른 신뢰 자료와 함께 보세요."],
    Invalid:["출처 기록 검증에 실패했습니다.","기록이나 서명 검사에 실패한 항목이 있습니다. 원인은 검사 상세를 봐야 구분할 수 있습니다.","검사 상세에서 실패한 코드를 확인하고 원본 파일을 다시 받아보세요."],
    NoManifest:["이 파일에서 C2PA 출처 기록을 찾지 못했습니다.","기록이 처음부터 없었거나 전달 과정에서 사라졌을 수 있습니다. 이 결과는 가짜 판정이 아닙니다.","가능하면 원본 파일을 받고 게시자의 설명이나 다른 자료도 확인하세요."],
    RemoteUnavailable:["외부 출처 기록이 필요해 검증을 마치지 못했습니다.","현재 설정은 외부 기록을 가져오지 않으므로 기록의 상태를 확인할 수 없습니다.","제공자에게 출처 기록이 파일 안에 포함된 원본을 요청해 보세요."],
    Error:["파일 분석을 마치지 못했습니다.","파일 형식이나 손상 등으로 검사 결과를 얻지 못했습니다. C2PA 기록 유무도 단정할 수 없습니다.","파일을 다시 다운로드하거나 다른 원본으로 재검증해 보세요."]
  };
  const [summary,meaning,next_step]=explanations[status] || ["검증 상태를 확정하지 못했습니다.","현재 결과만으로 출처 기록의 상태를 단정할 수 없습니다.","원본 파일로 다시 검증해 보세요."];
  const detail=mode === "detail" ? ` 검사 기록에는 통과 ${totals.success}개, 실패 ${totals.failure}개, 신뢰 미확인 ${totals.warning}개, 안내 ${totals.informational}개가 표시됩니다. ${aiOrigin(item).kind !== "unknown" ? "AI 관련 작업이 출처 기록에 표시되어 있지만 이것은 독립적인 AI 탐지가 아닙니다." : "AI 관련 기록이 보이지 않아도 AI 사용 여부를 확정할 수는 없습니다."}` : "";
  return {mode,source:"built_in",summary,meaning:meaning+detail,next_step,limit:"출처 검증은 사진 속 장면의 사실 여부, 법적 소유권 또는 AI 생성 여부를 단독으로 증명하지 않습니다."};
}
function renderAiPanel(item) {
  const key=explanationKey(item,state.explainMode);
  const error=state.explainErrors.get(key) || "";
  const busy=state.explainBusy === key;
  const simple=state.explanations.get(explanationKey(item,"simple")) || localExplanation(item,"simple");
  const detail=state.explanations.get(explanationKey(item,"detail")) || localExplanation(item,"detail");
  const output=state.explainMode === "detail" ? detail : simple;
  const availability="핵심 요약 또는 자세히 설명을 누르면 AI 설명을 생성합니다. 검증 상태와 검사 코드만 서버로 보내며 파일과 원본 메타데이터는 보내지 않습니다.";
  const outputBody=output.source === "ai"
    ? `<p style="white-space:pre-wrap">${esc(output.summary)}</p>`
    : `<h4>${esc(output.summary)}</h4><p><b>무슨 뜻인가요?</b> ${esc(output.meaning)}</p><p><b>다음에는?</b> ${esc(output.next_step)}</p>`;
  const panel=$("#ai-explanation");
  if(!panel.querySelector(".ai-explanation-output"))panel.innerHTML=`<div class="ai-explanation-head"><div><span class="ai-report-icon" aria-hidden="true">${aiReportIcon()}</span><strong>AI 결과 보고서</strong><p>${esc(availability)}</p></div><div class="ai-explanation-actions"><button type="button" data-explain="simple">핵심 요약</button><button type="button" data-explain="detail">자세히 설명</button></div></div><p class="ai-explanation-error" role="alert" hidden></p><p class="ai-explanation-wait" role="status" hidden>결과를 쉬운 말로 바꾸는 중…</p><div class="ai-explanation-output" aria-live="polite" aria-atomic="true"></div>`;
  for(const button of panel.querySelectorAll("[data-explain]")){
    button.disabled=Boolean(state.explainBusy);
    button.setAttribute("aria-pressed",String(button.dataset.explain === state.explainMode));
  }
  const errorNode=panel.querySelector(".ai-explanation-error"),waitNode=panel.querySelector(".ai-explanation-wait");
  errorNode.textContent=error;errorNode.hidden=!error;waitNode.hidden=!busy;
  const target=panel.querySelector(".ai-explanation-output");
  target.setAttribute("aria-busy",String(busy));
  const content=`<span>${output.source === "ai" ? "AI가 작성한 설명" : "검증 결과 기본 해설"} · ${state.explainMode === "detail" ? "자세히" : "요약"}</span>${outputBody}<p class="ai-pq-evidence"><b>PQC 변환·서명 확인</b> ${esc(pqPlain(item))}</p><small>${esc(output.limit)}</small>`;
  // Keep the previous answer mounted during the request; animate only changed text.
  const contentKey=JSON.stringify([key,content]);
  if(target.dataset.contentKey === contentKey)return;
  target.getAnimations().forEach(animation=>animation.cancel());
  const before=target.getBoundingClientRect().height,hadContent=Boolean(target.dataset.contentKey);
  target.innerHTML=content;target.dataset.contentKey=contentKey;
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const after=target.getBoundingClientRect().height;
  target.animate([{opacity:0,transform:"translateY(7px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,easing:"cubic-bezier(.2,.65,.3,1)"});
  if(hadContent && Math.abs(after-before)>1)target.animate([{height:`${before}px`},{height:`${after}px`}],{duration:280,easing:"ease-out"});
}
function aiReportIcon(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>`;}
async function requestAiSummary(item,mode,signal){
    const priority={failure:0,informational:1,success:2};
    const checks=(item.checks || []).filter(check=>["success","failure","informational"].includes(check.kind))
      .sort((a,b)=>priority[a.kind]-priority[b.kind]).slice(0,20)
      .map(check=>({kind:check.kind,code:String(check.code || "").replace(/[^A-Za-z0-9_.:-]/g,"").slice(0,100)}));
    const report={state:stateLabels[item.state] ? item.state : "Unknown",manifest_count:Math.min(1000,Math.max(0,Number(item.manifest_count || 0))),ai_declaration:["created","edited","media"].includes(aiOrigin(item).kind) ? "declared" : "unknown",checks};
    report.trust_scope=item.trust_profile === "lab" ? "FRAMEWORK_LOCAL" : item.trust_profile === "standard" ? "SDK_DEFAULT" : "UNKNOWN";
    report.pq_status=pqDetails(item).status === "NOT_PRESENT" ? "UNKNOWN" : pqDetails(item).status;
    const payload={audience:mode === "detail" ? "researcher" : "general",report:item.conversion_v4 && v4Module ? {...v4Module.aiEvidence(item.conversion_v4,item.v4_registration_record),classic_inspection:report} : report};
    const response=await responseJSON(await fetch("/api/v1/ai/summaries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal}));
    const summary=response.data?.summary;
    if(typeof summary !== "string" || !summary.trim())throw new Error("서버가 비어 있는 AI 요약을 반환했습니다.");
    return {mode,source:"ai",summary:summary.trim(),limit:localExplanation(item,mode).limit};
}
async function explainCurrent(mode){
  const item=result();if(!item || state.explainBusy)return;
  state.explainMode=mode;
  const key=explanationKey(item,mode);
  state.explainErrors.delete(key);
  const cached=state.explanations.get(key);
  if(cached?.source === "ai"){renderAiPanel(item);return;}
  state.explainBusy=key;renderAiPanel(item);
  try {
    state.explanations.set(key,await requestAiSummary(item,mode));
  } catch(cause){state.explanations.set(key,localExplanation(item,mode));state.explainErrors.set(key,`${cause.message || "AI 요약 요청에 실패했습니다."} 기본 해설을 표시합니다. 버튼을 눌러 다시 시도할 수 있습니다.`);}
  finally {state.explainBusy="";if(result())renderAiPanel(result());}
}
const HISTORY_ACTIONS={
  "c2pa.created":["콘텐츠 생성","이 콘텐츠를 생성하는 작업이 기록되었습니다. 실제 촬영이나 제작 과정을 모두 확인했다는 뜻은 아닙니다."],
  "c2pa.edited":["콘텐츠 편집","콘텐츠를 편집하는 작업이 기록되었습니다. 이 항목만으로 수정한 부분이나 편집의 목적은 알 수 없습니다."],
  "c2pa.opened":["파일 열기","도구에서 파일을 열었다고 기록되어 있습니다. 파일을 열었다는 것만으로 내용이 수정되었다는 뜻은 아닙니다."],
  "c2pa.placed":["재료 삽입","다른 콘텐츠를 재료로 사용한 작업이 기록되었습니다. 아래의 ‘연결된 재료’에서 확인 가능한 재료를 볼 수 있습니다."],
  "c2pa.resized":["크기 변경","이미지 크기를 변경한 작업이 기록되었습니다. 구체적인 크기는 기록에 표시된 경우에만 확인할 수 있습니다."],
  "c2pa.cropped":["이미지 자르기","이미지의 일부를 잘라 내는 작업이 기록되었습니다. 이 설명만으로 잘린 영역은 알 수 없습니다."],
  "c2pa.published":["콘텐츠 게시","콘텐츠를 게시하는 작업이 기록되었습니다. 이 기록만으로 게시된 장소나 현재 게시 상태를 확인할 수는 없습니다."],
  "c2pa.transcoded":["파일 형식 변환","파일의 표현 또는 인코딩을 변환하는 작업이 기록되었습니다. 구체적인 변환 내용은 원본 기록에서 확인하세요."]
};
function historyAgent(value){
  if(typeof value === "string")return value.trim();
  if(value && typeof value === "object"){
    const name=typeof value.name === "string" ? value.name : "";
    const version=typeof value.version === "string" || typeof value.version === "number" ? String(value.version) : "";
    return [name,version].filter(Boolean).join(" · ");
  }
  return "";
}
function historySourceLabel(value){
  const code=String(value || "").split(/[\/#]/).pop();
  return ({digitalCapture:"기기로 캡처한 콘텐츠로 기록됨",digitalArt:"디지털 제작 콘텐츠로 기록됨",trainedAlgorithmicMedia:"AI를 이용해 생성한 콘텐츠로 기록됨",compositeWithTrainedAlgorithmicMedia:"AI 생성 요소를 포함한 콘텐츠로 기록됨",compositedWithTrainedAlgorithmicMedia:"AI 생성 요소를 포함한 콘텐츠로 기록됨",algorithmicallyEnhanced:"알고리즘으로 수정한 콘텐츠로 기록됨"})[code] || "출처 유형이 기록됨";
}
function renderActions(item) {
  const actions=Array.isArray(item.actions) ? item.actions : [];
  const readable=Boolean(item.store?.active_manifest && item.store?.manifests?.[item.store.active_manifest]);
  if(!actions.length)return `<p class="empty history-empty">${readable ? "현재 출처 기록에 표시된 작업 이력이 없습니다. 이 사실만으로 편집이 없었다고 판단할 수는 없습니다." : item.state === "NoManifest" ? "이 파일에서 C2PA 출처 기록을 찾지 못해 작업 이력을 볼 수 없습니다. 기록이 없다는 사실만으로 변조 여부를 판단할 수는 없습니다." : "현재 출처 기록을 읽지 못해 제작·편집 작업을 확인할 수 없습니다."}</p>`;
  return `<ol class="timeline history-timeline">${actions.map((raw,index)=>{
    const action=raw && typeof raw === "object" ? raw : {}, code=typeof action.action === "string" ? action.action : "";
    const [label,explanation]=HISTORY_ACTIONS[code] || ["기타 기록된 작업","출처 기록에 작업이 있지만, 이 도구에서는 작업의 의미를 자세히 해석할 수 없습니다. 원본 항목을 확인하세요."];
    const agent=historyAgent(action.softwareAgent), timestamp=typeof action.when === "string" ? action.when : "";
    const source=typeof action.digitalSourceType === "string" ? action.digitalSourceType : "";
    return `<li><div class="history-action"><div class="history-action-head"><strong>${esc(label)}</strong><span>기록 순서 ${index+1}</span></div><p>${esc(explanation)}</p><div class="history-action-meta"><div><span>기록된 도구</span><strong>${esc(agent || "정보 없음")}</strong></div><div><span>기록된 시각</span><strong>${esc(timestamp || "정보 없음")}</strong></div>${source ? `<div><span>출처 유형</span><strong>${esc(historySourceLabel(source))}</strong></div>` : ""}</div><details class="history-raw"><summary>원본 작업 항목 보기</summary><p>작업 코드: <code>${esc(code || "정보 없음")}</code></p>${source ? `<p>출처 유형 코드: <code>${esc(source)}</code></p>` : ""}<pre>${esc(JSON.stringify(action,null,2))}</pre></details></div></li>`;
  }).join("")}</ol>`;
}
function renderChain(item) {
  const store=item.store || {}, manifests=store.manifests || {};
  const keys=Object.keys(manifests).sort((a,b)=>Number(a === store.active_manifest)-Number(b === store.active_manifest));
  if(!keys.length)return `<p class="empty history-empty">열어 볼 수 있는 출처 기록이 없습니다. 기록 유무를 확인하지 못한 경우에는 검사 상세에서 원인을 확인하세요.</p>`;
  return `<div class="chain">${keys.map((id,index)=>{
    const node=manifests[id] || {}, sig=node.signature_info || {}, thumb=item.manifest_thumbnails?.[id], active=id === store.active_manifest;
    const safeThumb=/^data:image\/(jpeg|png|webp);base64,/i.test(thumb || "") ? `<img src="${esc(thumb)}" alt="출처 기록의 썸네일">` : `<span class="chain-fallback">${index+1}</span>`;
    const nodeIngredients=Array.isArray(node.ingredients) ? node.ingredients : [];
    const ingredientNames=nodeIngredients.map(ingredient=>ingredient?.title || ingredient?.relationship || "이름 미기록").join(", ");
    return `<article class="chain-card ${active ? "active" : ""}"><div class="chain-thumb">${safeThumb}</div><div><span>${active ? "현재 파일에서 선택된 출처 기록" : "함께 읽힌 다른 출처 기록"}</span><h4>${esc(node.title || "제목이 기록되지 않음")}</h4><p>${active ? "이 파일의 현재 출처 기록으로 사용됩니다." : "파일과 함께 읽힌 기록입니다. 표시 순서만으로 생성 순서를 판단하지 않습니다."}</p><small>기록된 서명자: ${esc(sig.common_name || "정보 없음")} · 인증서 발급자: ${esc(sig.issuer || "정보 없음")} · 형식: ${esc(node.format || (active ? item.mime : "") || "정보 없음")}</small>${ingredientNames ? `<p>이 기록에 적힌 재료: ${esc(ingredientNames)}</p>` : ""}<details class="history-raw"><summary>기록 식별자 보기</summary><code>${esc(id)}</code></details></div></article>`;
  }).join("")}</div>`;
}
function renderHistoryIngredients(item){
  const ingredients=Array.isArray(item.ingredients) ? item.ingredients : [];
  const readable=Boolean(item.store?.active_manifest && item.store?.manifests?.[item.store.active_manifest]);
  if(!ingredients.length)return `<p class="empty history-empty">${readable ? "현재 기록에서 연결된 재료가 확인되지 않았습니다. 재료를 사용하지 않았다는 뜻은 아닙니다." : item.state === "NoManifest" ? "C2PA 출처 기록을 찾지 못해 연결된 재료를 확인할 수 없습니다." : "현재 기록을 읽지 못해 연결된 재료를 확인할 수 없습니다."}</p>`;
  const descriptions={parentOf:["이전 단계로 연결됨","이 파일의 이전 단계에 사용된 재료로 기록되어 있습니다."],componentOf:["구성 재료로 연결됨","콘텐츠를 구성하는 데 사용된 재료로 기록되어 있습니다."],inputTo:["입력 재료로 연결됨","작업에 사용된 입력 자료로 기록되어 있습니다."]};
  return `<div class="history-ingredients">${ingredients.map(raw=>{
    const ingredient=raw && typeof raw === "object" ? raw : {}, relation=typeof ingredient.relationship === "string" ? ingredient.relationship : "";
    const [label,description]=descriptions[relation] || ["재료로 기록됨","연결된 재료가 기록되어 있습니다. 구체적인 관계는 원본 항목을 확인하세요."];
    const title=typeof ingredient.title === "string" && ingredient.title.trim() ? ingredient.title : "이름이 기록되지 않은 재료";
    return `<article><strong>${esc(title)}</strong><span>${esc(label)}</span><p>${esc(description)}</p><small>재료가 기록되었다는 사실만으로 해당 재료의 진위나 원본의 위치를 확인할 수는 없습니다.</small></article>`;
  }).join("")}</div>`;
}
function pqDisplayValue(value){return typeof value === "string" && value.trim() ? value.trim() : "";}
function pqShort(value){const text=pqDisplayValue(value);return text.length > 38 ? `${text.slice(0,22)}…${text.slice(-10)}` : text || "확인되지 않음";}
function pqRow(label,value){return `<div class="pq-record-row"><span>${esc(label)}</span><strong>${esc(value || "확인되지 않음")}</strong></div>`;}
function pqFullValue(label,value){
  const text=pqDisplayValue(value);
  return `<div class="pq-full-value"><div><span>${esc(label)}</span>${text ? `<button type="button" class="pq-copy" data-pq-copy="${esc(text)}" aria-label="${esc(label)} 복사">복사</button>` : ""}</div><code>${esc(text || "확인되지 않음")}</code></div>`;
}
function pqSoftBinding(manifest){
  const assertion=(Array.isArray(manifest.assertions) ? manifest.assertions : []).find(a=>String(a?.label || "").startsWith("c2pa.soft-binding"));
  const data=assertion?.data && typeof assertion.data === "object" ? assertion.data : {};
  return {present:!!assertion,label:assertion?.label,algorithm:pqDisplayValue(data.alg || data.algorithm),
    display:pqDisplayValue(data.display || (typeof data.value === "string" && data.value.startsWith("ISCC:") ? data.value : "")),
    encoded:pqDisplayValue(data.value_base64)};
}
function renderPqResult(item) {
  if((item.pqc_process || item.conversion_v4) && v4Module){
    const process=item.pqc_process||{},job=item.conversion_v4||process.job||{status:process.status||'UNAVAILABLE',source:{filename:item.input_inspection?.filename||item.filename},error:{message:process.message}};
    const original=item.input_inspection?`<details class="code-details" data-section="input-inspection"><summary>처리 전 입력 이미지의 C2PA 검사 · JSON</summary><pre>${esc(JSON.stringify(item.input_inspection,null,2))}</pre></details>`:'';
    return v4Module.renderResult(job,{classic:item,input:item.input_inspection,record:item.v4_registration_record,recordError:process.record_error,notice:process.message,paused:process.paused,isOutput:!!item.conversion_v4,actions:'unified'})+original;
  }
  const pq=pqDetails(item), manifest=activeManifest(item), signature=manifest.signature_info || item.signature || {};
  const store=item.store || {}, active=pqDisplayValue(store.active_manifest);
  const soft=pqSoftBinding(manifest), job=conversionFor(item), output=job?.result || {}, source=job?.source || {};
  const labels={VALID:"서명 검사 통과",INVALID:"검사 실패",UNVERIFIED:"검사하지 못함",NOT_PRESENT:"외부 P1 미조회",UNKNOWN:"확인 불가"};
  const pqLabel=labels[pq.status] || "확인 불가";
  const classicLabel=stateLabels[item.state] || "확인 불가";
  const parent=(Array.isArray(manifest.ingredients) ? manifest.ingredients : []).find(entry=>entry?.relationship === "parentOf");
  const parentId=pqDisplayValue(parent?.active_manifest), parentName=pqDisplayValue(parent?.title);
  const parentText=parentId ? pqShort(parentId) : parentName || "기록되지 않음";
  const location=pq.embedded ? "이미지에 포함된 기존 형식" : pq.present ? "기록 위치 미확인" : "외부 DB 미조회";
  const classicAlgorithmRaw=pqDisplayValue(signature.alg || signature.algorithm);
  const classicAlgorithm=/^(?:es|ps|rs)\d+$/i.test(classicAlgorithmRaw) ? classicAlgorithmRaw.toUpperCase() : classicAlgorithmRaw;
  const fp=soft.display || soft.encoded;
  const hashState=pq.hashValid === true ? "일치" : pq.hashValid === false ? "불일치" : "세부 결과 없음";
  const signatureState=pq.signatureValid === true ? "통과" : pq.signatureValid === false ? "실패" : "세부 결과 없음";
  const softDetail=soft.present ? `${pqRow("어설션",soft.label)}${pqRow("지문 알고리즘",soft.algorithm)}${pqFullValue(soft.display ? "기록된 ISCC 지문" : "기록된 지문 (Base64)",fp)}<p class="pq-record-note">출처 기록에 저장된 값입니다. 현재 이미지나 다른 기록과의 일치는 확인하지 않았습니다.</p>` : `<p class="pq-record-note">현재 C2PA 기록에서 소프트 바인딩을 찾지 못했습니다. 외부 기록은 조회하지 않았습니다.</p>`;
  return `<section class="pq-screen" aria-label="양자내성 서명 확인">
    <div class="pq-screen-heading"><span class="pq-screen-mark" aria-hidden="true">◇</span><div><span>QUANTUM-RESISTANT SIGNATURE</span><h3>양자내성 서명 확인</h3><p>현재 이미지의 기존 출처 기록과 확인 가능한 P1 정보를 살펴봅니다.</p></div></div>
    <div class="pq-result ${esc(pq.status.toLowerCase())}" aria-label="양자내성 검사 결과"><div><strong>P1 서명 검사</strong><b>${esc(pqLabel)}</b></div><p>${esc(pq.reason || pqPlain(item))}</p>${pq.reason ? `<small>${esc(pqPlain(item))}</small>` : ""}</div>
    <div class="pq-summary-cards"><article><span>분석 이미지</span><strong>${esc(item.filename || "파일 정보 없음")}</strong><small>현재 검사한 파일</small></article><article><span>기존 C2PA</span><strong>${esc(classicLabel)}</strong><small>서명·파일 결합 및 신뢰 상태</small></article><article><span>양자내성 기록 (P1)</span><strong>${esc(pq.algorithm || (pq.present ? "알고리즘 미확인" : "미확인"))}</strong><small>${esc(pqLabel)}</small></article></div>
    <div class="pq-records-heading"><h3>출처 기록 연결</h3><span>소프트 바인딩</span></div>
    <div class="pq-records"><article class="pq-record"><header><strong>현재 이미지의 C2PA 기록</strong><small>${esc(active ? "기록 확인" : "기록 미확인")}</small></header>
      ${pqRow("매니페스트 ID",pqShort(active))}${pqRow("서명 알고리즘",classicAlgorithm)}${pqRow("이전 출처 기록",parentText)}
      <details class="pq-record-detail" data-section="pq-classic"><summary><span class="pq-closed">기록 상세 보기</span><span class="pq-open">기록 상세 접기</span><i aria-hidden="true">⌄</i></summary>
        ${pqFullValue("전체 매니페스트 ID",active)}${parentId ? pqFullValue("이전 매니페스트 ID",parentId) : ""}${softDetail}
      </details></article>
      <div class="pq-link" aria-label="출처 기록 연결 상태"><span>연결 여부 미확인</span><small>${esc(soft.display ? pqShort(soft.display) : soft.present ? "지문 기록 확인" : "지문 확인되지 않음")}</small></div>
      <article class="pq-record"><header><strong>양자내성 기록 (P1)</strong><small>${esc(pq.embedded ? "이미지 내 기록" : "외부 DB 미조회")}</small></header>
        ${pqRow("기록 위치",location)}${pqRow("서명 알고리즘",pq.algorithm)}${pqRow("P1 검사 결과",pqLabel)}
        <details class="pq-record-detail" data-section="pq-p1"><summary><span class="pq-closed">기록 상세 보기</span><span class="pq-open">기록 상세 접기</span><i aria-hidden="true">⌄</i></summary>
          ${pqRow("기록 형식",pq.schema)}${pqFullValue("P1에 기록된 M0 매니페스트 ID",pq.sourceManifest)}${pqFullValue("P1 데이터 SHA3-256",pq.payloadHash)}${pqFullValue("기록된 원본 파일 SHA3-256",pq.sourceHash)}
          <p class="pq-record-note">기록된 원본 해시와 M0 ID는 원본 파일을 직접 대조했다는 뜻이 아닙니다. 외부 DB의 P1은 조회하지 않았습니다.</p>
        </details></article></div>
    <details class="pq-verification-detail" data-section="pq-verification"><summary>서명 검증 상세 <span aria-hidden="true">⌄</span></summary><div class="pq-verification-content">
      ${pqRow("P1 데이터 해시 검사",hashState)}${pqRow("P1 서명 검사",signatureState)}${pqRow("P1 검사 도구",pq.verifier)}${pqRow("P1 기록 생성 시각",pq.created ? when(pq.created) : "")}
      ${pqFullValue("P1 공개키 SHA-256",pq.publicKeyHash)}${pqRow("변환 작업 기록",job ? "이 브라우저에서 결과 파일의 해시와 일치하는 작업 확인" : "이 브라우저에서 연결된 작업을 찾지 못함")}
      ${job ? `${pqRow("변환 입력 파일",source.filename)}${pqRow("변환 결과 파일",output.filename)}` : ""}
      <p class="pq-record-note">P1 서명 통과는 공개키 소유자의 신뢰까지 확인했다는 뜻이 아닙니다. 외부 DB의 기록은 조회하지 않았습니다.</p>
    </div></details>${pq.status === "NOT_PRESENT" ? '<p class="pq-record-note">이미지 파일을 통합 검사에 넣으면 PQC 확인·생성을 함께 요청합니다.</p>' : ""}
  </section>`;
}
function renderOverview(item) {
  const signature=item.signature || {}, totals=displayCounts(item);
  const messages={
    Trusted:["기록의 제작·편집 과정을 살펴보세요.","history","출처 이력 보기"],
    Valid:["파일 검증은 통과했습니다. 확인되지 않은 신뢰 항목은 검사 상세에서 볼 수 있습니다.","checks","미확인 항목 보기"],
    Invalid:[`검증 실패 원인을 먼저 확인하세요.${totals.failure ? ` 실패한 검사 ${totals.failure}개를 표시했습니다.` : ""}`,"checks","실패 항목 보기"],
    NoManifest:["기록이 처음부터 없었거나 전달 과정에서 사라졌을 수 있습니다. 원본 파일을 받아 다시 검증해 보세요.",null,null],
    RemoteUnavailable:["출처 기록이 파일 밖에 있습니다. 기록이 내장된 파일을 제공자에게 요청해 보세요.","checks","검사 상세 보기"],
    Error:["파일 분석을 마치지 못했습니다. 파일 형식과 오류 내용을 확인한 뒤 다시 시도하세요.","checks","오류 내용 보기"]
  };
  const [message,tab,action]=messages[item.state] || ["원본 파일로 다시 검증해 보세요.","checks","검사 상세 보기"];
  return `<div class="overview-facts"><div><span>${term("서명자")}</span><strong>${esc(signature.common_name || "기록 없음")}</strong></div><div><span>${term("AI 생성 선언")}</span><strong>${esc(aiOrigin(item).label)}</strong></div></div><div class="next-step compact"><p>${esc(message)}</p>${tab ? `<button type="button" data-go-detail="${tab}">${esc(action)} →</button>` : ""}</div><p class="result-boundary">이 검사는 출처 기록을 확인합니다. 사진 속 장면의 사실 여부나 AI 사용 여부 자체를 판정하지는 않습니다.</p><p class="term-guide">밑줄 친 용어에 마우스를 올리거나 키보드로 선택하면 설명을 볼 수 있습니다.</p>`;
}
function renderChecks(item) {
  const priority={failure:0,warning:1,informational:2,success:3},totals=displayCounts(item);
  const list=(item.checks || []).map(check=>({check,...checkPresentation(check)})).sort((a,b)=>priority[a.tone]-priority[b.tone]);
  const shown=state.checkFilter === "all" ? list : list.filter(row=>row.tone === state.checkFilter);
  const filters=[["all","전체",list.length],["failure","실패",totals.failure],["warning","신뢰 미확인",totals.warning],["success","통과",totals.success],["informational","안내",totals.informational]];
  return `<div class="checks-heading"><h3>항목별 검사 근거</h3><p>실패 → 신뢰 미확인 → 안내 → 통과 순으로 표시합니다.</p></div><div class="filter-bar"><div>${filters.map(([kind,label,total])=>`<button type="button" data-check-filter="${kind}" class="${state.checkFilter === kind ? "active" : ""}" aria-pressed="${state.checkFilter === kind}">${label} ${total}</button>`).join("")}</div></div>${item.error ? `<p class="analysis-error" role="status"><strong>분석 오류</strong> ${esc(item.error)}</p>` : ""}${shown.length ? `<div class="check-rows">${shown.map(({check,tone,label,icon,title,detail})=>`<article class="check ${tone}"><span class="check-mark" aria-hidden="true">${icon}</span><div><strong>${esc(title)}</strong><p>${esc(detail)}</p><details class="check-code"><summary>원본 검사 코드</summary><code>${esc(check.code || "코드 없음")}</code><small>SDK 분류: ${esc(check.kind || "정보 없음")} · 범위: ${esc(check.scope || "Manifest")}</small>${check.explanation || check.message ? `<p>${esc(check.explanation || check.message)}</p>` : ""}${check.url ? `<code>${esc(check.url)}</code>` : ""}</details></div><b class="check-status">${label}</b></article>`).join("")}</div>` : `<p class="empty">${list.length ? "이 분류에 해당하는 검사 항목이 없습니다." : "완료된 검사 항목이 없습니다. 통과를 의미하지 않습니다."}</p>`}<p class="small-note">‘신뢰 미확인’은 신뢰 목록에서 확인하지 못한 상태입니다. 실제 서명·파일 불일치는 ‘실패’로 표시합니다. SDK 원본 분류는 각 항목에서 확인할 수 있습니다.</p>`;
}
function renderJsonTree(value,depth=0) {
  if(value === null || typeof value !== "object") return `<span class="json-value">${esc(JSON.stringify(value))}</span>`;
  if(depth >= 5) return `<span class="json-value">${esc(Array.isArray(value) ? `[${value.length}개 항목]` : `{${Object.keys(value).length}개 항목}`)}</span>`;
  const entries=Object.entries(value), shown=entries.slice(0,60);
  return `<div class="json-children" data-scroll-region>${shown.map(([key,child])=>`<div class="json-row"><span class="json-key">${term(key)}</span>${child && typeof child === "object" ? `<details class="json-branch"><summary>${Array.isArray(child) ? `[${child.length}개 항목]` : `{${Object.keys(child).length}개 항목}`}</summary>${renderJsonTree(child,depth+1)}</details>` : renderJsonTree(child,depth+1)}</div>`).join("")}${entries.length>shown.length ? `<p class="json-truncated">${entries.length-shown.length}개 항목은 전체 JSON 다운로드에서 확인하세요.</p>` : ""}</div>`;
}
function renderJsonBox(label,value,open=false){return `<details class="code-details" ${open ? "open" : ""}><summary>${esc(label)}</summary><p class="scroll-hint">마우스를 이 영역 위에 놓고 스크롤하면 이 상자만 움직입니다. 끝에 닿으면 바깥 결과가 움직입니다.</p>${renderJsonTree(value)}<details class="json-raw"><summary>원문 텍스트 보기</summary><pre data-scroll-region>${esc(JSON.stringify(value,null,2))}</pre></details></details>`;}
function renderHistory(item) {
  const store=item.store || {}, readable=Boolean(store.active_manifest && store.manifests?.[store.active_manifest]);
  const actions=Array.isArray(item.actions) ? item.actions : [], ingredients=Array.isArray(item.ingredients) ? item.ingredients : [];
  const manifestCount=Object.keys(store.manifests || {}).length;
  const warning=item.state === "Invalid" ? `<p class="history-warning">검증에 실패한 항목이 있습니다. 아래는 읽을 수 있었던 기록이며, 사용하기 전에 검사 상세에서 실패 원인을 확인하세요. <button type="button" data-go-detail="checks">검사 상세 보기 →</button></p>` : "";
  const counts=readable ? `<p class="history-counts">읽은 출처 기록 ${manifestCount}개 · 현재 기록의 작업 ${actions.length}개 · 연결된 재료 ${ingredients.length}개</p>` : `<p class="history-counts">읽을 수 있는 현재 출처 기록이 없어 이력을 확인하지 못했습니다.</p>`;
  return `<div class="history-intro"><h3>이 파일의 출처 이력</h3><p>파일에 연결된 기록에서 읽은 제작·편집 작업과 사용된 재료를 보여줍니다. 기록된 내용은 작성자의 주장으로, 실제 과정 전체나 사진의 진실을 보증하지 않습니다.</p>${counts}${warning}</div><section class="history-section"><h3>기록된 작업</h3><p class="history-guide">아래 순서는 기록에 담긴 순서이며 실제 작업의 시간순이나 전체 과정을 보장하지 않습니다. 기록된 시각도 인증된 시간이라는 뜻은 아닙니다.</p>${renderActions(item)}</section><section class="history-section"><h3>연결된 출처 기록</h3><p class="history-guide">현재 파일의 출처 기록과 함께 읽힌 다른 기록입니다. 서명자 이름은 기록된 인증서 정보이며 신뢰 여부는 검증 요약에서 확인하세요.</p>${renderChain(item)}</section><section class="history-section"><h3>연결된 재료</h3><p class="history-guide">제작이나 편집에 사용했다고 기록된 이전 파일 또는 콘텐츠입니다.</p>${renderHistoryIngredients(item)}${ingredients.length ? renderJsonBox("재료의 원본 기록 보기",ingredients) : ""}</section>`;
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
  return `<g class="map-node" data-node="${id}" tabindex="0" role="button" aria-label="${esc(title)}: ${esc(subtitle)}"><title>${esc(title)}: ${esc(subtitle)}</title><rect x="${x}" y="${y}" width="${width}" height="96" rx="17" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${x+18}" y="${y+34}" class="node-title">${esc(title)}</text><text x="${x+18}" y="${y+63}" class="node-subtitle">${shortSvg(subtitle,Math.floor(width/11))}</text><circle cx="${x+width-23}" cy="${y+23}" r="11" fill="#fff" stroke="${stroke}"/><text x="${x+width-23}" y="${y+28}" text-anchor="middle" class="node-hint">i</text></g>`;
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
    <p class="structure-warning">이 그림은 결과를 이해하기 위한 요약입니다. 서명 검사 세부 내용은 검사 상세에서 확인하세요.</p>`;
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
  $("#results").classList.toggle("pqc-view",state.detail === "pqc");
  const item=result(); if (!item) return;
  if(!["pqc","overview","history","checks"].includes(state.detail))state.detail="overview";
  $$('[data-detail]').forEach(tab=>{
    const selected=tab.dataset.detail===state.detail;
    tab.classList.toggle("active",selected);tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected ? 0 : -1;
  });
  $("#readout").hidden=state.detail!=="overview";
  $("#verdict").hidden=state.detail!=="overview";
  const target=$("#detail-panel"), viewKey=`${item.id || state.active}:${state.detail}`;
  const expanded=target.dataset.viewKey === viewKey ? [...target.querySelectorAll("details[data-section][open]")].map(node=>node.dataset.section) : [];
  target.innerHTML = state.detail === "checks"
    ? `${renderChecks(item)}<div class="evidence-folders"><details data-section="technical"><summary>서명·검증 환경</summary>${renderSummary(item)}</details><details data-section="file"><summary>파일 정보</summary>${renderMetadata(item)}</details><details data-section="manifest"><summary>원본 출처 기록 · JSON</summary>${renderManifest(item)}</details><details data-section="anchors"><summary>시간 정보·공개 참조</summary>${renderAnchors(item)}</details></div>`
    : state.detail === "history" ? `${renderHistory(item)}<details class="history-map" data-section="map"><summary>출처 연결을 그림으로 보기</summary>${renderStructure(item)}</details>` : state.detail === "pqc" ? renderPqResult(item) : renderOverview(item);
  for(const section of target.querySelectorAll("details[data-section]"))section.open=expanded.includes(section.dataset.section);
  target.dataset.viewKey=viewKey;
  $("#result-tabpanel").setAttribute("aria-labelledby",`detail-tab-${state.detail}`);
}
function selectDetail(name) {
  state.detail=name;state.checkFilter="all";renderDetail();
  $(".report-scroll").scrollTop=0;
}
function render() {
  const item=result(); $("#results").hidden=!item; if(!item)return;
  document.body.classList.add("has-results");
  $("#file-count").textContent=`${state.results.length}개`;
  item.ai_origin=aiOrigin(item);
  const pageNotice=$("#page-analysis-notice"), batch=item.page_analysis;
  pageNotice.hidden=!batch;
  if(batch){const failures=Array.isArray(batch.failures) ? batch.failures : [];
    pageNotice.innerHTML=`<strong>게시물 사진 검사: ${esc(batch.completed)} / ${esc(batch.total)}개 완료${batch.stopped ? " · 중단됨" : ""}</strong>${batch.aiFailed ? `<p>AI 설명을 생성하지 못해 기본 해설을 표시합니다. 결과에서 다시 요청할 수 있습니다.</p>` : ""}${failures.length ? `<details><summary>${failures.length}개 검사하지 못함 · 사유 보기</summary><ul>${failures.map(message=>`<li>${esc(message)}</li>`).join("")}</ul></details>` : ""}`;
  }else pageNotice.innerHTML="";
  $("#preview-filename").textContent=item.filename || "파일 미리보기";
  $("#preview-subtitle").textContent=`${(item.mime || "파일").split("/").pop().toUpperCase()} · ${sizes(item.size)}`;
  $("#ai-origin").innerHTML=renderAiOrigin(item);
  renderActivity(item);
  renderBatch(); renderVerdict(item); renderReadout(item); renderAiPanel(item); renderPreview(item); renderDetail();
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
function pdfReportName(item,type) {const label={summary:"일반인용",submission:"경찰서제출용",pq:"PQ변환본종합",technical:"상세분석"}[type] || "보고서";return `${(item.filename || "file").replace(/[^\p{L}\p{N}._-]/gu,"_")}-C2PA-${label}.pdf`;}
function copy(value) {navigator.clipboard.writeText(value).then(()=>toast("링크를 복사했습니다.")).catch(()=>toast(value));}
function reportURL(id) {const url=new URL("/viewer/",location.origin);url.searchParams.set("report",id);return url.href;}
function liveURL(item) {const url=new URL("/viewer/",location.origin);url.searchParams.set("url",item.source_url);url.searchParams.set("trust",item.trust_profile || "standard");return url.href;}

$("#tab-file").onclick=()=>setMode("file"); $("#tab-url").onclick=()=>setMode("url");
$("#dropzone").onclick=()=>{if(!state.busy)$("#file-input").click();};
$("#dropzone").onkeydown=event=>{if(event.key === "Enter" || event.key === " "){event.preventDefault();$("#file-input").click();}};
$("#file-input").onchange=event=>intakeFiles(event.target.files);
$("#url-form").onsubmit=event=>{event.preventDefault();verifyURL($("#url-input").value.trim());};
$$("[data-sample]").forEach(button=>button.onclick=()=>verifySample(button.dataset.sample));
function showIntake(){navigatePage("verify");window.scrollTo({top:0,behavior:"instant"});$("#return-results").hidden=!result();setMode(state.mode);}
$("#new-check").onclick=showIntake;
$("#new-check-secondary").onclick=showIntake;
$("#return-results").onclick=()=>{clearPending();render();};
function isFileDrag(event){return Array.from(event.dataTransfer?.types || []).includes("Files");}
function intakeAcceptsDrop(){return !state.busy && state.mode === "file" && !document.body.classList.contains("has-results") && routeFromHash() === "verify" && !document.querySelector("dialog[open]");}
function clearIntakeDrop(){ $("#dropzone").classList.remove("dragging"); $("#upload-preview").classList.remove("dragging"); }
for(const kind of ["dragenter","dragover"])window.addEventListener(kind,event=>{
  if(!isFileDrag(event))return;
  event.preventDefault();
  if(intakeAcceptsDrop()){$("#dropzone").classList.add("dragging");$("#upload-preview").classList.add("dragging");}
});
window.addEventListener("dragleave",event=>{if(!event.relatedTarget)clearIntakeDrop();});
window.addEventListener("dragend",clearIntakeDrop);
window.addEventListener("drop",event=>{
  if(!isFileDrag(event))return;
  event.preventDefault();clearIntakeDrop();
  if(intakeAcceptsDrop()){
    const files=Array.from(event.dataTransfer.files || []);
    if(files.length)intakeFiles(files);
  }
});
$("#files-toggle").onclick=()=>{
  const button=$("#files-toggle"), content=$("#files-content");
  const expanded=button.getAttribute("aria-expanded") === "true";
  content.hidden=expanded;$("#results").classList.toggle("files-collapsed",expanded);
  button.setAttribute("aria-expanded",String(!expanded));
  button.setAttribute("aria-label",expanded ? "분석 파일 목록 펼치기" : "분석 파일 목록 접기");
  button.innerHTML=expanded ? "〉 <span>파일 목록 펼치기</span>" : "〈 <span>파일 목록 접기</span>";
};

$("#batch-list").onclick=event=>{const button=event.target.closest("[data-result-index]");if(!button)return;state.active=Number(button.dataset.resultIndex);state.selectedManifest=result().store?.active_manifest || null;render();};
$(".detail-tabs").onclick=event=>{const button=event.target.closest("[data-detail]");if(!button)return;selectDetail(button.dataset.detail);};
$(".detail-tabs").onkeydown=event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  const tabs=$$(".detail-tabs [data-detail]"),current=tabs.indexOf(event.target);
  if(current<0)return;
  event.preventDefault();
  const next=event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1 : (current+(event.key === "ArrowRight" ? 1 : -1)+tabs.length)%tabs.length;
  selectDetail(tabs[next].dataset.detail);tabs[next].focus();
};
$("#detail-panel").onclick=async event=>{const current=result();if(event.target.closest("[data-unified-resume]")){await resumeUnified(current);return;}if(event.target.closest("[data-unified-report]")){openReportDialog();return;}if(event.target.closest("[data-unified-download]")){try{const job=current.conversion_v4||current.pqc_process?.job,blob=await v4Asset(job);exportBlob(blob,job.result.filename,blob.type);}catch(cause){toast(cause.message);}return;}const copyButton=event.target.closest("[data-pq-copy]");if(copyButton){navigator.clipboard.writeText(copyButton.dataset.pqCopy).then(()=>toast("복사했습니다.")).catch(()=>toast("복사할 수 없습니다."));return;}if(event.target.closest("[data-open-conversion]")){navigatePage("verify");return;}const button=event.target.closest("[data-check-filter]");if(button){state.checkFilter=button.dataset.checkFilter;renderDetail();$(`[data-check-filter="${state.checkFilter}"]`).focus({preventScroll:true});}const jump=event.target.closest("[data-go-detail]");if(jump){selectDetail(jump.dataset.goDetail);$(`[data-detail="${state.detail}"]`).focus();}if(event.target.closest("#manifest-download")){const item=result();exportBlob(JSON.stringify(item.store || {},null,2),reportName(item,"manifest.json"),"application/json");}if(event.target.closest("#structure-download")){const item=result();exportBlob(buildStructureSvg(item),reportName(item,"structure.svg"),"image/svg+xml;charset=utf-8");toast("출처 구조 그림을 저장했습니다.");}if(event.target.closest("#structure-expand"))$("#structure-dialog").showModal();};
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
const REPORT_PROFILE_FIELDS={applicant:"#report-applicant"};
const REPORT_PROFILE_KEY="pq-c2pa-report-profile";
function loadReportProfile(){
  try{const saved=JSON.parse(localStorage.getItem(REPORT_PROFILE_KEY) || "{}");for(const [key,selector] of Object.entries(REPORT_PROFILE_FIELDS))if(typeof saved[key] === "string" && !$(selector).value)$(selector).value=saved[key].slice(0,80);}catch{}
}
function saveReportProfile(options){
  try{localStorage.setItem(REPORT_PROFILE_KEY,JSON.stringify(Object.fromEntries(Object.keys(REPORT_PROFILE_FIELDS).map(key=>[key,options[key] || ""]))));}catch{}
}
function reportOptions(){
  const type=$('input[name=report-type]:checked')?.value||'submission';
  const options={includePreview:true,register:true};
  if(type==='submission')for(const [key,selector] of Object.entries({applicant:'#report-applicant',contactPhone:'#report-contact-phone',submitTo:'#report-submit-to',purpose:'#report-purpose'}))options[key]=$(selector).value.trim();
  return options;
}
function syncReportMeta(){
  const submission=$('input[name=report-type]:checked')?.value==='submission';
  $('#report-meta').hidden=!submission;$('#report-meta').open=submission;
}
$$("input[name=report-type]").forEach(input=>input.addEventListener("change",syncReportMeta));
async function reportEnvironment(item){
  if(item.processing_mode === "browser")return null;
  try{const response=await fetch("/engine/api/health",{cache:"no-store"});return response.ok ? await response.json() : null;}catch{return null;}
}
const reportImages=new Map();
async function currentImageURL(item){
  const local=state.localUrls.get(item.id) || reportImages.get(item.id);
  if(local)return local;
  if(item.sample_id && /^[a-z]+$/.test(item.sample_id)){
    try{const response=await fetch(`/engine/api/samples/${encodeURIComponent(item.sample_id)}/file`,{cache:"no-store"});if(response.ok){const url=URL.createObjectURL(await response.blob());reportImages.set(item.id,url);return url;}}catch{}
  }
  return null;
}
// PQ conversion jobs from this browser session, looked up by the converted file's hash.
const CONVERSION_JOBS_KEY="pq-c2pa-conversions";
function rememberConversion(job){
  const output=job?.result || {};if(!output.file_sha3_256 && !output.file_sha256)return;
  try{const saved=JSON.parse(sessionStorage.getItem(CONVERSION_JOBS_KEY) || "[]").filter(entry=>entry?.result?.file_sha3_256 !== output.file_sha3_256);
    saved.unshift(job);sessionStorage.setItem(CONVERSION_JOBS_KEY,JSON.stringify(saved.slice(0,20)));}catch{}
}
function conversionFor(item){
  try{return JSON.parse(sessionStorage.getItem(CONVERSION_JOBS_KEY) || "[]").find(job=>(item.sha3_256 && job?.result?.file_sha3_256 === item.sha3_256) || (item.sha256 && job?.result?.file_sha256 === item.sha256)) || null;}catch{return null;}
}
function hasPqEvidence(item){
  if(item?.pq_evidence?.present)return true;
  const store=item?.store || {},active=(store.manifests || {})[store.active_manifest] || {};
  return (active.assertions || []).some(assertion=>String(assertion.label || "").startsWith("org.pq-c2pa.p1"));
}
function openReportDialog(preferred){
  const item=result();if(!item)return;
  $("#report-dialog-file").textContent=`${item.filename || "파일"} · ${stateLabels[item.state] || "상태 미확인"}`;
  $("#report-error").hidden=true;
  const wanted=preferred && $(`input[name=report-type][value=${preferred}]`);
  if(wanted)wanted.checked=true;
  loadReportProfile();syncReportMeta();
  $("#report-dialog").showModal();
}
$("#download-pdf").onclick=()=>openReportDialog();
$("#report-close").onclick=()=>$("#report-dialog").close();
$("#report-dialog").addEventListener("click",event=>{if(event.target === $("#report-dialog"))$("#report-dialog").close();});
function apiMessage(data){const detail=data?.detail;return typeof detail === "string" ? detail : Array.isArray(detail) ? "입력 형식을 확인하세요." : "";}
async function postJSON(url,body){
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const error=new Error(apiMessage(data) || `요청을 처리하지 못했습니다(${response.status}).`);error.status=response.status;throw error;}
  return data;
}
// Issue → build → seal. The server only receives hashes and the result summary; when it
// cannot be reached the PDF is still produced and clearly marked as unregistered.
async function requestIssuance(module,item,type,options){
  const body=await module.prepareIssuance(item,type,options);
  try{return await postJSON("/engine/api/report-issuances",body);}
  catch(cause){
    if(cause.status === 400){
      throw cause;
    }
    return {offline:true,reason:cause.status === 405 ? "발급 서버가 요청 방식을 지원하지 않음(HTTP 405)" : cause.status ? `발급 서버 응답 ${cause.status}` : "발급 서버에 연결하지 못함"};
  }
}
async function sealIssuance(issuance,bytes){
  try{
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const pdf_sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    await postJSON(`/engine/api/report-issuances/${encodeURIComponent(issuance.doc_no)}/finalize`,{verification_code:issuance.verification_code,pdf_sha256,pdf_size:bytes.byteLength});
    return true;
  }catch{return false;}
}
$("#report-generate").onclick=async()=>{
  const item=result();if(!item)return;
  const type=$("input[name=report-type]:checked")?.value || "submission";
  const button=$("#report-generate"),notice=$("#report-error");
  button.disabled=true;notice.hidden=true;
  try{
    const options=reportOptions();if(type==="submission")saveReportProfile(options);
    button.textContent="준비 중…";
    const [module,environment,currentImageUrl]=await Promise.all([import("./pdf-report.js?v=20261117-haetae"),reportEnvironment(item),options.includePreview ? currentImageURL(item) : null]);
    button.textContent="발급 번호 받는 중…";
    const issuance=options.register ? await requestIssuance(module,item,type,options) : null;
    button.textContent="PDF 만드는 중…";
    const bytes=await module.buildPdfReport(item,type,{...options,environment,currentImageUrl,conversion:conversionFor(item),issuance});
    const registered=Boolean(issuance && !issuance.offline);
    const sealed=registered ? await sealIssuance(issuance,bytes) : false;
    exportBlob(bytes,pdfReportName(item,type),"application/pdf");
    $("#report-dialog").close();
    toast(registered ? (sealed ? `발급 등록을 마쳤습니다 · ${issuance.doc_no}` : "PDF는 저장했지만 발급 서버에 PDF 등록을 마치지 못했습니다.")
      : issuance?.offline ? "발급 서버에 연결하지 못해 미등록 PDF로 저장했습니다." : "미등록 PDF로 저장했습니다.");
  }catch(cause){notice.textContent=`PDF를 만들지 못했습니다: ${cause.message}`;notice.hidden=false;}
  finally{button.disabled=false;button.textContent="선택한 PDF 다운로드 ↓";}
};

$("#download-html").onclick=()=>{const item=result();if(item.report_saved !== false){location.href=`/engine/api/reports/${encodeURIComponent(item.id)}/download?format=html`;return;}const source=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>PQ-C2PA 검증 보고서</title><style>body{font:16px sans-serif;max-width:900px;margin:45px auto;padding:20px;line-height:1.6}pre{overflow:auto;padding:22px;background:#f5eee4;font-size:12px}</style><h1>${esc(item.filename)} · ${esc(stateLabels[item.state] || item.state)}</h1><p>${item.processing_mode === "browser" ? "브라우저 안에서 생성한 보고서입니다. 파일은 서버로 전송되지 않았습니다." : "서버 기록을 저장하지 않은 세션에서 생성한 보고서입니다."}</p><p>출처 검증은 콘텐츠의 사실 여부를 보증하지 않습니다.</p><pre>${esc(JSON.stringify(item,null,2))}</pre></html>`;exportBlob(source,reportName(item,"html"),"text/html");};
$("#delete-report").onclick=async()=>{const item=result();try{await responseJSON(await fetch(`/engine/api/reports/${encodeURIComponent(item.id)}`,{method:"DELETE"}));item.report_saved=false;render();toast("서버 보고서를 삭제했습니다.");}catch(cause){error(cause.message);}};

const params=new URLSearchParams(location.search);
if(params.has("report")) loadReport(params.get("report"));
else if(params.has("url")){setMode("url");$("#url-input").value=params.get("url");verifyURL(params.get("url"));}



// Top navigation presents the reference material as separate pages while keeping the verifier state in memory.
function routeFromHash(){
  if(location.hash === "#convert") return "verify";
  if(location.hash === "#guide") return "guide";
  if(location.hash === "#about-c2pa") return "about";
  return "verify";
}
function showPage(page,{preserveResult=false}={}){
  document.body.classList.remove("show-convert");
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
  if(page === "convert")page="verify";
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

const unifiedReady=Promise.all([import('./conversion-v4.js?v=20261117-haetae'),import('./unified-processing.js?v=20261117-haetae')]).then(([module,pipeline])=>{
  v4Module=module;
  module.apiJSON('/health').then(async config=>{
    const node=$('#unified-connection-note');
    node.textContent=config.status==='ok'?'서버 연결 확인 · 이미지 업로드 후 Classic 및 PQC 검증을 진행합니다.':'서버 상태를 확인하지 못했습니다.';
  }).catch(()=>{$('#unified-connection-note').textContent='웹 서버 연결 상태를 확인하지 못했습니다. 서버 실행 상태를 확인해 주세요.';});
  return pipeline;
});
async function v4Asset(job){
  const response=await fetch(v4Module.assetPath(job),{cache:'no-store'});
  if(!response.ok){let body={};try{body=await response.json();}catch{}throw Error(body.detail||body.error?.message||`파일 다운로드 실패 (${response.status})`);}
  const blob=await response.blob();if(!['image/png','image/jpeg'].includes(blob.type))throw Error('서버가 결과 이미지 형식을 반환하지 않았습니다.');return blob;
}
$('#unified-stop').onclick=()=>activeUnifiedTask?.pause();
async function resumeUnified(item){
  const task=unifiedTasks.get(item.id);if(!task||state.busy)return;
  setBusy(true);activeUnifiedTask=task;
  try{
    const {item:updated,file}=await task.resume();
    const index=state.results.findIndex(entry=>entry.id===item.id);if(index<0)return;
    updated.id=item.id;updated.report_saved=false;state.results[index]=updated;
    const previous=state.localUrls.get(item.id);if(previous)URL.revokeObjectURL(previous);
    state.localUrls.set(item.id,URL.createObjectURL(file));
    for(const mode of ['simple','detail']){state.explanations.delete(explanationKey(item,mode));state.explainErrors.delete(explanationKey(item,mode));}
    render();
  }catch(cause){toast(cause.message);}finally{activeUnifiedTask=null;setBusy(false);progress('',false);$('#unified-stop').hidden=true;}
}
// Image generation uses the existing server endpoint; the secret stays on the server.
const aiState={blob:null,url:null,available:false,busy:false};
function aiError(message){const target=$("#ai-error");target.textContent=message;target.hidden=!message;}
async function checkAiAvailability(){
  const status=$("#ai-api-status"),button=$("#ai-generate");
  status.textContent="생성 API 연결 상태 확인 중…";button.disabled=true;
  try{
    let response=await fetch('/api/v1/service-health/ai',{cache:'no-store'});
    if(response.status===404){
      // Explicit optional lab mode retains its original provider adapter.
      response=await fetch('/engine/api/health',{cache:'no-store'});
      const health=await responseJSON(response);
      aiState.available=health.ai_generation===true;
      status.textContent=aiState.available?'이미지 생성 기능이 설정되어 있습니다. 실제 생성 결과는 요청 후 확인합니다.':'이미지 생성 서버가 아직 준비되지 않았습니다.';
    }else{
      const [{aiConnection},health]=await Promise.all([import('./connection-status.js?v=20261117-results'),responseJSON(response)]);
      const connection=aiConnection(health);aiState.available=connection.available;status.textContent=connection.message;
    }
    status.classList.toggle("unavailable",!aiState.available);
    button.disabled=!aiState.available;
  }catch{
    aiState.available=false;status.textContent="이미지 생성 서버에 연결할 수 없습니다.";status.classList.add("unavailable");button.disabled=true;
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
  if(!aiState.available){aiError("이미지 생성 서버 연결을 확인해 주세요.");return;}
  const button=$("#ai-generate"),idleContent=button.innerHTML;aiState.busy=true;button.disabled=true;button.textContent="이미지 생성 중…";aiError("");
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
  finally{aiState.busy=false;button.disabled=!aiState.available;button.innerHTML=idleContent;}
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

// Pre-analysis preview: nothing is uploaded or stored until the user confirms.
// Duplicates of results already in this session are skipped to avoid redundant server records.
const PREVIEW_HASH_LIMIT = 50 * 1024 * 1024;
const pendingState={items:[]};
async function fileSha256(file){
  if(!globalThis.crypto?.subtle || file.size > PREVIEW_HASH_LIMIT)return "";
  const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function clearPending(){
  for(const entry of pendingState.items)if(entry.url)URL.revokeObjectURL(entry.url);
  pendingState.items=[];
  $("#upload-preview").hidden=true;$("#panel-file").classList.remove("has-pending");
  $("#dropzone h2").textContent="이미지를 놓거나 클릭해서 선택하세요";
}
function refreshPendingDuplicates(){
  const seen=new Set(state.results.map(item=>item.sha256).filter(Boolean));
  for(const entry of pendingState.items){
    entry.duplicate=Boolean(entry.hash) && seen.has(entry.hash);
    if(entry.hash)seen.add(entry.hash);
  }
}
async function stageFiles(files){
  if(state.busy)return;
  clearError();
  const incoming=[...files];$("#file-input").value="";
  if(!incoming.length)return;
  const added=[];
  for(const file of incoming){
    const suffix=file.name.split(".").pop()?.toLowerCase();
    const entry={file,id:`${Date.now()}_${Math.random().toString(16).slice(2)}`,url:"",problem:"",duplicate:false,dimensions:"",hash:"",hashPending:false};
    if(!FORMAT_EXTENSIONS.has(suffix))entry.problem="JPG 또는 PNG 이미지만 분석할 수 있습니다.";
    else if(file.size > SERVER_MAX_SIZE)entry.problem="파일 크기 제한을 넘었습니다.";
    else entry.url=URL.createObjectURL(file);
    if(!entry.problem)entry.hashPending=true;
    pendingState.items.push(entry);added.push(entry);
  }
  if(pendingState.items.length > 10){
    pendingState.items.splice(10).forEach(entry=>entry.url && URL.revokeObjectURL(entry.url));
    toast("한 번에 최대 10장까지 미리 볼 수 있습니다.");
  }
  renderPending();
  $("#upload-preview").scrollIntoView({block:"nearest",behavior:"smooth"});
  await Promise.all(added.filter(entry=>entry.hashPending && pendingState.items.includes(entry)).map(async entry=>{
    try{entry.hash=await fileSha256(entry.file);}catch{entry.hash="";}
    entry.hashPending=false;
  }));
  refreshPendingDuplicates();
  renderPending();
}
function renderPending(){
  const items=pendingState.items;
  if(!items.length){clearPending();return;}
  $("#upload-preview").hidden=false;$("#panel-file").classList.add("has-pending");
  $("#dropzone h2").textContent="이미지를 더 끌어놓거나 클릭해서 추가하세요";
  const ready=items.filter(entry=>!entry.problem && !entry.duplicate);
  $("#upload-preview-count").textContent=`${ready.length} / ${items.length}장 분석 예정`;
  $("#upload-preview-list").innerHTML=items.map(entry=>{
    const flag=entry.problem ? `<b class="flag bad">${esc(entry.problem)}</b>` : entry.duplicate ? `<b class="flag dup">이미 분석한 사진 · 건너뜀</b>` : `<b class="flag ok">분석 대상</b>`;
    const media=entry.url ? `<img src="${esc(entry.url)}" alt="${esc(entry.file.name)} 미리보기" data-pending-img="${esc(entry.id)}">` : `<span class="no-thumb" aria-hidden="true">◇</span>`;
    return `<li class="${entry.problem || entry.duplicate ? "skipped" : ""}"><div class="thumb">${media}</div><div class="meta"><strong title="${esc(entry.file.name)}">${esc(entry.file.name)}</strong><small>${sizes(entry.file.size)}${entry.dimensions ? ` · ${esc(entry.dimensions)}` : ""}${entry.file.type ? ` · ${esc(entry.file.type.replace("image/","").toUpperCase())}` : ""}</small>${flag}</div><button type="button" class="remove" data-pending-remove="${esc(entry.id)}" aria-label="${esc(entry.file.name)} 빼기">×</button></li>`;
  }).join("");
  const skipped=items.length-ready.length, note=$("#upload-preview-note");
  note.hidden=!skipped;
  note.textContent=skipped ? `${skipped}장은 분석하지 않습니다. 중복 확인은 50 MB 이하 파일에 적용됩니다.` : "";
  const start=$("#upload-preview-start");
  const checking=items.some(entry=>entry.hashPending);
  start.disabled=!ready.length || state.busy || checking;
  start.textContent=checking ? "중복 확인 중…" : ready.length ? `${ready.length}장 분석 시작 →` : "분석할 사진이 없습니다";
  $$("[data-pending-img]").forEach(img=>img.addEventListener("load",()=>{
    const entry=pendingState.items.find(item=>item.id === img.dataset.pendingImg);
    if(entry && !entry.dimensions && img.naturalWidth){entry.dimensions=`${img.naturalWidth}×${img.naturalHeight}`;const small=img.closest("li")?.querySelector("small");if(small)small.textContent=`${sizes(entry.file.size)} · ${entry.dimensions}${entry.file.type ? ` · ${entry.file.type.replace("image/","").toUpperCase()}` : ""}`;}
  },{once:true}));
}
$("#upload-preview-list").addEventListener("click",event=>{
  const button=event.target.closest("[data-pending-remove]");if(!button)return;
  const index=pendingState.items.findIndex(entry=>entry.id === button.dataset.pendingRemove);
  if(index < 0)return;
  const [entry]=pendingState.items.splice(index,1);if(entry.url)URL.revokeObjectURL(entry.url);
  refreshPendingDuplicates();renderPending();
});
$("#upload-preview-cancel").addEventListener("click",()=>{clearPending();if(result())render();else $("#dropzone").focus();});
$("#upload-preview-add").addEventListener("click",()=>{if(!state.busy)$("#file-input").click();});
$("#upload-preview-start").addEventListener("click",async()=>{
  const ready=pendingState.items.filter(entry=>!entry.problem && !entry.duplicate).map(entry=>entry.file);
  if(!ready.length)return;
  clearPending();
  await verifyFiles(ready);
});
