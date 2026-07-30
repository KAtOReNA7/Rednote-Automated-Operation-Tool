import { afterEach, describe, expect, it } from 'vitest';

import {
  countAssignmentStrata,
  solveExperimentAssignment,
  validateExperimentDesign,
} from '../packages/experiments/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import { experimentDraft, experimentTopics } from './support/experiment-fixtures.js';
import { createExperimentRepositoryFixture } from './support/experiment-repository-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 023 synthetic experiment gold portfolio', () => {
  it('locks one legal single-variable design across four strata and preserves two immutable versions', async () => {
    const fixture = await createExperimentRepositoryFixture('experiment gold 中文 空格');
    try {
      const validation = validateExperimentDesign(fixture.design);
      expect(validation).toMatchObject({
        futureBoundVariable: false,
        valid: true,
      });
      const created = fixture.repository.createDraft(
        'primary',
        fixture.design,
        '2026-07-30T08:02:00.000Z',
      );
      const preview = fixture.repository.previewAssignment(created.experimentId);
      expect(preview.result).toMatchObject({
        armCounts: { control: 4, treatment: 4 },
        distinctWorkCount: 8,
        status: 'READY_TO_LOCK',
      });
      expect(countAssignmentStrata(preview.result.units)).toEqual({
        COLD: 2,
        HOT: 2,
        UNKNOWN: 2,
        WARM: 2,
      });
      const assigned = fixture.repository.saveAssignment(preview, '2026-07-30T08:03:00.000Z');
      const locked = fixture.repository.applyAction(
        fixture.repository.previewAction(assigned.experimentId, 'LOCK', assigned.revision),
        '2026-07-30T08:04:00.000Z',
      );
      const cloned = fixture.repository.cloneVersion(
        locked.experimentId,
        locked.revision,
        { ...fixture.design, name: '合成单变量实验 · 第二不可变版本' },
        '2026-07-30T08:05:00.000Z',
      );
      expect(locked).toMatchObject({
        lockedMeansExecution: false,
        resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
        state: 'LOCKED',
      });
      expect(cloned).toMatchObject({
        assignment: null,
        state: 'DRAFT',
        versionNumber: 2,
      });
      expect(
        fixture.database
          .prepare(
            `SELECT
               (SELECT count(*) FROM experiments) AS experiments,
               (SELECT count(*) FROM experiment_design_versions
                WHERE schema_version = 'experiment-design-v1') AS designs,
               (SELECT count(*) FROM experiment_arms) AS arms,
               (SELECT count(*) FROM experiment_primary_metrics) AS metrics,
               (SELECT count(*) FROM experiment_guardrails) AS guardrails,
               (SELECT count(*) FROM experiment_replication_structures) AS structures,
               (SELECT count(*) FROM experiment_assignment_plans) AS assignments,
               (SELECT count(*) FROM experiment_assignment_units) AS units`,
          )
          .get(),
      ).toEqual({
        arms: 4,
        assignments: 1,
        designs: 2,
        experiments: 1,
        guardrails: 4,
        metrics: 2,
        structures: 2,
        units: 8,
      });
      expect(
        fixture.database
          .prepare('SELECT count(*) AS count FROM experiment_state_transitions')
          .get(),
      ).toEqual({ count: 4 });
      for (const table of [
        'content_briefs',
        'drafts',
        'assets',
        'quality_checks',
        'approvals',
        'post_packages',
        'publications',
      ]) {
        expect(
          fixture.database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
          table,
        ).toEqual({ count: 0 });
      }
    } finally {
      fixture.database.close();
    }
  });

  it('separates invalid multi-variable and insufficient-replication outcomes', () => {
    const legal = experimentDraft();
    const illegal = {
      ...legal,
      primaryVariable: {
        ...legal.primaryVariable,
        arms: legal.primaryVariable.arms.map((arm) => ({
          ...arm,
          changedDimensions: ['CONTENT_STRUCTURE', 'TITLE_PATTERN'],
        })),
      },
    };
    expect(() => validateExperimentDesign(illegal)).toThrow(/EXPERIMENT_POLICY_BLOCKED/iu);

    const insufficient = experimentDraft(2);
    expect(
      solveExperimentAssignment({
        design: insufficient,
        topics: experimentTopics(insufficient),
      }),
    ).toMatchObject({
      distinctWorkCount: 2,
      status: 'INSUFFICIENT_REPLICATION',
    });
  });
});
