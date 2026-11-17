import {createController,canDownload} from './conversion-v4.js?v=20261117-haetae';

// Every task owns its trace. Browser observations are never claimed as server/TSA times.
export function createUnifiedTask({inspect,loadAsset,onProgress=()=>{},onEvent=()=>{},skipReason='',request,delay,now=()=>new Date().toISOString()}){
  let inputFile,inputResult,outputResult,outputFile,lastNotice='',lastStage='',startedAt,completedAt;
  const events=[];
  const classicLabel=state=>({Trusted:'신뢰 확인',Valid:'유효 · 신뢰 미확인',Invalid:'검증 실패',NoManifest:'C2PA 없음',Error:'검사 오류'}[state]||'상태 미확인');
  const pqLabel=status=>({COMPLETED:'처리 완료',FAILED:'처리 실패',UNAVAILABLE:'서버 연결 또는 요청 실패',SKIPPED:'미수행',OUTPUT_UNAVAILABLE:'결과 이미지 확인 미완료',QUEUED:'대기',PROCESSING:'처리 중'}[status]||status);
  function record(code,message,extra={}){
    const entry={sequence:events.length+1,at:now(),clock_source:'browser',code,message,...extra};
    events.push(entry);onEvent({...entry});
  }
  const controller=createController({request,delay,onChange:s=>{
    const job=s.job,key=job && `${job.status}:${job.stage||''}`;
    if(key && key!==lastStage){lastStage=key;record('PQC_STATUS',`PQC 서버 응답: ${job.status}${job.stage?` · ${job.stage}`:''}`,{job_id:job.conversion_id});}
    onProgress(s);
  },onNotice:message=>{lastNotice=message;record('PQC_NOTICE',message);},onInspect(){}});
  async function safeInspect(file,role){
    record('CLASSIC_REQUEST',`${role==='input'?'입력':'결과'} 이미지 C2PA 검사 요청`,{filename:file.name,asset_role:role});
    let value;
    try{
      value=await inspect(file);
      record('CLASSIC_RESPONSE',`${role==='input'?'입력':'결과'} 이미지 C2PA 검사 응답: ${classicLabel(value.state)} (${value.state||'Unknown'})`,{filename:file.name,asset_role:role,server_timing:value.verification_timing||null});
      if(value.sha256)record('FILE_HASH',`${role==='input'?'입력':'결과'} 이미지 SHA-256 확인`,{filename:file.name,asset_role:role,sha256:value.sha256});
    }catch(error){
      value={filename:file.name,mime:file.type,size:file.size,state:'Error',report_saved:false,checks:[],store:{},error:error.message};
      record('CLASSIC_ERROR',`C2PA 검사 요청 실패: ${error.message}`,{filename:file.name,asset_role:role});
    }
    return value;
  }
  async function assemble(){
    const snapshot=controller.getState(),job=snapshot.job;
    const process={status:skipReason?'SKIPPED':job?.status||'UNAVAILABLE',message:skipReason||lastNotice,job,paused:!skipReason&&snapshot.paused,record_error:snapshot.recordError};
    let item={...inputResult,pqc_process:process},file=inputFile;
    if(!skipReason && canDownload(job)){
      try{
        if(!outputResult){
          record('OUTPUT_REQUEST','보호된 결과 이미지 다운로드 요청',{job_id:job.conversion_id});
          outputFile=await loadAsset(job);
          record('OUTPUT_RECEIVED','보호된 결과 이미지 수신',{filename:outputFile.name});
          outputResult=await safeInspect(outputFile,'output');
        }
        item={...outputResult,input_inspection:inputResult,conversion_v4:job,v4_registration_record:snapshot.record,pqc_process:process};file=outputFile;
      }catch(error){process.status='OUTPUT_UNAVAILABLE';process.message=`PQC 처리 결과는 반환되었지만 결과 이미지를 가져오지 못했습니다. 현재 표시하는 C2PA 정보는 입력 이미지의 검사 결과입니다. ${error.message}`;record('OUTPUT_ERROR',process.message);}
    }
    if(snapshot.record)record('REGISTRATION_RECEIVED','기존 발급 당시 등록 검증 기록 수신 · 현재 검사 시각과 별도',{validation_id:snapshot.record.validation_id});
    if(snapshot.recordError)record('REGISTRATION_ERROR',snapshot.recordError);
    record(snapshot.paused?'RUN_PAUSED':'RUN_FINISHED',snapshot.paused?'상태 조회 중지 · 서버 작업은 계속될 수 있음':`이번 통합 검사 처리 종료 · C2PA ${classicLabel(item.state)} · PQC ${pqLabel(process.status)}`);
    completedAt=events.at(-1).at;
    item.verification_run={started_at:startedAt,completed_at:completedAt,clock_source:'browser',input_filename:inputFile.name,result_filename:file.name,events:events.map(e=>({...e}))};
    return {item,file};
  }
  return {
    async start(file){
      inputFile=file;startedAt=now();record('RUN_STARTED','이미지 통합 검사 시작',{filename:file.name});
      const classic=safeInspect(file,'input').then(value=>{inputResult=value;});
      if(skipReason)record('PQC_SKIPPED',skipReason);else record('PQC_REQUEST','기존 보호 기록 확인 및 필요 시 PQC 생성 요청',{filename:file.name});
      await Promise.all([classic,skipReason?Promise.resolve():controller.start(file)]);
      return assemble();
    },
    async resume(){lastNotice='';record('PQC_RESUME','파일 재업로드 없이 기존 작업 상태 조회 재개');await controller.resume();return assemble();},
    pause(){controller.pause();},
    getState:()=>controller.getState()
  };
}
