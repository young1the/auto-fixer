# Stack Trace Decoder & AI Auto-Fix

프로덕션 환경의 minified 스택 트레이스를 소스맵을 이용해 디코딩하고, AI를 활용하여 자동으로 버그를 수정하는 도구입니다.

## 기능

### 1. 스택 트레이스 디코딩
- Minified JavaScript 에러를 원본 소스 코드 위치로 변환
- Vite 빌드 해시 불일치 자동 처리 (Fuzzy matching)
- IntelliJ/VS Code 클릭 가능한 링크 생성

### 2. Grafana 로그 수집
- Grafana Loki API를 통한 에러 로그 자동 수집
- 중복 에러 필터링 (해시 기반)
- 에러 통계 및 분석

### 3. AI 자동 수정
- Claude Code를 이용한 자동 버그 수정
- Git 자동 커밋
- 무한 루프 모니터링

## 설치

```bash
cd scripts/stack-trace-decoder
npm install
```

## 설정

### 1. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 다음 값들을 설정하세요:

```env
# Grafana 설정
GRAFANA_URL=https://your-grafana-instance.com
GRAFANA_API_KEY=your_api_key_here
GRAFANA_DATASOURCE_UID=your_loki_datasource_uid

# Claude Code 설정 (나중에 사용)
# Claude Code CLI가 설치되어 있고 로그인되어 있어야 함
CLAUDE_CODE_PATH=claude
```

### 2. 소스맵 디렉토리 확인

`auto-fix-config.json`에서 소스맵 위치를 확인/수정하세요:

```json
{
  "decoder": {
    "sourceMapDir": "./target/static/js"
  }
}
```

## 사용 방법

### 스택 트레이스 디코딩

**인터랙티브 모드**:
```bash
npm run decode
```
스택 트레이스를 붙여넣고 Enter를 두 번 누르세요.

**Pipe 모드**:
```bash
echo "Error: ... at https://domain.com/static/js/file-abc123.js:1:448" | npm run decode
```

**래퍼 사용 (프로그래밍)**:
```bash
npm run decode-wrapper "Error: ... at https://domain.com/static/js/file-abc123.js:1:448"
```

### Grafana 로그 수집

**기본 실행**:
```bash
npm run collect-logs
```

**JSON 출력 (파이프 가능)**:
```bash
npm run test:collector > errors.json
```

**결과 예시**:
```
🔍 Grafana 로그 수집 중...
✓ 5개의 에러 로그 발견

📊 에러 통계:
   Error: 5개

🔥 최근 에러:
   1. [10:30:15] Cannot read properties of undefined (reading 'data')
      파일: UserProfile-8poSmKxV.js
   2. [10:25:42] Cannot read properties of undefined (reading 'status')
      파일: authStore-Q8JOaMCl.js
```

### Claude Code 통합 테스트

**통합 워크플로우 테스트**:
```bash
npm run test:integration
```

이 명령어는 다음을 수행합니다:
1. Grafana에서 최신 에러 로그 수집
2. 스택 트레이스를 소스맵으로 디코딩
3. Claude Code용 프롬프트 생성 (실제 실행 없음)

**결과 예시**:
```
🧪 Claude Code 통합 테스트

1️⃣  설정 로드 중...
   ✓ 설정 로드 완료

2️⃣  Grafana에서 에러 로그 수집 중...
   ✓ 13개의 에러 수집 완료

3️⃣  스택 트레이스 디코딩 중...
   ✓ 디코딩 완료
   원본 파일: src/components/Dashboard.vue:142

4️⃣  Claude Code 통합 테스트
   💡 생성된 프롬프트 확인

✅ 통합 테스트 완료!
```

## 프로그래밍 사용법

### Grafana 로그 수집기

```javascript
import { GrafanaLogCollector } from './grafana-log-collector.js';

const collector = new GrafanaLogCollector(config);
const errors = await collector.collectErrors();

errors.forEach(error => {
  console.log(error.hash);           // 에러 해시
  console.log(error.error.message);  // 에러 메시지
  console.log(error.error.stackTrace); // 스택 트레이스
});
```

### 스택 트레이스 디코더

```javascript
import { StackTraceDecoder } from './trace-decoder-wrapper.js';

const decoder = new StackTraceDecoder(config);
const result = await decoder.decodeStackTrace(stackTrace);

if (result) {
  console.log(result.original.file);     // src/stores/userStore.js
  console.log(result.original.line);     // 42
  console.log(result.original.function); // fetchUser
  console.log(result.sourceCode[5].content); // if (response.data) {
}
```

### Claude Code 클라이언트

```javascript
import { ClaudeCodeClient } from './claude-code-client.js';
import { StackTraceDecoder } from './trace-decoder-wrapper.js';
import { GrafanaLogCollector } from './grafana-log-collector.js';

// 1. 에러 수집
const collector = new GrafanaLogCollector(config);
const errors = await collector.collectErrors();

// 2. 디코딩
const decoder = new StackTraceDecoder(config);
const decoded = await decoder.decodeStackTrace(errors[0].error.stackTrace);

// 3. Claude Code로 수정
const claudeClient = new ClaudeCodeClient(config);
const result = await claudeClient.fixError(errors[0], decoded);

if (result.success) {
  console.log('✓ 수정 완료!');
  console.log('에러 해시:', result.errorHash);
}
```

## 디렉토리 구조

```
scripts/stack-trace-decoder/
├── .env.example                  # 환경 변수 템플릿
├── .env                          # 환경 변수 (git ignored)
├── auto-fix-config.json          # 설정 파일
├── decode-trace.js               # 인터랙티브 디코더
├── grafana-log-collector.js      # Grafana 로그 수집기
├── trace-decoder-wrapper.js      # 디코더 래퍼 (프로그래밍용)
├── claude-code-client.js         # Claude Code CLI 클라이언트
├── integration-test.js           # 통합 테스트
├── task.md                       # AI 자동화 구현 계획
├── package.json
└── README.md
```

## 다음 단계

현재 구현된 것:
- ✅ 스택 트레이스 디코더
- ✅ Grafana 로그 수집기
- ✅ 스택 트레이스 디코더 래퍼
- ✅ Claude Code 통합
- ✅ Git 자동 커밋

구현 예정:
- ⏳ 메인 오케스트레이터 (자동화 루프)
- ⏳ 모니터링 대시보드

자세한 구현 계획은 `task.md`를 참고하세요.

## 트러블슈팅

### 소스맵을 찾을 수 없음

1. `auto-fix-config.json`에서 `sourceMapDir` 경로 확인
2. 빌드 디렉토리에 `.js.map` 파일이 있는지 확인
3. Vite 설정에서 소스맵 생성 활성화:
   ```javascript
   // vite.config.js
   export default {
     build: {
       sourcemap: true
     }
   }
   ```

### Grafana API 연결 실패

1. `.env`에서 `GRAFANA_URL` 확인
2. API 키 권한 확인 (Viewer 이상 필요)
3. Datasource UID 확인:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://your-grafana.com/api/datasources
   ```

### 해시 불일치로 소스맵 매칭 실패

- Fuzzy matching이 자동으로 처리하지만, 파일명이 완전히 다른 경우 실패할 수 있습니다
- 프로덕션 빌드와 동일한 소스맵을 사용하세요
- 또는 프로덕션 환경에서 소스맵을 다운로드하여 사용하세요

## 라이선스

MIT License
