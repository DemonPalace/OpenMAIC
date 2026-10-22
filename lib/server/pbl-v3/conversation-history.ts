import 'server-only';
import type { Queryable } from '@openmaic/storage/agent-session/pg';
import type { PersistedAgentSessionEvent } from '@openmaic/storage';

export const CONVERSATION_BYTES = 512 * 1024;

/** Bound raw JSON before it reaches the app; retained tool payloads are never clipped or rewritten. */
export async function readConversationHistory(
  db: Queryable,
  sessionId: string,
  through: number,
  limit: number,
): Promise<PersistedAgentSessionEvent[]> {
  const result = await db.query<{
    id: number;
    ts: string | number;
    attempt: number;
    type: string;
    data: unknown;
  }>(
    `WITH recent AS (
       SELECT e.seq,e.ts,e.attempt,e.type,e.data,octet_length(e.data::text) AS bytes
       FROM agent_session_events e JOIN agent_sessions a ON a.id=e.session_id
       WHERE e.session_id=$1 AND e.seq<=$2 AND a.deleted_at IS NULL
       ORDER BY e.seq DESC LIMIT $3
     ), bounded AS (
       SELECT *,sum(CASE WHEN bytes<=$4 THEN bytes ELSE 0 END) OVER (ORDER BY seq DESC) AS total
       FROM recent
     ) SELECT seq AS id,ts,attempt,type,
       CASE WHEN bytes<=$4 AND total<=$4 THEN data ELSE jsonb_build_object(
         'pblContentOmitted',true,'toolName',left(data->>'toolName',100),
         'toolCallId',left(data->>'toolCallId',200),'isError',data->'isError',
         'status',data->'status','pblOpening',data->'pblOpening') END AS data
     FROM bounded ORDER BY seq`,
    [sessionId, through, limit, CONVERSATION_BYTES],
  );
  return result.rows.map((event) => ({ ...event, ts: Number(event.ts) }));
}
