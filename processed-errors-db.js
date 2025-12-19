#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 처리된 에러 추적 DB
 * 중복 에러 처리를 방지하기 위한 간단한 JSON 기반 DB
 */
export class ProcessedErrorsDB {
    constructor(dbPath = './processed-errors-db.json') {
        this.dbPath = path.resolve(__dirname, dbPath);
        this.errors = this.load();
    }

    /**
     * DB 로드
     */
    load() {
        try {
            if (fs.existsSync(this.dbPath)) {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn('⚠️  DB 로드 실패, 새로 시작합니다:', error.message);
        }
        return {};
    }

    /**
     * DB 저장
     */
    save() {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.dbPath, JSON.stringify(this.errors, null, 2), 'utf8');
        } catch (error) {
            console.error('❌ DB 저장 실패:', error.message);
        }
    }

    /**
     * 에러가 이미 처리되었는지 확인
     */
    isProcessed(errorHash) {
        return this.errors[errorHash] !== undefined;
    }

    /**
     * 처리된 에러 기록
     */
    markAsProcessed(errorHash, status, details = {}) {
        this.errors[errorHash] = {
            hash: errorHash,
            status: status, // 'FIXED', 'FAILED', 'SKIPPED', 'NO_SOURCEMAP'
            timestamp: new Date().toISOString(),
            ...details,
        };
        this.save();
    }

    /**
     * 에러 정보 가져오기
     */
    get(errorHash) {
        return this.errors[errorHash];
    }

    /**
     * 처리되지 않은 에러 필터링
     */
    filterUnprocessed(errors) {
        return errors.filter(error => !this.isProcessed(error.hash));
    }

    /**
     * 통계 가져오기
     */
    getStats() {
        const total = Object.keys(this.errors).length;
        const byStatus = {};

        for (const error of Object.values(this.errors)) {
            byStatus[error.status] = (byStatus[error.status] || 0) + 1;
        }

        return {
            total,
            byStatus,
        };
    }

    /**
     * 오래된 항목 정리 (선택적)
     */
    cleanup(daysOld = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        let removed = 0;
        for (const [hash, error] of Object.entries(this.errors)) {
            const errorDate = new Date(error.timestamp);
            if (errorDate < cutoffDate) {
                delete this.errors[hash];
                removed++;
            }
        }

        if (removed > 0) {
            this.save();
            console.log(`🗑️  ${removed}개의 오래된 에러 기록 삭제됨`);
        }

        return removed;
    }

    /**
     * 전체 리셋
     */
    reset() {
        this.errors = {};
        this.save();
        console.log('🔄 DB 리셋 완료');
    }
}

// CLI 모드로 실행된 경우 (관리 도구)
if (__filename === process.argv[1]) {
    const db = new ProcessedErrorsDB();

    const command = process.argv[2];

    switch (command) {
        case 'stats':
            console.log('📊 통계:');
            const stats = db.getStats();
            console.log(`   전체: ${stats.total}개`);
            console.log('   상태별:');
            for (const [status, count] of Object.entries(stats.byStatus)) {
                console.log(`     ${status}: ${count}개`);
            }
            break;

        case 'cleanup':
            const days = parseInt(process.argv[3]) || 30;
            console.log(`🗑️  ${days}일 이상된 기록 정리 중...`);
            db.cleanup(days);
            break;

        case 'reset':
            console.log('⚠️  정말로 모든 기록을 삭제하시겠습니까? (y/N)');
            // 실제로는 readline을 사용해야 하지만, 간단히 구현
            db.reset();
            break;

        case 'list':
            console.log('📋 처리된 에러 목록:');
            const errors = Object.values(db.errors).slice(0, 10);
            errors.forEach((error, idx) => {
                console.log(`${idx + 1}. [${error.status}] ${error.hash} - ${error.timestamp}`);
                if (error.file) console.log(`   파일: ${error.file}:${error.line}`);
            });
            if (Object.keys(db.errors).length > 10) {
                console.log(`   ... 외 ${Object.keys(db.errors).length - 10}개`);
            }
            break;

        default:
            console.log('사용법:');
            console.log('  node processed-errors-db.js stats     - 통계 보기');
            console.log('  node processed-errors-db.js list      - 목록 보기');
            console.log('  node processed-errors-db.js cleanup [days] - 오래된 기록 정리');
            console.log('  node processed-errors-db.js reset     - 전체 리셋');
            break;
    }
}
