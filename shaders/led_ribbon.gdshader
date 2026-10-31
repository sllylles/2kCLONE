shader_type spatial;
// Scrolling LED ribbon board. UV.x is distance along the board in feet,
// UV.y goes 0..1 bottom to top. Alternates between a scrolling text strip
// and animated team-color patterns, with a visible LED pixel grid up close.

render_mode unshaded, cull_back;

uniform sampler2D text_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 color_a : source_color = vec3(0.9, 0.3, 0.1);
uniform vec3 color_b : source_color = vec3(0.1, 0.2, 0.6);
uniform float text_aspect = 12.0;     // text texture width/height
uniform float board_height_ft = 3.0;
uniform float scroll_speed = 6.0;     // feet per second
uniform float brightness = 1.6;
uniform float mode_period = 9.0;      // seconds per content mode
uniform float hype = 0.0;             // 0..1 flashes after big plays
uniform float uv_scale = 1.0;         // multiplies UV.x into feet (for 0..1 quads)
uniform bool v_down = false;          // QuadMesh UVs start at the top

void fragment() {
	float t = TIME;
	float x = UV.x * uv_scale;
	float y = v_down ? 1.0 - UV.y : UV.y;
	float mode = mod(floor(t / mode_period), 3.0);
	vec3 col;
	if (mode < 0.5) {
		vec2 tuv = vec2((x - t * scroll_speed) / (board_height_ft * text_aspect), 1.0 - y);
		vec4 txt = texture(text_tex, tuv);
		col = mix(color_b * 0.6, vec3(1.0), txt.a * txt.r);
	} else if (mode < 1.5) {
		float band = step(0.5, fract((x + y * 2.0) / 8.0 - t * 0.6));
		col = mix(color_a, color_b, band);
	} else {
		float wave = 0.5 + 0.5 * sin(x * 0.4 - t * 3.0);
		col = mix(color_b, color_a, wave) * (0.7 + 0.3 * step(0.5, fract(y * 3.0)));
	}
	col = mix(col, vec3(1.0), hype * step(0.5, fract(t * 6.0)) * 0.6);
	// LED pixel grid (fades out with distance via derivatives)
	vec2 cell = fract(vec2(x * 4.0, y * board_height_ft * 4.0));
	float fw = fwidth(x * 4.0);
	float grid = mix(1.0, smoothstep(0.0, 0.25, cell.x) * smoothstep(0.0, 0.25, cell.y) * 0.4 + 0.6, clamp(1.0 - fw * 2.0, 0.0, 1.0));
	ALBEDO = col * grid * brightness;
}
