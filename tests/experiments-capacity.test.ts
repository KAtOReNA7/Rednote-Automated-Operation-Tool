import { afterEach, describe, expect, it } from 'vitest';

import { solveExperimentAssignment } from '../packages/experiments/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import { experimentDraft, experimentTopics } from './support/experiment-fixtures.js';
import { createExperimentRepositoryFixture } from './support/experiment-repository-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 023 bounded capacity and query plans', () => {
  it('solves the maximum 500-topic input deterministically without loading an unbounded pool', () => {
    const design = experimentDraft(500);
    const topics = experimentTopics(design);
    const first = solveExperimentAssignment({ design, topics });
    const reordered = solveExperimentAssignment({ design, topics: [...topics].reverse() });
    expect(first).toEqual(reordered);
    expect(first).toMatchObject({
      armCounts: { control: 250, treatment: 250 },
      distinctWorkCount: 500,
      status: 'READY_TO_LOCK',
    });
    expect(first.units).toHaveLength(500);
    expect(new Set(first.units.map((unit) => unit.topicId)).size).toBe(500);
  });

  it('enforces 100-row pages and uses indexes for status, history, assignment, and stale lookups', async () => {
    const fixture = await createExperimentRepositoryFixture('experiment capacity');
    try {
      for (let index = 0; index < 220; index += 1) {
        fixture.repository.createDraft(
          'primary',
          { ...fixture.design, name: `容量实验 ${index.toString().padStart(3, '0')}` },
          `2026-07-30T09:${Math.floor(index / 60)
            .toString()
            .padStart(2, '0')}:${(index % 60).toString().padStart(2, '0')}.000Z`,
        );
      }
      const page = fixture.repository.list('primary', {
        limit: 100,
        offset: 120,
        query: '',
        state: 'DRAFT',
      });
      expect(page).toMatchObject({ limit: 100, offset: 120, total: 220 });
      expect(page.items).toHaveLength(100);
      expect(JSON.stringify(page).length).toBeLessThan(150_000);
      expect(() =>
        fixture.repository.list('primary', {
          limit: 101,
          offset: 0,
          query: '',
          state: null,
        }),
      ).toThrow(/EXPERIMENT_INVALID_CONTRACT/iu);

      const plans = [
        fixture.database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT id FROM experiments
             WHERE profile_id = 'primary' AND experiment_state = 'DRAFT'
             ORDER BY updated_at DESC, id LIMIT 100`,
          )
          .all(),
        fixture.database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT id FROM experiment_design_versions
             WHERE experiment_id = ? ORDER BY version_number DESC LIMIT 100`,
          )
          .all(page.items[0]?.experimentId ?? ''),
        fixture.database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT assignment_plan_id FROM experiment_assignment_units
             WHERE work_id = ? AND popularity_stratum = 'UNKNOWN'`,
          )
          .all('experiment-work-1'),
        fixture.database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT design_version_id FROM experiment_dependencies
             WHERE dependency_type = 'WORK_IDENTITY' AND dependency_id = ?`,
          )
          .all('experiment-work-1'),
        fixture.database
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT design_version_id FROM experiment_invalidations
             WHERE dependency_type = 'WORK_IDENTITY' AND dependency_id = ?
             ORDER BY created_at DESC`,
          )
          .all('experiment-work-1'),
      ]
        .flat()
        .map((row) => (row as { readonly detail: string }).detail)
        .join('\n');
      expect(plans).toContain('idx_experiments_profile_state_updated');
      expect(plans).toContain('idx_experiment_design_history');
      expect(plans).toContain('idx_experiment_assignment_work_stratum');
      expect(plans).toContain('idx_experiment_dependency_lookup');
      expect(plans).toContain('idx_experiment_invalidation_dependency');
    } finally {
      fixture.database.close();
    }
  }, 45_000);
});
