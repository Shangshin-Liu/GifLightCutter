/**
 * GifLightCutter – 主應用程式
 */
import { Timeline } from './timeline.js';
import { Exporter  } from './exporter.js';
import { WebpConverter } from './webp-converter.js';

/* ── 時間工具 ─────────────────────────────────────────────── */
function formatTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms  = Math.round((s % 1) * 1000);
  return `${h}:${pad(m)}:${pad(sec)}.${padMs(ms)}`;
}

function parseTime(str) {
  str = str.trim();
  const re = /^(?:(\d+):)?(?:(\d+):)?(\d+)(?:[.,](\d+))?$/;
  const m  = re.exec(str);
  if (!m) return null;
  let h = 0, min = 0, sec = 0, ms = 0;
  if (m[1] !== undefined && m[2] !== undefined) { h = parseInt(m[1]); min = parseInt(m[2]); }
  else if (m[2] !== undefined) { min = parseInt(m[1] ?? '0'); }
  sec = parseInt(m[3]);
  if (m[4]) ms = parseFloat(`0.${m[4]}`);
  return h * 3600 + min * 60 + sec + ms;
}

function pad(n)   { return String(n).padStart(2, '0'); }
function padMs(n) { return String(n).padStart(3, '0'); }
function uid()    { return Math.random().toString(36).slice(2, 8); }

/* ── DOM ─────────────────────────────────────────────────── */
const $  = (id)  => document.getElementById(id);
const $q = (sel) => document.querySelector(sel);

/* ── State ───────────────────────────────────────────────── */
const state = {
  videoFile: null, duration: 0,
  inPoint: null, outPoint: null,
  segments: [], exportedFiles: [],
  frameRate: 30,
  crop: null,          // 待加入下一個片段的框取（全域暫存）
  cropEditSeg: null,   // 正在為哪個 seg.id 設定框取（null = 全域模式）
  previewSeg: null,    // 正在預覽的 seg.id
  previewPartIdx: 0,   // 多段合併片段預覽時的目前 part 索引
};

let timeline       = null;
let cropActive     = false;
let cropDrag       = null;
let previewHandler = null;  // timeupdate 監聽器

const exporter = new Exporter();

/* ── Init ────────────────────────────────────────────────── */
let webpConverter = null;

function init() {
  setupModeTabs();
  setupDropZone(); setupFileInput(); setupVideoEvents();
  setupTransport(); setupCrop(); setupInOut();
  setupSegmentActions(); setupExport(); setupKeyboard();
  webpConverter = new WebpConverter();
}

/* ── Mode Tabs ───────────────────────────────────────────── */
function setupModeTabs() {
  const tabs = document.querySelectorAll('.mode-tab');
  const cutterEls = [$('dropZone'), $('editor')]; // 影片分段處理
  const webpEl    = $('webpConverter');             // webp 轉檔大師

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const mode = tab.dataset.mode;
      if (mode === 'cutter') {
        webpEl.classList.add('hidden');
        // 還原 cutter 原本的顯示狀態
        const hasVideo = !!state.videoFile;
        $('dropZone').classList.toggle('hidden', hasVideo);
        $('editor').classList.toggle('hidden', !hasVideo);
        // 顯示影片 meta
        $('videoMeta').classList.toggle('hidden', !hasVideo);
        $('changeVideoBtn').classList.toggle('hidden', !hasVideo);
      } else {
        // 隱藏 cutter 所有區塊
        cutterEls.forEach((el) => el.classList.add('hidden'));
        $('videoMeta').classList.add('hidden');
        $('changeVideoBtn').classList.add('hidden');
        webpEl.classList.remove('hidden');
      }
    });
  });
}

/* ── Drop Zone ───────────────────────────────────────────── */
function setupDropZone() {
  const zone = $('dropZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) loadVideo(file);
    else toast('請拖入影片檔案', 'error');
  });
  $('selectFileBtn').addEventListener('click', () => $('fileInput').click());
  $('changeVideoBtn').addEventListener('click', () => changeVideo());
}

function setupFileInput() {
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadVideo(file);
    e.target.value = '';
  });
}

