import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

/**
 * Git 작업 유틸리티
 */
export class GitUtils {
    constructor(config) {
        this.config = config;
    }

    /**
     * 변경사항 커밋
     * @param {string} file - 변경된 파일 경로
     * @param {string} message - 커밋 메시지 (접두사는 설정에서 자동 추가)
     */
    async commitChanges(file, message) {
        if (!this.config.git.autoCommit) {
            console.log(chalk.dim('   Git 커밋 스킵 (autoCommit: false)'));
            return false;
        }

        try {
            // 1. 파일 스테이징
            // 파일 경로에 상대 경로가 포함되어 있을 수 있으므로 따옴표 처리
            await execAsync(`git add "${file}"`);

            // 2. 커밋
            const prefix = this.config.git.commitPrefix || 'fix(auto): ';
            const fullMessage = `${prefix}${message}`;
            // 따옴표 이스케이프
            const escapedMessage = fullMessage.replace(/"/g, '\\"');

            await execAsync(`git commit -m "${escapedMessage}"`);

            console.log(chalk.green(`   ✓ Git 커밋 완료: ${fullMessage}`));

            // 3. 푸시 (옵션)
            if (this.config.git.pushToRemote) {
                const branch = this.config.git.branch || 'HEAD';
                console.log(chalk.dim(`   원격 저장소(${branch})로 푸시 중...`));
                await execAsync(`git push origin ${branch}`);
                console.log(chalk.green('   ✓ 푸시 완료'));
            }

            return true;
        } catch (error) {
            console.error(chalk.red('   ❌ Git 커밋 실패:'), error.message);
            // 커밋 실패 시에도 계속 진행
            return false;
        }
    }
}
