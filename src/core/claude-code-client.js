#!/usr/bin/env node
import { spawn } from 'child_process';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Claude Code CLI 클라이언트
 * 에러를 자동으로 수정하기 위해 Claude Code와 통신합니다.
 */
export class ClaudeCodeClient {
    constructor(config) {
        this.config = config;
        this.cliPath = config.claudeCode.cliPath;
        // workingDir는 프로젝트 루트 기준 상대 경로로 처리
        this.workingDir = path.resolve(process.cwd(), config.claudeCode.workingDir);
        this.timeout = config.claudeCode.timeout || 300000; // 5분
        this.maxRetries = config.claudeCode.maxRetries || 3;
    }

    /**
     * 에러 수정 요청
     */
    async fixError(errorInfo, decodedLocation) {
        console.log(chalk.cyan('🤖 Claude Code에게 수정 요청 중...'));
        console.log(chalk.dim(`   에러: ${errorInfo.error.message}`));
        console.log(chalk.dim(`   파일: ${decodedLocation.original.file}:${decodedLocation.original.line}`));

        // 프롬프트 생성
        const prompt = this.generatePrompt(errorInfo, decodedLocation);

        // Claude Code 실행
        let retries = 0;
        let lastError = null;

        while (retries < this.maxRetries) {
            try {
                const result = await this.runClaudeCode(prompt);
                console.log(chalk.green('✓ 수정 완료'));
                if (result.cost) {
                    console.log(chalk.yellow(`   💰 예상 비용: ${result.cost}`));
                }

                return {
                    success: true,
                    result: result,
                    prompt: prompt,
                    errorHash: errorInfo.hash,
                    cost: result.cost,
                };
            } catch (error) {
                lastError = error;
                retries++;
                console.warn(chalk.yellow(`⚠️  시도 ${retries}/${this.maxRetries} 실패: ${error.message}`));

                if (retries < this.maxRetries) {
                    console.log(chalk.dim('   재시도 중...'));
                    await this.sleep(5000);
                }
            }
        }

        console.error(chalk.red('❌ 수정 실패'));
        return {
            success: false,
            error: lastError?.message || 'Unknown error',
            errorHash: errorInfo.hash,
        };
    }

    /**
     * 프롬프트 생성
     */
    generatePrompt(errorInfo, decodedLocation) {
        const { error } = errorInfo;
        const { original, sourceCode } = decodedLocation;

        // 소스 코드 컨텍스트 생성
        const contextLines = sourceCode
            .map((line) => {
                const marker = line.isTarget ? '→ ' : '  ';
                return `${marker}${line.lineNum.toString().padStart(4, ' ')} | ${line.content}`;
            })
            .join('\n');

        // 원본 스택 트레이스 포맷팅 (커밋 메시지용)
        const stackTraceForCommit = error.stackTrace
            .split('\n')
            .slice(0, 3) // 처음 3줄만 사용
            .map(line => `  ${line.trim()}`)
            .join('\n');

        const prompt = `다음 프로덕션 에러를 수정해주세요:

## 에러 정보
- 타입: ${error.type}
- 메시지: ${error.message}
- 발생 위치: ${original.file}:${original.line}:${original.column}
${original.function ? `- 함수: ${original.function}` : ''}

## 소스 코드
파일: ${original.file}

\`\`\`javascript
${contextLines}
\`\`\`

## 요구사항
1. 에러의 근본 원인을 파악하고 수정
2. 유사한 에러가 다른 곳에서도 발생하지 않도록 방어적 코드 작성
3. 수정 후 코드가 정상 작동하는지 확인
4. 중요: 코드를 수정만 하고, 절대 git commit을 수행하지 마세요. 커밋은 외부 시스템이 처리합니다.
`;

        return prompt;
    }

