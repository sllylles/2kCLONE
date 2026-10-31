class_name ShotTiming
extends RefCounted
## Shot meter math. The player holds Shoot through the gather and lets go at
## the top of the jump; the meter is full at the ideal release point. How
## forgiving that moment is (the green window) depends on the shooter's
## rating, how hard the shot is contested, fatigue, and shot difficulty.
## Pure logic: unit tested in tests/unit/test_shot_timing.gd.

enum Grade { EXCELLENT, GOOD, SLIGHTLY_EARLY, SLIGHTLY_LATE, EARLY, LATE, VERY_EARLY, VERY_LATE }

const GRADE_TEXT := {
	Grade.EXCELLENT: "EXCELLENT", Grade.GOOD: "GOOD",
	Grade.SLIGHTLY_EARLY: "SLIGHTLY EARLY", Grade.SLIGHTLY_LATE: "SLIGHTLY LATE",
	Grade.EARLY: "EARLY", Grade.LATE: "LATE",
	Grade.VERY_EARLY: "VERY EARLY", Grade.VERY_LATE: "VERY LATE",
}
## Multiplier on the make probability for each grade.
const GRADE_FACTOR := {
	Grade.EXCELLENT: 1.55, Grade.GOOD: 1.12,
	Grade.SLIGHTLY_EARLY: 0.8, Grade.SLIGHTLY_LATE: 0.8,
	Grade.EARLY: 0.5, Grade.LATE: 0.5,
	Grade.VERY_EARLY: 0.15, Grade.VERY_LATE: 0.15,
}
const BASE_GREEN := 0.034     # seconds either side of perfect, for an average open shot
const MAX_MAKE := 0.97

## Shot difficulty presets (bigger = harder).
const DIFFICULTY := {
	"jumpshot": 1.0, "jumpshot_moving": 1.35, "stepback": 1.5, "floater": 1.2,
	"layup": 0.6, "dunk": 0.35,
}

## Half-width (seconds) of the green window.
## rating 25-99, contest 0 (open) .. 1 (smothered), fatigue 0 (fresh) .. 1 (gassed).
static func green_window(rating: float, contest: float, fatigue: float, difficulty: float) -> float:
	var r := lerpf(0.45, 1.45, clampf((rating - 25.0) / 74.0, 0.0, 1.0))
	var c := lerpf(1.0, 0.35, clampf(contest, 0.0, 1.0))
	var f := lerpf(1.0, 0.6, clampf(fatigue, 0.0, 1.0))
	var d := 1.0 / maxf(0.2, difficulty)
	return BASE_GREEN * r * c * f * d


## Grade a release that was `offset` seconds from perfect (negative = early).
static func grade(offset: float, window: float) -> Grade:
	var a := absf(offset)
	var early := offset < 0.0
	if a <= window:
		return Grade.EXCELLENT
	if a <= window * 2.2:
		return Grade.GOOD
	if a <= window * 4.0:
		return Grade.SLIGHTLY_EARLY if early else Grade.SLIGHTLY_LATE
	if a <= window * 7.0:
		return Grade.EARLY if early else Grade.LATE
	return Grade.VERY_EARLY if early else Grade.VERY_LATE


## Final make probability: rating-based chance adjusted by timing.
static func make_chance(base: float, g: Grade) -> float:
	return clampf(base * GRADE_FACTOR[g], 0.01, MAX_MAKE)


## How an AI (or "real player %" mode) times a shot: a release offset drawn
## from a spread that tightens with rating.
static func ai_offset(rating: float, rng: RandomNumberGenerator) -> float:
	var spread := lerpf(0.11, 0.03, clampf((rating - 40.0) / 59.0, 0.0, 1.0))
	return rng.randfn(0.0, spread)


## Contest level from the closest defender: distance (ft), whether the
## defender has a hand up, and relative height (in).
static func contest_level(defender_dist_ft: float, hand_up: bool, height_diff_in: float) -> float:
	var c := clampf((7.0 - defender_dist_ft) / 5.0, 0.0, 1.0)
	if hand_up:
		c = minf(1.0, c * 1.3 + 0.1 * float(defender_dist_ft < 5.0))
	c *= clampf(1.0 + height_diff_in / 40.0, 0.7, 1.3)
	return clampf(c, 0.0, 1.0)


## Base chance from ratings and distance, before timing.
static func base_chance(kind: String, dist_ft: float, three: bool, ratings: Dictionary, contest: float) -> float:
	var pct: float
	match kind:
		"dunk":
			pct = 0.82 + float(ratings.get("dunk", 70)) / 600.0
		"layup":
			pct = 0.42 + float(ratings.get("layup", 70)) / 330.0
		"floater":
			pct = 0.22 + float(ratings.get("close_shot", 70)) / 330.0
		_:
			if three:
				pct = 0.12 + float(ratings.get("three_point", 70)) / 330.0
			else:
				pct = 0.2 + float(ratings.get("mid_range", 70)) / 330.0
	pct -= maxf(0.0, dist_ft - 26.0) * 0.035
	pct *= lerpf(1.0, 0.55, contest)
	return clampf(pct, 0.01, 0.95)
