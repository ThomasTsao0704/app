// ══════════════════════════════════════════
//  PDF.js Worker Config
// ══════════════════════════════════════════
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; // 設定 PDF.js 背景執行緒的來源路徑
}

// ══════════════════════════════════════════
//  State
// ══════════════════════════════════════════
let currentMode = 'finance'; // 目前選擇的分析模式，預設為財報模式
let currentFile = null; // 目前載入的 PDF 檔案，未選擇時為 null
let analysisHistory = JSON.parse(localStorage.getItem('pdfHistory') || '[]'); // 從 localStorage 讀取歷史分析紀錄
let currentIndustry = null; // 目前選擇的產業模板，null 為一般模式
let models         = loadConfig('models', []);  // 模型資產列表
let activeModelId  = null;                       // 目前啟用的模型 ID
let editingModelId = null;                       // 目前正在編輯的模型 ID

// ══════════════════════════════════════════
//  Default Config — Keywords (V4.2)
// ══════════════════════════════════════════
const defaultKeywords = {
  finance: { // 財報分析模式關鍵字（V4 物件權重）
    growth: [
      { word: '營收',   weight: 5 },
      { word: '成長',   weight: 5 },
      { word: '創新高', weight: 10 },
      { word: '年增',   weight: 6 },
      { word: '毛利率', weight: 6 },
      { word: 'EPS',    weight: 5 },
      { word: '獲利',   weight: 5 },
      { word: '每股盈餘', weight: 6 }
    ],
    risk: [
      { word: '衰退', weight: -8 },
      { word: '虧損', weight: -10 },
      { word: '負債', weight: -7 },
      { word: '下滑', weight: -6 },
      { word: '壓力', weight: -5 },
      { word: '挑戰', weight: -4 }
    ]
  },
  news: { // 新聞解讀模式關鍵字（V4 物件權重）
    growth: [
      { word: '成長', weight: 6 },
      { word: '趨勢', weight: 5 },
      { word: '突破', weight: 8 },
      { word: '創新', weight: 7 },
      { word: '轉型', weight: 6 },
      { word: '擴張', weight: 7 }
    ],
    risk: [
      { word: '風險', weight: -6 },
      { word: '危機', weight: -9 },
      { word: '衝突', weight: -7 },
      { word: '下滑', weight: -6 },
      { word: '衰退', weight: -8 }
    ]
  },
  study: { // 學習摘要模式關鍵字（V4 物件權重）
    growth: [
      { word: '定義', weight: 7 },
      { word: '結論', weight: 8 },
      { word: '重點', weight: 6 },
      { word: '原理', weight: 7 },
      { word: '優點', weight: 5 },
      { word: '應用', weight: 6 }
    ],
    risk: [
      { word: '缺點', weight: -5 },
      { word: '限制', weight: -6 },
      { word: '問題', weight: -5 },
      { word: '困難', weight: -6 },
      { word: '爭議', weight: -7 }
    ]
  }
};

// ══════════════════════════════════════════
//  Semantic Modifiers (V4)
// ══════════════════════════════════════════
const semanticModifiers = {
  negation: ['未','不','沒有','趨緩','放緩','轉弱','減少'], // 否定詞，命中時反轉並削弱權重
  strong:   ['大幅','顯著','強勁','明顯','創新高'],          // 強度加乘詞
  weak:     ['小幅','略為','溫和','保守'],                   // 強度削減詞
  cause:    ['因','由於','受惠於','帶動','導致']              // 因果加權詞
};

// ══════════════════════════════════════════
//  Default Config — Industries (V4.2)
// ══════════════════════════════════════════
const defaultIndustries = {
  semiconductor: {
    name: '半導體',
    focus:       ['先進製程','晶圓','產能利用率','良率','AI晶片','HPC'],
    growthBoost: ['擴產','接單滿載','漲價'],
    riskBoost:   ['庫存調整','需求疲弱','去化庫存'],
    kpi:         ['毛利率','資本支出','產能利用率'],
    paragraphBias: { intro: 1.2, body: 1.0, conclusion: 1.5 }
  },
  finance: {
    name: '金融',
    focus:       ['淨利差','放款成長','資本適足率','呆帳','手續費收入'],
    growthBoost: ['升息受惠','利差擴大'],
    riskBoost:   ['呆帳增加','信用風險'],
    kpi:         ['ROE','淨利差','放款餘額'],
    paragraphBias: { intro: 1.1, body: 1.0, conclusion: 1.4 }
  },
  ai: {
    name: 'AI產業',
    focus:       ['模型','算力','GPU','推論','資料中心'],
    growthBoost: ['大單','合作','佈局','導入'],
    riskBoost:   ['算力瓶頸','監管','成本壓力'],
    kpi:         ['毛利率','營收成長率','資本支出'],
    paragraphBias: { intro: 1.3, body: 1.0, conclusion: 1.6 }
  }
};

// ══════════════════════════════════════════
//  Config Loader (V4.2)
// ══════════════════════════════════════════
function loadConfig(key, fallback) { // 從 localStorage 載入設定，無紀錄則使用預設值
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : fallback;
}

let keywordLibrary    = loadConfig('keywords',   defaultKeywords);   // 關鍵字庫（可熱覆寫）
let industryTemplates = loadConfig('industries', defaultIndustries); // 產業模板（可熱覆寫）

const modeDescriptions = { // 各模式的說明文字，顯示在介面上
  finance: '💹 財報分析模式：偵測營收、EPS、毛利率、成長訊號與風險因子',
  news:    '📰 新聞解讀模式：提取政策趨勢、市場動向與風險訊號',
  study:   '📚 學習摘要模式：識別定義、結論、重點與比較分析'
};

