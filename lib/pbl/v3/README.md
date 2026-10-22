# PBL v3 learning runtime

For the dedicated classroom file, execution and recovery controls, see
[Learning workbench and recovery](WORKBENCH.md).
For self-contained `.maic.zip` delivery, see
[Project packages, permissions and verification](PROJECT-PACKAGES.md).

This slice opens an installed programming project in the normal classroom, runs
four teaching roles in the existing Agent runner, and persists learning progress
in PostgreSQL. It does not enable generated v3 projects.

## Try the sample

Use the application's existing configuration:

- PostgreSQL through `DATABASE_URL`.
- `OPENMAIC_AGENT_RUNTIME_ENABLED=true` and a configured `agent` model slot.
- A configured shared sandbox provider and durable checkpoint storage.
- Explicit single-user installation mode, or a host-verified user with `sandbox:use`.

Open `/pbl-v3`, choose a Java or Python sample, then prepare its project environment.
The configured sandbox template must have Python 3. Follow the teaching sections,
record a decision, review the plan and implementation, run and collect tests,
complete the quiz, and reflect with the mentor. Use **Continue** to confirm stage
progression. Confirming a plan or code stage also saves a durable checkpoint before
advancing. Use **Save checkpoint** to save additional work between these boundaries.

A PBL scene selects `{ projectV3: { id, version } }`. The server resolves that
reference against installed content. The scene never supplies model credentials,
executable test commands, answers, or authoritative learning state. Existing v1/v2
scenes keep their existing renderer.

## Classroom experience

A PBL project remains a scene inside an OpenMAIC course. Neighboring slides, quizzes
and other scenes provide course teaching; this change does not embed another
OpenMAIC course inside the project. Native workspace expansion retains the same
component instance and returns to the host layout without resetting a draft reply.
Scene re-entry reloads durable study state; unsent drafts are not durable records.

The teaching panel uses the host's existing OpenPBL-derived chat skin, Markdown
renderer and sticky scrolling, with four role identities and ordered turn parts.
Existing runner event snapshots update replies through the learning poll; no second
stream, runner or chat database is introduced. The host's ThinkingBlock, WaitingBar,
ToolGroup and ToolCard render real reasoning (when supplied by the model), pre-content
waiting, ordered calls, disclosure details and elapsed times inside OpenPBL-style
role turns. Text snapshots replace earlier snapshots; completed thoughts stop timing
when prose or a tool takes over. Terminal and interrupted turns settle on replay.
Tool details include project files and structured build outcomes; credentials, raw
provider errors, hashes and teaching protocol bodies stay out of the display payload.
Recent conversations span the current milestone roles and project mentor; older
records remain available in the report. Explicit sends re-anchor the conversation;
reading older messages does not force scrolling to the bottom.

Stage guidance, selected decisions, version-bound review and quiz actions use the
server's progress/actions. Quiz answer drafts are scoped to their milestone/stage.
Reports summarize retained test/quiz/reflection results and link to historical
evidence without claiming that old test results certify subsequently edited files.

The workbench places the IDE on the left and teaching assistant on the right,
with adjustable panel widths. The IDE includes an authorized file tree, Monaco
editor, per-file tabs and drafts, command output, terminal and application-preview
panes. The assistant keeps its conversation scroll separate from stage controls and
the message composer. Enter sends; Shift+Enter inserts a line. Workspace keystrokes
do not trigger classroom shortcuts.

The v3 scene fills the host canvas rather than inheriting a slide's 16:9 constraint.
Short containers scroll a minimum usable workbench; narrow containers stack IDE and
assistant. Expanding and returning preserves the mounted editor and chat drafts.
File switches preserve unsaved buffers. Unsaved files block execution and teaching
handoffs until saved or explicitly discarded; changing environments preserves drafts
but disables stale writes. Scene navigation/reload still requires saving work first.
All controls use the existing workspace routes, permissions and version checks.
When teaching input is blocked, the composer explains the pending request, active
reply, unavailable environment, unsaved files or unfinished opening. Environment
restoration and failed-opening retries are available beside the draft. These
actions preserve the message and never submit it automatically.

