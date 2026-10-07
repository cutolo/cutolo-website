const INGREDIENT_COLORS = {
  'Cognac':          '#E8A030',
  'Sweet Vermouth':  '#C08858',
  'Dry Vermouth':    '#D4B888',
  'Medoc Cordial':   '#B87878',
  'Gin':             '#BDD5DC',
  'Rum':             '#D4943A',
  'Whisky':          '#C48830',
  'Campari':         '#E07868',
  'Lemon Juice':     '#F0E040',
  'Orange Juice':    '#F0A840',
  'Angostura':       '#B89060',
  'Cointreau':       '#F0B840',
  'Bénédictine':     '#CCA820',
  'Chartreuse':      '#A8C030',
  'Crème de Menthe': '#78B888',
  'Coffee Liqueur':  '#A07850',
  'Absinthe':        '#78A038',
  'Anisette':        '#D8D098',
  'Arak':            '#D0C8A0',
  'Water':           '#C8E0F0',
  'Simple Syrup':    '#F8E888',
  'Sugar':           '#F8F0D0',
  'Orange Liqueur':  '#F0A040',
  'Apricot Liqueur': '#E8A050',
  'Select':          '#E08848',
  'China Bitter':    '#B07838',
};

// 0 = none, 1 = pulp dots, 2 = wavy stripes, 3 = tiny fizz, 4 = static grain, 5 = leaf shapes
const INGREDIENT_PATTERNS = {
  'Orange Juice':    1,  // bubbles — pulpy citrus
  'Lemon Juice':     2,  // stripes — squeezed citrus
  'Water':           3,  // fizz — carbonation
  'Cognac':          4,  // static grain — barrel-aged
  'Whisky':          4,  // static grain — barrel-aged
  'Crème de Menthe': 5,  // organic leaves — herbal mint
};

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function rgbToHex(rgb) {
  return '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

// Relative luminance (WCAG) of an [r, g, b] colour in 0–1
function luminance(rgb) {
  const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// Black text needs luminance ≥ 0.30 for 7:1 contrast (WCAG AAA).
// Darker ingredients are nudged toward white just enough, never more than 12%;
// lighter ones are returned untouched.
const MIN_TEXT_LUMINANCE = 0.30;
function liftForText(hex) {
  const rgb = hexToRgb(hex);
  const mixed = k => rgb.map(c => c + (1 - c) * k);
  let t = 0;
  while (luminance(mixed(t)) < MIN_TEXT_LUMINANCE && t < 0.12) t += 0.005;
  return mixed(t);
}

function randomIndex(total) {
  return Math.floor(Math.random() * total);
}

function setAppHeight() {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

setAppHeight();

function loadCocktail(cocktail) {
  document.getElementById('cocktail-name').textContent = cocktail.name;
  document.getElementById('cocktail-instructions').textContent = cocktail.instructions;

  const ingredientRgb = cocktail.ingredients.map(ing => liftForText(INGREDIENT_COLORS[ing.name] || '#A0A0A0'));
  const ingredientColors = ingredientRgb.map(rgbToHex);
  const firstColor = ingredientColors[0];
  const lastColor  = ingredientColors[ingredientColors.length - 1];
  document.documentElement.style.setProperty('--top-ingredient-color', firstColor);
  document.documentElement.style.setProperty('--bottom-ingredient-color', lastColor);

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', firstColor);

  const ul = document.getElementById('cocktail-ingredients');
  ul.innerHTML = '';
  cocktail.ingredients.forEach(ing => {
    const li = document.createElement('li');
    li.textContent = `${ing.pct} % ${ing.name}`;
    ul.appendChild(li);
  });

  const bands = cocktail.ingredients.map((ing, i) => ({
    pct:     ing.pct / 100,
    rgb:     ingredientRgb[i],
    pattern: INGREDIENT_PATTERNS[ing.name] || 0,
  }));

  LiquidShader.setBands(bands);
}

function initDebugMenu(cocktails, activeIndex) {
  const btn  = document.getElementById('debug-btn');
  const menu = document.getElementById('debug');
  const list = document.getElementById('debug-list');

  cocktails.forEach((c, i) => {
    const li = document.createElement('li');
    li.textContent = c.name;
    if (i === activeIndex) li.classList.add('active');
    li.onclick = () => {
      list.querySelectorAll('li').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      loadCocktail(c);
    };
    list.appendChild(li);
  });

  btn.onclick = () => { menu.hidden = !menu.hidden; };

  document.addEventListener('keydown', e => {
    if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      menu.hidden = !menu.hidden;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', setAppHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppHeight);
    window.visualViewport.addEventListener('scroll', setAppHeight);
  }

  const ok = LiquidShader.init('gl-canvas');

  fetch('cocktails.json')
    .then(r => r.json())
    .then(cocktails => {
      const idx = randomIndex(cocktails.length);
      loadCocktail(cocktails[idx]);
      if (ok) {
        LiquidShader.start();
        // Pointer events cover mouse, pen and touch (stirring with a finger)
        const toUV = e => [e.clientX / window.innerWidth, 1.0 - e.clientY / window.innerHeight];
        const release = () => LiquidShader.setMouse(-2.0, -2.0);
        document.addEventListener('pointermove', e => LiquidShader.setMouse(...toUV(e)));
        document.addEventListener('pointerdown', e => {
          LiquidShader.setMouse(...toUV(e));
          LiquidShader.poke(...toUV(e));
        });
        document.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') release(); });
        document.addEventListener('pointercancel', release);
        document.documentElement.addEventListener('mouseleave', release);
      }
    });
});
