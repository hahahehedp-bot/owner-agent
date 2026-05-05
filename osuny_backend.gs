/**
 * 오순이 챗봇 엔진 (osunyi_backend.gs) v2.2
 * [핵심 기능]
 * 1. Gemini API 연결: gemini-3.1-flash-lite-preview 모델 사용.
 * 2. 실시간 폴더 로딩: Drive '오순이' 폴더 실시간 스캔 → 자동 반영
 * 3. 스마트 메모리: 구글 시트를 사용한 대화 기록 유지.
 *
 * [보안]
 * API 키는 GAS 프로젝트 설정 > 스크립트 속성에 저장해야 합니다.
 * 속성 이름: GEMINI_API_KEY
 *
 * [v2.2 변경사항]
 * - DriveApp.searchFolders() → DriveApp.getRootFolder() 방식으로 변경
 *   (searchFolders의 한글 쿼리 'q' 파라미터 버그 우회)
 */

const CONFIG = {
  // ⚠️ API 키는 스크립트 속성에서 로드합니다 (코드에 직접 입력 금지)
  get GEMINI_API_KEY() {
    const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('GEMINI_API_KEY가 스크립트 속성에 설정되지 않았습니다.');
    return key;
  },
  MODEL_NAME: 'gemini-3.1-flash-lite-preview',
  RULES_URL: 'https://raw.githubusercontent.com/hahahehedp-bot/owner-agent/main/.agent/rules/osunyi-rules.md',
  SKILLS_URL: 'https://raw.githubusercontent.com/hahahehedp-bot/owner-agent/main/.agent/skills/owner-tools.md',
  SHEET_NAME: 'ChatMemory',
  LOG_SHEET_ID: '1LjnVu9vHv3TkY2_Ji_YnFslXpOb1VSF36sx_28MX7cA',
  ROOT_FOLDER_NAME: '오순이'
};

// =============================================
// 라우터
// =============================================
function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === 'getFolderFiles') {
      return getFolderFiles(e.parameter.folderName);
    }

    if (action === 'getFileContent') {
      return getFileContent(e.parameter.fileName);
    }

    const userMessage = e.parameter.message;
    const userId = e.parameter.userId || 'guest';

    if (!userMessage) {
      return createJsonResponse({ status: 'success', message: 'Osunyi Engine v2.2 Running' });
    }

    const reply = handleChat(userMessage, userId);
    return createJsonResponse({ status: 'success', reply: reply });

  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  }
}

function doPost(e) {
  try {
    let userMessage, userId;

    if (e.postData && e.postData.contents) {
      const requestData = JSON.parse(e.postData.contents);
      userMessage = requestData.message;
      userId = requestData.userId || 'guest';
    } else {
      userMessage = e.parameter.message;
      userId = e.parameter.userId || 'guest';
    }

    if (!userMessage) {
      return createJsonResponse({ status: 'error', message: 'No message provided' });
    }

    const reply = handleChat(userMessage, userId);
    return createJsonResponse({ status: 'success', reply: reply });

  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  }
}

// =============================================
// Drive 실시간 스캔
// [v2.2] searchFolders 대신 폴더 순회 방식으로 변경
//        (한글 폴더명 사용 시 searchFolders의 'q' 파라미터 버그 우회)
// =============================================

/** '오순이' 루트 폴더 탐색 - 내 드라이브 전체를 순회하여 찾음 */
function getRootFolder() {
  try {
    // 방법 1: 내 드라이브 루트에서 직접 탐색
    const rootFolders = DriveApp.getRootFolder().getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
    if (rootFolders.hasNext()) return rootFolders.next();

    // 방법 2: 공유 드라이브 포함 전체 탐색
    const allFolders = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
    if (allFolders.hasNext()) return allFolders.next();

    return null;
  } catch (e) {
    Logger.log('getRootFolder error: ' + e.toString());
    return null;
  }
}

/**
 * 자료실 폴더 내 파일 목록을 카테고리(서브폴더)별로 반환
 */
