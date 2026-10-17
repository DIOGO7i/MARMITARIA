// aplica o tema antes de desenhar a tela (evita piscar branco no modo escuro). Arquivo separado por causa da CSP (sem script inline).
try {
  var t = localStorage.getItem('marmitaria.tema') || 'auto';
  var escuro = t === 'escuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (escuro) document.documentElement.classList.add('dark');
  // "Tela: Computador" no celular: mostra a versão completa (a tela fica como a de um computador, dá para dar zoom)
  var tela = localStorage.getItem('marmitaria.tela');
  if (tela === 'computador' && window.self === window.top) {
    var vp = document.querySelector('meta[name=viewport]');
    var sc = Math.min(1, Math.round(((window.screen && window.screen.width) || 390) / 1280 * 100) / 100);
    if (vp) vp.setAttribute('content', 'width=1280, initial-scale=' + sc + ', minimum-scale=' + sc);
  }
} catch (e) {}
