/**
 * Timeline – 時間軸 UI 元件
 * 負責顯示播放進度、起訖點選擇、片段標記
 */
export class Timeline {
  constructor(elements, callbacks = {}) {
    // DOM 元素
    this.ruler     = elements.ruler;
    this.track     = elements.track;
    this.segs      = elements.segs;
    this.sel       = elements.sel;
    this.inHandle  = elements.inHandle;
    this.outHandle = elements.outHandle;
    this.playhead  = elements.playhead;

    // 回呼
    this.onSeek      = callbacks.onSeek      || (() => {});
    this.onInChange  = callbacks.onInChange  || (() => {});
    this.onOutChange = callbacks.onOutChange || (() => {});

    // 狀態
    this.duration    = 0;
    this.currentTime = 0;
    this.inPoint     = null;
    this.outPoint    = null;
    this.segments    = [];   // [{id, parts:[{in,out}], colorIdx}]

    this._bindEvents();
  }

  /* ── 公開 API ─────────────────────────────────────────── */

  setDuration(d) {
    this.duration = d;
    this._buildRuler();
    this._updatePlayhead();
  }

  setCurrentTime(t) {
    this.currentTime = t;
    this._updatePlayhead();
  }

  setInPoint(t) {
    this.inPoint = t;
    this._updateSel();
  }

  setOutPoint(t) {
    this.outPoint = t;
    this._updateSel();
  }

  clearInOut() {
    this.inPoint  = null;
    this.outPoint = null;
    this._updateSel();
  }

  /** 新增或更新一個片段（重新渲染全部） */
  setSegments(segments) {
    this.segments = segments;
    this._renderSegments();
  }

  /* ── 私有：事件繫結 ────────────────────────────────────── */

  _bindEvents() {
    // 點擊 track → seek
    this.track.addEventListener('mousedown', (e) => {
      if (e.target === this.inHandle  || this.inHandle.contains(e.target))  return;
      if (e.target === this.outHandle || this.outHandle.contains(e.target)) return;
      this._startSeekDrag(e);
    });

    // 拖曳 In handle
    this.inHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this._startHandleDrag(e, 'in');
    });

    // 拖曳 Out handle
    this.outHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this._startHandleDrag(e, 'out');
    });
  }

  _startSeekDrag(e) {
    const doSeek = (ev) => {
      const t = this._eventToTime(ev);
      this.onSeek(t);
    };
    doSeek(e);

    const onMove = (ev) => doSeek(ev);
    const onUp   = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  _startHandleDrag(e, type) {
    const onMove = (ev) => {
      const t = this._eventToTime(ev);
      if (type === 'in') {
        this.inPoint = Math.min(t, this.outPoint ?? this.duration);
        this.inPoint = Math.max(0, this.inPoint);
        this.onInChange(this.inPoint);
      } else {
        this.outPoint = Math.max(t, this.inPoint ?? 0);
        this.outPoint = Math.min(this.duration, this.outPoint);
        this.onOutChange(this.outPoint);
      }
      this._updateSel();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  /* ── 私有：計算工具 ────────────────────────────────────── */

  _eventToTime(e) {
    const rect = this.track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * this.duration;
  }

  _pct(t) {
    if (!this.duration) return 0;
    return (t / this.duration) * 100;
  }

  /* ── 私有：渲染 ────────────────────────────────────────── */

  _buildRuler() {
    if (!this.duration) return;
    const step = this._rulerStep();
    let html = '';
    for (let t = 0; t <= this.duration; t += step) {
      const p = this._pct(t);
      html += `<div class="tl-mark" style="left:${p.toFixed(3)}%">
                 <span>${formatTimeShort(t)}</span>
               </div>`;
    }
    this.ruler.innerHTML = html;
  }

  _rulerStep() {
    const d = this.duration;
    if (d <=   30) return  1;
    if (d <=  120) return  5;
    if (d <=  600) return 30;
    if (d <= 3600) return 60;
    return 300;
  }

  _updatePlayhead() {
    const p = this._pct(this.currentTime);
    this.playhead.style.left = `${p.toFixed(3)}%`;
  }

  _updateSel() {
    const hasIn  = this.inPoint  !== null;
    const hasOut = this.outPoint !== null;

    if (!hasIn && !hasOut) {
      this.sel.classList.add('hidden');
      this.inHandle.classList.add('hidden');
      this.outHandle.classList.add('hidden');
      return;
    }

    if (hasIn) {
      const p = this._pct(this.inPoint);
      this.inHandle.style.left = `${p.toFixed(3)}%`;
      this.inHandle.classList.remove('hidden');
    }

    if (hasOut) {
      const p = this._pct(this.outPoint);
      this.outHandle.style.left = `${p.toFixed(3)}%`;
      this.outHandle.classList.remove('hidden');
    }

    if (hasIn && hasOut) {
      const inPct  = this._pct(Math.min(this.inPoint, this.outPoint));
      const outPct = this._pct(Math.max(this.inPoint, this.outPoint));
      this.sel.style.left  = `${inPct.toFixed(3)}%`;
      this.sel.style.width = `${(outPct - inPct).toFixed(3)}%`;
      this.sel.classList.remove('hidden');
    } else {
      this.sel.classList.add('hidden');
    }
  }

  _renderSegments() {
    const colors = ['--seg0','--seg1','--seg2','--seg3','--seg4'];
    let html = '';
    this.segments.forEach((seg, i) => {
      const colorVar = colors[i % colors.length];
      seg.parts.forEach(part => {
        const l = this._pct(part.in);
        const w = this._pct(part.out) - l;
        html += `<div class="tl-seg-band"
          style="left:${l.toFixed(3)}%;width:${Math.max(w,0.1).toFixed(3)}%;
                 background:var(${colorVar})"
          title="${seg.name}"></div>`;
      });
    });
    this.segs.innerHTML = html;
  }
}

/* ── 時間格式化工具（供 timeline 使用） ──────────────────── */
function formatTimeShort(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
