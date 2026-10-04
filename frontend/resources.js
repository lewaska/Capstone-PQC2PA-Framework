/* External directory snapshot. Entries describe listings, not a guarantee that a given file verifies. */
const DIRECTORY_SOURCE = "https://c2paviewer.com/supported-devices";
const DIRECTORY = [];
function addDirectory(names, category, note, source = DIRECTORY_SOURCE, status = "외부 목록 수록", signal = "C2PA") {
  names.forEach(name => DIRECTORY.push({ name, category, note, source, status, signal }));
}

addDirectory(["Google Pixel 8", "Google Pixel 9"], "camera", "기능 배포와 카메라 앱 버전을 확인해야 합니다.", "https://blog.google/innovation-and-ai/products/identifying-ai-generated-media-online/");
addDirectory(["Google Pixel 10"], "camera", "카메라의 Content Credentials 관련 기기입니다.", "https://blog.google/innovation-and-ai/products/identifying-ai-generated-media-online/");
addDirectory(["Canon EOS R1", "Canon EOS R5 Mark II"], "camera", "인증 기능의 제공 지역과 워크플로 조건을 확인해야 합니다.", "https://www.canon-europe.com/press-centre/press-releases/2025/07/eos-r1-and-eos-r5-mark-ii-powerful-new-firmware-and-system-updates/");
addDirectory(["Fujifilm GFX100S II", "Fujifilm X-T50"], "camera", "외부 디렉터리 수록 모델입니다. 실제 기능 조건은 제조사에 확인하세요.");
addDirectory(["Leica M11-D", "Leica M11-P", "Leica M EV1", "Leica SL3-S", "Leica SL3-P", "Leica Q3 Monochrom"], "camera", "Leica의 Content Credentials 기기 안내를 확인하세요.", "https://leica-camera.com/en-US/photography/content-credentials");
addDirectory(["Nikon Z6 III"], "camera", "외부 디렉터리에 서비스 중단으로 표시되어 있습니다. 현재 상태를 제조사에 확인하세요.", "https://www.nikon.com/company/news/2025/0827_imaging_01/", "중단 표기");
addDirectory(["Samsung Galaxy S25 Ultra", "Samsung Galaxy S26 Ultra"], "camera", "Galaxy AI 편집 결과의 표시 조건을 확인해야 합니다.");
addDirectory(["Sony Alpha 1", "Sony Alpha 7 IV", "Sony Alpha 7S III", "Sony Alpha 9 III"], "camera", "펌웨어와 Camera Authenticity 기능 조건을 확인해야 합니다.", "https://www.sony.eu/presscentre/sony-delivers-highly-anticipated-firmware-updates-including-c2pa-compliancy-and-ensuring-authenticity-of-images");
addDirectory(["Sony Alpha 1 II"], "camera", "펌웨어와 Camera Authenticity 기능 조건을 확인해야 합니다.", "https://www.sony.eu/presscentre/sony-announces-firmware-updates-for-alpha-1-ii-alpha-1-and-alpha-9-iii");

addDirectory(["Canon Authenticity Imaging System"], "software", "뉴스 조직을 위한 Canon의 출처 확인 시스템입니다.", "https://global.canon/en/news/2026/20260511.html");
addDirectory(["ChatGPT"], "software", "생성 이미지의 출처 신호에 관한 안내를 확인하세요.", "https://help.openai.com/en/articles/8912793-provenance-signals-content-credentials-synthid-in-openai-generated-content");
addDirectory(["Claude"], "software", "파일에 적용되는 출처 표시의 범위를 확인하세요.", "https://support.claude.com/en/articles/16266773-how-claude-marks-ai-generated-content");
addDirectory(["Google Gemini"], "software", "이미지 생성·확인 기능별 출처 정보 조건을 확인하세요.", "https://blog.google/innovation-and-ai/products/ai-image-verification-gemini-app/");
addDirectory(["Stability AI"], "software", "생성 서비스의 출처·안전 기능 안내를 확인하세요.", "https://stability.ai/safety");
addDirectory(["Cloudinary"], "software", "미디어 관리 과정에서의 출처 정보 지원을 확인하세요.", "https://cloudinary.com/documentation/content_provenance_and_authenticity");
addDirectory(["Google Photos"], "software", "사진의 생성·편집 이력 표시 기능을 확인하세요.", "https://support.google.com/photos/answer/16496549?hl=en");
addDirectory(["LinkedIn"], "software", "게시물의 Content Credentials 표시 안내를 확인하세요.", "https://www.linkedin.com/help/linkedin/answer/a6282984");
addDirectory(["YouTube"], "software", "영상의 출처 정보와 AI 표시 정책을 확인하세요.", "https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/");
addDirectory(["Adobe Photoshop"], "software", "저장·내보내기 때 Content Credentials 적용 조건을 확인하세요.", "https://helpx.adobe.com/photoshop/desktop/save-and-export/metadata-content-credentials/use-content-credentials.html");

addDirectory(["ChatGPT"], "watermark", "출처 신호와 워터마크는 별개의 기술입니다.", "https://help.openai.com/en/articles/8912793-provenance-signals-content-credentials-synthid-in-openai-generated-content", "외부 목록 수록", "SynthID");
addDirectory(["Google Gemini"], "watermark", "SynthID 확인은 Google의 제공 기능을 확인해야 합니다.", "https://blog.google/innovation-and-ai/products/ai-image-verification-gemini-app/", "외부 목록 수록", "SynthID");
addDirectory(["ElevenLabs"], "watermark", "오디오 관련 목록으로, 이 이미지 전용 뷰어의 검사 대상은 아닙니다.", DIRECTORY_SOURCE, "외부 목록 수록", "SynthID");
addDirectory(["Apple Image Playground"], "watermark", "외부 디렉터리에서 향후 제공 예정으로 표시한 항목입니다.", "https://www.apple.com/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/", "제공 예정", "SynthID");

