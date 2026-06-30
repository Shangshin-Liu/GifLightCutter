/**
 * Exporter – 使用 ffmpeg.wasm 匯出動態 WebP / GIF
 *
 * 所有 ffmpeg.wasm 模組已預先安裝於 vendor/ffmpeg/，不需要連線 CDN
 * 伺服器仍送出 COOP/COEP 標頭以確保 SharedArrayBuffer 可用
 */

// 本地 vendor 路徑（由 node_modules 複製而來）
const FFMPEG_ESM = '/vendor/ffmpeg/ffmpeg/index.js';
const UTIL_ESM   = '/vendor/ffmpeg/util/index.js';
const CORE_JS    = '/vendor/ffmpeg/core/ffmpeg-core.js';
const CORE_WASM  = '/vendor/ffmpeg/core/ffmpeg-core.wasm';

export class Exporter {
  constructor() {
    this.ffmpeg    = null;
    this.fetchFile = null;
    this.state     = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
    this._inputLoaded = false;
  }

  get isReady() { return this.state === 'ready'; }

  /**
   * 載入 ffmpeg.wasm（只需呼叫一次）
   * @param {(msg:string)=>void} onStatus – 狀態訊息回呼
   * @param {(p:number)=>void}   onProgress – 0~1 進度回呼
   */
  async load(onStatus, onProgress) {
    if (this.state === 'ready') return;
    this.state = 'loading';
    onStatus?.('正在載入 ffmpeg.wasm 模組...');

    try {
      // 動態 import 本地 vendor 模組
      const ffmpegModule = await import(/* @vite-ignore */ FFMPEG_ESM);
      const utilModule   = await import(/* @vite-ignore */ UTIL_ESM);

      const { FFmpeg }  = ffmpegModule;
      this.fetchFile    = utilModule.fetchFile;

      this.ffmpeg = new FFmpeg();

      // 轉換 log 為 console（除錯用）
      this.ffmpeg.on('log', ({ message }) => {
        if (message) console.debug('[ffmpeg]', message);
      });

      // 轉換進度事件
      this.ffmpeg.on('progress', ({ progress }) => {
        onProgress?.(Math.min(progress, 1));
      });

      onStatus?.('正在初始化 ffmpeg-core.wasm（約 30 MB，首次較慢）...');

      // 直接用本地路徑，不需要 toBlobURL
      await this.ffmpeg.load({ coreURL: CORE_JS, wasmURL: CORE_WASM });
      this.state = 'ready';
      onStatus?.('ffmpeg.wasm 已就緒');
    } catch (err) {
      this.state = 'error';
      console.error('[Exporter] 載入失敗', err);
      throw err;
    }
  }

  /**
   * 批次匯出多個片段
   * @param {File}   videoFile  – 原始影片檔案
   * @param {Array}  segments   – [{ name, parts:[{in,out}] }, ...]
   * @param {Object} options    – { format:'webp'|'gif', width:480, fps:15, crop:{x,y,w,h}|null }
   * @param {(i:number, total:number, name:string)=>void} onSegStart
   * @param {(p:number)=>void} onSegProgress
   * @returns {Promise<Array<{name:string, data:Uint8Array}>>}
   */
  async exportAll(videoFile, segments, options, onSegStart, onSegProgress) {
    if (!this.isReady) throw new Error('ffmpeg 尚未載入');

    const { format = 'webp', width = 480, fps = 15 } = options;
    const results = [];

    // 把影片寫入 ffmpeg 虛擬檔案系統（只做一次）
    if (!this._inputLoaded) {
      const data = await this.fetchFile(videoFile);
      await this.ffmpeg.writeFile('src.mp4', data);
      this._inputLoaded = true;
    }

    for (let i = 0; i < segments.length; i++) {
      const seg  = segments[i];
      const name = `${seg.name}.${format}`;
      onSegStart?.(i + 1, segments.length, name);
      onSegProgress?.(0);

      try {
        // 每個片段使用自己的 crop（seg.crop），而非全域 crop
        const data = await this._exportOne(seg.parts, format, width, fps, i, onSegProgress, seg.crop || null);
        results.push({ name, data });
      } catch (err) {
        console.error(`[Exporter] 片段 ${seg.name} 失敗`, err);
        throw new Error(`片段 "${seg.name}" 匯出失敗：${err.message}`);
      }
    }

    return results;
  }

  /**
   * 清除已載入的影片（換片時呼叫）
   */
  async clearInput() {
    if (this._inputLoaded && this.ffmpeg) {
      try { await this.ffmpeg.deleteFile('src.mp4'); } catch (_) {}
      this._inputLoaded = false;
    }
  }

