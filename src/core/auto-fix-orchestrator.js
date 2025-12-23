#!/usr/bin/env node
import chalk from 'chalk';
import { createConfig, validateConfig } from '../config/index.js';
import { GrafanaLogCollector } from './grafana-log-collector.js';
import { StackTraceDecoder } from './decoder-wrapper.js';
import { ClaudeCodeClient } from './claude-code-client.js';
import { ProcessedErrorsDB } from '../db/processed-errors-db.js';
import { SlackNotifier } from '../utils/slack-notifier.js';

/**
 * Sleep 유틸리티
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 메인 오케스트레이터
 */
class AutoFixOrchestrator {
    constructor(config, mode = 'once') {
        this.config = config;
        this.mode = mode;
        this.collector = new GrafanaLogCollector(config);
        this.decoder = new StackTraceDecoder(config);
        this.claudeClient = new ClaudeCodeClient(config);
        this.db = new ProcessedErrorsDB(config.paths.processedErrorsDb);
        this.slackNotifier = new SlackNotifier(config);

        this.stats = {
            totalRuns: 0,
            totalErrors: 0,
            totalFixed: 0,
            totalFailed: 0,
            totalSkipped: 0,
        };
    }

    /**
     * 단일 에러 처리
     */
    async processError(error) {
        const errorHash = error.hash;

        console.log(chalk.cyan(`\n📝 에러 처리 중: ${errorHash}`));
        console.log(chalk.dim(`   메시지: ${error.error.message.substring(0, 80)}`));

        // 1. 스택 트레이스 디코딩
        console.log(chalk.dim('   스택 트레이스 디코딩 중...'));
        const decoded = await this.decoder.decodeStackTrace(error.error.stackTrace);

        if (!decoded) {
            console.log(chalk.yellow('   ⚠️  스킵: 소스맵을 찾을 수 없음'));
            this.db.markAsProcessed(errorHash, 'NO_SOURCEMAP', {
                message: error.error.message,
            });
            this.stats.totalSkipped++;
            return { success: false, reason: 'NO_SOURCEMAP' };
        }

        console.log(chalk.dim(`   ✓ 디코딩 완료: ${decoded.original.file}:${decoded.original.line}`));

        // 2. Claude Code로 수정
        console.log(chalk.dim('   Claude Code에게 수정 요청 중...'));
        const fixResult = await this.claudeClient.fixError(error, decoded);

        if (!fixResult.success) {
            console.log(chalk.red('   ❌ 수정 실패'));
            this.db.markAsProcessed(errorHash, 'FAILED', {
                message: error.error.message,
                file: decoded.original.file,
                line: decoded.original.line,
                error: fixResult.error,
            });
            this.stats.totalFailed++;
            return { success: false, reason: 'FIX_FAILED' };
        }

        console.log(chalk.green('   ✓ 수정 완료'));
        this.db.markAsProcessed(errorHash, 'FIXED', {
            message: error.error.message,
            file: decoded.original.file,
            line: decoded.original.line,
        });
        this.stats.totalFixed++;

        return { success: true };
    }

