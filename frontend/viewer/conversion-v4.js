// V4 contract adapter: detached JUMBF P1. Never infer fields that the API omits.
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cid=/^conv_[0-9a-f]{32}$/;
const vid=/^val_[0-9a-f]{32}$/;
const outcomes=new Set(['QUEUED','PROCESSING','COMPLETED','FAILED']);
const validChecks=['assertion_hashes','ingredient_references','source_evidence','claim_signature','hard_binding','soft_binding'];
export function readJob(response){
  const job=response?.data;
  if(!job || !cid.test(job.conversion_id||'') || !outcomes.has(job.status))throw Error('V4 작업 응답을 읽을 수 없습니다. 연결된 서버의 API 버전을 확인하세요.');
  if(job.status==='COMPLETED' && (job.result?.p1_validation?.profile!=='pq-c2pa-jumbf-haetae3-1' || job.result?.p1_validation?.container!=='JUMBF'))throw Error('지원하지 않는 P1 결과입니다. HAETAE-3 서버인지 확인하세요.');
  return job;
}
export function canDownload(job){
  const r=job?.result,p=r?.p1_validation;
  return job?.status==='COMPLETED' && r?.trust_status==='TRUSTED' && p?.profile==='pq-c2pa-jumbf-haetae3-1' && p?.container==='JUMBF' && validChecks.every(k=>p[k]==='VALID') && p.classic_validation==='SDK_VALIDATED' && p.signer==='FRAMEWORK_PINNED_SIGNER' && p.conformance==='EXPERIMENTAL_PQ_PROFILE' && typeof p.manifest_id==='string' && !!p.manifest_id && /^pair_[0-9a-f]{32}$/.test(r.manifest_pair_id||'') && typeof r.fingerprint_base64==='string' && !!r.fingerprint_base64;
}
export function assetPath(job){if(!cid.test(job?.conversion_id||''))throw Error('변환 ID가 올바르지 않습니다.');return `/api/v1/conversions/${job.conversion_id}/asset`;}
export function describeResolution(job){
  // Only a completed and verified response can establish existing PQC protection.
  if(!canDownload(job))return ['PQC 보호를 확인하지 못했습니다','검사가 완료되지 않았거나 필수 검사를 통과하지 못했습니다. 오류 내용을 확인해 주세요.'];
  const r=job?.result||{},mode=r.resolution_mode||r.classic_action;
  const known={EXISTING_OUTPUT:['이미 PQC로 보호된 이미지입니다','DB에 등록된 기존 PQC 보호 기록(P1)의 서명과 이미지 연결을 다시 확인했습니다. 새 P1을 발급하지 않았습니다.'],EXISTING_SOURCE:['이 이미지의 PQC 보호 기록이 이미 있습니다','등록된 원본과 일치해 기존 결과 이미지와 PQC 보호 기록(P1)을 재검증했습니다. 새 P1을 발급하지 않았습니다. 아래에서 보호된 결과 이미지를 받을 수 있습니다.'],RESTORED_CLASSIC:['기존 PQC를 확인하고 출처 기록을 복구했습니다','이미 등록된 PQC 보호 기록(P1)을 확인하고, 이미지에서 사라진 Classic 출처 기록을 복구해 검증했습니다. 새 P1을 발급하지 않았습니다.'],ADD_SOFT_BINDING:['PQC 보호 기록을 자동으로 생성했습니다','기존 C2PA 검증을 통과해 핑거프린트를 담은 M1과 PQC 보호 기록(P1)을 생성했습니다. P1은 이미지와 분리해 DB에 저장했습니다.'],REUSE_EXISTING:['PQC 보호 기록을 자동으로 생성했습니다','기존 매니페스트와 핑거프린트를 재사용하고 PQC 보호 기록(P1)을 새로 생성했습니다. P1은 이미지와 분리해 DB에 저장했습니다.']};
  return known[mode]||['처리 결과 확인 필요','서버에서 반환한 처리 방식을 확인할 수 없습니다. 상세 응답을 확인하세요.'];
}
export function protectionStatus(job){
  if(!canDownload(job))return {kind:'unknown',label:'보호 미확인'};
  const r=job.result,mode=r.resolution_mode||r.classic_action;
  if(['EXISTING_OUTPUT','EXISTING_SOURCE'].includes(mode))return {kind:'existing',label:'기존 PQC 확인'};
  if(mode==='RESTORED_CLASSIC')return {kind:'restored',label:'기존 PQC 확인 · 출처 기록 복구'};
  if(['ADD_SOFT_BINDING','REUSE_EXISTING'].includes(mode))return {kind:'created',label:'PQC 자동 생성 완료'};
  return {kind:'unknown',label:'처리 방식 미확인'};
}
export function timestampLabel(value){return ({NOT_AVAILABLE:'타임스탬프 정보 없음',M0_TOKEN_EXISTING:'기존 Classic 토큰 사용',M1_SIGTST2_ISSUED:'Classic sigTst2 발급'})[value]||'상태 미확인';}
export function aiEvidence(job,record){
  const r=job.result||{};
  const report={conversion_id:job.conversion_id,status:job.status,source_classic_c2pa:job.source?.classic_c2pa||null,result:{trust_status:r.trust_status,classic_action:r.classic_action,manifest_pair_id:r.manifest_pair_id,p1_validation:r.p1_validation}};
  if(r.resolution_mode)report.result.resolution_mode=r.resolution_mode;
  if(record)report.registration_record={validation_id:record.validation_id,overall_status:record.overall_status,checks:record.checks,timestamp_evidence:record.timestamp_evidence};
  return report;
}
export async function apiJSON(path,options={}){
  const response=await fetch(path,options);let body;
  try{body=await response.json();}catch{throw Error(`서버 응답을 읽을 수 없습니다 (${response.status}).`);}
  if(!response.ok){const d=body.detail;let msg=body.error?.message||(typeof d==='string'?d:Array.isArray(d)?'입력 형식을 확인하세요.':`요청 실패 (${response.status})`);if(response.status===503 && typeof d==='string' && d.includes('PQ_C2PA_V4_BASE_URL'))msg='PQC 처리 서버가 연결되지 않아 자동 생성과 기존 보호 여부를 확인할 수 없습니다. 서버 연결 후 다시 시도해 주세요.';const e=Error(msg);e.status=response.status;throw e;}
  return body;
}
const row=(label,value)=>`<div class="pq-record-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value??'반환되지 않음')}</strong></div>`;
const code=(label,value)=>`<div class="pq-full-value"><span>${escapeHTML(label)}</span><code>${escapeHTML(value??'반환되지 않음')}</code></div>`;
const short=value=>{const s=String(value||'');return s.length>30?`${s.slice(0,18)}…${s.slice(-8)}`:s||'확인되지 않음';};
const full=(label,value)=>`<div class="pq-full-value"><div><span>${escapeHTML(label)}</span>${value?`<button type="button" data-pq-copy="${escapeHTML(value)}" aria-label="${escapeHTML(label)} 복사">복사</button>`:''}</div><code>${escapeHTML(value||'응답에 포함되지 않음')}</code></div>`;
function softBinding(manifest){
  const assertion=(manifest?.assertions||[]).find(a=>a.label?.startsWith('c2pa.soft-binding'));
  const data=assertion?.data||{},block=Array.isArray(data.blocks)?data.blocks[0]||{}:{};
  return {label:assertion?.label,algorithm:data.alg||data.algorithm||block.alg,encoded:data.value_base64||block.value_base64||(typeof block.value==='string'?block.value:null),display:data.display||(String(data.value||'').startsWith('ISCC:')?data.value:'')};
}
function recordDetails(content){return `<details class="pq-record-detail"><summary><span class="pq-closed">기록 상세 보기</span><span class="pq-open">기록 상세 접기</span><i aria-hidden="true">⌄</i></summary><div class="pq-record-body">${content}</div></details>`;}
function certificate(info){return info?.key_reference
  ?`<section class="pq-card-section"><h4>서명 공개키</h4>${row('서명자',info.common_name)}${row('신뢰 기준',info.issuer)}${code('고정 공개키 참조',info.key_reference)}</section>`
  :`<section class="pq-card-section"><h4>서명 인증서</h4>${row('서명자',info?.common_name)}${row('발급자',info?.issuer)}</section>`;}
