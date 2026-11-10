import type { Env } from './types.ts';

/**
 * Configuration eligibility, NOT proof that a remote Worker/Cron is deployed.
 * The operator-owned, globally default-OFF Cron switch AND the end-user mobile
 * permission are independent requirements. A valid operator owner context is
 * needed because runScheduler() fails closed without it.
 */
export function mobileSchedulerConfigured(env: Pick<Env,
  'SCHEDULER_ENABLED' | 'MOBILE_SCHEDULING_ENABLED' | 'OWNER_ID'>): boolean {
  return env.SCHEDULER_ENABLED === 'true' &&
    env.MOBILE_SCHEDULING_ENABLED === 'true' &&
    typeof env.OWNER_ID === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(env.OWNER_ID);
}