function getFolderFiles(folderName) {
  const rootFolder = getRootFolder();
  if (!rootFolder) {
    return createJsonResponse({ status: 'error', message: '오순이 폴더를 찾을 수 없습니다. Drive에 "오순이" 폴더가 있는지 확인해주세요.' });
  }

  const targetFolders = rootFolder.getFoldersByName(folderName);
  if (!targetFolders.hasNext()) {
    return createJsonResponse([]);
  }

  const targetFolder = targetFolders.next();
  const result = [];

  const subFolders = targetFolder.getFolders();
  while (subFolders.hasNext()) {
    const sub = subFolders.next();
    if (sub.isTrashed()) continue;

    const category = { category: sub.getName(), files: [] };
    const files = sub.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.isTrashed()) continue;
      category.files.push({
        name: f.getName(),
        url: 'https://drive.google.com/uc?export=download&id=' + f.getId(),
        previewUrl: 'https://drive.google.com/file/d/' + f.getId() + '/view',
        mimeType: f.getMimeType(),
        size: formatSize(f.getSize())
      });
    }
    if (category.files.length > 0) result.push(category);
  }

  const rootFiles = targetFolder.getFiles();
  const uncategorized = { category: '기타', files: [] };
  while (rootFiles.hasNext()) {
    const f = rootFiles.next();
    if (f.isTrashed()) continue;
    uncategorized.files.push({
      name: f.getName(),
      url: 'https://drive.google.com/uc?export=download&id=' + f.getId(),
      previewUrl: 'https://drive.google.com/file/d/' + f.getId() + '/view',
      mimeType: f.getMimeType(),
      size: formatSize(f.getSize())
    });
  }
  if (uncategorized.files.length > 0) result.push(uncategorized);

  return createJsonResponse(result);
}

/**
 * CSV 파일 내용 반환
 */
function getFileContent(fileName) {
  const rootFolder = getRootFolder();
  if (!rootFolder) {
    return ContentService.createTextOutput('Error: 오순이 폴더를 찾을 수 없습니다.');
  }

  const targetFolderName = fileName.includes('schedule') ? '일정' : '자료실';
  let searchFolder = rootFolder;
  const targetFolders = rootFolder.getFoldersByName(targetFolderName);
  if (targetFolders.hasNext()) searchFolder = targetFolders.next();

  const files = searchFolder.getFilesByName(fileName);
  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed()) {
      return ContentService.createTextOutput(file.getBlob().getDataAsString('UTF-8'));
    }
  }
  return ContentService.createTextOutput('Error: ' + fileName + ' 파일을 찾을 수 없습니다.');
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '-';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

// =============================================
// 챗봇 로직
// =============================================
function handleChat(message, userId) {
  const rules = fetchExternalContent(CONFIG.RULES_URL);
  const skills = fetchExternalContent(CONFIG.SKILLS_URL);
  const skillsContext = skills && skills !== '정보 로드 실패' ? '\n\n[활성 스킬]\n' + skills : '';
  const systemPrompt = rules + skillsContext;

  const history = getMemory(userId);
  const aiResponse = callGemini(message, history, systemPrompt);

  saveMemory(userId, message, aiResponse);
  return aiResponse;
}

function callGemini(message, history, systemPrompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.MODEL_NAME + ':generateContent?key=' + CONFIG.GEMINI_API_KEY;

  const payload = {
    contents: history.concat([{ role: 'user', parts: [{ text: message }] }]),
    system_instruction: { parts: [{ text: systemPrompt }] }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());

  if (result.candidates && result.candidates[0]) {
    return result.candidates[0].content.parts[0].text;
  } else {
    Logger.log('Gemini API Error: ' + JSON.stringify(result));
    throw new Error('AI 응답 생성 실패. 잠시 후 다시 시도해주세요.');
  }
}

function fetchExternalContent(url) {
  try {
    const response = UrlFetchApp.fetch(url + '?cb=' + new Date().getTime());
    return response.getContentText();
  } catch (e) {
    return '정보 로드 실패';
  }
}

// =============================================
// 메모리 (시트 기반)
// =============================================
function getMemory(userId) {
  const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(['UserID', 'Role', 'Content', 'Timestamp']);
  }
  const data = sheet.getDataRange().getValues();
  return data.filter(row => row[0] === userId).slice(-10).map(row => ({
    role: row[1],
    parts: [{ text: row[2] }]
  }));
}

function saveMemory(userId, userMsg, aiMsg) {
  const sheet = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const now = new Date();
  sheet.appendRow([userId, 'user', userMsg, now]);
  sheet.appendRow([userId, 'model', aiMsg, now]);
}

// =============================================
// 유틸
// =============================================
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// 디버그용 테스트 함수 (GAS 편집기에서 직접 실행)
// =============================================
function testDriveAccess() {
  const folder = getRootFolder();
  Logger.log(folder ? '✅ 오순이 폴더 찾음: ' + folder.getName() : '❌ 오순이 폴더 없음');
}

function testChatResponse() {
  const result = handleChat('안녕하세요', 'test_user');
  Logger.log('챗봇 응답: ' + result);
}
