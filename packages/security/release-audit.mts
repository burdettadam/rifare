import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from '../development/config.mts';

export type PinnedAuditInput = { path: string; sha256: string };
export type ReleaseAuditRequest = {
  version: 1;
  source_root: string;
  artifact_root: string;
  expected_source: { commit: string; tree: string };
  expected_artifact_sha256: string;
  reviewed_sbom?: PinnedAuditInput;
  scan_evidence?: PinnedAuditInput[];
};
const DRIVER = fileURLToPath(new URL('./release-audit.py', import.meta.url));

/** Offline observation only. The retained distribution checker and all release blocks remain mandatory. */
export function auditRelease(request: ReleaseAuditRequest): any {
  return runReleaseAudit('audit', JSON.stringify(request));
}

/** Strict JSON parsing is performed by the same Python driver, including duplicate-key rejection. */
export function runReleaseAudit(mode: 'audit' | 'inventory', input: string): any {
  const child = spawnSync('python3', ['-B', DRIVER, mode], {
    input, encoding: 'utf8', timeout: 20000, maxBuffer: 24 * 1024 * 1024,
    env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (child.error || child.signal || child.status === null) throw new Error('RELEASE_AUDIT_PROCESS_FAILED');
  let result: any;
  try { result = JSON.parse(child.stdout); } catch { throw new Error('RELEASE_AUDIT_REPORT_INVALID'); }
  if (![0, 1].includes(child.status) || result.release_authorized !== false) throw new Error('RELEASE_AUDIT_REPORT_INVALID');
  return result;
}
