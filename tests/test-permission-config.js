#!/usr/bin/env node
import { createConfig } from '../src/config/index.js';
import { ClaudeCodeClient } from '../src/core/claude-code-client.js';
import chalk from 'chalk';

/**
 * 권한 처리 모드 테스트
 * 
 * 이 스크립트는 새로운 --permission-mode 설정을 테스트합니다.
 */

console.log(chalk.cyan('🧪 Claude Code 권한 설정 테스트\n'));

// 설정 로드
const config = createConfig();

console.log(chalk.yellow('📋 현재 설정:'));
console.log(chalk.dim(`   CLI 경로: ${config.claudeCode.cliPath}`));
console.log(chalk.dim(`   작업 디렉토리: ${config.claudeCode.workingDir}`));
console.log(chalk.dim(`   권한 모드: ${config.claudeCode.permissionMode}`));
console.log(chalk.dim(`   허용된 도구: ${config.claudeCode.allowedTools ? config.claudeCode.allowedTools.join(', ') : '모두 허용'}`));
console.log();

// 테스트 에러 정보
const testError = {
    hash: 'test-permission-mode',
    error: {
        type: 'TypeError',
        message: 'Cannot read properties of undefined (reading "test")',
        stackTrace: 'TypeError: Cannot read properties of undefined (reading "test")\n    at Object.test (file.js:1:10)'
    },
};

const testLocation = {
    original: {
        file: 'src/test.js',
        line: 10,
        column: 5,
        function: 'testFunction',
    },
    sourceCode: [
        { lineNum: 8, content: 'function testFunction() {', isTarget: false },
        { lineNum: 9, content: '  const obj = getData();', isTarget: false },
        { lineNum: 10, content: '  return obj.test;', isTarget: true },
        { lineNum: 11, content: '}', isTarget: false },
    ],
};

// 클라이언트 생성
const client = new ClaudeCodeClient(config);

// 프롬프트 생성 테스트
console.log(chalk.yellow('📝 생성된 프롬프트 미리보기:\n'));
const prompt = client.generatePrompt(testError, testLocation);
console.log(chalk.dim(prompt.substring(0, 500) + '...\n'));

// CLI 인자 출력
console.log(chalk.yellow('🔧 Claude Code에 전달될 CLI 인자:'));
const args = [
    '--print',
    '--permission-mode', config.claudeCode.permissionMode || 'acceptEdits',
];

if (config.claudeCode.allowedTools && config.claudeCode.allowedTools.length > 0) {
    args.push('--allowedTools', config.claudeCode.allowedTools.join(','));
}

console.log(chalk.dim('   ' + args.join(' ')));
console.log();

console.log(chalk.green('✅ 설정 테스트 완료!'));
console.log();
console.log(chalk.yellow('💡 다음 단계:'));
console.log(chalk.dim('   1. .env 파일에서 CLAUDE_PERMISSION_MODE 설정 확인'));
console.log(chalk.dim('   2. 필요시 CLAUDE_ALLOWED_TOOLS로 도구 제한'));
console.log(chalk.dim('   3. npm run test:integration으로 실제 통합 테스트 실행'));
