shader_type spatial;
// Team uniform for the generated jersey and shorts. The garments carry a
// cylindrical "Wrap" UV from the build script: u runs around the body with the
// front center at u = 0.5 and the back center at u = 0 / 1; v runs from the
// bottom hem (0) to the neckline / waistband (1).

render_mode cull_disabled, diffuse_burley;

uniform vec3 base_color : source_color = vec3(0.95);
uniform vec3 trim_color : source_color = vec3(0.1, 0.3, 0.6);
uniform vec3 number_color : source_color = vec3(0.1, 0.3, 0.6);
uniform vec3 outline_color : source_color = vec3(1.0);
uniform sampler2D digits : source_color, filter_linear_mipmap, repeat_disable;   // "0123456789" in 10 cells
uniform sampler2D wordmark : source_color, filter_linear_mipmap, repeat_disable;
uniform int digit_a = -1;      // tens digit (or the only digit), -1 = none
uniform int digit_b = -1;      // ones digit, -1 = single-digit number
uniform bool is_jersey = true;
uniform float fabric_rough = 0.72;

float sample_digit(int d, vec2 uv) {
	if (d < 0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		return 0.0;
	}
	return texture(digits, vec2((float(d) + uv.x) / 10.0, uv.y)).a;
}

// Number centered at (cu, cv) with digit size (w, h) in UV units.
vec2 number_mask(vec2 uv, float cu, float cv, float w, float h) {
	vec2 res = vec2(0.0);
	float n = digit_b < 0 ? 1.0 : 2.0;
	float left = cu - w * n * 0.5;
	for (int i = 0; i < 2; i++) {
		int d = i == 0 ? digit_a : digit_b;
		vec2 local = vec2((uv.x - left - float(i) * w) / w, (uv.y - cv) / h + 0.5);
		res.x = max(res.x, sample_digit(d, local));
		// outline: sample a slightly bigger glyph
		vec2 big = (local - 0.5) * 0.86 + 0.5;
		res.y = max(res.y, sample_digit(d, big));
	}
	return res;
}

void fragment() {
	vec2 uv = UV;
	vec3 col = base_color;
	// back-center distance: u wraps, back is at 0/1
	float back_u = uv.x < 0.5 ? uv.x : uv.x - 1.0;   // u may run past 1 across the back seam
	if (is_jersey) {
		// trim at the hem, neckline and side panels
		float trim = step(uv.y, 0.035) + step(0.965, uv.y);
		trim += 1.0 - smoothstep(0.006, 0.01, abs(abs(uv.x - 0.5) - 0.25));
		col = mix(col, trim_color, clamp(trim, 0.0, 1.0));
		// front wordmark + small number, back large number
		vec2 wm_uv = vec2((uv.x - 0.5) / 0.30 + 0.5, (uv.y - 0.70) / 0.12 + 0.5);
		if (wm_uv.x > 0.0 && wm_uv.x < 1.0 && wm_uv.y > 0.0 && wm_uv.y < 1.0) {
			vec4 w = texture(wordmark, wm_uv);
			col = mix(col, number_color, w.a);
		}
		vec2 front = number_mask(uv, 0.5, 0.47, 0.07, 0.17);
		vec2 back = number_mask(vec2(back_u + 0.5, uv.y), 0.5, 0.64, 0.105, 0.27);
		vec2 m = max(front, back);
		col = mix(col, outline_color, m.y);
		col = mix(col, number_color, m.x);
	} else {
		// shorts: side stripes and a hem band
		float stripe = 1.0 - smoothstep(0.012, 0.018, abs(abs(uv.x - 0.5) - 0.25));
		float hem = step(uv.y, 0.06);
		col = mix(col, trim_color, clamp(stripe + hem, 0.0, 1.0));
	}
	// subtle mesh-fabric texture
	float weave = 0.97 + 0.03 * sin(UV.x * 900.0) * sin(UV.y * 700.0);
	ALBEDO = col * weave;
	ROUGHNESS = fabric_rough;
	SPECULAR = 0.35;
}
