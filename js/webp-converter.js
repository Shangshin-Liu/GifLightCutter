/**
 * WebP 轉檔大師 – 獨立模組
 * 批次上傳圖片 → 預覽 → 縮放 → 轉為 WebP → 下載
 */

/* ── Helpers ──────────────────────────────────────────────── */
function uid() { return Math.random().toString(36).slice(2, 8); }

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getExt(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : '—';
}

function baseName(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(0, dot) : name;
}

/* ── WebpConverter ────────────────────────────────────────── */
export class WebpConverter {
  constructor() {
    /** @type {Array<ImageItem>} */
    this.items = [];
    this.converted = false;

    /* DOM 快取 */
    this.dropZone     = document.getElementById('webpDropZone');
    this.fileInput    = document.getElementById('webpFileInput');
    this.selectBtn    = document.getElementById('webpSelectBtn');
    this.grid         = document.getElementById('webpGrid');
    this.emptyHint    = document.getElementById('webpEmpty');
    this.widthInput   = document.getElementById('webpWidth');
    this.heightInput  = document.getElementById('webpHeight');
    this.resizeBtn    = document.getElementById('webpResizeBtn');
    this.convertBtn   = document.getElementById('webpConvertBtn');
    this.dlAllZipBtn  = document.getElementById('webpDlZipBtn');
    this.dlAllEachBtn = document.getElementById('webpDlEachBtn');
    this.clearBtn     = document.getElementById('webpClearBtn');
    this.downloadBar  = document.getElementById('webpDownloadBar');
    this.progressWrap = document.getElementById('webpProgressWrap');
    this.progressFill = document.getElementById('webpProgressFill');
    this.progressLbl  = document.getElementById('webpProgressLbl');
    this.suffixInput  = document.getElementById('webpSuffix');

    this._bind();
  }

