class_name ReplayRecorder
extends Node
## Ring buffer of transforms for every tracked node (players, ball). Playback
## drives those same nodes from the buffer at reduced speed while the live
## simulation is paused, then restores the live state.

signal playback_finished

const RATE := 30.0               # samples per second
const SECONDS := 10.0

var tracked: Array[Node3D] = []
var playing := false
var speed := 0.6

var _frames: Array = []          # Array of Array[Transform3D]
var _accum := 0.0
var _cursor := 0.0
var _start := 0
var _live_snapshot: Array = []


func track(node: Node3D) -> void:
	tracked.append(node)


func clear() -> void:
	_frames.clear()


func capacity() -> int:
	return int(RATE * SECONDS)


func frame_count() -> int:
	return _frames.size()


func record_now() -> void:
	var f: Array[Transform3D] = []
	for n in tracked:
		f.append(n.global_transform)
	_frames.append(f)
	if _frames.size() > capacity():
		_frames.pop_front()


func _physics_process(delta: float) -> void:
	if playing:
		_cursor += delta * RATE * speed
		if _cursor >= _frames.size() - 1:
			stop()
			return
		_apply(_cursor)
		return
	_accum += delta
	while _accum >= 1.0 / RATE:
		_accum -= 1.0 / RATE
		record_now()


## Plays back the last `seconds` of action. Returns the playback duration in
## real seconds (0 if there is nothing recorded).
func play(seconds: float) -> float:
	if _frames.size() < 4:
		return 0.0
	_live_snapshot = []
	for n in tracked:
		_live_snapshot.append(n.global_transform)
	var n_frames := mini(int(seconds * RATE), _frames.size())
	_start = _frames.size() - n_frames
	_cursor = float(_start)
	playing = true
	return n_frames / RATE / speed


func stop() -> void:
	if not playing:
		return
	playing = false
	for i in mini(tracked.size(), _live_snapshot.size()):
		tracked[i].global_transform = _live_snapshot[i]
	playback_finished.emit()


func _apply(cursor: float) -> void:
	var i := int(cursor)
	var t := cursor - i
	var a: Array = _frames[i]
	var b: Array = _frames[mini(i + 1, _frames.size() - 1)]
	for k in mini(tracked.size(), a.size()):
		tracked[k].global_transform = (a[k] as Transform3D).interpolate_with(b[k], t)
