#!/usr/bin/env node
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import { createConfig } from '../config/index.js';
import { GrafanaLogCollector } from '../core/grafana-log-collector.js';
import { StackTraceDecoder } from '../core/decoder-wrapper.js';
import { ClaudeCodeClient } from '../core/claude-code-client.js';

// 환경 변수 로드
dotenv.config();

/**
 * 설정 로드 (환경 변수 치환)
 */
/**
 * 실제 자동 수정 실행
 */
async function runAutoFix() {
    console.log(chalk.cyan.bold('🤖 AI 자동 버그 수정 시작\n'));

    try {
        // 1. 설정 로드
        console.log(chalk.cyan('1️⃣  설정 로드 중...'));
        const config = createConfig();
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

        // 에러 통계 출력
        collector.printErrorStats(errors);

        // 3. 첫 번째 에러만 처리
        const error = errors[0];
        console.log(chalk.cyan('\n3️⃣  스택 트레이스 디코딩 중...'));
        console.log(chalk.dim(`   에러: ${error.error.message.substring(0, 80)}`));
        console.log(chalk.dim(`   스택: ${error.error.stackTrace.split('\n')[0]}`));

        const decoder = new StackTraceDecoder(config);
        const decoded = await decoder.decodeStackTrace(error.error.stackTrace);

        if (!decoded) {
            console.log(chalk.yellow('   ⚠️  디코딩 실패: 소스맵을 찾을 수 없음\n'));
            console.log(chalk.yellow('💡 다음 에러로 이동하려면 여러 에러를 순회하는 기능이 필요합니다.'));
            return;
        }

        console.log(chalk.green('   ✓ 디코딩 완료'));
        console.log(chalk.dim(`   원본 파일: ${decoded.original.file}:${decoded.original.line}\n`));

        // 디코딩된 소스 코드 미리보기
        console.log(chalk.cyan('📄 에러 발생 위치:\n'));
        console.log(decoder.formatResult(decoded));

        // 4. 사용자 확인
        console.log(chalk.yellow('\n⚠️  실제로 Claude Code를 실행하여 이 에러를 수정하시겠습니까?'));
        console.log(chalk.dim('   - 작업 디렉토리: ' + config.claudeCode.workingDir));
        console.log(chalk.dim('   - 브랜치: workspace (또는 현재 브랜치)'));
        console.log(chalk.dim('   - 자동 커밋: ' + (config.git.autoCommit ? '예' : '아니오')));

        // 실제로는 사용자 입력을 받아야 하지만, 지금은 바로 실행
        console.log(chalk.green('\n   ✓ 실행을 계속합니다...\n'));

        // 5. Claude Code에게 수정 요청
        console.log(chalk.cyan('4️⃣  Claude Code 실행 중...'));
        const claudeClient = new ClaudeCodeClient(config);
        const result = await claudeClient.fixError(error, decoded);

        if (result.success) {
            console.log(chalk.green.bold('\n✅ 수정 성공!\n'));
            console.log(chalk.cyan('📝 수정 내역:'));
            console.log(chalk.dim('   에러 해시: ' + result.errorHash));
            console.log(chalk.dim('   출력:'));
            console.log(chalk.dim(result.result.output.substring(0, 500)));
        } else {
            console.log(chalk.red.bold('\n❌ 수정 실패\n'));
            console.log(chalk.red('   에러: ' + result.error));
        }

    } catch (error) {
        console.error(chalk.red('\n❌ 실행 실패:'), error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 실행
runAutoFix();
