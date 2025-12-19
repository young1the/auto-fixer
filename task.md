# AI 자동 버그 수정 시스템

## 개요

Grafana 로그를 모니터링하여 발생한 에러를 자동으로 수정하는 AI 기반 자동화 시스템입니다.

## 시스템 아키텍처

```
┌─────────────────┐
│  Grafana API    │ 1. 로그 수집
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Stack Trace     │ 2. 소스맵 디코딩
│ Decoder         │    (원본 위치 파악)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Claude Code     │ 3. AI 코드 수정
│ Agent           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Git Auto Commit │ 4. 자동 커밋
└────────┬────────┘
         │
         └──────────► 무한 반복
```

## 구현 단계

### Phase 1: Grafana 로그 수집기

**파일**: `grafana-log-collector.js`

**기능**:
- Grafana API 연동
- 에러 로그 필터링 및 수집
- 로그 해시 생성 (중복 제거용)
- 스택 트레이스 추출

**API 엔드포인트**:
```javascript
// Grafana Loki Query API
POST /loki/api/v1/query_range
{
  "query": '{app="frontend"} |= "Error"',
  "start": "now-1h",
  "end": "now",
  "limit": 100
}
```

**출력 형식**:
```json
{
  "hash": "abc123...",
  "timestamp": "2025-12-19T10:00:00Z",
  "error": {
    "message": "Cannot read properties of undefined",
    "stackTrace": "Error: ... at https://domain.com/static/js/file-hash.js:1:448"
  }
}
```

### Phase 2: 스택 트레이스 디코더 통합

**파일**: `trace-decoder-wrapper.js`

**기능**:
- 기존 `decode-trace.js` 모듈 활용
- 프로그래밍 방식으로 소스맵 디코딩
- 원본 파일 경로, 줄 번호, 컬럼 반환

**사용 예시**:
```javascript
import { decodeStackTrace } from './trace-decoder-wrapper.js';

const result = await decodeStackTrace(
  'https://domain.com/static/js/useAccessibilityStore-Q8JOaMCl.js:1:448'
);

// 결과:
// {
//   file: 'src/common/store/useAccessibilityStore.js',
//   line: 53,
//   column: 24,
//   function: 'status',
//   sourceCode: '...'
// }
```

### Phase 3: Claude Code 통합

**파일**: `claude-code-client.js`

**기능**:
- Claude Code CLI 실행
- 에러 컨텍스트 생성
- 수정 프롬프트 자동 생성
- 수정 결과 검증

**Claude Code 실행 방식**:
```javascript
import { spawn } from 'child_process';

async function runClaudeCode(prompt, workingDir) {
  return new Promise((resolve, reject) => {
    const claude = spawn('claude', [prompt], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    claude.stdout.on('data', (data) => {
      output += data.toString();
    });

    claude.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Claude Code exited with code ${code}`));
      }
    });
  });
}
```

**프롬프트 템플릿**:
```markdown
다음 에러를 수정해주세요:

## 에러 정보
- 메시지: {error.message}
- 발생 위치: {file}:{line}:{column}
- 함수: {function}

## 소스 코드
{sourceCode}

## 요구사항
- 에러의 근본 원인을 파악하고 수정
- 유사한 에러가 다른 곳에서도 발생하지 않도록 방어적 코드 작성
- 수정 후 커밋 메시지 생성

커밋 메시지 형식:
fix: {간단한 설명}

{상세 설명}

Fixes: {error.hash}
```

### Phase 4: Git 자동 커밋

**파일**: `git-auto-commit.js`

**기능**:
- 변경사항 자동 스테이징
- 커밋 메시지 자동 생성
- 중복 에러 추적 (해시 기반)
- 커밋 히스토리 관리

**커밋 메시지 예시**:
```
fix: useAccessibilityStore에서 undefined 체크 추가

res 객체가 undefined일 수 있는 경우를 방어적으로 처리.
API 호출 실패 시 안전하게 처리되도록 개선.