/* ── Load Video ──────────────────────────────────────────── */
async function loadVideo(file) {
  stopSegmentPreview();
  state.videoFile = file;
  state.inPoint = null; state.outPoint = null;
  state.segments = []; state.exportedFiles = [];
  state.cropEditSeg = null;

  const video = $('video');
  video.src = URL.createObjectURL(file);
  await new Promise(res => video.addEventListener('loadedmetadata', res, { once: true }));
  state.duration = video.duration;

  $('videoFileName').textContent = file.name;
  $('videoDuration').textContent = formatTime(video.duration);
  $('videoMeta').classList.remove('hidden');
  $('changeVideoBtn').classList.remove('hidden');
  $('dropZone').classList.add('hidden');
  $('editor').classList.remove('hidden');

  if (!timeline) initTimeline();
  timeline.setDuration(state.duration);
  timeline.clearInOut();
  timeline.setSegments([]);
  timeline.setCurrentTime(0);

  renderSegmentList();
  updateExportBtn();
  $('downloadActions').classList.add('hidden');
  clearCrop();
  await exporter.clearInput();
  toast(`已載入：${file.name}`, 'success');
}

function changeVideo() {
  const v = $('video');
  if (v.src) URL.revokeObjectURL(v.src);
  v.src = '';
  $('dropZone').classList.remove('hidden');
  $('editor').classList.add('hidden');
  $('videoMeta').classList.add('hidden');
  $('changeVideoBtn').classList.add('hidden');
}

/* ── Timeline ────────────────────────────────────────────── */
function initTimeline() {
  timeline = new Timeline(
    { ruler: $('tlRuler'), track: $('tlTrack'), segs: $('tlSegs'),
      sel: $('tlSel'), inHandle: $('tlIn'), outHandle: $('tlOut'), playhead: $('tlPlayhead') },
    { onSeek: (t) => seekTo(t), onInChange: (t) => setIn(t), onOutChange: (t) => setOut(t) }
  );
}

/* ── Video Events ────────────────────────────────────────── */
function setupVideoEvents() {
  const video = $('video');
  video.addEventListener('timeupdate', () => {
    $('tCur').textContent = formatTime(video.currentTime);
    timeline?.setCurrentTime(video.currentTime);
  });
  video.addEventListener('play',  () => { $('playBtn').textContent = '⏸'; });
  video.addEventListener('pause', () => { $('playBtn').textContent = '▶'; });
  video.addEventListener('ended', () => {
    $('playBtn').textContent = '▶';
    stopSegmentPreview();
  });
}

/* ── Transport ───────────────────────────────────────────── */
function setupTransport() {
  $('playBtn').addEventListener('click', togglePlay);
  $('frameBackBtn').addEventListener('click', () => stepFrame(-1));
  $('frameFwdBtn').addEventListener('click',  () => stepFrame(+1));
  $('rateSelect').addEventListener('change', (e) => { $('video').playbackRate = parseFloat(e.target.value); });
  $('stopPreviewBtn').addEventListener('click', stopSegmentPreview);
}

function togglePlay() {
  const v = $('video');
  if (v.paused) v.play(); else v.pause();
}

function seekTo(t) {
  $('video').currentTime = Math.max(0, Math.min(t, state.duration));
}

function stepFrame(dir) {
  seekTo($('video').currentTime + dir / state.frameRate);
  if (!$('video').paused) $('video').pause();
}

/* ── Preview Mode ────────────────────────────────────────── */
function startSegmentPreview(id) {
  stopSegmentPreview();
  const seg = findSeg(id);
  if (!seg || !seg.parts.length) return;

  state.previewSeg    = id;
  state.previewPartIdx = 0;

  // 顯示預覽橫幅
  $('previewBanner').textContent = `▶ 預覽中：${seg.name}`;
  $('previewBanner').classList.remove('hidden');
  $('stopPreviewBtn').classList.remove('hidden');

  // 顯示該片段的框取
  refreshCropCanvas();

  // 建立 timeupdate 監聽器以限制播放範圍
  previewHandler = () => {
    const s = findSeg(state.previewSeg);
    if (!s) { stopSegmentPreview(); return; }
    const part = s.parts[state.previewPartIdx];
    if (!part) { stopSegmentPreview(); return; }

    const video = $('video');
    if (video.currentTime >= part.out - 0.04) {
      const next = state.previewPartIdx + 1;
      if (next < s.parts.length) {
        // 跳到下一段
        state.previewPartIdx = next;
        video.currentTime = s.parts[next].in;
      } else {
        // 全部播完，回到開頭並停止
        video.pause();
        video.currentTime = s.parts[0].in;
        stopSegmentPreview();
      }
    }
  };

  $('video').addEventListener('timeupdate', previewHandler);
  $('video').currentTime = seg.parts[0].in;
  $('video').play();

  // 在片段列表中標示正在預覽的卡片
  updatePreviewHighlight(id);
}

