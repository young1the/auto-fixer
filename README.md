# Stack Trace Decoder & AI Auto-Fix

프로덕션 환경의 minified 스택 트레이스를 소스맵을 이용해 디코딩하고, AI(Claude Code)를 활용하여 자동으로 버그를 수정하는 도구입니다.

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
- **Claude Code**를 이용한 자동 버그 수정
- 자동 Git 커밋 및 브랜치 관리
- 에러 처리 상태 추적 (중복 수정 방지)
- Slack 알림 연동

## 설치

```bash
npm install
```

## 설정

### 환경 변수 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 설정을 수정하세요.

```bash
cp .env.example .env
```

`.env` 파일 주요 설정:

```env
# Grafana 설정 (필수)
GRAFANA_URL=https://your-grafana-instance.com
GRAFANA_API_KEY=your_api_key_here
GRAFANA_DATASOURCE_UID=your_loki_datasource_uid
GRAFANA_QUERY_INTERVAL=60000
GRAFANA_LOG_QUERY='{job="frontend"}'

# Decoder 설정
SOURCE_MAP_DIR=./workspace/target/static/js
DECODER_CONTEXT_LINES=10
DECODER_IDE=intellij

# Claude Code 설정
CLAUDE_CODE_PATH=claude
WORKING_DIR=./workspace
CLAUDE_PERMISSION_MODE=acceptEdits  # acceptAll, acceptEdits, reject

# Git 설정
GIT_AUTO_COMMIT=true
GIT_BRANCH=auto-fix/errors
GIT_PUSH_TO_REMOTE=false

# 기능 플래그
DRY_RUN=false
ENABLE_SLACK_NOTIFICATIONS=false
```

## 사용 방법

### AI 자동 수정 (Auto Fix)

**인터랙티브 모드 (권장)**:
가장 사용하기 쉬운 모드로, 에러 수집부터 수정까지 단계를 확인하며 진행합니다.
```bash
npm run auto-fix
```

**단일 실행 모드 (배치 작업용)**:
한 번 실행하고 종료합니다.
```bash
npm run auto-fix:once
```

**지속 실행 모드 (데몬용)**:
계속 실행되면서 주기적으로 에러를 모니터링하고 수정합니다.
```bash
npm run auto-fix:loop
```

### 스택 트레이스 디코딩

**대화형 디코더**:
```bash
npm run decode
```
스택 트레이스를 붙여넣고 Enter를 두 번 누르세요.

**파이프(Pipe) 사용**:
```bash
echo "Error: ... at https://..." | npm run decode
```

### 데이터베이스 관리

처리된 에러 내역을 관리합니다.

- **통계 확인**: `npm run db:stats`
- **목록 확인**: `npmqhs run db:list`
- **정리 (오래된 항목 삭제)**: `npm run db:cleanup`
- **초기화 (모든 데이터 삭제)**: `npm run db:reset`

### 테스트

- **통합 테스트**: `npm run test:integration`
- **수집기 테스트**: `npm run test:collector`
- **Slack 알림 테스트**: `npm run test:slack`

## 디렉토리 구조

```
auto-fixer/
├── src/
│   ├── cli/              # CLI 진입점 (run-auto-fix.js, decode-trace.js)
│   ├── config/           # 설정 관리 (환경 변수 로드)
│   ├── core/             # 핵심 로직 (Orchestrator, Collector, Decoder, Claude Client)
│   ├── db/               # JSON 기반 간이 DB (처리된 에러 추적)
│   └── utils/            # 유틸리티 (Slack Notifier 등)
├── tests/                # 테스트 코드
├── .auto-fix-data/       # (자동 생성) 런타임 데이터, 로그, DB 파일 저장소
├── task.md               # 구현 계획 및 상태
├── package.json
└── README.md
```

## 트러블슈팅

### 소스맵을 찾을 수 없음
1. `.env` 파일의 `SOURCE_MAP_DIR` 경로가 올바른지 확인하세요.
2. 해당 경로에 `.js.map` 파일들이 실제로 존재하는지 확인하세요.

### Grafana API 연결 실패
1. `GRAFANA_URL`이 올바른지 확인하세요.
2. `GRAFANA_API_KEY`에 충분한 권한이 있는지 확인하세요.
3. `GRAFANA_DATASOURCE_UID`가 올바른지 확인하세요 (Loki 데이터소스).

### Claude Code 실행 오류
1. `claude` CLI가 시스템에 설치되어 있고 로그인되어 있는지 확인하세요 (`claude login`).
2. `WORKING_DIR`이 실제 존재하는 프로젝트 경로인지 확인하세요.

## 라이선스

MIT License

