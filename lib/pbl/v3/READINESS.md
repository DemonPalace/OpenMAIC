# Course readiness checklist

This is the scope audit for the general learning experience before integrating real
course content. It separates behavior already present on the integration baseline
from the remaining changes in this PR. Passing local checks does not establish live
model quality, provider acceptance or classroom capacity.

## Teaching behavior carried forward

The earlier OpenPBL pre-decision, plan-review and implementation-review Skills are
the behavioral reference. `teaching-sections.ts` adapts their sections, while
`skills.ts`, `teaching-prompt.ts` and the existing runner tools enforce the current
host contract. Course-specific Java names, legacy file tools, process topology and
release operations are not copied.

| Step | Preserved behavior and host adaptation | Work in this PR / audit result |
| --- | --- | --- |
| Teaching | Discussion A/B/C starts proactively, introduces the current milestone, discloses one section at a time and withholds formal decision answers. | Keep the baseline opening and fresh-response gates. Help-first rules also apply to a bare “I don't know”; a conflicting instruction in section B is removed. |
| Decisions | Explain offered options and consequences; only the learner's explicit control submission records a choice. | Add explicit neutral-option rules, including no recommended/correct answer hints. A milestone with no decisions remains a normal, immediately continuable decision step. |
| Plan | Planner A/B/C/D writes and reviews the actual PLAN, retains earlier approved content in incremental mode and binds approval to the current artifact. | A specific requested edit by the Planner counts as participation. Help comes before another question. Final approval summarizes established reasons and asks for a brief fresh confirmation, without repeating the entire review. Changed plans require new review. |
| Code | Coder A/B/C/D implements the approved plan, reads real files, checks one key path and a consequential risk, and makes necessary repairs. Configured compile gates remain separate from tests. | Preserve the baseline non-repetitive review, read/hash/write tools and current-version final confirmation. Shared help-first and completed-follow-up rules also apply here. |
| Tests | Assessment controls run and automatically collect actual results. Failures can be repaired and retested; infrastructure errors are not learner errors. | Expected output stays on the server; the sandbox returns actual-output digests, exit state and bounded failure reasons. Complete, current-run results are required. No extra oral gate is added. |
| Quiz | Answers stay private before submission; failed attempts can be retried, with progress controlled by the saved result. | Preserve judging and feedback. Fix sparse answer arrays so selecting a later question cannot enable submission with earlier questions unanswered; keep unsubmitted choices on scene return/refresh. |
| Recap | Mentor reflection uses actual decisions, artifacts and observed assessments, and accepts a substantive reflection without repeating completed topics. | Final milestone's final recap completes the project through `complete_stage`; only then is the report button available. Prompt handoff and the tool use the same boundary check. |

Across all guided steps, meaningful participation is not a keyword test or fixed
number of questions. New section questions still require real new learner replies;
automatic openings, retries and assistant text do not supply them. Follow-up chat
does not reopen completed teaching, while changed evidence invalidates affected
approvals. Roles know the next step without performing another role's work or
advancing for the learner.

Implementation and regressions: `skills.ts`, `teaching-sections.ts`,
`teaching-prompt.ts`, `guided-review.ts`, `stage-progress.ts`, `runner-tools.ts`;
`tests/pbl/v3/{conversation,guided-review,stage-progress,teaching-context}.test.ts`
and the real-PG scripted-runner journeys in `runtime.pg.test.ts`.

## Complete delivery scope

