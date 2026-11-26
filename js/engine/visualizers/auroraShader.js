import { hexToRgb01, hexToRgba } from '../../lib/palettes.js';

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform float uIntensity;
uniform float uBloom;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.52;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    value += amp * noise(p);
    p = rot * p * 2.04 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return value;
}

void main() {
  vec2 aspect = vec2(uResolution.x / max(1.0, uResolution.y), 1.0);
  vec2 uv = (vUv - 0.5) * aspect;
  float dist = length(uv);

  float bassDrive = uBass * uIntensity;
  float midDrive = uMid * uIntensity;
  float trebleDrive = uTreble * uIntensity;
  float t = uTime * (0.18 + midDrive * 0.24);

  // Domain-warped organic silk ribbons
  vec2 q = vec2(
    fbm(uv * 1.65 + vec2(t * 0.45, -t * 0.25)),
    fbm(uv * 1.65 + vec2(-t * 0.3, t * 0.52) + vec2(5.2, 1.3))
  );

  vec2 r = vec2(
    fbm(uv * 2.1 + 1.85 * q + vec2(1.7, 9.2) + t * 0.38 + bassDrive * 0.45),
    fbm(uv * 2.1 + 1.85 * q + vec2(8.3, 2.8) - t * 0.34)
  );

  float field = fbm(uv * 1.55 + 2.1 * r);

  // Radial optical resonance wave on bass hits
  float ringWave = sin(dist * (10.5 - bassDrive * 2.5) - uTime * 2.4) * 0.5 + 0.5;
  float ringMask = exp(-abs(dist - (0.34 + uBeat * 0.16)) * 7.5) * (0.28 + uBeat * 0.65);

  // Palette blending across domain folds
  vec3 bgBase = vec3(0.027, 0.031, 0.043);
  vec3 col = mix(bgBase, uColorC * 0.48, smoothstep(0.18, 0.72, field));
  col = mix(col, uColorB * 0.85, smoothstep(0.32, 0.88, length(q) * 0.78));
  col = mix(col, uColorA * (1.05 + uBeat * 0.35), smoothstep(0.45, 0.96, length(r) * 0.74));

  // Specular optical ridges driven by treble & bloom
  float ridge = pow(clamp(1.0 - abs(field - 0.54) * 5.8, 0.0, 1.0), 2.4);
  float shimmer = ridge * (0.35 + trebleDrive * 1.1 + uBloom * 0.3);
  col += mix(uColorA, vec3(0.96, 0.97, 0.99), 0.38) * shimmer;

  // Center harmonic halo
  float coreGlow = exp(-dist * (2.6 - bassDrive * 0.7)) * (0.22 + bassDrive * 0.52 + uBeat * 0.35);
  col += mix(uColorA, uColorB, ringWave * 0.6) * (coreGlow + ringMask * (0.35 + uBloom * 0.4));

  // Soft studio vignette for framing depth
  float vignette = smoothstep(1.38, 0.22, dist);
  col = mix(bgBase, col, vignette);

  // Filmic tone curve
  col = col / (col + vec3(0.68));
  col = pow(max(col, vec3(0.0)), vec3(0.92));

  fragColor = vec4(col, 1.0);
}
`;

export class AuroraEngine {
  constructor() {
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.uniforms = null;
    this.failedWebGl = false;
  }

  compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  initWebGl(canvas) {
    if (this.failedWebGl) return false;
    if (this.gl && this.program) return true;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      this.failedWebGl = true;
      return false;
    }

    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) {
      this.failedWebGl = true;
      return false;
    }

    const program = gl.createProgram();
    if (!program) {
      this.failedWebGl = true;
      return false;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      this.failedWebGl = true;
      return false;
    }

    this.gl = gl;
    this.program = program;
    this.vao = gl.createVertexArray();
    this.uniforms = {
      uResolution: gl.getUniformLocation(program, 'uResolution'),
      uTime: gl.getUniformLocation(program, 'uTime'),
      uBass: gl.getUniformLocation(program, 'uBass'),
      uMid: gl.getUniformLocation(program, 'uMid'),
      uTreble: gl.getUniformLocation(program, 'uTreble'),
      uBeat: gl.getUniformLocation(program, 'uBeat'),
      uIntensity: gl.getUniformLocation(program, 'uIntensity'),
      uBloom: gl.getUniformLocation(program, 'uBloom'),
      uColorA: gl.getUniformLocation(program, 'uColorA'),
      uColorB: gl.getUniformLocation(program, 'uColorB'),
      uColorC: gl.getUniformLocation(program, 'uColorC'),
    };
    return true;
  }

  renderWebGl(canvas, state) {
    if (!this.initWebGl(canvas)) return false;
    const gl = this.gl;
    const u = this.uniforms;
    if (!gl || !this.program || !u) return false;

    const pixelW = Math.max(1, Math.round(state.width * state.dpr));
    const pixelH = Math.max(1, Math.round(state.height * state.dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    gl.viewport(0, 0, pixelW, pixelH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const [cA, cB, cC] = state.palette;
    const rgbA = hexToRgb01(cA);
    const rgbB = hexToRgb01(cB);
    const rgbC = hexToRgb01(cC);

    gl.uniform2f(u.uResolution, pixelW, pixelH);
    gl.uniform1f(u.uTime, state.reducedMotion ? state.time * 0.25 : state.time);
    gl.uniform1f(u.uBass, state.metrics.bass);
    gl.uniform1f(u.uMid, state.metrics.mid);
    gl.uniform1f(u.uTreble, state.metrics.treble);
    gl.uniform1f(u.uBeat, state.reducedMotion ? state.metrics.beatPulse * 0.35 : state.metrics.beatPulse);
    gl.uniform1f(u.uIntensity, state.intensity);
    gl.uniform1f(u.uBloom, state.bloom ? 1.0 : 0.0);
    gl.uniform3f(u.uColorA, rgbA[0], rgbA[1], rgbA[2]);
    gl.uniform3f(u.uColorB, rgbB[0], rgbB[1], rgbB[2]);
    gl.uniform3f(u.uColorC, rgbC[0], rgbC[1], rgbC[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  renderFallback2d(ctx, state) {
    const { width, height, dpr, time, palette, metrics, intensity, bloom, reducedMotion } = state;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07080B';
    ctx.fillRect(0, 0, width, height);

    const t = reducedMotion ? time * 0.25 : time * 0.65;
    const drive = (0.35 + metrics.energy * 0.8 + metrics.beatPulse * 0.4) * intensity;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const baseR = Math.min(width, height) * 0.45;

    ctx.globalCompositeOperation = bloom ? 'lighter' : 'screen';

    const orbs = [
      {
        x: cx + Math.cos(t * 0.7) * width * 0.18,
        y: cy + Math.sin(t * 0.5) * height * 0.16,
        r: baseR * (0.9 + metrics.bass * 0.45 * intensity),
        color: palette[0],
        alpha: Math.min(0.75, 0.34 + drive * 0.2),
      },
      {
        x: cx + Math.cos(t * 0.55 + 2.1) * width * 0.22,
        y: cy + Math.sin(t * 0.8 + 1.1) * height * 0.18,
        r: baseR * (0.85 + metrics.mid * 0.4 * intensity),
        color: palette[1],
        alpha: Math.min(0.68, 0.28 + drive * 0.18),
      },
      {
        x: cx + Math.sin(t * 0.45 + 4.2) * width * 0.2,
        y: cy + Math.cos(t * 0.6 + 3.1) * height * 0.2,
        r: baseR * (0.95 + metrics.treble * 0.35 * intensity),
        color: palette[2],
        alpha: Math.min(0.6, 0.24 + drive * 0.16),
      },
    ];

    for (const orb of orbs) {
      const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      grad.addColorStop(0, hexToRgba(orb.color, orb.alpha));
      grad.addColorStop(0.55, hexToRgba(orb.color, orb.alpha * 0.32));
      grad.addColorStop(1, 'rgba(7,8,11,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  dispose() {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    this.gl = null;
  }
}