function stopSegmentPreview() {
  if (previewHandler) {
    $('video').removeEventListener('timeupdate', previewHandler);
    previewHandler = null;
  }
  if (!state.previewSeg) return;
  state.previewSeg    = null;
  state.previewPartIdx = 0;
  $('previewBanner').classList.add('hidden');
  $('stopPreviewBtn').classList.add('hidden');
  updatePreviewHighlight(null);
  refreshCropCanvas();
}

function updatePreviewHighlight(id) {
  $('segList').querySelectorAll('.seg-item').forEach(el => {
    el.classList.toggle('previewing', el.dataset.id === id);
  });
}

/* ── Per-Segment Crop Edit ───────────────────────────────── */
function startSegmentCropEdit(id) {
  // 如果正在預覽，先停止
  stopSegmentPreview();
  const seg = findSeg(id);
  if (!seg) return;

  // 結束其他 segment 的 crop 編輯
  state.cropEditSeg = id;
  cropActive = true;
  cropDrag   = null;

  $('cropToggleBtn').classList.add('active');
  $('cropCanvas').classList.remove('hidden');
  resizeCropCanvas();
  refreshCropCanvas();

  // 更新按鈕狀態
  renderSegmentList();
  toast(`在影片上拖曳，為「${seg.name}」設定框取範圍`);
}

function clearSegmentCrop(id) {
  const seg = findSeg(id);
  if (!seg) return;
  seg.crop = null;
  if (state.cropEditSeg === id) {
    state.cropEditSeg = null;
    cropActive = false;
    cropDrag   = null;
    $('cropToggleBtn').classList.remove('active');
  }
  renderSegmentList();
  refreshCropCanvas();
  toast(`已清除「${seg.name}」的框取範圍`);
}

/* ── Crop（全域暫存框取） ────────────────────────────────── */
function setupCrop() {
  $('cropToggleBtn').addEventListener('click', toggleCropMode);
  $('cropClearBtn').addEventListener('click', () => { clearCrop(); toast('已清除框取範圍'); });
  const canvas = $('cropCanvas');
  canvas.addEventListener('mousedown', onCropMouseDown);
  canvas.addEventListener('mousemove', onCropMouseMove);
  document.addEventListener('mouseup', onCropMouseUp);
}

function toggleCropMode() {
  if (state.cropEditSeg) {
    // 離開片段框取編輯模式
    state.cropEditSeg = null;
    cropActive = false;
    cropDrag   = null;
    $('cropToggleBtn').classList.remove('active');
    renderSegmentList();
    refreshCropCanvas();
    return;
  }

  cropActive = !cropActive;
  if (cropActive) {
    $('cropToggleBtn').classList.add('active');
    $('cropCanvas').classList.remove('hidden');
    resizeCropCanvas();
    refreshCropCanvas();
  } else {
    $('cropToggleBtn').classList.remove('active');
    refreshCropCanvas();
  }
}

function clearCrop() {
  state.crop = null;
  cropDrag   = null;
  cropActive = false;
  state.cropEditSeg = null;
  $('cropToggleBtn').classList.remove('active');
  $('cropClearBtn').classList.add('hidden');
  refreshCropCanvas();
}

function resizeCropCanvas() {
  const c = $('cropCanvas');
  c.width = c.clientWidth; c.height = c.clientHeight;
}

function getVideoRect() {
  const v = $('video');
  const vw = v.clientWidth, vh = v.clientHeight;
  const natW = v.videoWidth || vw, natH = v.videoHeight || vh;
  const vr = natW / natH, er = vw / vh;
  let rw, rh, rx, ry;
  if (vr > er) { rw = vw; rh = vw / vr; rx = 0; ry = (vh - rh) / 2; }
  else         { rh = vh; rw = vh * vr; ry = 0; rx = (vw - rw) / 2; }
  return { x: rx, y: ry, w: rw, h: rh };
}

