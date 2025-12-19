#!/usr/bin/env node
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

/**
 * 설정 생성 함수
 * .env 파일에서 민감 정보를 불러오고 기본값과 병합합니다.
 */
export function createConfig() {
    return {
        grafana: {
            url: process.env.GRAFANA_URL || '',
            apiKey: process.env.GRAFANA_API_KEY || '',
            datasourceUid: process.env.GRAFANA_DATASOURCE_UID || '',
            queryInterval: parseInt(process.env.GRAFANA_QUERY_INTERVAL) || 60000,
            lookbackWindow: process.env.GRAFANA_LOOKBACK_WINDOW || 'now-1h',
            logQuery: process.env.GRAFANA_LOG_QUERY || '{job="frontend"}',
            maxResults: parseInt(process.env.GRAFANA_MAX_RESULTS) || 100,
        },

        decoder: {
            sourceMapDir: process.env.SOURCE_MAP_DIR || './workspace/target/static/js',
            contextLines: parseInt(process.env.DECODER_CONTEXT_LINES) || 10,
            ide: process.env.DECODER_IDE || 'intellij',
            debug: process.env.DECODER_DEBUG === 'true' || false,
        },

        claudeCode: {
            cliPath: process.env.CLAUDE_CODE_PATH || 'claude',
            workingDir: process.env.WORKING_DIR || './workspace',
            timeout: parseInt(process.env.CLAUDE_CODE_TIMEOUT) || 300000,
            maxRetries: parseInt(process.env.CLAUDE_CODE_MAX_RETRIES) || 3,
        },

        git: {
            autoCommit: process.env.GIT_AUTO_COMMIT !== 'false', // 기본값 true
            branch: process.env.GIT_BRANCH || 'auto-fix/errors',
            createPR: process.env.GIT_CREATE_PR === 'true' || false,
            commitPrefix: process.env.GIT_COMMIT_PREFIX || 'fix(auto): ',
            pushToRemote: process.env.GIT_PUSH_TO_REMOTE === 'true' || false,
        },

        limits: {
            maxFixesPerRun: parseInt(process.env.MAX_FIXES_PER_RUN) || 10,
            minIntervalBetweenFixes: parseInt(process.env.MIN_INTERVAL_BETWEEN_FIXES) || 5000,
            maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
            timeoutPerFix: parseInt(process.env.TIMEOUT_PER_FIX) || 300000,
        },

        filters: {
            ignorePatterns: process.env.IGNORE_PATTERNS
                ? process.env.IGNORE_PATTERNS.split(',').map(p => p.trim())
                : [
                    'node_modules/',
                    'vendor/',
                    'test/',
                    '**/*.test.js',
                    '**/*.spec.js',
                ],
            minOccurrences: parseInt(process.env.MIN_OCCURRENCES) || 1,
            timeWindow: process.env.TIME_WINDOW || '1h',
            errorTypes: process.env.ERROR_TYPES
                ? process.env.ERROR_TYPES.split(',').map(t => t.trim())
                : [
                    'TypeError',
                    'ReferenceError',
                    'RangeError',
                    'SyntaxError',
                ],
        },

        features: {
            dryRun: process.env.DRY_RUN === 'true' || false,
            manualApproval: process.env.MANUAL_APPROVAL === 'true' || false,
            enableSlackNotifications: process.env.ENABLE_SLACK_NOTIFICATIONS === 'true' || false,
            saveMetrics: process.env.SAVE_METRICS !== 'false', // 기본값 true
        },

        slack: {
            webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
            channel: process.env.SLACK_CHANNEL || '#auto-fix-alerts',
            username: process.env.SLACK_USERNAME || 'Auto-Fix Bot',
        },

        paths: {
            processedErrorsDb: process.env.PROCESSED_ERRORS_DB || './.auto-fix-data/processed-errors-db.json',
            metricsFile: process.env.METRICS_FILE || './.auto-fix-data/metrics.json',
            logFile: process.env.LOG_FILE || './.auto-fix-data/logs/auto-fix.log',
        },
    };
}

/**
 * stack-trace-config 생성 함수
 */
export function createStackTraceConfig() {
    return {
        sourceMapDir: process.env.SOURCE_MAP_DIR || './workspace/target/static/js',
        sourceMapPattern: process.env.SOURCE_MAP_PATTERN || '*.js.map',
        contextLines: parseInt(process.env.STACK_TRACE_CONTEXT_LINES) || 5,
        ide: process.env.STACK_TRACE_IDE || 'intellij',
        debug: process.env.STACK_TRACE_DEBUG === 'true' || false,
    };
}

/**
 * 설정 검증 함수
 */
export function validateConfig(config) {
    const errors = [];

    // 필수 Grafana 설정 확인
    if (!config.grafana.url) {
        errors.push('GRAFANA_URL is required');
    }
    if (!config.grafana.apiKey) {
        errors.push('GRAFANA_API_KEY is required');
    }
    if (!config.grafana.datasourceUid) {
        errors.push('GRAFANA_DATASOURCE_UID is required');
    }

    // 필수 경로 설정 확인
    if (!config.decoder.sourceMapDir) {
        errors.push('SOURCE_MAP_DIR is required');
    }
    if (!config.claudeCode.workingDir) {
        errors.push('WORKING_DIR is required');
    }

    // Slack 알림이 활성화된 경우 webhook URL 확인
    if (config.features.enableSlackNotifications && !config.slack.webhookUrl) {
        errors.push('SLACK_WEBHOOK_URL is required when Slack notifications are enabled');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
    }

    return true;
}

// CLI로 실행된 경우 설정 출력
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    const config = createConfig();
    console.log('📋 Current Configuration:');
    console.log(JSON.stringify(config, null, 2));

    console.log('\n✅ Validating configuration...');
    try {
        validateConfig(config);
        console.log('✅ Configuration is valid!');
    } catch (error) {
        console.error('❌ Configuration validation failed:');
        console.error(error.message);
        process.exit(1);
    }
}
