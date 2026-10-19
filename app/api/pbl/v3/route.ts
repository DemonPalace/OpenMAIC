import { sandboxBody, sandboxPrincipalResponse } from '@/lib/server/sandbox/http';
import { SandboxService } from '@/lib/server/sandbox/service';
import { sandboxInvalid, SandboxError } from '@/lib/sandbox/errors';
import {
  openStudy,
  commandStudy,
  learningView,
  digest,
  projectFor,
  requireEnvironment,
} from '@/lib/server/pbl-v3/runtime';
import type { LearningCommand } from '@/lib/server/pbl-v3/runtime';
import { LearningStore } from '@/lib/server/pbl-v3/store';
import { InvalidEngineTransitionError } from '@/lib/pbl/v3/domain/orchestration/transition';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { installedProject } from '@/lib/server/pbl-v3/catalog';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  return sandboxPrincipalResponse(request, async (principal) => {
    const params = new URL(request.url).searchParams,
      id = params.get('id');
    if (!id) throw sandboxInvalid('A learning session is required.');
    const path = params.get('file');
    if (path !== null) {
      const row = await (await LearningStore.open()).get(id, principal.ownerId);
      if (!Object.hasOwn(projectFor(row).files, path))
        throw sandboxInvalid('Unknown project file.');
      const text = await (
        await SandboxService.forOwner(principal)
      ).readText(requireEnvironment(row), path);
      return Response.json({ text, hash: digest(text) });
    }
    return Response.json(await learningView(principal, id));
  });
}
export async function POST(request: Request) {
  return sandboxPrincipalResponse(request, async (principal) => {
    const body = await sandboxBody(request, 256_000);
    try {
      if (body.action === 'sample') {
        if (typeof body.id !== 'string' || !/^pbl-[a-f0-9-]{36}$/.test(body.id))
          throw sandboxInvalid('A stable classroom ID is required.');
        const project = installedProject({ id: 'greeting-python', version: '1.0.0' });
        const documents = await getOwnerScopedDocumentStore(principal);
        const existing = await documents.loadDocument(body.id);
        if (!existing)
          await documents.createDocument({
            stage: {
              id: body.id,
              name: project.definition.title,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            scenes: [
              {
                id: `${body.id}-scene`,
                stageId: body.id,
                title: project.definition.title,
                type: 'pbl',
                order: 0,
                content: { type: 'pbl', projectV3: project.ref },
                actions: [],
              },
            ],
            outline: {
              outlines: [],
              generationComplete: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          });
        return Response.json({ classroomId: body.id });
      }
      if (body.action === 'open') {
        if (typeof body.stageId !== 'string' || typeof body.sceneId !== 'string')
          throw sandboxInvalid('A classroom and scene are required.');
        const study = await openStudy(principal, body.stageId, body.sceneId);
        return Response.json(await learningView(principal, study.id));
      }
      if (typeof body.studyId !== 'string') throw sandboxInvalid('A learning session is required.');
      const result = await commandStudy(principal, body.studyId, body.command as LearningCommand);
      return Response.json({ result, view: await learningView(principal, body.studyId) });
    } catch (error) {
      if (error instanceof InvalidEngineTransitionError)
        throw new SandboxError(error.code, 409, error.message);
      throw error;
    }
  });
}
