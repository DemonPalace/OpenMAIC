import { z } from 'zod';
export interface StageSkillProtocol {
  digest?: string;
  progression: string[];
  final: string;
}
export const SKILL_REVIEW_TOOL = 'request_skill_review';
const receiptSchema = z.object({
  file: z.string(),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.string(),
  question: z.string().min(1).max(2000),
});
export const guidedSkillStateSchema = z
  .object({
    protocolDigest: z.string(),
    activeFile: z.string(),
    reviewedFiles: z.array(z.string()).max(16),
    pending: receiptSchema.optional(),
  })
  .strict();
export type GuidedSkillState = z.infer<typeof guidedSkillStateSchema>;

/** Each part includes production + understanding + review, separated by real student turns. */
export class GuidedSkillReview {
  state: GuidedSkillState;
  private runId = '';
  private studentText = '';
  private eligible = false;
  private advanced = false;
  private ended = false;

  constructor(
    readonly protocol: StageSkillProtocol,
    restored?: GuidedSkillState,
  ) {
    const files = protocol.progression.slice(1);
    const index = restored ? files.indexOf(restored.activeFile) : -1;
    const valid =
      restored !== undefined &&
      restored.protocolDigest === protocol.digest &&
      index >= 0 &&
      JSON.stringify(restored.reviewedFiles) === JSON.stringify(files.slice(0, index)) &&
      (!restored.pending || restored.pending.file === restored.activeFile);
    this.state = valid
      ? structuredClone(restored!)
      : { protocolDigest: protocol.digest!, activeFile: '', reviewedFiles: [] };
  }

  beginRun(runId: string, studentText: string, eligible: boolean): void {
    this.runId = runId;
    this.studentText = studentText;
    this.eligible = eligible;
    this.advanced = false;
    // A retry is still the same student turn, not permission to revise their review.
    this.ended = this.state.pending?.runId === runId;
  }

  assertWritable(): void {
    if (!this.state.activeFile || this.ended)
      throw new Error('先读取当前段协议；提交学生审查任务后必须结束本轮');
  }

  finishRun(): void {
    // A new part can reveal a design conflict that needs a student answer first.
    // Ending that clarification creates no review receipt: advance() and complete()
    // still require a later real delivery and new student feedback.
    this.ended = true;
  }

  private assertFeedback(quote: string | undefined, digest: string): void {
    const pending = this.state.pending;
    if (!pending || pending.runId === this.runId || !this.eligible)
      throw new Error('当前段必须先提交审查任务并等待新的学生回复');
    if (pending.artifactDigest !== digest)
      throw new Error('计划或代码已变化，请复查受影响部分并重新提交当前版本的审查任务');
    // Meaning is assessed by the Skill; a valid Chinese confirmation can be only two characters.
    if (!quote?.trim() || !this.studentText.includes(quote.trim()))
      throw new Error('请引用本轮学生对当前段的实质反馈；不能用助手自查或旧对话代替');
  }

  advance(file: string, quote: string | undefined, digest: string): void {
    if (this.advanced || this.ended)
      throw new Error('本轮只能展开一个内容部分；交付并等待学生反馈后再继续');
    const expected =
      this.protocol.progression[this.state.reviewedFiles.length + (this.state.activeFile ? 2 : 1)];
    if (file !== expected) throw new Error('不能跳过当前段或改变协议顺序');
    if (this.state.activeFile) {
      this.assertFeedback(quote, digest);
      this.state.reviewedFiles.push(this.state.activeFile);
    }
    this.state.activeFile = file;
    delete this.state.pending;
    this.advanced = true;
  }

  checkpoint(question: string, digest: string): GuidedSkillState {
    this.assertWritable();
    if (!question.trim() || question.length > 2000) throw new Error('请给出当前段的具体检查任务');
    this.state.pending = {
      file: this.state.activeFile,
      artifactDigest: digest,
      runId: this.runId,
      question,
    };
    this.ended = true;
    return structuredClone(this.state);
  }

  assertComplete(quote: string | undefined, digest: string): void {
    if (
      this.ended ||
      this.state.activeFile !== this.protocol.final ||
      JSON.stringify(this.state.reviewedFiles) !==
        JSON.stringify(this.protocol.progression.slice(1, -1))
    )
      throw new Error('必须完成各段学生反馈和最终确认，不能以协议已读代替审查');
    this.assertFeedback(quote, digest);
  }

  complete(quote: string | undefined, digest: string): void {
    this.assertComplete(quote, digest);
    this.ended = true;
  }
}
