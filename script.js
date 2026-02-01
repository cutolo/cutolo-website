// ─── Canvas Grid Animation ───────────────────────────────────────────

(function () {
    const canvas = document.getElementById('grid-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const spacing = isMobile ? 60 : 40;
    const dotBase = 1.2;
    const dotActive = 2.5;
    const interactRadius = 120;
    const lineAlpha = 0.08;
    const lineMaxDist = spacing * 1.6;
    const blue = [20, 0, 255]; // #1400FF
    const grayDot = [224, 224, 224]; // #e0e0e0

    let width, height, cols, rows, dots;
    let mouseX = -9999;
    let mouseY = -9999;
    let time = 0;
    let frameSkip = isMobile ? 2 : 1;
    let frameCount = 0;

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        cols = Math.ceil(width / spacing) + 1;
        rows = Math.ceil(height / spacing) + 1;
        buildDots();
    }

    function buildDots() {
        dots = [];
        const offsetX = (width - (cols - 1) * spacing) / 2;
        const offsetY = (height - (rows - 1) * spacing) / 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                dots.push({
                    baseX: offsetX + c * spacing,
                    baseY: offsetY + r * spacing,
                    x: 0,
                    y: 0,
                    activation: 0,
                });
            }
        }
    }

    function draw() {
        frameCount++;
        if (frameCount % frameSkip !== 0) {
            requestAnimationFrame(draw);
            return;
        }

        time += 0.005;
        ctx.clearRect(0, 0, width, height);

        // Update dot positions with idle drift
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            const driftX = Math.sin(time + d.baseX * 0.005) * 3;
            const driftY = Math.cos(time + d.baseY * 0.007) * 3;
            d.x = d.baseX + driftX;
            d.y = d.baseY + driftY;

            // Mouse proximity activation
            if (!isMobile) {
                const dx = d.x - mouseX;
                const dy = d.y - mouseY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const target = dist < interactRadius ? 1 - dist / interactRadius : 0;
                d.activation += (target - d.activation) * 0.08;
            } else {
                d.activation *= 0.95;
            }
        }

        // Draw connecting lines between activated dots
        if (!isMobile) {
            for (let i = 0; i < dots.length; i++) {
                if (dots[i].activation < 0.05) continue;
                for (let j = i + 1; j < dots.length; j++) {
                    if (dots[j].activation < 0.05) continue;
                    const dx = dots[i].x - dots[j].x;
                    const dy = dots[i].y - dots[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < lineMaxDist) {
                        const strength = Math.min(dots[i].activation, dots[j].activation);
                        const alpha = lineAlpha * strength * (1 - dist / lineMaxDist);
                        ctx.beginPath();
                        ctx.moveTo(dots[i].x, dots[i].y);
                        ctx.lineTo(dots[j].x, dots[j].y);
                        ctx.strokeStyle = `rgba(${blue[0]},${blue[1]},${blue[2]},${alpha})`;
                        ctx.lineWidth = 0.8;
                        ctx.stroke();
                    }
                }
            }
        }

        // Draw dots
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            const a = d.activation;
            const r = dotBase + (dotActive - dotBase) * a;
            const cr = Math.round(grayDot[0] + (blue[0] - grayDot[0]) * a);
            const cg = Math.round(grayDot[1] + (blue[1] - grayDot[1]) * a);
            const cb = Math.round(grayDot[2] + (blue[2] - grayDot[2]) * a);
            const opacity = 0.4 + 0.6 * a;

            ctx.beginPath();
            ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity})`;
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
