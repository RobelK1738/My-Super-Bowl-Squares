import type {
  DigitProbabilityMatrix,
  LiveFeatureVector,
  LiveGameSnapshot,
  RealtimeSquareOddsComputationResult,
  SquareOddsComputationResult,
  SquareOddsComputationSource,
} from "../types";

type BuildRealtimeSquareOddsInput = {
  baseModel: SquareOddsComputationResult;
  snapshot: LiveGameSnapshot;
  rowLabels: number[];
  colLabels: number[];
};

const DIGIT_COUNT = 10;
const TOTAL_REGULATION_SECONDS = 4 * 15 * 60;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const createZeroMatrix = (): DigitProbabilityMatrix =>
  Array.from({ length: DIGIT_COUNT }, () =>
    Array.from({ length: DIGIT_COUNT }, () => 0),
  );

const normalizeMatrix = (matrix: DigitProbabilityMatrix): DigitProbabilityMatrix => {
  const total = matrix
    .flat()
    .reduce((sum, value) => sum + Math.max(0, Number.isFinite(value) ? value : 0), 0);

  if (!Number.isFinite(total) || total <= 0) {
    return Array.from({ length: DIGIT_COUNT }, () =>
      Array.from({ length: DIGIT_COUNT }, () => 1 / 100),
    );
  }

  return matrix.map((row) => row.map((value) => Math.max(value, 0) / total));
};

const finalizeBoardPercentages = (boardPercentages: number[][]): number[][] => {
  const flat = boardPercentages.flat();
  const total = flat.reduce((sum, value) => sum + value, 0);

  if (!Number.isFinite(total) || total <= 0) {
    return Array.from({ length: DIGIT_COUNT }, () =>
      Array.from({ length: DIGIT_COUNT }, () => 1),
    );
  }

  const scale = 100 / total;
  return boardPercentages.map((row) =>
    row.map((value) => clamp(value * scale, 0, 100)),
  );
};

