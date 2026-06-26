(function () {
  const room = document.getElementById('room');
  const roomCode = room.dataset.code;
  const initial = JSON.parse(document.getElementById('initial-state').textContent || '{}');

  // ---- identity ----
  let myName = localStorage.getItem('pulse-name');
  if (!myName) { myName = 'Guest-' + Math.floor(1000 + Math.random() * 9000); localStorage.setItem('pulse-name', myName); }
  const nameInput = document.getElementById('nameInput');
  nameInput.value = myName;

  // ---- canvas ----
  const COLS = 48, ROWS = 32, CELL = 13;
  const canvas = document.getElementById('canvas');
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  function clearCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#eeeeee';
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(canvas.width, y * CELL); ctx.stroke(); }
  }
  function drawPixel(x, y, color) { ctx.fillStyle = color; ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 1, CELL - 1); }
  clearCanvas();

  const COLORS = ['#111111', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
  let selected = COLORS[0];
  const paletteEl = document.getElementById('palette');
  COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (c === selected ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      selected = c;
      paletteEl.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
    paletteEl.appendChild(sw);
  });

  (initial.pixels || []).forEach(p => drawPixel(p.x, p.y, p.color));

  // ---- connection ----
  const conn = new signalR.HubConnectionBuilder().withUrl('/pulsehub').withAutomaticReconnect().build();
  const connected = () => conn.state === signalR.HubConnectionState.Connected;

  conn.on('PixelPlaced', (x, y, color) => drawPixel(x, y, color));
  conn.on('PresenceUpdated', (count, names) => {
    document.getElementById('presenceCount').textContent = count;
    document.querySelector('.presence').title = (names || []).join(', ');
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

  // ---- canvas interaction ----
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / COLS));
    const y = Math.floor((e.clientY - r.top) / (r.height / ROWS));
    return { x: Math.max(0, Math.min(COLS - 1, x)), y: Math.max(0, Math.min(ROWS - 1, y)) };
  }
  let painting = false;
  function place(e) {
    const { x, y } = cellFromEvent(e);
    drawPixel(x, y, selected);
    if (connected()) conn.invoke('PlacePixel', roomCode, x, y, selected);
  }
  canvas.addEventListener('mousedown', e => { painting = true; place(e); });
  window.addEventListener('mouseup', () => { painting = false; });
  let lastCursor = 0;
  canvas.addEventListener('mousemove', e => {
    if (painting) place(e);
    const now = Date.now();
    if (now - lastCursor > 60 && connected()) {
      lastCursor = now;
      const r = canvas.getBoundingClientRect();
      conn.invoke('MoveCursor', roomCode, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'pulse-' + roomCode + '.png';
    a.click();
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
    c.style.left = (nx * 100) + '%';
    c.style.top = (ny * 100) + '%';
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
  (initial.messages || []).forEach(addMessage);

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
  (initial.polls || []).forEach(addPoll);

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
})();
