#!/usr/bin/env node
import React, { useState, useEffect } from 'react';
import { render, Text, Box, useInput } from 'ink';
import { SourceMapConsumer } from 'source-map';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

// Stack trace 파싱 함수
function parseStackTrace(stackTrace) {
    const lines = stackTrace.split('\n');
    const parsed = [];

    // 정규식: URL과 line:column 추출
    const regex = /https?:\/\/[^\s]+\/([^:]+):(\d+):(\d+)/g;

    for (const line of lines) {
        const matches = [...line.matchAll(regex)];
        for (const match of matches) {
            parsed.push({
                original: line.trim(),
                file: match[1],
                line: parseInt(match[2]),
                column: parseInt(match[3]),
            });
        }
    }

    return parsed;
}

// Source map 로드 함수
async function loadSourceMap(sourceMapPath) {
    try {
        const rawSourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
        return await new SourceMapConsumer(rawSourceMap);
    } catch (error) {
        throw new Error(`Failed to load source map: ${error.message}`);
    }
}

// Source map에서 원본 위치 찾기
function getOriginalPosition(consumer, line, column) {
    const pos = consumer.originalPositionFor({
        line: line,
        column: column,
    });

    if (pos.source === null) {
        return null;
    }

    return {
        source: pos.source,
        line: pos.line,
        column: pos.column,
        name: pos.name,
    };
}

// 원본 소스 코드 읽기
function getSourceContent(consumer, sourcePath, line, contextLines = 3) {
    try {
        const content = consumer.sourceContentFor(sourcePath);
        if (!content) return null;

        const lines = content.split('\n');
        const start = Math.max(0, line - contextLines - 1);
        const end = Math.min(lines.length, line + contextLines);

        const snippet = [];
        for (let i = start; i < end; i++) {
            const lineNum = i + 1;
            const isTargetLine = lineNum === line;
            snippet.push({
                lineNum,
                content: lines[i],
                isTarget: isTargetLine,
            });
        }

        return snippet;
    } catch (error) {
        return null;
    }
}

// Main App Component
const StackTraceDecoder = () => {
    const [mode, setMode] = useState('input'); // 'input', 'processing', 'result'
    const [input, setInput] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [config, setConfig] = useState(null);

    useEffect(() => {
        // config.json 로드
        const configPath = path.join(process.cwd(), 'stack-trace-config.json');
        if (fs.existsSync(configPath)) {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            setConfig(configData);
        } else {
            setConfig({
                sourceMapDir: './dist',
                sourceMapPattern: '*.js.map',
            });
        }
    }, []);

    const processStackTrace = async (stackTrace) => {
        setMode('processing');

        try {
            const parsed = parseStackTrace(stackTrace);

            if (parsed.length === 0) {
                throw new Error('No stack trace entries found');
            }

            const results = [];

            for (const entry of parsed) {
                // Source map 파일 찾기
                const sourceMapPath = path.join(
                    process.cwd(),
                    config.sourceMapDir,
                    `${entry.file}.map`
                );

                if (!fs.existsSync(sourceMapPath)) {
                    results.push({
                        ...entry,
                        error: `Source map not found: ${sourceMapPath}`,
                    });
                    continue;
                }

                const consumer = await loadSourceMap(sourceMapPath);
                const original = getOriginalPosition(consumer, entry.line, entry.column);

                if (original) {
                    const sourceCode = getSourceContent(consumer, original.source, original.line);
                    results.push({
                        ...entry,
                        original,
                        sourceCode,
                    });
                } else {
                    results.push({
                        ...entry,
                        error: 'Could not map to original source',
                    });
                }

                consumer.destroy();
            }

            setResult(results);
            setMode('result');
        } catch (err) {
            setError(err.message);
            setMode('input');
        }
    };

    useInput((input, key) => {
        if (mode === 'input') {
            if (key.return && input === '') {
                // 빈 줄 입력 시 처리 시작
                if (stackTraceBuffer.trim()) {
                    processStackTrace(stackTraceBuffer);
                    stackTraceBuffer = '';
                }
            } else if (key.ctrl && input === 'c') {
                process.exit(0);
            }
        } else if (mode === 'result') {
            if (input === 'q' || (key.ctrl && input === 'c')) {
                process.exit(0);
            } else if (input === 'r') {
                setMode('input');
                setResult(null);
                setError(null);
            }
        }
    });

    if (!config) {
        return <Text>Loading configuration...</Text>;
    }

    if (mode === 'input') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">🔍 Stack Trace Decoder</Text>
                <Text dimColor>Paste your minified stack trace below (press Enter twice to process):</Text>
                <Text> </Text>
                {error && (
                    <Box>
                        <Text color="red">❌ Error: {error}</Text>
                        <Text> </Text>
                    </Box>
                )}
                <Text dimColor>Config: {config.sourceMapDir}</Text>
                <Text dimColor>Press Ctrl+C to exit</Text>
            </Box>
        );
    }

    if (mode === 'processing') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text color="yellow">⏳ Processing stack trace...</Text>
            </Box>
        );
    }

    if (mode === 'result' && result) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="green">✓ Decoded Stack Trace</Text>
                <Text> </Text>

                {result.map((entry, idx) => (
                    <Box key={idx} flexDirection="column" marginBottom={1}>
                        <Text dimColor>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>

                        {entry.error ? (
                            <Box flexDirection="column">
                                <Text color="red">❌ {entry.original}</Text>
                                <Text color="yellow">   {entry.error}</Text>
                            </Box>
                        ) : (
                            <Box flexDirection="column">
                                <Text color="cyan">📍 Original Location:</Text>
                                <Text>   File: <Text color="green">{entry.original.source}</Text></Text>
                                <Text>   Line: <Text color="yellow">{entry.original.line}</Text></Text>
                                <Text>   Column: <Text color="yellow">{entry.original.column}</Text></Text>
                                {entry.original.name && (
                                    <Text>   Function: <Text color="magenta">{entry.original.name}</Text></Text>
                                )}

                                <Text> </Text>
                                <Text color="cyan">📄 Source Code:</Text>

                                {entry.sourceCode && entry.sourceCode.map((line, lineIdx) => (
                                    <Text key={lineIdx}>
                                        {line.isTarget ? (
                                            <Text>
                                                <Text color="red" bold>{'❯ '}</Text>
                                                <Text color="yellow">{String(line.lineNum).padStart(4, ' ')}</Text>
                                                <Text color="red" bold> | {line.content}</Text>
                                            </Text>
                                        ) : (
                                            <Text dimColor>
                                                {'  '}
                                                {String(line.lineNum).padStart(4, ' ')}
                                                {' | '}
                                                {line.content}
                                            </Text>
                                        )}
                                    </Text>
                                ))}

                                <Text> </Text>
                                <Text dimColor>Minified: {entry.original}</Text>
                            </Box>
                        )}
                    </Box>
                ))}

                <Text> </Text>
                <Text dimColor>Press 'r' to decode another trace, 'q' to quit</Text>
            </Box>
        );
    }

    return null;
};

