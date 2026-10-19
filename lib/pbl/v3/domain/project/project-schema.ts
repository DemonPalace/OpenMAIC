import { z } from 'zod';

export const agentRoleSchema = z.enum(['mentor', 'discussion', 'planner', 'coder']);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const stageKindSchema = z.enum(['mentor_say', 'dialogue', 'produce', 'check', 'course']);
export const studentActionSchema = z.enum([
  'chat',
  'decide',
  'next',
  'edit',
  'create',
  'delete',
  'rename',
  'move',
  'restore',
  'evaluate',
  'quiz',
  'reset',
]);
export type StudentAction = z.infer<typeof studentActionSchema>;
export const artifactRefSchema = z.enum([
  'contract',
  'decisions',
  'decisions.chosen',
  'plan',
  'code',
]);
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export const decisionKindSchema = z.enum(['architecture', 'implementation', 'product', 'quality']);

const nonEmptyString = z.string().trim().min(1);
const projectPath = nonEmptyString.refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  {
    message: 'must be a project-relative path without parent traversal',
  },
);
const stageSkillId = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'must be a lowercase kebab-case skill id',
  });

export const projectServiceTypeSchema = z.enum(['preview-shell', 'jar-api', 'openmaic-classroom']);
export type ProjectServiceType = z.infer<typeof projectServiceTypeSchema>;

export const courseReleaseDescriptorSchema = z
  .object({
    courseId: nonEmptyString,
    releaseId: nonEmptyString,
    version: nonEmptyString,
    objectKey: projectPath,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
    formatVersion: z.number().int().positive(),
  })
  .strict();
export type CourseReleaseDescriptor = z.infer<typeof courseReleaseDescriptorSchema>;

const projectServiceDefinitionSchema = z
  .object({
    serviceType: projectServiceTypeSchema,
    runtimeAdapter: nonEmptyString,
    activation: z
      .object({
        milestoneTypes: z.array(z.enum(['learn', 'task'])).min(1),
      })
      .strict(),
    publicShare: z.boolean().default(false),
    courseRelease: courseReleaseDescriptorSchema.optional(),
  })
  .strict()
  .superRefine((service, context) => {
    if (
      service.serviceType === 'openmaic-classroom' &&
      service.runtimeAdapter !== 'openmaic-sandbox'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'openmaic-classroom must use the openmaic-sandbox runtime adapter',
        path: ['runtimeAdapter'],
      });
    }
    if (service.serviceType === 'openmaic-classroom' && service.courseRelease === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'openmaic-classroom requires courseRelease',
        path: ['courseRelease'],
      });
    }
    if (service.serviceType !== 'openmaic-classroom' && service.courseRelease !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'courseRelease is only valid for openmaic-classroom',
        path: ['courseRelease'],
      });
    }
  });

export type ProjectServiceDefinition = z.infer<typeof projectServiceDefinitionSchema>;

const agentDefinitionSchema = z.object({
  systemPrompt: nonEmptyString,
  teachingSystemPrompt: nonEmptyString.optional(),
  tools: z.array(nonEmptyString),
  skillPaths: z.array(projectPath).default([]),
});

const evaluationMetadataSchema = z.object({
  capabilityIds: z.array(nonEmptyString).default([]),
  evaluatorRefs: z.array(nonEmptyString).default([]),
  rubricRefs: z.array(nonEmptyString).default([]),
});

const decisionDefinitionSchema = z.object({
  id: nonEmptyString,
  kind: decisionKindSchema.default('architecture'),
  desc: nonEmptyString,
  decisionPrompt: nonEmptyString,
  options: z.array(
    z.object({ id: nonEmptyString, label: nonEmptyString, summary: nonEmptyString }),
  ),
  rubricAnchor: nonEmptyString,
  gatesGlobs: z.array(nonEmptyString),
  evaluation: evaluationMetadataSchema.optional(),
});

const quizQuestionSchema = z.object({
  q: nonEmptyString,
  options: z.array(nonEmptyString).min(2),
  answer: z.number().int().nonnegative(),
  explain: nonEmptyString,
});

const stagePolicySchema = z.object({
  workspaceAccessPolicyRef: nonEmptyString.optional(),
  evaluationPolicyRef: nonEmptyString.optional(),
});

