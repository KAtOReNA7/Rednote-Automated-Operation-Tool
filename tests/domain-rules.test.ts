import { describe, expect, it } from 'vitest';

import {
  ReadingState,
  ReadingStateConfirmationRequiredError,
  ReadingTransitionActor,
  ScoreType,
  SpoilerLevel,
  allowsPublicScore,
  allowsSpecificFirstPersonExperience,
  createDefaultReadingState,
  hasRequiredSpoilerWarnings,
  transitionReadingState,
} from '../packages/core/src/index.js';

describe('reading authenticity rules', () => {
  it('starts every work at UNKNOWN', () => {
    expect(createDefaultReadingState()).toBe(ReadingState.UNKNOWN);
  });

  it('allows only an explicit user action to set READ_CLEAR', () => {
    expect(
      transitionReadingState(ReadingState.UNKNOWN, ReadingState.READ_CLEAR, {
        actor: ReadingTransitionActor.USER,
        explicitlyConfirmed: true,
      }),
    ).toBe(ReadingState.READ_CLEAR);

    expect(() =>
      transitionReadingState(ReadingState.UNKNOWN, ReadingState.READ_CLEAR, {
        actor: ReadingTransitionActor.SYSTEM,
        explicitlyConfirmed: true,
      }),
    ).toThrow(ReadingStateConfirmationRequiredError);

    expect(() =>
      transitionReadingState(ReadingState.UNKNOWN, ReadingState.READ_CLEAR, {
        actor: ReadingTransitionActor.USER,
        explicitlyConfirmed: false,
      }),
    ).toThrow(ReadingStateConfirmationRequiredError);
  });

  it.each([
    ReadingState.UNKNOWN,
    ReadingState.READ_FUZZY,
    ReadingState.READ_UNVERIFIED,
    ReadingState.NOT_READ,
  ])('forbids specific first-person experience for %s', (readingState) => {
    expect(allowsSpecificFirstPersonExperience(readingState)).toBe(false);
  });

  it('allows a personal public score only after clear reading and score confirmation', () => {
    expect(
      allowsPublicScore({
        readingState: ReadingState.READ_CLEAR,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: true,
      }),
    ).toBe(true);

    expect(
      allowsPublicScore({
        readingState: ReadingState.READ_CLEAR,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: false,
      }),
    ).toBe(false);

    expect(
      allowsPublicScore({
        readingState: ReadingState.UNKNOWN,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: true,
      }),
    ).toBe(false);
  });

  it('allows research analysis publicly and keeps internal prediction private', () => {
    expect(
      allowsPublicScore({
        readingState: ReadingState.UNKNOWN,
        scoreType: ScoreType.RESEARCH_ANALYSIS,
        userConfirmedScore: false,
      }),
    ).toBe(true);

    expect(
      allowsPublicScore({
        readingState: ReadingState.READ_CLEAR,
        scoreType: ScoreType.INTERNAL_PREDICTION,
        userConfirmedScore: true,
      }),
    ).toBe(false);
  });
});

describe('spoiler warning rules', () => {
  it('allows no-spoiler content without warnings', () => {
    expect(
      hasRequiredSpoilerWarnings(SpoilerLevel.NONE, {
        bodyOpening: false,
        cover: false,
        title: false,
      }),
    ).toBe(true);
  });

  it('accepts a light-spoiler warning in either the title or body opening', () => {
    expect(
      hasRequiredSpoilerWarnings(SpoilerLevel.LIGHT, {
        bodyOpening: true,
        cover: false,
        title: false,
      }),
    ).toBe(true);
  });

  it('requires all three warnings for full spoilers, then permits export', () => {
    expect(
      hasRequiredSpoilerWarnings(SpoilerLevel.FULL, {
        bodyOpening: true,
        cover: true,
        title: false,
      }),
    ).toBe(false);

    expect(
      hasRequiredSpoilerWarnings(SpoilerLevel.FULL, {
        bodyOpening: true,
        cover: true,
        title: true,
      }),
    ).toBe(true);
  });
});
