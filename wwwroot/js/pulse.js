(function () {
  const room = document.getElementById('room');
  const roomCode = room.dataset.code;
  const initial = JSON.parse(document.getElementById('initial-state').textContent || '{}');
  const BOARD_W = (initial.board && initial.board.w) || 900;
  const BOARD_H = (initial.board && initial.board.h) || 560;
  const GAP = 8;

  // ---- identity ----
  let myName = localStorage.getItem('pulse-name');
  if (!myName) { myName = 'Guest-' + Math.floor(1000 + Math.random() * 9000); localStorage.setItem('pulse-name', myName); }
  let ownerKey = localStorage.getItem('pulse-owner');
  if (!ownerKey) { ownerKey = 'k-' + Math.random().toString(36).slice(2) + '-' + Math.floor(Math.random() * 1e6).toString(36); localStorage.setItem('pulse-owner', ownerKey); }
  const nameInput = document.getElementById('nameInput');
  nameInput.value = myName;

  // ---- presence avatars + dock tabs ----
  const presenceList = document.getElementById('presenceList');
  const AV_COLORS = ['#8a5631', '#a8432f', '#b27a4b', '#7f8a5c', '#3f6f6a', '#7d5168', '#c8703d'];
  function avInitials(n) { const p = n.trim().split(/[\s_-]+/).filter(Boolean); return (((p[0] || '?')[0] || '?') + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function avColor(n) { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
  function renderPresence(names) {
    if (!presenceList) return;
    presenceList.innerHTML = '';
    names.slice(0, 6).forEach(n => {
      const a = document.createElement('div');
      a.className = 'avatar'; a.style.background = avColor(n);
      a.textContent = avInitials(n); a.title = n;
      presenceList.appendChild(a);
    });
    if (names.length > 6) {
      const a = document.createElement('div');
      a.className = 'avatar more'; a.textContent = '+' + (names.length - 6);
      presenceList.appendChild(a);
    }
  }

  const dockTabs = [...document.querySelectorAll('.dock-tab')];
  const dockPanes = { polls: document.querySelector('.pane-polls'), qa: document.querySelector('.pane-qa') };
  function setTab(t) {
    dockTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    Object.keys(dockPanes).forEach(k => dockPanes[k] && dockPanes[k].classList.toggle('active', k === t));
  }
  dockTabs.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  setTab('polls');
  function updateCounts() {
    const pc = document.getElementById('polls').children.length;
    const mc = document.getElementById('messages').children.length;
    const pe = document.querySelector('.dock-tab[data-tab="polls"] .tab-count');
    const qe = document.querySelector('.dock-tab[data-tab="qa"] .tab-count');
    if (pe) pe.textContent = pc || '';
    if (qe) qe.textContent = mc || '';
  }

  // ---- connection ----
  const conn = new signalR.HubConnectionBuilder().withUrl('/pulsehub').withAutomaticReconnect().build();
  const connected = () => conn.state === signalR.HubConnectionState.Connected;

  // ============================================================
  //  Collage board
  // ============================================================
  const board = document.getElementById('board');
  const itemsEl = document.getElementById('items');
  const ghost = document.getElementById('ghost');
  const itemEls = {};
  let pending = null;        // {kind,width,height,content,color}
  let lastCursor = 0;

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return !(ax + aw + GAP <= bx || bx + bw + GAP <= ax || ay + ah + GAP <= by || by + bh + GAP <= ay);
  }
  function overlapsAny(x, y, w, h, exceptId) {
    return Object.values(itemEls).some(el => {
      if (exceptId != null && +el.dataset.id === exceptId) return false;
      return rectsOverlap(x, y, w, h, +el.dataset.x, +el.dataset.y, +el.dataset.w, +el.dataset.h);
    });
  }
  function updateItemCount() { const c = document.getElementById('itemCount'); if (c) c.textContent = Object.keys(itemEls).length; }

  function renderItem(it) {
    if (itemEls[it.id]) return;
    const mine = it.ownerKey === ownerKey;
    const el = document.createElement('div');
    el.className = 'item item-' + it.kind + (mine ? ' mine' : '');
    el.dataset.id = it.id; el.dataset.x = it.x; el.dataset.y = it.y; el.dataset.w = it.width; el.dataset.h = it.height;
    el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.width + 'px'; el.style.height = it.height + 'px';

    if (it.kind === 'note') {
      el.style.background = it.color;
      const t = document.createElement('div'); t.className = 'note-text'; t.textContent = it.content; el.appendChild(t);
    } else if (it.kind === 'image' || it.kind === 'draw') {
      const img = document.createElement('img'); img.src = it.content; img.alt = ''; img.draggable = false; el.appendChild(img);
    } else if (it.kind === 'stamp') {
      el.style.fontSize = Math.round(it.height * 0.68) + 'px';
      const s = document.createElement('span'); s.textContent = it.content; el.appendChild(s);
    }
    const tag = document.createElement('span'); tag.className = 'owner-tag'; tag.textContent = it.ownerName; el.appendChild(tag);

    if (mine) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'del'; del.textContent = '×'; del.title = 'Remove';
      del.addEventListener('click', e => { e.stopPropagation(); if (connected()) conn.invoke('RemoveItem', +it.id, ownerKey); });
      el.appendChild(del);
      enableDrag(el);
    }
    itemsEl.appendChild(el); itemEls[it.id] = el; updateItemCount();
  }
  function moveItemTo(id, x, y) {
    const el = itemEls[id]; if (!el) return;
    el.dataset.x = x; el.dataset.y = y; el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  function removeItemEl(id) { const el = itemEls[id]; if (el) { el.remove(); delete itemEls[id]; updateItemCount(); } }

  // ---- placement ----
  function setHint(t) { const h = document.getElementById('boardHint'); if (h) h.textContent = t; }
  function clearToolActive() { document.querySelectorAll('.tool').forEach(t => t.classList.remove('active')); }
  function startPlacing(spec) {
    pending = spec;
    ghost.hidden = false;
    ghost.style.width = spec.width + 'px'; ghost.style.height = spec.height + 'px';
    board.classList.add('placing');
    setHint('Click an empty spot to drop it — Esc to cancel');
  }
  function cancelPlacing() {
    pending = null; ghost.hidden = true; board.classList.remove('placing'); clearToolActive();
    setHint('Pick a tool, then click an empty spot');
  }

  board.addEventListener('mousemove', e => {
    const r = board.getBoundingClientRect();
    if (pending) {
      let x = Math.round(e.clientX - r.left - pending.width / 2);
      let y = Math.round(e.clientY - r.top - pending.height / 2);
      x = Math.max(0, Math.min(BOARD_W - pending.width, x));
      y = Math.max(0, Math.min(BOARD_H - pending.height, y));
      ghost.style.left = x + 'px'; ghost.style.top = y + 'px';
      ghost.dataset.x = x; ghost.dataset.y = y;
      ghost.classList.toggle('invalid', overlapsAny(x, y, pending.width, pending.height, null));
    }
    const now = Date.now();
    if (now - lastCursor > 60 && connected()) {
      lastCursor = now;
      conn.invoke('MoveCursor', roomCode, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }
  });
  board.addEventListener('click', e => {
    if (!pending) return;
    const r = board.getBoundingClientRect();
    let x = Math.round(e.clientX - r.left - pending.width / 2);
    let y = Math.round(e.clientY - r.top - pending.height / 2);
    x = Math.max(0, Math.min(BOARD_W - pending.width, x));
    y = Math.max(0, Math.min(BOARD_H - pending.height, y));
    if (overlapsAny(x, y, pending.width, pending.height, null)) { toast("That spot's taken — pick an empty area"); return; }
    if (connected()) conn.invoke('PlaceItem', roomCode, ownerKey, pending.kind, x, y, pending.width, pending.height, pending.content, pending.color || '');
    cancelPlacing();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (pending) cancelPlacing(); closeComposers(); clearToolActive(); } });

  // ---- drag to move (owner only) ----
  function enableDrag(el) {
    el.addEventListener('mousedown', e => {
      if (pending || e.target.classList.contains('del')) return;
      e.preventDefault();
      const id = +el.dataset.id, w = +el.dataset.w, h = +el.dataset.h;
      const startX = +el.dataset.x, startY = +el.dataset.y;
      const r = board.getBoundingClientRect();
      const offX = e.clientX - r.left - startX, offY = e.clientY - r.top - startY;
      el.classList.add('dragging');
      function mm(ev) {
        let nx = Math.round(ev.clientX - r.left - offX), ny = Math.round(ev.clientY - r.top - offY);
        nx = Math.max(0, Math.min(BOARD_W - w, nx)); ny = Math.max(0, Math.min(BOARD_H - h, ny));
        el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.dataset.x = nx; el.dataset.y = ny;
        el.classList.toggle('invalid', overlapsAny(nx, ny, w, h, id));
      }
      function mu() {
        document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
        el.classList.remove('dragging', 'invalid');
        const nx = +el.dataset.x, ny = +el.dataset.y;
        if (nx === startX && ny === startY) return;
        if (overlapsAny(nx, ny, w, h, id)) { moveItemTo(id, startX, startY); toast("Can't drop there — it overlaps"); return; }
        if (connected()) conn.invoke('MoveItem', id, ownerKey, nx, ny);
      }
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
    });
  }

  // ---- tools + composers ----
  document.querySelectorAll('.tool').forEach(t => t.addEventListener('click', () => {
    const tool = t.dataset.tool;
    closeComposers();
    if (pending) cancelPlacing();
    clearToolActive(); t.classList.add('active');
    if (tool === 'note') openComposer('noteComposer');
    else if (tool === 'image') document.getElementById('imageInput').click();
    else if (tool === 'draw') { openComposer('drawComposer'); sigClear(); }
    else if (tool === 'stamp') openComposer('stampComposer');
  }));
  function openComposer(id) { closeComposers(); const c = document.getElementById(id); if (c) c.hidden = false; }
  function closeComposers() { document.querySelectorAll('.composer').forEach(c => c.hidden = true); }
  document.querySelectorAll('.composer [data-cancel]').forEach(b => b.addEventListener('click', () => { closeComposers(); clearToolActive(); }));

  // note composer
  const NOTE_COLORS = ['#ffd166', '#ff9f68', '#f4e285', '#a7d588', '#ff8c69', '#ffc9a0'];
  let noteColor = NOTE_COLORS[0];
  const noteColorsEl = document.getElementById('noteColors');
  NOTE_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'c' + (i === 0 ? ' active' : ''); b.style.background = c;
    b.addEventListener('click', () => { noteColor = c; noteColorsEl.querySelectorAll('.c').forEach(x => x.classList.remove('active')); b.classList.add('active'); });
    noteColorsEl.appendChild(b);
  });
  document.getElementById('noteAdd').addEventListener('click', () => {
    const t = document.getElementById('noteText').value.trim();
    if (!t) { toast('Write something first'); return; }
    document.getElementById('noteText').value = '';
    closeComposers();
    startPlacing({ kind: 'note', width: 172, height: 124, content: t, color: noteColor });
  });

  // image upload
  document.getElementById('imageInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; clearToolActive();
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('Please choose an image file'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('That image is over 8 MB — pick a smaller one'); return; }
    resizeImage(f, 200, (url, w, h) => startPlacing({ kind: 'image', width: w, height: h, content: url, color: '' }));
  });
  function resizeImage(file, maxDim, cb) {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const s = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(20, Math.round(w * s)); h = Math.max(20, Math.round(h * s));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let url; try { url = c.toDataURL('image/jpeg', 0.82); } catch (_) { url = c.toDataURL(); }
      URL.revokeObjectURL(u); cb(url, w, h);
    };
    img.onerror = () => { URL.revokeObjectURL(u); toast('Could not read that image'); };
    img.src = u;
  }

  // signature pad
  const sigPad = document.getElementById('sigPad'); const sctx = sigPad.getContext('2d');
  let sdrawing = false, sbounds = null;
  function sigClear() { sctx.clearRect(0, 0, sigPad.width, sigPad.height); sbounds = null; }
  function sigXY(e) { const r = sigPad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (sigPad.width / r.width), y: (e.clientY - r.top) * (sigPad.height / r.height) }; }
  function sExtend(p) {
    if (!sbounds) sbounds = { minx: p.x, miny: p.y, maxx: p.x, maxy: p.y };
    else { sbounds.minx = Math.min(sbounds.minx, p.x); sbounds.miny = Math.min(sbounds.miny, p.y); sbounds.maxx = Math.max(sbounds.maxx, p.x); sbounds.maxy = Math.max(sbounds.maxy, p.y); }
  }
  sigPad.addEventListener('mousedown', e => { sdrawing = true; sctx.strokeStyle = '#f3ece0'; sctx.lineWidth = 4; sctx.lineCap = 'round'; sctx.lineJoin = 'round'; const p = sigXY(e); sctx.beginPath(); sctx.moveTo(p.x, p.y); sExtend(p); });
  sigPad.addEventListener('mousemove', e => { if (!sdrawing) return; const p = sigXY(e); sctx.lineTo(p.x, p.y); sctx.stroke(); sExtend(p); });
  window.addEventListener('mouseup', () => { sdrawing = false; });
  document.getElementById('sigClear').addEventListener('click', sigClear);
  document.getElementById('sigUse').addEventListener('click', () => {
    if (!sbounds || sbounds.maxx - sbounds.minx < 4 || sbounds.maxy - sbounds.miny < 4) { toast('Draw your signature first'); return; }
    const pad = 6;
    const cx = Math.max(0, sbounds.minx - pad), cy = Math.max(0, sbounds.miny - pad);
    const cw = Math.min(sigPad.width, sbounds.maxx + pad) - cx, ch = Math.min(sigPad.height, sbounds.maxy + pad) - cy;
    const crop = document.createElement('canvas'); crop.width = cw; crop.height = ch;
    crop.getContext('2d').drawImage(sigPad, cx, cy, cw, ch, 0, 0, cw, ch);
    const url = crop.toDataURL('image/png');
    let w = cw, h = ch; const s = Math.min(1, 240 / w); w = Math.round(w * s); h = Math.round(h * s);
    if (h < 24) { const s2 = 24 / h; h = 24; w = Math.round(w * s2); }
    closeComposers();
    startPlacing({ kind: 'draw', width: Math.max(24, w), height: Math.max(24, h), content: url, color: '' });
  });

  // stamps
  const STAMPS = ['⭐', '❤️', '🔥', '✅', '☕', '🎯', '💡', '🌿', '✨', '👍', '🎉', '📌'];
  const stampGrid = document.getElementById('stampGrid');
  STAMPS.forEach(s => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
    b.addEventListener('click', () => { closeComposers(); startPlacing({ kind: 'stamp', width: 60, height: 60, content: s, color: '' }); });
    stampGrid.appendChild(b);
  });

  // toast
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // export board -> PNG (best effort)
  document.getElementById('exportBtn').addEventListener('click', () => {
    const c = document.createElement('canvas'); c.width = BOARD_W; c.height = BOARD_H;
    const x = c.getContext('2d');
    x.fillStyle = '#100c08'; x.fillRect(0, 0, BOARD_W, BOARD_H);
    Object.values(itemEls).forEach(el => {
      const ix = +el.dataset.x, iy = +el.dataset.y, iw = +el.dataset.w, ih = +el.dataset.h;
      if (el.classList.contains('item-note')) {
        x.fillStyle = el.style.background || '#efe3c8'; x.fillRect(ix, iy, iw, ih);
        x.fillStyle = '#2c2520'; x.font = '13px sans-serif';
        wrapText(x, (el.querySelector('.note-text') || {}).textContent || '', ix + 8, iy + 20, iw - 16, 16);
      } else if (el.classList.contains('item-stamp')) {
        x.font = Math.round(ih * 0.68) + 'px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(el.querySelector('span').textContent, ix + iw / 2, iy + ih / 2);
        x.textAlign = 'start'; x.textBaseline = 'alphabetic';
      } else {
        const img = el.querySelector('img');
        if (img && img.complete) { try { x.drawImage(img, ix, iy, iw, ih); } catch (_) {} }
      }
    });
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'pulse-' + roomCode + '.png'; a.click();
  });
  function wrapText(ctx, text, x, y, maxW, lh) {
    const words = (text || '').split(/\s+/); let line = '', yy = y;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; if (yy > y + lh * 7) return; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  // ---- signalR: board ----
  conn.on('ItemPlaced', it => renderItem(it));
  conn.on('ItemMoved', (id, x, y) => moveItemTo(id, x, y));
  conn.on('ItemRemoved', id => removeItemEl(id));
  conn.on('ItemRejected', info => {
    if (!info) return;
    if (info.reason) toast(info.reason);
    if (info.id != null && itemEls[info.id]) moveItemTo(info.id, info.x, info.y);
  });

  // ---- signalR: everything else ----
  conn.on('PresenceUpdated', (count, names) => {
    document.getElementById('presenceCount').textContent = count;
    document.querySelector('.presence').title = (names || []).join(', ');
    renderPresence(names || []);
  });
  conn.on('MessagePosted', (id, author, text, upvotes) => addMessage({ id, author, text, upvotes }));
  conn.on('MessageUpdated', (id, upvotes) => {
    const el = msgEls[id];
    if (el) { el.dataset.votes = upvotes; el.querySelector('.votes').textContent = upvotes; sortMessages(); }
  });
  conn.on('PollCreated', poll => addPoll(poll));
  conn.on('PollUpdated', (pollId, counts) => updatePoll(pollId, counts));
  conn.on('PollClosed', pollId => closePollUi(pollId));
  conn.on('ReactionSent', emoji => floatReaction(emoji));
  conn.on('CursorMoved', (id, name, x, y) => moveCursor(id, name, x, y));
  conn.on('CursorGone', id => removeCursor(id));

  conn.start().then(() => conn.invoke('JoinRoom', roomCode, myName)).catch(err => console.error(err));

  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (v) { myName = v; localStorage.setItem('pulse-name', v); if (connected()) conn.invoke('JoinRoom', roomCode, myName); }
  });

  // ---- cursors ----
  const cursorsEl = document.getElementById('cursors');
  const cursorEls = {};
  function moveCursor(id, name, nx, ny) {
    let c = cursorEls[id];
    if (!c) {
      c = document.createElement('div'); c.className = 'cursor';
      c.innerHTML = '<span class="dot"></span><span class="label"></span>';
      cursorsEl.appendChild(c); cursorEls[id] = c;
    }
    c.querySelector('.label').textContent = name;
    c.style.left = (nx * 100) + '%'; c.style.top = (ny * 100) + '%';
  }
  function removeCursor(id) { const c = cursorEls[id]; if (c) { c.remove(); delete cursorEls[id]; } }

  // ---- reactions ----
  const reactionLayer = document.getElementById('reactionLayer');
  document.querySelectorAll('.reactions button').forEach(b => {
    b.addEventListener('click', () => { if (connected()) conn.invoke('SendReaction', roomCode, b.dataset.emoji); });
  });
  function floatReaction(emoji) {
    const el = document.createElement('div'); el.className = 'floater'; el.textContent = emoji;
    el.style.left = (10 + Math.random() * 80) + '%';
    reactionLayer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---- Q&A ----
  const messagesEl = document.getElementById('messages');
  const msgEls = {};
  function addMessage(m) {
    if (msgEls[m.id]) return;
    const el = document.createElement('div');
    el.className = 'msg'; el.dataset.votes = m.upvotes; el.dataset.id = m.id;
    el.innerHTML = '<button type="button" class="upvote">&#9650; <span class="votes"></span></button>' +
                   '<div class="msg-body"><div class="msg-text"></div><div class="msg-author"></div></div>';
    el.querySelector('.votes').textContent = m.upvotes;
    el.querySelector('.msg-text').textContent = m.text;
    el.querySelector('.msg-author').textContent = m.author;
    el.querySelector('.upvote').addEventListener('click', () => { if (connected()) conn.invoke('UpvoteMessage', m.id); });
    messagesEl.appendChild(el); msgEls[m.id] = el; sortMessages();
    dockPanes.qa.classList.add('has-items'); updateCounts();
  }
  function sortMessages() {
    [...messagesEl.children]
      .sort((a, b) => (b.dataset.votes - a.dataset.votes) || (b.dataset.id - a.dataset.id))
      .forEach(c => messagesEl.appendChild(c));
  }
  function sendQa() {
    const inp = document.getElementById('qaInput');
    const t = inp.value.trim();
    if (t && connected()) { conn.invoke('PostMessage', roomCode, t); inp.value = ''; }
  }
  document.getElementById('qaSend').addEventListener('click', sendQa);
  document.getElementById('qaInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendQa(); });

  // ---- Polls ----
  const pollsEl = document.getElementById('polls');
  const pollEls = {};
  function addPoll(poll) {
    if (pollEls[poll.id]) return;
    const el = document.createElement('div'); el.className = 'poll'; el.dataset.id = poll.id;
    const q = document.createElement('div'); q.className = 'poll-q'; q.textContent = poll.question; el.appendChild(q);
    poll.options.forEach(o => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'poll-opt-row'; row.dataset.opt = o.id;
      row.innerHTML = '<span class="bar"></span><span class="opt-text"></span><span class="opt-votes"></span>';
      row.querySelector('.opt-text').textContent = o.text;
      row.querySelector('.opt-votes').textContent = o.votes;
      row.addEventListener('click', () => { if (!el.classList.contains('closed') && connected()) conn.invoke('Vote', poll.id, o.id); });
      el.appendChild(row);
    });
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'linkbtn close-poll'; close.textContent = 'close';
    close.addEventListener('click', () => { if (connected()) conn.invoke('ClosePoll', poll.id); });
    el.appendChild(close);
    pollsEl.prepend(el); pollEls[poll.id] = el;
    dockPanes.polls.classList.add('has-items'); updateCounts();
    updatePoll(poll.id, poll.options.map(o => ({ id: o.id, votes: o.votes })));
    if (poll.isOpen === false) closePollUi(poll.id);
  }
  function updatePoll(pollId, counts) {
    const el = pollEls[pollId]; if (!el) return;
    let total = 0; counts.forEach(c => total += c.votes); if (total === 0) total = 1;
    counts.forEach(c => {
      const row = el.querySelector('.poll-opt-row[data-opt="' + c.id + '"]'); if (!row) return;
      row.querySelector('.opt-votes').textContent = c.votes;
      row.querySelector('.bar').style.width = Math.round((c.votes / total) * 100) + '%';
    });
  }
  function closePollUi(pollId) {
    const el = pollEls[pollId]; if (!el) return;
    el.classList.add('closed');
    const c = el.querySelector('.close-poll'); if (c) c.textContent = 'closed';
  }
  document.getElementById('createPoll').addEventListener('click', () => {
    const q = document.getElementById('pollQuestion').value.trim();
    const opts = [...document.querySelectorAll('.poll-opt')].map(i => i.value.trim()).filter(Boolean);
    if (q && opts.length >= 2 && connected()) {
      conn.invoke('CreatePoll', roomCode, q, opts);
      document.getElementById('pollQuestion').value = '';
      document.querySelectorAll('.poll-opt').forEach(i => i.value = '');
      document.querySelector('.newpoll').open = false;
    }
  });

  // ---- copy link ----
  document.getElementById('copyLink').addEventListener('click', () => {
    navigator.clipboard.writeText(location.href).then(() => {
      const b = document.getElementById('copyLink'); const t = b.textContent;
      b.textContent = 'copied!'; setTimeout(() => { b.textContent = t; }, 1200);
    }).catch(() => {});
  });

  // ---- initial state ----
  (initial.items || []).forEach(renderItem);
  (initial.messages || []).forEach(addMessage);
  (initial.polls || []).forEach(addPoll);
})();
