shader_type spatial;
// Basketball net: a diamond mesh pattern cut out with alpha scissor on a
// tapered cylinder. `swish` (0..1) ripples the net after a make.

render_mode cull_disabled, diffuse_lambert;

uniform vec3 net_color : source_color = vec3(0.96, 0.96, 0.96);
uniform float swish = 0.0;
uniform float cells_around = 12.0;
uniform float cells_down = 6.0;

void vertex() {
	float depth = 1.0 - UV.y;   // 0 at rim, 1 at bottom
	VERTEX.xz *= 1.0 + sin(TIME * 30.0 + UV.x * 12.0) * 0.06 * swish * depth;
	VERTEX.y -= swish * 0.06 * depth;
}

void fragment() {
	vec2 g = vec2(UV.x * cells_around, UV.y * cells_down);
	vec2 d1 = fract(vec2(g.x + g.y, g.x - g.y)) ;
	float line = min(min(d1.x, 1.0 - d1.x), min(d1.y, 1.0 - d1.y));
	float w = 0.09 + fwidth(g.x) * 0.5;
	ALPHA = 1.0 - smoothstep(w, w + 0.04, line);
	ALPHA_SCISSOR_THRESHOLD = 0.4;
	ALBEDO = net_color;
	ROUGHNESS = 0.8;
}
