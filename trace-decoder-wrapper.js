#!/usr/bin/env node
import { SourceMapConsumer } from 'source-map';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

/**
 * 스택 트레이스 디코더 래퍼
 * decode-trace.js의 기능을 프로그래밍 방식으로 사용할 수 있도록 래핑
 */
export class StackTraceDecoder {
    constructor(config) {
        this.config = config;
        this.sourceMapDir = path.join(process.cwd(), config.decoder.sourceMapDir);
        this.contextLines = config.decoder.contextLines || 10;
        this.debug = config.decoder.debug || false;
    }

    /**
     * 스택 트레이스 디코딩 (메인 함수)
     */
    async decodeStackTrace(stackTrace) {
        const parsed = this.parseStackTrace(stackTrace);

        if (parsed.length === 0) {
            return null;
        }

        // 첫 번째 항목만 처리 (가장 상위 에러)
        const entry = parsed[0];
        return await this.decodeEntry(entry);
    }

    /**
     * 단일 스택 트레이스 항목 디코딩
     */
    async decodeEntry(entry) {
        const sourceMapPath = this.findSourceMapFile(entry.file);

        if (!sourceMapPath) {
            if (this.debug) {
                console.log(chalk.yellow(`⚠️  소스맵을 찾을 수 없음: ${entry.file}`));
            }
            return null;
        }

        try {
            const consumer = await this.loadSourceMap(sourceMapPath);
            const original = this.getOriginalPosition(consumer, entry.line, entry.column);

            if (!original) {
                consumer.destroy();
                return null;
            }

            const sourceCode = this.getSourceContext(consumer, original.source, original.line);

            const result = {
                // 원본 정보
                minified: {
                    file: entry.file,
                    line: entry.line,
                    column: entry.column,
                },
                // 디코딩된 정보
                original: {
                    file: original.source,
                    line: original.line,
                    column: original.column,
                    function: original.name,
                },
                // 소스 코드
                sourceCode: sourceCode,
                // 전체 컨텍스트
                context: {
                    targetLine: sourceCode?.find(l => l.isTarget)?.content,
                    beforeLines: sourceCode?.filter(l => l.lineNum < original.line).map(l => l.content),
                    afterLines: sourceCode?.filter(l => l.lineNum > original.line).map(l => l.content),
                },
            };

            consumer.destroy();
            return result;

        } catch (error) {
            console.error(chalk.red(`❌ 디코딩 오류: ${error.message}`));
            return null;
        }
    }

