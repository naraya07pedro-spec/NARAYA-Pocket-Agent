export type FetchLike = typeof fetch;
export type GithubErrorCode = 'RATE_LIMITED' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'INVALID_PROVIDER_DATA' | 'NETWORK_ERROR';
export class GithubReadError extends Error {
  readonly code: GithubErrorCode;
  constructor(code: GithubErrorCode) { super(code); this.code = code; }
}

export async function readDefaultBranchHead(owner: string, repo: string, fetcher: FetchLike = fetch): Promise<string> {
  // The hostname and path template are fixed by server code. User input is a constrained slug.
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=1`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'naraya-pocket-agent-pilot',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch { throw new GithubReadError('NETWORK_ERROR'); }
  if (response.status === 403 || response.status === 429) throw new GithubReadError('RATE_LIMITED');
  if (response.status === 404 || response.status === 409) throw new GithubReadError('NOT_FOUND');
  if (!response.ok) throw new GithubReadError('UPSTREAM_ERROR');
  try {
    // Limit consumed bytes, not just the length of an already buffered response.
    // Never trust an upstream server to respect Content-Length.
    if (!response.body) throw new Error('empty_body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > 32_768) {
          await reader.cancel();
          throw new Error('oversize');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(data) || !data.length || typeof data[0]?.sha !== 'string' ||
        !/^[a-fA-F0-9]{40}$/.test(data[0].sha)) throw new Error('invalid');
    return data[0].sha.toLowerCase();
  } catch { throw new GithubReadError('INVALID_PROVIDER_DATA'); }
}
