export type BindValue = string | number | null;
export interface D1Statement {
  bind(...values: BindValue[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: { changes?: number } }>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1Statement;
  batch(stmts: D1Statement[]): Promise<Array<{ success: boolean; meta?: { changes?: number } }>>;
}
export interface Env {
  DB: D1DatabaseLike;
  OWNER_API_TOKEN?: string;
  OWNER_ID?: string;
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
  OIDC_JWKS_URL?: string;
}
export interface Monitor {
  id: string;
  owner_id: string;
  repo_owner: string;
  repo_name: string;
  status: 'ACTIVE' | 'PAUSED';
  interval_minutes: number;
  next_due_at: number;
  last_checked_at: number | null;
  last_sha: string | null;
  fail_count: number;
  last_error_code: string | null;
  lease_token: string | null;
  lease_until: number | null;
  version: number;
  created_at: number;
  updated_at: number;
}
