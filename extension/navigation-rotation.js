// Explicitly started navigation rotation. Configuration is data, never script.
(() => {
  'use strict';
  if (globalThis.SecurityNavigationRotation) return;

  const overlayId = 'security-navigation-rotation';
  let settings = null, timer = null, generation = 0, index = 0, count = 0;
  let running = false, lastLabel = '', message = '尚未启动导航轮换', nextAt = null;
  let panel, status, stopButton;
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();

  function snapshot() {
    return { running, count, lastLabel, nextLabel: settings?.targets[index]?.title || '', message,
      intervalMs: settings?.intervalMs || 60000, nextAt };
  }
  function validateConfig(value) {
    const allowed = ['origin', 'pathPrefix', 'intervalMs', 'targets'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('轮换配置必须只包含站点范围、间隔和导航目标。');
    if (typeof value.origin !== 'string' || typeof value.pathPrefix !== 'string') throw new Error('轮换配置缺少有效的站点范围。');
    let origin;
    try { origin = new URL(value.origin); } catch { throw new Error('站点来源格式无效。'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('站点来源必须是不含认证信息的 HTTP 或 HTTPS 来源。');
    const prefix = value.pathPrefix;
    if (!prefix.startsWith('/') || prefix.length > 1024 || /[?#\\\u0000-\u0020\u007f]/.test(prefix) || new URL(prefix, origin.origin).pathname !== prefix) throw new Error('轮换路径范围无效。');
    const intervalMs = value.intervalMs === undefined ? 60000 : value.intervalMs;
    if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 86400000) throw new Error('轮换间隔必须是 1 秒至 24 小时的整数毫秒数。');
    if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 30) throw new Error('请选择 1 至 30 个明确的导航项。');
    const selectors = new Set();
    const targets = value.targets.map(target => {
      if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['selector', 'title'].includes(key)) ||
          typeof target.selector !== 'string' || !target.selector.trim() || target.selector.length > 512 ||
          typeof target.title !== 'string' || !clean(target.title) || target.title.length > 120) throw new Error('每个导航目标必须只有有效的选择器和短标题。');
      if (selectors.has(target.selector)) throw new Error('导航目标不能重复。');
      selectors.add(target.selector);
      return Object.freeze({ selector: target.selector, title: clean(target.title) });
    });
    return Object.freeze({ origin: origin.origin, pathPrefix: prefix, intervalMs, targets: Object.freeze(targets) });
  }
  function inScope(raw) {
    try {
      const url = new URL(raw, location.href), prefix = settings.pathPrefix;
      return ['http:', 'https:'].includes(url.protocol) && url.origin === settings.origin && !url.username && !url.password &&
        (prefix === '/' || url.pathname === prefix || url.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
    } catch { return false; }
  }
  function resolveTargets() {
    if (!globalThis.SecurityNavigationDiscovery) throw new Error('导航识别器未加载，请重新打开扩展。');
    return globalThis.SecurityNavigationDiscovery.resolveTargets(settings);
  }
  function render() {
    if (!panel?.isConnected) {
      panel = document.createElement('div');
      panel.id = overlayId;
      Object.assign(panel.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647', padding: '12px',
        maxWidth: '360px', background: '#fff', color: '#172e27', border: '1px solid #799b8d', borderRadius: '8px',
        boxShadow: '0 2px 12px #0003', font: '13px/1.5 sans-serif' });
      status = document.createElement('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      stopButton = document.createElement('button'); stopButton.type = 'button'; stopButton.textContent = '停止轮换';
      stopButton.setAttribute('data-security-navigation-stop', ''); stopButton.addEventListener('click', () => stop());
      panel.append(status, stopButton); document.documentElement.append(panel);
    }
    status.textContent = `${message}（累计点击 ${count} 次）`;
    stopButton.disabled = !running;
  }
  function stopWithMessage(reason, remove = false) {
    generation++;
    clearTimeout(timer); timer = null; running = false; nextAt = null; message = reason;
    if (remove) { panel?.remove(); panel = null; }
    else render();
    return snapshot();
  }
  function stop() { return stopWithMessage('已停止导航轮换'); }
  function schedule() {
    nextAt = Date.now() + settings.intervalMs;
    try { timer = setTimeout(tick, settings.intervalMs); }
    catch { stopWithMessage('计时器无法启动，轮换已停止。'); }
  }
  function tick() {
    if (!running) return;
    timer = null;
    const currentGeneration = generation;
    let control;
    try { control = resolveTargets()[index]; }
    catch (error) { stopWithMessage(error.message); return; }
    const previous = { count, index, lastLabel };
    lastLabel = settings.targets[index].title;
    count++;
    index = (index + 1) % settings.targets.length;
    try { control.click(); }
    catch {
      if (generation === currentGeneration) {
        ({ count, index, lastLabel } = previous);
        stopWithMessage('导航点击失败，轮换已停止。');
      }
      return;
    }
    // Count the dispatched click even when its handler stops rotation, but
    // never resurrect a loop after a synchronous stop, pagehide, or restart.
    if (!running || generation !== currentGeneration) return;
    if (!inScope(location.href)) { stopWithMessage('导航已离开指定范围，轮换已停止。'); return; }
    message = `已点击“${lastLabel}”；${settings.intervalMs / 1000} 秒后点击“${settings.targets[index].title}”`;
    render(); schedule();
  }
  function start(config) {
    if (running) return snapshot();
    try { settings = validateConfig(config); resolveTargets(); }
    catch (error) { return stopWithMessage(error.message); }
    generation++; index = 0; count = 0; lastLabel = ''; running = true;
    message = `导航轮换已启动；${settings.intervalMs / 1000} 秒后点击“${settings.targets[0].title}”`;
    render(); schedule(); return snapshot();
  }
  globalThis.SecurityNavigationRotation = Object.freeze({ start, stop, snapshot });
  window.addEventListener('pagehide', () => stopWithMessage('页面已关闭或刷新，轮换停止', true));
})();
