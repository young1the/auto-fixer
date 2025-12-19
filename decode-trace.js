#!/usr/bin/env node
import { SourceMapConsumer } from 'source-map';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

// 설정 로드
function loadConfig() {
    const configPath = path.join(process.cwd(), 'stack-trace-config.json');
    const defaultConfig = {
        sourceMapDir: './dist',
        contextLines: 3,
        ide: 'vscode', // 'vscode', 'intellij', 'webstorm', 'none'
        debug: false, // 디버그 메시지 출력 여부
    };

    if (fs.existsSync(configPath)) {
        const configFile = fs.readFileSync(configPath, 'utf8');

        // 환경 변수 치환
        const replaced = configFile.replace(/\$\{(\w+)\}/g, (match, key) => {
            const value = process.env[key];
            if (!value) return match;

            return value
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
        });

        return { ...defaultConfig, ...JSON.parse(replaced) };
    }

    return defaultConfig;
}

// Stack trace 파싱
function parseStackTrace(stackTrace) {
    const lines = stackTrace.split('\n');
    const parsed = [];

    // 다양한 패턴 지원
    const patterns = [
        // https://domain.com/path/file.js:line:column
        /https?:\/\/[^\s]+\/([^/:]+\.js):(\d+):(\d+)/g,
        // at functionName (file.js:line:column)
        /at .+ \(([^:]+):(\d+):(\d+)\)/g,
        // at file.js:line:column
        /at ([^:]+):(\d+):(\d+)/g,
    ];

    for (const line of lines) {
        for (const pattern of patterns) {
            const matches = [...line.matchAll(pattern)];
            for (const match of matches) {
                // 파일명에서 경로 부분 제거
                const fileName = match[1].split('/').pop();
                parsed.push({
                    original: line.trim(),
                    file: fileName,
                    line: parseInt(match[2]),
                    column: parseInt(match[3]),
                });
            }
        }
    }

    return parsed;
}

// Source map 로드
async function loadSourceMap(sourceMapPath) {
    const rawSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    return await new SourceMapConsumer(rawSourceMap);
}

// 원본 위치 찾기
function getOriginalPosition(consumer, line, column) {
    const pos = consumer.originalPositionFor({ line, column });

    if (pos.source === null) {
        return null;
    }

    return {
        source: pos.source,
        line: pos.line,
        column: pos.column,
        name: pos.name,
    };
}

// 소스 코드 컨텍스트 가져오기
function getSourceContext(consumer, sourcePath, line, contextLines = 3) {
    try {
        const content = consumer.sourceContentFor(sourcePath);
        if (!content) return null;

        const lines = content.split('\n');
        const start = Math.max(0, line - contextLines - 1);
        const end = Math.min(lines.length, line + contextLines);

        const snippet = [];
        for (let i = start; i < end; i++) {
            snippet.push({
                lineNum: i + 1,
                content: lines[i],
                isTarget: i + 1 === line,
            });
        }

        return snippet;
    } catch (error) {
        return null;
    }
}

// 파일명에서 hash 부분 제거 (예: index-a1b2c3d4.js -> index)
function extractBaseName(fileName) {
    // .js 확장자 제거
    const nameWithoutExt = fileName.replace(/\.js$/, '');

    // hash 패턴 제거 (마지막 하이픈 이후가 hash인 경우)
    // Vite는 -[해시] 형식을 사용 (해시는 6자 이상의 영숫자, 하이픈, 언더스코어)
    // 예: useAccessibilityStore-Q8JOaMCl -> useAccessibilityStore
    //     useAccessibilityStore-KbWrkZ-9 -> useAccessibilityStore

    // 마지막 하이픈을 기준으로 분리하되, 해시 패턴과 매칭되는 경우만
    const lastDashIndex = nameWithoutExt.lastIndexOf('-');
    if (lastDashIndex > 0) {
        const possibleHash = nameWithoutExt.substring(lastDashIndex + 1);

        // Vite 해시 패턴 감지:
        // 1. 숫자만으로 된 패턴 (길이 무관, 예: 9, 123)
        // 2. 2자 이상의 영숫자 조합이며 다음 중 하나:
        //    - 대소문자가 모두 섞여 있음 (예: BfxPiVjV, Bglop)
        //    - 숫자가 포함됨 (예: 3s, abc123)

        if (/^\d+$/.test(possibleHash)) {
            // 숫자만으로 된 빌드 번호는 무조건 제거
            return extractBaseName(nameWithoutExt.substring(0, lastDashIndex) + '.js');
        } else if (/^[a-zA-Z0-9_-]{2,}$/.test(possibleHash)) {
            const hasUpperAndLower = /[A-Z]/.test(possibleHash) && /[a-z]/.test(possibleHash);
            const hasDigit = /\d/.test(possibleHash);

            // 해시로 판단되면 재귀적으로 제거
            if (hasUpperAndLower || hasDigit) {
                return extractBaseName(nameWithoutExt.substring(0, lastDashIndex) + '.js');
            }
        }
    }


    return nameWithoutExt;
}

