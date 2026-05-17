const LiquidShader = (() => {
  let gl, program, raf, startTime;

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
    uniform vec3  u_impact;   // xy = position, z = shader time of impact

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

    // Pattern 1: Small geometric pulp dots (Orange Juice)
    float bubblesPat(vec2 uv) {
      vec2 grid = uv * vec2(16.0, 18.0);
      vec2 id   = floor(grid);
      vec2 cell = fract(grid);
      float rowOffset = mod(id.y, 2.0) * 0.5;
      float seed = hash(id);
      vec2 center = vec2(0.5 + rowOffset, 0.5);
      center.x = fract(center.x);
      center += (vec2(hash(id + 2.1), hash(id + 8.7)) - 0.5) * 0.12;
      float r = 0.035 + seed * 0.012;
      return 1.0 - smoothstep(r - 0.008, r + 0.008, length(cell - center));
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

    // Pattern 4: Static grain (Cognac, Whisky) — baked texture, no animation
    // Large multipliers give well-distributed randomness with no visible period
    float grainPat() {
      return hash(floor(gl_FragCoord.xy * 0.5) * vec2(127.1, 311.7));
    }

    float getPattern(float patId, vec2 uv) {
      if (patId < 1.5) return bubblesPat(uv);
      if (patId < 2.5) return waveStripesPat(uv);
      return fizzPat(uv);
    }

    vec3 applyPattern(vec3 col, float patId, vec2 uv) {
      if (patId < 0.5) {
        return col;
      } else if (patId >= 3.5) {
        // Grain called directly — avoids speculative evaluation of other patterns
        return clamp(col + vec3((grainPat() - 0.5) * 0.06), 0.0, 1.0);
      } else {
        float p = getPattern(patId, uv);
        if (p < 0.001) return col;
        if (patId < 1.5) return col + p * vec3(0.07);    // bubbles: lighter
        if (patId < 2.5) return col * (1.0 - p * 0.08);  // stripes: denser
        return col + p * vec3(0.05);                      // fizz: lighter
      }
    }

    void main() {
      vec2 rawUV = gl_FragCoord.xy / u_res;
      vec2 uv    = rawUV;

      // Barrel distortion
      vec2 c = uv - 0.5;
      uv += c * dot(c, c) * 0.025;
      float y = 1.0 - uv.y;

      // --- Mouse effects ---
      // 1. Subtle static dimple at cursor
      vec2 dm = uv - u_mouse;
      float cursorDimple = exp(-dot(dm, dm) * 25.0) * 0.003;

      // 2. Decaying radial ripple from last impact
      vec2  dimp    = uv - u_impact.xy;
      float impDist = length(dimp);
      float elapsed = max(0.0, u_time - u_impact.z);
      float ripple  = exp(-elapsed * 1.4)
                    * sin(impDist * 22.0 - elapsed * 5.0)
                    * exp(-impDist * 4.5)
                    * 0.011;

      float mouseEdgeWarp = cursorDimple + ripple;

      // --- Pattern UV: scatter away from mouse + impact ---
      vec2  dm2    = rawUV - u_mouse;
      float md     = length(dm2);
      vec2  dimp2  = rawUV - u_impact.xy;
      float impD2  = length(dimp2);
      float elap2  = max(0.0, u_time - u_impact.z);
      vec2  patUV  = rawUV
                   + dm2   * exp(-md   * md   * 10.0)  * 0.04
                   + dimp2 * exp(-impD2 * 4.0)
                           * exp(-elap2 * 1.5) * 0.04;

      // Default: first band
      vec3 col = applyPattern(u_colors[0], u_patterns[0], patUV);

      float n, edge, wobble;

      if (u_count > 1) {
        n      = fbm(vec2(uv.x * 2.8, u_time * 0.055));
        wobble = sin(u_time * 0.18) * 0.018;
        edge   = u_bottoms[0] + (n - 0.5) * 0.09 + wobble + mouseEdgeWarp;
        if (y > edge) col = applyPattern(u_colors[1], u_patterns[1], patUV);
      }
      if (u_count > 2) {
        n      = fbm(vec2(uv.x * 2.8, u_time * 0.055 + 7.3));
        wobble = sin(u_time * 0.18 + 2.09) * 0.018;
        edge   = u_bottoms[1] + (n - 0.5) * 0.09 + wobble + mouseEdgeWarp;
        if (y > edge) col = applyPattern(u_colors[2], u_patterns[2], patUV);
      }
      if (u_count > 3) {
        n      = fbm(vec2(uv.x * 2.8, u_time * 0.055 + 14.6));
        wobble = sin(u_time * 0.18 + 4.19) * 0.018;
        edge   = u_bottoms[2] + (n - 0.5) * 0.09 + wobble + mouseEdgeWarp;
        if (y > edge) col = applyPattern(u_colors[3], u_patterns[3], patUV);
      }
      if (u_count > 4) {
        n      = fbm(vec2(uv.x * 2.8, u_time * 0.055 + 21.9));
        wobble = sin(u_time * 0.18 + 1.05) * 0.018;
        edge   = u_bottoms[3] + (n - 0.5) * 0.09 + wobble + mouseEdgeWarp;
        if (y > edge) col = applyPattern(u_colors[4], u_patterns[4], patUV);
      }
      if (u_count > 5) {
        n      = fbm(vec2(uv.x * 2.8, u_time * 0.055 + 29.2));
        wobble = sin(u_time * 0.18 + 3.14) * 0.018;
        edge   = u_bottoms[4] + (n - 0.5) * 0.09 + wobble + mouseEdgeWarp;
        if (y > edge) col = applyPattern(u_colors[5], u_patterns[5], patUV);
      }

      // Vignette
      float dist     = length(uv - 0.5);
      float vignette = 1.0 - smoothstep(0.3, 0.85, dist) * 0.35;

      // Top-right specular highlight
      float hl = exp(-length((uv - vec2(0.72, 0.15)) * vec2(2.0, 1.5)) * 4.5) * 0.1;

      gl_FragColor = vec4(col * vignette + vec3(hl), 1.0);
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

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  1,-1,  -1, 1,
       1,-1,  1, 1,  -1, 1,
    ]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(gl.getUniformLocation(program, 'u_mouse'),  -2.0, -2.0);
    gl.uniform3f(gl.getUniformLocation(program, 'u_impact'), -2.0, -2.0, -100.0);

    resize();
    window.addEventListener('resize', resize);
    startTime = performance.now();
    return true;
  }

  function resize() {
    const canvas = gl.canvas;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(gl.getUniformLocation(program, 'u_res'), canvas.width, canvas.height);
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
    gl.uniform1i(gl.getUniformLocation(program, 'u_count'),    count);
    gl.uniform3fv(gl.getUniformLocation(program, 'u_colors'),   colors);
    gl.uniform1fv(gl.getUniformLocation(program, 'u_bottoms'),  bottoms);
    gl.uniform1fv(gl.getUniformLocation(program, 'u_patterns'), patterns);
  }

  function setMouse(x, y) {
    if (!program) return;
    gl.uniform2f(gl.getUniformLocation(program, 'u_mouse'), x, y);
  }

  function setImpact(x, y, t) {
    if (!program) return;
    gl.uniform3f(gl.getUniformLocation(program, 'u_impact'), x, y, t);
  }

  function getTime() {
    return startTime ? (performance.now() - startTime) / 1000 : 0;
  }

  function tick() {
    const t = (performance.now() - startTime) / 1000;
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (raf) cancelAnimationFrame(raf);
    tick();
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  }

  return { init, setBands, setMouse, setImpact, getTime, start, destroy };
})();