    /**
     * 스택 트레이스 파싱
     */
    parseStackTrace(stackTrace) {
        const lines = stackTrace.split('\n');
        const parsed = [];

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

    /**
     * 소스맵 로드
     */
    async loadSourceMap(sourceMapPath) {
        const rawSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
        return await new SourceMapConsumer(rawSourceMap);
    }

    /**
     * 원본 위치 찾기
     */
    getOriginalPosition(consumer, line, column) {
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

    /**
     * 소스 코드 컨텍스트 가져오기
     */
    getSourceContext(consumer, sourcePath, line) {
        try {
            const content = consumer.sourceContentFor(sourcePath);
            if (!content) return null;

            const lines = content.split('\n');
            const start = Math.max(0, line - this.contextLines - 1);
            const end = Math.min(lines.length, line + this.contextLines);

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

    /**
     * 파일명에서 hash 부분 제거
     */
    extractBaseName(fileName) {
        const nameWithoutExt = fileName.replace(/\.js$/, '');
        const lastDashIndex = nameWithoutExt.lastIndexOf('-');

        if (lastDashIndex > 0) {
            const possibleHash = nameWithoutExt.substring(lastDashIndex + 1);

            // 숫자만으로 된 패턴 (빌드 번호)
            if (/^\d+$/.test(possibleHash)) {
                return this.extractBaseName(nameWithoutExt.substring(0, lastDashIndex) + '.js');
            }

            // 2자 이상의 영숫자 조합
            if (/^[a-zA-Z0-9_-]{2,}$/.test(possibleHash)) {
                const hasUpperAndLower = /[A-Z]/.test(possibleHash) && /[a-z]/.test(possibleHash);
                const hasDigit = /\d/.test(possibleHash);

                if (hasUpperAndLower || hasDigit) {
                    return this.extractBaseName(nameWithoutExt.substring(0, lastDashIndex) + '.js');
                }
            }
        }

        return nameWithoutExt;
    }

    /**
     * 소스맵 파일 찾기 (fuzzy matching 포함)
     */
    findSourceMapFile(fileName) {
        // 1. 정확한 매치 시도
        const exactPatterns = [
            path.join(this.sourceMapDir, `${fileName}.map`),
            path.join(this.sourceMapDir, fileName.replace('.js', '.js.map')),
        ];

        for (const pattern of exactPatterns) {
            if (fs.existsSync(pattern)) {
                return pattern;
            }
        }

        // 2. Hash를 제거한 base name으로 fuzzy matching
        const baseName = this.extractBaseName(fileName);

        if (!fs.existsSync(this.sourceMapDir)) {
            return null;
        }

        try {
            const files = fs.readdirSync(this.sourceMapDir);

            const matchingFiles = files
                .filter(file => {
                    if (!file.endsWith('.js.map')) return false;
                    const fileBaseName = this.extractBaseName(file.replace('.js.map', '.js'));
                    return fileBaseName === baseName;
                })
                .map(file => ({
                    path: path.join(this.sourceMapDir, file),
                    mtime: fs.statSync(path.join(this.sourceMapDir, file)).mtime
                }));

            // 가장 최신 파일 선택
            if (matchingFiles.length > 0) {
                matchingFiles.sort((a, b) => b.mtime - a.mtime);
                return matchingFiles[0].path;
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    /**
     * 디코딩 결과 포맷팅 (사람이 읽기 쉬운 형태)
     */
    formatResult(result) {
        if (!result) {
            return null;
        }

        const lines = [
            chalk.cyan('📍 원본 위치:'),
            `   파일: ${chalk.green(result.original.file)}`,
            `   줄: ${chalk.yellow(result.original.line)}`,
            `   컬럼: ${chalk.yellow(result.original.column)}`,
        ];

        if (result.original.function) {
            lines.push(`   함수: ${chalk.magenta(result.original.function)}`);
        }

        if (result.sourceCode) {
            lines.push('');
            lines.push(chalk.cyan('📄 소스 코드:'));
            result.sourceCode.forEach(line => {
                const lineNumStr = String(line.lineNum).padStart(4, ' ');
                if (line.isTarget) {
                    lines.push(chalk.red.bold(`❯ ${lineNumStr} │ ${line.content}`));
                } else {
                    lines.push(chalk.dim(`  ${lineNumStr} │ ${line.content}`));
                }
            });
        }

        return lines.join('\n');
    }
}

/**
 * 설정 로드 (환경 변수 치환)
 */
function loadConfig(configPath) {
    const configFile = fs.readFileSync(configPath, 'utf8');

    // 환경 변수 치환 (JSON 파싱 전)
    const replaced = configFile.replace(/\$\{(\w+)\}/g, (match, key) => {
        const value = process.env[key];
        if (!value) return match;

        // JSON 문자열 내부이므로 특수 문자를 이스케이프
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    });

    return JSON.parse(replaced);
}

// CLI 모드로 실행된 경우
const __filename = fileURLToPath(import.meta.url);
if (__filename === process.argv[1]) {
    (async () => {
        try {
            // .env 파일 로드
            const dotenv = await import('dotenv');
            dotenv.config();

            // 설정 로드
            const config = await loadConfig('./auto-fix-config.json');

            // 스택 트레이스 입력
            const stackTrace = process.argv[2] || 'Error: Cannot read properties of undefined (reading \'status\') at ? (https://e4math2sh1-b.aitextbook.co.kr/static/js/useAccessibilityStore-Q8JOaMCl.js:1:448)';

            // 디코더 생성 및 실행
            const decoder = new StackTraceDecoder(config);
            const result = await decoder.decodeStackTrace(stackTrace);

            if (result) {
                console.log(decoder.formatResult(result));

                // JSON 출력 옵션
                if (process.argv.includes('--json')) {
                    console.log('\n' + JSON.stringify(result, null, 2));
                }
            } else {
                console.log(chalk.yellow('⚠️  디코딩 실패: 소스맵을 찾을 수 없거나 매핑할 수 없습니다'));
                process.exit(1);
            }

        } catch (error) {
            console.error(chalk.red('❌ 오류 발생:'), error.message);
            process.exit(1);
        }
    })();
}
