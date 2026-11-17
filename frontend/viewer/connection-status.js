// A configured address is not proof that the backend or its models are available.
const names={classic:'C2PA',pqc:'PQC',ai:'AI',reports:'보고서 발급',web_images:'게시물 검색'};
const labels={not_configured:'연결 대기',unverified:'주소 설정됨 · 연결 미확인',reachable:'상태 응답 확인',unreachable:'접속 실패',authentication_required:'인증 확인 필요',health_check_failed:'상태 확인 실패'};
export function connectionText(services){
  return Object.entries(names).map(([key,name])=>`${name}: ${labels[services?.[key]?.status]||'연결 미확인'}`).join(' / ');
}
export function aiConnection(service){
  if(!service?.configured)return {available:false,message:'AI 서버 연결을 준비 중입니다. 연결 후 이미지 생성을 사용할 수 있습니다.'};
  if(service.ai_generation===false)return {available:false,message:'연결된 AI 서버에서 이미지 생성 기능을 사용할 수 없습니다.'};
  if(service.status==='reachable')return {available:true,message:'AI 서버 상태 응답을 확인했습니다. 실제 이미지 생성 결과는 요청 후 확인합니다.'};
  if(service.status==='unverified')return {available:true,message:'AI 서버 주소가 설정되어 있습니다. 이미지 생성 요청 시 실제 연결을 확인합니다.'};
  return {available:false,message:service.status==='authentication_required'?'AI 서버의 연결 인증을 확인해야 합니다.':'AI 서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요.'};
}