  /* ── Event Bindings ───────────────────────────────────────── */
  _bind() {
    /* 拖曳上傳 */
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      this._addFiles(e.dataTransfer.files);
    });

    /* 選檔 */
    this.selectBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => {
      this._addFiles(e.target.files);
      this.fileInput.value = '';
    });

    /* 尺寸調整 */
    this.resizeBtn.addEventListener('click', () => this._resize());

    /* 轉檔 */
    this.convertBtn.addEventListener('click', () => this._convert());

    /* 下載 */
    this.dlAllZipBtn.addEventListener('click', () => this._downloadZip());
    this.dlAllEachBtn.addEventListener('click', () => this._downloadEach());

    /* 清除全部 */
    this.clearBtn.addEventListener('click', () => this._clearAll());

    /* 後綴詞變更 → 即時更新卡片 */
    this.suffixInput.addEventListener('input', () => this._renderCards());
  }

  /* ── 新增圖片 ─────────────────────────────────────────────── */
  async _addFiles(fileList) {
    const promises = [];
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) continue;
      promises.push(this._loadImage(file));
    }
    await Promise.all(promises);
    this._updateUI();
  }

  _loadImage(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const item = {
          id: uid(),
          file,
          name: file.name,
          format: getExt(file.name),
          origWidth: img.naturalWidth,
          origHeight: img.naturalHeight,
          width: img.naturalWidth,
          height: img.naturalHeight,
          size: file.size,
          objectUrl: url,
          /** @type {HTMLCanvasElement|null} */
          canvas: null,
          /** @type {Blob|null} */
          webpBlob: null,
          webpUrl: null,
        };
        this.items.push(item);
        resolve(item);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /* ── 尺寸調整 ─────────────────────────────────────────────── */
  _resize() {
    const wVal = parseInt(this.widthInput.value, 10);
    const hVal = parseInt(this.heightInput.value, 10);
    const hasW = wVal > 0;
    const hasH = hVal > 0;
    if (!hasW && !hasH) return;

    for (const item of this.items) {
      const ratio = item.origWidth / item.origHeight;
      let newW, newH;

      if (hasW && hasH) {
        newW = wVal;
        newH = hVal;
      } else if (hasW) {
        newW = wVal;
        newH = Math.round(wVal / ratio);
      } else {
        newH = hVal;
        newW = Math.round(hVal * ratio);
      }

      item.width = newW;
      item.height = newH;

      /* 用 canvas 繪製縮放後圖片 */
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.src = item.objectUrl;
      ctx.drawImage(img, 0, 0, newW, newH);
      item.canvas = canvas;

      /* 清除舊的轉換結果 */
      if (item.webpUrl) { URL.revokeObjectURL(item.webpUrl); item.webpUrl = null; }
      item.webpBlob = null;
    }
    this.converted = false;
    this._renderCards();
  }

  /* ── 轉為 WebP ────────────────────────────────────────────── */
  async _convert() {
    this.progressWrap.classList.remove('hidden');
    this.convertBtn.disabled = true;

    const total = this.items.length;
    let done = 0;

    for (const item of this.items) {
      this.progressLbl.textContent = `轉檔中 ${done + 1} / ${total}`;
      this.progressFill.style.width = `${(done / total) * 100}%`;

      /* 確保有 canvas */
      if (!item.canvas) {
        const canvas = document.createElement('canvas');
        canvas.width = item.width;
        canvas.height = item.height;
        const ctx = canvas.getContext('2d');
        await new Promise((r) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, 0, 0, item.width, item.height); r(); };
          img.src = item.objectUrl;
        });
        item.canvas = canvas;
      }

      /* canvas → WebP blob */
      const blob = await new Promise((r) => item.canvas.toBlob(r, 'image/webp', 0.85));
      if (item.webpUrl) URL.revokeObjectURL(item.webpUrl);
      item.webpBlob = blob;
      item.webpUrl = URL.createObjectURL(blob);

      done++;
      this.progressFill.style.width = `${(done / total) * 100}%`;
    }

    this.progressLbl.textContent = `全部完成！共 ${total} 張`;
    this.converted = true;
    this.convertBtn.disabled = false;
    this._renderCards();
    this._updateUI();
  }

  /* ── 下載 ─────────────────────────────────────────────────── */
  _downloadEach() {
    for (const item of this.items) {
      if (!item.webpUrl) continue;
      const a = document.createElement('a');
      a.href = item.webpUrl;
      a.download = `${this._getOutputName(item)}.webp`;
      a.click();
    }
  }

  async _downloadZip() {
    if (typeof JSZip === 'undefined') { alert('JSZip 尚未載入'); return; }
    const zip = new JSZip();
    for (const item of this.items) {
      if (!item.webpBlob) continue;
      zip.file(`${this._getOutputName(item)}.webp`, item.webpBlob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'webp_images.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── 清除 ─────────────────────────────────────────────────── */
  _clearAll() {
    for (const item of this.items) {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
      if (item.webpUrl) URL.revokeObjectURL(item.webpUrl);
    }
    this.items = [];
    this.converted = false;
    this.progressWrap.classList.add('hidden');
    this._updateUI();
  }

  /* ── 刪除單張 ─────────────────────────────────────────────── */
  _removeItem(id) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const item = this.items[idx];
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    if (item.webpUrl) URL.revokeObjectURL(item.webpUrl);
    this.items.splice(idx, 1);
    if (this.items.length === 0) this.converted = false;
    this._updateUI();
  }

  /* ── UI 更新 ──────────────────────────────────────────────── */
  _updateUI() {
    const hasItems = this.items.length > 0;
    this.emptyHint.classList.toggle('hidden', hasItems);
    this.resizeBtn.disabled = !hasItems;
    this.convertBtn.disabled = !hasItems;
    this.clearBtn.classList.toggle('hidden', !hasItems);
    this.downloadBar.classList.toggle('hidden', !this.converted);
    this._renderCards();
  }

  _renderCards() {
    this.grid.innerHTML = '';
    for (const item of this.items) {
      this.grid.appendChild(this._createCard(item));
    }
  }

  /** 取得套用後綴詞的輸出檔名（不含副檔名） */
  _getOutputName(item) {
    const suffix = this.suffixInput.value || '';
    return baseName(item.name) + suffix;
  }

  _createCard(item) {
    const card = document.createElement('div');
    card.className = 'webp-card';
    card.dataset.id = item.id;

    /* 預覽圖 */
    const imgWrap = document.createElement('div');
    imgWrap.className = 'webp-card-img';
    const img = document.createElement('img');
    img.src = item.webpUrl || item.objectUrl;
    img.alt = item.name;
    imgWrap.appendChild(img);

    /* 資訊 */
    const outName = this._getOutputName(item);
    const displayName = outName + '.' + getExt(item.name).toLowerCase();
    const info = document.createElement('div');
    info.className = 'webp-card-info';
    info.innerHTML = `
      <div class="webp-card-name" title="${displayName}">${displayName}</div>
      <div class="webp-card-detail">
        <span>格式：${item.format}</span>
        <span>尺寸：${item.width} × ${item.height} px</span>
        <span>大小：${humanSize(item.webpBlob ? item.webpBlob.size : item.size)}</span>
        ${item.webpBlob ? '<span class="webp-card-converted">✅ 已轉 WebP</span>' : ''}
      </div>
    `;

    /* 操作按鈕列 */
    const actions = document.createElement('div');
    actions.className = 'webp-card-actions';

    if (item.webpUrl) {
      const dlBtn = document.createElement('a');
      dlBtn.className = 'btn btn-sm btn-success';
      dlBtn.href = item.webpUrl;
      dlBtn.download = `${outName}.webp`;
      dlBtn.textContent = '⬇ 下載 WebP';
      actions.appendChild(dlBtn);
    }

    const rmBtn = document.createElement('button');
    rmBtn.className = 'btn btn-sm btn-outline webp-remove-btn';
    rmBtn.textContent = '✕ 移除';
    rmBtn.addEventListener('click', () => this._removeItem(item.id));
    actions.appendChild(rmBtn);

    card.appendChild(imgWrap);
    card.appendChild(info);
    card.appendChild(actions);
    return card;
  }
}
