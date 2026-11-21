// Background atmosphere: iron fence, bats, lightning and a reaper passing by.
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';

  // Iron fence spikes
  const fence = document.getElementById('fence');
  if (fence) {
    for (let x = 6; x < 1440; x += 22) {
      const bar = document.createElementNS(NS, 'rect');
      bar.setAttribute('x', x);
      bar.setAttribute('y', 336);
      bar.setAttribute('width', 4);
      bar.setAttribute('height', 60);
      fence.appendChild(bar);
      const tip = document.createElementNS(NS, 'path');
      tip.setAttribute('d', `M${x - 3} 338 L${x + 2} 324 L${x + 7} 338Z`);
      fence.appendChild(tip);
    }
  }

  if (reduced) return;

  // Bats
  const batSvg =
    '<svg viewBox="0 0 64 30"><path d="M32 12 C 30 8 28 8 27 10 C 22 4 12 2 0 8 C 8 9 10 14 10 18 C 14 14 20 15 22 20 C 24 16 28 15 32 20 C 36 15 40 16 42 20 C 44 15 50 14 54 18 C 54 14 56 9 64 8 C 52 2 42 4 37 10 C 36 8 34 8 32 12Z" fill="#050407"/></svg>';

  function launchBat() {
    const bat = document.createElement('div');
    bat.className = 'bat';
    bat.innerHTML = batSvg;
    const size = 20 + Math.random() * 26;
    bat.style.width = size + 'px';
    document.body.appendChild(bat);
    const fromLeft = Math.random() < 0.5;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const y0 = h * (0.08 + Math.random() * 0.4);
    const y1 = y0 + (Math.random() - 0.5) * h * 0.3;
    const x0 = fromLeft ? -60 : w + 60;
    const x1 = fromLeft ? w + 60 : -60;
    const midY = Math.min(y0, y1) - 40 - Math.random() * 80;
    const dur = 5000 + Math.random() * 5000;
    bat.animate(
      [
        { transform: `translate(${x0}px, ${y0}px)` },
        { transform: `translate(${(x0 + x1) / 2}px, ${midY}px)`, offset: 0.5 },
        { transform: `translate(${x1}px, ${y1}px)` },
      ],
      { duration: dur, easing: 'ease-in-out' }
    ).onfinish = () => bat.remove();
  }

  function batLoop() {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) setTimeout(launchBat, i * 300);
    setTimeout(batLoop, 7000 + Math.random() * 9000);
  }
  setTimeout(batLoop, 1500);

  // Lightning
  const lightning = document.querySelector('.lightning');
  function strike() {
    if (lightning) {
      lightning.classList.remove('flash');
      void lightning.offsetWidth;
      lightning.classList.add('flash');
    }
    setTimeout(strike, 18000 + Math.random() * 25000);
  }
  setTimeout(strike, 9000 + Math.random() * 8000);

  // Reaper drifting through the fog
  const reaper = document.querySelector('.drifting-reaper');
  function drift() {
    if (reaper) {
      reaper.classList.remove('go');
      void reaper.offsetWidth;
      reaper.classList.add('go');
    }
    setTimeout(drift, 45000 + Math.random() * 40000);
  }
  if (reaper) setTimeout(drift, 6000);

  window.Ambience = { strike: () => lightning && (lightning.classList.remove('flash'), void lightning.offsetWidth, lightning.classList.add('flash')) };
})();
