// 菜色成本計算邏輯

let materials = []; // 原物料庫
let dish = {
    name: '',
    note: '',
    sellingPrice: '',
    targetMargin: '',
    items: []
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    bindEvents();
    render();
    updateSummary();
});

// 載入資料
function loadData() {
    materials = Storage.loadMaterials();
    const saved = Storage.loadCurrentDish();
    if (saved) {
        dish = saved;
        document.getElementById('dishName').value = dish.name || '';
        document.getElementById('dishNote').value = dish.note || '';
        document.getElementById('sellingPrice').value = dish.sellingPrice || '';
        document.getElementById('targetMargin').value = dish.targetMargin || '';
    }
}

// 儲存資料
function saveData() {
    dish.name = document.getElementById('dishName').value;
    dish.note = document.getElementById('dishNote').value;
    dish.sellingPrice = document.getElementById('sellingPrice').value;
    dish.targetMargin = document.getElementById('targetMargin').value;
    Storage.saveCurrentDish(dish);
}

// 綁定事件
function bindEvents() {
    document.getElementById('btnAddItem').addEventListener('click', addItem);
    document.getElementById('btnReset').addEventListener('click', reset);
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
    document.getElementById('btnSaveDish').addEventListener('click', saveDish);

    // 監聽輸入變化
    ['dishName', 'dishNote', 'sellingPrice', 'targetMargin'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            saveData();
            updateSummary();
        });
    });
}

// 新增品項
function addItem() {
    if (materials.length === 0) {
        alert('尚未建立任何原物料，請先到「原物料管理」頁面建立原物料。');
        return;
    }

    const newItem = {
        id: generateId(),
        materialId: materials[0].id,
        usageQty: '',
        usageUnit: 'g'
    };
    dish.items.push(newItem);
    saveData();
    render();
    updateSummary();
}

// 刪除品項
function deleteItem(id) {
    dish.items = dish.items.filter(item => item.id !== id);
    saveData();
    render();
    updateSummary();
}

// 更新品項
function updateItem(id, field, value) {
    const item = dish.items.find(i => i.id === id);
    if (!item) return;

    item[field] = value;

    // 如果更換了原物料，自動更新用量單位
    if (field === 'materialId') {
        const material = materials.find(m => m.id === value);
        if (material) {
            const { baseUnit } = calculateMaterialUnitCost(material);
            item.usageUnit = baseUnit;
        }
    }

    saveData();
    render();
    updateSummary();
}

