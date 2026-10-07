const LiquidShader = (() => {
  let gl, program, raf, startTime, lastFrame;
  const U = {};  // cached uniform locations

  // Size of one dither pixel, in CSS px. The canvas renders at
  // window size / PIXEL and is upscaled with `image-rendering: pixelated`.
  const PIXEL = 2;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIME_SCALE = reducedMotion ? 0.3 : 1.0;

  // Pointer + fluid state (all in normalised 0–1 screen units)
  const pointer = { x: -2, y: -2, t: 0, active: false };
  const rawVel  = [0, 0];
  const vel     = [0, 0];
  let slosh = 0, sloshVel = 0;

  const VERT = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform int   u_count;
    uniform vec3  u_colors[6];
    uniform float u_bottoms[6];
    uniform float u_patterns[6];
    uniform vec2  u_mouse;
    uniform vec2  u_vel;      // smoothed pointer velocity (uv / sec)
    uniform float u_slosh;    // surface tilt from sideways motion

    // ─── Dithering ────────────────────────────────────────────────
    // Recursive Bayer matrix: 2×2 → 4×4 → 8×8, returns a threshold in [0,1).
    float bayer2(vec2 a) {
      a = floor(a);
      return fract(a.x / 2.0 + a.y * a.y * 0.75);
    }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    // Number of light steps per unit of shade. Fewer = chunkier bands.
    const float TONE_STEPS = 8.0;

    // Maps a quantised light level onto the ingredient colour.
    // level < 0 → shadow, 0 → the ingredient's own colour, level > 0 → light.
    // Typical range is about -0.4 … +0.6, in steps of 1 / TONE_STEPS.
    vec3 toneRamp(vec3 base, float level) {
      // TODO(human): design the shadow + highlight tones
      if (level < 0.0) return base * (1.0 + level);
      return mix(base, vec3(1.0), level);
    }

    // ─── Noise ────────────────────────────────────────────────────
    float hash(vec2 p) {
      return fract(sin(dot(fract(p * vec2(127.1, 311.7)), vec2(127.1, 311.7))) * 43758.5453);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm(vec2 p) {
      float sum = 0.0, amp = 0.5, freq = 1.0;
      for (int i = 0; i < 4; i++) {
        sum  += amp * vnoise(p * freq);
        amp  *= 0.5;
        freq *= 2.0;
      }
      return sum;
    }

    // ─── Ingredient patterns ──────────────────────────────────────

    // Pattern 1: Pulp dots (Orange Juice) — organic scattered distribution
    float bubblesPat(vec2 uv) {
      vec2 grid = uv * vec2(14.0, 16.0);
      vec2 id   = floor(grid);
      vec2 cell = fract(grid);
      float seed  = hash(id);
      float seed2 = hash(id + 5.13);
      float seed3 = hash(id + 17.4);
      // Fully random center — no staggered row offset
      vec2 center = vec2(0.15 + seed2 * 0.70, 0.15 + seed3 * 0.70);
      float r = 0.050 + seed * 0.022;
      float d = 1.0 - smoothstep(r - 0.010, r + 0.010, length(cell - center));
      // ~18% of cells empty — breaks up the uniform density
      return d * step(0.18, seed);
    }

    // Pattern 2: Fine wavy stripes (Lemon Juice)
    float waveStripesPat(vec2 uv) {
      float n = vnoise(vec2(uv.x * 3.0 + u_time * 0.04, uv.y * 3.0)) * 0.07;
      float s = fract((uv.x * 0.4 - uv.y + n) * 22.0);
      return step(0.80, s);
    }

    // Pattern 3: Tiny fizz dots (Water)
    float fizzPat(vec2 uv) {
      vec2 cell = fract(uv * 26.0);
      vec2 id   = floor(uv * 26.0);
      float seed = hash(id + 17.3);
      float cx = 0.2 + seed * 0.6;
      float cy = fract(hash(id + 0.3) - u_time * 0.038 * (0.4 + seed * 0.6));
      float r  = 0.125;
      return 1.0 - smoothstep(r - 0.018, r + 0.018, length(cell - vec2(cx, cy)));
    }

    // Pattern 4: Static grain (Cognac, Whisky)
    // Uses a precision-safe hash: screen-space coords can reach ~960, making
    // sin(coord * 127.1 * 127.1 * 43758) overflow float32 and produce banding.
    // Folding with fract() first keeps intermediate values in [0,1].
    float grainPat() {
      vec2 px = fract(floor(gl_FragCoord.xy) * vec2(0.1031, 0.1030));
      px += dot(px, px.yx + 33.33);
      return fract((px.x + px.y) * px.x);
    }

    // Pattern 5: Organic leaf shapes (Crème de Menthe)
    float leafPat(vec2 uv) {
      vec2 grid = uv * vec2(8.0, 11.0);
      vec2 id   = floor(grid);
      vec2 cell = fract(grid);
      float seed  = hash(id);
      float seed2 = hash(id + 5.3);
      float seed3 = hash(id + 9.7);
      float seed4 = hash(id + 14.2);
      // Fully random center — no staggered row offset
      vec2 center = vec2(0.15 + seed2 * 0.70, 0.15 + seed3 * 0.70);
      // Random rotation per cell
      float angle = seed * 6.28318;
      vec2  p   = cell - center;
      float cs  = cos(angle), sn = sin(angle);
      p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
      // Elongated ellipse — pointed at tips via abs(pn.y) penalty
      float a  = 0.045 + seed4 * 0.020;
      float b  = 0.090 + seed  * 0.040;
      vec2  pn = p / vec2(a, b);
      float d  = length(pn) + abs(pn.y) * 0.35;
      float leaf = 1.0 - smoothstep(0.80, 1.10, d);
      // ~22% of cells empty — uneven clustering
      return leaf * step(0.22, seed3);
    }

    float getPattern(float patId, vec2 uv) {
      if (patId < 1.5) return bubblesPat(uv);
      if (patId < 2.5) return waveStripesPat(uv);
      if (patId < 3.5) return fizzPat(uv);
      return leafPat(uv);
    }

    vec3 applyPattern(vec3 col, float patId, vec2 uv) {
      if (patId < 0.5) {
        return col;
      } else if (patId >= 3.5 && patId < 4.5) {
        // Grain called directly — avoids speculative evaluation of other patterns
        return clamp(col + vec3((grainPat() - 0.5) * 0.06), 0.0, 1.0);
      } else {
        float p = getPattern(patId, uv);
        if (p < 0.001) return col;
        if (patId < 1.5) return col + p * vec3(0.12);         // bubbles: more visible
        if (patId < 2.5) return col * (1.0 - p * 0.08);       // stripes: denser
        if (patId < 3.5) return col + p * vec3(0.05);         // fizz: lighter
        return col - p * vec3(0.04, 0.09, 0.04);              // leaves: darker green
      }
    }

    // ─── Main ─────────────────────────────────────────────────────
    void main() {
      vec2  rawUV  = gl_FragCoord.xy / u_res;
      float aspect = u_res.x / u_res.y;
      float dth    = bayer8(gl_FragCoord.xy);

      // --- Stirring: liquid near the pointer is dragged along its motion ---
      vec2  dm    = (rawUV - u_mouse) * vec2(aspect, 1.0);
      float near  = exp(-dot(dm, dm) * 14.0);
      float speed = length(u_vel);
      vec2  flowUV = rawUV - u_vel * near * 0.05;

      // Barrel distortion (glass curvature)
      vec2 uv = flowUV;
      vec2 c  = uv - 0.5;
      uv += c * dot(c, c) * 0.025;
      float y = 1.0 - uv.y;

      // Layer boundaries get wider (more mixing) where the liquid is stirred
      float mixWidth = 0.006 + near * min(speed, 2.0) * 0.03;
      float tilt     = (uv.x - 0.5) * u_slosh;

      // --- Layers: dithered transition at every boundary ---
      vec3  col      = u_colors[0];
      float pat      = u_patterns[0];
      float meniscus = 0.0;

      for (int i = 0; i < 5; i++) {
        if (i >= u_count - 1) break;
        float fi     = float(i);
        float n      = fbm(vec2(uv.x * 2.8, u_time * 0.055 + fi * 7.3));
        float wobble = sin(u_time * 0.18 + fi * 2.09) * 0.018;
        float edge   = u_bottoms[i] + (n - 0.5) * 0.09 + wobble + tilt;

        float t = smoothstep(edge - mixWidth, edge + mixWidth, y);
        if (t > dth) {
          col = u_colors[i + 1];
          pat = u_patterns[i + 1];
        }
        float dy = (y - edge) / 0.006;
        meniscus += exp(-dy * dy);
      }

      col = applyPattern(col, pat, flowUV);

      // --- Light, as a single "shade" value around 0 ---
      float dist  = length(uv - 0.5);
      float vign  = smoothstep(0.3, 0.85, dist) * 0.35;
      float spec  = exp(-length((uv - vec2(0.72, 0.15)) * vec2(2.0, 1.5)) * 4.5) * 0.25;

      float shade = spec + meniscus * 0.18 - vign;

      // --- Ordered dither: quantise shade into TONE_STEPS per unit ---
      float level = floor(shade * TONE_STEPS + dth) / TONE_STEPS;

      gl_FragColor = vec4(clamp(toneRamp(col, level), 0.0, 1.0), 1.0);
    }
  `;

  function compileShader(src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      console.error('Shader compile error:', gl.getShaderInfoLog(sh));
    return sh;
  }

  function init(canvasId) {
    const canvas = document.getElementById(canvasId);
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;

    program = gl.createProgram();
    gl.attachShader(program, compileShader(VERT, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(FRAG, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.useProgram(program);

    ['u_res', 'u_time', 'u_count', 'u_colors', 'u_bottoms', 'u_patterns',
     'u_mouse', 'u_vel', 'u_slosh'].forEach(name => {
      U[name] = gl.getUniformLocation(program, name);
    });

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1,  -1, 1,
       1,-1,  1, 1,  -1, 1,
    ]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(U.u_mouse, -2.0, -2.0);

    resize();
    window.addEventListener('resize', resize);
    startTime = performance.now();
    return true;
  }

  function resize() {
    const canvas = gl.canvas;
    canvas.width  = Math.ceil(window.innerWidth  / PIXEL);
    canvas.height = Math.ceil(window.innerHeight / PIXEL);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.u_res, canvas.width, canvas.height);
  }

  function setBands(bands) {
    const count    = Math.min(bands.length, 6);
    const colors   = new Float32Array(18).fill(0.5);
    const bottoms  = new Float32Array(6).fill(1.0);
    const patterns = new Float32Array(6).fill(0.0);
    let cumulative = 0;
    for (let i = 0; i < count; i++) {
      cumulative += bands[i].pct;
      bottoms[i] = cumulative;
      const [r, g, b] = bands[i].rgb;
      colors[i * 3]     = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      patterns[i] = bands[i].pattern || 0;
    }
    gl.uniform1i(U.u_count,     count);
    gl.uniform3fv(U.u_colors,   colors);
    gl.uniform1fv(U.u_bottoms,  bottoms);
    gl.uniform1fv(U.u_patterns, patterns);
  }

  // x, y in 0–1 with y pointing up (GL convention). Call with -2, -2 to release.
  function setMouse(x, y) {
    if (!program) return;
    const t = getTime();
    const inside = x > -1;
    if (inside && pointer.active) {
      const dt = Math.max(t - pointer.t, 1 / 240);
      rawVel[0] = (x - pointer.x) / dt;
      rawVel[1] = (y - pointer.y) / dt;
    }
    pointer.x = x; pointer.y = y; pointer.t = t; pointer.active = inside;
    gl.uniform2f(U.u_mouse, x, y);
  }

  function getTime() {
    return startTime ? (performance.now() - startTime) / 1000 : 0;
  }

  // Integrates pointer velocity and the slosh spring once per frame.
  function stepFluid(dt) {
    // Raw velocity fades when the pointer stops sending events
    const fade = Math.exp(-dt * 10);
    rawVel[0] *= fade; rawVel[1] *= fade;

    const follow = 1 - Math.exp(-dt * 8);
    vel[0] += (rawVel[0] - vel[0]) * follow;
    vel[1] += (rawVel[1] - vel[1]) * follow;
    const mag = Math.hypot(vel[0], vel[1]);
    if (mag > 3) { vel[0] *= 3 / mag; vel[1] *= 3 / mag; }

    // Damped spring: sideways motion kicks it, it sways back to level
    if (!reducedMotion) {
      const accel = -22 * slosh - 1.8 * sloshVel + vel[0] * 0.06;
      sloshVel += accel * dt;
      slosh    += sloshVel * dt;
      slosh = Math.max(-0.08, Math.min(0.08, slosh));
    }

    gl.uniform2f(U.u_vel, vel[0], vel[1]);
    gl.uniform1f(U.u_slosh, slosh);
  }

  function tick() {
    const now = performance.now();
    const dt  = Math.min((now - (lastFrame || now)) / 1000, 0.05);
    lastFrame = now;

    stepFluid(dt);
    gl.uniform1f(U.u_time, (now - startTime) / 1000 * TIME_SCALE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (raf) cancelAnimationFrame(raf);
    lastFrame = 0;
    tick();
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  }

  return { init, setBands, setMouse, getTime, start, destroy };
})();
