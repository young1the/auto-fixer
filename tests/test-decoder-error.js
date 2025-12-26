
import { StackTraceDecoder } from '../src/core/decoder-wrapper.js';
import { createConfig } from '../src/config/index.js';
import chalk from 'chalk';

console.log(chalk.cyan('🧪 Decoder Error Logging Test'));

const config = createConfig();
// Debug 모드 활성화
config.decoder.debug = true;

const decoder = new StackTraceDecoder(config);

// 존재하지 않는 파일에 대한 스택 트레이스 테스트
const fakeStackTrace = `Error: Test Error
    at testFunction (https://example.com/static/js/NonExistentFile-123.js:1:100)`;

console.log(chalk.yellow('\nTesting with non-existent file path:'));
const result = await decoder.decodeStackTrace(fakeStackTrace);

if (result && result.error) {
    console.log(chalk.green('✅ Caught expected error:'));
    console.log(`Error Code: ${result.error}`);
    console.log(`Message: ${result.message}`);
    if (result.searchPath) {
        console.log(`Search Path: ${result.searchPath}`);
    }
} else {
    console.log(chalk.red('❌ Failed to get error object'));
    console.log(result);
}