    /**
     * 메인 루프 1회 실행
     */
    async runOnce() {
        const processedErrors = [];

        try {
            this.stats.totalRuns++;

            console.log(chalk.cyan.bold(`\n🔄 실행 #${this.stats.totalRuns}\n`));

            // 1. Grafana에서 에러 수집
            console.log(chalk.cyan('1️⃣  Grafana에서 에러 로그 수집 중...'));
            const errors = await this.collector.collectErrors();

            if (errors.length === 0) {
                console.log(chalk.dim('   에러 없음\n'));
                return;
            }

            this.stats.totalErrors += errors.length;
            console.log(chalk.green(`   ✓ ${errors.length}개의 에러 수집 완료\n`));

            // 2. 중복 제거
            console.log(chalk.cyan('2️⃣  중복 에러 필터링 중...'));
            const newErrors = this.db.filterUnprocessed(errors);

            if (newErrors.length === 0) {
                console.log(chalk.yellow('   ⚠️  모든 에러가 이미 처리됨\n'));
                return;
            }

            console.log(chalk.green(`   ✓ ${newErrors.length}개의 새로운 에러 발견\n`));

            // 3. 에러 처리 (최대 개수 제한)
            // once 모드일 경우 1개만 처리
            const maxFixes = this.mode === 'once' ? 1 : this.config.limits.maxFixesPerRun;
            const errorsToProcess = newErrors.slice(0, maxFixes);

            console.log(chalk.cyan(`3️⃣  에러 수정 시작 (최대 ${maxFixes}개)\n`));

            for (let i = 0; i < errorsToProcess.length; i++) {
                const error = errorsToProcess[i];

                console.log(chalk.yellow(`━━━ [${i + 1}/${errorsToProcess.length}] ━━━`));

                const result = await this.processError(error);

                // 처리된 에러 정보 저장 (Slack 알림용)
                if (result.success || result.reason) {
                    const processedInfo = this.db.get(error.hash);
                    if (processedInfo) {
                        processedErrors.push({
                            status: processedInfo.status,
                            message: processedInfo.metadata?.message || error.error.message,
                            file: processedInfo.metadata?.file || '',
                            line: processedInfo.metadata?.line || '',
                        });
                    }
                }

                // 다음 에러 처리 전 대기
                if (i < errorsToProcess.length - 1) {
                    const waitTime = this.config.limits.minIntervalBetweenFixes;
                    console.log(chalk.dim(`\n   ${waitTime}ms 대기 중...\n`));
                    await sleep(waitTime);
                }
            }

            // 4. 통계 출력
            this.printStats();

            // 5. Slack 알림 전송
            await this.slackNotifier.sendNotification({
                mode: this.mode,
                fixed: this.stats.totalFixed,
                failed: this.stats.totalFailed,
                skipped: this.stats.totalSkipped,
                total: errors.length,
                errors: processedErrors,
            });

        } catch (error) {
            console.error(chalk.red('\n❌ 오류 발생:'), error.message);
            console.error(error.stack);

            // 오류 발생 시에도 Slack 알림 전송
            await this.slackNotifier.sendNotification({
                mode: this.mode,
                fixed: this.stats.totalFixed,
                failed: this.stats.totalFailed,
                skipped: this.stats.totalSkipped,
                total: this.stats.totalErrors,
                errors: processedErrors,
                error: error.message,
            });
        }
    }

    /**
     * 무한 루프 실행
     */
    async runContinuously() {
        console.log(chalk.cyan.bold('🤖 AI 자동 버그 수정 - 연속 실행 모드\n'));
        console.log(chalk.dim(`   간격: ${this.config.grafana.queryInterval}ms`));
        console.log(chalk.dim(`   최대 수정/실행: ${this.config.limits.maxFixesPerRun}개`));
        console.log(chalk.dim(`   작업 디렉토리: ${this.config.claudeCode.workingDir}\n`));

        while (true) {
            await this.runOnce();

            // 다음 실행까지 대기
            const interval = this.config.grafana.queryInterval;
            console.log(chalk.dim(`\n⏰ ${interval / 1000}초 대기 후 다시 실행...\n`));
            console.log(chalk.dim('━'.repeat(80) + '\n'));

            await sleep(interval);
        }
    }

    /**
     * 통계 출력
     */
    printStats() {
        console.log(chalk.cyan('\n📊 누적 통계:'));
        console.log(chalk.dim(`   총 실행 횟수: ${this.stats.totalRuns}회`));
        console.log(chalk.dim(`   총 수집된 에러: ${this.stats.totalErrors}개`));
        console.log(chalk.green(`   ✓ 수정 성공: ${this.stats.totalFixed}개`));
        console.log(chalk.red(`   ✗ 수정 실패: ${this.stats.totalFailed}개`));
        console.log(chalk.yellow(`   ⊘ 스킵됨: ${this.stats.totalSkipped}개`));

        // DB 통계
        const dbStats = this.db.getStats();
        console.log(chalk.cyan('\n💾 DB 통계:'));
        console.log(chalk.dim(`   전체 처리된 에러: ${dbStats.total}개`));
        for (const [status, count] of Object.entries(dbStats.byStatus)) {
            console.log(chalk.dim(`   ${status}: ${count}개`));
        }
    }

}

/**
 * 메인 실행
 */
async function main() {
    try {
        // 설정 로드
        const config = createConfig();

        // 실행 모드 선택
        const mode = process.argv[2] || 'once';

        // 오케스트레이터 생성
        const orchestrator = new AutoFixOrchestrator(config, mode);

        switch (mode) {
            case 'once':
                // 1회 실행
                console.log(chalk.cyan.bold('🤖 AI 자동 버그 수정 - 단일 실행\n'));
                await orchestrator.runOnce();
                break;

            case 'continuous':
            case 'loop':
                // 무한 루프
                await orchestrator.runContinuously();
                break;

            default:
                console.log('사용법:');
                console.log('  node auto-fix-orchestrator.js once       - 1회 실행');
                console.log('  node auto-fix-orchestrator.js continuous - 연속 실행');
                break;
        }

    } catch (error) {
        console.error(chalk.red('❌ 실행 실패:'), error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 실행
main();
