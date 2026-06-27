/** Environment recon (bash `doctor`): which role CLIs + backends are present, and the recommended workflow. */
export interface RoleStatus {
  readonly cli: string;
  readonly present: boolean;
}
export interface BackendStatus {
  readonly launcher: string;
  readonly installed: boolean;
  readonly keyConfigured: boolean;
}
export interface DoctorReport {
  readonly roles: readonly RoleStatus[];
  readonly backends: readonly BackendStatus[];
}

export const readyBackends = (report: DoctorReport): number =>
  report.backends.filter((b) => b.installed && b.keyConfigured).length;

const hasRole = (report: DoctorReport, cli: string): boolean =>
  report.roles.find((r) => r.cli === cli)?.present ?? false;

const liteHarnesses = (report: DoctorReport): readonly string[] => {
  const harnesses: string[] = [];
  if (hasRole(report, 'codex')) harnesses.push('codex');
  if (hasRole(report, 'opencode')) harnesses.push('opencode');
  if (hasRole(report, 'agy')) harnesses.push('agy');
  return harnesses;
};

/** Recommended workflow given what's installed (pure port of the bash advisor). */
export const recommend = (report: DoctorReport): readonly string[] => {
  const recs: string[] = [];
  const ready = readyBackends(report);
  const fugueCc = hasRole(report, 'fugue-cc');
  const codex = hasRole(report, 'codex');
  const lite = liteHarnesses(report);
  const litePreflight = lite.map((harness) => `fuguectl preflight --harness ${harness}`);

  if (fugueCc && ready >= 2 && codex) {
    recs.push(
      'full fleet workflow: fugue-cc fleet → backends implement in parallel → Codex reviews → bounded loop',
    );
  } else if (lite.length > 0) {
    recs.push(
      `lite harness workflow: ${litePreflight.join(' / ')} → dispatch on a passed harness; add fugue-cc only for isolated worktree fleets`,
    );
  } else if (ready >= 1 && !fugueCc) {
    recs.push(
      'single-machine lite: dispatch via the /cn:* plugin (no auto review loop); install the fugue-cc provider for the full fleet workflow',
    );
  } else if (ready >= 1) {
    recs.push('half setup: dispatch manually as needed');
  } else {
    recs.push(
      'no ready backend yet: install launchers + configure keys in ~/.config/cc-model-secrets.env',
    );
  }

  if (!codex) {
    recs.push('no Codex (reviewer): use another strong independent backend as reviewer');
  }
  if (!hasRole(report, 'claude')) {
    recs.push('no claude (executor): install @anthropic-ai/claude-code first');
  }
  return recs;
};
