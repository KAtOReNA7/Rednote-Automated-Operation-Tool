import { describe, expect, it } from 'vitest';

import { V2ApplicationFacade, type WeeklyPlan } from '../packages/v2/src/index.js';
import {
  currentShanghaiWeekIdentity,
  isPlanWeekConsistent,
  nextWeekIdentity,
  weekIdentity,
} from '../apps/web-ui/src/v2/components.js';
import { MemoryV2Repository } from './support/v2-test-runtime.js';

describe('R07 planning week identity', () => {
  it('uses Asia/Shanghai ISO boundaries, including month and year transitions', () => {
    expect(currentShanghaiWeekIdentity(new Date('2026-08-12T06:00:00.000Z'))).toEqual({
      endDate: '2026-08-16',
      startDate: '2026-08-10',
      weekKey: '2026-W33',
    });
    expect(nextWeekIdentity(weekIdentity('2026-W33'))).toEqual({
      endDate: '2026-08-23',
      startDate: '2026-08-17',
      weekKey: '2026-W34',
    });
    expect(weekIdentity('2026-W05')).toMatchObject({
      startDate: '2026-01-26',
      endDate: '2026-02-01',
    });
    expect(weekIdentity('2026-W53')).toMatchObject({
      startDate: '2026-12-28',
      endDate: '2027-01-03',
    });
  });

  it('seeds an unpersisted target week with matching dates and identifies mismatches without writing', () => {
    const facade = new V2ApplicationFacade(new MemoryV2Repository());
    const plan = facade.read({ view: 'WEEKLY_PLAN', weekKey: '2026-W33' }) as WeeklyPlan;
    expect(plan.candidates.every(({ date }) => date >= '2026-08-10' && date <= '2026-08-16')).toBe(
      true,
    );
    expect(isPlanWeekConsistent(plan)).toBe(true);
    const first = plan.candidates[0];
    if (first === undefined) throw new Error('Expected a seeded plan candidate.');
    expect(
      isPlanWeekConsistent({
        ...plan,
        candidates: [{ ...first, date: '2026-08-12' }],
      }),
    ).toBe(true);
    expect(isPlanWeekConsistent({ ...plan, weekKey: '2026-W31' })).toBe(false);
  });
});
