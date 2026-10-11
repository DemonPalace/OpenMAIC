/**
 * How the agent is told about a material's parse state (#1880): in the
 * knowledge base page's own words (`en-US`), so what it tells teachers matches
 * what they see. A failure is the page's stable reason code and wording, never
 * the backend's diagnostic -- that carries parser endpoints and configuration
 * hints the model would repeat. The diagnostic stays in the server log.
 */
import enUS from '@/lib/i18n/locales/en-US.json';
import {
  extractionReasonCodeOf,
  type MaterialExtractionReasonCode,
} from '@/lib/types/material-extraction-failure';
import { MEDIA_MAX_DURATION_SEC } from '@/lib/types/media-limits';

const page = enUS.workspace.knowledgeBase;

/** A parse state as the page names it. */
export function materialStatusTerm(status: string): string {
  switch (status) {
    case 'pending':
    case 'running':
      return page.status.parsing;
    case 'done':
      return page.status.searchable;
    case 'failed':
      return page.status.failed;
    default:
      return page.status.stored;
  }
}

/** Why a parse failed: the page's code and wording; a generic failure without a known code. */
export function materialFailureForModel(code: unknown): {
  reasonCode?: MaterialExtractionReasonCode;
  reason: string;
} {
  const reasonCode = extractionReasonCodeOf(code);
  if (!reasonCode) return { reason: page.status.failed };
  const copy = page.failure[reasonCode];
  const description = copy.description.replace('{{minutes}}', String(MEDIA_MAX_DURATION_SEC / 60));
  return { reasonCode, reason: `${copy.label}: ${description}` };
}

/** One sentence for the tool descriptions: which words to use with the user. */
export const MATERIAL_STATUS_TERMS =
  `When telling the user about a material's state, use the knowledge base page's words: ` +
  `"${materialStatusTerm('idle')}" (idle), "${materialStatusTerm('running')}" (pending or running), ` +
  `"${materialStatusTerm('done')}" (done), and for failed the returned reason ` +
  `(or "${materialStatusTerm('failed')}"). Do not use other status words such as ` +
  `"extraction failed" or "extraction completed".`;
