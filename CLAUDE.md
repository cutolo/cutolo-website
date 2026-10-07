# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal website of Francesco Cutolo (cutolo.xyz). Static site with no build tools, package managers, or frameworks — pure HTML, CSS, and vanilla JavaScript. A single page: a short intro over a full-screen WebGL "cocktail of the day", drawn as layered ingredients made of moving dithered pixels.

## Development

**Serve locally** using any static file server (opening `index.html` directly won't work: `fetch('cocktails.json')` is blocked on `file://`):
```bash
python3 -m http.server 8000
```

**Deploy** by pushing to `main` — GitHub Pages automatically deploys to cutolo.xyz. Use a feature branch for work in progress.

No build step, test suite, or linter is configured.

## Architecture

```
/
├── index.html       # The page: intro, links, cocktail card, debug menu
├── style.css        # Layout + typography (mobile breakpoint at 767px)
├── shader.js        # LiquidShader: WebGL renderer for the cocktail
├── cocktail.js      # Ingredient colours/patterns, picks a cocktail, wires pointer input
├── cocktails.json   # ~70 cocktails: name, instructions, ingredients with pct
├── images/          # Legacy portfolio images (preserved, unused)
└── CNAME            # DNS → cutolo.xyz
```

**cocktail.js**
- `INGREDIENT_COLORS` (hex per ingredient) and `INGREDIENT_PATTERNS` (0 none, 1 pulp dots, 2 wavy stripes, 3 fizz, 4 grain, 5 leaves).
- `liftForText()` nudges dark ingredient colours toward white (max 12%) so black text keeps ~7:1 contrast. The same corrected colours feed the shader, the `html` background gradient and `theme-color`.
- Picks a random cocktail on load (`D` key or the hidden debug button toggles a picker), then forwards pointer events to the shader: `setMouse` on move, `poke` on tap/click.

**shader.js** — `LiquidShader` module, one fragment shader with a feedback loop (datamosh):
- Canvas renders at `window size / PIXEL` (2) and is upscaled with `image-rendering: pixelated`.
- Every frame reads the previous frame (`copyTexSubImage2D` into `prevTex`) and moves blocks of pixels (random 2–16px macroblocks) along a slow curl-noise current. Moves are whole pixels with random rounding, so dots travel instead of blurring. The current is calm inside layers and stronger near layer boundaries.
- `REFRESH` (~4%) of pixels per frame are re-poured from `freshCocktail()`: the clean image with layers at their exact proportions, a narrow dithered blend at each boundary (Bayer 8×8), ingredient patterns, and faint light specks (`TONE_SOFTNESS`).
- Pointer moves individual pixels along its velocity with slight scatter; taps add a short outward push (`u_splashes`). Fast sideways motion tilts the layers on a damped spring (slosh).
- `prefers-reduced-motion` slows animation to 30% and disables slosh.

**style.css** — Recursive font (Google Fonts) in italic, 15px base (16px mobile), black text, `main` max-width 480px. Mobile locks the layout to the visual viewport (`--app-height`) for Safari.

## Key Details

- Design: minimal, typography-first, black text over the full-screen cocktail.
- The workshop paragraph in `index.html` is `hidden` (kept for later; its CTA is a placeholder `href="#"`).
- Remote: `git@github-personal:cutolo/cutolo-website.git` (SSH with personal GitHub config).