function timestamp(info,fallback){return `<section class="pq-card-section"><h4>타임스탬프</h4>${row('기록된 시각',info?.generation_time)}${row('발급기관',info?.issuer)}<p class="pq-record-note">${escapeHTML(fallback)}</p></section>`;}
export function renderResult(job,{classic=null,input=null,record=null,recordError='',notice='',paused=false,isOutput=true,ai='',aiError='',actions=true}={}){
  const r=job.result||{},p=r.p1_validation||{},[title,description]=describeResolution(job),ready=canDownload(job),protection=protectionStatus(job);
  const store=classic?.store||{},manifest=store.manifests?.[store.active_manifest]||{},signature=manifest.signature_info||classic?.signature||{};
  const soft=softBinding(manifest),parent=(manifest.ingredients||[]).find(i=>i.relationship==='parentOf');
  const inputName=input?.filename||job.source?.filename||classic?.filename;
  const classicId=store.active_manifest,sourceId=input?.store?.active_manifest||parent?.active_manifest;
  const classicAlg=signature.alg?String(signature.alg).toUpperCase():null;
  // Optional algorithm/certificate fields are supplied by the backend; do not invent signer names.
  const pqAlg=p.signature_algorithm||r.p1_signature_info?.alg;
  const normalize=value=>String(value||'').replace(/\s/g,'').replace(/=+$/,'');
  const hasBoth=!!soft.encoded&&!!r.fingerprint_base64;
  const same=hasBoth&&normalize(soft.encoded)===normalize(r.fingerprint_base64);
  const linkLabel=same?(/iscc/i.test(soft.algorithm||'')?'같은 ISCC 지문':'같은 핑거프린트'):hasBoth?'지문 불일치':ready?'서버에서 연결 검증':'연결 여부 미확인';
  const mode=r.resolution_mode||r.classic_action;
  const action=({ADD_SOFT_BINDING:'M1 생성',REUSE_EXISTING:'기존 매니페스트 재사용',EXISTING_OUTPUT:'등록 결과 재사용',EXISTING_SOURCE:'등록 원본의 결과 사용',RESTORED_CLASSIC:'Classic 기록 복구'})[mode]||'처리 미완료';
  const sourceState=input?.state==='NoManifest'?'입력 C2PA 없음':
    ['Trusted','Valid'].includes(input?.state)||job.source?.classic_c2pa?.validation_status==='VALID'?'변환 전 서명 확인':
    input?.state==='Invalid'?'입력 C2PA 검증 실패':'입력 C2PA 상태 미확인';
  const classicState=['Trusted','Valid'].includes(classic?.state)?'Classic C2PA 서명 유효':classic?.state==='Invalid'?'Classic C2PA 검증 실패':p.classic_validation==='SDK_VALIDATED'?'서버의 Classic 검사 통과':'Classic 검사 미확인';
  const pairId=r.manifest_pair_id;
  const classicBody=`${full('전체 매니페스트 ID',classicId)}${full('내장 파일',classic?.filename||r.filename)}${full('이전 출처 기록 (M0)',sourceId)}${row('이전 파일',inputName)}<section class="pq-card-section"><h4>소프트 바인딩</h4>${row('어설션',soft.label)}${row('지문 알고리즘',soft.algorithm)}${full(soft.display?'기록된 ISCC 지문':'기록된 지문 (Base64)',soft.display||soft.encoded)}</section>${certificate(signature)}${timestamp(r.classic_timestamp,'토큰 발급 시각이 응답에 없으면 표시하지 않습니다.')}`;
  const p1Body=`${full('전체 매니페스트 ID',p.manifest_id)}${full('전체 DB 기록 쌍 ID',pairId)}${row('등록 상태',ready?'DB 기록 서명·결합 검증 완료':'외부 DB 기록 미확인')}${row('등록 시각',r.registered_at||record?.registered_at)}${full('참조한 원본 출처 (M0)',p.source_manifest_id||r.source_manifest_id||null)}<section class="pq-card-section"><h4>소프트 바인딩</h4>${row('어설션',p.soft_binding_assertion?.label)}${row('지문 알고리즘',p.soft_binding_assertion?.algorithm)}${full('연결 지문 (Base64)',r.fingerprint_base64)}</section>${certificate(r.p1_signature_info||p.signature_info)}${timestamp(r.p1_timestamp,timestampLabel(p.timestamp)+' · 상태 값은 토큰 발급 시각이 아닙니다.')}<p class="pq-record-note">P1은 결과 이미지 안에 삽입되지 않습니다. DB 기록 쌍 ID는 API의 manifest_pair_id입니다.</p>`;
  const checkRows=[['어설션 해시',p.assertion_hashes],['재료 참조',p.ingredient_references],['원본 근거',p.source_evidence],['Classic 검사',p.classic_validation],['P1 클레임 서명',p.claim_signature],['하드 바인딩',p.hard_binding],['소프트 바인딩',p.soft_binding]].map(([label,value])=>row(label,value==='VALID'||value==='SDK_VALIDATED'?'통과':value||'미확인')).join('');
  const errorMessage=notice||job.error?.message;
  const recoveryNotice=ready&&mode==='RESTORED_CLASSIC'
    ?'<div class="pq-recovery-notice" role="status"><strong>출처 기록 복구·재검증 완료</strong><p>입력 이미지에서 C2PA 기록이 확인되지 않았습니다. DB 후보의 Classic 매니페스트를 다시 연결하고 Classic 서명·이미지 결합·P1 서명을 검증했습니다. 아래 결과 이미지를 다운로드할 수 있습니다.</p></div>'
    :job.status==='FAILED'&&['MATCH_UNVERIFIED','AMBIGUOUS_MATCH'].includes(job.error?.code)
      ?'<div class="pq-recovery-notice pq-recovery-failed" role="alert"><strong>보호 기록 후보를 확정하지 못했습니다</strong><p>이미지 지문으로 찾은 후보만으로는 원본이나 복구 가능성을 증명할 수 없습니다. 복구된 이미지는 제공하지 않습니다.</p></div>'
      :'';
  const buttons=actions==='unified'?`<div class="v4-result-actions"><button type="button" data-unified-download ${ready?'':'disabled'}>결과 이미지 다운로드 ↓</button><button type="button" data-unified-report>PQ 변환 보고서 받기</button>${paused?'<button type="button" data-unified-resume>상태 조회 재개</button>':''}</div>`:actions?`<div class="v4-result-actions"><button type="button" data-v4-action="download" ${ready?'':'disabled'}>결과 이미지 다운로드 ↓</button><button type="button" data-v4-action="inspect" ${ready?'':'disabled'}>결과 이미지 상세 검사</button><button type="button" data-v4-action="ai">AI 설명 생성</button></div><div class="v4-ai-text">${ai?`<strong>AI가 작성한 설명</strong><p>${escapeHTML(ai)}</p>`:''}${aiError?`<p class="v4-warning">${escapeHTML(aiError)}</p>`:''}</div>`:'';
  return `<section class="v4-result pq-result-surface" data-protection="${protection.kind}" aria-label="PQC 처리 결과"><div class="v4-result-heading"><span class="v4-result-icon ${ready?'good':'unknown'}" aria-hidden="true">${ready?'✓':'!'}</span><div><span class="v4-result-kicker">CONVERSION RESULT</span><h2>${escapeHTML(protection.kind==='created'?'PQ 변환이 완료되었습니다':title)}</h2><p>${escapeHTML(protection.kind==='created'?title+'. '+description:description)}</p></div></div>${errorMessage?`<p class="v4-result-notice" role="status">${escapeHTML(errorMessage)}</p>`:''}${recoveryNotice}
  <div class="pq-summary-cards"><article><span>기존 이미지 M0</span><strong>${escapeHTML(inputName||'확인되지 않음')}</strong><small>${escapeHTML(sourceState)}</small></article><article><span>P1 양자내성 기록</span><strong>${escapeHTML(pqAlg||'서명 알고리즘 미제공')}</strong><small>${ready?'PQ 서명 유효':'PQ 서명 미확인'}</small></article><article><span>결과 이미지</span><strong>${escapeHTML(r.filename||classic?.filename||'확인되지 않음')}</strong><small>${escapeHTML(isOutput?classicState:p.classic_validation==='SDK_VALIDATED'?'서버의 결과 Classic 검사 통과':'결과 Classic 미확인')} · ${escapeHTML(action)}</small></article></div>
  <div class="pq-records-heading"><h3>출처 기록 연결</h3><span>소프트 바인딩</span></div><div class="pq-records v4-connected-records"><article class="pq-record" data-record="classic"><header><strong>${classicId?'이미지에 내장된 Classic 기록':'현재 이미지의 Classic 기록'}${isOutput&&mode==='ADD_SOFT_BINDING'?' (M1)':''}</strong></header>${row('매니페스트 ID',short(classicId))}${row('서명 알고리즘',classicAlg)}${row('이전 출처 기록',sourceId?short(sourceId):inputName)}${recordDetails(classicBody)}</article>
  <div class="pq-link ${same?'matched':hasBoth?'mismatch':'unknown'}"><details><summary>${escapeHTML(linkLabel)} <span aria-hidden="true">⌄</span></summary><p>${same?'Classic에서 읽은 지문과 서버가 반환한 P1 연결 지문이 같습니다.':hasBoth?'두 기록의 지문이 일치하지 않습니다. 검사 상세를 확인하세요.':ready?'서버는 소프트 바인딩 통과를 반환했습니다. 이 화면에서 양쪽 지문을 직접 대조할 정보는 부족합니다.':'기록 연결을 확인하지 못했습니다.'}</p>${full('Classic 지문',soft.encoded)}${full('P1 연결 지문',r.fingerprint_base64)}</details><small>${escapeHTML(short(soft.display||r.fingerprint_base64))}</small></div>
  <article class="pq-record" data-record="p1"><header><strong>DB에 저장된 양자내성 기록 (P1)</strong><small>${ready?'검증 완료':'미확인'}</small></header>${row('매니페스트 ID',short(p.manifest_id))}${row('서명 알고리즘',pqAlg)}${row('DB 기록 쌍 ID',short(pairId))}${recordDetails(p1Body)}</article></div>
  <details class="pq-verification-detail" data-section="pq-verification"><summary>서명 검증 상세 <span aria-hidden="true">⌄</span></summary><div class="pq-verification-content">${checkRows}${row('서명자 신뢰',p.signer==='FRAMEWORK_PINNED_SIGNER'?'서버에 고정된 HAETAE 공개키':p.signer)}${row('타임스탬프 상태',timestampLabel(p.timestamp))}${row('인증서 폐기 조회',p.revocation==='NOT_CHECKED'?'조회하지 않음':p.revocation)}${row('상호운용성',p.conformance==='EXPERIMENTAL_PQ_PROFILE'?'실험용 PQ 프로파일':p.conformance)}${code('P1 프로파일',p.profile)}${code('P1 컨테이너',p.container)}<p class="pq-record-note">Classic은 자체 CA, P1은 서버에 고정된 HAETAE 공개키로 확인합니다. 외부 공인 신뢰나 독립 구현체의 상호운용 검증을 뜻하지 않습니다.</p><details class="code-details"><summary>기존 등록 검증 기록</summary>${code('등록 검증 ID',r.validation_id)}${record?`<p>기존 발급 때 저장된 기록이며 현재 요청과 구분합니다.</p><pre>${escapeHTML(JSON.stringify(record,null,2))}</pre>`:`<p>${escapeHTML(recordError||'반환된 등록 검증 기록이 없습니다.')}</p>`}</details><details class="code-details"><summary>현재 변환 응답 JSON</summary><pre>${escapeHTML(JSON.stringify(job,null,2))}</pre></details></div></details>${buttons}<p class="pq-record-note">${ready?'Classic은 자체 CA, P1은 고정된 HAETAE 공개키로 확인한 결과입니다.':'서버에서 확인된 결과만 표시합니다.'} 응답에 없는 인증서·등록 시각은 만들어 표시하지 않습니다.</p></section>`;
}
export function createController({onChange,onNotice,onInspect,request=apiJSON,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let state={job:null,record:null,recordError:'',ai:'',aiError:'',busy:false,paused:false},run=0;
  const emit=()=>onChange({...state});
  async function monitor(id,token){
    while(token===run){
      const job=readJob(await request(`/api/v1/conversions/${id}`,{cache:'no-store'}));
      if(job.conversion_id!==id)throw Error("조회한 변환 ID가 요청과 일치하지 않습니다.");
      if(token!==run)return;state.job=job;emit();
      if(job.status==='FAILED'){onNotice(`${job.error?.message||'변환에 실패했습니다.'}${job.error?.code?` (${job.error.code})`:''}`,true);return;}
      if(job.status==='COMPLETED'){
        if(!canDownload(job)){onNotice('서버의 완료 응답에서 필수 검사 통과를 확인하지 못해 다운로드를 제공하지 않습니다.',true);return;}
        const recordId=job.result.validation_id;
        if(recordId && vid.test(recordId)){
          try{const body=await request(`/api/v1/validations/${recordId}`,{cache:'no-store'});if(token!==run)return;if(body.data?.validation_id!==recordId)throw Error('등록 검증 ID가 일치하지 않습니다.');state.record=body.data;}
          catch(e){if(token!==run)return;state.recordError=`등록 기록을 가져오지 못했습니다: ${e.message}`;}
          emit();
        }else if(recordId){state.recordError='등록 검증 ID 형식이 올바르지 않습니다.';emit();}
        return;
      }
      await delay(1200);
    }
  }
  return {getState:()=>({...state}),
    async start(file){
      if(state.busy)return;
      const token=++run;state={job:null,record:null,recordError:'',ai:'',aiError:'',busy:true,paused:false};emit();
      try{
        const form=new FormData();form.append('file',file,file.name);
        const body=await request('/api/v1/conversions',{method:'POST',body:form});
        const job=readJob(body);if(token!==run)return;state.job=job;emit();
        await monitor(job.conversion_id,token);
      }catch(e){if(token===run){state.paused=!!state.job && !['COMPLETED','FAILED'].includes(state.job.status);onNotice(e.message,true);}}
      finally{if(token===run){state.busy=false;emit();}}
    },
    async resume(){if(state.busy||!state.job)return;const token=++run;state.busy=true;state.paused=false;emit();try{await monitor(state.job.conversion_id,token);}catch(e){if(token===run){state.paused=true;onNotice(e.message,true);}}finally{if(token===run){state.busy=false;emit();}}},
    pause(){++run;state.busy=false;state.paused=!!state.job;emit();onNotice('상태 조회를 멈췄습니다. 서버의 변환 작업은 계속될 수 있습니다. 상태 조회 재개로 확인하세요.');},
    async summarize(){if(!state.job||state.busy)return;const token=run;state.busy=true;state.aiError='';emit();try{const body=await request('/api/v1/ai/summaries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audience:'general',report:aiEvidence(state.job,state.record)})});if(token!==run)return;if(typeof body.data?.summary!=='string'||!body.data.summary.trim())throw Error('AI가 비어 있는 설명을 반환했습니다.');state.ai=body.data.summary;}catch(e){if(token===run)state.aiError=e.message;}finally{if(token===run){state.busy=false;emit();}}},
    async inspect(){if(canDownload(state.job))await onInspect(state.job,state.record);}
  };
}
