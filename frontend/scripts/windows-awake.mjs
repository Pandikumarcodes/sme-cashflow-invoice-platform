import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export async function holdWindowsAwake() {
  if (process.platform !== 'win32') {
    return { pid: null, active: false, release: async () => ({ exitCode: 0 }) };
  }
  const started = performance.now();
  const helper = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('./windows-awake.ps1', import.meta.url)),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  let errorOutput = '';
  const completion = new Promise((resolve) => {
    helper.once('error', () => resolve({ exitCode: null, launchError: true }));
    helper.once('close', (exitCode) => resolve({ exitCode }));
  });
  helper.stderr.on('data', (chunk) => {
    errorOutput = (errorOutput + chunk).slice(-2000);
  });
  let timer;
  const ready = new Promise((resolve, reject) => {
    helper.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('TEST_HOST_AWAKE')) resolve();
    });
    completion.then(() => reject(new Error(`Windows awake helper failed: ${errorOutput}`)));
    timer = setTimeout(() => reject(new Error('Windows awake helper startup timed out.')), 10_000);
  });
  try {
    await ready;
  } catch (error) {
    helper.stdin.destroy();
    try {
      helper.kill();
    } catch (cleanupError) {
      helper.stdout.destroy();
      helper.stderr.destroy();
      helper.unref();
      throw new AggregateError(
        [error, cleanupError],
        'Windows awake helper startup cleanup failed.',
        { cause: cleanupError },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const ownerExit = () => helper.stdin.destroy();
  process.once('exit', ownerExit);
  return {
    pid: helper.pid,
    get active() {
      return helper.exitCode === null && !helper.killed;
    },
    startupMs: performance.now() - started,
    release: async () => {
      process.removeListener('exit', ownerExit);
      helper.stdin.end();
      let releaseTimer;
      const result = await Promise.race([
        completion,
        new Promise((resolve) => {
          releaseTimer = setTimeout(() => {
            helper.stdin.destroy();
            let terminationError = false;
            try {
              helper.kill();
            } catch {
              terminationError = true;
            }
            helper.stdout.destroy();
            helper.stderr.destroy();
            helper.unref();
            resolve({ exitCode: null, timedOut: true, terminationError });
          }, 10_000);
        }),
      ]);
      clearTimeout(releaseTimer);
      return result;
    },
  };
}
