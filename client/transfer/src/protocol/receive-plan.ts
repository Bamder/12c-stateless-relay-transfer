import type { TwelveCClient } from '../wasm/twelve-c-client.js';

/** Π_Recv_Adaptive 在获知 num_tokens 后的 token 调度计划 */
export interface ReceiveDownloadPlan {
  numTokens: number;
  initialPrefetch: string[];
  cancelAfterSmb: string[];
  fetchAfterSmb: string[];
}

export function deriveIndexTokens(
  twelveC: TwelveCClient,
  searchCode: string,
  startInclusive: number,
  endExclusive: number,
): string[] {
  if (endExclusive < startInclusive) {
    throw new Error('invalid token index range');
  }

  const tokens: string[] = [];
  for (let index = startInclusive; index < endExclusive; index++) {
    tokens.push(twelveC.deriveUploadToken(searchCode, index));
  }
  return tokens;
}

export function computeReceiveDownloadPlan(
  twelveC: TwelveCClient,
  searchCode: string,
  initialTokens: number,
  numTokens: number,
): ReceiveDownloadPlan {
  if (initialTokens <= 0) {
    throw new Error('initial token count must be greater than zero');
  }

  const plan: ReceiveDownloadPlan = {
    numTokens,
    initialPrefetch: deriveIndexTokens(twelveC, searchCode, 0, initialTokens),
    cancelAfterSmb: [],
    fetchAfterSmb: [],
  };

  if (numTokens > initialTokens) {
    plan.fetchAfterSmb = deriveIndexTokens(
      twelveC,
      searchCode,
      initialTokens,
      numTokens,
    );
  } else if (initialTokens > numTokens) {
    plan.cancelAfterSmb = deriveIndexTokens(
      twelveC,
      searchCode,
      numTokens,
      initialTokens,
    );
  }

  return plan;
}