A compact status strip above the composer shows the milestone and current step (1/7
for a seven-step milestone). Teaching and reflection have no expandable task drawer.
Decision, artifact, test and quiz stages expose only their current task details in an
upward drawer; closing it preserves answer drafts and never displaces the composer.
The project introduction belongs to the first teaching step, not an extra step.
After environment preparation and each confirmed stage transition, the active role
opens the stage once through the existing runner. Durable stage-entry events supply
conversation dividers on replay. Opening wakeups are explicitly system-originated:
they are not shown as learner messages and cannot count as review feedback. Reloads
reuse the current role; a failed opening uses the normal retry path. Existing sessions
retain their history and position when the old separate intro gate is folded away.
The scene uses OpenPBL's blue-gray/green palette in dark mode and its light counterpart,
scoped to the workbench and following the host theme. Configured application previews
keep a tab before connection, with guidance for unavailable/not-started states; project
web applications and their API contracts remain content-specific.

Monaco is loaded only in the browser. Install/dev/build copy its bundled assets to
`public/code-editor/vs`; Docker copies these with the application's public directory.
No third-party editor CDN is required. Source hashes, stage gates, file durability
and recovery still come from the existing backend.

![Classroom teaching conversation — local API fixtures](screenshots/conversation.png)

### Teaching protocol reuse

`teaching-sections.ts` adapts the general OpenPBL pre-decision, PLAN and implementation
review sections. Project names, language-specific assumptions and legacy tool calls
are removed; project teaching materials still come from the installed catalog.
Shared rules preserve one disclosed step per reply, direct help before further
questioning, meaningful rather than keyword-based feedback, non-repetitive review,
and fresh approval after a changed artifact. The existing guided-review receipts
still enforce ordering, real new student messages and current artifact versions.
The role receives the current/next learning step and remaining section boundaries.
Only a successful `complete_stage` receipt and valid stage evidence authorize
Continue; an ordinary follow-up message does not revoke a completed review. File
changes still invalidate affected approvals, and progression rechecks the actual
artifact fingerprint. Required decisions must all be submitted before Continue
is offered. The learner confirms the transition, then the next role opens its step.
Named Discussion Skills select teaching, not mentor reflection. Public assets contain
no private course decisions, tests, reference answers or milestone-specific material.

The new interface copy is provided in English and Simplified Chinese; other locale
bundles currently retain the English fallback for these additions.

## Execution and persistence

- `domain/` preserves the teaching state machine, artifact projection, decision
  records, quiz judging, and completion gates. Fixed model credentials and old
  host/release-upgrade orchestration are not used.
- `lib/server/pbl-v3/catalog.ts` contains the public installed samples. Course assets
  are separate from the runtime. This slice deliberately exposes no arbitrary
  project upload or model-generated executable configuration.
- `lib/server/pbl-v3/store.ts` registers versioned PG migrations through the
  existing bootstrap mechanism. Study identity is unique per owner/classroom/scene;
  project version is pinned. State, ordered events and command receipts commit
  together. Remote operations retain request IDs for retry.
- Each role has a real durable Agent session. Mentor context spans the project;
  other roles are scoped to a milestone. A server-side binding selects the teaching
  prompt and tools in the existing runner. Teaching sessions do not receive course
  editing, browsing, media generation, or general shell tools.
- Role session IDs are reserved for the learning runtime. The ordinary chat list,
  status projection and event stream omit them, and the chat deletion server action
  refuses them. Generic detail, title, message, cancellation and per-session event
  endpoints return 404 for teaching IDs; only the learning API controls them. A previously deleted role is recreated on the next learning message;
  progress and files remain, while that role's review receipts restart.
- The runner owns leases, attempt fences, background execution, cancellation,
  durable messages and reconnection. There is no additional process or worker pool.
  Its existing concurrency limit applies; teaching runs are bounded to two minutes.
- Cancellation uses an owner-checked control path outside the learning lock and
  accepts stale progress revisions. Failed/cancelled turns have a visible status
  and an explicit retry through the existing runner. Retry reuses the original
  student message, so it cannot count as new feedback. Raw provider errors are
  replaced with fixed public failure categories.
- Role tools recheck binding, stage, owner, lease and expiring sandbox delegation.
  PLAN writes are restricted to planning. File writes compare an observed hash
  under the sandbox mutation lock. A pending write invalidates affected approvals
  before crossing the network.
- Guided review receipts require a later real student message and the same artifact
  digest. Completion signals cannot advance the stage. The server validates
  artifacts/tests, and the learner separately confirms progression. A committed
  review or completion receipt ends model execution even in a mixed tool batch.
  Retry/takeover preserves the wait and file-write restriction until a new student
  reply; a saved question remains visible even if its runner display event was lost.
