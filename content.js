(() => {
  'use strict';
  if (document.getElementById('xt-study-helper')) return;
  const host = document.createElement('div');
  host.id = 'xt-study-helper';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `
    <style>
      :host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;font:14px/1.55 system-ui,sans-serif;color:#172237}
      section{width:310px;background:#fff;border:1px solid #dce3ef;border-radius:14px;box-shadow:0 8px 40px #17223730;padding:16px}
      header{display:flex;justify-content:space-between;align-items:center}strong{font-size:17px}
      button{font:inherit;cursor:pointer;border:1px solid #dce3ef;border-radius:7px;background:#f5f7fc;color:#172237;padding:7px 10px;margin:4px 3px 4px 0}
      button.primary{background:#235ce6;color:white;border-color:#235ce6}button:disabled{opacity:.5;cursor:default}
      p{margin:10px 0;color:#53627a}label{display:block;margin:8px 0}textarea{box-sizing:border-box;width:100%;height:115px;resize:vertical;border:1px solid #dce3ef;border-radius:6px;padding:8px;font:inherit}
      small{display:block;color:#64748b}hr{border:0;border-top:1px solid #e5eaf3;margin:14px 0}[hidden]{display:none!important}
    </style>
    <section>
      <header><strong>学堂在线学习助手</strong><button id="fold" aria-label="折叠面板">−</button></header>
      <main>
        <p id="status" role="status">打开课程视频后，点击开始。</p>
        <button id="start" class="primary">开始连续播放</button><button id="stop">停止</button>
        <label><input id="double-speed" type="checkbox" checked> 自动 2 倍速</label>
        <label><input id="auto-mute" type="checkbox" checked> 自动静音</label>
        <label><input id="auto-next" type="checkbox" checked> 视频结束后切换下一节</label>
        <button id="pick">指定“下一节”按钮</button>
        <small id="next-status">优先按课程目录切换下一视频，跳过作业；也可指定下一节按钮。</small>
        <hr>
        <strong>题目与平台解析</strong>
        <p>读取当前题目及平台已返回的答案字段。未返回答案时会明确提示。</p>
        <button id="read">读取本题数据</button><button id="extract">提取选中文字</button>
        <textarea id="question" placeholder="题干、选项和必要的上下文" aria-label="题目内容"></textarea>
        <button id="copy">复制题目</button>
        <small id="question-status">自行核对并在原页面提交。不会自动答题或提交，也不调用 AI。</small>
      </main>
    </section>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  let running = false, current = null, attempted = false, picking = false;
  let chosen = null, chosenLabel = '', selectedText = '', timer = null;
  const completed = new WeakMap();
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[inert]');
  const label = el => (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
  const forbidden = el => /提交|交卷|确认答案|submit/i.test(label(el)) || el.matches('input[type=submit]') || (el.tagName === 'BUTTON' && el.form && el.type === 'submit');
  const controls = () => [...document.querySelectorAll('button,a,[role="button"]')].filter(el => visible(el) && enabled(el) && !forbidden(el));
  function nextButton() {
    if (chosen?.isConnected && visible(chosen) && enabled(chosen) && !forbidden(chosen)) return chosen;
    if (!chosenLabel) {
      const id = location.pathname.match(/\/video\/(\d+)/)?.[1];
      const items = [...document.querySelectorAll('.menu-content-item[id^="unit-item-"]')];
      const index = items.findIndex(el => el.id === `unit-item-${id}`);
      if (index >= 0) return items.slice(index + 1).find(el => el.querySelector('.item-type')?.textContent.trim() === '视频' && enabled(el)) || null;
    }
    const candidates = controls().filter(el => chosenLabel ? label(el) === chosenLabel : /^(下一节|下一讲|下一个视频|下一课时)[\s›»→>]*$/.test(label(el)));
    return candidates.length === 1 ? candidates[0] : null;
  }
  function status(text) { $('status').textContent = text; }
  function applySpeed(video) {
    const rate = $('double-speed').checked ? 2 : 1;
    const menus = [...document.querySelectorAll('xt-speedbutton')];
    const menu = menus.length === 1 ? menus[0] : null;
    const option = menu?.querySelector(`li[data-speed="${rate}"]`);
    if (option && (!option.classList.contains('xt_video_player_common_active') || video.playbackRate !== rate)) {
      // XtPlayer only accepts a menu choice after mouse movement over its control.
      const rect = menu.getBoundingClientRect();
      menu.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, clientX: rect.x + 1, clientY: rect.y + 1}));
      menu.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5}));
      option.click();
      menu.dispatchEvent(new MouseEvent('mouseout', {bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5}));
    } else if (!menu) {
      video.playbackRate = rate;
    }
  }
  function playbackStatus(video) {
    status(`${video.paused ? '已暂停' : '正在播放'} · 实际 ${video.playbackRate} 倍速 · ${video.muted || video.volume === 0 ? '已静音' : '有声音'}`);
  }
  function applyMute(video) {
    const muted = $('auto-mute').checked;
    const icons = document.querySelectorAll('xt-volumebutton xt-icon');
    if (icons.length === 1) {
      const icon = icons[0];
      if (icon.classList.contains('xt_video_player_common_icon_muted') !== muted) icon.click();
      if (muted) video.volume = 0;
      // XtPlayer represents mute through volume=0 and resets HTMLMediaElement.muted.
      video.muted = false;
    } else video.muted = muted;
  }
  async function play(video) {
    attempted = true;
    try {
      applyMute(video);
      applySpeed(video);
      await video.play();
      if (running && video === current) playbackStatus(video);
    } catch {
      status('浏览器未允许播放，请手动点击视频播放按钮。');
    }
  }
  function ended(event) {
    const video = event.target;
    if (!running || video !== current || !video.ended || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const key = `${location.href}|${video.currentSrc}`;
    if (completed.get(video) === key) return;
    completed.set(video, key);
    if (!$('auto-next').checked) { status('本节播放完毕。'); return; }
    const next = nextButton();
    if (!next) { status('本节已结束，目录中没有后续视频或未找到唯一的下一节按钮。'); return; }
    next.click();
    status('已点击下一节，等待新视频；若已到课程末尾，请停止助手。');
  }
  let source = '', page = location.href;
  function scan() {
    const videos = [...document.querySelectorAll('video')].filter(visible);
    if (videos.length !== 1) {
      if (current) current.removeEventListener('ended', ended);
      current = null;
      status(videos.length ? '发现多个视频，请只保留目标视频可见。' : '等待课程视频（暂不支持跨域嵌入播放器）。');
      return;
    }
    const video = videos[0];
    if (video !== current || source !== video.currentSrc || page !== location.href) {
      if (current) current.removeEventListener('ended', ended);
      current = video; source = video.currentSrc; page = location.href; attempted = false;
      current.addEventListener('ended', ended);
    }
    if (!attempted && video.readyState >= 2 && !video.ended) play(video);
    else if (attempted && !video.ended) {
      applySpeed(video);
      if ($('auto-mute').checked) applyMute(video);
      playbackStatus(video);
    }
  }
  $('start').onclick = () => {
    running = true; attempted = false; $('start').disabled = true;
    scan(); if (!timer) timer = setInterval(scan, 1200);
  };
  $('stop').onclick = () => {
    running = false; clearInterval(timer); timer = null;
    if (current) { current.pause(); current.removeEventListener('ended', ended); }
    current = null; $('start').disabled = false; status('已停止并暂停当前视频。');
  };
  $('double-speed').onchange = () => {
    if (running && current) {
      applySpeed(current);
      playbackStatus(current);
    }
  };
  $('auto-mute').onchange = () => {
    if (running && current) {
      applyMute(current);
      playbackStatus(current);
    }
  };
  $('fold').onclick = () => { const main = root.querySelector('main'); main.hidden = !main.hidden; $('fold').textContent = main.hidden ? '+' : '−'; };
  document.addEventListener('selectionchange', () => {
    const selection = getSelection();
    if (selection && !selection.isCollapsed && !host.contains(selection.anchorNode)) selectedText = selection.toString();
  });
  $('extract').onclick = () => {
    if (selectedText.trim()) { $('question').value = selectedText.trim(); $('question-status').textContent = '请核对题干和全部选项，再复制解析请求。'; }
    else $('question-status').textContent = '请先在课程页面选中题目文字，或直接粘贴题目。';
  };
  $('copy').onclick = async () => {
    const question = $('question').value.trim();
    if (!question) { $('question-status').textContent = '请先提取或粘贴题目。'; return; }
    try { await navigator.clipboard.writeText(question); $('question-status').textContent = '已复制题目。'; }
    catch { $('question').focus(); $('question').select(); $('question-status').textContent = '剪贴板不可用，已选中题目，请按 ⌘C 复制。'; }
  };
  const plain = html => new DOMParser().parseFromString(String(html ?? ''), 'text/html').body.textContent.trim();
  const normalize = text => plain(text).replace(/\s+/g, '');
  $('read').onclick = async () => {
    const pageUrl = location.href;
    const body = document.querySelector('.question .fuwenben')?.textContent.trim();
    if (!/\/exercise\/\d+/.test(location.pathname) || !body) { $('question-status').textContent = '请先打开具体作业题目。'; return; }
    const endpoint = performance.getEntriesByType('resource').map(e => e.name).filter(url => url.startsWith(location.origin + '/api/v1/lms/exercise/get_exercise_list/')).pop();
    if (!endpoint) { $('question-status').textContent = '未发现本页题目请求，请刷新作业页后重试。'; return; }
    $('read').disabled = true; $('question-status').textContent = '正在只读获取平台题目数据…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (location.href !== pageUrl || normalize(document.querySelector('.question .fuwenben')?.textContent) !== normalize(body)) throw new Error('题目已切换，请重新读取');
      const matches = (payload.data?.problems || []).filter(p => normalize(p.content?.Body) === normalize(body));
      if (matches.length !== 1) throw new Error('无法唯一匹配本题，请刷新作业页后重试');
      const content = matches[0].content;
      const lines = [plain(content.Body), ...(content.Options || []).map(o => `${o.key}. ${plain(o.value)}`)];
      const answerKeys = ['Answer', 'CorrectAnswer', 'correct_answer', 'answer'];
      const explanationKeys = ['Remark', 'Explanation', 'Analysis', 'explanation'];
      const present = keys => keys.filter(k => Object.hasOwn(content, k) && content[k] !== null && content[k] !== '' && !(Array.isArray(content[k]) && !content[k].length));
      const answerFields = present(answerKeys), explanations = present(explanationKeys);
      for (const key of [...answerFields, ...explanations]) lines.push(`${key}（平台原始字段）：${typeof content[key] === 'object' ? JSON.stringify(content[key]) : plain(content[key])}`);
      $('question').value = lines.join('\n');
      $('question-status').textContent = answerFields.length ? '已显示平台返回的答案字段，请自行核对含义后提交。' : `平台未返回本题正确答案。${explanations.length ? '已显示平台解析。' : '也未返回解析正文。'}`;
    } catch (error) { $('question-status').textContent = `读取失败：${error.message}`; }
    finally { clearTimeout(timeout); $('read').disabled = false; }
  };
  function finishPick() { picking = false; document.removeEventListener('click', pick, true); document.removeEventListener('keydown', escapePick, true); }
  function escapePick(event) { if (event.key === 'Escape') { finishPick(); $('next-status').textContent = '已取消指定。'; } }
  function pick(event) {
    if (!picking || event.composedPath().includes(host)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const el = event.target.closest('button,a,[role="button"]');
    if (!el || forbidden(el) || !enabled(el) || !label(el)) { $('next-status').textContent = '请选择带文字的下一节链接或按钮；Esc 取消。'; return; }
    chosen = el; chosenLabel = label(el); finishPick(); $('next-status').textContent = `已指定：${chosenLabel}`;
  }
  $('pick').onclick = () => {
    if (picking) { finishPick(); $('next-status').textContent = '已取消指定。'; return; }
    picking = true; $('next-status').textContent = '请点击页面上的下一节按钮（此次不跳转）；Esc 取消。';
    document.addEventListener('click', pick, true); document.addEventListener('keydown', escapePick, true);
  };
})();