| Area | Existing baseline retained | Changes / regression coverage in this PR |
| --- | --- | --- |
| Progression and tool receipts | Seven steps, validate-before-completing, real feedback, cancellation/takeover fences, mixed-tool batches, automatic openings, ordinary follow-ups and no generic-API bypass. | Keep these gates; full scripted journeys verify them with the report boundary. Do not reimplement the runner. |
| Private materials | Owner and role-scoped project resources and structured public assessment diagnostics. | Keep expected output out of sandbox arguments and evaluation descriptors out of test support. Suppress raw thinking server-side for both live projection and replay; retain status, timing and tools. Report evidence strips private protocol and transport fields. |
| Workbench layout | Left IDE/right assistant, file tree/tabs/editor, terminal/output/preview, normal and expanded scene, light/dark styles and contextual controls. | Fix solo-pane compact layout instead of retaining a fixed 1100px content height. Preserve study-scoped dirty files, chat, quiz choices and pane visibility on scene return/refresh. Stale environments cannot receive cached writes; late send/save acknowledgements cannot erase newer drafts. |
| Current-task controls | Actual milestone/step, no empty drawer for teaching/recap, current decisions/artifacts/tests/quiz only, green usable actions and disabled reasons. | Hide unknown 0/0 counts, preserve full tab names, fix incomplete-quiz submission, verify task drawer close/Escape/focus and composer usability in short and narrow viewports. |
| Agent interaction | Waiting/thinking/tools/text/status order, role colors and stage dividers, snapshot replacement, copy, fold, send re-anchor, manual history scroll, cancel and retry. | Thinking text is withheld without removing its status/timer. Conversation browser fixtures retain the baseline behaviors and check drafts after actual scene unmount and reload. |
| Terminal contention | Existing identity, environment epoch, terminal identity, Stop and stage boundaries. | Avoid the long study lock per keystroke. Retry only confirmed pre-dispatch `ENVIRONMENT_BUSY`, with a finite budget; never replay unknown input. The actual workbench request transport preserves the error reason consumed by that retry logic. |
| Hosted entry and restore | Same durable allocation identity and saved learning progress. | Entry automatically prepares the installed project's environment, reuses a ready workspace, and opens teaching without a setup click. Setup is attempted once per observed environment on entry, with explicit retry after failure. Inspection remains read-only; scoped setup owns restore. Completed reports do not boot a sandbox. |
| Preview during teaching | Authorized owner/stage/port, isolated gateway and revocable grants. | Separate preview permission from arbitrary execution during ordinary model activity. Pending reviews, assessments, completion and Stop remain fences. |
| CI configuration | Existing workflows and integration targets. | Remove only the obsolete workspace-contract feature branch entries. |
| Cross-milestone work | Same source workspace, incremental PLAN, project/milestone role context, source fingerprinting and explicit checkpoints. | Current Python and Java samples each have two normal seven-step milestones. Real-PG/local-toolchain journeys cover edit/run/stop/save/review/tests/next/restore, newly created sources, stale evidence and recovery to an earlier repairable position. No zero-loss promise for unsaved remote work. |
| Reports | Existing state, artifacts, assessments, events and durable role history. | Save process evidence and a completion-gated report, with factual metrics, cited qualitative findings, exact learner quotations, explicit missing/truncated evidence and retryable generation. Reads do not consume a model or provision a sandbox. Return to the workbench and reopen the saved report. Friendly versions replace the internal fingerprint label. |
| Compatibility | Ordinary classroom scenes, v2, course authoring Agent and non-PBL sandboxes continue using their existing routes. | Exercise v2 and generation/runner regressions alongside the shared sandbox suite. Draft caching is confined to v3; the host canvas and shared chat/terminal components are reused. |

There is no required or automatically appended exploration phase. The current
samples finish at the last normal milestone's recap. Old version-pinned definitions
remain readable so an upgrade does not silently shift an existing learner's stage
indices; they are not a template for new course structure. Course-specific custom
stage support is not expanded by this PR.

The report contract supersedes an earlier suggestion to expose reports before the
whole project finishes. A final recap tool receipt is required; an ordinary text
handoff, an intermediate recap or viewing a report cannot complete the project.

## Verification and limits

- `tests/pbl/v3` and `tests/sandbox`: actual PostgreSQL in an isolated test database,
  scripted runner/model fixtures and local Python/Java execution. The package
  toolchain journeys require `PBL_PACKAGE_TOOLCHAINS=1`; external acceptance tests
  are excluded. This is not a real model or cloud-provider run.
- `tests/pbl/v3/local-drafts.test.ts`: mounted editor/UI hooks, scene unmount/remount,
  study isolation, replaced environments, late acknowledgements and unavailable
  browser storage. Local drafts are not server-side submissions or checkpoints.
- The two `e2e/tests/pbl-v3-*.spec.ts` journeys use real Chromium and classroom pages
  with API fixtures: layout, drafts, scroll/fold/focus, execution controls, test/quiz
  feedback and saved-report navigation. Screenshots in this directory are fixtures.
- Compatibility checks cover `tests/pbl/v2`, v2 scene generation, selected ordinary
  Agent generation/recovery/tool-order tests and the non-PBL sandbox suite. They do
  not replace full manual acceptance of every course mode.
- Live model teaching quality, the complete combined real-provider journey, actual
  private course assembly and small-cohort deployment acceptance remain separate.
  Earlier live checks in [LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md) are historical
  evidence for their stated revision and scope, not validation of this PR's head.

Expected-output digests remove the known command-line disclosure, but shell access
remains a cooperative learning facility. Course authors must not put expected values
inside sandbox-visible support scripts. This does not claim hostile-exam isolation.

## Later work

The simplified course content, its DSL/tests/business frontend and private packaging
are subsequent integration work. Live deployment, accounts/quotas/billing/capacity,
promotion/operations, generated projects, SSH/local Docker providers and end-of-course
resource retention/cleanup are also outside this change. No additional platform,
scheduler, research export or administration dashboard is introduced.