// 渲染表格
function render() {
    const tbody = document.getElementById('itemsTbody');
    const emptyItems = document.getElementById('emptyItems');
    const noMaterials = document.getElementById('noMaterials');
    const tableWrap = document.getElementById('itemsTableWrap');

    // 檢查是否有原物料
    if (materials.length === 0) {
        noMaterials.style.display = 'block';
        tableWrap.style.display = 'none';
        emptyItems.style.display = 'none';
        document.getElementById('btnAddItem').disabled = true;
        return;
    }

    noMaterials.style.display = 'none';
    document.getElementById('btnAddItem').disabled = false;

    // 檢查是否有品項
    if (dish.items.length === 0) {
        emptyItems.style.display = 'block';
        tableWrap.style.display = 'none';
        return;
    }

    emptyItems.style.display = 'none';
    tableWrap.style.display = 'block';

    tbody.innerHTML = dish.items.map(item => {
        const material = materials.find(m => m.id === item.materialId);
        if (!material) {
            return `<tr><td colspan="6" class="center muted">找不到原物料</td></tr>`;
        }

        const { unitCost, baseUnit } = calculateMaterialUnitCost(material);
        const itemCost = calculateMaterialCostInDish(material, item.usageQty, item.usageUnit);

        // 檢查單位是否可以換算
        const canConvertUnits = canConvert(item.usageUnit, baseUnit);
        const unitWarning = !canConvertUnits ? '<span class="warnText">⚠️ 單位不匹配</span>' : '';

        return `
            <tr>
                <td class="cellInput">
                    <select onchange="updateItem('${item.id}', 'materialId', this.value)">
                        ${materials.map(m => `
                            <option value="${m.id}" ${m.id === item.materialId ? 'selected' : ''}>
                                ${m.name || '(未命名)'} - ${formatNumber(calculateMaterialUnitCost(m).unitCost, 4)} 元/${calculateMaterialUnitCost(m).baseUnit}
                            </option>
                        `).join('')}
                    </select>
                </td>
                <td class="cellInput">
                    <input
                        type="number"
                        inputmode="decimal"
                        min="0"
                        step="0.01"
                        value="${item.usageQty}"
                        placeholder="0"
                        onchange="updateItem('${item.id}', 'usageQty', this.value)"
                    />
                </td>
                <td class="cellInput">
                    <select onchange="updateItem('${item.id}', 'usageUnit', this.value)">
                        <optgroup label="重量">
                            <option value="kg" ${item.usageUnit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="g" ${item.usageUnit === 'g' ? 'selected' : ''}>g</option>
                        </optgroup>
                        <optgroup label="體積">
                            <option value="L" ${item.usageUnit === 'L' ? 'selected' : ''}>L</option>
                            <option value="ml" ${item.usageUnit === 'ml' ? 'selected' : ''}>ml</option>
                        </optgroup>
                        <optgroup label="數量">
                            <option value="顆" ${item.usageUnit === '顆' ? 'selected' : ''}>顆</option>
                            <option value="粒" ${item.usageUnit === '粒' ? 'selected' : ''}>粒</option>
                            <option value="個" ${item.usageUnit === '個' ? 'selected' : ''}>個</option>
                        </optgroup>
                        <optgroup label="其他">
                            <option value="份" ${item.usageUnit === '份' ? 'selected' : ''}>份</option>
                        </optgroup>
                    </select>
                    ${unitWarning}
                </td>
                <td class="right mono">
                    ${formatNumber(unitCost, 4)} <span class="small muted">/ ${baseUnit}</span>
                </td>
                <td class="right mono ${itemCost === 0 ? 'muted' : ''}">
                    ${formatNumber(itemCost)}
                </td>
                <td class="center">
                    <button class="danger" onclick="deleteItem('${item.id}')">刪除</button>
                </td>
            </tr>
        `;
    }).join('');
}

// 更新總覽
function updateSummary() {
    // 計算總成本
    const totalCost = dish.items.reduce((sum, item) => {
        const material = materials.find(m => m.id === item.materialId);
        if (!material) return sum;
        const cost = calculateMaterialCostInDish(material, item.usageQty, item.usageUnit);
        return sum + cost;
    }, 0);

    document.getElementById('kpiCost').textContent = formatNumber(totalCost);

    // 售價相關計算
    const sellingPrice = parseFloat(document.getElementById('sellingPrice').value) || 0;
    const targetMargin = parseFloat(document.getElementById('targetMargin').value) || 0;

    // 建議售價
    if (targetMargin > 0 && totalCost > 0) {
        const suggestedPrice = totalCost / (1 - targetMargin / 100);
        document.getElementById('kpiSuggested').textContent = formatNumber(suggestedPrice);
    } else {
        document.getElementById('kpiSuggested').textContent = '—';
    }

    // 有售價時才計算毛利率、成本率、毛利額
    if (sellingPrice > 0) {
        const profit = sellingPrice - totalCost;
        const marginRate = (profit / sellingPrice) * 100;
        const costRate = (totalCost / sellingPrice) * 100;

        document.getElementById('kpiPrice').textContent = formatNumber(sellingPrice);
        document.getElementById('kpiProfit').textContent = formatNumber(profit);
        document.getElementById('kpiMargin').textContent = formatNumber(marginRate, 1) + '%';
        document.getElementById('kpiCostRate').textContent = formatNumber(costRate, 1) + '%';

        // 狀態提示
        updateStatus(marginRate, costRate, totalCost, sellingPrice);
    } else {
        document.getElementById('kpiPrice').textContent = '—';
        document.getElementById('kpiProfit').textContent = '—';
        document.getElementById('kpiMargin').textContent = '—';
        document.getElementById('kpiCostRate').textContent = '—';

        // 只有成本，沒有售價
        const statusBox = document.getElementById('statusBox');
        statusBox.className = 'status';
        if (totalCost > 0) {
            statusBox.textContent = `總成本：${formatNumber(totalCost)} 元/份。填寫售價可計算毛利率與成本率。`;
        } else {
            statusBox.textContent = '請新增品項並填寫用量';
        }
    }
}

