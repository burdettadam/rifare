import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from '../development/config.mts';

export type PilotHead = { sequence: number; sha256: string };
export type PilotReference = { version: 1; directory: string; registration_sha256: string; head: PilotHead };
export type PilotRegistration = {
  version: 1; directory: string; manifest: { path: string; sha256: string }; benchmark_sha256: string;
  source: { commit: string; tree: string; artifact_sha256: string };
  configurations: { stratum_id: string; materials: Record<'profile' | 'skill' | 'policy' | 'runtime' | 'model' | 'adapter', string> }[];
  authority_refs: { owner_ref: string; consent_ref: string; privacy_review_ref: string; retention_ref: string };
};
export type PilotEvent = { id: string; kind: 'observation' | 'adjudication' | 'followup' | 'reopen' | 'cost' | 'cost_adjustment' | 'exception';
  case_id: string; evidence_ref: string; evidence_sha256: string; happened_at: string; payload: Record<string, unknown> };
export type PilotReadinessRequest = { version: 1; register: { path: string; sha256: string }; protocols: PilotReference[]; assessed_at: string };
export type PilotMode = 'register' | 'append' | 'project' | 'readiness';
const DRIVER = fileURLToPath(new URL('./protocol.py', import.meta.url));

/** Caller-owned local artifacts only. Hash identity does not authenticate evidence or authority. */
export function runPilotProtocol(mode: PilotMode, raw: string): any {
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('PILOT_INPUT_LIMIT');
  const child = spawnSync('python3', ['-B', DRIVER, mode], { input: raw, encoding: 'utf8', timeout: 15000,
    maxBuffer: 20 * 1024 * 1024, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
  if (child.error || child.signal || child.status === null) throw new Error('PILOT_PROCESS_FAILED');
  let result: any;
  try { result = JSON.parse(child.stdout); } catch { throw new Error('PILOT_REPORT_INVALID'); }
  if (![0, 1].includes(child.status) || result.pilot_authorized !== false || result.verified_live_observations !== 0)
    throw new Error('PILOT_REPORT_INVALID');
  if (result.ok !== true) throw new Error(result.error || 'PILOT_INPUT_INVALID');
  return result;
}
export const registerPilot = (request: PilotRegistration): any => runPilotProtocol('register', JSON.stringify(request));
export const appendPilotEvents = (request: PilotReference & { events: PilotEvent[] }): any => runPilotProtocol('append', JSON.stringify(request));
export const projectPilot = (request: PilotReference): any => runPilotProtocol('project', JSON.stringify(request));
export const assessPilotReadiness = (request: PilotReadinessRequest): any => runPilotProtocol('readiness', JSON.stringify(request));
