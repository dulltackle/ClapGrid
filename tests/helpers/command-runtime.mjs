import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const { processIdentity, ownerAlive, rememberDescendants } = await import(new URL('./product-process.mjs', import.meta.url).href);
/** 本例 CLI/媒体命令；仅对登记了出生身份的进程执行终止，退出后才释放输入目录。 */
export function command(file, args, options = {}) {
    const { input, timeout = 10000, signal, encoding = 'utf8', maxBuffer = 32 * 1024 * 1024, ...spawnOptions } = options;
    signal?.throwIfAborted();
    const observationDirectory = mkdtempSync(join(tmpdir(), 'clapgrid-command-owners-'));
    const observationFile = join(observationDirectory, 'owners.jsonl');
    writeFileSync(observationFile, '', { mode: 0o600 });
    const env = { ...(spawnOptions.env ?? process.env) };
    const ancestors = JSON.parse(env.CLAPGRID_TEST_PROCESS_OWNERS ?? '[]');
    env.CLAPGRID_TEST_PROCESS_OWNERS = JSON.stringify([...ancestors, observationFile]);
    const observer = fileURLToPath(new URL('./observe-product-processes.mjs', import.meta.url));
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${observer}`.trim();
    const child = spawn(file, args, { ...spawnOptions, env, detached: process.platform === 'linux', stdio: ['pipe', 'pipe', 'pipe'] });
    const owner = child.pid ? processIdentity(child.pid) : null;
    const owners = new Map();
    if (owner)
        owners.set(owner.pid, owner);
    const same = (a, b) => a?.pid === b?.pid && a?.start === b?.start && a?.boot === b?.boot && a?.pidNamespace === b?.pidNamespace;
    const observeOwners = () => {
        // 记录由本次创建路径产生；只接受可追溯到原命令出生身份的亲子链。
        const entries = readFileSync(observationFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        for (let pass = 0; pass <= entries.length; pass++) {
            let added = false;
            for (const entry of entries)
                if (!owners.has(entry.child.pid) && same(owners.get(entry.parent.pid), entry.parent)) {
                    owners.set(entry.child.pid, entry.child);
                    added = true;
                }
            if (!added)
                break;
        }
        rememberDescendants(owners);
    };
    const observe = setInterval(() => {
        try {
            observeOwners();
        }
        catch (error) {
            cancel(Error(`无法核对命令 ${file} 的进程出生身份`, { cause: error }));
        }
    }, 10);
    let stdout = '', stderr = '';
    child.stdout.setEncoding(encoding);
    child.stderr.setEncoding(encoding);
    child.stdout.on('data', text => { stdout += text; if (stdout.length > maxBuffer)
        cancel(Error(`命令 ${file} stdout 超过 ${maxBuffer} 字节`)); });
    child.stderr.on('data', text => { stderr += text; if (stderr.length > maxBuffer)
        cancel(Error(`命令 ${file} stderr 超过 ${maxBuffer} 字节`)); });
    child.stdin.on('error', () => { });
    if (input !== null)
        child.stdin.end(input);
    let failure;
    let exited = false;
    const closed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (status, signal) => { exited = true; resolve({ status, signal }); });
    });
    // 捕获拒绝处理先于取消，避免异常测试出现未处理 rejection。
    void closed.catch(() => { });
    let stopping;
    const stop = () => stopping ??= (async () => {
        observeOwners();
        if (exited && [...owners.values()].every(identity => ownerAlive(identity) === false)) {
            rmSync(observationDirectory, { recursive: true, force: true });
            return;
        }
        const send = (signal) => {
            for (const identity of [...owners.values()].reverse()) {
                const alive = ownerAlive(identity);
                if (alive === null)
                    throw Error(`命令 ${file} 子进程 ${identity.pid} 身份不明，保留输入目录；拥有权证据 ${observationDirectory}`);
                if (alive === false)
                    continue;
                try {
                    process.kill(identity.pid, signal);
                }
                catch (error) {
                    if (error.code !== 'ESRCH')
                        throw error;
                }
            }
        };
        send('SIGTERM');
        await delay(200);
        observeOwners();
        send('SIGKILL');
        const until = Date.now() + 1500;
        while (!exited || [...owners.values()].some(identity => ownerAlive(identity) !== false)) {
            if (Date.now() >= until)
                throw Error(`命令 ${file} 未确认退出；PID=${[...owners.keys()]}，保留输入目录；拥有权证据 ${observationDirectory}`);
            await delay(10);
        }
        rmSync(observationDirectory, { recursive: true, force: true });
    })();
    let rejectStop;
    const stopFailure = new Promise((_, reject) => { rejectStop = reject; });
    const cancel = (error) => { failure ??= error instanceof Error ? error : Error(`命令 ${file} ${args.join(' ')} 已取消`, { cause: signal?.reason }); void stop().catch(rejectStop); };
    const aborted = () => cancel();
    signal?.addEventListener('abort', aborted, { once: true });
    const timer = setTimeout(() => { failure ??= Error(`命令超时（${timeout}ms）：${file} ${args.join(' ')}`); void stop().catch(rejectStop); }, timeout);
    let exitTimer;
    const exitLimit = new Promise((_, reject) => { exitTimer = setTimeout(() => reject(Error(`命令未退出：${file}，PID=${child.pid}，保留输入目录；拥有权证据 ${observationDirectory}`)), timeout + 2500); });
    const promise = (async () => {
        try {
            const result = await Promise.race([closed, exitLimit, stopFailure]);
            if (stopping)
                await stopping;
            if (failure)
                throw Object.assign(failure, { stdout, stderr, ...result });
            return { ...result, stdout, stderr, error: undefined };
        }
        catch (error) {
            if (failure && error !== failure)
                throw Object.assign(new AggregateError([failure, error], `命令执行与清理失败：${failure.message}；${String(error)}`), { stdout, stderr, pid: child.pid, observationDirectory });
            throw error;
        }
        finally {
            clearTimeout(timer);
            clearTimeout(exitTimer);
            clearInterval(observe);
            signal?.removeEventListener('abort', aborted);
        }
    })();
    return Object.assign(promise, { child, stop, remainingProcesses: () => { observeOwners(); return [...owners.values()].filter(identity => ownerAlive(identity) !== false); } });
}
export async function execCommand(file, args, options = {}) {
    const run = command(file, args, options);
    let primary;
    try {
        const result = await run;
        if (result.status !== 0)
            throw Object.assign(Error(`${file} 退出 ${result.status}: ${result.stderr}`), result);
        return result;
    }
    catch (error) {
        primary = error;
        throw error;
    }
    finally {
        try {
            await run.stop();
        }
        catch (cleanup) {
            if (primary instanceof AggregateError && primary.errors.includes(cleanup))
                throw primary;
            if (primary && primary !== cleanup)
                throw Object.assign(new AggregateError([primary, cleanup], `命令失败且退出未确认：${file}`), { cause: primary, stdout: primary.stdout, stderr: primary.stderr, pid: run.child.pid });
            throw cleanup;
        }
    }
}