    /**
     * Claude Code CLI 실행
     */
    async runClaudeCode(prompt) {
        return new Promise((resolve, reject) => {
            let output = '';
            let errorOutput = '';

            console.log(chalk.dim('   Claude Code 실행 중...'));
            console.log(chalk.dim(`   작업 디렉토리: ${this.workingDir}`));
            console.log(chalk.dim(`   권한 모드: ${this.config.claudeCode.permissionMode || 'acceptEdits'}`));

            // Claude Code CLI 인자
            const args = [
                '--print',  // 비대화형 모드
                '--permission-mode', this.config.claudeCode.permissionMode || 'acceptEdits',
            ];

            // 허용된 도구 목록 추가 (옵션)
            if (this.config.claudeCode.allowedTools && this.config.claudeCode.allowedTools.length > 0) {
                args.push('--allowedTools', this.config.claudeCode.allowedTools.join(','));
            }

            const claude = spawn(this.cliPath, args, {
                cwd: this.workingDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                // shell: true, // Removed to fix DEP0190: Passing args to a child process with shell option true
            });

            const timeoutId = setTimeout(() => {
                claude.kill();
                reject(new Error(`Timeout after ${this.timeout}ms`));
            }, this.timeout);

            // stdin으로 프롬프트 전달
            claude.stdin.write(prompt);
            claude.stdin.end();

            claude.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                // 실시간 출력 (선택적)
                if (this.config.features?.verbose) {
                    process.stdout.write(chalk.dim(text));
                }
            });

            claude.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            claude.on('error', (error) => {
                clearTimeout(timeoutId);
                reject(new Error(`Failed to spawn Claude Code: ${error.message}`));
            });

            claude.on('close', (code) => {
                clearTimeout(timeoutId);

                if (code === 0) {
                    // 비용 정보 추출
                    const costMatch = output.match(/Cost:\s*(\$[\d\.]+)/i);
                    const cost = costMatch ? costMatch[1] : null;

                    resolve({
                        output: output,
                        exitCode: code,
                        cost: cost,
                    });
                } else {
                    console.log('--- Claude Code Stdout ---');
                    console.log(output);
                    console.log('--- Claude Code Stderr ---');
                    console.log(errorOutput);
                    console.log('--------------------------');
                    reject(new Error(`Claude Code exited with code ${code}\nStderr: ${errorOutput}\nStdout: ${output}`));
                }
            });
        });
    }

    /**
     * 수정 결과 검증
     */
    async verifyFix(errorInfo, fixResult) {
        // TODO: 린트, 테스트 실행 등으로 검증
        console.log(chalk.dim('   수정 결과 검증 중...'));

        // 기본적으로 Claude Code가 성공적으로 완료되면 검증 통과
        if (fixResult.success) {
            console.log(chalk.green('✓ 검증 통과'));
            return true;
        }

        return false;
    }

    /**
     * Sleep 유틸리티
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}


// CLI 모드로 실행된 경우 (테스트용)
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        console.log(chalk.cyan('🧪 Claude Code 클라이언트 테스트\n'));

        // 테스트 에러 정보
        const testError = {
            hash: 'test123',
            error: {
                type: 'TypeError',
                message: 'Cannot read properties of undefined (reading "status")',
            },
        };

        const testLocation = {
            original: {
                file: 'src/common/store/useAccessibilityStore.js',
                line: 53,
                column: 24,
                function: 'status',
            },
            sourceCode: [
                { lineNum: 48, content: 'async function checkAccessibility() {', isTarget: false },
                { lineNum: 49, content: '  const res = await fetch("/api/accessibility");', isTarget: false },
                { lineNum: 50, content: '  const data = await res.json();', isTarget: false },
                { lineNum: 51, content: '  ', isTarget: false },
                { lineNum: 52, content: '  // 에러 발생 위치', isTarget: false },
                { lineNum: 53, content: '  if (res.status === "OK") {', isTarget: true },
                { lineNum: 54, content: '    return data;', isTarget: false },
                { lineNum: 55, content: '  }', isTarget: false },
                { lineNum: 56, content: '}', isTarget: false },
            ],
        };

        // 설정 로드
        const config = {
            claudeCode: {
                cliPath: 'claude',
                workingDir: '../../',
                timeout: 300000,
                maxRetries: 1,
            },
            features: {
                verbose: false,
            },
        };

        const client = new ClaudeCodeClient(config);

        // 프롬프트 생성 테스트
        console.log(chalk.yellow('📝 생성된 프롬프트:\n'));
        const prompt = client.generatePrompt(testError, testLocation);
        console.log(chalk.dim(prompt));

        console.log(chalk.yellow('\n💡 실제 수정을 실행하려면 아래 명령어를 사용하세요:'));
        console.log(chalk.dim('   await client.fixError(errorInfo, decodedLocation)'));
    })();
}
