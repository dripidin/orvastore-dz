'use strict';
/**
 * Activates the admin-defined Meta browser code source on this page.
 * Reads GET /api/admin-settings?action=public — never receives CAPI token.
 * Deactivated / wrong-page / empty Pixel ID => no script injection.
 */
(function () {
  var script = document.currentScript;
  var pageHint = (script && script.getAttribute('data-page')) || '';
  var contentName = (script && script.getAttribute('data-content-name')) || '';
  var contentValue = (script && script.getAttribute('data-value')) || '';

  function normalizePath(p) {
    if (!p) return '/';
    try {
      if (p.indexOf('http') === 0) p = new URL(p).pathname;
    } catch (_) {}
    p = String(p).split('?')[0].split('#')[0];
    if (!p || p === '/index.html') return '/';
    if (p.charAt(0) !== '/') p = '/' + p;
    return p;
  }

  var currentPage = normalizePath(pageHint || window.location.pathname || '/');

  function injectPixel(pixelId) {
    if (!pixelId) return;
    if (window.__ORVA_META_PIXEL_ID === pixelId && window.fbq) {
      try {
        window.fbq('track', 'PageView');
        if (contentName) {
          window.fbq('track', 'ViewContent', {
            content_name: contentName,
            value: Number(contentValue) || undefined,
            currency: 'DZD'
          });
        }
      } catch (_) {}
      return;
    }
    window.__ORVA_META_PIXEL_ID = pixelId;

    if (!window.fbq) {
      !(function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = !0;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = !0;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }

    window.fbq('set', 'autoConfig', false, pixelId);
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    if (contentName) {
      window.fbq('track', 'ViewContent', {
        content_name: contentName,
        value: Number(contentValue) || undefined,
        currency: 'DZD'
      });
    }

    if (!document.getElementById('orva-meta-pixel-noscript')) {
      var nos = document.createElement('noscript');
      nos.id = 'orva-meta-pixel-noscript';
      nos.innerHTML =
        '<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=' +
        encodeURIComponent(pixelId) +
        '&ev=PageView&noscript=1" />';
      document.head.appendChild(nos);
    }
  }

  function resolveBrowserSource(cfg) {
    if (cfg.codeSources && cfg.codeSources.browserPixel) {
      return cfg.codeSources.browserPixel;
    }
    return {
      active: !!cfg.browserPixelEnabled,
      pixelId: cfg.pixelId || '',
      scope: cfg.scope || 'all',
      pages: cfg.pages || []
    };
  }

  var publicUrl = '/api/admin-settings?action=public';
  fetch(publicUrl, { credentials: 'same-origin' })
    .then(function (r) {
      if (r.ok) return r.json();
      // Hostinger PHP pretty URL may need .php in some local routers
      return fetch('/api/admin-settings.php?action=public', { credentials: 'same-origin' }).then(function (r2) {
        return r2.ok ? r2.json() : null;
      });
    })
    .then(function (data) {
      if (!data || !data.success || !data.config) return;
      var src = resolveBrowserSource(data.config);
      if (!src.active || !src.pixelId) return;
      var pages = Array.isArray(src.pages) ? src.pages.map(normalizePath) : [];
      var allowed = src.scope !== 'selected' || pages.indexOf(currentPage) !== -1;
      if (!allowed) return;
      injectPixel(String(src.pixelId));
    })
    .catch(function () {
      /* fail closed */
    });
})();