Fixes: abc123def456
Auto-fixed-by: AI Bug Fixer
```

### Phase 5: 메인 오케스트레이터

**파일**: `auto-fix-orchestrator.js`

**기능**:
- 전체 워크플로우 조율
- 에러 큐 관리
- 재시도 로직
- 모니터링 및 로깅

**워크플로우**:
```javascript
async function mainLoop() {
  while (true) {
    try {
      // 1. Grafana에서 새로운 에러 로그 수집
      const errors = await collectGrafanaLogs();

      // 2. 중복 제거 (이미 처리한 해시는 스킵)
      const newErrors = filterProcessedErrors(errors);

      if (newErrors.length === 0) {
        await sleep(60000); // 1분 대기
        continue;
      }

      // 3. 각 에러 처리
      for (const error of newErrors) {
        console.log(`처리 중: ${error.hash}`);

        // 3-1. 스택 트레이스 디코딩
        const location = await decodeStackTrace(error.stackTrace);

        if (!location) {
          console.log(`스킵: 소스맵을 찾을 수 없음`);
          markAsProcessed(error.hash, 'NO_SOURCEMAP');
          continue;
        }

        // 3-2. Claude Code에게 수정 요청
        const fixResult = await requestClaudeCodeFix({
          error,
          location,
        });

        if (!fixResult.success) {
          console.log(`스킵: 수정 실패`);
          markAsProcessed(error.hash, 'FIX_FAILED');
          continue;
        }

        // 3-3. Git 커밋
        await gitAutoCommit({
          message: fixResult.commitMessage,
          hash: error.hash,
        });

        console.log(`완료: ${error.hash}`);
        markAsProcessed(error.hash, 'FIXED');

        // 다음 에러 처리 전 대기 (API rate limit 고려)
        await sleep(5000);
      }

    } catch (err) {
      console.error('오류 발생:', err);
      await sleep(60000); // 에러 발생 시 1분 대기
    }
  }
}
```

## 기술 스택

### 필수 패키지
```json
{
  "dependencies": {
    "chalk": "^5.3.0",
    "source-map": "^0.7.4",
    "dotenv": "^16.4.0",
    "simple-git": "^3.25.0"
  }
}
```

### 환경 변수
```.env
# Grafana 설정
GRAFANA_URL=https://grafana.example.com
GRAFANA_API_KEY=your_api_key_here
GRAFANA_DATASOURCE_UID=loki_datasource_uid

# Claude Code 설정
# Claude Code CLI가 설치되어 있고 로그인되어 있어야 함
CLAUDE_CODE_PATH=claude

# 설정
AUTO_FIX_ENABLED=true
AUTO_FIX_INTERVAL=60000  # 60초
MAX_FIXES_PER_RUN=10
SOURCE_MAP_DIR=./target/static/js

# Git 설정
GIT_AUTO_COMMIT=true
GIT_BRANCH=auto-fix/errors
GIT_CREATE_PR=false
```

## 주요 기능

### 1. 중복 제거 시스템

**파일**: `processed-errors-db.json`

```json
{
  "abc123def456": {
    "hash": "abc123def456",
    "status": "FIXED",
    "timestamp": "2025-12-19T10:00:00Z",
    "commit": "a1b2c3d4",
    "error": {
      "message": "Cannot read properties of undefined",
      "file": "src/common/store/useAccessibilityStore.js",
      "line": 53
    }
  }
}
```

### 2. 에러 해시 생성

```javascript
import crypto from 'crypto';

function generateErrorHash(error) {
  // 스택 트레이스에서 파일명, 줄 번호, 에러 메시지를 조합
  const key = `${error.file}:${error.line}:${error.message}`;
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 12);
}
```

### 3. 안전장치

- **최대 수정 횟수 제한**: 한 번에 최대 N개까지만 수정
- **검증 단계**: Claude의 수정 결과를 린트로 검증
- **롤백 기능**: 문제 발생 시 자동 롤백
- **알림**: 중요한 이벤트는 슬랙/이메일로 알림

## 설정 파일

**파일**: `auto-fix-config.json`

```json
{
  "grafana": {
    "url": "https://grafana.example.com",
    "queryInterval": 60000,
    "lookbackWindow": "1h",
    "logQuery": "{app=\"frontend\"} |= \"Error\" | json"
  },
  "decoder": {
    "sourceMapDir": "./target/static/js",
    "contextLines": 10
  },
  "claudeCode": {
    "cliPath": "claude",
    "workingDir": "../../",
    "timeout": 300000,
    "maxRetries": 3
  },
  "git": {
    "autoCommit": true,
    "branch": "auto-fix/errors",
    "createPR": false,
    "commitPrefix": "fix(auto): "
  },
  "limits": {
    "maxFixesPerRun": 10,
    "minIntervalBetweenFixes": 5000,
    "maxRetries": 3
  },
  "filters": {
    "ignorePatterns": [
      "node_modules/",
      "vendor/",
      "test/"
    ],
    "minOccurrences": 3,
    "timeWindow": "1h"
  }
}
```

## 실행 방법

### 개발 모드
```bash
# 설치
cd scripts/stack-trace-decoder
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일을 수정하여 API 키 등 설정