function onCropMouseDown(e) {
  if (!cropActive) return;
  resizeCropCanvas();
  const rect = $('cropCanvas').getBoundingClientRect();
  const vr   = getVideoRect();
  const cx = Math.max(vr.x, Math.min(vr.x + vr.w, e.clientX - rect.left));
  const cy = Math.max(vr.y, Math.min(vr.y + vr.h, e.clientY - rect.top));
  cropDrag = { sx: cx, sy: cy, ex: cx, ey: cy };
  refreshCropCanvas();
  e.preventDefault();
}

function onCropMouseMove(e) {
  if (!cropDrag) return;
  const rect = $('cropCanvas').getBoundingClientRect();
  const vr   = getVideoRect();
  cropDrag.ex = Math.max(vr.x, Math.min(vr.x + vr.w, e.clientX - rect.left));
  cropDrag.ey = Math.max(vr.y, Math.min(vr.y + vr.h, e.clientY - rect.top));
  refreshCropCanvas();
}

function onCropMouseUp() {
  if (!cropDrag) return;
  const dx = Math.abs(cropDrag.ex - cropDrag.sx);
  const dy = Math.abs(cropDrag.ey - cropDrag.sy);
  if (dx > 4 && dy > 4) {
    const v = $('video'), vr = getVideoRect();
    const sx = Math.min(cropDrag.sx, cropDrag.ex), sy = Math.min(cropDrag.sy, cropDrag.ey);
    const ex = Math.max(cropDrag.sx, cropDrag.ex), ey = Math.max(cropDrag.sy, cropDrag.ey);
    const newCrop = {
      x: Math.round((sx - vr.x) * (v.videoWidth  / vr.w)),
      y: Math.round((sy - vr.y) * (v.videoHeight / vr.h)),
      w: Math.round((ex - sx)   * (v.videoWidth  / vr.w)),
      h: Math.round((ey - sy)   * (v.videoHeight / vr.h)),
    };

    if (state.cropEditSeg) {
      // 套用至特定片段
      const seg = findSeg(state.cropEditSeg);
      if (seg) {
        seg.crop = newCrop;
        renderSegmentList();
        toast(`「${seg.name}」框取：${newCrop.w}×${newCrop.h} px`);
      }
    } else {
      // 全域暫存（加入下一個片段時使用）
      state.crop = newCrop;
      $('cropClearBtn').classList.remove('hidden');
      toast(`框取範圍：${newCrop.w}×${newCrop.h} px（將套用至下一個加入的片段）`);
    }
  }
  cropDrag = null;
  refreshCropCanvas();
}

/**
 * 決定 canvas 要顯示哪個框取並重繪
 * 優先順序：預覽片段的 crop > 正在編輯的 seg crop > 全域暫存 crop
 */
