/**
 * owner-agent (주)오너 통합 비즈니스 시스템 - 오순이 AI 챗봇 엔진 v1.0.4
 * Model: gemini-3.1-flash-lite-preview
 * Last Updated: 2026-05-04
 */

const CONFIG = {
  API_KEY: '리더님의_API_키', // 실제 환경에서는 프로퍼티 서비스 권장
  MODEL_NAME: 'gemini-3.1-flash-lite-preview',
  RULES_URL: 'https://raw.githubusercontent.com/hahahehedp-bot/owner-agent/main/.agent/rules/lab-code-rules.md',
  SKILLS_URL: 'https://raw.githubusercontent.com/hahahehedp-bot/owner-agent/main/.agent/rules/owner-rules.md'
};

/**
 * GET 요청 처리 (브라우저 통신용)
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    // 실시간 폴더 스캔 기능 (팝업, 일정 등)
    if (action === 'getFolderFiles') {
      const folderName = e.parameter.folderName;
      return getFolderFiles(folderName);
    }

    // 실시간 파일 내용 읽기 (CSV 등)
    if (action === 'getFileContent') {
      const fileName = e.parameter.fileName;
      return getFileContent(fileName);
    }

    const userMessage = e.parameter.message;
    const userId = e.parameter.userId || 'guest';
    
    if (!userMessage) return createJsonResponse({ status: 'error', message: 'No message provided' });

    const aiResponse = handleChat(userMessage, userId);
    
    return createJsonResponse({ status: 'success', reply: aiResponse });
  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  }
}

/**
 * 특정 폴더의 파일 목록 및 링크 반환
 */
function getFolderFiles(folderName) {
  // 'osuny' 하위의 특정 폴더 찾기
  const rootFolders = DriveApp.getFoldersByName('osuny');
  if (!rootFolders.hasNext()) return createJsonResponse([]);
  
  const osunyFolder = rootFolders.next();
  const targetFolders = osunyFolder.getFoldersByName(folderName);
  if (!targetFolders.hasNext()) return createJsonResponse([]);
  
  const targetFolder = targetFolders.next();
  const files = targetFolder.getFiles();
  const fileList = [];
  
  while (files.hasNext()) {
    const file = files.next();
    // 웹에서 바로 보여줄 수 있는 직링크 생성
    fileList.push(`https://drive.google.com/uc?id=${file.getId()}`);
  }
  
  return createJsonResponse(fileList);
}

/**
 * 특정 파일의 텍스트 내용 반환 (CSV 등)
 */
function getFileContent(fileName) {
  const rootFolders = DriveApp.getFoldersByName('osuny');
  if (!rootFolders.hasNext()) return ContentService.createTextOutput("Error: Root folder not found");
  
  const osunyFolder = rootFolders.next();
  
  // 파일 성격에 따라 폴더 매핑 (한글 원위치 대응)
  let targetFolderName = '데이터';
  if (fileName.includes('schedule')) targetFolderName = '일정';
  if (fileName.includes('resources')) targetFolderName = '자료실';

  const targetFolders = osunyFolder.getFoldersByName(targetFolderName);
  let searchFolder = osunyFolder;
  if (targetFolders.hasNext()) searchFolder = targetFolders.next();

  const files = searchFolder.getFilesByName(fileName);
  if (!files.hasNext()) return ContentService.createTextOutput("Error: File not found");
  
  const file = files.next();
  return ContentService.createTextOutput(file.getBlob().getDataAsString());
}

/**
 * POST 요청 처리 (확장성용)
 */
function doPost(e) {
  try {
    const requestData = JSON.parse(e.postData.contents);
    const userMessage = requestData.message;
    const userId = requestData.userId || 'guest';
    
    const aiResponse = handleChat(userMessage, userId);
    
    return createJsonResponse({ status: 'success', reply: aiResponse });
  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  }
}

/**
 * 핵심 채팅 로직
 */
function handleChat(message, userId) {
  const rules = fetchExternalContent(CONFIG.RULES_URL);
  const skills = fetchExternalContent(CONFIG.SKILLS_URL);
  const systemPrompt = `여름오빠(유여름)의 AX 시스템 설계 의도에 따라, (주)오너의 리더님(사업자)들을 보좌하는 AI 비서 '오순이'로서 답변하세요.\n\n[원칙]\n${rules}\n\n[비즈니스 맥락]\n${skills}`;
  
  const history = getMemory(userId);
  const aiResponse = callGemini(message, history, systemPrompt);
  
  saveMemory(userId, message, aiResponse);
  return aiResponse;
}

/**
 * Gemini API 호출
 */
function callGemini(message, history, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${CONFIG.API_KEY}`;
  
  const payload = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt }] },
      ...history,
      { role: 'user', parts: [{ text: message }] }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());
  
  if (result.candidates && result.candidates[0].content.parts[0].text) {
    return result.candidates[0].content.parts[0].text;
  } else {
    throw new Error('AI 답변 생성 실패: ' + response.getContentText());
  }
}

/**
 * 외부 콘텐츠 로드
 */
function fetchExternalContent(url) {
  try {
    return UrlFetchApp.fetch(url).getContentText();
  } catch (e) {
    return "";
  }
}

/**
 * 메모리 관리 (Spreadsheet 연동)
 */
function getMemory(userId) {
  // 실제 구현 시 시트에서 해당 유저의 대화 이력 로드 로직 추가
  return []; 
}

function saveMemory(userId, userMsg, aiMsg) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('ChatLog');
    if (!sheet) sheet = ss.insertSheet('ChatLog');
    
    sheet.appendRow([new Date(), userId, userMsg, aiMsg]);
  } catch (e) {}
}

/**
 * JSON 응답 생성 유틸리티
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}
