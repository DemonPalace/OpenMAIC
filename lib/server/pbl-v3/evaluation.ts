import 'server-only';
import { sandboxConflict } from '@/lib/sandbox/errors';
import type { InstalledProject } from './catalog';

export interface ProjectEvaluation {
  /** Deployment-owned argv, not user-provided shell text. */
  prepare?: string[];
  cases: { id: string; argv: string[]; stdout: string; stdin?: string }[];
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function evaluationFor(project: InstalledProject, milestone: string) {
  const spec = project.evaluations[milestone];
  if (!spec?.cases.length) throw sandboxConflict('No evaluation is installed for this milestone.');
  return spec;
}
/** The parent checks actual child output. A learner process exiting zero before executing a check cannot pass.
 * This is learning feedback, not a hostile-code grading boundary: parent and child share the sandbox identity.
 */
export function evaluationCommand(spec: ProjectEvaluation, requestId: string) {
  const payload = Buffer.from(JSON.stringify({ spec, requestId })).toString('base64');
  const script = `import base64,json,subprocess,tempfile,os
cfg=json.loads(base64.b64decode(${JSON.stringify(payload)}))
spec=cfg['spec']; results=[]; build=True
with tempfile.TemporaryDirectory(prefix='pbl-check-') as out:
 def run(argv,stdin=''):
  return subprocess.run([a.replace('{build}',out) for a in argv],input=stdin,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
 try:
  if spec.get('prepare'): build=run(spec['prepare']).returncode==0
  for case in spec['cases']:
   passed=False
   if build:
    try:
     proc=run(case['argv'],case.get('stdin',''))
     passed=proc.returncode==0 and proc.stdout==case['stdout']
    except (subprocess.TimeoutExpired,OSError): pass
   results.append({'id':case['id'],'passed':passed})
 except (subprocess.TimeoutExpired,OSError): build=False
print(str(sum(r['passed'] for r in results))+' / '+str(len(spec['cases']))+' checks passed')
if not build: print('Build failed or could not complete. Run the build check for diagnostics.')
for r in results: print(r['id']+(': passed' if r['passed'] else ': did not satisfy the project contract'))
print('PBL_RESULT:'+cfg['requestId']+':'+json.dumps({'build':build,'checks':results},separators=(',',':')))
`;
  return `python3 -c ${quote(script)}`;
}
export function evaluationPassed(spec: ProjectEvaluation, id: string, output: string): boolean {
  const prefix = `PBL_RESULT:${id}:`;
  const lines = output.split('\n').filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) return false;
  try {
    const result = JSON.parse(lines[0]!.slice(prefix.length));
    return (
      result.build === true &&
      Array.isArray(result.checks) &&
      result.checks.length === spec.cases.length &&
      spec.cases.every((c, i) => result.checks[i]?.id === c.id && result.checks[i]?.passed === true)
    );
  } catch {
    return false;
  }
}