// 更新狀態提示
function updateStatus(marginRate, costRate, totalCost, sellingPrice) {
    const statusBox = document.getElementById('statusBox');

    // 檢查毛利率 + 成本率是否 = 100%
    const sum = marginRate + costRate;
    if (Math.abs(sum - 100) > 0.5) {
        statusBox.className = 'status warn';
        statusBox.textContent = `⚠️ 毛利率 (${formatNumber(marginRate, 1)}%) + 成本率 (${formatNumber(costRate, 1)}%) = ${formatNumber(sum, 1)}%，理論上應該等於 100%，請檢查單位換算是否正確。`;
        return;
    }

    // 評估毛利率
    if (marginRate < 50) {
        statusBox.className = 'status bad';
        statusBox.textContent = `❌ 毛利率 ${formatNumber(marginRate, 1)}% 偏低（< 50%），成本過高或售價過低，建議調整。`;
    } else if (marginRate < 55) {
        statusBox.className = 'status warn';
        statusBox.textContent = `⚠️ 毛利率 ${formatNumber(marginRate, 1)}%，適合小吃/快餐（50-60%），若是一般餐廳可能偏低。`;
    } else if (marginRate < 65) {
        statusBox.className = 'status good';
        statusBox.textContent = `✓ 毛利率 ${formatNumber(marginRate, 1)}%，符合一般餐廳標準（55-65%）。`;
    } else if (marginRate < 75) {
        statusBox.className = 'status good';
        statusBox.textContent = `✓ 毛利率 ${formatNumber(marginRate, 1)}%，符合精緻餐飲標準（65-75%）。`;
    } else {
        statusBox.className = 'status good';
        statusBox.textContent = `✓ 毛利率 ${formatNumber(marginRate, 1)}%，非常理想！`;
    }
}

// 重置
function reset() {
    if (!confirm('確定要重置嗎？\n\n⚠️ 此操作會清空當前菜色的所有資料！')) return;

    dish = {
        name: '',
        note: '',
        sellingPrice: '',
        targetMargin: '',
        items: []
    };

    document.getElementById('dishName').value = '';
    document.getElementById('dishNote').value = '';
    document.getElementById('sellingPrice').value = '';
    document.getElementById('targetMargin').value = '';

    saveData();
    render();
    updateSummary();
}

// 匯出 CSV
function exportCSV() {
    if (dish.items.length === 0) {
        alert('目前沒有品項可以匯出');
        return;
    }

    const data = dish.items.map(item => {
        const material = materials.find(m => m.id === item.materialId);
        if (!material) return null;

        const { unitCost, baseUnit } = calculateMaterialUnitCost(material);
        const itemCost = calculateMaterialCostInDish(material, item.usageQty, item.usageUnit);

        return {
            '原物料': material.name,
            '每份用量': item.usageQty,
            '用量單位': item.usageUnit,
            '單位成本': formatNumber(unitCost, 4),
            '基礎單位': baseUnit,
            '單項成本': formatNumber(itemCost)
        };
    }).filter(Boolean);

    const columns = [
        { key: '原物料', label: '原物料' },
        { key: '每份用量', label: '每份用量' },
        { key: '用量單位', label: '用量單位' },
        { key: '單位成本', label: '單位成本' },
        { key: '基礎單位', label: '基礎單位' },
        { key: '單項成本', label: '單項成本' }
    ];

    const dishName = dish.name || '菜色';
    const filename = `${dishName}_成本明細_${new Date().toISOString().split('T')[0]}.csv`;
    FileUtils.exportCSV(data, columns, filename);
}

// 儲存菜色
function saveDish() {
    if (!dish.name) {
        alert('請先填寫菜名');
        return;
    }

    if (dish.items.length === 0) {
        alert('請至少新增一個品項');
        return;
    }

    // 載入現有菜色列表
    let dishes = Storage.loadDishes();

    // 檢查是否已存在
    const existingIndex = dishes.findIndex(d => d.name === dish.name);

    if (existingIndex >= 0) {
        if (!confirm(`菜色「${dish.name}」已存在，要覆蓋嗎？`)) return;
        dishes[existingIndex] = { ...dish, id: dishes[existingIndex].id, updatedAt: new Date().toISOString() };
    } else {
        dishes.push({ ...dish, id: generateId(), createdAt: new Date().toISOString() });
    }

    Storage.saveDishes(dishes);
    alert(`菜色「${dish.name}」已儲存！`);
}
