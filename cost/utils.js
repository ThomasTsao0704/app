// 共用工具函數

// 單位換算表
const UNIT_CONVERT = {
    // 重量
    kg: { g: 1000, kg: 1 },
    g: { g: 1, kg: 0.001 },
    // 體積
    L: { ml: 1000, L: 1 },
    ml: { ml: 1, L: 0.001 },
    // 顆數
    顆: { 顆: 1 },
    粒: { 粒: 1 },
    個: { 個: 1 },
    // 其他
    份: { 份: 1 },
    包: { 包: 1 },
    瓶: { 瓶: 1 }
};

// 單位類別
const UNIT_CATEGORY = {
    weight: ['kg', 'g'],
    volume: ['L', 'ml'],
    count: ['顆', '粒', '個'],
    other: ['份', '包', '瓶']
};

// 取得單位類別
function getUnitCategory(unit) {
    for (const [category, units] of Object.entries(UNIT_CATEGORY)) {
        if (units.includes(unit)) {
            return category;
        }
    }
    return 'other';
}

// 檢查兩個單位是否可以互相換算
function canConvert(fromUnit, toUnit) {
    const fromCat = getUnitCategory(fromUnit);
    const toCat = getUnitCategory(toUnit);
    return fromCat === toCat;
}

// 單位換算
function convertUnit(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) return value;

    if (!canConvert(fromUnit, toUnit)) {
        console.warn(`無法換算：${fromUnit} -> ${toUnit}`);
        return null;
    }

    // 找到基礎單位（重量用 g，體積用 ml，顆數用原單位）
    const fromCat = getUnitCategory(fromUnit);
    let baseUnit;
    if (fromCat === 'weight') baseUnit = 'g';
    else if (fromCat === 'volume') baseUnit = 'ml';
    else baseUnit = fromUnit;

    // 先轉成基礎單位，再轉成目標單位
    const toBase = UNIT_CONVERT[fromUnit]?.[baseUnit] || 1;
    const toTarget = UNIT_CONVERT[toUnit]?.[baseUnit] || 1;

    return (value * toBase) / toTarget;
}

// 格式化數字（保留小數）
function formatNumber(num, decimals = 2) {
    if (num == null || isNaN(num)) return '0.00';
    return Number(num).toFixed(decimals);
}

// localStorage 操作
const Storage = {
    // 儲存原物料
    saveMaterials(materials) {
        try {
            localStorage.setItem('materials', JSON.stringify(materials));
            return true;
        } catch (e) {
            console.error('儲存原物料失敗:', e);
            return false;
        }
    },

    // 讀取原物料
    loadMaterials() {
        try {
            const data = localStorage.getItem('materials');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('讀取原物料失敗:', e);
            return [];
        }
    },

    // 儲存菜色
    saveDishes(dishes) {
        try {
            localStorage.setItem('dishes', JSON.stringify(dishes));
            return true;
        } catch (e) {
            console.error('儲存菜色失敗:', e);
            return false;
        }
    },

    // 讀取菜色
    loadDishes() {
        try {
            const data = localStorage.getItem('dishes');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('讀取菜色失敗:', e);
            return [];
        }
    },

    // 儲存當前編輯的菜色
    saveCurrentDish(dish) {
        try {
            localStorage.setItem('currentDish', JSON.stringify(dish));
            return true;
        } catch (e) {
            console.error('儲存當前菜色失敗:', e);
            return false;
        }
    },

    // 讀取當前編輯的菜色
    loadCurrentDish() {
        try {
            const data = localStorage.getItem('currentDish');
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('讀取當前菜色失敗:', e);
            return null;
        }
    },

    // 清除所有資料
    clearAll() {
        try {
            localStorage.removeItem('materials');
            localStorage.removeItem('dishes');
            localStorage.removeItem('currentDish');
            return true;
        } catch (e) {
            console.error('清除資料失敗:', e);
            return false;
        }
    }
};

// JSON 檔案匯入/匯出
const FileUtils = {
    // 匯出 JSON
    exportJSON(data, filename) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    // 匯入 JSON
    importJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    resolve(data);
                } catch (err) {
                    reject(new Error('JSON 格式錯誤'));
                }
            };
            reader.onerror = () => reject(new Error('讀取檔案失敗'));
            reader.readAsText(file);
        });
    },

    // 匯出 CSV
    exportCSV(data, columns, filename) {
        let csv = columns.map(c => c.label).join(',') + '\n';

        data.forEach(row => {
            const values = columns.map(c => {
                const val = row[c.key];
                // 處理包含逗號的值
                if (val != null && String(val).includes(',')) {
                    return `"${val}"`;
                }
                return val != null ? val : '';
            });
            csv += values.join(',') + '\n';
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    // 匯入 CSV
    importCSV(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const text = e.target.result;
                    const lines = text.split('\n').filter(line => line.trim());
                    if (lines.length < 2) {
                        reject(new Error('CSV 檔案格式錯誤'));
                        return;
                    }

                    const headers = lines[0].split(',').map(h => h.trim());
                    const data = [];

                    for (let i = 1; i < lines.length; i++) {
                        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                        const row = {};
                        headers.forEach((header, idx) => {
                            row[header] = values[idx] || '';
                        });
                        data.push(row);
                    }

                    resolve(data);
                } catch (err) {
                    reject(new Error('CSV 解析失敗'));
                }
            };
            reader.onerror = () => reject(new Error('讀取檔案失敗'));
            reader.readAsText(file, 'UTF-8');
        });
    }
};

// 生成唯一 ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 計算原物料單位成本
function calculateMaterialUnitCost(material) {
    const {
        calcType,
        purchasePrice,
        purchaseQty,
        purchaseUnit,
        packageContent,
        contentUnit,
        usableRate
    } = material;

    const price = parseFloat(purchasePrice) || 0;
    const qty = parseFloat(purchaseQty) || 0;
    const rate = parseFloat(usableRate) || 100;
    const pkgContent = parseFloat(packageContent) || 0;

    if (price === 0 || qty === 0) return { unitCost: 0, baseUnit: purchaseUnit };

    if (calcType === 'fixed') {
        return { unitCost: price, baseUnit: '份' };
    }

    // 計算可用量
    let usableQty = qty;
    let baseUnit = purchaseUnit;

    if (purchaseUnit === '包' || purchaseUnit === '瓶') {
        if (pkgContent > 0 && contentUnit) {
            usableQty = qty * pkgContent;
            baseUnit = contentUnit;
        }
    }

    usableQty = usableQty * (rate / 100);

    if (usableQty === 0) return { unitCost: 0, baseUnit };

    const unitCost = price / usableQty;
    return { unitCost, baseUnit };
}

// 計算原物料在菜色中的成本
function calculateMaterialCostInDish(material, usageQty, usageUnit) {
    const { unitCost, baseUnit } = calculateMaterialUnitCost(material);

    if (unitCost === 0) return 0;

    const usage = parseFloat(usageQty) || 0;
    if (usage === 0) return 0;

    // 如果是固定成本
    if (material.calcType === 'fixed') {
        return unitCost;
    }

    // 轉換單位
    const convertedUsage = convertUnit(usage, usageUnit, baseUnit);
    if (convertedUsage === null) {
        console.warn(`單位無法換算: ${usageUnit} -> ${baseUnit}`);
        return 0;
    }

    return unitCost * convertedUsage;
}
