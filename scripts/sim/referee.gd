class_name Referee
extends RefCounted
## Rules bookkeeping: lane (3-second) and backcourt (8-second) timers,
## over-and-back, goaltending, foul decisions and free-throw counts.
## Pure logic: unit tested in tests/unit/test_referee.gd. Positions in feet.

const LANE_LIMIT := 3.0
const BACKCOURT_LIMIT := 8.0
const PERSONAL_FOUL_LIMIT := 6

var lane_time := {}            # offensive player id -> seconds in the lane
var backcourt_time := 0.0
var crossed := false           # ball has been in the frontcourt this possession


func new_possession(starts_in_backcourt: bool) -> void:
	lane_time.clear()
	backcourt_time = 0.0
	crossed = not starts_in_backcourt


## Frontcourt = the half the offense attacks.
static func in_frontcourt(pos_ft: Vector3, side: int) -> bool:
	return pos_ft.x * side > 0.0


## Call every frame of live play. Returns "" or the violation name.
## `ball_pos` is the ball holder's position (or the ball's), `side` the basket attacked.
func tick_backcourt(ball_pos_ft: Vector3, side: int, delta: float, has_holder: bool) -> String:
	var front := in_frontcourt(ball_pos_ft, side)
	if front:
		crossed = true
		return ""
	if crossed and has_holder:
		return "backcourt"            # over and back
	if not crossed:
		backcourt_time += delta
		if backcourt_time > BACKCOURT_LIMIT:
			return "8 seconds"
	return ""


## Offensive 3 seconds. `paint` = ids of offensive players standing in the
## lane this frame. Resets for anyone out of the lane or when the ball is
## loose / a shot is up. Returns the violator's id or "".
func tick_lane(paint: Array, delta: float, live: bool) -> String:
	for pid in lane_time.keys():
		if not pid in paint:
			lane_time.erase(pid)
	if not live:
		lane_time.clear()
		return ""
	for pid in paint:
		lane_time[pid] = float(lane_time.get(pid, 0.0)) + delta
		if lane_time[pid] > LANE_LIMIT:
			lane_time.erase(pid)
			return pid
	return ""


func lane_seconds(pid: String) -> float:
	return float(lane_time.get(pid, 0.0))


## A defender touching a shot on its way down above the rim (meters, world).
static func is_goaltending(ball_pos: Vector3, ball_vel: Vector3, side: int) -> bool:
	var rim := CourtSpec.basket_position(side)
	if ball_vel.y >= 0.0 or ball_pos.y <= rim.y + 0.05:
		return false
	return Vector2(ball_pos.x - rim.x, ball_pos.z - rim.z).length() < 1.9


## How many free throws a foul is worth.
static func free_throws(shooting: bool, shot_made: bool, three: bool, in_bonus: bool) -> int:
	if shooting:
		if shot_made:
			return 1                      # and-one
		return 3 if three else 2
	return 2 if in_bonus else 0


## Chance contact is called a foul. kind: "shot" (contesting a shot),
## "drive" (body contact on a drive), "reach" (failed steal), "rebound".
## discipline: the defender's relevant defensive rating (higher = cleaner).
static func foul_chance(kind: String, discipline: float, contact: float, foul_rate := 1.0) -> float:
	var base: float = {"shot": 0.12, "drive": 0.02, "reach": 0.04, "rebound": 0.02}.get(kind, 0.03)
	var clean := clampf((discipline - 40.0) / 59.0, 0.0, 1.0)
	return clampf((base + contact * 0.08) * lerpf(1.4, 0.65, clean) * foul_rate, 0.0, 0.85)


## On a drive into a set defender: offensive foul (charge) or blocking foul.
## Charges need the defender planted and outside the restricted area.
static func charge_or_block(defender_speed_ftps: float, defender_pos_ft: Vector3, side: int) -> String:
	var in_ra := CourtSpec.in_restricted_area(Vector2(defender_pos_ft.x, defender_pos_ft.z), side)
	if defender_speed_ftps < 3.0 and not in_ra:
		return "charge"
	return "blocking"


static func fouled_out(personal_fouls: int) -> bool:
	return personal_fouls >= PERSONAL_FOUL_LIMIT
