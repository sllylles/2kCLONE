shader_type spatial;
// Procedural hardwood court. Every line is computed analytically from the
// regulation dimensions (in feet), so it stays crisp at any distance and
// costs a single draw call. Glossy finish picks up the arena reflection probe.

render_mode cull_back;

uniform vec3 wood_light : source_color = vec3(0.86, 0.64, 0.42);
uniform vec3 wood_dark : source_color = vec3(0.70, 0.48, 0.29);
uniform float stain = 0.0;                      // -0.3 (lighter) .. 0.3 (darker)
uniform vec3 paint_color : source_color = vec3(0.1, 0.25, 0.45);
uniform vec3 apron_color : source_color = vec3(0.08, 0.18, 0.32);
uniform vec3 line_color : source_color = vec3(0.97, 0.97, 0.95);
uniform sampler2D logo_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform float logo_radius = 8.0;                // feet
uniform float paint_restricted = 0.0;
uniform float wood_roughness = 0.16;
uniform float paint_roughness = 0.24;

varying vec2 ft;

const float HALF_L = 47.0;
const float HALF_W = 25.0;
const float LINE_HW = 1.0 / 12.0;                // 2" lines
const float BASKET_X = 41.75;                    // 47 - 5.25
const float BOARD_X = 43.0;
const float ARC_R = 23.75;
const float CORNER_Y = 22.0;
const float LANE_HW = 8.0;
const float FT_X = 28.0;                         // free-throw line, 19' from baseline
const float FT_R = 6.0;
const float RA_R = 4.0;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float noise1(float x) {
	float i = floor(x);
	float f = fract(x);
	return mix(hash12(vec2(i, 3.1)), hash12(vec2(i + 1.0, 3.1)), f * f * (3.0 - 2.0 * f));
}

float seg(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a, ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

void vertex() {
	ft = VERTEX.xz / 0.3048;
}

void fragment() {
	vec2 p = ft;
	vec2 h = vec2(abs(p.x), p.y);            // both halves are mirror images
	vec2 aa = fwidth(p);
	float px_ft = max(aa.x, aa.y);

	// --- hardwood: 2.25" boards running the length of the court -----------
	float board_w = 2.25 / 12.0;
	float board = floor(p.y / board_w);
	float plank_len = 6.0 + hash12(vec2(board, 1.0)) * 5.0;
	float shifted = p.x + hash12(vec2(board, 7.0)) * plank_len;
	float plank = floor(shifted / plank_len);
	float tone = hash12(vec2(board, plank));
	float grain = noise1(shifted * 2.3 + tone * 40.0) * 0.5 + noise1(shifted * 9.0 + board) * 0.25;
	vec3 wood = mix(wood_dark, wood_light, clamp(tone * 0.7 + grain * 0.45, 0.0, 1.0));
	wood *= 1.0 - stain;
	// seams fade out once they are smaller than a pixel to avoid moire
	float seam_fade = clamp(1.0 - px_ft * 30.0, 0.0, 1.0);
	float edge_y = abs(fract(p.y / board_w) - 0.5) * board_w;
	float edge_x = abs(fract(shifted / plank_len) - 0.5) * plank_len;
	float seam_line = max(smoothstep(board_w * 0.5 - 0.015, board_w * 0.5, edge_y),
			smoothstep(plank_len * 0.5 - 0.02, plank_len * 0.5, edge_x));
	wood *= 1.0 - 0.22 * seam_line * seam_fade;

	vec3 col = wood;
	float rough = wood_roughness;

	// --- painted areas ---------------------------------------------------------
	bool outside = h.x > HALF_L || abs(h.y) > HALF_W;
	bool lane = h.x > FT_X && h.x < HALF_L && abs(h.y) < LANE_HW;
	if (outside) {
		col = apron_color;
		rough = paint_roughness;
	} else if (lane) {
		col = mix(wood, paint_color, 0.92);
		rough = paint_roughness;
	}

	// --- center logo -------------------------------------------------------------
	float lr = length(p);
	if (lr < logo_radius) {
		vec2 uv = p / (logo_radius * 2.0) + 0.5;
		vec4 logo = texture(logo_tex, uv);
		col = mix(col, logo.rgb, logo.a * 0.95);
	}

	// --- lines -------------------------------------------------------------------
	float d = 1e5;
	// boundary
	d = min(d, max(abs(abs(p.y) - HALF_W), h.x - HALF_L));
	d = min(d, max(abs(h.x - HALF_L), abs(p.y) - HALF_W));
	// half-court line and circles
	d = min(d, max(abs(p.x), abs(p.y) - HALF_W));
	d = min(d, abs(lr - 6.0));
	d = min(d, abs(lr - 2.0));
	// lane
	d = min(d, max(abs(abs(p.y) - LANE_HW), max(FT_X - h.x, h.x - HALF_L)));
	d = min(d, max(abs(h.x - FT_X), abs(p.y) - LANE_HW));
	// free-throw circle: solid outside the lane, dashed inside it
	float ftd = abs(length(h - vec2(FT_X, 0.0)) - FT_R);
	if (h.x > FT_X) {
		float ang = atan(p.y, FT_X - h.x);
		float dash = step(0.5, fract(ang * 6.0 / 3.14159 * 2.0));
		ftd = mix(1e5, ftd, dash);
	}
	d = min(d, ftd);
	// three-point line: corner straights + arc
	float corner_x = BASKET_X - sqrt(ARC_R * ARC_R - CORNER_Y * CORNER_Y);
	d = min(d, max(abs(abs(p.y) - CORNER_Y), max(corner_x - h.x, h.x - HALF_L)));
	vec2 hb = h - vec2(BASKET_X, 0.0);
	if (h.x <= corner_x + 0.01) {
		d = min(d, abs(length(hb) - ARC_R));
	}
	// restricted area: 4' arc toward mid-court + short straights to the backboard
	if (h.x <= BASKET_X) {
		d = min(d, abs(length(hb) - RA_R));
	}
	d = min(d, max(abs(abs(p.y) - RA_R), max(BASKET_X - h.x, h.x - BOARD_X)));
	// lane hash marks (outside the lane, 6" long) and the low block
	for (int i = 0; i < 4; i++) {
		float mx = HALF_L - (i == 0 ? 7.0 : (i == 1 ? 11.0 : (i == 2 ? 14.0 : 17.0)));
		d = min(d, seg(vec2(h.x, abs(p.y)), vec2(mx, LANE_HW), vec2(mx, LANE_HW + 0.5)));
	}
	d = min(d, max(abs(h.x - (HALF_L - 7.5)), abs(abs(p.y) - LANE_HW - 0.25) - 0.25) - 0.4);
	// coaching-box hash marks, 28' from the baseline
	d = min(d, seg(vec2(h.x, abs(p.y)), vec2(HALF_L - 28.0, HALF_W - 3.0), vec2(HALF_L - 28.0, HALF_W)));

	float line_a = 1.0 - smoothstep(LINE_HW - px_ft, LINE_HW + px_ft, d);
	col = mix(col, line_color, line_a);
	rough = mix(rough, 0.35, line_a);

	ALBEDO = col;
	ROUGHNESS = rough;
	SPECULAR = 0.6;
	METALLIC = 0.0;
}