// 전역 버퍼 (stdin 입력 처리용)
let stackTraceBuffer = '';

// Stdin 입력 받기
if (process.stdin.isTTY) {
    // TTY 모드
    render(<StackTraceDecoder />);
} else {
    // Pipe 모드: stdin에서 직접 읽기
    let input = '';
    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
            input += chunk;
        }
    });

    process.stdin.on('end', async () => {
        // Non-interactive 모드로 처리
        const config = {
            sourceMapDir: './dist',
        };

        const configPath = path.join(process.cwd(), 'stack-trace-config.json');
        if (fs.existsSync(configPath)) {
            Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
        }

        const parsed = parseStackTrace(input);

        for (const entry of parsed) {
            const sourceMapPath = path.join(
                process.cwd(),
                config.sourceMapDir,
                `${entry.file}.map`
            );

            if (!fs.existsSync(sourceMapPath)) {
                console.log(chalk.red(`Source map not found: ${sourceMapPath}`));
                continue;
            }

            const consumer = await loadSourceMap(sourceMapPath);
            const original = getOriginalPosition(consumer, entry.line, entry.column);

            if (original) {
                console.log(chalk.cyan('\n📍 Original Location:'));
                console.log(`   File: ${chalk.green(original.source)}`);
                console.log(`   Line: ${chalk.yellow(original.line)}`);
                console.log(`   Column: ${chalk.yellow(original.column)}`);
                if (original.name) {
                    console.log(`   Function: ${chalk.magenta(original.name)}`);
                }

                const sourceCode = getSourceContent(consumer, original.source, original.line);
                if (sourceCode) {
                    console.log(chalk.cyan('\n📄 Source Code:'));
                    sourceCode.forEach(line => {
                        if (line.isTarget) {
                            console.log(chalk.red.bold(`❯ ${String(line.lineNum).padStart(4, ' ')} | ${line.content}`));
                        } else {
                            console.log(chalk.dim(`  ${String(line.lineNum).padStart(4, ' ')} | ${line.content}`));
                        }
                    });
                }
            }

            consumer.destroy();
        }
    });
}