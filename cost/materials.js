// 原物料管理邏輯

let materials = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    bindEvents();
    render();
});

// 載入資料
function loadData() {
    materials = Storage.loadMaterials();
}

// 儲存資料
function saveData() {
    Storage.saveMaterials(materials);
}

// 綁定事件
function bindEvents() {
    document.getElementById('btnAddMaterial').addEventListener('click', addMaterial);
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
    document.getElementById('btnImportCSV').addEventListener('click', () => {
        document.getElementById('fileCSV').click();
    });
    document.getElementById('fileCSV').addEventListener('change', importCSV);
    document.getElementById('btnClearAll').addEventListener('click', clearAll);
}

// 新增原物料
function addMaterial() {
    const newMaterial = {
        id: generateId(),
        name: '',
        calcType: 'unit',
        purchasePrice: '',
        purchaseQty: '',
        purchaseUnit: 'kg',
        packageContent: '',
        contentUnit: 'g',
        usableRate: '100'
    };
    materials.push(newMaterial);
    saveData();
    render();
}

// 刪除原物料
function deleteMaterial(id) {
    if (!confirm('確定要刪除這個原物料嗎？')) return;
    materials = materials.filter(m => m.id !== id);
    saveData();
    render();
}

// 更新原物料欄位
function updateMaterial(id, field, value) {
    const material = materials.find(m => m.id === id);
    if (!material) return;

    material[field] = value;

    // 如果計算方式改變，重置某些欄位
    if (field === 'calcType') {
        if (value === 'fixed') {
            material.purchaseQty = '';
            material.purchaseUnit = '份';
            material.packageContent = '';
            material.contentUnit = '';
            material.usableRate = '100';
        } else {
            material.purchaseUnit = 'kg';
        }
    }

    saveData();
    render();
}

