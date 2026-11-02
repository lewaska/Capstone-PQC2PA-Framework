import { PDFDocument } from "./pdf-lib.esm.min.js";

const W=1240,H=1754,LEFT=88,RIGHT=W-88,MAX=RIGHT-LEFT;
const blue="#195cff",ink="#10182b",muted="#667b99",line="#dce5f1",green="#008e66";
const labels={Trusted:"신뢰 확인",Valid:"유효 · 신뢰 미확인",Invalid:"검증 실패",NoManifest:"C2PA 없음",RemoteUnavailable:"외부 Manifest 필요",Error:"분석 오류"};
const safe=value=>String(value ?? "정보 없음").replace(/[\r\n\t]+/g," ").slice(0,360);
const date=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?"정보 없음":d.toLocaleString("ko-KR");};
const size=value=>Number.isFinite(value)?value>=1048576?Math.round(value/1048576*10)/10+" MB":Math.round(value/1024)+" KB":"정보 없음";

export async function buildPdfReport(item,reportType="technical"){
  const profiles={summary:{title:"공유용 요약",short:"요약"},submission:{title:"제출용 검증 기록",short:"제출"},technical:{title:"상세 분석",short:"상세"}};
  const profile=profiles[reportType]||profiles.technical;
  const doc=await PDFDocument.create();
  doc.setTitle("PQ-C2PA "+profile.title+" · "+safe(item.filename));
  doc.setSubject("콘텐츠 자격 증명 "+profile.title);
  doc.setCreator("PQ-C2PA Viewer");
  const canvases=[];
  let canvas,ctx,y,page=0;
  function newPage(){
    canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
    ctx=canvas.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,W,H);
    canvases.push(canvas);page++;y=96;
    ctx.fillStyle=blue;ctx.font="800 26px sans-serif";ctx.fillText("◈  PQ-C2PA",LEFT,62);
    ctx.fillStyle=muted;ctx.font="600 18px sans-serif";ctx.textAlign="right";ctx.fillText(profile.title+"  /  "+String(page).padStart(2,"0"),RIGHT,62);ctx.textAlign="left";
    ctx.strokeStyle=line;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(LEFT,78);ctx.lineTo(RIGHT,78);ctx.stroke();
    ctx.fillStyle="#8191a8";ctx.font="18px sans-serif";ctx.fillText("이 보고서는 검증 시점에 제공된 데이터를 바탕으로 생성되었습니다.",LEFT,H-72);
    ctx.textAlign="right";ctx.fillText(String(page).padStart(2,"0"),RIGHT,H-72);ctx.textAlign="left";
  }
  function ensure(height){if(y+height>H-125)newPage();}
  function text(value,x,yy,font="24px sans-serif",color=ink){ctx.font=font;ctx.fillStyle=color;ctx.fillText(safe(value),x,yy);}
  function lines(value,maxWidth=MAX,font="23px sans-serif"){
    ctx.font=font;const out=[];for(const paragraph of safe(value).split("\n")){let current="";for(const char of paragraph){if(ctx.measureText(current+char).width>maxWidth&&current){out.push(current.trim());current=char===" "?"":char;}else current+=char;}out.push(current.trim());}return out.length?out:[""];
  }
  function paragraph(value,opts={}){const font=opts.font||"23px sans-serif",gap=opts.gap||34,color=opts.color||ink,indent=opts.indent||0;for(const row of lines(value,MAX-indent,font)){ensure(gap+4);text(row,LEFT+indent,y+gap-9,font,color);y+=gap;}}
  function heading(value){ensure(76);y+=20;text(value,LEFT,y+28,"800 29px sans-serif");y+=51;}
  function rule(){ensure(26);ctx.strokeStyle=line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(LEFT,y+12);ctx.lineTo(RIGHT,y+12);ctx.stroke();y+=26;}
  function row(key,value){
    const val=safe(value),isDigest=/SHA(?:3)?-256/.test(key)&&/^[a-f0-9]{64}$/i.test(val);
    const chunks=isDigest?val.match(/.{1,32}/g):lines(val,MAX*0.65,"600 21px sans-serif");
    const font=isDigest?"600 19px monospace":"600 21px sans-serif";
    const h=Math.max(46,chunks.length*30+10);ensure(h);
    text(key,LEFT,y+28,"600 21px sans-serif",muted);
    chunks.forEach((part,i)=>text(part,LEFT+MAX*.34,y+28+i*30,font));
    y+=h;rule();
  }
  function card(title,description,accent=blue){
    const wrapped=lines(description,MAX-66,"21px sans-serif"),height=93+wrapped.length*31;ensure(height+15);
    ctx.fillStyle="#f6f9ff";ctx.strokeStyle=line;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(LEFT,y,MAX,height,19);ctx.fill();ctx.stroke();
    ctx.fillStyle=accent;ctx.fillRect(LEFT,y,8,height);
    text(title,LEFT+30,y+39,"800 24px sans-serif",accent);
    wrapped.forEach((part,i)=>text(part,LEFT+30,y+79+i*31,"21px sans-serif",muted));
    y+=height+15;
  }
  function node(title,subtitle,x,width,top,fill="#f8fbff"){
    ctx.fillStyle=fill;ctx.strokeStyle="#c8d9f5";ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,top,width,110,16);ctx.fill();ctx.stroke();
    text(title,x+18,top+39,"800 20px sans-serif");const words=lines(subtitle,width-35,"17px sans-serif").slice(0,2);words.forEach((part,i)=>text(part,x+18,top+70+i*22,"17px sans-serif",muted));
  }
  async function finish(){
    for(const sheet of canvases){const png=await doc.embedPng(sheet.toDataURL("image/png"));const pdfPage=doc.addPage([595.28,841.89]);pdfPage.drawImage(png,{x:0,y:0,width:595.28,height:841.89});}
    return await doc.save();
  }
  newPage();
  text(profile.title,LEFT,y+44,"800 43px sans-serif");y+=73;
  paragraph(item.filename||"파일명 없음",{font:"700 25px sans-serif",color:muted});y+=17;
  const status=labels[item.state]||safe(item.state||"상태 미확인"),statusColor=item.state==="Trusted"?green:item.state==="Invalid"?"#d34c5a":blue;
  card(status, item.state==="Trusted"?"서명과 파일 결합이 검증되고 선택한 신뢰 목록에서 서명자를 확인했습니다.":item.state==="NoManifest"?"검증 가능한 C2PA Manifest가 없습니다. 이 결과만으로 변조 또는 허위를 판단할 수 없습니다.":item.state==="Invalid"?"Manifest 검증에 실패했습니다. 아래 오류와 검사 항목을 확인하세요.":"서명 상태와 검증 근거를 함께 확인하세요.",statusColor);
  const store=item.store||{},manifestCount=Number(item.manifest_count||Object.keys(store.manifests||{}).length);
  const aiDeclaration=item.ai==="declared"?"Manifest에 선언됨":"확인 가능한 선언 없음";
  const trustProfile=item.trust_profile==="lab"?"실험용 CA 포함":"기본 SDK 목록";
  if(profile===profiles.summary){
    heading("결과를 세 가지 질문으로 읽기");
    card("1. 출처 기록이 있나요?",manifestCount>0?`C2PA Manifest ${manifestCount}개가 확인되었습니다.`:"확인 가능한 C2PA Manifest가 없습니다. 기록이 없다는 이유만으로 가짜라고 판단할 수 없습니다.");
    card("2. 서명 검사를 통과했나요?",item.state==="Trusted"||item.state==="Valid"?"서명과 파일 결합이 유효합니다.":item.state==="Invalid"?"검사 실패가 보고되었습니다. 상세 분석에서 오류 코드를 확인하세요.":"서명 검사를 통과했다고 확인할 수 없습니다.");
    card("3. 서명자를 확인했나요?",item.state==="Trusted"?"선택한 신뢰 목록에서 서명자를 확인했습니다.":item.state==="Valid"?"서명은 유효하지만 선택한 신뢰 목록에서 서명자를 확인하지 못했습니다.":"서명자 신뢰를 확인할 수 없습니다.");
    heading("이 파일을 구별하는 정보");
    row("검증 시각",date(item.created_at));row("파일 SHA-256",item.sha256||"정보 없음");row("AI 생성 선언",aiDeclaration);
    paragraph("이 결과는 기록과 서명의 검증 상태를 설명합니다. 이미지가 실제 상황을 보여주는지, 누가 법적 권리를 갖는지는 판정하지 않습니다.",{font:"18px sans-serif",color:muted});
    if(item.trust_profile==="lab")paragraph("실험용 CA를 포함한 결과입니다. 공개 신뢰 목록에서 동일하게 표시된다는 뜻은 아닙니다.",{font:"18px sans-serif",color:muted});
    return await finish();
  }
  if(profile===profiles.submission){
    heading("제출 파일 식별");
    row("파일명",item.filename||"정보 없음");row("형식",item.mime||"정보 없음");row("크기",size(item.size));
    row("SHA-256",item.sha256||"정보 없음");row("SHA3-256",item.sha3_256||"정보 없음");
    row("검증 시각",date(item.created_at));row("검증 방식",item.processing_mode==="browser"?"브라우저 내부":"로컬 서버");
    newPage();
    heading("검증 결과와 출처 기록");
    row("검증 상태",status);row("검증 정책",trustProfile);row("Manifest 수",manifestCount+"개");
    row("활성 Manifest",store.active_manifest||"확인되지 않음");
    row("서명자",item.signature?.common_name||"확인되지 않음");row("발급자",item.signature?.issuer||"확인되지 않음");
    row("서명 알고리즘",item.signature?.alg||"확인되지 않음");row("AI 생성 선언",aiDeclaration);
    const checks=item.checks||[],failures=checks.filter(check=>check.kind==="failure");
    row("검사 항목",checks.length+"개 · 실패 "+failures.length+"개");
    if(failures.length){heading("실패한 검사 근거");for(const check of failures)card(safe(check.code||"검증 오류"),safe(check.explanation||check.message||"자세한 설명 없음"),"#c94553");}
    heading("제출할 때 함께 확인할 점");
    paragraph("가능하면 이 PDF와 함께 검증에 사용한 원본 파일을 보관하고 제출하세요. 위 해시는 그 파일 바이트를 구별하는 값입니다.",{font:"20px sans-serif"});
    paragraph("이 기록만으로 이미지 내용의 사실 여부, 피해 사실, 법적 소유권이나 파일의 보관 이력은 증명되지 않습니다.",{font:"19px sans-serif",color:muted});
    if(item.trust_profile==="lab")paragraph("실험용 CA를 포함한 로컬 신뢰 정책의 결과입니다. 외부 기관의 신뢰 기준과 다를 수 있습니다.",{font:"18px sans-serif",color:muted});
    return await finish();
  }
  heading("핵심 정보");
  row("파일 형식",item.mime||"정보 없음");row("크기",size(item.size));row("검증 시각",date(item.created_at));row("서명자",item.signature?.common_name||"정보 없음");row("발급자",item.signature?.issuer||"정보 없음");row("서명 알고리즘",item.signature?.alg||"정보 없음");row("검증 정책",item.trust_profile==="lab"?"실험용 CA 포함":"기본 SDK 목록");row("AI 생성 선언",item.ai==="declared"?"Manifest에 선언됨":"확인 가능한 선언 없음");row("SHA-256",item.sha256||"정보 없음");row("SHA3-256",item.sha3_256||"정보 없음");
  ensure(580);heading("메타데이터 구조 그림");
  const manifest=store.manifests?.[store.active_manifest]||{},hasManifest=Object.keys(store.manifests||{}).length>0;
  ensure(440);
  node("① 콘텐츠 파일",safe(item.filename)+" · "+safe(item.mime),LEFT,MAX,y);y+=120;
  text("↓  C2PA Manifest Store",LEFT+25,y+25,"700 21px sans-serif",blue);y+=47;
  if(hasManifest){
    node("② 활성 Manifest",Object.keys(store.manifests||{}).length+"개 중 활성 · "+safe(store.active_manifest),LEFT,MAX,y,"#eef5ff");y+=126;
    const gap=13,width=(MAX-gap*2)/3;
    node("Assertions",(manifest.assertions||[]).length+"개",LEFT,width,y);
    node("Claim","Assertion 참조와 해시",LEFT+width+gap,width,y);
    node("서명",safe(item.signature?.alg),LEFT+(width+gap)*2,width,y);
    y+=127;
    paragraph("Ingredient "+(item.ingredients||[]).length+"개 · 작업 이력 "+(item.actions||[]).length+"개",{font:"21px sans-serif",color:muted});
  }else{card("Manifest 없음","서명 구조를 표시할 수 없습니다. 일반 메타데이터는 별도로 확인하세요.");}
  y+=14;node("③ 일반 메타데이터",Object.keys(item.image_info?.metadata||{}).length+"개 표시 항목 · EXIF 등은 별도로 읽기",LEFT,MAX,y,"#ffffff");y+=126;
  paragraph("점선 영역의 일반 메타데이터가 모두 C2PA 서명으로 보호되는 것은 아닙니다. 파일 결합과 서명 상태는 공식 SDK 결과를 기준으로 판단합니다.",{font:"18px sans-serif",color:muted});
  heading("검증 항목");
  const checks=item.checks||[];if(!checks.length)paragraph("표시할 검증 항목이 없습니다.");
  for(const check of checks){const badge=check.kind==="failure"?"오류":check.kind==="success"?"통과":"안내";card(badge+" · "+safe(check.code||"검증 항목"),safe(check.explanation||check.message||"설명 없음"),check.kind==="failure"?"#c94553":check.kind==="success"?green:blue);}
  heading("제작 · 편집 이력");
  const actions=item.actions||[];if(!actions.length)paragraph("Manifest에 기록된 작업 이력이 없습니다.");
  for(const [index,action] of actions.entries())card(String(index+1).padStart(2,"0")+" · "+safe(action.action||"작업"),safe(action.when||"시간 정보 없음")+" · "+safe(typeof action.softwareAgent==="object"?JSON.stringify(action.softwareAgent):action.softwareAgent||"제작 도구 정보 없음"));
  heading("파일 메타데이터");
  const image=item.image_info||{};row("해상도",image.width&&image.height?image.width+" × "+image.height:"정보 없음");row("색상 모드",image.mode||"정보 없음");row("ICC 프로필",image.has_icc_profile?"있음":"없음 또는 확인 불가");row("GPS 정보",image.gps_present?"있음 · 좌표 미표시":"없음 또는 확인 불가");
  for(const [key,value] of Object.entries(image.metadata||{}).slice(0,30))row(safe(key),safe(value));
  heading("해석할 때 주의할 점");
  paragraph("서명 검증은 콘텐츠의 기록과 무결성을 확인합니다. 사진 속 장면의 사실 여부나 법적 소유권을 단독으로 증명하지 않습니다.",{color:muted});
  paragraph(item.processing_mode==="browser"?"이 보고서는 브라우저에서 생성되었습니다. 파일은 서버로 전송되지 않았습니다.":"이 보고서는 로컬 서버 검증 결과를 브라우저에서 PDF로 만들었습니다.",{color:muted});
  return await finish();
}
