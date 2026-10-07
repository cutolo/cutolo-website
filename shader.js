const LiquidShader = (() => {
  let gl, program, raf, startTime, lastFrame, prevTex;
  let frame = 0, needsFullPour = true;
  const U = {};  // cached uniform locations

  // Size of one dither pixel, in CSS px. The canvas renders at
  // window size / PIXEL and is upscaled with `image-rendering: pixelated`.
  const PIXEL = 2;

  // Share of pixels re-poured from the fresh cocktail each frame (at 60fps).
  // Lower = longer datamosh trails, higher = the cocktail holds its shape.
  const REFRESH = 0.03;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIME_SCALE = reducedMotion ? 0.3 : 1.0;

  // Pointer + fluid state (all in normalised 0–1 screen units)
  const pointer = { x: -2, y: -2, t: 0, active: false };
  const rawVel  = [0, 0];
  const vel     = [0, 0];
  let slosh = 0, sloshVel = 0;

  // Up to 4 live ripples: x, y, start time, strength
  const ripples = new Float32Array(16);
  for (let i = 0; i < 4; i++) ripples[i * 4 + 2] = -100;
  let rippleIdx = 0;
  const lastRipple = { x: -2, y: -2, t: -100 };

  const VERT = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform sampler2D u_prev;    // last frame — the liquid remembers itself
    uniform vec2  u_res;
    uniform float u_time;        // animation time (slowed for reduced motion)
    uniform float u_clock;       // real seconds, for ripples
    uniform float u_frame;
    uniform float u_dt;          // frame duration in 60fps frames
    uniform float u_refresh;     // chance a pixel is re-poured this frame
    uniform int   u_count;
    uniform vec3  u_colors[6];
    uniform float u_bottoms[6];
    uniform float u_patterns[6];
    uniform vec2  u_mouse;
    uniform vec2  u_vel;         // smoothed pointer velocity (uv / sec)
    uniform float u_slosh;       // surface tilt from sideways motion
    uniform vec4  u_ripples[4];  // xy = origin, z = start time, w = strength

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
    // Used by the original patterns (stripes, fizz) — kept for their look.
    float hash(vec2 p) {
      return fract(sin(dot(fract(p * vec2(127.1, 311.7)), vec2(127.1, 311.7))) * 43758.5453);
    }

    // Better-distributed hash for per-pixel randomness: the one above repeats
    // every 10 integer steps, which shows up as a grid when used per pixel.
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
        mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
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

    // Pattern 1: Pulp dots (Orange Juice) — two scales, clustered, varied sizes
    float pulpLayer(vec2 uv, vec2 scale, float salt) {
      vec2 grid = uv * scale;
      vec2 id   = floor(grid);
      vec2 cell = fract(grid);
      float s1 = hash12(id + salt);
      float s2 = hash12(id + salt + 5.13);
      float s3 = hash12(id + salt + 17.4);
      // Dense in some patches, sparse in others
      float density = mix(0.15, 0.95, smoothstep(0.3, 0.7, vnoise(id / scale * 4.0 + salt)));
      vec2 center = vec2(0.2 + s2 * 0.6, 0.2 + s3 * 0.6);
      float r = 0.04 + s1 * s1 * 0.10;
      float d = 1.0 - smoothstep(r - 0.012, r + 0.012, length(cell - center));
      return d * step(hash12(id + salt + 2.7), density);
    }

    float bubblesPat(vec2 uv) {
      return max(pulpLayer(uv, vec2(14.0, 16.0), 0.0),
                 pulpLayer(uv + vec2(0.31, 0.17), vec2(23.0, 27.0), 41.0));
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

    // Pattern 5: Organic leaf shapes (Crème de Menthe) — two scales, clustered
    float leafLayer(vec2 uv, vec2 scale, float salt) {
      vec2 grid = uv * scale;
      vec2 id   = floor(grid);
      vec2 cell = fract(grid);
      float s1 = hash12(id + salt);
      float s2 = hash12(id + salt + 5.3);
      float s3 = hash12(id + salt + 9.7);
      float s4 = hash12(id + salt + 14.2);
      float density = mix(0.3, 0.95, smoothstep(0.3, 0.7, vnoise(id / scale * 3.5 + salt + 11.0)));
      vec2 center = vec2(0.3 + s2 * 0.4, 0.3 + s3 * 0.4);
      // Random rotation per cell
      float angle = s1 * 6.28318;
      vec2  p   = cell - center;
      float cs  = cos(angle), sn = sin(angle);
      p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
      // Elongated ellipse — pointed at tips via abs(pn.y) penalty
      float a  = 0.05 + s4 * 0.05;
      float b  = a * (1.5 + s1 * 0.7);
      vec2  pn = p / vec2(a, b);
      float d  = length(pn) + abs(pn.y) * 0.35;
      float leaf = 1.0 - smoothstep(0.80, 1.10, d);
      return leaf * step(hash12(id + salt + 3.3), density);
    }

    float leafPat(vec2 uv) {
      return max(leafLayer(uv, vec2(8.0, 11.0), 0.0),
                 leafLayer(uv + vec2(0.43, 0.29), vec2(13.0, 17.0), 57.0));
    }

    float getPattern(float patId, vec2 uv) {
      if (patId < 1.5) return bubblesPat(uv);
      if (patId < 2.5) return waveStripesPat(uv);
      if (patId < 3.5) return fizzPat(uv);
      return leafPat(uv);
    }

    // th = per-pixel threshold: pattern edges come out dithered, not smooth
    vec3 applyPattern(vec3 col, float patId, vec2 uv, float th) {
      if (patId < 0.5) {
        return col;
      } else if (patId >= 3.5 && patId < 4.5) {
        // Grain called directly — avoids speculative evaluation of other patterns
        return clamp(col + vec3((grainPat() - 0.5) * 0.06), 0.0, 1.0);
      } else {
        float p = step(th, getPattern(patId, uv));
        if (p < 0.5) return col;
        if (patId < 1.5) return col + vec3(0.12);           // bubbles: more visible
        if (patId < 2.5) return col * (1.0 - 0.08);         // stripes: denser
        if (patId < 3.5) return col + vec3(0.05);           // fizz: lighter
        return col - vec3(0.06, 0.13, 0.06);                // leaves: darker green
      }
    }

    // ─── The fresh cocktail ───────────────────────────────────────
    // What the glass looks like if nobody touched it. Every frame a few
    // random pixels are re-poured from here; the rest keep flowing.
    vec3 freshCocktail(vec2 px, float aspect) {
      // Pixels of random size: 1, 2 or 4 sim px, chosen per 8×8 cell
      float hs = hash12(floor(px / 8.0) + 91.7);
      float s  = hs < 0.6 ? 1.0 : (hs < 0.9 ? 2.0 : 4.0);
      vec2  bp = floor(px / s) * s;
      vec2  uv = (bp + 0.5 * s) / u_res;

      float thMix = bayer8(bp / s);          // ordered dither for the blends
      float thPat = hash12(bp + 17.0);       // random dither for pattern edges
      float thTone = hash12(bp + 53.0);      // random dither for light

      float y    = 1.0 - uv.y;
      float tilt = (uv.x - 0.5) * u_slosh;

      // Layers blend into each other through a dithered gradient whose
      // position is pushed around by noise, so one colour reaches into
      // the next in tendrils instead of a straight band.
      vec3  col  = u_colors[0];
      float pat  = u_patterns[0];
      float prevBottom = 0.0;

      for (int i = 0; i < 5; i++) {
        if (i >= u_count - 1) break;
        float fi     = float(i);
        float n      = fbm(vec2(uv.x * 2.8, u_time * 0.055 + fi * 7.3));
        float wobble = sin(u_time * 0.18 + fi * 2.09) * 0.018;
        float edge   = u_bottoms[i] + (n - 0.5) * 0.09 + wobble + tilt;

        // Gradient half-width, never more than ~35% of the thinner neighbour
        float room = min(u_bottoms[i] - prevBottom, u_bottoms[i + 1] - u_bottoms[i]);
        float w    = min(0.012 + 0.018 * vnoise(vec2(uv.x * 2.0 + fi * 3.0, u_time * 0.05)), room * 0.35);

        float tendrils = (fbm(vec2(uv.x * aspect * 4.0, y * 7.0) + vec2(fi * 3.1, -u_time * 0.04)) - 0.5) * 1.6;
        float m = smoothstep(-1.0, 1.0, (y - edge) / w + tendrils);
        if (m > thMix) {
          col = u_colors[i + 1];
          pat = u_patterns[i + 1];
        }
        prevBottom = u_bottoms[i];
      }

      col = applyPattern(col, pat, uv, thPat);

      // Living texture: sparse lighter/darker pixels suspended in the liquid
      float sparkle = (vnoise(vec2(uv.x * aspect, uv.y) * 16.0 + u_time * 0.25) - 0.5) * 0.16;
      float spec    = exp(-length((uv - vec2(0.72, 0.15)) * vec2(2.0, 1.5)) * 4.5) * 0.25;
      float level   = floor((sparkle + spec) * TONE_STEPS + thTone) / TONE_STEPS;

      return clamp(toneRamp(col, level), 0.0, 1.0);
    }

    // ─── The current ──────────────────────────────────────────────
    // Ripples: rings that push pixels outward and back as they travel.
    vec2 rippleFlow(vec2 uv, float aspect) {
      vec2 v = vec2(0.0);
      for (int i = 0; i < 4; i++) {
        vec4  r = u_ripples[i];
        float e = u_clock - r.z;
        if (e < 0.0 || e > 2.5) continue;
        vec2  d    = (uv - r.xy) * vec2(aspect, 1.0);
        float dist = length(d) + 1e-4;
        float x    = dist - e * 0.22;                 // ring travels outward
        float wave = sin(x * 70.0) * exp(-x * x * 300.0);
        float fade = exp(-e * 1.8) * smoothstep(0.0, 0.08, e);
        v += d / dist * wave * fade * r.w;
      }
      return v * 1.4;
    }

    // 1 near a layer boundary, 0 deep inside a layer (cheap: no edge noise)
    float nearBoundary(vec2 uv) {
      float y = 1.0 - uv.y;
      float tilt = (uv.x - 0.5) * u_slosh;
      float prox = 0.0;
      for (int i = 0; i < 5; i++) {
        if (i >= u_count - 1) break;
        float d = (y - u_bottoms[i] - tilt) / 0.07;
        prox = max(prox, exp(-d * d));
      }
      return prox;
    }

    // Velocity in sim pixels per 60fps frame
    vec2 flowAt(vec2 uv, float aspect) {
      // Idle convection: curl of a slow noise field (swirls, no sinks)
      vec2  q = vec2(uv.x * aspect, uv.y) * 2.2 + u_time * 0.05;
      const float e = 0.05;
      float dx = vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0));
      float dy = vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e));
      vec2  v  = vec2(dy, -dx) / (2.0 * e) * 0.35;
      // Calm inside each layer, churning where two ingredients meet
      v *= mix(0.25, 1.5, nearBoundary(uv));

      // Pointer gently drags the liquid it passes through
      vec2 dm = (uv - u_mouse) * vec2(aspect, 1.0);
      v += u_vel * exp(-dot(dm, dm) * 90.0) * 0.5;

      return v + rippleFlow(uv, aspect);
    }

    // ─── Main ─────────────────────────────────────────────────────
    void main() {
      vec2  px     = floor(gl_FragCoord.xy);
      float aspect = u_res.x / u_res.y;
      float fr     = mod(u_frame, 997.0);

      // Motion blocks of random size (datamosh macroblocks), re-cut twice a second
      float hb  = hash12(floor(px / 16.0) + floor(u_time * 2.0) * 7.31);
      float bs  = hb < 0.2 ? 16.0 : (hb < 0.5 ? 8.0 : (hb < 0.85 ? 4.0 : 2.0));
      vec2  blk = floor(px / bs);
      vec2  v   = flowAt((blk + 0.5) * bs / u_res, aspect) * u_dt;

      // Whole-pixel moves only: round randomly so slow currents still move
      vec2 off   = floor(v + vec2(hash12(blk + fr * 0.731), hash12(blk.yx + fr * 1.137)));
      vec3 moved = texture2D(u_prev, (px - off + 0.5) / u_res).rgb;

      // A few random pixels are re-poured from the fresh cocktail
      vec3 col = moved;
      if (hash12(px + fr * 3.17) < u_refresh) col = freshCocktail(px, aspect);

      gl_FragColor = vec4(col, 1.0);
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
    const opts = { antialias: false };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return false;

    program = gl.createProgram();
    gl.attachShader(program, compileShader(VERT, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(FRAG, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.useProgram(program);

    ['u_prev', 'u_res', 'u_time', 'u_clock', 'u_frame', 'u_dt', 'u_refresh',
     'u_count', 'u_colors', 'u_bottoms', 'u_patterns',
     'u_mouse', 'u_vel', 'u_slosh', 'u_ripples'].forEach(name => {
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

    // Previous-frame texture: nearest filtering so pixels move whole, never blur
    prevTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.u_prev, 0);

    gl.uniform2f(U.u_mouse, -2.0, -2.0);
    gl.uniform4fv(U.u_ripples, ripples);

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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, null);
    needsFullPour = true;  // texture was wiped, start from a fresh glass
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
    bottoms[count - 1] = 1.0;  // guard against percentages not summing to 100
    gl.uniform1i(U.u_count,     count);
    gl.uniform3fv(U.u_colors,   colors);
    gl.uniform1fv(U.u_bottoms,  bottoms);
    gl.uniform1fv(U.u_patterns, patterns);
  }

  function addRipple(x, y, strength) {
    const i = (rippleIdx++ % 4) * 4;
    ripples[i] = x; ripples[i + 1] = y; ripples[i + 2] = getTime(); ripples[i + 3] = strength;
    lastRipple.x = x; lastRipple.y = y; lastRipple.t = ripples[i + 2];
  }

  // A tap or click drops a ripple where it lands
  function poke(x, y) {
    if (!program) return;
    addRipple(x, y, 1.0);
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

      // Moving pointer leaves a trail of small ripples
      const aspect = gl.canvas.width / gl.canvas.height;
      const moved  = Math.hypot((x - lastRipple.x) * aspect, y - lastRipple.y);
      if (moved > 0.06 && t - lastRipple.t > 0.1) {
        const speed = Math.hypot(rawVel[0], rawVel[1]);
        addRipple(x, y, Math.max(0.3, Math.min(1.0, speed / 1.5)));
      }
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
    gl.uniform4fv(U.u_ripples, ripples);
  }

  function tick() {
    const now = performance.now();
    const dt  = Math.min((now - (lastFrame || now)) / 1000, 0.05);
    lastFrame = now;
    const frames = dt * 60;

    stepFluid(dt);
    gl.uniform1f(U.u_time,  (now - startTime) / 1000 * TIME_SCALE);
    gl.uniform1f(U.u_clock, (now - startTime) / 1000);
    gl.uniform1f(U.u_frame, frame++);
    gl.uniform1f(U.u_dt,    frames * TIME_SCALE);
    gl.uniform1f(U.u_refresh, needsFullPour ? 1.0 : 1 - Math.pow(1 - REFRESH, frames));
    needsFullPour = false;

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Keep this frame as the next frame's "previous"
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, gl.canvas.width, gl.canvas.height);
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

  return { init, setBands, setMouse, poke, getTime, start, destroy };
})();