- Tests run as sandbox background commands, with stable IDs and explicit result
  collection. Changed input invalidates the result; unknown execution is not a
  failed student test. Learning progress survives page refresh independently of
  the execution environment. File durability requires a successful checkpoint.
- Learner commands, file access, tools and visible-workspace polling renew the
  environment, throttled to once per 20 seconds. Polling never counts as student
  feedback or changes the learning revision. Closed/hidden workspaces do not get
  an indefinite keepalive. Provider uncertainty leaves progress readable and does
  not authorize another allocation.
- **Prepare project environment** reconciles an expired environment and restores
  the latest checkpoint into a new allocation for the same study/workspace. Its
  allocation ID is durable before provisioning, so retries reuse it. Old role
  grants and pending evaluations cannot carry over to the replacement. Restored
  files are checked against plan content and code/test fingerprints; stale
  dependent evidence is cleared and the active milestone returns to the earliest
  affected step. With no checkpoint, starter files are restored and the UI says so.
  Work after the last successful checkpoint cannot be recovered.
- Discussion at the decision stage is optional. Submitted decisions remain
  mandatory, and a running role still blocks progression.
- Reflection receives the saved test status/feedback and tested workspace revision,
  plus the learner's quiz score and attempt summary. Internal diagnostics and
  answer keys are excluded from this evidence projection.
- The workspace rejects stale file-load responses after file selection changes.
  Quiz scores and retry guidance remain visible after refresh.

## Learning workspace contract

The installed classroom sample and teaching role tools use this contract. It adds
no tables, workers, provider, or configuration switches.

- **One server-side mutation boundary.** `pbl-<study UUID>` is reserved for learning
  workspaces. Generic sandbox file writes, commands, terminal input/creation,
  desktop input, delegation, checkpoint mutation, restore, deletion and preview
  access are rejected with `PBL_WORKSPACE_MANAGED`. Checks use the environment's
  stored owner/workspace binding. Creation also checks the reserved namespace,
  preventing allocation before the learning runtime establishes its request ID.
  Existing preview tickets are checked on use. Ordinary workspace IDs are unchanged.
- **Narrow internal access.** Only the owner-checked learning command or leased role
  tool enters a server-only workspace scope, while holding the existing study lock.
  Scope matches owner, workspace, current/recovery environment IDs and specific
  operations; it expires when the awaited action ends. Stage, role, feedback and
  optimistic revision checks still run before mutation. No HTTP parameter creates
  this scope. Lock order remains study then sandbox; the sandbox layer never takes
  a study lock. Observations, renewal, command cancellation and terminal closure
  remain available for diagnosis/cleanup.
- **Content versions, not save clicks.** Editor saves and role writes validate the
  observed hash under the same environment lock. Identical text is a no-op for
  evidence and provider writes. A stale hash is rejected even when the submitted
  text happens to equal the current file. A real change commits dependent evidence
  invalidation before provider I/O, so a lost write acknowledgement cannot preserve
  a stale pass. Learner command receipts may still increment the progress revision;
  this does not change the content fingerprint. Reload the file after an ambiguous
  write before submitting another edit.
- **One source set.** File reads, learner/role edits, review/test fingerprints and
  recovery use the installed project's source policy. Existing packages keep their
  closed starter-file set. Optional trusted `sourceRoots` name relative directories
  without trailing slashes; supported text source files below them participate in
  evidence, including additions/deletions. Traversal, dependency/build directories,
  more than 256 files and snapshots above 1 MiB are rejected/excluded as appropriate.
  This is evidence scope, not a filesystem sandbox or a new file-management UI.
- **No evidence from a moving workspace.** Before a source snapshot or checkpoint,
  observe managed commands and terminals. Running/unknown commands and nonclosed
  terminals block it until explicitly stopped and reconciled. This covers sessions
  created before these restrictions. It does not detect unmanaged child processes
  or replace OS isolation. PBL terminal/preview support stays unavailable through
  generic controls until the dedicated teaching-aware workbench is implemented.
- **Recovery handoff stays small.** Keep the existing durable allocation ID,
  checkpoint revision and `progressReset` result. Recovery compares the same source
  fingerprints and clears stale active-milestone evidence. Cross-milestone recovery uses checkpoint position metadata and revalidates restored content; workspace stop/save/restart controls are delivered by the merged workbench.