const mentorSayStageSchema = z.object({
  kind: z.literal('mentor_say'),
  agent: z.enum(['mentor', 'discussion']),
  say: nonEmptyString,
  skill: stageSkillId.optional(),
  reviewScope: z.enum(['current_milestone', 'project']).optional(),
  reads: z.array(artifactRefSchema).default([]),
  studentActions: z.array(studentActionSchema).default(['chat', 'next']),
  policy: stagePolicySchema.optional(),
});

const dialogueStageSchema = z.object({
  kind: z.literal('dialogue'),
  agent: z.literal('discussion'),
  reads: z.array(artifactRefSchema),
  collects: z.literal('decisions'),
  studentActions: z.array(studentActionSchema),
  policy: stagePolicySchema.optional(),
});

const produceStageSchema = z.object({
  kind: z.literal('produce'),
  agent: z.enum(['planner', 'coder']),
  reads: z.array(artifactRefSchema),
  writes: z.enum(['plan', 'code']),
  reviewRequired: z.boolean().default(false),
  compileBeforeReview: z.boolean().optional(),
  planUpdateMode: z.literal('incremental').optional(),
  exploration: z.object({ introduction: nonEmptyString }).strict().optional(),
  skill: stageSkillId.optional(),
  studentActions: z.array(studentActionSchema),
  policy: stagePolicySchema.optional(),
});

const checkStageSchema = z.object({
  kind: z.literal('check'),
  checker: z.enum(['tests', 'quiz']),
  evaluation: evaluationMetadataSchema.optional(),
  policy: stagePolicySchema.optional(),
});

const courseStageSchema = z.object({
  kind: z.literal('course'),
  courseId: nonEmptyString,
  releaseId: nonEmptyString,
});

export const stageDefinitionSchema = z.discriminatedUnion('kind', [
  mentorSayStageSchema,
  dialogueStageSchema,
  produceStageSchema,
  checkStageSchema,
  courseStageSchema,
]);
export type StageDefinition = z.infer<typeof stageDefinitionSchema>;

const releaseOnboardingSchema = z
  .object({
    id: nonEmptyString,
    intro: mentorSayStageSchema.extend({ agent: z.literal('mentor') }),
  })
  .strict();

const milestoneSchema = z
  .object({
    id: nonEmptyString,
    type: z.enum(['learn', 'task']),
    optional: z.boolean().optional(),
    title: nonEmptyString,
    goal: nonEmptyString.optional(),
    teaching: z
      .object({
        projectContext: nonEmptyString.optional(),
        stageRole: nonEmptyString.optional(),
        targetOutcome: nonEmptyString.optional(),
        knowledgeBridge: nonEmptyString.optional(),
        purpose: nonEmptyString,
        concepts: z.array(nonEmptyString).min(1),
        boundaries: z.array(nonEmptyString).default([]),
      })
      .optional(),
    contract: nonEmptyString.optional(),
    deliverables: z.array(nonEmptyString).default([]),
    tests: z.array(nonEmptyString).default([]),
    testScope: z.enum(['current', 'cumulative']).default('current'),
    publicTestFeedback: z.record(nonEmptyString, z.string().trim().min(1).max(300)).default({}),
    decisions: z.array(nonEmptyString).default([]),
    quiz: z.array(quizQuestionSchema).default([]),
    stages: z.array(stageDefinitionSchema).min(1),
  })
  .passthrough();
export type MilestoneDefinition = z.infer<typeof milestoneSchema>;

export const workspaceAccessPolicySchema = z.object({
  id: nonEmptyString,
  actor: z.enum(['student', 'agent', 'system', 'evaluator']),
  agentRole: agentRoleSchema.optional(),
  milestoneIds: z.array(nonEmptyString).default([]),
  stageKinds: z.array(stageKindSchema).default([]),
  operations: z.array(z.enum(['read', 'write', 'list', 'evaluate'])).min(1),
  include: z.array(nonEmptyString).default([]),
  exclude: z.array(nonEmptyString).default([]),
  writableProtectedPaths: z.array(z.literal('pom.xml')).optional(),
});
export type WorkspaceAccessPolicy = z.infer<typeof workspaceAccessPolicySchema>;

