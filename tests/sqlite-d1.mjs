import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

function statement(sql, args = [], connection) {
  return {
    bind(...values) { return statement(sql, values, connection); },
    async run() {
      const result = connection.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
    async first() { return connection.prepare(sql).get(...args) ?? null; },
    async all() { return { results: connection.prepare(sql).all(...args) }; },
  };
}
export function makeTestDb() {
  const connection = new DatabaseSync(':memory:');
  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0002_mobile_identity_sync.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0003_scheduler_control.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0004_global_scheduler_budget.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0005_observation_event_sequence.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0006_synthetic_approval_intents.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0007_synthetic_lead_intake.sql', import.meta.url), 'utf8'));
  connection.exec(fs.readFileSync(new URL('../worker/migrations/0008_durable_task_runtime.sql', import.meta.url), 'utf8'));
  return {
    connection,
    prepare(sql) { return statement(sql, [], connection); },
    async batch(stmts) {
      connection.exec('BEGIN IMMEDIATE;');
      try {
        const result = [];
        for (const stmt of stmts) result.push(await stmt.run());
        connection.exec('COMMIT;');
        return result;
      } catch (e) { connection.exec('ROLLBACK;'); throw e; }
    },
    close() { connection.close(); },
  };
}
