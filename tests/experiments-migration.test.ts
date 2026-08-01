import { afterEach, describe, expect, it } from 'vitest';

import {
  MIGRATIONS,
  connectDatabase,
  initializeDatabase,
  migrationChecksum,
} from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  createTemporaryDatabasePath,
} from './support/database-test-utils.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 023 versioned experiment migration', () => {
  it('keeps v16 as the sole Issue 023 append after frozen v1-v15 history', () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(MIGRATIONS[15]).toMatchObject({
      name: 'versioned_experiment_management',
      version: 16,
    });
    expect(MIGRATIONS.slice(0, 15).map(migrationChecksum)).toHaveLength(15);
  });

  it('conservatively migrates legacy experiments without claiming validation or execution', async () => {
    const databasePath = createTemporaryDatabasePath('experiment upgrade 中文 空格');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 15) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO experiments(
           id, name, hypothesis, primary_metric, guardrail_metrics_json,
           variable_name, variants_json, start_at, end_at, status
         ) VALUES (
           'legacy-experiment-023', '旧实验', '旧假设', 'legacy_metric', '[]',
           'legacy_variable', '["control","treatment"]',
           '2026-07-30T01:00:00.000Z', NULL, 'PLANNED'
         )`,
      )
      .run();
    database.close();

    const result = await initializeDatabase({ databasePath });
    expect(result).toMatchObject({
      appliedVersions: [16, 17, 18, 19, 20],
      schemaVersion: 20,
    });
    expect(result.backupPath).not.toBeNull();
    database = connectDatabase(databasePath);
    try {
      expect(
        database
          .prepare(
            `SELECT experiment_contract_version, experiment_state, experiment_revision
             FROM experiments WHERE id = 'legacy-experiment-023'`,
          )
          .get(),
      ).toEqual({
        experiment_contract_version: 'legacy-experiment-v0',
        experiment_revision: 1,
        experiment_state: 'DRAFT',
      });
      expect(
        database
          .prepare(
            `SELECT schema_version, design_state, primary_variable_kind, primary_metric_id
             FROM experiment_design_versions
             WHERE experiment_id = 'legacy-experiment-023'`,
          )
          .get(),
      ).toEqual({
        design_state: 'DRAFT',
        primary_metric_id: null,
        primary_variable_kind: null,
        schema_version: 'legacy-experiment-v0',
      });
      expect(
        database
          .prepare(
            `SELECT action, actor, reason_code
             FROM experiment_state_transitions
             WHERE experiment_id = 'legacy-experiment-023'`,
          )
          .get(),
      ).toEqual({
        action: 'LEGACY_MIGRATION',
        actor: 'MIGRATION',
        reason_code: 'LEGACY_REVIEW_REQUIRED',
      });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('creates strict normalized history, assignment, dependency, and audit tables', async () => {
    const { database } = await createInitializedDatabase('experiment strict schema');
    try {
      const tables = [
        'experiment_design_versions',
        'experiment_primary_variables',
        'experiment_arms',
        'experiment_controlled_conditions',
        'experiment_primary_metrics',
        'experiment_guardrails',
        'experiment_replication_structures',
        'experiment_sample_plans',
        'experiment_popularity_snapshots',
        'experiment_assignment_plans',
        'experiment_assignment_units',
        'experiment_current_designs',
        'experiment_current_assignments',
        'experiment_dependencies',
        'experiment_invalidations',
        'experiment_state_transitions',
        'experiment_audit_events',
        'experiment_policy_registry',
        'experiment_policy_events',
      ];
      const rows = database
        .prepare(
          `SELECT name, strict FROM pragma_table_list
           WHERE name IN (${tables.map(() => '?').join(',')})`,
        )
        .all(...tables) as unknown as readonly {
        readonly name: string;
        readonly strict: number;
      }[];
      expect(rows).toHaveLength(tables.length);
      expect(rows.every((row) => row.strict === 1)).toBe(true);
      expect(
        database
          .prepare(
            `SELECT policy_kind, current_version
             FROM experiment_policy_registry ORDER BY policy_kind`,
          )
          .all(),
      ).toEqual([
        {
          current_version: 'experiment-assignment-policy-v1',
          policy_kind: 'ASSIGNMENT_POLICY',
        },
        { current_version: 'experiment-metric-registry-v1', policy_kind: 'METRIC_POLICY' },
        { current_version: 'work-popularity-stratum-v1', policy_kind: 'POPULARITY_POLICY' },
        {
          current_version: 'experiment-replication-policy-v1',
          policy_kind: 'REPLICATION_STRUCTURE',
        },
        {
          current_version: 'experiment-variable-registry-v1',
          policy_kind: 'VARIABLE_POLICY',
        },
      ]);
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rolls back every v16 write when its final statement fails', async () => {
    const databasePath = createTemporaryDatabasePath('experiment rollback');
    await initializeDatabase({ databasePath, migrations: MIGRATIONS.slice(0, 15) });
    let database = connectDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO experiments(
           id, name, hypothesis, primary_metric, guardrail_metrics_json,
           variable_name, variants_json, start_at, status
         ) VALUES (
           'legacy-rollback-023', '旧实验', '旧假设', 'metric', '[]',
           'variable', '[]', '2026-07-30T01:00:00.000Z', 'PLANNED'
         )`,
      )
      .run();
    database.close();

    const migration = MIGRATIONS[15];
    if (migration === undefined) throw new Error('Missing v16 migration.');
    await expect(
      initializeDatabase({
        databasePath,
        migrations: [
          ...MIGRATIONS.slice(0, 15),
          {
            ...migration,
            sql: `${migration.sql}\nINSERT INTO issue023_missing_table(id) VALUES (1);`,
          },
        ],
      }),
    ).rejects.toThrow();

    database = connectDatabase(databasePath);
    try {
      expect(
        database.prepare('SELECT max(version) AS version FROM schema_migrations').get(),
      ).toEqual({ version: 15 });
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_master
             WHERE type = 'table' AND name = 'experiment_design_versions'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare(`SELECT status FROM experiments WHERE id = 'legacy-rollback-023'`).get(),
      ).toEqual({ status: 'PLANNED' });
      expect(database.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    } finally {
      database.close();
    }
  });
});