// ══════════════════════════════════════════
//  UI Helpers
// ══════════════════════════════════════════
function setStatus(msg, active=false) { // 更新底部狀態列文字與閃爍點狀態
  document.getElementById('statusMsg').textContent = msg; // 設定狀態文字
  document.getElementById('statusDot').className = 'status-dot' + (active ? ' active' : ''); // 切換閃爍動畫
}

function setProgress(pct) { // 更新頂部進度條寬度百分比
  document.getElementById('progressFill').style.width = pct + '%';
}

function setMode(mode, el) { // 切換分析模式並更新按鈕選取狀態
  currentMode = mode; // 更新全域模式變數
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active')); // 移除所有按鈕的選取樣式
  el.classList.add('active'); // 為點擊的按鈕加上選取樣式
  document.getElementById('modeDesc').textContent = modeDescriptions[mode]; // 更新模式說明文字

  // 清除舊模式的分析結果，避免認知錯亂
  document.getElementById('summaryContent').innerHTML =
    '<div class="empty-state"><span>🔄</span>模式已切換，請重新生成摘要</div>';
  document.getElementById('scoreContent').innerHTML =
    '<div class="empty-state"><span>🎯</span>點擊「產生評分報告」後顯示結果</div>';
  document.getElementById('summaryLabel').textContent = '';
}

function setIndustry(val) { // 切換產業模板，空值代表一般模式
  currentIndustry = val || null; // 儲存選擇的產業至全域變數
}

function handleFileSelect(e) { // 處理使用者選擇 PDF 檔案的事件
  const file = e.target.files[0]; // 取得選擇的第一個檔案
  if (!file) return; // 若未選擇則直接返回
  currentFile = file; // 儲存檔案至全域變數
  document.getElementById('fileName').textContent = file.name; // 顯示檔案名稱
  document.getElementById('fileSize').textContent = (file.size / 1024).toFixed(0) + ' KB'; // 顯示檔案大小（轉為 KB）
  document.getElementById('fileInfo').classList.add('show'); // 顯示檔案資訊列
  document.getElementById('btnExtract').disabled = false; // 啟用「解析 PDF」按鈕
  setStatus('檔案已載入：' + file.name); // 更新狀態列訊息

  // 更新上傳區域的視覺回饋
  const zone = document.getElementById('uploadZone');
  zone.querySelector('.upload-icon').textContent = '✅'; // 圖示改為勾選
  zone.querySelector('.upload-text').textContent = file.name; // 顯示檔案名稱
  zone.querySelector('.upload-hint').textContent = '點擊可重新選擇檔案'; // 提示文字更新
}

