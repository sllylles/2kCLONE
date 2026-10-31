class_name CourtSpec
extends RefCounted
## Regulation court dimensions (feet) and helpers.
##
## World axes: X runs along the 94 ft length, Z across the 50 ft width, Y up.
## Origin is the center of the court at floor level. side = +1 is the basket
## at +X, side = -1 the basket at -X. Godot units are meters.

const FT := 0.3048
const IN := FT / 12.0

const LENGTH := 94.0
const WIDTH := 50.0
const HALF_LENGTH := LENGTH / 2.0
const HALF_WIDTH := WIDTH / 2.0
const LINE_WIDTH := 2.0 / 12.0

const RIM_HEIGHT := 10.0
const RIM_RADIUS := 9.0 / 12.0               # 18" inner diameter
const RIM_TUBE := 0.3 / 12.0 * 1.5
const BACKBOARD_FROM_BASELINE := 4.0
const BASKET_FROM_BASELINE := 5.25            # backboard 4' + 15" to rim center
const BACKBOARD_WIDTH := 6.0
const BACKBOARD_HEIGHT := 3.5
const BACKBOARD_BOTTOM := 9.5                 # rim sits 6" above the lower edge
const BOX_WIDTH := 2.0                        # shooter's square
const BOX_HEIGHT := 1.5

const THREE_ARC_RADIUS := 23.75               # 23'9"
const THREE_CORNER_DIST := 22.0
const LANE_WIDTH := 16.0
const FREE_THROW_LINE_FROM_BASELINE := 19.0   # 15' from the backboard
const FREE_THROW_CIRCLE_RADIUS := 6.0
const RESTRICTED_RADIUS := 4.0
const CENTER_CIRCLE_RADIUS := 6.0
const CENTER_INNER_RADIUS := 2.0
const COACH_HASH_FROM_BASELINE := 28.0

const BALL_RADIUS := 4.7 / 12.0               # size 7 ball, ~29.5" circumference


static func ft(v: float) -> float:
	return v * FT


static func to_m(v: Vector3) -> Vector3:
	return v * FT


static func to_ft(v: Vector3) -> Vector3:
	return v / FT


## Distance of the basket center from mid-court along X, in feet.
static func basket_x() -> float:
	return HALF_LENGTH - BASKET_FROM_BASELINE


## Rim center in world meters.
static func basket_position(side: int) -> Vector3:
	return Vector3(signf(side) * basket_x(), RIM_HEIGHT, 0.0) * FT


## How far the straight corner-three lines run out from the baseline.
## Where the 22' lines meet the 23'9" arc: 5.25 + sqrt(23.75² - 22²) ≈ 14.2'.
static func corner_three_length() -> float:
	return BASKET_FROM_BASELINE + sqrt(THREE_ARC_RADIUS * THREE_ARC_RADIUS - THREE_CORNER_DIST * THREE_CORNER_DIST)


## True if a shot taken from court position (feet, x/z on the floor plane)
## at the basket on `side` is worth three. Players must be fully behind the
## line, so being on the line counts as two.
static func is_three_pointer(pos_ft: Vector2, side: int) -> bool:
	var bx := signf(side) * basket_x()
	var along := absf(pos_ft.x - bx)  # distance toward mid-court
	var from_baseline := HALF_LENGTH - pos_ft.x * signf(side)
	if from_baseline <= corner_three_length():
		return absf(pos_ft.y) > THREE_CORNER_DIST
	return Vector2(along, pos_ft.y).length() > THREE_ARC_RADIUS


static func shot_distance_ft(pos_ft: Vector2, side: int) -> float:
	return pos_ft.distance_to(Vector2(signf(side) * basket_x(), 0.0))


static func in_bounds(pos_ft: Vector2) -> bool:
	return absf(pos_ft.x) < HALF_LENGTH and absf(pos_ft.y) < HALF_WIDTH


static func in_paint(pos_ft: Vector2, side: int) -> bool:
	var from_baseline := HALF_LENGTH - pos_ft.x * signf(side)
	return from_baseline >= 0.0 and from_baseline <= FREE_THROW_LINE_FROM_BASELINE and absf(pos_ft.y) <= LANE_WIDTH / 2.0


static func in_restricted_area(pos_ft: Vector2, side: int) -> bool:
	return shot_distance_ft(pos_ft, side) <= RESTRICTED_RADIUS
