shader_type spatial;
// Instanced low-poly spectators. INSTANCE_CUSTOM: r = skin tone, g = phase,
// b = how energetic this fan is, a = shirt brightness. COLOR = shirt color.
// Vertices above head_y are the head; arm_flag in UV.x marks raised arms.

render_mode cull_back, diffuse_lambert, specular_disabled;

uniform float excitement = 0.2;      // 0 calm .. 1 everyone on their feet
uniform float head_y = 0.62;         // meters, local
uniform vec3 skin_light : source_color = vec3(0.93, 0.76, 0.62);
uniform vec3 skin_dark : source_color = vec3(0.29, 0.17, 0.10);
uniform float near_fade = 11.0;      // meters: fans closer than this to the camera dissolve

varying vec3 v_shirt;
varying float v_skin;
varying float v_is_head;

void vertex() {
	float phase = INSTANCE_CUSTOM.g * 6.2831;
	float energy = INSTANCE_CUSTOM.b;
	float e = clamp(excitement * (0.5 + energy), 0.0, 1.0);
	float bounce = max(0.0, sin(TIME * (5.0 + energy * 4.0) + phase)) * 0.12 * e;
	float stand = smoothstep(0.55, 0.9, e) * 0.25;
	VERTEX.y += bounce + stand;
	// arms (UV.x == 1) wave when excited
	if (UV.x > 0.5) {
		VERTEX.y += e * 0.28 * (0.6 + 0.4 * sin(TIME * 7.0 + phase));
	}
	VERTEX.x += sin(TIME * 0.8 + phase) * 0.02;
	v_shirt = COLOR.rgb * INSTANCE_CUSTOM.a;
	v_skin = INSTANCE_CUSTOM.r;
	v_is_head = step(head_y, VERTEX.y - bounce - stand) * (1.0 - step(0.5, UV.x));
}

void fragment() {
	vec3 skin = mix(skin_light, skin_dark, v_skin);
	// Dissolve fans right in front of the lens (broadcast camera sits in the stands).
	float fade = smoothstep(near_fade * 0.7, near_fade, length(VERTEX));
	vec2 cell = mod(floor(FRAGCOORD.xy), 2.0);
	float dither = (cell.x * 2.0 + cell.y + 0.5) / 4.0;
	if (fade < dither) {
		discard;
	}
	ALBEDO = mix(v_shirt, skin, v_is_head);
	ROUGHNESS = 0.9;
}
