/** 计算与 Registry / Relay 一致的块 SHA-256（hex） */
export async function computeBlockHashSha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export interface BlockHashEntry {
  token: string;
  blockHash: string;
}
