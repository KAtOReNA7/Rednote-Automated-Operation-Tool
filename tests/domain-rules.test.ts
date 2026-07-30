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
  it('starts every work at UNCLASSIFIED', () => {
    expect(createDefaultReadingState()).toBe(ReadingState.UNCLASSIFIED);
  });

  it('allows only an explicit user action to change any reading state', () => {
    expect(
      transitionReadingState(ReadingState.UNCLASSIFIED, ReadingState.R1_READ_CLEAR, {
        actor: ReadingTransitionActor.USER,
        explicitlyConfirmed: true,
      }),
    ).toBe(ReadingState.R1_READ_CLEAR);

    expect(() =>
      transitionReadingState(ReadingState.UNCLASSIFIED, ReadingState.S1_RESEARCH_ONLY, {
        actor: ReadingTransitionActor.SYSTEM,
        explicitlyConfirmed: true,
      }),
    ).toThrow(ReadingStateConfirmationRequiredError);

    expect(() =>
      transitionReadingState(ReadingState.UNCLASSIFIED, ReadingState.R2_READ_FUZZY, {
        actor: ReadingTransitionActor.USER,
        explicitlyConfirmed: false,
      }),
    ).toThrow(ReadingStateConfirmationRequiredError);
  });

  it.each([
    ReadingState.R2_READ_FUZZY,
    ReadingState.R3_READ_UNCONFIRMED_DETAILS,
    ReadingState.S1_RESEARCH_ONLY,
    ReadingState.S2_RESEARCH_INSUFFICIENT,
    ReadingState.UNCLASSIFIED,
  ])('forbids specific first-person experience for %s', (readingState) => {
    expect(allowsSpecificFirstPersonExperience(readingState)).toBe(false);
  });

  it('allows personal score for R1, or R2 with a current per-item score assertion', () => {
    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: false,
        readingState: ReadingState.R1_READ_CLEAR,
        researchDossierReady: false,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: true,
      }),
    ).toBe(true);

    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: false,
        readingState: ReadingState.R1_READ_CLEAR,
        researchDossierReady: false,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: false,
      }),
    ).toBe(false);

    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: true,
        readingState: ReadingState.R2_READ_FUZZY,
        researchDossierReady: false,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: true,
      }),
    ).toBe(true);

    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: false,
        readingState: ReadingState.R2_READ_FUZZY,
        researchDossierReady: false,
        scoreType: ScoreType.PERSONAL,
        userConfirmedScore: true,
      }),
    ).toBe(false);
  });

  it('requires a ready dossier for research score and keeps internal prediction private', () => {
    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: false,
        readingState: ReadingState.S1_RESEARCH_ONLY,
        researchDossierReady: true,
        scoreType: ScoreType.RESEARCH_ANALYSIS,
        userConfirmedScore: false,
      }),
    ).toBe(true);

    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: false,
        readingState: ReadingState.R1_READ_CLEAR,
        researchDossierReady: false,
        scoreType: ScoreType.INTERNAL_PREDICTION,
        userConfirmedScore: true,
      }),
    ).toBe(false);

    expect(
      allowsPublicScore({
        currentPersonalScoreAssertion: false,
        readingState: ReadingState.S1_RESEARCH_ONLY,
        researchDossierReady: false,
        scoreType: ScoreType.RESEARCH_ANALYSIS,
        userConfirmedScore: false,
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