const mapDigitMatrixToBoard = (
  digitMatrix: DigitProbabilityMatrix,
  rowLabels: number[],
  colLabels: number[],
): number[][] => {
  if (rowLabels.length !== DIGIT_COUNT || colLabels.length !== DIGIT_COUNT) {
    throw new Error("Expected 10 row labels and 10 column labels for realtime heatmap.");
  }

  return Array.from({ length: DIGIT_COUNT }, (_, rowIndex) => {
    const rowDigit = rowLabels[rowIndex];
    if (!Number.isInteger(rowDigit) || rowDigit < 0 || rowDigit > 9) {
      throw new Error("Invalid row label while mapping realtime probabilities.");
    }

    return Array.from({ length: DIGIT_COUNT }, (_, colIndex) => {
      const colDigit = colLabels[colIndex];
      if (!Number.isInteger(colDigit) || colDigit < 0 || colDigit > 9) {
        throw new Error("Invalid column label while mapping realtime probabilities.");
      }

      return digitMatrix[rowDigit][colDigit] * 100;
    });
  });
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seed: number): (() => number) => {
  let state = seed || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sampleStandardNormal = (rng: () => number): number => {
  const u1 = Math.max(rng(), 1e-10);
  const u2 = Math.max(rng(), 1e-10);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const samplePoisson = (lambda: number, rng: () => number): number => {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;

  if (lambda > 30) {
    const gaussian = lambda + sampleStandardNormal(rng) * Math.sqrt(lambda);
    return Math.max(0, Math.round(gaussian));
  }

  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;

  while (product > limit) {
    count += 1;
    product *= Math.max(rng(), 1e-10);
  }

  return Math.max(0, count - 1);
};

const buildFeatureVector = (snapshot: LiveGameSnapshot): LiveFeatureVector => {
  const remainingGameSeconds =
    snapshot.clock.secondsRemainingGame ??
    (snapshot.status === "final"
      ? 0
      : snapshot.status === "pregame"
        ? TOTAL_REGULATION_SECONDS
        : Math.max(0, TOTAL_REGULATION_SECONDS - (snapshot.clock.period - 1) * 900));

  const elapsedGameSeconds = clamp(
    TOTAL_REGULATION_SECONDS - remainingGameSeconds,
    0,
    TOTAL_REGULATION_SECONDS,
  );

  const plays = snapshot.plays.slice(-80);
  let homeScoring = 0;
  let awayScoring = 0;
  let homePenalties = 0;
  let awayPenalties = 0;
  let homeTurnovers = 0;
  let awayTurnovers = 0;
  let homeMomentum = 0;
  let awayMomentum = 0;
  let playWeightTotal = 0;

  for (let index = 0; index < plays.length; index += 1) {
    const play = plays[index];
    const recencyWeight = Math.exp(-(plays.length - 1 - index) / 13);
    const teamCode = play.teamCode;

    if (teamCode === snapshot.homeTeamCode) {
      if (play.isScoringPlay) {
        homeScoring += recencyWeight;
        homeMomentum += 1.7 * recencyWeight;
      }
      if (play.isPenalty) {
        homePenalties += recencyWeight;
        homeMomentum -= 1.15 * recencyWeight;
      }
      if (play.isTurnover) {
        homeTurnovers += recencyWeight;
        homeMomentum -= 2 * recencyWeight;
        awayMomentum += 1.2 * recencyWeight;
      }
      if (play.isExplosivePlay) {
        homeMomentum += 0.8 * recencyWeight;
      }
      homeMomentum += play.sentimentScore * 0.7 * recencyWeight;
    } else if (teamCode === snapshot.awayTeamCode) {
      if (play.isScoringPlay) {
        awayScoring += recencyWeight;
        awayMomentum += 1.7 * recencyWeight;
      }
      if (play.isPenalty) {
        awayPenalties += recencyWeight;
        awayMomentum -= 1.15 * recencyWeight;
      }
      if (play.isTurnover) {
        awayTurnovers += recencyWeight;
        awayMomentum -= 2 * recencyWeight;
        homeMomentum += 1.2 * recencyWeight;
      }
      if (play.isExplosivePlay) {
        awayMomentum += 0.8 * recencyWeight;
      }
      awayMomentum += play.sentimentScore * 0.7 * recencyWeight;
    } else {
      homeMomentum += snapshot.sentiment.home * 0.15 * recencyWeight;
      awayMomentum += snapshot.sentiment.away * 0.15 * recencyWeight;
    }

    playWeightTotal += recencyWeight;
  }

  const effectiveWeight = Math.max(playWeightTotal, 1);

  const recentWindowMinutes = clamp(
    Math.max(elapsedGameSeconds / 60, 1),
    1,
    60,
  );

  const playPacePerMinute = plays.length / recentWindowMinutes;

  const homeRecentScoringRate = homeScoring / effectiveWeight;
  const awayRecentScoringRate = awayScoring / effectiveWeight;
  const homePenaltyPressure = homePenalties / effectiveWeight;
  const awayPenaltyPressure = awayPenalties / effectiveWeight;
  const homeTurnoverPressure = homeTurnovers / effectiveWeight;
  const awayTurnoverPressure = awayTurnovers / effectiveWeight;

  homeMomentum += snapshot.sentiment.home * 1.25;
  awayMomentum += snapshot.sentiment.away * 1.25;
  homeMomentum -= homePenaltyPressure * 0.9;
  awayMomentum -= awayPenaltyPressure * 0.9;
  homeMomentum -= homeTurnoverPressure * 1.35;
  awayMomentum -= awayTurnoverPressure * 1.35;

  return {
    remainingGameSeconds,
    elapsedGameSeconds,
    homeMomentum: clamp(homeMomentum, -2.6, 2.6),
    awayMomentum: clamp(awayMomentum, -2.6, 2.6),
    homePenaltyPressure: clamp(homePenaltyPressure, 0, 2.5),
    awayPenaltyPressure: clamp(awayPenaltyPressure, 0, 2.5),
    homeTurnoverPressure: clamp(homeTurnoverPressure, 0, 2.5),
    awayTurnoverPressure: clamp(awayTurnoverPressure, 0, 2.5),
    homeRecentScoringRate: clamp(homeRecentScoringRate, 0, 2),
    awayRecentScoringRate: clamp(awayRecentScoringRate, 0, 2),
    playPacePerMinute: clamp(playPacePerMinute, 0, 10),
  };
};

const buildDeterministicFinalMatrix = (
  homeScore: number,
  awayScore: number,
): DigitProbabilityMatrix => {
  const matrix = createZeroMatrix();
  const homeDigit = ((homeScore % 10) + 10) % 10;
  const awayDigit = ((awayScore % 10) + 10) % 10;
  matrix[homeDigit][awayDigit] = 1;
  return matrix;
};

const blendMatrices = (
  base: DigitProbabilityMatrix,
  live: DigitProbabilityMatrix,
  liveWeight: number,
): DigitProbabilityMatrix => {
  const clampedLiveWeight = clamp(liveWeight, 0, 1);
  const baseWeight = 1 - clampedLiveWeight;
  const output = createZeroMatrix();

  for (let r = 0; r < DIGIT_COUNT; r += 1) {
    for (let c = 0; c < DIGIT_COUNT; c += 1) {
      output[r][c] = base[r][c] * baseWeight + live[r][c] * clampedLiveWeight;
    }
  }

  return normalizeMatrix(output);
};

const buildSimulationMatrix = (
  snapshot: LiveGameSnapshot,
  featureVector: LiveFeatureVector,
  expectedHomeAdditionalPoints: number,
  expectedAwayAdditionalPoints: number,
): DigitProbabilityMatrix => {
  const remaining = featureVector.remainingGameSeconds;
  const simulationRuns =
    remaining <= 8 * 60 ? 12_000 : remaining <= 20 * 60 ? 10_000 : 8_000;

  const seedBasis = [
    snapshot.eventId,
    snapshot.status,
    snapshot.statusDetail,
    String(snapshot.homeScore),
    String(snapshot.awayScore),
    String(snapshot.clock.period),
    snapshot.clock.displayClock,
    String(snapshot.plays[snapshot.plays.length - 1]?.id ?? "none"),
    String(snapshot.plays.length),
  ].join("|");

  const rng = createSeededRandom(hashString(seedBasis));
  const matrix = createZeroMatrix();

  for (let i = 0; i < simulationRuns; i += 1) {
    const homeAdditional = samplePoisson(expectedHomeAdditionalPoints, rng);
    const awayAdditional = samplePoisson(expectedAwayAdditionalPoints, rng);

    const homeDigit = (snapshot.homeScore + homeAdditional) % DIGIT_COUNT;
    const awayDigit = (snapshot.awayScore + awayAdditional) % DIGIT_COUNT;

    matrix[homeDigit][awayDigit] += 1;
  }

  return normalizeMatrix(matrix);
};

const estimateAdditionalPoints = (
  baseExpectedPoints: number,
  currentScore: number,
  ownMomentum: number,
  opponentMomentum: number,
  ownScoringRate: number,
  ownPenaltyPressure: number,
  ownTurnoverPressure: number,
  playPacePerMinute: number,
  remainingSeconds: number,
  elapsedSeconds: number,
  scoreDiff: number,
): number => {
  const baseRatePerSecond = baseExpectedPoints / TOTAL_REGULATION_SECONDS;
  const observedRatePerSecond =
    currentScore / Math.max(elapsedSeconds, 18 * 60);

  const liveBlendWeight = clamp(elapsedSeconds / (2.2 * 60 * 60), 0.2, 0.9);
  let projectedRate =
    baseRatePerSecond * (1 - liveBlendWeight) + observedRatePerSecond * liveBlendWeight;

  projectedRate *= 1 + ownMomentum * 0.075;
  projectedRate *= 1 + ownScoringRate * 0.28;
  projectedRate *= 1 + clamp(playPacePerMinute - 2.2, -1.4, 2.2) * 0.08;

  projectedRate *= 1 - ownPenaltyPressure * 0.22;
  projectedRate *= 1 - ownTurnoverPressure * 0.32;
  projectedRate *= 1 - clamp(opponentMomentum, -1.5, 2.5) * 0.05;

  if (remainingSeconds <= 8 * 60 && scoreDiff < 0) {
    projectedRate *= 1 + clamp(Math.abs(scoreDiff) / 16, 0, 0.34);
  }

  if (remainingSeconds <= 6 * 60 && scoreDiff > 0) {
    projectedRate *= 1 - clamp(scoreDiff / 20, 0, 0.25);
  }

  const expectedAdditional = projectedRate * remainingSeconds;
  return clamp(expectedAdditional, 0, 35);
};

const getLiveBlendWeight = (featureVector: LiveFeatureVector): number => {
  const elapsedRatio = clamp(
    featureVector.elapsedGameSeconds / TOTAL_REGULATION_SECONDS,
    0,
    1,
  );

  if (featureVector.remainingGameSeconds <= 2 * 60) return 0.99;
  if (featureVector.remainingGameSeconds <= 5 * 60) return 0.95;
  if (featureVector.remainingGameSeconds <= 10 * 60) return 0.9;

  return clamp(0.32 + elapsedRatio * 0.58, 0.32, 0.9);
};

const appendUniqueSources = (
  baseSources: SquareOddsComputationSource[],
  extras: SquareOddsComputationSource[],
): SquareOddsComputationSource[] => {
  const output = new Set<SquareOddsComputationSource>();
  for (const source of baseSources) output.add(source);
  for (const source of extras) output.add(source);
  return Array.from(output);
};

export const buildRealtimeSquareOdds = (
  input: BuildRealtimeSquareOddsInput,
): RealtimeSquareOddsComputationResult => {
  const featureVector = buildFeatureVector(input.snapshot);

  let liveDigitMatrix: DigitProbabilityMatrix;
  let liveBlendWeight = getLiveBlendWeight(featureVector);

  if (input.snapshot.status === "final" || input.snapshot.status === "postponed") {
    liveDigitMatrix = buildDeterministicFinalMatrix(
      input.snapshot.homeScore,
      input.snapshot.awayScore,
    );
    liveBlendWeight = 1;
  } else {
    const scoreDiff = input.snapshot.homeScore - input.snapshot.awayScore;

    const expectedHomeAdditional = estimateAdditionalPoints(
      input.baseModel.expectedHomePoints,
      input.snapshot.homeScore,
      featureVector.homeMomentum,
      featureVector.awayMomentum,
      featureVector.homeRecentScoringRate,
      featureVector.homePenaltyPressure,
      featureVector.homeTurnoverPressure,
      featureVector.playPacePerMinute,
      featureVector.remainingGameSeconds,
      featureVector.elapsedGameSeconds,
      scoreDiff,
    );

    const expectedAwayAdditional = estimateAdditionalPoints(
      input.baseModel.expectedAwayPoints,
      input.snapshot.awayScore,
      featureVector.awayMomentum,
      featureVector.homeMomentum,
      featureVector.awayRecentScoringRate,
      featureVector.awayPenaltyPressure,
      featureVector.awayTurnoverPressure,
      featureVector.playPacePerMinute,
      featureVector.remainingGameSeconds,
      featureVector.elapsedGameSeconds,
      -scoreDiff,
    );

    liveDigitMatrix = buildSimulationMatrix(
      input.snapshot,
      featureVector,
      expectedHomeAdditional,
      expectedAwayAdditional,
    );
  }

  const digitProbabilities = blendMatrices(
    input.baseModel.digitProbabilities,
    liveDigitMatrix,
    liveBlendWeight,
  );

  const boardPercentages = finalizeBoardPercentages(
    mapDigitMatrixToBoard(digitProbabilities, input.rowLabels, input.colLabels),
  );

  const expectedHomePoints =
    liveBlendWeight >= 0.999
      ? input.snapshot.homeScore
      : clamp(
          input.baseModel.expectedHomePoints * (1 - liveBlendWeight) +
            (input.snapshot.homeScore +
              (featureVector.remainingGameSeconds / TOTAL_REGULATION_SECONDS) *
                input.baseModel.expectedHomePoints) *
              liveBlendWeight,
          0,
          70,
        );

  const expectedAwayPoints =
    liveBlendWeight >= 0.999
      ? input.snapshot.awayScore
      : clamp(
          input.baseModel.expectedAwayPoints * (1 - liveBlendWeight) +
            (input.snapshot.awayScore +
              (featureVector.remainingGameSeconds / TOTAL_REGULATION_SECONDS) *
                input.baseModel.expectedAwayPoints) *
              liveBlendWeight,
          0,
          70,
        );

  const warnings = [...input.baseModel.warnings];
  if (input.snapshot.status === "pregame") {
    warnings.push("Live feed connected but game has not started. Realtime adjustments are minimal.");
  }

  const sourcesUsed = appendUniqueSources(input.baseModel.sourcesUsed, [
    "espn_live_scoreboard",
    "espn_live_summary",
    "live_commentary_sentiment",
  ]);

  return {
    boardPercentages,
    digitProbabilities,
    generatedAt: new Date().toISOString(),
    sourceMode: input.baseModel.sourceMode,
    sourcesUsed,
    warnings,
    expectedHomePoints,
    expectedAwayPoints,
    engineMode: "realtime",
    liveEventId: input.snapshot.eventId,
    liveStatus: input.snapshot.status,
    liveStatusDetail: input.snapshot.statusDetail,
    liveClock: `Q${input.snapshot.clock.period} ${input.snapshot.clock.displayClock}`,
    liveSnapshotAt: input.snapshot.fetchedAt,
    featureVector,
  };
};
