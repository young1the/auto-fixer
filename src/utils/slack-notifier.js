#!/usr/bin/env node
import chalk from 'chalk';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

// 환경 변수 로드
dotenv.config();

/**
 * Slack 알림 클라이언트
 */
export class SlackNotifier {
    constructor(config) {
        this.config = config;
        this.enabled = config.features?.enableSlackNotifications || false;
        this.webhookUrl = config.slack?.webhookUrl;
        this.channel = config.slack?.channel || '#auto-fix-alerts';
        this.username = config.slack?.username || 'Auto-Fix Bot';
    }

    /**
     * Slack 알림 전송
     */
    async sendNotification(summary) {
        if (!this.enabled) {
            console.log(chalk.dim('   ℹ️  Slack 알림이 비활성화됨'));
            return { success: false, reason: 'disabled' };
        }

        if (!this.webhookUrl || this.webhookUrl.startsWith('${')) {
            console.log(chalk.dim('   ⚠️  Slack webhook URL이 설정되지 않음'));
            return { success: false, reason: 'no_webhook' };
        }

        try {
            const url = new URL(this.webhookUrl);
            const protocol = url.protocol === 'https:' ? https : http;

            const payload = JSON.stringify({
                channel: this.channel,
                username: this.username,
                icon_emoji: ':robot_face:',
                text: this.formatMessage(summary),
            });

            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            };

            return new Promise((resolve, reject) => {
                const req = protocol.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            console.log(chalk.green('   ✓ Slack 알림 전송 완료'));
                            resolve({ success: true, statusCode: res.statusCode });
                        } else {
                            console.log(chalk.yellow(`   ⚠️  Slack 알림 전송 실패: ${res.statusCode}`));
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    console.log(chalk.yellow(`   ⚠️  Slack 알림 전송 오류: ${error.message}`));
                    reject(error);
                });

                req.write(payload);
                req.end();
            });

        } catch (error) {
            console.log(chalk.yellow(`   ⚠️  Slack 알림 오류: ${error.message}`));
            return { success: false, error: error.message };
        }
    }

    /**
     * Slack 메시지 포맷팅
     */
    formatMessage(summary) {
        const { mode, fixed, failed, skipped, total, error } = summary;

        let statusEmoji = '✅';
        if (error) {
            statusEmoji = '❌';
        } else if (failed > 0) {
            statusEmoji = '⚠️';
        } else if (fixed === 0) {
            statusEmoji = 'ℹ️';
        }

        let message = `${statusEmoji} *Auto-Fix 실행 완료* (${mode} 모드)\n\n`;

        if (error) {
            message += `*오류 발생:*\n\`\`\`${error}\`\`\`\n\n`;
        }

        message += `*결과:*\n`;
        message += `• 수정 성공: ${fixed}개\n`;

        if (failed > 0) {
            message += `• 수정 실패: ${failed}개\n`;
        }
        if (skipped > 0) {
            message += `• 스킵: ${skipped}개\n`;
        }

        message += `• 총 에러: ${total}개\n`;

        if (summary.errors && summary.errors.length > 0) {
            message += `\n*처리된 에러:*\n`;
            summary.errors.forEach((err, idx) => {
                const statusIcon = err.status === 'FIXED' ? '✓' : err.status === 'FAILED' ? '✗' : '⊘';
                message += `${idx + 1}. ${statusIcon} ${err.message.substring(0, 100)}\n`;
                if (err.file && err.line) {
                    message += `   \`${err.file}:${err.line}\`\n`;
                }
            });
        }

        return message;
    }

    /**
     * 테스트 메시지 전송
     */
    async sendTestMessage() {
        console.log(chalk.cyan('🧪 Slack 알림 테스트\n'));

        const testSummary = {
            mode: 'test',
            fixed: 2,
            failed: 1,
            skipped: 0,
            total: 5,
            errors: [
                {
                    status: 'FIXED',
                    message: 'Cannot read properties of undefined (reading "data")',
                    file: 'src/components/Dashboard.vue',
                    line: 142,
                },
                {
                    status: 'FIXED',
                    message: 'Cannot read properties of null (reading "status")',
                    file: 'src/stores/authStore.js',
                    line: 53,
                },
                {
                    status: 'FAILED',
                    message: 'ReferenceError: handleClick is not defined',
                    file: 'src/components/Button.vue',
                    line: 28,
                },
            ],
        };

        console.log(chalk.yellow('📝 전송할 메시지:\n'));
        console.log(chalk.dim(this.formatMessage(testSummary)));
        console.log();

        const result = await this.sendNotification(testSummary);

        if (result.success) {
            console.log(chalk.green('\n✅ 테스트 성공!'));
        } else {
            console.log(chalk.red('\n❌ 테스트 실패:'), result.reason || result.error);
        }

        return result;
    }
}

/**
 * 설정 로드 (환경 변수 치환)
 */


// CLI 모드로 실행된 경우 (테스트용)
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    (async () => {
        try {
            // 설정 로드
            const { createConfig } = await import('../config/index.js');
            const config = createConfig();

            // Slack 알림 테스트
            const notifier = new SlackNotifier(config);
            await notifier.sendTestMessage();

        } catch (error) {
            console.error(chalk.red('❌ 오류 발생:'), error.message);
            console.error(error.stack);
            process.exit(1);
        }
    })();
}