function refreshCropCanvas() {
  const canvas = $('cropCanvas');

  // 決定要顯示的 crop
  let activeCrop = null;
  if (state.previewSeg) {
    activeCrop = findSeg(state.previewSeg)?.crop || null;
  } else if (state.cropEditSeg) {
    activeCrop = findSeg(state.cropEditSeg)?.crop || null;
  } else {
    activeCrop = state.crop;
  }

  const needCanvas = activeCrop || cropDrag || cropActive;
  if (!needCanvas) {
    canvas.classList.add('hidden');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  canvas.classList.remove('hidden');
  resizeCropCanvas();
  drawCropOverlay(activeCrop);
}

function drawCropOverlay(activeCrop) {
  const canvas = $('cropCanvas'), ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, vr = getVideoRect();
  ctx.clearRect(0, 0, W, H);

  let rx, ry, rw, rh;
  let labelCrop = null;

  if (cropDrag) {
    rx = Math.min(cropDrag.sx, cropDrag.ex); ry = Math.min(cropDrag.sy, cropDrag.ey);
    rw = Math.abs(cropDrag.ex - cropDrag.sx); rh = Math.abs(cropDrag.ey - cropDrag.sy);
  } else if (activeCrop) {
    const v = $('video');
    const sx = vr.w / v.videoWidth, sy = vr.h / v.videoHeight;
    rx = vr.x + activeCrop.x * sx; ry = vr.y + activeCrop.y * sy;
    rw = activeCrop.w * sx; rh = activeCrop.h * sy;
    labelCrop = activeCrop;
  } else { return; }

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fillRect(rx, ry, rw, rh);
  ctx.restore();

  ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 2;
  ctx.strokeRect(rx, ry, rw, rh);

  const hs = 7; ctx.fillStyle = '#818cf8';
  [[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].forEach(([hx,hy]) => {
    ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
  });

  if (labelCrop) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(rx+4, ry+4, 110, 18);
    ctx.fillStyle = '#e0e7ff'; ctx.font = '11px monospace';
    ctx.fillText(`${labelCrop.w} × ${labelCrop.h} px`, rx+8, ry+16);
  }
}

window.addEventListener('resize', () => {
  if (!$('cropCanvas').classList.contains('hidden')) {
    resizeCropCanvas();
    refreshCropCanvas();
  }
});

/* ── In/Out ──────────────────────────────────────────────── */
function setupInOut() {
  $('setInBtn').addEventListener('click',  () => setIn($('video').currentTime));
  $('setOutBtn').addEventListener('click', () => setOut($('video').currentTime));
  $('inField').addEventListener('change', (e) => {
    const t = parseTime(e.target.value);
    if (t !== null && t >= 0 && t <= state.duration) { setIn(t, false); e.target.classList.remove('error'); }
    else e.target.classList.add('error');
  });
  $('outField').addEventListener('change', (e) => {
    const t = parseTime(e.target.value);
    if (t !== null && t >= 0 && t <= state.duration) { setOut(t, false); e.target.classList.remove('error'); }
    else e.target.classList.add('error');
  });
  $('addSegBtn').addEventListener('click', addSegment);
}

function setIn(t, updateField = true) {
  state.inPoint = t;
  if (updateField) $('inField').value = formatTime(t);
  $('inField').classList.remove('error');
  timeline?.setInPoint(t);
}

function setOut(t, updateField = true) {
  state.outPoint = t;
  if (updateField) $('outField').value = formatTime(t);
  $('outField').classList.remove('error');
  timeline?.setOutPoint(t);
}

/* ── Add Segment ─────────────────────────────────────────── */
function addSegment() {
  const inT = state.inPoint, outT = state.outPoint;
  if (inT === null || outT === null) { toast('請先設定起點 (I) 與終點 (O)', 'error'); return; }
  if (outT <= inT)                   { toast('終點必須在起點之後', 'error'); return; }

  const prefix = $('prefixInput').value.trim() || 'clip';
  const idx    = state.segments.length + 1;
  // 將目前全域框取複製一份存入片段
  const segCrop = state.crop ? { ...state.crop } : null;

  state.segments.push({
    id: uid(),
    name: `${prefix}_${String(idx).padStart(2,'0')}`,
    parts: [{ in: inT, out: outT }],
    crop: segCrop,
  });

  state.inPoint = null; state.outPoint = null;
  $('inField').value = ''; $('outField').value = '';
  timeline?.clearInOut();
  renderSegmentList(); timeline?.setSegments(state.segments); updateExportBtn();
  toast(`已加入片段 ${state.segments[state.segments.length-1].name}`, 'success');
}

/* ── Segment List ────────────────────────────────────────── */
function setupSegmentActions() {
  $('mergeBtn').addEventListener('click', mergeSelected);
}

function renderSegmentList() {
  const list = $('segList'), segs = state.segments;
  $('segBadge').textContent = segs.length;

  if (segs.length === 0) {
    list.innerHTML = '<div class="seg-empty">尚無片段<br><small>在時間軸標記起訖點後點擊「加入片段」</small></div>';
    $('mergeBtn').disabled = true;
    return;
  }

  const colors = ['#10b981','#6366f1','#f59e0b','#ef4444','#14b8a6'];

  list.innerHTML = segs.map((seg, i) => {
    const color    = colors[i % colors.length];
    const isMerge  = seg.parts.length > 1;
    const totalDur = seg.parts.reduce((s, p) => s + (p.out - p.in), 0);
    const isEditingCrop = state.cropEditSeg === seg.id;

    const partsHtml = seg.parts.map((p, pi) => `<div class="seg-part-row">
      ${isMerge ? `<span class="seg-part-num">${pi+1}.</span>` : ''}
      <span class="part-time">${formatTime(p.in)} → ${formatTime(p.out)}</span>
      <span class="part-dur">(${(p.out-p.in).toFixed(2)}s)</span>
    </div>`).join('');

    const cropTag = seg.crop
      ? `<span class="crop-tag" title="框取：${seg.crop.w}×${seg.crop.h} px">⊡ ${seg.crop.w}×${seg.crop.h}</span>`
      : '';

    return `<div class="seg-item" data-id="${seg.id}">
      <div class="seg-top">
        <input type="checkbox" class="seg-check" data-id="${seg.id}">
        <div class="seg-color-dot" style="background:${color}"></div>
        <span class="seg-name editable" data-rename="${seg.id}" title="點擊重命名">${seg.name}</span>
        ${isMerge ? '<span class="merged-tag">合併</span>' : ''}
        ${cropTag}
      </div>
      <div class="seg-parts">${partsHtml}</div>
      ${isMerge ? `<div class="seg-total-dur">總長 ${totalDur.toFixed(2)}s</div>` : ''}
      <div class="seg-edit-row hidden" data-edit="${seg.id}">
        <input class="time-field" placeholder="起點" data-ep="in" data-id="${seg.id}" value="${formatTime(seg.parts[0].in)}">
        <input class="time-field" placeholder="終點" data-ep="out" data-id="${seg.id}" value="${formatTime(seg.parts[seg.parts.length-1].out)}">
        <button class="btn btn-sm btn-primary" data-save="${seg.id}">儲存</button>
        <button class="btn btn-sm btn-outline" data-cancel="${seg.id}">取消</button>
      </div>
      <div class="seg-footer">
        <button class="btn-icon-sm" data-preview="${seg.id}">▶ 預覽</button>
        ${!isMerge ? `<button class="btn-icon-sm" data-edit-toggle="${seg.id}">✏ 時間</button>` : ''}
        ${isMerge  ? `<button class="btn-icon-sm" data-unmerge="${seg.id}">↩ 拆開</button>` : ''}
        <button class="btn-icon-sm${isEditingCrop ? ' active' : ''}" data-crop-edit="${seg.id}">⊡ 框取</button>
        ${seg.crop ? `<button class="btn-icon-sm danger" data-crop-clear="${seg.id}">✕ 清框取</button>` : ''}
        <button class="btn-icon-sm danger" data-delete="${seg.id}">✕ 刪除</button>
      </div>
    </div>`;
  }).join('');

  // 事件綁定
  list.querySelectorAll('.seg-check').forEach(cb => cb.addEventListener('change', updateMergeBtn));
  list.querySelectorAll('[data-preview]').forEach(btn =>
    btn.addEventListener('click', () => startSegmentPreview(btn.dataset.preview)));
  list.querySelectorAll('[data-crop-edit]').forEach(btn =>
    btn.addEventListener('click', () => startSegmentCropEdit(btn.dataset.cropEdit)));
  list.querySelectorAll('[data-crop-clear]').forEach(btn =>
    btn.addEventListener('click', () => clearSegmentCrop(btn.dataset.cropClear)));
  list.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSegment(btn.dataset.delete)));
  list.querySelectorAll('[data-edit-toggle]').forEach(btn =>
    btn.addEventListener('click', () => toggleEdit(btn.dataset.editToggle)));
  list.querySelectorAll('[data-save]').forEach(btn =>
    btn.addEventListener('click', () => saveEdit(btn.dataset.save)));
  list.querySelectorAll('[data-cancel]').forEach(btn =>
    btn.addEventListener('click', () => cancelEdit(btn.dataset.cancel)));
  list.querySelectorAll('[data-unmerge]').forEach(btn =>
    btn.addEventListener('click', () => unmergeSegment(btn.dataset.unmerge)));
  list.querySelectorAll('[data-rename]').forEach(span =>
    span.addEventListener('click', () => startNameEdit(span, span.dataset.rename)));

  updateMergeBtn();
  // 恢復預覽高亮
  if (state.previewSeg) updatePreviewHighlight(state.previewSeg);
}

