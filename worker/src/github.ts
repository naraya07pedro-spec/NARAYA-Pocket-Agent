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
    const text = await response.text();
    if (text.length > 32768) throw new Error('oversize');
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data) || !data.length || typeof data[0]?.sha !== 'string' ||
        !/^[a-fA-F0-9]{40}$/.test(data[0].sha)) throw new Error('invalid');
    return data[0].sha.toLowerCase();
  } catch { throw new GithubReadError('INVALID_PROVIDER_DATA'); }
}