## Complete learning experience

The host keeps four logical roles inside the existing Pi runner and persists learning
state, role bindings and evidence in PostgreSQL. No per-student runtime process or
second orchestration service is introduced. Old OpenPBL behavior informs the teaching
contract; its release synchronization and runtime topology are not copied.

| Capability | Implementation and boundary |
| --- | --- |
| Teaching / discussion | Active milestone concepts and boundaries, learner decisions, and fresh feedback gates. Role context stays owner- and milestone-scoped. |
| Plan and code review | Trusted segmented Skills in `lib/server/pbl-v3/skills.ts`; one section/question at a time. Incremental PLAN keeps the full prior approved prefix, even if report excerpts are clipped. |
| Build before code review | Configured projects expose `run_build` / `collect_build` and a learner build button. Success must match the current source fingerprint; pending/failed builds cannot unlock review. |
| Completion | Validate artifacts and persist successful transitions before ending the role turn. Invalid artifacts can be corrected in that same turn, followed by fresh review of changed files. |
| Tests | A host-owned parent driver runs independent child checks and requires every expected result. A student module exiting with code 0 cannot pass by suppressing assertions. |
| Cross-milestone | The same workspace and PLAN continue; project roles change context. Checkpoints record the saved milestone/stage; recovery clears downstream gates if saved work predates current progress. |
| Report | Available only after the final milestone recap is completed by `complete_stage`. The report button makes one bounded analysis request; the result and its evidence are saved. Returning to the workbench and reopening reads the saved report. No live sandbox is required to read it. |

Review feedback is bound to durable student messages after the pending question's
turn in the same stage. The teaching role can assess multiple replies together and
quote or summarize them in `studentFeedback`; literal substring matching is not an
authorization check. The role still assesses whether the answer addresses the
question, while the server enforces fresh replies, artifact versions and stage
boundaries. Retries and assistant messages do not create student feedback.

The source set, stage locks, writer-idle checks and ordinary sandbox restrictions
remain the shared contract above. The merged workbench supplies file management, shell, terminal, preview and
checkpoint UI. Both the shared workspace contract and workbench are now in
`integration/shared-sandbox`. This learning change retains their access, version and
recovery boundaries while adding the teaching journey. Repeat combined real-provider
checks before accepting the complete classroom journey.

### Installed public samples

`/pbl-v3` selects `greeting-python-lab@1.1.0`, `greeting-java@1.1.0`, or the original
`greeting-python@1.0.0`. The two current projects each contain two milestones, each with teaching, decisions,
planning, coding, tests, quiz and recap. No exploration milestone is appended. They test retaining earlier behavior while adding input
normalization, and keep one evolving PLAN.md. Their materials are public examples;
no private Java course assets or answer bundles are published here.

Runtime images need Python 3 and a POSIX shell for the shared provider and assessment
driver. The Java sample additionally needs a JDK with `javac` and `java` (validated
locally with JDK 17). Trusted build commands and expected outputs live only in the
server catalog; scene content contains an installed project/version reference.

The parent assessment driver improves correctness, not hostile-code isolation:
student code runs under the sandbox identity and is not a secure examination system.
Public feedback is bounded. Compile success is distinct from test success.

### Verification

```sh
PG_CONTRACT_URL=postgres://... pnpm exec vitest run tests/pbl/v3 --maxWorkers=4
pnpm exec playwright test e2e/tests/pbl-v3-workspace.spec.ts
```

The PG suite drives actual role tools and the Pi loop, uses real local Python/Java
execution, and covers both complete sample journeys, invalid completion and repair,
compile gates, earlier-plan preservation, completion-gated reports and workspace recovery.
Model transport and cloud provisioning are replaced by fixtures. The browser suite
uses the real classroom entry and persisted sample document but fixtures the learning
API; it checks rendering, report navigation and progress/file-response races.
Neither suite establishes live-model/live-provider acceptance.

On an authorized test installation, verify both languages through teaching, decisions,
plan review, code review, tests, quiz and reflection across both milestones. Combine
with the workbench change to exercise edit → run → stop → save → review → test →
next milestone → expire/recover. Inspect that restored files and current gates agree;
historical report entries should retain their original versions. Finish the final recap,
open the report, return to the workbench, and reopen the same report while the sandbox
is unavailable. Earlier milestones and an ordinary text handoff must not open a report.

