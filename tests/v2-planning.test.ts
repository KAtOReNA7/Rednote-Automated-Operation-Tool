import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ACCOUNT_PERSONA,
  ScriptedPlanningProvider,
  V2ApplicationFacade,
  V2ContractError,
  V2_DEFAULT_WEEK_KEY,
  parseAccountPersona,
  parseAccountPersonaFields,
  parseV2MutationRequest,
  type PlanRescheduleFields,
  type WeeklyPlan,
} from '../packages/v2/src/index.js';
import { MemoryV2Repository } from './support/v2-test-runtime.js';

function reschedule(
  overrides: Partial<PlanRescheduleFields> & { readonly allowConflicts?: boolean } = {},
) {
  return {
    action: 'RESCHEDULE_PLAN_CANDIDATES' as const,
    allowConflicts: overrides.allowConflicts ?? false,
    candidateIds: overrides.candidateIds ?? ['mon-1'],
    date: Object.hasOwn(overrides, 'date') ? (overrides.date ?? null) : '2026-07-27',
    expectedRevision: overrides.expectedRevision ?? 0,
    mode: overrides.mode ?? ('DATE_TIME' as const),
    staggerMinutes: overrides.staggerMinutes ?? 0,
    time: Object.hasOwn(overrides, 'time') ? (overrides.time ?? null) : '14:00',
    weekKey: overrides.weekKey ?? V2_DEFAULT_WEEK_KEY,
  };
}

function previewFields(overrides: Partial<PlanRescheduleFields> = {}): PlanRescheduleFields {
  const { action, allowConflicts, ...fields } = reschedule(overrides);
  void action;
  void allowConflicts;
  return fields;
}

function errorFrom(action: () => unknown): V2ContractError {
  try {
    action();
  } catch (error) {
    if (error instanceof V2ContractError) return error;
    throw error;
  }
  throw new Error('Expected a V2ContractError.');
}