  /* ── 私有：匯出單一片段 ──────────────────────────────── */

  /** 組合 per-stream 的前置濾鏡字串（crop 放在 scale 之前） */
  _perStreamFilter(streamIdx, cropFilter, scaleFilter, fpsFilter) {
    const filters = [];
    if (cropFilter) filters.push(cropFilter);
    filters.push(scaleFilter, fpsFilter);
    return `[${streamIdx}:v]${filters.join(',')}`;
  }

  _buildWebpArgs(parts, scaleFilter, fpsFilter, out, crop) {
    const args = [];
    const n = parts.length;
    const cropFilter = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null;

    for (const p of parts) {
      args.push('-ss', String(p.in), '-to', String(p.out), '-i', 'src.mp4');
    }

    let filterComplex;
    if (n === 1) {
      filterComplex = `${this._perStreamFilter(0, cropFilter, scaleFilter, fpsFilter)}[out]`;
    } else {
      const perStream = parts.map((_, i) =>
        `${this._perStreamFilter(i, cropFilter, scaleFilter, fpsFilter)}[s${i}]`
      ).join(';');
      const concatInputs = parts.map((_, i) => `[s${i}]`).join('');
      filterComplex = `${perStream};${concatInputs}concat=n=${n}:v=1:a=0[out]`;
    }

    args.push(
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-vcodec', 'libwebp_anim',
      '-loop', '0',
      '-compression_level', '4',
      '-quality', '75',
      '-an',
      out
    );

    return args;
  }

  _buildGifArgs(parts, scaleFilter, fpsFilter, out, idx, crop) {
    const n = parts.length;
    const palette = `pal_${idx}.png`;
    const cropFilter = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null;

    // 組合 base filter（每個 stream 套用 crop+scale+fps，再 concat）
    const buildBase = () => {
      if (n === 1) {
        return `${this._perStreamFilter(0, cropFilter, scaleFilter, fpsFilter)}`;
      }
      const perStream = parts.map((_, i) =>
        `${this._perStreamFilter(i, cropFilter, scaleFilter, fpsFilter)}[s${i}]`
      ).join(';');
      const concatInputs = parts.map((_, i) => `[s${i}]`).join('');
      return `${perStream};${concatInputs}concat=n=${n}:v=1:a=0`;
    };

    // === Pass 1: palettegen ===
    const args1 = [];
    for (const p of parts) {
      args1.push('-ss', String(p.in), '-to', String(p.out), '-i', 'src.mp4');
    }
    args1.push(
      '-filter_complex', `${buildBase()}[base];[base]palettegen=max_colors=256:stats_mode=full[pal]`,
      '-map', '[pal]',
      '-y', palette
    );

    // === Pass 2: paletteuse ===
    const args2 = [];
    for (const p of parts) {
      args2.push('-ss', String(p.in), '-to', String(p.out), '-i', 'src.mp4');
    }
    args2.push('-i', palette);
    args2.push(
      '-filter_complex', `${buildBase()}[base];[base][${n}:v]paletteuse=dither=bayer:bayer_scale=5[out]`,
      '-map', '[out]',
      '-loop', '0',
      '-an',
      '-y', out
    );

    return { pass1: args1, pass2: args2 };
  }

  async _exportOne(parts, format, width, fps, idx, onProgress, crop = null) {
    const ff  = this.ffmpeg;
    const out = `out_${idx}.${format}`;

    const scaleFilter = `scale=${width}:-2:flags=lanczos`;
    const fpsFilter   = `fps=${fps}`;

    const progressHandler = ({ progress }) => onProgress?.(Math.min(progress, 1));
    ff.on('progress', progressHandler);

    try {
      if (format === 'webp') {
        const args = this._buildWebpArgs(parts, scaleFilter, fpsFilter, out, crop);
        await ff.exec(args);
      } else {
        // GIF two-pass
        const { pass1, pass2 } = this._buildGifArgs(parts, scaleFilter, fpsFilter, out, idx, crop);
        await ff.exec(pass1);
        onProgress?.(0.5);
        await ff.exec(pass2);
      }
    } finally {
      ff.off('progress', progressHandler);
    }

    const raw = await ff.readFile(out);
    await ff.deleteFile(out);

    if (format === 'gif') {
      try { await ff.deleteFile(`pal_${idx}.png`); } catch (_) {}
    }

    return new Uint8Array(raw);
  }
}