The report below is from the local classroom browser fixture, with saved evidence supplied by the test API.

![Learning report in the classroom](screenshots/report.png)

### Remaining delivery boundary

Live-provider/model acceptance, the private full Java curriculum and its operational
Preview remain separate delivery work. General course/project generation, SSH and
local Docker providers are not added here. The legacy `course` stage schema is not
an installed sample feature. The previous standalone platform embedded its introductory
course; OpenMAIC instead hosts PBL alongside other course scenes. No nested-course
adapter or browser-reported course-completion shortcut is added. Course content
assembly remains separate from the seven-step project learning flow.

The #1951 follow-ups for evaluator false passes and completion-before-validation are
addressed here. Dedicated workspace controls are provided by the merged workbench;
real-provider concurrency and capacity remain acceptance work. Shared no-op saves,
mutation scope and source policies remain supplied by the parent workspace contract.

Guided teaching, planning, implementation and reflection turns finish only after a committed
review question or stage completion. A normal model text stop alone is not completion. The
runner makes at most one continuation attempt with the same real learner input and current
protocol state, then reports an explicit retryable failure if the turn is still unclosed.
Retry and worker takeover preserve the same rule; no synthetic learner approval is added.
Successful completion displays a localized handoff above the composer. Progression remains
a separate learner action for intermediate stages, with existing artifact, test and quiz checks unchanged.
The final project recap commits completion directly through its validated tool result.

Assessment stages use dedicated control instructions, not the guided review question protocol.
The task bar runs tests directly and shows a running indicator or the saved verdict without
opening the drawer. Terminal runs are collected automatically, including on refresh; a failed
collection offers an explicit retry. Collection names its evaluation ID, is idempotent after
saving, and rejects a stale request for a different pending run. The drawer shows safe per-case
results. Hidden test programs, expected values and raw provider/runner tracebacks are omitted.
A missing or invalid receipt is an evaluation error, not an implementation failure. A new
pending run takes precedence over an earlier pass; only a saved current verdict unlocks Next.

### Saved project report

The report route enforces study ownership and whole-project completion for both reads
and generation. GET never calls a model. The button's POST uses the configured,
authorized agent model slot, makes a bounded call, validates structured findings and
saves the completed document in PostgreSQL. Duplicate clicks share the current attempt;
refreshing/reopening reads the saved result. Failed or abandoned attempts can be retried
explicitly. A failed model request does not erase learning records or undo completion.

The existing event and agent stores retain decisions and revisions, all test and quiz
attempts, real learner messages and assistant replies/questions. Append-only evidence
also records learner/assistant file edits, workbench operation admissions, complete
reviewed source snapshots and a final source snapshot. Source snapshots retain the
runtime's 1 MiB bound. Terminal keystrokes are not a separate learning metric; arbitrary
shell edits are captured by the subsequent review/final snapshot, not per keystroke.
No-op saves are not counted as edits. Code changes are compared against the preceding
saved snapshot. Full existing dialogue is paged from its store, without taking only the
latest 5,000 events or clipping each learner message to 8,000 characters.

Counts describe recorded activity, not scores or proof of understanding. Qualitative
findings cite saved records; strengths, corrections and collaboration claims also require
an exact learner quote. Unknown references or invented quotes are rejected. The bounded
analysis samples across the journey and explicitly marks omitted/shortened inputs;
missing historical records cannot be reconstructed. Raw thinking, system stage openings,
private course protocols, expected test answers and internal workspace fingerprints are
excluded from the report. Versions appear as v1, v2, etc. Existing public 1.0.0 catalog
references retain their original definitions so saved stage indexes are not silently
reinterpreted; new sample selection uses 1.1.0.

### Private evaluation material

The sandbox receives only executable case inputs and observation support files. Expected
stdout stays on the host. The runner returns a SHA-256 digest of actual stdout, exit code
and a bounded reason for each installed case; the host compares digests against its own
expected values. A sandbox-supplied `passed` flag is not a verdict. Evaluation descriptor
JSON, rubric files and declared answer keys are not staged as execution resources.
Course authors must put expected results in the host-owned case descriptor, never in
sandbox support scripts. This removes answer disclosure through process arguments and
staged descriptors; the cooperative shell remains unsuitable as a hostile-code exam
boundary. PBL thinking bars show status/duration only in both streaming and replay.
