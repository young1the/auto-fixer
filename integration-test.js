#!/usr/bin/env node
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import { GrafanaLogCollector } from './grafana-log-collector.js';
import { StackTraceDecoder } from './trace-decoder-wrapper.js';
import { ClaudeCodeClient } from './claude-code-client.js';

// 환경 변수 로드
dotenv.config();

/**
 * 설정 로드 (환경 변수 치환)
 */
function loadConfig(configPath) {
    const configFile = fs.readFileSync(configPath, 'utf8');

    // 환경 변수 치환 (JSON 파싱 전)
    const replaced = configFile.replace(/\$\{(\w+)\}/g, (match, key) => {
        const value = process.env[key];
        if (!value) return match;

        // JSON 문자열 내부이므로 특수 문자를 이스케이프 (백슬래시 먼저, 그 다음 따옴표)
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    });

    return JSON.parse(replaced);
}

/**
 * 통합 테스트 메인 함수
 */
async function runIntegrationTest() {
    console.log(chalk.cyan.bold('🧪 Claude Code 통합 테스트\n'));

    try {
        // 1. 설정 로드
        console.log(chalk.cyan('1️⃣  설정 로드 중...'));
        const config = loadConfig('./auto-fix-config.json');
        console.log(chalk.green('   ✓ 설정 로드 완료\n'));

        // 2. Grafana에서 로그 수집
        console.log(chalk.cyan('2️⃣  Grafana에서 에러 로그 수집 중...'));
        const collector = new GrafanaLogCollector(config);
        const errors = await collector.collectErrors();

        if (errors.length === 0) {
            console.log(chalk.yellow('   ⚠️  수집된 에러 없음'));
            return;
        }

        console.log(chalk.green(`   ✓ ${errors.length}개의 에러 수집 완료\n`));

        // 3. 첫 번째 에러만 처리 (테스트용)
        const error = errors[0];
        console.log(chalk.cyan('3️⃣  스택 트레이스 디코딩 중...'));
        console.log(chalk.dim(`   에러: ${error.error.message.substring(0, 80)}`));
        console.log(chalk.dim(`   스택: ${error.error.stackTrace.split('\n')[0]}`));

        const decoder = new StackTraceDecoder(config);
        const decoded = await decoder.decodeStackTrace(error.error.stackTrace);

        if (!decoded) {
            console.log(chalk.yellow('   ⚠️  디코딩 실패: 소스맵을 찾을 수 없음\n'));
            return;
        }

        console.log(chalk.green('   ✓ 디코딩 완료'));
        console.log(chalk.dim(`   원본 파일: ${decoded.original.file}:${decoded.original.line}\n`));

        // 4. Claude Code에게 수정 요청
        console.log(chalk.cyan('4️⃣  Claude Code 통합 테스트'));
        console.log(chalk.yellow('   💡 실제로 Claude Code를 실행하지 않습니다 (DRY RUN)'));
        console.log(chalk.yellow('   💡 생성된 프롬프트만 확인합니다\n'));

        const claudeClient = new ClaudeCodeClient(config);
        const prompt = claudeClient.generatePrompt(error, decoded);

        console.log(chalk.cyan('📝 생성된 프롬프트:\n'));
        console.log(chalk.dim('─'.repeat(80)));
        console.log(prompt);
        console.log(chalk.dim('─'.repeat(80)));

        console.log(chalk.green('\n✅ 통합 테스트 완료!\n'));
        console.log(chalk.cyan('💡 다음 단계:'));
        console.log(chalk.dim('   1. Claude Code CLI가 설치되어 있는지 확인'));
        console.log(chalk.dim('   2. WORKING_DIR에 git worktree가 설정되어 있는지 확인'));
        console.log(chalk.dim('   3. 실제 자동 수정을 실행하려면:'));
        console.log(chalk.dim('      const result = await claudeClient.fixError(error, decoded);'));

    } catch (error) {
        console.error(chalk.red('\n❌ 테스트 실패:'), error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 실행
runIntegrationTest();