// Source map 파일 찾기 (여러 패턴 시도 + fuzzy matching)
function findSourceMapFile(config, fileName) {
    const sourceMapDir = path.join(process.cwd(), config.sourceMapDir);

    // 1. 정확한 매치 시도 (기존 동작)
    const exactPatterns = [
        path.join(sourceMapDir, `${fileName}.map`),
        path.join(sourceMapDir, fileName.replace('.js', '.js.map')),
    ];

    for (const pattern of exactPatterns) {
        if (fs.existsSync(pattern)) {
            return pattern;
        }
    }

    // 2. Hash를 제거한 base name으로 fuzzy matching
    const baseName = extractBaseName(fileName);

    if (config.debug) {
        console.log(chalk.dim(`[디버그] 유사 매칭: fileName="${fileName}", baseName="${baseName}"`));
    }

    // searchDir는 이미 static/js까지 포함된 경로
    if (!fs.existsSync(sourceMapDir)) {
        if (config.debug) {
            console.log(chalk.dim(`[디버그] 소스맵 디렉토리를 찾을 수 없음: ${sourceMapDir}`));
        }
        return null;
    }

    try {
        const files = fs.readdirSync(sourceMapDir);

        if (config.debug) {
            console.log(chalk.dim(`[디버그] ${sourceMapDir}에서 ${files.length}개 파일 스캔 중`));
        }

        const matchingFiles = files
            .filter(file => {
                if (!file.endsWith('.js.map')) return false;

                // 파일의 base name 추출
                const fileBaseName = extractBaseName(file.replace('.js.map', '.js'));
                const match = fileBaseName === baseName;

                if (config.debug && file.includes('useAccessibility')) {
                    console.log(chalk.dim(`[디버그]   ${file}: fileBaseName="${fileBaseName}", match=${match}`));
                }

                return match;
            })
            .map(file => ({
                path: path.join(sourceMapDir, file),
                mtime: fs.statSync(path.join(sourceMapDir, file)).mtime
            }));

        // 가장 최신 파일 선택
        if (matchingFiles.length > 0) {
            matchingFiles.sort((a, b) => b.mtime - a.mtime);
            if (config.debug) {
                console.log(chalk.dim(`[디버그] ${matchingFiles.length}개 매칭 파일 발견, 사용: ${matchingFiles[0].path}`));
            }
            return matchingFiles[0].path;
        }
    } catch (error) {
        if (config.debug) {
            console.log(chalk.dim(`[디버그] 디렉토리 읽기 오류: ${error.message}`));
        }
        return null;
    }

    return null;
}

