// ─── Polygon Shard Shader ─────────────────────────────────────────────

(function () {
    const canvas = document.getElementById('grid-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    // Config
    const spacing = isMobile ? 70 : 44;
    const jitter = spacing * 0.35;
    const interactRadius = isMobile ? 0 : 200;
    const blue = [20, 0, 255];
    const edgeGray = [210, 210, 210];

    let width, height, points, triangles;
    let mouseX = -9999, mouseY = -9999;
    let prevMouseX = -9999, prevMouseY = -9999;
    let mouseVelX = 0, mouseVelY = 0;
    let time = 0;
    let frameSkip = isMobile ? 2 : 1;
    let frameCount = 0;

    // Seeded random for consistent jitter
    function seededRandom(x, y) {
        let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
    }

    // ─── Delaunay Triangulation (Bowyer-Watson) ──────────────────────

    function triangulate(pts) {
        const st = superTriangle(pts);
        let tris = [st];

        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const bad = [];
            const poly = [];

            for (let t = 0; t < tris.length; t++) {
                const tri = tris[t];
                if (inCircumcircle(p, tri)) {
                    bad.push(t);
                }
            }

            // Find boundary polygon of bad triangles
            for (let b = 0; b < bad.length; b++) {
                const tri = tris[bad[b]];
                for (let e = 0; e < 3; e++) {
                    const e1 = tri[e], e2 = tri[(e + 1) % 3];
                    let shared = false;
                    for (let b2 = 0; b2 < bad.length; b2++) {
                        if (b2 === b) continue;
                        const other = tris[bad[b2]];
                        if (hasEdge(other, e1, e2)) { shared = true; break; }
                    }
                    if (!shared) poly.push([e1, e2]);
                }
            }

            // Remove bad triangles (reverse order)
            bad.sort((a, b) => b - a);
            for (let b = 0; b < bad.length; b++) tris.splice(bad[b], 1);

            // Create new triangles from polygon edges to new point
            for (let e = 0; e < poly.length; e++) {
                tris.push([poly[e][0], poly[e][1], i]);
            }
        }

        // Remove triangles connected to super triangle vertices
        const stIds = [pts.length, pts.length + 1, pts.length + 2];
        tris = tris.filter(t =>
            !stIds.includes(t[0]) && !stIds.includes(t[1]) && !stIds.includes(t[2])
        );

        return tris;
    }

    function superTriangle(pts) {
        return [pts.length, pts.length + 1, pts.length + 2];
    }

    function inCircumcircle(p, tri) {
        const [ai, bi, ci] = tri;
        const a = allPts[ai], b = allPts[bi], c = allPts[ci];
        const ax = a.x - p.x, ay = a.y - p.y;
        const bx = b.x - p.x, by = b.y - p.y;
        const cx = c.x - p.x, cy = c.y - p.y;
        const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
                  - (bx * bx + by * by) * (ax * cy - cx * ay)
                  + (cx * cx + cy * cy) * (ax * by - bx * ay);
        return det > 0;
    }

    function hasEdge(tri, e1, e2) {
        for (let i = 0; i < 3; i++) {
            const a = tri[i], b = tri[(i + 1) % 3];
            if ((a === e1 && b === e2) || (a === e2 && b === e1)) return true;
        }
        return false;
    }

    let allPts = [];

    // ─── Build Points & Mesh ─────────────────────────────────────────

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        buildMesh();
    }

    function buildMesh() {
        points = [];
        const cols = Math.ceil(width / spacing) + 2;
        const rows = Math.ceil(height / spacing) + 2;

        for (let r = -1; r <= rows; r++) {
            for (let c = -1; c <= cols; c++) {
                const jx = (seededRandom(c, r) - 0.5) * jitter * 2;
                const jy = (seededRandom(r, c + 100) - 0.5) * jitter * 2;
                points.push({
                    baseX: c * spacing + jx,
                    baseY: r * spacing + jy,
                    x: 0, y: 0,
                    activation: 0,
                    phase: seededRandom(c * 7, r * 13) * Math.PI * 2,
                    speed: 0.3 + seededRandom(c + 50, r + 50) * 0.4,
                    amp: 2 + seededRandom(c + 99, r + 99) * 4,
                });
            }
        }

        // Build super triangle points (far outside viewport)
        const margin = Math.max(width, height) * 4;
        allPts = points.map(p => ({ x: p.baseX, y: p.baseY }));
        allPts.push({ x: width / 2, y: -margin });
        allPts.push({ x: -margin, y: margin });
        allPts.push({ x: width + margin, y: margin });

        triangles = triangulate(points.map((_, i) => i));
    }

    // ─── Rendering ───────────────────────────────────────────────────

    function draw() {
        frameCount++;
        if (frameCount % frameSkip !== 0) {
            requestAnimationFrame(draw);
            return;
        }

        time += 0.006;
        ctx.clearRect(0, 0, width, height);

        // Mouse velocity
        mouseVelX += (mouseX - prevMouseX - mouseVelX) * 0.1;
        mouseVelY += (mouseY - prevMouseY - mouseVelY) * 0.1;
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
                p.activation += (target - p.activation) * 0.06;

                // Push points away from cursor slightly
                if (dist < interactRadius && dist > 0) {
                    const force = (1 - dist / interactRadius) * 8 * (1 + mouseSpeed * 0.05);
                    p.x += (dx / dist) * force;
                    p.y += (dy / dist) * force;
                }
            } else {
                p.activation *= 0.95;
            }
        }

        // Draw shard fills
        for (let t = 0; t < triangles.length; t++) {
            const tri = triangles[t];
            const p0 = points[tri[0]], p1 = points[tri[1]], p2 = points[tri[2]];
            if (!p0 || !p1 || !p2) continue;

            const avgAct = (p0.activation + p1.activation + p2.activation) / 3;
            const maxAct = Math.max(p0.activation, p1.activation, p2.activation);

            // Centroid for gradient
            const cx = (p0.x + p1.x + p2.x) / 3;
            const cy = (p0.y + p1.y + p2.y) / 3;

            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.closePath();

            // Idle state: very subtle fill
            const idlePulse = 0.008 + Math.sin(time * 0.5 + cx * 0.003 + cy * 0.002) * 0.005;

            if (maxAct > 0.02) {
                // Active shards: blue fill with intensity based on activation
                const fillAlpha = avgAct * 0.18 + idlePulse;
                const shimmer = Math.sin(time * 3 + cx * 0.01 + cy * 0.01) * 0.5 + 0.5;
                const r = Math.round(blue[0] + (255 - blue[0]) * shimmer * avgAct * 0.15);
                const g = Math.round(blue[1] + (100) * shimmer * avgAct * 0.1);
                const b = Math.round(blue[2] + (255 - blue[2]) * shimmer * avgAct * 0.05);
                ctx.fillStyle = `rgba(${r},${g},${b},${fillAlpha})`;
            } else {
                // Idle: nearly invisible gray
                ctx.fillStyle = `rgba(230,230,235,${idlePulse})`;
            }
            ctx.fill();
        }

        // Draw shard edges
        for (let t = 0; t < triangles.length; t++) {
            const tri = triangles[t];
            const p0 = points[tri[0]], p1 = points[tri[1]], p2 = points[tri[2]];
            if (!p0 || !p1 || !p2) continue;

            const pairs = [[p0, p1], [p1, p2], [p2, p0]];

            for (let e = 0; e < 3; e++) {
                const a = pairs[e][0], b = pairs[e][1];
                const edgeAct = (a.activation + b.activation) / 2;

                // Idle edges: subtle gray mesh
                const idleAlpha = 0.06 + Math.sin(time * 0.3 + a.baseX * 0.005) * 0.02;

                if (edgeAct > 0.02) {
                    // Active: glowing blue edges
                    const glow = edgeAct * 0.6;
                    const pulse = 1 + Math.sin(time * 4 + a.x * 0.02) * 0.2;
                    const alpha = Math.min(glow * pulse + idleAlpha, 0.8);
                    const lineW = 0.5 + edgeAct * 2;

                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.strokeStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${alpha})`;
                    ctx.lineWidth = lineW;
                    ctx.stroke();

                    // Outer glow on strong edges
                    if (edgeAct > 0.3) {
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.strokeStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${edgeAct * 0.12})`;
                        ctx.lineWidth = lineW + 4;
                        ctx.stroke();
                    }
                } else {
                    // Idle mesh lines
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    const er = Math.round(edgeGray[0]);
                    const eg = Math.round(edgeGray[1]);
                    const eb = Math.round(edgeGray[2]);
                    ctx.strokeStyle = `rgba(${er},${eg},${eb},${idleAlpha})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        // Draw vertices on activated points
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.activation < 0.05) continue;

            const a = p.activation;
            const r = 1 + a * 2.5;
            const pulse = 1 + Math.sin(time * 5 + p.phase) * 0.3 * a;
            const alpha = a * 0.7;

            ctx.beginPath();
            ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${alpha})`;
            ctx.fill();

            // Vertex glow
            if (a > 0.4) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r * pulse + 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${a * 0.08})`;
                ctx.fill();
            }
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
