// ─── Polygon Shard Shader ─────────────────────────────────────────────

(function () {
    const canvas = document.getElementById('grid-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    // Config
    const spacing = isMobile ? 65 : 42;
    const jitter = spacing * 0.25;
    const interactRadius = isMobile ? 0 : 140;
    const blue = [20, 0, 255];

    function isDarkMode() {
        return document.documentElement.dataset.theme === 'dark';
    }

    let width, height, points, triangles, gridCols;
    let mouseX = -9999, mouseY = -9999;
    let prevMouseX = -9999, prevMouseY = -9999;
    let mouseVelX = 0, mouseVelY = 0;
    let time = 0;
    let frameCount = 0;

    // Seeded random for consistent jitter
    function seededRandom(x, y) {
        let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
    }

    // ─── Build Points & Grid Triangulation ───────────────────────────

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        buildMesh();
    }

    function buildMesh() {
        points = [];
        triangles = [];
        const cols = Math.ceil(width / spacing) + 3;
        const rows = Math.ceil(height / spacing) + 3;
        gridCols = cols;

        // Create jittered grid points
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const jx = (seededRandom(c, r) - 0.5) * jitter * 2;
                const jy = (seededRandom(r, c + 100) - 0.5) * jitter * 2;
                points.push({
                    baseX: (c - 1) * spacing + jx,
                    baseY: (r - 1) * spacing + jy,
                    x: 0, y: 0,
                    activation: 0,
                    phase: seededRandom(c * 7, r * 13) * Math.PI * 2,
                    speed: 0.3 + seededRandom(c + 50, r + 50) * 0.4,
                    amp: 2 + seededRandom(c + 99, r + 99) * 4,
                });
            }
        }

        // Triangulate: each grid cell → 2 triangles
        // Alternate diagonal direction per cell for more organic look
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const tl = r * cols + c;
                const tr = tl + 1;
                const bl = (r + 1) * cols + c;
                const br = bl + 1;

                if ((r + c) % 2 === 0) {
                    // Diagonal: tl → br
                    triangles.push([tl, tr, br]);
                    triangles.push([tl, br, bl]);
                } else {
                    // Diagonal: tr → bl
                    triangles.push([tl, tr, bl]);
                    triangles.push([tr, br, bl]);
                }
            }
        }
    }

    // ─── Rendering ───────────────────────────────────────────────────

    function draw() {
        frameCount++;
        time += 0.006;
        ctx.clearRect(0, 0, width, height);

        // Mouse velocity (smoothed)
        mouseVelX += (mouseX - prevMouseX - mouseVelX) * 0.12;
        mouseVelY += (mouseY - prevMouseY - mouseVelY) * 0.12;
        prevMouseX = mouseX;
        prevMouseY = mouseY;
        const mouseSpeed = Math.sqrt(mouseVelX * mouseVelX + mouseVelY * mouseVelY);

        // Update point positions
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const driftX = Math.sin(time * p.speed + p.phase) * p.amp;
            const driftY = Math.cos(time * p.speed * 0.7 + p.phase + 1.3) * p.amp;
            p.x = p.baseX + driftX;
            p.y = p.baseY + driftY;

            // Mouse repulsion + activation
            if (!isMobile) {
                const dx = p.x - mouseX;
                const dy = p.y - mouseY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const target = dist < interactRadius ? 1 - dist / interactRadius : 0;
                p.activation += (target - p.activation) * 0.05;

                // Push points away from cursor
                if (dist < interactRadius && dist > 1) {
                    const force = (1 - dist / interactRadius) * 4 * (1 + mouseSpeed * 0.02);
                    p.x += (dx / dist) * force;
                    p.y += (dy / dist) * force;
                }
            } else {
                p.activation *= 0.95;
            }
        }

        // ─── Draw shard fills ────────────────────────────────────────
        for (let t = 0; t < triangles.length; t++) {
            const tri = triangles[t];
            const p0 = points[tri[0]], p1 = points[tri[1]], p2 = points[tri[2]];

            const avgAct = (p0.activation + p1.activation + p2.activation) / 3;
            const maxAct = Math.max(p0.activation, p1.activation, p2.activation);

            const cx = (p0.x + p1.x + p2.x) / 3;
            const cy = (p0.y + p1.y + p2.y) / 3;

            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.closePath();

            // Idle: breathing subtle fill
            const idlePulse = 0.012 + Math.sin(time * 0.5 + cx * 0.003 + cy * 0.002) * 0.008;

            if (maxAct > 0.01) {
                // Active: blue shard fill
                const fillAlpha = avgAct * 0.10 + idlePulse;
                const shimmer = Math.sin(time * 3 + cx * 0.01 + cy * 0.008) * 0.5 + 0.5;
                const sr = Math.round(blue[0] + (255 - blue[0]) * shimmer * avgAct * 0.1);
                const sg = Math.round(blue[1] + 40 * shimmer * avgAct * 0.08);
                const sb = Math.round(blue[2]);
                ctx.fillStyle = `rgba(${sr},${sg},${sb},${fillAlpha})`;
            } else {
                ctx.fillStyle = isDarkMode()
                    ? `rgba(50,50,60,${idlePulse * 3})`
                    : `rgba(230,230,238,${idlePulse})`;
            }
            ctx.fill();
        }

        // ─── Draw shard edges ────────────────────────────────────────
        // Collect unique edges to avoid double-drawing
        const edgeSet = new Set();

        for (let t = 0; t < triangles.length; t++) {
            const tri = triangles[t];
            const verts = [points[tri[0]], points[tri[1]], points[tri[2]]];
            const idxs = [tri[0], tri[1], tri[2]];

            for (let e = 0; e < 3; e++) {
                const i1 = idxs[e], i2 = idxs[(e + 1) % 3];
                const key = i1 < i2 ? i1 * 100000 + i2 : i2 * 100000 + i1;
                if (edgeSet.has(key)) continue;
                edgeSet.add(key);

                const a = verts[e], b = verts[(e + 1) % 3];
                const edgeAct = (a.activation + b.activation) / 2;
                const idleAlpha = 0.07 + Math.sin(time * 0.3 + a.baseX * 0.005 + a.baseY * 0.003) * 0.025;

                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);

                if (edgeAct > 0.01) {
                    // Glowing blue edge
                    const glow = edgeAct * 0.4;
                    const pulse = 1 + Math.sin(time * 4 + a.x * 0.02) * 0.08;
                    const alpha = Math.min(glow * pulse + idleAlpha, 0.45);
                    ctx.strokeStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${alpha})`;
                    ctx.lineWidth = 0.5 + edgeAct * 1.0;
                    ctx.stroke();
                } else {
                    // Idle: faint gray mesh
                    ctx.strokeStyle = isDarkMode()
                        ? `rgba(80,80,90,${idleAlpha})`
                        : `rgba(210,210,215,${idleAlpha})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        // ─── Draw vertex dots on activated points ────────────────────
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.activation < 0.03) continue;

            const a = p.activation;
            const r = 1 + a * 1.5;
            const pulse = 1 + Math.sin(time * 5 + p.phase) * 0.15 * a;
            const alpha = a * 0.45;

            ctx.beginPath();
            ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${alpha})`;
            ctx.fill();
        }

        requestAnimationFrame(draw);
    }

    // Events
    window.addEventListener('resize', resize);

    if (!isMobile) {
        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });
    }

    resize();
    draw();
})();


// ─── Theme Toggle ────────────────────────────────────────────────────

(function () {
    const html = document.documentElement;
    const saved = localStorage.getItem('theme');
    if (saved) html.dataset.theme = saved;

    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.setAttribute('aria-label', 'Toggle colour theme');

    function updateLabel() {
        btn.textContent = html.dataset.theme === 'dark' ? 'light' : 'dark';
    }

    updateLabel();

    btn.addEventListener('click', () => {
        const dark = html.dataset.theme === 'dark';
        html.dataset.theme = dark ? 'light' : 'dark';
        localStorage.setItem('theme', html.dataset.theme);
        updateLabel();
    });

    document.body.appendChild(btn);
})();


// ─── Reveal Animations ──────────────────────────────────────────────

(function () {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;

    // Header reveals: staggered on page load
    const headerReveals = document.querySelectorAll('header .reveal');
    headerReveals.forEach((el, i) => {
        setTimeout(() => el.classList.add('visible'), i * 80);
    });

    // All other reveals: IntersectionObserver
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    reveals.forEach((el) => {
        // Skip header elements (already handled above)
        if (!el.closest('header')) {
            observer.observe(el);
        }
    });
})();