function findSeg(id) { return state.segments.find(s => s.id === id); }
function getCheckedIds() { return [...$('segList').querySelectorAll('.seg-check:checked')].map(cb => cb.dataset.id); }
function updateMergeBtn() { $('mergeBtn').disabled = getCheckedIds().length < 2; }

function deleteSegment(id) {
  if (state.previewSeg === id) stopSegmentPreview();
  if (state.cropEditSeg === id) { state.cropEditSeg = null; cropActive = false; }
  state.segments = state.segments.filter(s => s.id !== id);
  renameSeg(); renderSegmentList(); timeline?.setSegments(state.segments); updateExportBtn();
}

function renameSeg() {
  const prefix = $('prefixInput').value.trim() || 'clip';
  // 只重新編號沒有自訂名稱的片段，保留使用者手動改過的名稱
  state.segments.forEach((s, i) => {
    if (!s.renamed) s.name = `${prefix}_${String(i+1).padStart(2,'0')}`;
  });
}

function startNameEdit(span, id) {
  const seg = findSeg(id);
  if (!seg) return;

  const input = document.createElement('input');
  input.className = 'seg-name-input';
  input.value = seg.name;
  span.replaceWith(input);
  input.focus();
  input.select();

  const confirm = () => {
    const newName = input.value.trim();
    if (newName && newName !== seg.name) {
      seg.name    = newName;
      seg.renamed = true;  // 標記為使用者自訂，不再自動重命名
    }
    renderSegmentList();
  };

  input.addEventListener('blur', confirm);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); renderSegmentList(); } // 取消
  });
}

