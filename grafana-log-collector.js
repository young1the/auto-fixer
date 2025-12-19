#!/usr/bin/env node
import crypto from 'crypto';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

/**
 * Grafana Loki 로그 수집기
 * 에러 로그를 수집하고 스택 트레이스를 추출합니다.
 */
export class GrafanaLogCollector {
    constructor(config) {
        this.config = config;
        this.baseURL = config.grafana.url;
        this.apiKey = config.grafana.apiKey;
        this.datasourceUid = config.grafana.datasourceUid;
    }

    /**
     * Grafana Loki에서 로그 쿼리
     */
    async queryLogs(query, start, end, limit = 100) {
        const startTimestamp = this.getTimestamp(start);
        const endTimestamp = this.getTimestamp(end);

        // URL 파라미터로 쿼리 전달 (GET 방식)
        const params = new URLSearchParams({
            query: query,
            start: startTimestamp.toString(),
            end: endTimestamp.toString(),
            limit: limit.toString(),
        });

        const url = `${this.baseURL}/api/datasources/proxy/uid/${this.datasourceUid}/loki/api/v1/query_range?${params}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error(chalk.red('❌ Grafana API 호출 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 타임스탬프 변환 (상대 시간 지원)
     */
    getTimestamp(time) {
        if (typeof time === 'number') {
            return time * 1000000; // 나노초로 변환
        }

        // 상대 시간 파싱 (예: "1h", "30m", "now")
        if (time === 'now') {
            return Date.now() * 1000000;
        }

        const match = time.match(/^now-(\d+)([smhd])$/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            const ms = {
                's': value * 1000,
                'm': value * 60 * 1000,
                'h': value * 60 * 60 * 1000,
                'd': value * 24 * 60 * 60 * 1000,
            }[unit];

            return (Date.now() - ms) * 1000000;
        }

        // ISO 8601 형식
        return new Date(time).getTime() * 1000000;
    }

    /**
     * 에러 로그 수집
     */
    async collectErrors() {
        console.log(chalk.cyan('🔍 Grafana 로그 수집 중...'));

        const query = this.config.grafana.logQuery;
        const lookback = this.config.grafana.lookbackWindow;
        const limit = this.config.grafana.maxResults || 100;

        try {
            const data = await this.queryLogs(
                query,
                `now-${lookback}`,
                'now',
                limit
            );

            const errors = this.parseLogData(data);
            console.log(chalk.green(`✓ ${errors.length}개의 에러 로그 발견`));

            return errors;
        } catch (error) {
            console.error(chalk.red('❌ 로그 수집 실패'));
            return [];
        }
    }

    /**
     * Loki 응답 데이터 파싱
     */
    parseLogData(data) {
        const errors = [];

        if (!data.data || !data.data.result) {
            console.warn(chalk.yellow('⚠️  응답 데이터가 비어있습니다'));
            return errors;
        }

        for (const stream of data.data.result) {
            const labels = stream.stream || {};

            for (const [timestamp, logLine] of stream.values || []) {
                try {
                    const error = this.parseLogLine(logLine, labels, timestamp);
                    if (error) {
                        errors.push(error);
                    }
                } catch (err) {
                    console.warn(chalk.yellow(`⚠️  로그 파싱 실패: ${err.message}`));
                }
            }
        }

        return errors;
    }

    /**
     * 로그 라인 파싱
     */
    parseLogLine(logLine, labels, timestamp) {
        let parsed;

        // JSON 로그인 경우
        try {
            parsed = JSON.parse(logLine);
        } catch {
            // 일반 텍스트 로그 (key=value 형식)
            parsed = { message: logLine };

            // key=value 형식에서 value 필드 추출
            const valueMatch = logLine.match(/value="([^"]+)"/);
            if (valueMatch) {
                parsed.value = valueMatch[1];
            }

            // type 필드 추출
            const typeMatch = logLine.match(/type=(\w+)/);
            if (typeMatch) {
                parsed.type = typeMatch[1];
            }
        }

        // 에러 메시지 추출 (value 우선, 없으면 message)
        const errorMessage = parsed.value || parsed.error || parsed.message || parsed.msg || '';
        if (!errorMessage) {
            return null;
        }

        // 스택 트레이스 추출
        const stackTrace = this.extractStackTrace(parsed);
        if (!stackTrace) {
            return null;
        }

        // 에러 타입 추출
        const errorType = parsed.type || 'Error';

        // 에러 객체 생성
        const error = {
            hash: this.generateErrorHash(errorMessage, stackTrace),
            timestamp: new Date(parseInt(timestamp) / 1000000).toISOString(),
            labels: labels,
            error: {
                type: errorType,
                message: errorMessage,
                stackTrace: stackTrace,
                level: parsed.level || 'error',
                raw: parsed,
            },
        };

        return error;
    }

    /**
     * 스택 트레이스 추출
     */
    extractStackTrace(parsed) {
        // 1. stack 필드 확인
        if (parsed.stack) {
            return parsed.stack;
        }

        // 2. stacktrace 필드 확인
        if (parsed.stacktrace) {
            return parsed.stacktrace;
        }

        // 3. error.stack 확인
        if (parsed.error && parsed.error.stack) {
            return parsed.error.stack;
        }

        // 4. message에서 스택 트레이스 패턴 찾기
        const message = parsed.message || parsed.msg || '';
        const stackTracePattern = /https?:\/\/[^\s]+\.js:\d+:\d+/g;
        const matches = message.match(stackTracePattern);

        if (matches && matches.length > 0) {
            return matches.join('\n');
        }

        return null;
    }

    /**
     * 에러 해시 생성 (중복 제거용)
     */
    generateErrorHash(message, stackTrace) {
        // 스택 트레이스에서 첫 번째 줄 추출
        const firstLine = stackTrace.split('\n')[0].trim();

        // 파일명과 줄 번호 추출
        const match = firstLine.match(/([^/]+\.js):(\d+):/);
        const key = match
            ? `${match[1]}:${match[2]}:${message.substring(0, 100)}`
            : `${message}:${firstLine}`;

        return crypto
            .createHash('sha256')
            .update(key)
            .digest('hex')
            .substring(0, 12);
    }

    /**
     * 에러 통계 출력
     */
    printErrorStats(errors) {
        if (errors.length === 0) {
            console.log(chalk.dim('   에러 없음'));
            return;
        }

        console.log(chalk.cyan('\n📊 에러 통계:'));

        // 에러 타입별 그룹화
        const byType = {};
        for (const error of errors) {
            const type = error.error.type || 'Unknown';
            byType[type] = (byType[type] || 0) + 1;
        }

        for (const [type, count] of Object.entries(byType)) {
            console.log(chalk.dim(`   ${type}: ${count}개`));
        }

        // 상위 5개 에러 표시
        console.log(chalk.cyan('\n🔥 최근 에러:'));
        errors.slice(0, 5).forEach((error, idx) => {
            const shortMsg = error.error.message.substring(0, 80);
            const time = new Date(error.timestamp).toLocaleTimeString('ko-KR');
            const file = error.error.stackTrace.split('\n')[0].split('/').pop().split(':')[0];
            console.log(chalk.dim(`   ${idx + 1}. [${time}] ${shortMsg}`));
            console.log(chalk.dim(`      파일: ${file}`));
        });
    }
}

/**
 * 설정 로드 (환경 변수 치환)
 */
function loadConfig(configPath) {
    const configFile = fs.readFileSync(configPath, 'utf8');

    // 환경 변수 치환 (JSON 파싱 전) - 따옴표 이스케이프 포함
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

// CLI 모드로 실행된 경우
const __filename = fileURLToPath(import.meta.url);
if (__filename === process.argv[1]) {
    (async () => {
        try {
            // .env 파일 로드
            dotenv.config();

            // 설정 로드
            const config = loadConfig('./auto-fix-config.json');

            // 로그 수집
            const collector = new GrafanaLogCollector(config);
            const errors = await collector.collectErrors();

            // 통계 출력
            collector.printErrorStats(errors);

            // JSON 출력 (다른 스크립트에서 사용 가능)
            if (process.argv.includes('--json')) {
                console.log('\n' + JSON.stringify(errors, null, 2));
            }

        } catch (error) {
            console.error(chalk.red('❌ 오류 발생:'), error.message);
            process.exit(1);
        }
    })();
}
