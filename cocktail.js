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

// 0 = none, 1 = rising bubbles, 2 = wavy stripes, 3 = tiny fizz, 4 = film grain
const INGREDIENT_PATTERNS = {
  'Orange Juice': 1,  // bubbles — pulpy citrus
  'Lemon Juice':  2,  // stripes — squeezed citrus
  'Water':        3,  // fizz — carbonation
  'Whisky':       4,  // grain — barrel-aged warmth
};

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function randomIndex(total) {
  return Math.floor(Math.random() * total);
}

function loadCocktail(cocktail) {
  document.getElementById('cocktail-name').textContent = cocktail.name;
  document.getElementById('cocktail-instructions').textContent = cocktail.instructions;

  const ingredientColors = cocktail.ingredients.map(ing => INGREDIENT_COLORS[ing.name] || '#A0A0A0');
  document.documentElement.style.setProperty('--top-ingredient-color', ingredientColors[ingredientColors.length - 1]);
  document.documentElement.style.setProperty('--bottom-ingredient-color', ingredientColors[0]);
  document.body.style.backgroundColor = ingredientColors[0];

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', ingredientColors[ingredientColors.length - 1]);

  const ul = document.getElementById('cocktail-ingredients');
  ul.innerHTML = '';
  cocktail.ingredients.forEach(ing => {
    const li = document.createElement('li');
    li.textContent = `${ing.pct} % ${ing.name}`;
    ul.appendChild(li);
  });

  const bands = cocktail.ingredients.map(ing => ({
    pct:     ing.pct / 100,
    rgb:     hexToRgb(INGREDIENT_COLORS[ing.name] || '#A0A0A0'),
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
  const ok = LiquidShader.init('gl-canvas');

  fetch('cocktails.json')
    .then(r => r.json())
    .then(cocktails => {
      const idx = randomIndex(cocktails.length);
      loadCocktail(cocktails[idx]);
      if (ok) {
        LiquidShader.start();
        const impactCooldown = 3.0;
        let _lmx = -2, _lmy = -2, _lmt = 0, _lit = -100;
        document.addEventListener('mousemove', e => {
          const mx = e.clientX / window.innerWidth;
          const my = 1.0 - e.clientY / window.innerHeight;
          const mt = LiquidShader.getTime();
          LiquidShader.setMouse(mx, my);
          const dt = mt - _lmt;
          if (dt > 0.01 && dt < 0.15) {
            const speed = Math.hypot(mx - _lmx, my - _lmy) / dt;
            if (speed > 0.25 && mt - _lit > impactCooldown) {
              LiquidShader.setImpact(mx, my, mt);
              _lit = mt;
            }
          }
          _lmx = mx; _lmy = my; _lmt = mt;
        });
        document.addEventListener('mouseleave', () => {
          LiquidShader.setMouse(-2.0, -2.0);
        });
      } else {
        const hex = INGREDIENT_COLORS[cocktails[idx].ingredients[0].name] || '#C8A050';
        document.body.style.backgroundColor = hex;
      }
    });
});