function mergeSelected() {
  const ids = getCheckedIds();
  if (ids.length < 2) return;
  const selected  = ids.map(id => findSeg(id)).filter(Boolean);
  const allParts  = selected.flatMap(s => s.parts).sort((a,b) => a.in - b.in);
  const prefix    = $('prefixInput').value.trim() || 'clip';
  const firstIdx  = Math.min(...selected.map(s => state.segments.indexOf(s)));
  // 合併時取第一個有框取的 seg 的 crop
  const mergeCrop = selected.find(s => s.crop)?.crop || null;
  state.segments  = state.segments.filter(s => !ids.includes(s.id));
  state.segments.splice(firstIdx, 0, { id: uid(), name: `${prefix}_merged`, parts: allParts, crop: mergeCrop ? {...mergeCrop} : null });
  renameSeg(); renderSegmentList(); timeline?.setSegments(state.segments); updateExportBtn();
  toast(`已合併 ${ids.length} 個片段`, 'success');
}

function unmergeSegment(id) {
  const seg = findSeg(id);
  if (!seg || seg.parts.length <= 1) return;
  const idx = state.segments.indexOf(seg);
  state.segments.splice(idx, 1, ...seg.parts.map(p => ({ id: uid(), name: '', parts: [p], crop: seg.crop ? {...seg.crop} : null })));
  renameSeg(); renderSegmentList(); timeline?.setSegments(state.segments); updateExportBtn();
  toast('已拆開合併片段', 'success');
}

function toggleEdit(id) {
  const row = $('segList').querySelector(`[data-edit="${id}"]`);
  if (row) row.classList.toggle('hidden');
}

function saveEdit(id) {
  const row = $('segList').querySelector(`[data-edit="${id}"]`);
  if (!row) return;
  const inT  = parseTime(row.querySelector('[data-ep="in"]').value);
  const outT = parseTime(row.querySelector('[data-ep="out"]').value);
  if (inT === null || outT === null || outT <= inT) { toast('時間格式錯誤或終點不在起點之後', 'error'); return; }
  const seg = findSeg(id);
  if (!seg || seg.parts.length > 1) return;
  seg.parts[0].in = inT; seg.parts[0].out = outT;
  renderSegmentList(); timeline?.setSegments(state.segments);
  toast('已更新片段時間', 'success');
}

function cancelEdit(id) {
  const row = $('segList').querySelector(`[data-edit="${id}"]`);
  if (row) row.classList.add('hidden');
}

/* ── Export ──────────────────────────────────────────────── */
function setupExport() {
  $('loadFfmpegBtn').addEventListener('click', loadFfmpeg);
  $('exportBtn').addEventListener('click', runExport);
  $('dlZipBtn').addEventListener('click', downloadZip);
  $('dlEachBtn').addEventListener('click', downloadEach);
}

function updateExportBtn() {
  $('exportBtn').disabled = !(exporter.isReady && state.segments.length > 0);
}