// IDE 링크 형식으로 출력
function createIDELink(filePath, line, column, ideType = 'vscode', debug = false) {
    // source map에서 반환된 경로 처리
    // webpack:// 프로토콜 제거
    let cleanPath = filePath.replace(/^webpack:\/\/[^/]+\//, '');

    // 프로젝트 루트 기준 상대 경로인지 확인
    const isRelative = !path.isAbsolute(cleanPath);

    // 절대 경로 생성 (프로젝트 루트 기준)
    const absolutePath = isRelative
        ? path.resolve(process.cwd(), cleanPath)
        : path.resolve(cleanPath);

    // 프로젝트 루트 기준 상대 경로 계산
    let relativePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');

    // ../를 제거하고 정규화 (source map이 이미 상대 경로인 경우)
    // 예: ../../src/... -> src/...
    if (relativePath.startsWith('..')) {
        // cleanPath가 이미 src/로 시작하면 그대로 사용
        if (cleanPath.match(/^(src|lib|dist|public)\//)) {
            relativePath = cleanPath.replace(/\\/g, '/');
        } else {
            // ../를 제거하고 src/부터 찾기
            const srcMatch = cleanPath.match(/(src\/.+)/);
            if (srcMatch) {
                relativePath = srcMatch[1];
            }
        }
    }

    // Windows 경로의 백슬래시를 슬래시로 변환
    const unixPath = absolutePath.replace(/\\/g, '/');

    // 디버그 정보 출력 (debug 옵션이 true일 때만)
    if (debug) {
        console.log(chalk.dim(`   [디버그] 원본: ${filePath}`));
        console.log(chalk.dim(`   [디버그] 정리된 경로: ${cleanPath}`));
        console.log(chalk.dim(`   [디버그] 상대 경로: ${relativePath}`));
        console.log(chalk.dim(`   [디버그] 절대 경로: ${absolutePath}`));
        console.log(chalk.dim(`   [디버그] 줄: ${line}, 컬럼: ${column}`));
    }

    switch (ideType.toLowerCase()) {
        case 'intellij':
        case 'idea':
        case 'webstorm':
        case 'phpstorm':
        case 'pycharm':
            // IntelliJ는 프로젝트 루트 기준 상대 경로만 있으면 충분
            return `${relativePath}:${line}:${column}`;

        case 'vscode':
        case 'code':
            // VS Code: vscode://file/{path}:{line}:{column}
            return `vscode://file/${absolutePath}:${line}:${column}`;

        case 'none':
        case 'off':
            // 링크 없이 경로만 반환 (상대 경로 + 절대 경로)
            return `${relativePath}:${line}:${column}\n   ${absolutePath}:${line}:${column}`;

        default:
            // 기본값: VS Code
            return `vscode://file/${absolutePath}:${line}:${column}`;
    }
}

// 단일 entry 처리 함수
async function processEntry(entry, config, index, total) {
    console.log(chalk.gray('━'.repeat(80)));
    console.log(chalk.cyan(`[${index + 1}/${total}] `) + chalk.dim(`원본: ${entry.original}`));
    console.log();

    const sourceMapPath = findSourceMapFile(config, entry.file);

    if (!sourceMapPath) {
        console.log(chalk.red(`❌ 소스맵을 찾을 수 없음: ${entry.file}`));
        console.log(chalk.dim(`   검색 위치: ${config.sourceMapDir}`));
        console.log();
        return;
    }

    try {
        const consumer = await loadSourceMap(sourceMapPath);
        const original = getOriginalPosition(consumer, entry.line, entry.column);

        if (!original) {
            console.log(chalk.yellow('⚠️  원본 소스로 매핑할 수 없습니다'));
            consumer.destroy();
            return;
        }

        // 원본 위치 출력
        console.log(chalk.cyan('📍 원본 위치:'));
        console.log(`   ${chalk.green(original.source)}:${chalk.yellow(original.line)}:${chalk.yellow(original.column)}`);

        if (original.name) {
            console.log(`   함수: ${chalk.magenta(original.name)}`);
        }

        // 클릭 가능한 링크 (IDE)
        const link = createIDELink(original.source, original.line, original.column, config.ide, config.debug);
        console.log(chalk.dim(`   ${link}`));

        // 소스 코드 컨텍스트
        const sourceCode = getSourceContext(consumer, original.source, original.line, config.contextLines);

        if (sourceCode) {
            console.log();
            console.log(chalk.cyan('📄 소스 코드:'));
            sourceCode.forEach(line => {
                const lineNumStr = String(line.lineNum).padStart(4, ' ');
                if (line.isTarget) {
                    console.log(chalk.red.bold(`❯ ${lineNumStr} │ ${line.content}`));
                } else {
                    console.log(chalk.dim(`  ${lineNumStr} │ ${line.content}`));
                }
            });
        }

        console.log();
        consumer.destroy();
    } catch (error) {
        console.log(chalk.red(`❌ 처리 중 오류 발생: ${error.message}`));
        console.log();
    }
}

// 화면 클리어 및 커서 이동
function clearScreen() {
    console.clear();
}

// 네비게이션 모드로 stack trace 처리
async function processStackTrace(stackTrace, config, stdin) {
    const parsed = parseStackTrace(stackTrace);

    if (parsed.length === 0) {
        console.log(chalk.yellow('⚠️  스택 트레이스 항목을 찾을 수 없습니다'));
        return;
    }

    let currentIndex = 0;
    let isNavigating = true;

    // raw mode 활성화
    if (stdin.setRawMode) {
        stdin.setRawMode(true);
    }
    stdin.resume();

    const displayCurrentEntry = async () => {
        clearScreen();
        console.log(chalk.cyan.bold('🔍 스택 트레이스 네비게이터\n'));
        console.log(chalk.dim(`항목 ${currentIndex + 1} / ${parsed.length}`));
        console.log(chalk.dim('← 이전 | → 다음 | Enter: 새 트레이스 | Ctrl+C: 종료\n'));

        await processEntry(parsed[currentIndex], config, currentIndex, parsed.length);
    };

    // 첫 번째 entry 표시
    await displayCurrentEntry();

    return new Promise((resolve) => {
        const onKeyPress = async (chunk) => {
            const key = chunk.toString();

            // Ctrl+C
            if (key === '\u0003') {
                stdin.pause();
                if (stdin.setRawMode) {
                    stdin.setRawMode(false);
                }
                console.log(chalk.dim('\n✓ 종료합니다!'));
                process.exit(0);
            }

            // Enter - 새로운 trace 입력
            if (key === '\r' || key === '\n') {
                stdin.removeListener('data', onKeyPress);
                if (stdin.setRawMode) {
                    stdin.setRawMode(false);
                }
                stdin.pause();
                clearScreen();
                resolve();
                return;
            }

            // 방향키 처리
            if (key === '\u001b[C' || key === '\u001b[D') { // 오른쪽 또는 왼쪽 방향키
                if (key === '\u001b[C') { // 오른쪽
                    if (currentIndex < parsed.length - 1) {
                        currentIndex++;
                        await displayCurrentEntry();
                    }
                } else if (key === '\u001b[D') { // 왼쪽
                    if (currentIndex > 0) {
                        currentIndex--;
                        await displayCurrentEntry();
                    }
                }
            }
        };

        stdin.on('data', onKeyPress);
    });
}

// 인터랙티브 모드
async function interactiveMode(config) {
    const stdin = process.stdin;

    while (true) {
        console.log(chalk.cyan.bold('🔍 스택 트레이스 디코더'));
        console.log(chalk.dim('스택 트레이스를 붙여넣고 Enter를 두 번 눌러 처리하세요\n'));

        // readline 인터페이스 생성 (입력 수집용)
        const rl = readline.createInterface({
            input: stdin,
            output: process.stdout,
            terminal: false,
        });

        let input = '';
        let emptyLineCount = 0;

        // stack trace 입력 받기
        const getInput = () => new Promise((resolve) => {
            const lineHandler = (line) => {
                if (line.trim() === '') {
                    emptyLineCount++;
                    if (emptyLineCount >= 2 && input.trim()) {
                        rl.removeListener('line', lineHandler);
                        rl.close();
                        resolve(input);
                    }
                } else {
                    emptyLineCount = 0;
                    input += line + '\n';
                }
            };

            rl.on('line', lineHandler);
        });

        const stackTrace = await getInput();

        // stack trace 처리 (네비게이션 모드)
        await processStackTrace(stackTrace, config, stdin);

        // 다음 입력 대기
        console.log(chalk.cyan.bold('\n🔍 다음 스택 트레이스를 입력하세요'));
    }
}

// Pipe 모드 (echo "..." | node decode.js)
async function pipeMode(config) {
    let input = '';

    for await (const chunk of process.stdin) {
        input += chunk;
    }

    if (input.trim()) {
        const parsed = parseStackTrace(input);

        if (parsed.length === 0) {
            console.log(chalk.yellow('⚠️  스택 트레이스 항목을 찾을 수 없습니다'));
            return;
        }

        for (let i = 0; i < parsed.length; i++) {
            await processEntry(parsed[i], config, i, parsed.length);
        }
    }
}

// 메인 실행
const config = loadConfig();

console.log(chalk.dim(`설정: 소스맵 디렉토리=${config.sourceMapDir}, 컨텍스트 줄=${config.contextLines}\n`));

if (process.stdin.isTTY) {
    interactiveMode(config);
} else {
    pipeMode(config);
}