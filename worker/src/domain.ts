export class InputError extends Error {}

export function parseMonitorInput(body: unknown): { owner: string; repo: string; intervalMinutes: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('invalid_body');
  const values = body as Record<string, unknown>;
  if (Object.keys(values).sort().join(',') !== 'intervalMinutes,repository') throw new InputError('invalid_fields');
  if (typeof values.repository !== 'string' || !Number.isInteger(values.intervalMinutes)) throw new InputError('invalid_fields');
  const parts = values.repository.split('/');
  if (parts.length !== 2) throw new InputError('invalid_repository');
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repo) || repo.endsWith('.') || repo.includes('..')) {
    throw new InputError('invalid_repository');
  }
  const intervalMinutes = values.intervalMinutes as number;
  if (intervalMinutes < 30 || intervalMinutes > 1440 || intervalMinutes % 15 !== 0) {
    throw new InputError('invalid_interval');
  }
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase(), intervalMinutes };
}

export function parseStatusInput(body: unknown): { status: 'ACTIVE' | 'PAUSED'; expectedVersion: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('invalid_body');
  const values = body as Record<string, unknown>;
  if (Object.keys(values).sort().join(',') !== 'expectedVersion,status') throw new InputError('invalid_fields');
  if ((values.status !== 'ACTIVE' && values.status !== 'PAUSED') ||
      !Number.isSafeInteger(values.expectedVersion) || (values.expectedVersion as number) < 1) {
    throw new InputError('invalid_status');
  }
  return { status: values.status, expectedVersion: values.expectedVersion as number };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function boundedJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('json_required');
  if (!request.body) throw new InputError('invalid_body');
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) { await reader.cancel(); throw new InputError('payload_too_large'); }
      pieces.push(value);
    }
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) { buffer.set(piece, offset); offset += piece.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError('invalid_json');
  } finally { reader.releaseLock(); }
}

export function ownerId(envOwnerId?: string): string {
  // Missing or invalid authority must never silently become the same shared owner.
  if (!envOwnerId || !/^[A-Za-z0-9_-]{1,64}$/.test(envOwnerId)) {
    throw new InputError('owner_not_configured');
  }
  return envOwnerId;
}