async function loadFfmpeg() {
  const btn = $('loadFfmpegBtn'), text = $('ffmpegStatusText');
  btn.disabled = true;
  setFfmpegState('loading');
  try {
    await exporter.load((msg) => { text.textContent = msg; }, () => {});
    setFfmpegState('ready');
    text.textContent = 'ffmpeg.wasm 已就緒';
    btn.textContent  = '已就緒';
    updateExportBtn();
    toast('ffmpeg.wasm 載入完成！', 'success');
  } catch (err) {
    setFfmpegState('error');
    text.textContent = `載入失敗：${err.message}`;
    btn.disabled = false;
    toast(`ffmpeg 載入失敗：${err.message}`, 'error');
  }
}

function setFfmpegState(s) { $('ffmpegStatus').dataset.state = s; }

async function runExport() {
  if (!exporter.isReady)           { toast('請先載入 ffmpeg.wasm', 'error'); return; }
  if (state.segments.length === 0) { toast('尚無片段', 'error'); return; }

  const format = $q('input[name="fmt"]:checked').value;
  const width  = parseInt($('widthInput').value) || 480;
  const fps    = parseInt($('fpsInput').value)   || 15;
  const prefix = $('prefixInput').value.trim()   || 'clip';

  $('prefixInput').value = prefix;
  renameSeg(); renderSegmentList();
  $('exportBtn').disabled = true;
  $('downloadActions').classList.add('hidden');
  $('exportProgress').classList.remove('hidden');
  state.exportedFiles = [];
  const total = state.segments.length;

  function setProgress(p) { $('progressFill').style.width = `${Math.round(p*100)}%`; }

  try {
    // 注意：每個 seg 已帶有自己的 seg.crop，exporter 直接讀取
    state.exportedFiles = await exporter.exportAll(
      state.videoFile, state.segments, { format, width, fps },
      (i, tot, name) => { $('progressLbl').textContent = `匯出 ${i}/${tot}：${name}`; setProgress((i-1)/tot); },
      (p) => { setProgress(state.exportedFiles.length / total + p / total); }
    );
    setProgress(1);
    $('progressLbl').textContent = `完成！共匯出 ${total} 個檔案`;
    $('exportedCount').textContent = total;
    $('downloadActions').classList.remove('hidden');
    toast(`成功匯出 ${total} 個${format === 'webp' ? ' WebP' : ' GIF'}`, 'success');
  } catch (err) {
    $('progressLbl').textContent = `錯誤：${err.message}`;
    toast(`匯出失敗：${err.message}`, 'error');
    console.error(err);
  } finally {
    $('exportBtn').disabled = false;
  }
}

/* ── Download ────────────────────────────────────────────── */
async function downloadZip() {
  if (!state.exportedFiles.length) return;
  const zip = new JSZip();
  for (const { name, data } of state.exportedFiles) zip.file(name, data);
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, 'giflightcutter_export.zip');
  toast('ZIP 下載已開始', 'success');
}

function downloadEach() {
  if (!state.exportedFiles.length) return;
  for (const { name, data } of state.exportedFiles) {
    triggerDownload(new Blob([data], { type: name.endsWith('.webp') ? 'image/webp' : 'image/gif' }), name);
  }
  toast(`逐一下載 ${state.exportedFiles.length} 個檔案`, 'success');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ── Keyboard ────────────────────────────────────────────── */
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const video = $('video');
    if (!video?.src) return;
    switch (e.code) {
      case 'Space':      e.preventDefault(); togglePlay(); break;
      case 'KeyI':       e.preventDefault(); setIn(video.currentTime); break;
      case 'KeyO':       e.preventDefault(); setOut(video.currentTime); break;
      case 'KeyC':       e.preventDefault(); if (state.videoFile) toggleCropMode(); break;
      case 'Escape':     e.preventDefault(); stopSegmentPreview(); break;
      case 'Enter':      e.preventDefault(); addSegment(); break;
      case 'ArrowLeft':  e.preventDefault(); stepFrame(e.shiftKey ? -state.frameRate : -1); break;
      case 'ArrowRight': e.preventDefault(); stepFrame(e.shiftKey ? +state.frameRate : +1); break;
      case 'ArrowUp':    e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); break;
      case 'ArrowDown':  e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); break;
    }
  });
}

/* ── Toast ───────────────────────────────────────────────── */
function toast(msg, type = '') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

init();
