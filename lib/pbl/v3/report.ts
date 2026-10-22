/** Owner-scoped, saved project report. Public evidence never contains course protocols or answer keys. */
export interface LearningReport {
  studyId: string;
  project: { id: string; version: string; title: string };
  revision: number;
  requiredComplete: boolean;
  milestones: { id: string; title: string; optional: boolean; status: string; stages: string[] }[];
  outcomes?: {
    milestoneId: string;
    tests: string | null;
    quiz: { score: number; total: number; attempt: number } | null;
    reflected: boolean;
  }[];
  counts: Record<string, number>;
  evidence: {
    sequence: number;
    milestoneId?: string;
    kind: string;
    detail: string;
    version?: string;
    truncated?: boolean;
  }[];
  conversations: {
    role: string;
    milestone: string;
    messages: { sequence: number; role: 'user' | 'assistant'; text: string }[];
    truncated: boolean;
  }[];
  truncated: boolean;
  facts?: {
    learnerTurns: number;
    assistantTurns: number;
    decisions: number;
    decisionChanges: number;
    testRuns: number;
    quizAttempts: number;
    fileEdits: number;
    interruptedRuns: number;
  };
  analysis?: {
    status: 'not_generated' | 'generating' | 'ready' | 'failed';
    generatedAt?: string;
    findings: ReportFinding[];
    omitted: boolean;
    canRetry: boolean;
  };
}
export interface ReportFinding {
  category: 'journey' | 'strength' | 'change' | 'collaboration' | 'next';
  title: string;
  detail: string;
  evidence: string[];
  quote?: string;
}