# 단일 실행 (테스트)
npm run auto-fix:once

# 무한 루프 실행
npm run auto-fix:start

# 백그라운드 실행
npm run auto-fix:daemon
```

### 프로덕션 배포

**PM2 사용**:
```bash
pm2 start auto-fix-orchestrator.js --name "ai-bug-fixer"
pm2 save
pm2 startup
```

**Docker 사용**:
```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY scripts/stack-trace-decoder /app

RUN npm ci --production

CMD ["node", "auto-fix-orchestrator.js"]
```

## 모니터링 및 로깅

### 로그 출력 예시
```
[2025-12-19 10:00:00] 🔍 Grafana 로그 수집 중...
[2025-12-19 10:00:01] ✓ 5개의 새로운 에러 발견
[2025-12-19 10:00:01] 📝 처리 중: abc123 (useAccessibilityStore.js:53)
[2025-12-19 10:00:05] 🔍 스택 트레이스 디코딩 완료
[2025-12-19 10:00:10] 🤖 Claude에게 수정 요청 중...
[2025-12-19 10:00:25] ✓ 수정 완료
[2025-12-19 10:00:26] 📦 커밋 생성: fix(auto): useAccessibilityStore undefined 체크 추가
[2025-12-19 10:00:27] ✅ 완료: abc123
```

### 메트릭 수집
```javascript
{
  "totalErrors": 150,
  "fixedErrors": 120,
  "failedFixes": 20,
  "skippedErrors": 10,
  "avgFixTime": 25.5,  // 초
  "successRate": 0.8   // 80%
}
```

## 고려 사항 및 제약

### 제약 사항

1. **API Rate Limit**
   - Claude API: 분당 요청 수 제한
   - Grafana API: 쿼리 빈도 제한
   - 해결: 요청 간 대기 시간 추가, 큐 시스템

2. **소스맵 정확도**
   - 프로덕션과 로컬 빌드 해시 불일치 가능
   - 해결: Fuzzy matching 사용 (이미 구현됨)

3. **AI 수정 정확도**
   - Claude가 항상 올바른 수정을 제공하지 않을 수 있음
   - 해결: 수정 후 린트/테스트 자동 실행, 실패 시 롤백

4. **Git 충돌**
   - 동시에 여러 파일 수정 시 충돌 가능
   - 해결: 한 번에 하나씩 처리, 브랜치 전략

### 안전장치

1. **Dry Run 모드**
   ```bash
   AUTO_FIX_DRY_RUN=true npm run auto-fix:start
   ```
   - 실제 수정/커밋 없이 로그만 출력

2. **수동 승인 모드**
   ```bash
   AUTO_FIX_MANUAL_APPROVAL=true npm run auto-fix:start
   ```
   - 각 수정 전 사용자 승인 필요

3. **최대 수정 수 제한**
   - 한 번에 너무 많은 수정을 방지
   - 설정: `MAX_FIXES_PER_RUN=10`

4. **알림 시스템**
   ```javascript
   // Slack 웹훅으로 중요 이벤트 알림
   async function notifySlack(message, severity) {
     if (severity === 'HIGH') {
       await sendSlackMessage({
         text: `🚨 ${message}`,
         channel: '#auto-fix-alerts'
       });
     }
   }
   ```

## 다음 단계

### Phase 1 (MVP)
- [ ] Grafana 로그 수집기 구현
- [ ] 스택 트레이스 디코더 래퍼 구현
- [ ] 기본 오케스트레이터 구현
- [ ] Dry run 모드로 테스트

### Phase 2 (통합)
- [ ] Claude API 통합
- [ ] Git 자동 커밋 구현
- [ ] 중복 제거 시스템
- [ ] 단위 테스트 작성

### Phase 3 (프로덕션)
- [ ] 에러 핸들링 강화
- [ ] 모니터링 및 알림
- [ ] 문서화
- [ ] 프로덕션 배포

### Phase 4 (고도화)
- [ ] 머신러닝 기반 에러 패턴 분석
- [ ] 자동 테스트 생성
- [ ] PR 자동 생성 및 리뷰 요청
- [ ] 대시보드 구축

## 참고 자료

- [Grafana Loki Query API](https://grafana.com/docs/loki/latest/api/)
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [Source Map Specification](https://sourcemaps.info/spec.html)
- [Simple Git Documentation](https://github.com/steveukx/git-js)

## 라이선스

MIT License
