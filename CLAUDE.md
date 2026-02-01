# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio and course website for Francesco Cutolo (cutolo.xyz). Static site with no build tools, package managers, or frameworks — pure HTML, CSS, and vanilla JavaScript. Two pages: home (personal) and course landing page.

## Development

**Serve locally** using any static file server:
```bash
python3 -m http.server 8000
```

**Deploy** by pushing to `main` — GitHub Pages automatically deploys to cutolo.xyz.

No build step, test suite, or linter is configured.

## Architecture

```
/
├── index.html          # Home page (personal, work list, teaching link)
├── style.css           # Shared styles (both pages)
├── script.js           # Shared JS (canvas animation, reveals)
├── course/
│   └── index.html      # "Humanist Design Systems" course landing page
├── images/             # Legacy portfolio images (preserved)
└── CNAME               # DNS → cutolo.xyz
```

**style.css** — Mobile-first with single breakpoint at 768px. CSS custom properties for colors (`--blue: #1400FF`, `--black`, `--white`). Narrow `max-width: 540px` on desktop. Typography system at 15px base with Inconsolata monospace. Components: `.reveal` (scroll/load animations), `.btn` (blue CTA), `.work-list`, `.learn-list`, `.breadcrumb`.

**script.js** — Two systems:
- **Canvas grid animation**: Full-viewport fixed canvas with dot grid (~40px spacing). Dots drift with sine-wave idle animation. On desktop, mouse proximity activates nearby dots (blue color, enlarged, connecting lines). On mobile, reduced density and no mouse interaction.
- **Reveal animations**: Header elements stagger on page load (80ms intervals). All other `.reveal` elements use IntersectionObserver for scroll-triggered fade-in/slide-up.

## Key Details

- Design: minimal, monospaced, typography-first, white + electric blue (#1400FF)
- Font: Inconsolata (Google Fonts)
- Course CTA links to Gumroad (placeholder `href="#"` — update when ready)
- Remote: `git@github-personal:cutolo/cutolo-website.git` (SSH with personal GitHub config)
- DNS: CNAME file points to cutolo.xyz
