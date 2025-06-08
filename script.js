// Tooltip content for each portfolio item
const tooltipContent = {
    wolt: "Alchemy, Wolt design system",
    orbit: "Design system workshops and consultations",
    klarna: "Bubble, Klarna design system",
    illustrations: "Klarna product illustration system",
    airc: "AIRC graphic design system.",
    parmalat: "Parmalat mobile apps."
};

// Create tooltip element
const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
document.body.appendChild(tooltip);

// Mouse position tracking
let mouseX = 0;
let mouseY = 0;
let tooltipX = 0;
let tooltipY = 0;

// Smooth following animation
function animateTooltip() {
    const ease = 0.1; // Adjust this value to control the delay/smoothness (0.1 = smooth delay)

    tooltipX += (mouseX - tooltipX) * ease;
    tooltipY += (mouseY - tooltipY) * ease;

    tooltip.style.left = tooltipX + 'px';
    tooltip.style.top = tooltipY + 'px';

    requestAnimationFrame(animateTooltip);
}

// Start the animation loop
animateTooltip();

// Track mouse movement
document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX + 15; // Offset to avoid cursor overlap
    mouseY = e.clientY + 20; // Position below the cursor
});

// Add hover events to portfolio items
document.querySelectorAll('.portfolio .item').forEach(item => {
    const itemId = item.id;

    item.addEventListener('mouseenter', () => {
        if (tooltipContent[itemId]) {
            tooltip.textContent = tooltipContent[itemId];
            tooltip.classList.add('visible');
        }
    });

    item.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
    });
});
