/** Linux process ownership for fixed served-browser tests. Not a browser substitute. */
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export interface CheckoutBrowserGuardResult {
  protocol: 1;
  guardian_pid: number;
  worker_pid: number | null;
  worker_exit_code: number | null;
  reason: 'worker_exit' | 'parent_eof' | 'deadline' | 'setup_error';
  cleanup_complete: boolean;
}
export interface CheckoutBrowserRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputOverflow: boolean;
  guard: CheckoutBrowserGuardResult | null;
}
const guardian = fileURLToPath(new URL('../browser/checkout_review_process.py', import.meta.url));
const outputLimit = 16384;

function run(mode: 'browser' | 'probe-normal' | 'probe-hold', input: unknown, timeoutMs: number,
  onOutput?: (chunk: string) => void): Promise<CheckoutBrowserRun> {
  if (process.platform !== 'linux') throw new Error('CHECKOUT_BROWSER_REQUIRES_LINUX_PROCESS_GUARD');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000)
    throw new Error('INVALID_CHECKOUT_BROWSER_BUDGET');
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH,
      RIFARE_BROWSER_EXECUTABLE: process.env.RIFARE_BROWSER_EXECUTABLE ?? '/usr/bin/chromium',
      RIFARE_TEST_INPUT: JSON.stringify(input) };
    const child = spawn('python3', ['-I', '-S', guardian, mode], {
      env, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', metadata = '', outputBytes = 0, metadataBytes = 0;
    let timedOut = false, outputOverflow = false, callbackFailed = false, callbackError: unknown;
    // Do not kill the guardian. Closing this parent-owned pipe starts its bounded
    // descendant cleanup, including when the outer runner kills the whole Node group.
    const stopOwned = () => child.stdin.end();
    child.stdin.on('error', () => { /* An already exited guardian needs no further signal. */ });
    const timer = setTimeout(() => { timedOut = true; stopOwned(); }, timeoutMs);
    const collect = (stream: 'stdout' | 'stderr', bytes: Buffer) => {
      const remaining = Math.max(0, outputLimit - outputBytes);
      outputBytes += bytes.length;
      const chunk = bytes.subarray(0, remaining).toString('utf8');
      if (stream === 'stdout') {
        stdout += chunk;
        try { if (chunk) onOutput?.(chunk); }
        catch (error) { callbackFailed = true; callbackError = error; stopOwned(); }
      } else stderr += chunk;
      if (outputBytes > outputLimit) { outputOverflow = true; stopOwned(); }
    };
    child.stdout.on('data', (bytes: Buffer) => collect('stdout', bytes));
    child.stderr.on('data', (bytes: Buffer) => collect('stderr', bytes));
    (child.stdio[3] as Readable).on('data', (bytes: Buffer) => {
      const remaining = Math.max(0, 4096 - metadataBytes);
      metadataBytes += bytes.length;
      metadata += bytes.subarray(0, remaining).toString('utf8');
      if (metadataBytes > 4096) { outputOverflow = true; stopOwned(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      let guard: CheckoutBrowserGuardResult | null = null;
      try {
        const value = JSON.parse(metadata);
        if (value.protocol === 1 && value.guardian_pid === child.pid &&
          (value.worker_pid === null || Number.isSafeInteger(value.worker_pid) && value.worker_pid > 1) &&
          (value.worker_exit_code === null || Number.isSafeInteger(value.worker_exit_code)) &&
          ['worker_exit', 'parent_eof', 'deadline', 'setup_error'].includes(value.reason) &&
          typeof value.cleanup_complete === 'boolean') guard = value;
      } catch { /* Missing/invalid metadata fails the caller's required cleanup assertion. */ }
      if (callbackFailed) reject(callbackError);
      else resolve({ code, signal, stdout, stderr, timedOut, outputOverflow, guard });
    });
  });
}

export function runCheckoutBrowser(input: {
  scenario: string; url: string; bearer: string; original: unknown;
}): Promise<CheckoutBrowserRun> {
  return run('browser', input, 15000);
}

export function runCheckoutBrowserProbe(mode: 'normal' | 'hold', options: {
  timeoutMs?: number; onOutput?: (chunk: string) => void;
} = {}): Promise<CheckoutBrowserRun> {
  if (mode !== 'normal' && mode !== 'hold') throw new Error('INVALID_CHECKOUT_BROWSER_PROBE');
  return run(mode === 'normal' ? 'probe-normal' : 'probe-hold', null, options.timeoutMs ?? 15000, options.onOutput);
}