// 渲染表格
function render() {
    const tbody = document.getElementById('materialsTbody');
    const emptyState = document.getElementById('emptyState');
    const tableWrap = document.getElementById('materialsTableWrap');

    if (materials.length === 0) {
        emptyState.style.display = 'block';
        tableWrap.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    tableWrap.style.display = 'block';

    tbody.innerHTML = materials.map(m => {
        const { unitCost, baseUnit } = calculateMaterialUnitCost(m);
        const isPackage = m.purchaseUnit === '包' || m.purchaseUnit === '瓶';
        const isFixed = m.calcType === 'fixed';

        return `
            <tr>
                <td class="cellInput">
                    <input
                        type="text"
                        value="${m.name}"
                        placeholder="例如：牛腩"
                        onchange="updateMaterial('${m.id}', 'name', this.value)"
                    />
                </td>
                <td class="cellInput">
                    <select onchange="updateMaterial('${m.id}', 'calcType', this.value)">
                        <option value="unit" ${m.calcType === 'unit' ? 'selected' : ''}>單位換算</option>
                        <option value="fixed" ${m.calcType === 'fixed' ? 'selected' : ''}>固定成本</option>
                    </select>
                </td>
                <td class="cellInput">
                    <input
                        type="number"
                        inputmode="decimal"
                        min="0"
                        step="0.01"
                        value="${m.purchasePrice}"
                        placeholder="0"
                        onchange="updateMaterial('${m.id}', 'purchasePrice', this.value)"
                    />
                </td>
                <td class="cellInput">
                    <input
                        type="number"
                        inputmode="decimal"
                        min="0"
                        step="0.01"
                        value="${m.purchaseQty}"
                        placeholder="0"
                        onchange="updateMaterial('${m.id}', 'purchaseQty', this.value)"
                        ${isFixed ? 'disabled' : ''}
                    />
                </td>
                <td class="cellInput">
                    <select
                        onchange="updateMaterial('${m.id}', 'purchaseUnit', this.value)"
                        ${isFixed ? 'disabled' : ''}
                    >
                        <optgroup label="重量">
                            <option value="kg" ${m.purchaseUnit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="g" ${m.purchaseUnit === 'g' ? 'selected' : ''}>g</option>
                        </optgroup>
                        <optgroup label="體積">
                            <option value="L" ${m.purchaseUnit === 'L' ? 'selected' : ''}>L</option>
                            <option value="ml" ${m.purchaseUnit === 'ml' ? 'selected' : ''}>ml</option>
                        </optgroup>
                        <optgroup label="數量">
                            <option value="顆" ${m.purchaseUnit === '顆' ? 'selected' : ''}>顆</option>
                            <option value="粒" ${m.purchaseUnit === '粒' ? 'selected' : ''}>粒</option>
                            <option value="個" ${m.purchaseUnit === '個' ? 'selected' : ''}>個</option>
                        </optgroup>
                        <optgroup label="包裝">
                            <option value="包" ${m.purchaseUnit === '包' ? 'selected' : ''}>包</option>
                            <option value="瓶" ${m.purchaseUnit === '瓶' ? 'selected' : ''}>瓶</option>
                        </optgroup>
                        <optgroup label="其他">
                            <option value="份" ${m.purchaseUnit === '份' ? 'selected' : ''}>份</option>
                        </optgroup>
                    </select>
                </td>
                <td class="cellInput">
                    <input
                        type="number"
                        inputmode="decimal"
                        min="0"
                        step="0.01"
                        value="${m.packageContent}"
                        placeholder="${isPackage && !isFixed ? '例如：1000' : '—'}"
                        onchange="updateMaterial('${m.id}', 'packageContent', this.value)"
                        ${!isPackage || isFixed ? 'disabled' : ''}
                    />
                </td>
                <td class="cellInput">
                    <select
                        onchange="updateMaterial('${m.id}', 'contentUnit', this.value)"
                        ${!isPackage || isFixed ? 'disabled' : ''}
                    >
                        <optgroup label="重量">
                            <option value="kg" ${m.contentUnit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="g" ${m.contentUnit === 'g' ? 'selected' : ''}>g</option>
                        </optgroup>
                        <optgroup label="體積">
                            <option value="L" ${m.contentUnit === 'L' ? 'selected' : ''}>L</option>
                            <option value="ml" ${m.contentUnit === 'ml' ? 'selected' : ''}>ml</option>
                        </optgroup>
                        <optgroup label="數量">
                            <option value="顆" ${m.contentUnit === '顆' ? 'selected' : ''}>顆</option>
                            <option value="粒" ${m.contentUnit === '粒' ? 'selected' : ''}>粒</option>
                            <option value="個" ${m.contentUnit === '個' ? 'selected' : ''}>個</option>
                        </optgroup>
                    </select>
                </td>
                <td class="cellInput">
                    <input
                        type="number"
                        inputmode="decimal"
                        min="0"
                        max="100"
                        step="0.1"
                        value="${m.usableRate}"
                        onchange="updateMaterial('${m.id}', 'usableRate', this.value)"
                        ${isFixed ? 'disabled' : ''}
                    />
                </td>
                <td class="right mono">
                    ${isFixed ? '—' : formatNumber(unitCost, 4)} ${isFixed ? '' : `<span class="small muted">/ ${baseUnit}</span>`}
                </td>
                <td class="center">
                    <button class="danger" onclick="deleteMaterial('${m.id}')">刪除</button>
                </td>
            </tr>
        `;
    }).join('');
}

// 匯出 CSV
function exportCSV() {
    if (materials.length === 0) {
        alert('目前沒有原物料可以匯出');
        return;
    }

    const columns = [
        { key: 'name', label: '原物料名稱' },
        { key: 'calcType', label: '計算方式' },
        { key: 'purchasePrice', label: '採購價' },
        { key: 'purchaseQty', label: '採購量' },
        { key: 'purchaseUnit', label: '採購單位' },
        { key: 'packageContent', label: '包裝內容量' },
        { key: 'contentUnit', label: '內容單位' },
        { key: 'usableRate', label: '可用率' }
    ];

    // 準備匯出資料（不包含 id，避免重複）
    const exportData = materials.map(m => ({
        name: m.name || '',
        calcType: m.calcType === 'unit' ? '單位換算' : '固定成本',
        purchasePrice: m.purchasePrice || '',
        purchaseQty: m.purchaseQty || '',
        purchaseUnit: m.purchaseUnit || '',
        packageContent: m.packageContent || '',
        contentUnit: m.contentUnit || '',
        usableRate: m.usableRate || ''
    }));

    const filename = `原物料庫_${new Date().toISOString().split('T')[0]}.csv`;
    FileUtils.exportCSV(exportData, columns, filename);
}

// 匯入 CSV
async function importCSV(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const data = await FileUtils.importCSV(file);

        if (!Array.isArray(data) || data.length === 0) {
            alert('CSV 檔案格式錯誤或為空');
            return;
        }

        // 轉換 CSV 資料為內部格式
        const importedMaterials = data.map(row => {
            // 處理計算方式
            let calcType = 'unit';
            if (row['計算方式'] === '固定成本') {
                calcType = 'fixed';
            }

            return {
                id: generateId(),
                name: row['原物料名稱'] || '',
                calcType: calcType,
                purchasePrice: row['採購價'] || '',
                purchaseQty: row['採購量'] || '',
                purchaseUnit: row['採購單位'] || 'kg',
                packageContent: row['包裝內容量'] || '',
                contentUnit: row['內容單位'] || 'g',
                usableRate: row['可用率'] || '100'
            };
        });

        // 驗證資料
        const valid = importedMaterials.every(item => item.name);
        if (!valid) {
            alert('CSV 格式錯誤：部分原物料缺少名稱');
            return;
        }

        if (confirm(`確定要匯入 ${importedMaterials.length} 個原物料嗎？\n\n⚠️ 注意：這會覆蓋目前的原物料庫！`)) {
            materials = importedMaterials;
            saveData();
            render();
            alert('匯入成功！');
        }
    } catch (err) {
        alert('匯入失敗：' + err.message);
    }

    // 重置 file input
    e.target.value = '';
}

// 清空全部
function clearAll() {
    if (materials.length === 0) {
        alert('目前沒有任何原物料');
        return;
    }

    if (confirm(`確定要清空全部 ${materials.length} 個原物料嗎？\n\n⚠️ 此操作無法復原！`)) {
        materials = [];
        saveData();
        render();
        alert('已清空所有原物料');
    }
}