// 拖曳上傳事件監聽
const zone = document.getElementById('uploadZone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); }); // 拖曳進入時加上高亮樣式
zone.addEventListener('dragleave', () => zone.classList.remove('dragover')); // 拖曳離開時移除高亮樣式
zone.addEventListener('drop', e => { // 放下檔案時處理
  e.preventDefault(); zone.classList.remove('dragover'); // 取消預設行為並移除高亮
  const files = e.dataTransfer.files; // 取得拖曳的檔案列表
  if (files.length && files[0].type === 'application/pdf') { // 確認是 PDF 檔案
    document.getElementById('pdfUpload').files = files; // 同步至 file input
    handleFileSelect({ target: { files } }); // 呼叫檔案選擇處理函式
  }
});

// ══════════════════════════════════════════
//  PDF Extraction
// ══════════════════════════════════════════
async function extractPDF() { // 讀取並解析 PDF 檔案的所有頁面文字
  if (!currentFile) return; // 若無檔案則返回
  setStatus('正在解析 PDF...', true); // 更新狀態為解析中
  setProgress(5); // 進度條初始推進
  document.getElementById('btnExtract').disabled = true; // 解析期間停用按鈕避免重複點擊

  const reader = new FileReader(); // 建立檔案讀取器
  reader.onload = async function () {
    try {
      const typedarray = new Uint8Array(this.result); // 將檔案轉為二進位陣列
      const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise; // 使用 PDF.js 載入文件

      let fullText = ''; // 累積所有頁面的文字
      const total     = pdf.numPages; // 取得總頁數
      const startTime = Date.now();   // 記錄開始時間，用於 ETA 計算

      for (let i = 1; i <= total; i++) { // 逐頁擷取文字
        const page    = await pdf.getPage(i); // 取得第 i 頁
        const content = await page.getTextContent(); // 取得該頁的文字內容

        // 依 transform 矩陣的 Y 座標排序（降序=從上到下），同行依 X 升序（從左到右）
        const sorted = [...content.items].sort((a, b) => {
          const dy = b.transform[5] - a.transform[5];
          return Math.abs(dy) > 3 ? dy : a.transform[4] - b.transform[4];
        });

        // 依 Y 分組為行，避免欄位式排版錯亂與多餘空白
        let lastY = null, lineBuf = [], pageLines = [];
        sorted.forEach(item => {
          const y = item.transform[5];
          if (lastY === null || Math.abs(y - lastY) > 3) {
            if (lineBuf.length) pageLines.push(lineBuf.join(''));
            lineBuf = [item.str];
            lastY   = y;
          } else {
            lineBuf.push(item.str);
          }
        });
        if (lineBuf.length) pageLines.push(lineBuf.join(''));
        fullText += pageLines.join('\n') + '\n';

        setProgress(Math.round((i / total) * 90)); // 更新進度條（最多到 90%）
        const elapsed   = (Date.now() - startTime) / 1000;
        const remaining = i < total ? Math.round((elapsed / i) * (total - i)) : 0;
        const etaStr    = remaining > 0 ? ` · 預計還需 ${remaining} 秒` : '';
        setStatus(`解析第 ${i} / ${total} 頁...${etaStr}`, true); // 更新狀態列頁數
      }

      const cleaned = cleanText(fullText); // 清理多餘空白與換行
      document.getElementById('rawText').value = cleaned; // 顯示清理後的文字

      const sentences = splitSentences(cleaned); // 切分為句子列表
      document.getElementById('statPages').textContent = total; // 顯示總頁數
      document.getElementById('statChars').textContent = formatNum(cleaned.length); // 顯示總字數
      document.getElementById('statSents').textContent = sentences.length; // 顯示總句數
      document.getElementById('rawLabel').textContent = `${total}頁 · ${formatNum(cleaned.length)}字`; // 更新標籤

      setProgress(100); // 進度條設為完成
      setStatus(`解析完成 · ${total} 頁 · ${sentences.length} 句`, false); // 顯示完成訊息
      document.getElementById('btnSummary').disabled = false; // 啟用「生成摘要」按鈕
      document.getElementById('btnScore').disabled   = false; // 同步啟用「產生評分報告」
      document.getElementById('btnExtract').disabled = false; // 重新啟用「解析 PDF」按鈕
      setTimeout(() => setProgress(0), 1500); // 1.5 秒後隱藏進度條
    } catch (err) {
      setStatus('❌ 解析失敗：' + err.message); // 顯示錯誤訊息
      setProgress(0); // 重設進度條
      document.getElementById('btnExtract').disabled = false; // 恢復按鈕可用
    }
  };
  reader.readAsArrayBuffer(currentFile); // 開始讀取檔案為 ArrayBuffer
}

// ══════════════════════════════════════════
//  Text Cleaning
// ══════════════════════════════════════════
function cleanText(text) { // 清理 PDF 擷取文字中的多餘空白與換行
  return text
    .replace(/\s{3,}/g, ' ')   // 三個以上連續空白合併為一個
    .replace(/\n{3,}/g, '\n\n') // 三個以上連續換行合併為兩個
    .replace(/[^\S\n]+/g, ' ')  // 非換行的空白字元統一為單一空格
    .trim(); // 去除頭尾空白
}

function splitSentences(text) { // 依標點符號切分文字為句子陣列
  return text.split(/[。！？\.!?]/) // 以中英文句號、驚嘆號、問號切割
    .map(s => s.trim()) // 去除每句前後空白
    .filter(s => s.length > 5); // 過濾掉長度 5 以下的短句
}

// ══════════════════════════════════════════
//  Industry Boost Engine (V4.1)
// ══════════════════════════════════════════
function applyIndustryBoost(sentence, score) { // 依產業模板對句子分數進行強化
  if (!currentIndustry) return score; // 未選產業則直接返回原分

  const tpl = industryTemplates[currentIndustry];

  tpl.focus.forEach(word => { // 產業關注詞：命中時分數乘以 1.2
    if (sentence.includes(word)) score *= 1.2;
  });

  tpl.growthBoost.forEach(word => { // 成長強化詞：命中時加 5 分
    if (sentence.includes(word)) score += 5;
  });

  tpl.riskBoost.forEach(word => { // 風險強化詞：命中時扣 5 分
    if (sentence.includes(word)) score -= 5;
  });

  return score;
}

function getParagraphWeight(index, total) { // 依段落位置取得產業偏重係數
  if (!currentIndustry) return 1; // 未選產業時所有段落權重相同

  const tpl = industryTemplates[currentIndustry];

  if (index === 0)         return tpl.paragraphBias.intro;      // 首段（引言）
  if (index === total - 1) return tpl.paragraphBias.conclusion;  // 末段（結論）
  return tpl.paragraphBias.body;                                 // 中間段落
}

// ══════════════════════════════════════════
//  Semantic Score Engine (V4)
// ══════════════════════════════════════════
function semanticScore(sentence, mode) { // 依語意修飾詞與物件權重計算句子分數
  const lib = keywordLibrary[mode];
  let score = 0;

  const hasNegation = semanticModifiers.negation.some(n => sentence.includes(n)); // 否定詞偵測
  const hasStrong   = semanticModifiers.strong.some(n => sentence.includes(n));   // 強度加乘詞偵測
  const hasWeak     = semanticModifiers.weak.some(n => sentence.includes(n));     // 強度削減詞偵測
  const hasCause    = semanticModifiers.cause.some(n => sentence.includes(n));    // 因果詞偵測

  const applyWeight = (item) => {
    let w = item.weight;
    if (hasNegation) w *= -0.7; // 否定詞反轉並削弱權重
    if (hasStrong)   w *= 1.5;  // 強調詞加乘 1.5 倍
    if (hasWeak)     w *= 0.7;  // 削弱詞縮減為 0.7 倍
    if (hasCause)    w *= 1.2;  // 因果詞額外加乘 1.2 倍
    score += w;
  };

  lib.growth.forEach(item => { if (sentence.includes(item.word)) applyWeight(item); }); // 成長關鍵字加分
  lib.risk.forEach(item =>   { if (sentence.includes(item.word)) applyWeight(item); }); // 風險關鍵字扣分

  // 數字加權（數據豐富度）
  const numCount = (sentence.match(/\d+[\.,\d]*/g) || []).length;
  score += Math.min(numCount * 1.5, 6); // 每個數字加 1.5 分，最多加 6 分

  score = applyIndustryBoost(sentence, score); // 套用產業模板加權（V4.1）

  // Active model integration (V4.3)
  const activeModel = getActiveModel();
  if (activeModel) {
    activeModel.keywords.growth.forEach(item => {
      if (sentence.includes(item.word)) score += item.weight; // 模型成長關鍵字加分
    });
    activeModel.keywords.risk.forEach(item => {
      if (sentence.includes(item.word)) score += item.weight; // 模型風險關鍵字扣分
    });
    if (score > 0) score *= activeModel.weights.growthMultiplier; // 正分套用成長乘數
    else if (score < 0) score *= activeModel.weights.riskMultiplier; // 負分套用風險乘數
  }

  return parseFloat(score.toFixed(2));
}

// ══════════════════════════════════════════
//  Weighted Summary Engine (V4)
// ══════════════════════════════════════════
function generateSummary() { // 依關鍵字權重對句子評分並產生分類摘要
  const text = document.getElementById('rawText').value; // 取得原始文字
  if (!text.trim()) { alert('請先解析 PDF 文字'); return; } // 若無文字則提示

  const lib = keywordLibrary[currentMode]; // 取得當前模式的關鍵字庫
  const sentences = splitSentences(text); // 切分為句子
  let scored = []; // 儲存各句子的評分結果

  sentences.forEach(s => {
    if (s.length < 8) return; // 過短的句子跳過不評分
    let score = semanticScore(s, currentMode); // V4 語意加權評分

    // 判斷句子所屬類別
    const isGrowth = lib.growth.some(item => s.includes(item.word)); // 是否含成長關鍵字
    const isRisk   = lib.risk.some(item => s.includes(item.word));   // 是否含風險關鍵字

    scored.push({ text: s, score: parseFloat(score.toFixed(1)), isGrowth, isRisk }); // 加入評分結果
  });

  scored.sort((a, b) => b.score - a.score); // 依分數由高到低排序

  const getTop = (filter, n) => { // 取得指定類別的前 n 名句子（去除相似句）
    const filtered = filter ? scored.filter(filter) : scored;
    const seen = new Set(); // 用於去重的集合
    return filtered.filter(s => {
      const key = s.text.slice(0, 20); // 取前 20 字作為相似度判斷依據
      if (seen.has(key)) return false; // 已出現過則略過
      seen.add(key); return true;
    }).slice(0, n); // 只取前 n 筆
  };

  const growthItems = getTop(s => s.isGrowth, 3); // 取成長類前 3 句
  const riskItems   = getTop(s => s.isRisk, 3);   // 取風險類前 3 句
  const dataItems   = getTop(s => /\d+/.test(s.text), 3); // 取含數字的前 3 句

  const renderItems = (items, cls) => { // 將句子陣列渲染為 HTML 卡片
    if (!items.length) return '<div style="font-size:12px;color:var(--text-dim);padding:8px">無相關句子</div>'; // 無結果時顯示提示
    return items.map(s => `
      <div class="summary-item ${cls}">
        <span class="item-score">${s.score}</span>
        ${escapeHtml(s.text)}
      </div>
    `).join('');
  };

  document.getElementById('summaryContent').innerHTML = ` // 將三類摘要渲染至畫面
    <div class="summary-section">
      <div class="summary-block">
        <div class="summary-block-title" style="color:var(--green)">
          📈 成長重點
        </div>
        ${renderItems(growthItems, 'item-growth')}
      </div>
      <hr class="divider">
      <div class="summary-block" style="margin-top:14px">
        <div class="summary-block-title" style="color:var(--red)">
          ⚠️ 風險因素
        </div>
        ${renderItems(riskItems, 'item-risk')}
      </div>
      <hr class="divider">
      <div class="summary-block" style="margin-top:14px">
        <div class="summary-block-title" style="color:var(--accent)">
          📊 數據重點
        </div>
        ${renderItems(dataItems, 'item-data')}
      </div>
    </div>
  `;

  document.getElementById('summaryLabel').textContent =
    `共 ${growthItems.length + riskItems.length + dataItems.length} 句`; // 顯示摘要句子總數
  document.getElementById('btnScore').disabled = false; // 啟用「產生評分報告」按鈕
  setStatus('摘要生成完成'); // 更新狀態列
}

// ══════════════════════════════════════════
//  Scoring Engine (V4.1 — industry-aware)
// ══════════════════════════════════════════
function kpiScore(text) { // 依產業 KPI 關鍵詞驗證文件完整度並給予加分
  if (!currentIndustry) return 0; // 未選產業時不加分

  const tpl = industryTemplates[currentIndustry];
  let count = 0;

  tpl.kpi.forEach(k => {
    if (text.includes(k)) count++; // 計算命中的 KPI 項目數量
  });

  return count * 4; // 每個 KPI 加 4 分
}

function generateScore() { // 依摘要與原文計算綜合評分並顯示圓形儀表板
  const summaryText = document.getElementById('summaryContent').innerText || ''; // 取得摘要區域的純文字
  const rawText = document.getElementById('rawText').value || ''; // 取得原始文字
  if (!rawText.trim()) { // 改為檢查原文，允許跳過摘要直接評分
    alert('請先解析 PDF 文字');
    return;
  }

  const lib = keywordLibrary[currentMode]; // 取得當前模式關鍵字庫
  let breakdown = { growth: 0, risk: 0, data: 0 }; // 各項分數明細

  // V4 非線性比例評分模型
  const allSentences = splitSentences(rawText);
  let total = 0;

  allSentences.forEach(s => {
    const sc = semanticScore(s, currentMode); // 對每句執行語意評分
    total += sc;
    if (lib.growth.some(item => s.includes(item.word))) breakdown.growth += Math.max(0, sc); // 累計成長分數
    if (lib.risk.some(item => s.includes(item.word)))   breakdown.risk   += Math.min(0, sc); // 累計風險分數
  });

  // 數據豐富度加分
  const numCount = (rawText.match(/\d+[\.,\d]*/g) || []).length; // 統計原文中數字出現次數
  breakdown.data = Math.min(numCount / 20, 10); // 每 20 個數字加 1 分，最多加 10 分

  let normalized = 50 + (total / allSentences.length); // 以平均語意分數正規化至 50 基準
  let finalScore = Math.max(0, Math.min(100, Math.round(normalized))); // 初始分數
  finalScore += kpiScore(rawText); // 加入產業 KPI 驗證加分（V4.1）
  finalScore = Math.min(100, finalScore); // 最終分數限制在 100 以內

  // 依分數決定等級文字與顏色
  let level, levelColor;
  if (finalScore >= 75) { level = '偏強 ↑';   levelColor = 'var(--green)'; }
  else if (finalScore >= 55) { level = '中性 →'; levelColor = 'var(--accent)'; }
  else if (finalScore >= 40) { level = '中性偏弱'; levelColor = 'var(--yellow)'; }
  else                       { level = '偏弱 ↓';  levelColor = 'var(--red)'; }

  const gaugeColor = finalScore >= 70 ? 'var(--green)' : finalScore >= 45 ? 'var(--accent)' : 'var(--red)'; // 儀表板顏色
  const circ = 2 * Math.PI * 44; // 圓形進度條的總周長（半徑 44）
  const offset = circ * (1 - finalScore / 100); // 計算 stroke-dashoffset 對應的缺口長度

  const gMax = Math.min(100, breakdown.growth); // 成長分數上限 100
  const rVal = Math.abs(Math.max(-50, breakdown.risk)); // 風險扣分取絕對值，最大 50
  const dVal = Math.min(30, breakdown.data); // 數據分數上限 30

  document.getElementById('scoreContent').innerHTML = ` // 渲染評分報告的 HTML 結構
    <div class="score-body">
      <div class="score-gauge">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle class="track" cx="55" cy="55" r="44"/>
          <circle class="progress" cx="55" cy="55" r="44"
            stroke="${gaugeColor}"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${circ}"
            id="gaugeProgress"
          />
        </svg>
        <div class="score-number" style="color:${gaugeColor}">
          <div id="scoreNum">0</div>
          <div class="score-unit">分</div>
        </div>
      </div>

      <div class="score-details">
        <div class="score-level" style="color:${levelColor}">${level}</div>
        <div class="score-breakdown">
          <div class="score-row">
            <span class="label" style="color:var(--green)">成長加分</span>
            <div class="bar-track"><div class="bar-fill" style="width:0%;background:var(--green)" data-target="${Math.min(100,gMax)}%"></div></div>
            <span class="val" style="color:var(--green)">+${Math.round(gMax)}</span>
          </div>
          <div class="score-row">
            <span class="label" style="color:var(--red)">風險扣分</span>
            <div class="bar-track"><div class="bar-fill" style="width:0%;background:var(--red)" data-target="${Math.min(100,rVal*2)}%"></div></div>
            <span class="val" style="color:var(--red)">-${Math.round(rVal)}</span>
          </div>
          <div class="score-row">
            <span class="label" style="color:var(--accent)">數據豐富度</span>
            <div class="bar-track"><div class="bar-fill" style="width:0%;background:var(--accent)" data-target="${Math.min(100,dVal*5)}%"></div></div>
            <span class="val" style="color:var(--accent)">+${Math.round(dVal)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // 執行數字與進度條的動畫效果
  setTimeout(() => {
    document.getElementById('gaugeProgress').style.strokeDashoffset = offset; // 觸發圓形進度條動畫
    let n = 0;
    const timer = setInterval(() => { // 數字從 0 遞增至最終分數
      n = Math.min(finalScore, n + 2);
      document.getElementById('scoreNum').textContent = n;
      if (n >= finalScore) clearInterval(timer); // 達到目標分數後停止計時器
    }, 20);

    document.querySelectorAll('.bar-fill[data-target]').forEach(el => {
      setTimeout(() => { el.style.width = el.dataset.target; }, 200); // 延遲 200ms 後展開長條圖
    });
  }, 50);

  // 儲存本次評分至歷史紀錄
  saveHistory(currentFile?.name || 'Unknown', finalScore, currentMode);
  setStatus('評分完成 · 綜合分數：' + finalScore); // 更新狀態列
}

// ══════════════════════════════════════════
//  History
// ══════════════════════════════════════════
function saveHistory(name, score, mode) { // 將評分結果存入 localStorage 歷史紀錄
  const item = {
    name:  name.replace('.pdf',''), // 移除副檔名
    score,
    mode,
    time:  new Date().toISOString(), // 完整 ISO 日期，跨日後仍可辨識
    pages: parseInt(document.getElementById('statPages').textContent) || 0,
    chars: document.getElementById('statChars').textContent || '—',
  };
  analysisHistory.unshift(item); // 插入至陣列最前端（最新在上）
  if (analysisHistory.length > 10) analysisHistory.pop(); // 超過 10 筆時移除最舊的一筆
  localStorage.setItem('pdfHistory', JSON.stringify(analysisHistory)); // 儲存至 localStorage
  renderHistory(); // 重新渲染歷史列表
}

function renderHistory() { // 將歷史紀錄渲染至畫面的歷史面板
  const list = document.getElementById('historyList');
  const panel = document.getElementById('historyPanel');
  if (!analysisHistory.length) { panel.style.display = 'none'; return; } // 無紀錄時隱藏面板
  panel.style.display = 'block'; // 有紀錄時顯示面板

  const modeEmoji  = { finance:'📊', news:'📰', study:'📚' }; // 各模式對應的 emoji
  const scoreColor = s => s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--accent)' : 'var(--red)'; // 依分數決定顏色
  const fmtTime = t => { // 將 ISO 日期格式化為 MM/DD HH:mm，相容舊格式
    const d = new Date(t);
    if (isNaN(d)) return t;
    return [d.getMonth()+1, d.getDate()].map(n => String(n).padStart(2,'0')).join('/') +
           ' ' + [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2,'0')).join(':');
  };

  list.innerHTML = analysisHistory.map(h => ` // 渲染每一筆歷史紀錄卡片
    <div class="history-item">
      <span>${modeEmoji[h.mode] || '📄'}</span>
      <span class="h-name">${escapeHtml(h.name)}</span>
      <span class="h-mode">${h.mode}</span>
      <span class="h-score" style="color:${scoreColor(h.score)}">${h.score}</span>
      <span class="h-time">${fmtTime(h.time)}</span>
    </div>
  `).join('');
}

function clearHistory() { // 清除所有歷史紀錄
  analysisHistory = []; // 清空陣列
  localStorage.removeItem('pdfHistory'); // 從 localStorage 刪除
  renderHistory(); // 重新渲染（會隱藏面板）
}

// ══════════════════════════════════════════
//  Clear All
// ══════════════════════════════════════════
function clearAll() { // 重設所有畫面狀態回初始值
  document.getElementById('rawText').value = ''; // 清空原始文字區
  document.getElementById('summaryContent').innerHTML = '<div class="empty-state"><span>🧠</span>點擊「生成加權摘要」後顯示結果</div>'; // 重設摘要區
  document.getElementById('scoreContent').innerHTML = '<div class="empty-state"><span>🎯</span>點擊「產生評分報告」後顯示結果</div>'; // 重設評分區
  document.getElementById('statPages').textContent = '—'; // 清除頁數統計
  document.getElementById('statChars').textContent = '—'; // 清除字數統計
  document.getElementById('statSents').textContent = '—'; // 清除句數統計
  document.getElementById('rawLabel').textContent = ''; // 清除原始文字標籤
  document.getElementById('summaryLabel').textContent = ''; // 清除摘要標籤
  document.getElementById('fileInfo').classList.remove('show'); // 隱藏檔案資訊列
  document.getElementById('btnExtract').disabled = true; // 停用「解析 PDF」按鈕
  document.getElementById('btnSummary').disabled = true; // 停用「生成摘要」按鈕
  document.getElementById('btnScore').disabled = true; // 停用「產生評分報告」按鈕
  currentFile = null; // 清除目前檔案

  // 重設上傳區域的顯示內容
  const zone = document.getElementById('uploadZone');
  zone.querySelector('.upload-icon').textContent = '📂'; // 還原圖示
  zone.querySelector('.upload-text').textContent = '點擊或拖曳 PDF 至此'; // 還原提示文字
  zone.querySelector('.upload-hint').textContent = '僅限 .pdf 格式 · 完全離線處理'; // 還原輔助說明
  zone.classList.remove('dragover'); // 移除拖曳高亮樣式

  setStatus('等待輸入 PDF...'); // 重設狀態列文字
  setProgress(0); // 重設進度條
}

// ══════════════════════════════════════════
//  Utils
// ══════════════════════════════════════════
function escapeHtml(str) { // 將字串中的 HTML 特殊字元轉為實體，防止 XSS
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatNum(n) { // 將大數字格式化為易讀形式（超過 1000 顯示為 xK）
  return n >= 1000 ? (n/1000).toFixed(1) + 'K' : String(n);
}

// ══════════════════════════════════════════
//  Model Asset System (V4.3)
// ══════════════════════════════════════════
function saveModels() { // 將模型列表序列化後存入 localStorage
  localStorage.setItem('models', JSON.stringify(models));
}

function getActiveModel() { // 取得目前啟用的模型物件
  return models.find(m => m.id === activeModelId) || null;
}

function createModel() { // 新增空白模型並切換至編輯狀態
  const m = {
    id: 'model_' + Date.now(),
    name: '新模型',
    industry: '',
    description: '',
    weights: { growthMultiplier: 1.0, riskMultiplier: 1.0, tfBoost: 6, paragraphIntro: 1.2, paragraphConclusion: 1.5 },
    keywords: { growth: [], risk: [] }
  };
  models.push(m);
  saveModels();
  renderModelList();
  editModel(m.id);
}

function duplicateModel(id) { // 複製指定模型並切換至新複本的編輯狀態
  const src = models.find(m => m.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id   = 'model_' + Date.now();
  copy.name = src.name + ' (複製)';
  models.push(copy);
  saveModels();
  renderModelList();
  editModel(copy.id);
}

function deleteModel(id) { // 刪除指定模型，並清除相關啟用與編輯狀態
  if (!confirm('確定刪除此模型？')) return;
  models = models.filter(m => m.id !== id);
  if (activeModelId  === id) activeModelId  = null;
  if (editingModelId === id) {
    editingModelId = null;
    document.getElementById('modelEditor').innerHTML =
      '<div style="text-align:center;color:var(--text-dim);padding:80px 20px;font-size:13px">選擇左側模型開始編輯</div>';
  }
  saveModels();
  renderModelList();
}

function activateModel(id) { // 切換啟用狀態，再次點擊取消
  activeModelId = (activeModelId === id) ? null : id;
  renderModelList();
  const active = getActiveModel();
  setStatus(active ? '模型已啟用：' + active.name : '已停用自訂模型，回到標準引擎');
}

function renderModelList() { // 渲染左側模型卡片列表
  const container = document.getElementById('modelList');
  if (!container) return;
  if (!models.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:12px;padding:20px 0">尚無模型，點擊上方新增</div>';
    return;
  }
  container.innerHTML = models.map(m => {
    const isActive  = m.id === activeModelId;
    const isEditing = m.id === editingModelId;
    return `
      <div style="padding:12px;background:${isEditing ? 'var(--accent-glow)' : 'var(--bg-card)'};border:1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'};border-radius:8px;cursor:pointer;transition:all 0.15s;margin-bottom:8px" onclick="editModel('${m.id}')">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${isActive ? 'var(--green)' : 'var(--text-dim)'};box-shadow:${isActive ? '0 0 6px var(--green)' : 'none'}"></span>
          <span style="font-size:12px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.name)}</span>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;padding-left:12px">${escapeHtml(m.description || '無描述')}</div>
        <div style="display:flex;gap:5px">
          <button onclick="event.stopPropagation();activateModel('${m.id}')" style="flex:1;padding:4px 0;background:${isActive ? 'var(--green-dim)' : 'var(--bg-hover)'};border:1px solid ${isActive ? 'var(--green)' : 'var(--border)'};border-radius:4px;color:${isActive ? 'var(--green)' : 'var(--text-dim)'};font-size:10px;cursor:pointer">${isActive ? '✅ 啟用中' : '啟用'}</button>
          <button onclick="event.stopPropagation();duplicateModel('${m.id}')" style="padding:4px 8px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:var(--text-dim);font-size:10px;cursor:pointer">複製</button>
          <button onclick="event.stopPropagation();deleteModel('${m.id}')" style="padding:4px 8px;background:var(--red-dim);border:1px solid var(--red);border-radius:4px;color:var(--red);font-size:10px;cursor:pointer">刪除</button>
        </div>
      </div>`;
  }).join('');
}

function editModel(id) { // 切換右側編輯面板至指定模型
  editingModelId = id;
  const model = models.find(m => m.id === id);
  if (!model) return;
  renderModelList();
  renderModelEditor(model);
}

function renderModelEditor(model) { // 渲染右側編輯面板（滑桿 + 關鍵字表）
  const sliders = [
    { key: 'growthMultiplier',    label: '成長乘數',     min: 0.5, max: 3,  step: 0.1 },
    { key: 'riskMultiplier',      label: '風險乘數',     min: 0.5, max: 3,  step: 0.1 },
    { key: 'tfBoost',             label: 'TF 加權上限',  min: 1,   max: 20, step: 1   },
    { key: 'paragraphIntro',      label: '引言段落權重',  min: 0.5, max: 3,  step: 0.1 },
    { key: 'paragraphConclusion', label: '結論段落權重',  min: 0.5, max: 3,  step: 0.1 },
  ];

  const renderKwSection = (type) => {
    const items = model.keywords[type] || [];
    const color = type === 'growth' ? 'var(--green)' : 'var(--red)';
    const label = type === 'growth' ? '📈 成長關鍵字' : '⚠️ 風險關鍵字';
    const rows  = items.map((item, idx) => `
      <div style="display:grid;grid-template-columns:1fr 80px 44px;gap:6px;margin-bottom:6px;align-items:center">
        <input value="${escapeHtml(item.word)}" placeholder="關鍵字"
          oninput="updateKeyword('${model.id}','${type}',${idx},'word',this.value)"
          style="padding:7px 10px;background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-family:var(--mono);font-size:12px;outline:none">
        <input type="number" value="${item.weight}" placeholder="權重"
          oninput="updateKeyword('${model.id}','${type}',${idx},'weight',this.value)"
          style="padding:7px 8px;background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;color:${color};font-family:var(--mono);font-size:12px;text-align:center;outline:none">
        <button onclick="deleteKeyword('${model.id}','${type}',${idx})"
          style="padding:7px 0;background:var(--red-dim);border:1px solid var(--red);border-radius:6px;color:var(--red);font-size:11px;cursor:pointer">✕</button>
      </div>`).join('');
    return `
      <div>
        <div style="font-size:11px;font-weight:600;color:${color};letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">${label}</div>
        ${items.length ? `
          <div style="display:grid;grid-template-columns:1fr 80px 44px;gap:6px;margin-bottom:4px">
            <span style="font-size:10px;color:var(--text-dim);padding:0 10px">關鍵字</span>
            <span style="font-size:10px;color:var(--text-dim);text-align:center">權重</span>
            <span></span>
          </div>${rows}` : '<div style="font-size:12px;color:var(--text-dim);padding:6px 0">尚無關鍵字</div>'}
        <button onclick="addKeyword('${model.id}','${type}')"
          style="margin-top:6px;padding:7px 14px;background:var(--bg-hover);border:1px solid var(--border);border-radius:6px;color:var(--text-secondary);font-size:12px;cursor:pointer">
          ➕ 新增${type === 'growth' ? '成長' : '風險'}關鍵字
        </button>
      </div>`;
  };

  document.getElementById('modelEditor').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:24px">
      <div>
        <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:10px">📋 基本資訊</div>
        <input value="${escapeHtml(model.name)}" placeholder="模型名稱"
          oninput="updateModelField('${model.id}','name',this.value)"
          style="width:100%;padding:10px 12px;background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;margin-bottom:8px;outline:none;box-sizing:border-box">
        <input value="${escapeHtml(model.description || '')}" placeholder="模型描述（選填）"
          oninput="updateModelField('${model.id}','description',this.value)"
          style="width:100%;padding:10px 12px;background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;color:var(--text-secondary);font-size:12px;outline:none;box-sizing:border-box">
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:12px">⚖️ 權重參數</div>
        ${sliders.map(s => `
          <div style="display:grid;grid-template-columns:160px 1fr 48px;align-items:center;gap:12px;margin-bottom:12px">
            <span style="font-size:12px;color:var(--text-secondary)">${s.label}</span>
            <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${model.weights[s.key]}"
              oninput="updateWeight('${model.id}','${s.key}',this.value);this.nextElementSibling.textContent=parseFloat(this.value).toFixed(1)"
              style="accent-color:var(--accent);cursor:pointer;width:100%">
            <span style="font-family:var(--mono);font-size:12px;color:var(--accent);text-align:right">${parseFloat(model.weights[s.key]).toFixed(1)}</span>
          </div>`).join('')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:12px">🔤 關鍵字管理</div>
        ${renderKwSection('growth')}
        <div style="border-top:1px solid var(--border);margin:14px 0"></div>
        ${renderKwSection('risk')}
      </div>
    </div>`;
}

function updateModelField(id, field, value) { // 更新模型基本欄位並存檔
  const model = models.find(m => m.id === id);
  if (!model) return;
  model[field] = value;
  saveModels();
  if (field === 'name') renderModelList(); // 名稱異動時刷新左側列表
}

function updateWeight(id, key, value) { // 更新指定模型的單一權重參數
  const model = models.find(m => m.id === id);
  if (!model) return;
  model.weights[key] = parseFloat(value);
  saveModels();
}

function addKeyword(id, type) { // 為指定模型新增空白關鍵字行
  const model = models.find(m => m.id === id);
  if (!model) return;
  model.keywords[type].push({ word: '', weight: type === 'growth' ? 5 : -5 });
  saveModels();
  renderModelEditor(model);
}

function deleteKeyword(id, type, index) { // 刪除指定模型的關鍵字
  const model = models.find(m => m.id === id);
  if (!model) return;
  model.keywords[type].splice(index, 1);
  saveModels();
  renderModelEditor(model);
}

function updateKeyword(id, type, index, field, value) { // 即時更新關鍵字欄位
  const model = models.find(m => m.id === id);
  if (!model) return;
  model.keywords[type][index][field] = (field === 'weight') ? parseFloat(value) : value;
  saveModels();
}

function openModelManager() { // 開啟模型管理視窗
  renderModelList();
  if (editingModelId) {
    const model = models.find(m => m.id === editingModelId);
    if (model) renderModelEditor(model);
  }
  document.getElementById('modelManagerModal').style.display = 'block';
}

function closeModelManager() { // 關閉模型管理視窗
  document.getElementById('modelManagerModal').style.display = 'none';
}

// ══════════════════════════════════════════
//  Export Functions
// ══════════════════════════════════════════
function downloadBlob(content, filename, type) { // 通用 Blob 下載輔助函式
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportSummaryTxt() { // 匯出加權摘要為 TXT 純文字檔
  const sumEl = document.getElementById('summaryContent');
  if (!sumEl.querySelector('.summary-item')) { alert('請先生成摘要'); return; }
  const lines = [
    'PDF 智能分析系統 ─ 加權摘要報告',
    '='.repeat(38),
    `檔案：${document.getElementById('fileName').textContent}`,
    `統計：${document.getElementById('rawLabel').textContent}`,
    `模式：${currentMode}　產業：${currentIndustry || '一般'}`,
    '',
    sumEl.innerText.trim(),
    '',
    `匯出時間：${new Date().toLocaleString('zh-TW')}`,
  ].join('\n');
  downloadBlob(lines, 'summary.txt', 'text/plain;charset=utf-8');
}

function exportScoreJson() { // 匯出評分報告為 JSON 結構化資料
  const scoreNum = document.getElementById('scoreNum');
  if (!scoreNum || !scoreNum.textContent || scoreNum.textContent === '0') {
    alert('請先產生評分報告'); return;
  }
  const data = {
    fileName:    document.getElementById('fileName').textContent,
    score:       parseInt(scoreNum.textContent),
    mode:        currentMode,
    industry:    currentIndustry || null,
    activeModel: getActiveModel()?.name || null,
    stats: {
      pages: document.getElementById('statPages').textContent,
      chars: document.getElementById('statChars').textContent,
      sents: document.getElementById('statSents').textContent,
    },
    summary:    document.getElementById('summaryContent').innerText.trim(),
    exportTime: new Date().toISOString(),
  };
  downloadBlob(JSON.stringify(data, null, 2), 'score-report.json', 'application/json');
}

// ══════════════════════════════════════════
//  Settings System (V4.2)
// ══════════════════════════════════════════
function openSettings() { // 開啟設定面板，填入目前設定的 JSON
  const combined = { keywords: keywordLibrary, industries: industryTemplates };
  document.getElementById('settingsEditor').value = JSON.stringify(combined, null, 2);
  document.getElementById('settingsModal').style.display = 'block';

  // 初始化即時 JSON 驗證
  const editor    = document.getElementById('settingsEditor');
  const indicator = document.getElementById('jsonValidIndicator');
  indicator.textContent = '✅ JSON 正確';
  indicator.style.color = 'var(--green)';
  editor.oninput = () => {
    try {
      JSON.parse(editor.value);
      indicator.textContent = '✅ JSON 正確';
      indicator.style.color = 'var(--green)';
    } catch {
      indicator.textContent = '❌ 格式錯誤';
      indicator.style.color = 'var(--red)';
    }
  };
}

function closeSettings() { // 關閉設定面板
  document.getElementById('settingsModal').style.display = 'none';
}

function saveSettings() { // 解析 JSON 並熱更新引擎 + 儲存至 localStorage
  try {
    const data        = JSON.parse(document.getElementById('settingsEditor').value);
    keywordLibrary    = data.keywords;
    industryTemplates = data.industries;
    localStorage.setItem('keywords',   JSON.stringify(keywordLibrary));
    localStorage.setItem('industries', JSON.stringify(industryTemplates));
    alert('✅ 設定已儲存，引擎立即生效');
  } catch (e) {
    alert('❌ JSON 格式錯誤，請修正後再儲存');
  }
}

function resetSettings() { // 還原所有設定為預設值並清除 localStorage
  keywordLibrary    = defaultKeywords;
  industryTemplates = defaultIndustries;
  localStorage.removeItem('keywords');
  localStorage.removeItem('industries');
  openSettings(); // 重新開啟面板顯示預設值
}

function exportSettings() { // 將目前設定匯出為 JSON 檔案下載
  const blob = new Blob(
    [JSON.stringify({ keywords: keywordLibrary, industries: industryTemplates }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = 'engine-config.json';
  a.click();
  URL.revokeObjectURL(url); // 釋放 Blob URL 避免記憶體洩漏
}

// ── Init ──
renderHistory(); // 頁面載入時初始化歷史紀錄列表