describe('V2 R03 persona-driven planning', () => {
  it('reports every incomplete persona field and rejects bounded invalid schedule inputs', () => {
    const incomplete = errorFrom(() =>
      parseAccountPersonaFields({ audience: '', boundary: '', name: '', tone: '' }),
    );
    expect(incomplete.affectedFields).toEqual(['audience', 'boundary', 'name', 'tone']);

    for (const invalid of [
      reschedule({ date: '2026-02-30' }),
      reschedule({ time: '24:00' }),
      reschedule({ date: null, mode: 'DATE_TIME' }),
      reschedule({ date: '2026-07-27', mode: 'TIME_ONLY' }),
      reschedule({ staggerMinutes: 15 as 0 }),
      reschedule({ mode: 'DATE_ONLY', staggerMinutes: 30, time: null }),
    ]) {
      expect(() => parseV2MutationRequest(invalid)).toThrow(V2ContractError);
    }
  });

  it('generates stable, persona-sensitive, bounded candidates without appending', () => {
    const provider = new ScriptedPlanningProvider();
    const input = {
      persona: DEFAULT_ACCOUNT_PERSONA,
      planRevision: 0,
      weekKey: V2_DEFAULT_WEEK_KEY,
    };
    const first = provider.generate(input);
    expect(provider.generate(input)).toEqual(first);
    expect(first).toHaveLength(21);
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
    expect(first.every(({ date }) => /^2026-\d{2}-\d{2}$/u.test(date))).toBe(true);

    const changed = provider.generate({
      ...input,
      persona: parseAccountPersona({ ...DEFAULT_ACCOUNT_PERSONA, tone: '温和而简洁' }),
    });
    expect(changed.map(({ title }) => title)).not.toEqual(first.map(({ title }) => title));

    const repository = new MemoryV2Repository();
    const facade = new V2ApplicationFacade(repository, provider);
    facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY });
    const generated = facade.mutate({
      action: 'GENERATE_WEEKLY_PLAN',
      expectedRevision: 0,
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    const repeated = facade.mutate({
      action: 'GENERATE_WEEKLY_PLAN',
      expectedRevision: generated.revision,
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    expect(repeated.revision).toBe(generated.revision);
    expect(repeated.candidates).toEqual(generated.candidates);
  });

  it('locks only a complete confirmed plan and rejects every normal mutation after locking', () => {
    const facade = new V2ApplicationFacade(new MemoryV2Repository());
    const initial = facade.read({
      view: 'WEEKLY_PLAN',
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    const confirmed = facade.mutate({
      action: 'CONFIRM_PLAN_CANDIDATES',
      candidateIds: initial.candidates.map(({ id }) => id),
      expectedRevision: 0,
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    expect(confirmed.candidates.every(({ status }) => status === 'CONFIRMED')).toBe(true);
    const locked = facade.mutate({
      action: 'LOCK_WEEKLY_PLAN',
      expectedRevision: confirmed.revision,
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    expect(locked.status).toBe('CONFIRMED');
    expect(
      errorFrom(() =>
        facade.mutate({
          action: 'CONFIRM_PLAN_CANDIDATES',
          candidateIds: ['sun-3'],
          expectedRevision: locked.revision,
          weekKey: V2_DEFAULT_WEEK_KEY,
        }),
      ).code,
    ).toBe('PLAN_LOCKED');
  });

  it.each([
    {
      expected: { targetDate: '2026-08-04', targetTime: '10:00' },
      fields: previewFields({ date: '2026-08-04', mode: 'DATE_ONLY', time: null }),
      name: 'date only',
    },
    {
      expected: { targetDate: '2026-07-27', targetTime: '18:30' },
      fields: previewFields({ date: null, mode: 'TIME_ONLY', time: '18:30' }),
      name: 'time only',
    },
    {
      expected: { targetDate: '2026-08-04', targetTime: '18:30' },
      fields: previewFields({ date: '2026-08-04', mode: 'DATE_TIME', time: '18:30' }),
      name: 'date and time',
    },
  ])('previews $name without writing', ({ expected, fields }) => {
    const facade = new V2ApplicationFacade(new MemoryV2Repository());
    const before = facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY }) as WeeklyPlan;
    const preview = facade.read({ view: 'PLAN_RESCHEDULE_PREVIEW', ...fields });
    expect(preview).toMatchObject({ affectedCount: 1, items: [expect.objectContaining(expected)] });
    const after = facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY }) as WeeklyPlan;
    expect(after).toEqual(before);
  });

  it('previews cross-week staggering and preserves conflicts until explicit apply', () => {
    const facade = new V2ApplicationFacade(new MemoryV2Repository());
    facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY });
    const staggered = facade.read({
      view: 'PLAN_RESCHEDULE_PREVIEW',
      ...previewFields({
        candidateIds: ['thu-1', 'sun-2', 'sun-3'],
        date: '2026-08-05',
        staggerMinutes: 30,
        time: '18:30',
      }),
    });
    expect(staggered).toMatchObject({
      affectedCount: 3,
      crossWeekCount: 3,
    });
    expect(
      (staggered as { items: readonly { targetWeekKey: string }[] }).items.every(
        ({ targetWeekKey }) => targetWeekKey === '2026-W32',
      ),
    ).toBe(true);
    expect(
      (staggered as { items: readonly { time?: string; targetTime: string }[] }).items.map(
        ({ targetTime }) => targetTime,
      ),
    ).toEqual(['18:30', '19:00', '19:30']);

    const beforeConflict = facade.read({
      view: 'WEEKLY_PLAN',
      weekKey: V2_DEFAULT_WEEK_KEY,
    }) as WeeklyPlan;
    const conflictPreview = facade.read({
      view: 'PLAN_RESCHEDULE_PREVIEW',
      ...previewFields(),
    });
    expect(conflictPreview).toMatchObject({ conflictCount: 1 });
    expect(facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY })).toEqual(
      beforeConflict,
    );
    expect(errorFrom(() => facade.mutate(reschedule())).code).toBe('PLAN_CONFLICT');
    expect(facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY })).toEqual(
      beforeConflict,
    );

    const applied = facade.mutate(reschedule({ allowConflicts: true })) as WeeklyPlan;
    expect(applied.candidates.find(({ id }) => id === 'mon-1')?.conflictWithIds).toContain('mon-2');
    expect(applied.candidates.find(({ id }) => id === 'mon-2')?.conflictWithIds).toContain('mon-1');
    const repeated = facade.mutate(
      reschedule({ allowConflicts: true, expectedRevision: applied.revision }),
    ) as WeeklyPlan;
    expect(repeated.revision).toBe(applied.revision);
  });

  it('rejects stale revisions before any partial plan write', () => {
    const facade = new V2ApplicationFacade(new MemoryV2Repository());
    facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY });
    const moved = facade.mutate(
      reschedule({ allowConflicts: true, date: '2026-08-04', time: '18:30' }),
    ) as WeeklyPlan;
    const before = JSON.stringify(moved);
    expect(
      errorFrom(() =>
        facade.mutate({
          action: 'SKIP_PLAN_CANDIDATES',
          candidateIds: ['sun-2'],
          expectedRevision: 0,
          weekKey: V2_DEFAULT_WEEK_KEY,
        }),
      ).code,
    ).toBe('REVISION_CONFLICT');
    expect(JSON.stringify(facade.read({ view: 'WEEKLY_PLAN', weekKey: V2_DEFAULT_WEEK_KEY }))).toBe(
      before,
    );
  });
});