// Dates and requirements reproduce the external directory's labels, not a compatibility test.
const CAMERA_DETAILS = {
  "Google Pixel 8": ["2023.10", "펌웨어 제한 없음 표기"],
  "Google Pixel 9": ["2024.08", "펌웨어 제한 없음 표기"],
  "Google Pixel 10": ["2025.08", "펌웨어 제한 없음 표기"],
  "Canon EOS R1": ["2024.07", "펌웨어 제한 없음 표기"],
  "Canon EOS R5 Mark II": ["2024.07", "펌웨어 제한 없음 표기"],
  "Fujifilm GFX100S II": ["2024.05", "펌웨어 제한 없음 표기"],
  "Fujifilm X-T50": ["2024.06", "펌웨어 제한 없음 표기"],
  "Leica M11-D": ["2024.09", "펌웨어 제한 없음 표기"],
  "Leica M11-P": ["2023.10", "펌웨어 제한 없음 표기"],
  "Leica M EV1": ["2025.10", "펌웨어 제한 없음 표기"],
  "Leica SL3-S": ["2025.01", "펌웨어 제한 없음 표기"],
  "Leica SL3-P": ["2026.06", "펌웨어 제한 없음 표기"],
  "Leica Q3 Monochrom": ["2025.11", "펌웨어 제한 없음 표기"],
  "Nikon Z6 III": ["2024.06", "v2.00 이상 · 서비스 중단 표기"],
  "Samsung Galaxy S25 Ultra": ["2025.02", "One UI 7 · Galaxy AI 편집"],
  "Samsung Galaxy S26 Ultra": ["2026.02", "Galaxy AI 편집"],
  "Sony Alpha 1": ["2021.01", "v2.00 이상"],
  "Sony Alpha 1 II": ["2024.11", "v2.00 이상"],
  "Sony Alpha 7 IV": ["2021.12", "v3.00 이상"],
  "Sony Alpha 7S III": ["2020.10", "v3.00 이상"],
  "Sony Alpha 9 III": ["2024.02", "v2.00 이상"]
};

function directoryText(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function renderDirectory() {
  const query = document.getElementById("deviceSearch").value.trim().toLocaleLowerCase("ko-KR");
  const category = document.querySelector("[data-device-filter].is-active")?.dataset.deviceFilter || "all";
  const matches = DIRECTORY.filter(item => (category === "all" || item.category === category)
    && [item.name, item.note, item.signal, item.status].some(value => value.toLocaleLowerCase("ko-KR").includes(query)));
  const grid = document.getElementById("deviceGrid");
  grid.replaceChildren();
  const labels = { camera: "카메라·휴대폰", software: "앱·플랫폼", watermark: "워터마크" };
  matches.forEach(item => {
    const card = document.createElement("article");
    card.className = "device-card";
    const top = directoryText("div", "device-card-top", "");
    top.append(directoryText("span", "device-category", labels[item.category]), directoryText("span", `device-status ${item.status === "외부 목록 수록" ? "" : "is-limited"}`, item.status));
    const name = directoryText("h2", "", item.name);
    const signal = directoryText("span", `signal-tag ${item.signal === "SynthID" ? "is-watermark" : ""}`, item.signal);
    let metadata = null;
    if (item.category === "camera" && CAMERA_DETAILS[item.name]) {
      const [released, requirement] = CAMERA_DETAILS[item.name];
      metadata = directoryText("div", "device-meta", "");
      metadata.append(
        directoryText("span", "", `출시 ${released}`),
        directoryText("span", "", `외부 목록 조건 · ${requirement}`)
      );
    }
    const note = directoryText("p", "", item.note);
    const link = directoryText("a", "device-source", item.source === DIRECTORY_SOURCE ? "목록 원문 ↗" : "관련 안내 ↗");
    link.href = item.source;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(top, name, signal);
    if (metadata) card.append(metadata);
    card.append(note, link);
    grid.append(card);
  });
  document.getElementById("deviceCount").textContent = `${matches.length}개 항목`;
  document.getElementById("deviceEmpty").hidden = matches.length !== 0;
}

async function copyCode(id, button) {
  const snippet = document.getElementById(id)?.textContent || "";
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(snippet);
    } else {
      const field = document.createElement("textarea");
      field.value = snippet;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    button.textContent = "복사됨";
    setTimeout(() => { button.textContent = "코드 복사"; }, 1800);
  } catch {
    button.textContent = "복사 실패";
    setTimeout(() => { button.textContent = "코드 복사"; }, 1800);
  }
}

function initResources() {
  document.getElementById("deviceSearch").addEventListener("input", renderDirectory);
  document.querySelectorAll("[data-device-filter]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-device-filter]").forEach(option => {
      const active = option === button;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-pressed", String(active));
    });
    renderDirectory();
  }));
  document.querySelectorAll("[data-copy-code]").forEach(button =>
    button.addEventListener("click", () => copyCode(button.dataset.copyCode, button)));
  renderDirectory();
}

document.addEventListener("DOMContentLoaded", initResources);