export const evaluationFailureKindSchema = z.enum([
  'compile',
  'assertion',
  'build',
  'timeout',
  'infrastructure',
  'contract',
  'decision',
  'plan',
  'unknown',
]);

export const projectSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    definitionRevision: z.number().int().positive().optional(),
    id: nonEmptyString,
    title: nonEmptyString,
    language: nonEmptyString,
    providerRef: nonEmptyString,
    entry: z
      .object({ mode: z.enum(['intro', 'course-first']) })
      .strict()
      .default({ mode: 'intro' }),
    services: z
      .array(projectServiceDefinitionSchema)
      .default([])
      .superRefine((services, context) => {
        const types = services.map((service) => service.serviceType);
        if (new Set(types).size !== types.length) {
          context.addIssue({ code: 'custom', message: 'project service types must be unique' });
        }
        for (const [index, service] of services.entries()) {
          if (service.publicShare && service.serviceType !== 'preview-shell') {
            context.addIssue({
              code: 'custom',
              message: 'only preview-shell can be publicly shared',
              path: [index, 'publicShare'],
            });
          }
        }
      }),
    paths: z.object({
      requirements: projectPath,
      pedagogy: projectPath,
      skeleton: projectPath,
      tests: projectPath,
      rubric: projectPath,
    }),
    protectedPaths: z.array(nonEmptyString),
    testing: z.object({
      runCmd: nonEmptyString,
      reportPath: projectPath,
      reportFormat: nonEmptyString,
    }),
    agents: z.object({
      commonRules: nonEmptyString,
      mentor: agentDefinitionSchema,
      discussion: agentDefinitionSchema,
      planner: agentDefinitionSchema,
      coder: agentDefinitionSchema,
    }),
    intro: mentorSayStageSchema.extend({ agent: z.literal('mentor') }),
    // Reviewed corrections to prior teaching text and milestone-owned test/skill assets.
    releaseCorrections: z.array(nonEmptyString).optional(),
    completionMode: z.enum(['final', 'awaiting_more_milestones']).default('final'),
    releaseOnboardings: z.array(releaseOnboardingSchema).default([]),
    defaultReleaseOnboardingId: nonEmptyString.optional(),
    visibility: z
      .object({
        roleViews: z.object({
          discussion: z.array(nonEmptyString),
          planner: z.array(nonEmptyString),
          coder: z.array(nonEmptyString),
        }),
        answerKeys: z.array(nonEmptyString),
        testSupport: z.array(nonEmptyString),
      })
      .passthrough(),
    decisions: z.array(decisionDefinitionSchema),
    milestones: z.array(milestoneSchema).min(1),
    workspaceAccessPolicies: z.array(workspaceAccessPolicySchema).default([]),
    workspaceRevisionPolicy: z
      .object({
        strategy: z.enum(['snapshot', 'git-checkpoint', 'provider-defined']),
        evaluatorUsesImmutableRevision: z.boolean(),
      })
      .default({ strategy: 'snapshot', evaluatorUsesImmutableRevision: true }),
  })
  .passthrough()
  .superRefine((project, context) => {
    const correctionIds = project.releaseCorrections ?? [];
    if (
      new Set(correctionIds).size !== correctionIds.length ||
      correctionIds.some((id) => !project.milestones.some((milestone) => milestone.id === id))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'release corrections must name unique existing milestones',
        path: ['releaseCorrections'],
      });
    }
    const onboardingIds = project.releaseOnboardings.map(({ id }) => id);
    if (new Set(onboardingIds).size !== onboardingIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'release onboarding ids must be unique',
        path: ['releaseOnboardings'],
      });
    }
    if (
      project.defaultReleaseOnboardingId !== undefined &&
      !onboardingIds.includes(project.defaultReleaseOnboardingId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'default release onboarding must reference the onboarding catalog',
        path: ['defaultReleaseOnboardingId'],
      });
    }
    const openmaicService = project.services.find(
      (service) => service.serviceType === 'openmaic-classroom',
    );
    const courseStages = project.milestones.flatMap((milestone, milestoneIndex) =>
      milestone.stages.flatMap((stage, stageIndex) =>
        stage.kind === 'course' ? [{ milestoneIndex, stageIndex, stage }] : [],
      ),
    );

    for (const { milestoneIndex, stageIndex, stage } of courseStages) {
      if (!openmaicService?.courseRelease) {
        context.addIssue({
          code: 'custom',
          message: `course stage ${stage.courseId} requires an OpenMAIC course release`,
          path: ['milestones', milestoneIndex, 'stages', stageIndex],
        });
        continue;
      }
      if (
        openmaicService.courseRelease.courseId !== stage.courseId ||
        openmaicService.courseRelease.releaseId !== stage.releaseId
      ) {
        context.addIssue({
          code: 'custom',
          message: `course stage ${stage.courseId} is not pinned to the OpenMAIC service release`,
          path: ['milestones', milestoneIndex, 'stages', stageIndex],
        });
      }
    }

    if (
      project.entry.mode === 'course-first' &&
      project.milestones[0]?.stages[0]?.kind !== 'course'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'course-first entry requires the first stage to be a course',
        path: ['entry', 'mode'],
      });
    }

    for (const policy of project.workspaceAccessPolicies) {
      if (
        policy.writableProtectedPaths?.length &&
        (policy.milestoneIds.length === 0 ||
          policy.milestoneIds.some(
            (id) =>
              !project.milestones
                .find((milestone) => milestone.id === id)
                ?.stages.some(isExplorationStage),
          ))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'protected build file writes must be scoped to exploration milestones',
        });
      }
    }
    for (const [milestoneIndex, milestone] of project.milestones.entries()) {
      if (
        milestone.stages.some(isExplorationStage) &&
        (milestone.optional !== true ||
          milestone.stages.length !== 1 ||
          milestone.tests.length > 0 ||
          milestone.decisions.length > 0 ||
          milestone.quiz.length > 0)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'exploration requires one optional stage without scored tasks',
          path: ['milestones', milestoneIndex],
        });
      }
      for (const [stageIndex, stage] of milestone.stages.entries()) {
        if (
          isExplorationStage(stage) &&
          (stage.agent !== 'coder' ||
            stage.writes !== 'code' ||
            stage.reviewRequired ||
            stage.skill ||
            stage.compileBeforeReview ||
            stage.planUpdateMode ||
            stage.studentActions.some((action) =>
              ['next', 'decide', 'evaluate', 'quiz', 'reset'].includes(action),
            ))
        ) {
          context.addIssue({
            code: 'custom',
            message: 'exploration uses a continuous coder without fixed workflow gates',
            path: ['milestones', milestoneIndex, 'stages', stageIndex],
          });
        }
        if (
          stage.kind === 'produce' &&
          stage.planUpdateMode === 'incremental' &&
          (stage.agent !== 'planner' ||
            stage.writes !== 'plan' ||
            !stage.reviewRequired ||
            !stage.skill)
        ) {
          context.addIssue({
            code: 'custom',
            message: 'incremental plan updates require a guided planner review stage',
            path: ['milestones', milestoneIndex, 'stages', stageIndex, 'planUpdateMode'],
          });
        }
        if (
          stage.kind === 'produce' &&
          stage.compileBeforeReview === true &&
          (stage.agent !== 'coder' || !stage.reviewRequired || !stage.skill)
        ) {
          context.addIssue({
            code: 'custom',
            message: 'compileBeforeReview requires a guided coder review stage',
            path: ['milestones', milestoneIndex, 'stages', stageIndex, 'compileBeforeReview'],
          });
        }
        if (stage.kind === 'produce' && stage.skill !== undefined && !stage.reviewRequired) {
          context.addIssue({
            code: 'custom',
            message: 'a produce-stage skill requires reviewRequired=true',
            path: ['milestones', milestoneIndex, 'stages', stageIndex, 'skill'],
          });
        }
      }
    }
  });

export type ProjectDefinition = z.infer<typeof projectSchema>;

export function isExplorationStage(stage: StageDefinition | undefined): stage is Extract<
  StageDefinition,
  { kind: 'produce' }
> & {
  exploration: { introduction: string };
} {
  return stage?.kind === 'produce' && stage.exploration !== undefined;
}
