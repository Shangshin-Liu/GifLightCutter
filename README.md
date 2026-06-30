# GifLightCutter

瀏覽器端影片分段切割工具，可將影片切成多個片段並匯出為動態 WebP 或 GIF 動圖。所有處理均在本機完成，檔案不會上傳至任何伺服器。

## 功能

- 拖曳或選擇本機影片檔案（MP4、WebM、MOV、MKV 等）
- 自訂時間軸，可逐格瀏覽或拖曳定位
- 以 I / O 鍵或拖曳控制桿標記片段起訖點
- 每個片段可獨立設定裁切範圍（框取）
- 支援片段合併（多段合為一個動圖）與拆開
- 點擊片段名稱可直接重命名
- 點擊「▶ 預覽」只在該片段的時間範圍內循環播放，並顯示對應裁切區域
- 批次匯出全部片段為動態 WebP（主要）或 GIF（備選）
- 可一次打包下載 ZIP 或逐一下載
- 輸出寬度與 FPS 可自訂；音訊自動排除（WebP / GIF 均不含聲音）

## 環境需求

| 工具 | 版本 |
|------|------|
| Node.js | 16 以上（僅用於本機靜態伺服器，無需安裝任何 npm 套件即可啟動） |
| 瀏覽器 | Chrome / Edge 推薦（需支援 WebAssembly 與 ES Modules） |

> ffmpeg.wasm 核心已預先安裝於 `vendor/ffmpeg/`，啟動後不需要網路連線即可使用。

## 安裝

```bash
# 1. 複製或下載專案
git clone <repository-url>
cd GifLightCutter

# 2. 安裝 vendor 依賴（已完成；若 vendor/ 目錄遺失才需重新執行）
npm install
node -e "
const fs = require('fs');
const nm = 'node_modules/@ffmpeg';
fs.mkdirSync('vendor/ffmpeg/ffmpeg', { recursive: true });
fs.mkdirSync('vendor/ffmpeg/util',   { recursive: true });
fs.mkdirSync('vendor/ffmpeg/core',   { recursive: true });
for (const f of fs.readdirSync(nm+'/ffmpeg/dist/esm').filter(f=>f.endsWith('.js')))
  fs.copyFileSync(nm+'/ffmpeg/dist/esm/'+f, 'vendor/ffmpeg/ffmpeg/'+f);
for (const f of fs.readdirSync(nm+'/util/dist/esm').filter(f=>f.endsWith('.js')))
  fs.copyFileSync(nm+'/util/dist/esm/'+f, 'vendor/ffmpeg/util/'+f);
fs.copyFileSync(nm+'/core/dist/esm/ffmpeg-core.js',   'vendor/ffmpeg/core/ffmpeg-core.js');
fs.copyFileSync(nm+'/core/dist/esm/ffmpeg-core.wasm', 'vendor/ffmpeg/core/ffmpeg-core.wasm');
console.log('vendor 複製完成');
"
```

## 啟動

```bash
node server.js
```

或在 Windows 上直接雙擊 `serve.bat`。

啟動後開啟瀏覽器前往：

```
http://localhost:8080
```

> 必須透過 HTTP 伺服器存取，不可直接開啟 `index.html`（ES Modules 與 WebAssembly 要求同源 HTTP 環境）。

## 使用方法

### 1. 載入影片

將影片拖曳至畫面，或點擊「選擇影片」。

### 2. 標記片段

| 操作 | 方式 |
|------|------|
| 設定起點 | 鍵盤 `I` 或點擊「I 起點」按鈕 |
| 設定終點 | 鍵盤 `O` 或點擊「O 終點」按鈕 |
| 加入片段 | `Enter` 或點擊「＋ 加入片段」 |
| 逐格前進／後退 | `→` / `←` |
| 跳 1 秒 | `Shift + →` / `Shift + ←` |
| 播放／暫停 | `Space` |

也可以直接在時間軸上拖曳 I / O 控制桿調整範圍。

### 3. 設定裁切範圍（選用）

- 點擊傳輸列的「⊡ 框取」或按 `C`，在影片上拖曳選取輸出範圍
- 此範圍會套用至下一個加入的片段
- 已加入的片段可在片段卡片底部點擊「⊡ 框取」單獨設定，互不影響

### 4. 管理片段

- **重命名**：直接點擊片段名稱，輸入後按 `Enter` 確認，`Escape` 取消
- **編輯時間**：點擊「✏ 時間」展開時間輸入框
- **預覽**：點擊「▶ 預覽」只播放該片段範圍，並顯示其裁切區域；`Escape` 停止預覽
- **合併**：勾選兩個以上片段後點擊「合併選取」，合併片段在匯出時會拼接為單一動圖
- **拆開**：合併片段可點擊「↩ 拆開」還原

### 5. 匯出

1. 點擊「載入」以初始化 ffmpeg.wasm（約 30 MB，首次略慢，之後不需重複載入）
2. 設定輸出格式（動態 WebP / GIF）、寬度、FPS、檔名前綴
3. 點擊「批次匯出全部」
4. 完成後選擇「下載全部 ZIP」或「逐一下載」

## 專案結構

```
GifLightCutter/
├── index.html          # 主頁面（單頁應用）
├── server.js           # Node.js 靜態伺服器（含 COOP/COEP 標頭）
├── serve.bat           # Windows 快速啟動腳本
├── package.json
├── css/
│   └── style.css       # 深色主題樣式
├── js/
│   ├── app.js          # 主應用程式邏輯
│   ├── timeline.js     # 時間軸元件
│   └── exporter.js     # ffmpeg.wasm 匯出邏輯
└── vendor/
    └── ffmpeg/
        ├── ffmpeg/     # @ffmpeg/ffmpeg ESM 模組
        ├── util/       # @ffmpeg/util ESM 模組
        └── core/       # ffmpeg-core.js + ffmpeg-core.wasm（~31 MB）
```

## 技術細節

- **無建置步驟**：純 HTML + CSS + ES Modules，不需要 Webpack / Vite
- **ffmpeg.wasm**：使用 `@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/core@0.12.10`，在 Web Worker 中執行，不阻塞 UI
- **COOP / COEP**：`server.js` 送出 `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: require-corp` 標頭以啟用 SharedArrayBuffer
- **輸出格式**：動態 WebP 使用 `libwebp_anim` 編碼；GIF 採兩階段處理（`palettegen` → `paletteuse`）以提升色彩品質
- **音訊**：WebP 與 GIF 均不含音訊（`-an` 旗標），無需額外處理音軌

## 授權

MIT
