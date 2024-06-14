precision highp float;
uniform sampler2D velocity;
uniform sampler2D maskTexture;
uniform sampler2D backTexture;
varying vec2 uv;

void main() {
    vec2 vel = texture2D(velocity, uv).xy;
    float len = length(vel);
    vel = vel * 0.5 + 0.5;
    vec4 backTextureColor = texture2D(backTexture, uv + vel * 0.1); // Adjust the multiplier to control the offset

    vec3 color = vec3(vel.x/2.0, vel.y/2.0, 0.5);

    color = mix(vec3(backTextureColor.rgb), color, len);
    vec4 maskColor = texture2D(maskTexture, uv);
    
    // Apply multiplicative mask
    vec3 mixedColor = color + (maskColor.rgb / 2.0);
    vec3 maskedColor = mixedColor * maskColor.a;

    gl_FragColor = vec4(maskedColor, maskColor.a);
}
