#!/usr/bin/env node
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import readline from 'readline';
import { createConfig } from '../config/index.js';
import { GrafanaLogCollector } from '../core/grafana-log-collector.js';
import { StackTraceDecoder } from '../core/decoder-wrapper.js';
import { ClaudeCodeClient } from '../core/claude-code-client.js';

// 환경 변수 로드
dotenv.config();

/**
 * 사용자 입력 대기
 */
function askQuestion(rl, query) {
    return new Promise(resolve => rl.question(query, resolve));
}

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

        // 3. 에러 순회 및 큐인 (Queueing)
        const fixQueue = [];
        const decoder = new StackTraceDecoder(config);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log(chalk.cyan('\n3️⃣  에러 검토 및 수정 대기열 추가\n'));

        for (let i = 0; i < errors.length; i++) {
            const error = errors[i];
            console.log(chalk.yellow.bold(`\n━━━ [에러 ${i + 1}/${errors.length}] ━━━`));

            // 스택 트레이스 디코딩
            const decoded = await decoder.decodeStackTrace(error.error.stackTrace);

            if (!decoded) {
                console.log(chalk.dim(`   에러: ${error.error.message.substring(0, 80)}`));
                console.log(chalk.red('   ❌ 디코딩 실패: 소스맵을 찾을 수 없음'));
                console.log(chalk.dim('   (이 에러는 자동으로 건너뜁니다)'));
                continue;
            }

            console.log(chalk.dim(`   메시지: ${error.error.message.substring(0, 100)}`));
            if (decoded.original) {
                console.log(chalk.green(`   위치: ${decoded.original.file}:${decoded.original.line}`));
            } else {
                console.log(chalk.yellow('   ⚠️  원본 위치를 찾을 수 없음'));
            }

            // 디코딩된 소스 코드 미리보기 (짧게)
            console.log(chalk.dim('   Preview:'));
            const previewLines = decoder.formatResult(decoded).split('\n').slice(0, 5).join('\n');
            console.log(chalk.dim(previewLines));

            // 사용자 선택
            while (true) {
                const answer = await askQuestion(rl, chalk.cyan('\n   [q] 대기열 추가  [s] 건너뛰기  [v] 원본 코드 보기  [e] 바로 실행 (남은건 무시) > '));
                const choice = answer.trim().toLowerCase();

                if (choice === 'q') {
                    fixQueue.push({ error, decoded });
                    console.log(chalk.green('   ✓ 대기열에 추가되었습니다.'));
                    break;
                } else if (choice === 's') {
                    console.log(chalk.dim('   - 건너뜀'));
                    break;
                } else if (choice === 'v') {
                    console.log(chalk.cyan('\n📄 원본 코드 전체 보기:'));
                    console.log(decoder.formatResult(decoded));
                    console.log(''); // 줄바꿈
                    // 루프 계속 (다시 질문)
                } else if (choice === 'e') {
                    console.log(chalk.green('   ▶️ 검토를 중단하고 현재 대기열을 실행합니다.'));
                    i = errors.length; // 루프 종료
                    break;
                }
            }
        }

        // 4. 일괄 실행 (Batch Execution)
        if (fixQueue.length === 0) {
            console.log(chalk.yellow('\n⚠️  대기열에 추가된 에러가 없습니다. 종료합니다.'));
            rl.close();
            return;
        }

        console.log(chalk.cyan.bold(`\n4️⃣  일괄 수정 실행 (${fixQueue.length}개)`));
        console.log(chalk.dim('   - Claude Code가 순차적으로 실행됩니다.'));

        const confirm = await askQuestion(rl, chalk.yellow('\n⚠️  정말로 실행하시겠습니까? (Y/n) > '));
        if (confirm.trim().toLowerCase() === 'n') {
            console.log(chalk.yellow('   ⛔ 취소되었습니다.'));
            rl.close();
            return;
        }

        rl.close(); // 입력 대기 종료

        const claudeClient = new ClaudeCodeClient(config);

        for (let i = 0; i < fixQueue.length; i++) {
            const item = fixQueue[i];
            const fileLocation = item.decoded.original ? item.decoded.original.file : 'Unknown Location';
            console.log(chalk.cyan(`\nProcessing [${i + 1}/${fixQueue.length}]: ${fileLocation}`));

            const result = await claudeClient.fixError(item.error, item.decoded);

            if (result.success) {
                console.log(chalk.green('   ✅ 수정 성공!'));
            } else {
                console.log(chalk.red(`   ❌ 수정 실패: ${result.error}`));
            }
        }

        console.log(chalk.green.bold('\n✨ 모든 작업이 완료되었습니다.\n'));

    } catch (error) {
        console.error(chalk.red('\n❌ 실행 실패:'), error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 실행
runAutoFix();
