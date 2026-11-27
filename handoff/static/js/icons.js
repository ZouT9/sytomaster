(() => {
  'use strict';
  const svgNS = 'http://www.w3.org/2000/svg';

  function make(name, className) {
    const icon = document.createElementNS(svgNS, 'svg');
    icon.setAttribute('class', className ? 'icon ' + className : 'icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNS, 'use');
    use.setAttribute('href', '#i-' + name);
    icon.append(use);
    return icon;
  }

  window.SytoIcons = { make };
})();
