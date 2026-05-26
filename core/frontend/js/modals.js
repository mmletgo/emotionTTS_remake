// ==========================================
// modals.js - 弹窗控制与交互模块
// ==========================================

function openLibraryModal(target = 'single', forceCharId = null) {
    currentLibraryTarget = target;
    const charId = forceCharId || document.getElementById('charSelect').value;
    if (!charId) return alert("请先选择角色！");
    document.getElementById('modalTargetEmotion').innerHTML = "<span style='color:#3498db;'>手动挑选</span>";
    document.getElementById('librarySearchInput').value = "";

    const modal = document.getElementById('selectLibraryModal');
    modal.style.zIndex = '1050';
    modal.style.display = 'flex';

    const tbody = document.getElementById('libraryTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">读取语料库中...</td></tr>';

    apiFetchCharacterDetails(charId).then(data => {
        globalLibraryCache = data.items;
        currentModalEmotionFilter = 'all'; // 每次打开弹窗重置为“全部”
        renderModalEmotionFilters(globalLibraryCache); // 渲染筛选标签
        filterLibrary(); // 统一调用 filterLibrary 来渲染列表
    }).catch(e => {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: red;">加载失败</td></tr>';
    });
}

function renderLibraryTable(items, charId) {
    const tbody = document.getElementById('libraryTableBody');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: #7f8c8d;">没有匹配素材</td></tr>';
        return;
    }

    const isLongText = currentLibraryTarget.startsWith('long_seg_');

    tbody.innerHTML = items.map(item => {
        // 1. 构造“选择”按钮
        let selectBtnHtml = `<button class="btn-success btn-sm" style="margin: 0; white-space: nowrap; flex: 1;" onclick="selectManualCandidate(${item.id}, '${charId}')">✔️ 选择</button>`;

        // 2. 构造“应用所有”按钮（仅长文本模式）
        let applyAllBtnHtml = '';
        if (isLongText) {
            applyAllBtnHtml = `<button class="btn-info btn-sm" style="margin: 0; white-space: nowrap; flex: 1.5; background-color: #8e44ad; border-color: #8e44ad;" onclick="applyReferenceToAll(${item.id}, '${charId}')">📢 应用所有</button>`;
        }

        return `<tr>
            <td style="color: #7f8c8d; font-weight: bold;">${item.id}</td>
            <td><div class="td-text" style="max-width: 250px;">${item.text}</div></td>
            <td>${renderEmotionBadges(item.emotion)}</td>
            <td class="td-audio">
                <audio src="/characters/${charId}/${item.filename.replace(/\\/g, '/')}?t=${Date.now()}" preload="none" controls style="height: 35px; width: 100%;"></audio>
            </td>
            <td>
                <div style="display: flex; gap: 8px; align-items: center; justify-content: center;">
                    ${selectBtnHtml}
                    ${applyAllBtnHtml}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function filterLibrary() {
    const kw = document.getElementById('librarySearchInput').value.toLowerCase().trim();
    const filteredItems = globalLibraryCache.filter(item => {
        // 1. 判断文本搜索是否匹配
        const textMatch = (item.text || '').toLowerCase().includes(kw) || JSON.stringify(item.emotion).toLowerCase().includes(kw);

        // 2. 判断情绪标签是否匹配
        let pEmo = '平';
        if (item.emotion) {
            if (typeof item.emotion === 'string') { pEmo = '平'; }
            else { pEmo = item.emotion.primary || '平'; }
        }
        const emoMatch = (currentModalEmotionFilter === 'all' || pEmo === currentModalEmotionFilter);

        // 必须同时满足文本搜索和标签筛选
        return textMatch && emoMatch;
    });

    let charId = document.getElementById('charSelect').value;
    if (currentLibraryTarget.startsWith('long_seg_')) {
        const segId = currentLibraryTarget.replace('long_seg_', '');
        const seg = longTextSegments.find(s => s.id == segId);
        if (seg) charId = seg.charId;
    }
    renderLibraryTable(filteredItems, charId);
}

function closeLibraryModal() {
    document.getElementById('selectLibraryModal').style.display = 'none';
    document.getElementById('selectLibraryModal').querySelectorAll('audio').forEach(a => a.pause());
}

function selectManualCandidate(itemId, charId) {
    const item = globalLibraryCache.find(i => i.id == itemId); if (!item) return;
    const cand = { text: item.text, reason: "人工挑选", ref_audio_url: `/characters/${charId}/${item.filename.replace(/\\/g, '/')}`, filename: item.filename, emotion: item.emotion };

    if (currentLibraryTarget === 'single') {
        currentCandidates = [cand];
        document.getElementById('targetEmotion').innerHTML = '<span class="badge badge-blue">手动指定</span>';
        if(typeof renderCurrentCandidate === 'function') renderCurrentCandidate();
        document.getElementById('outputWrapper').style.display = 'block';
        document.getElementById('resultArea').style.display = 'none';
    } else if (currentLibraryTarget.startsWith('long_seg_')) {
        const segId = currentLibraryTarget.replace('long_seg_', '');
        const seg = longTextSegments.find(s => s.id == segId);
        if(seg) {
            seg.candidates = [cand];
            if(typeof renderLongTextSegments === 'function') renderLongTextSegments();
        }
    }
    closeLibraryModal();
}

function openManualEmotionModal(target = 'single') {
    currentEmotionTarget = target;
    document.getElementById('manualEmotionModal').style.display = 'flex';
}

function closeManualEmotionModal() {
    document.getElementById('manualEmotionModal').style.display = 'none';
}

function clearManualEmotion() {
    if(currentEmotionTarget === 'single') {
        manualTargetEmotion = null;
        document.getElementById('manualEmotionDisplay').style.display = 'none';
    }
    closeManualEmotionModal();
}

function saveManualEmotion() {
    const p = document.getElementById('manualEmoPrimary').value;
    const i = document.getElementById('manualEmoIntensity').value;
    const c = document.getElementById('manualEmoComplex').value.trim();
    const emo = { primary: p, intensity: i, complex: c };
    if (currentEmotionTarget === 'single') {
        manualTargetEmotion = emo;
        const display = document.getElementById('manualEmotionDisplay');
        display.innerHTML = `<span style="color:#e74c3c; font-weight:bold;">已锁定：</span>${renderEmotionBadges(manualTargetEmotion)}`;
        display.style.display = 'flex';
    }
    closeManualEmotionModal();
}

// ==========================================
// 🎛️ 情绪向量弹窗控制器
// ==========================================
function openVectorEmotionModal(segId) {
    // 判定当前是单句还是长文本片段
    editingVectorSegId = (typeof segId === 'number' || (typeof segId === 'string' && segId !== '[object PointerEvent]' && segId !== '[object MouseEvent]')) ? segId : 'single';

    // 🌟 控制【应用到所有】按钮的显示：仅长文本模式显示
    const applyAllBtn = document.getElementById('btnApplyVectorToAll');
    if (applyAllBtn) {
        applyAllBtn.style.display = (editingVectorSegId !== 'single') ? 'block' : 'none';
    }

    let vec = null;
    let alpha = 0.65;

    // 回显逻辑
    if (editingVectorSegId !== 'single') {
        const seg = longTextSegments.find(s => s.id == editingVectorSegId);
        if (seg) {
            vec = seg.emo_vector;
            alpha = seg.emo_alpha !== undefined ? seg.emo_alpha : 0.65;
        }
    } else {
        vec = activeEmoVector;
        alpha = activeEmoAlpha;
    }

    // 更新滑动条 UI
    for (let i = 0; i < 8; i++) {
        const el = document.getElementById(`vec_emo_${i}`);
        if(el) {
            const val = vec ? vec[i] : 0;
            el.value = val;
            document.getElementById(`val_emo_${i}`).innerText = parseFloat(val).toFixed(2);
            updateSliderProgress(el);
        }
    }

    const alphaEl = document.getElementById('vec_emo_alpha');
    if(alphaEl) {
        alphaEl.value = alpha;
        document.getElementById('val_emo_alpha').innerText = parseFloat(alpha).toFixed(2);
        updateSliderProgress(alphaEl);
    }

    document.getElementById('vectorEmotionModal').style.display = 'flex';
}

function closeVectorEmotionModal() {
    document.getElementById('vectorEmotionModal').style.display = 'none';
}

function clearVectorEmotion() {
    if (editingVectorSegId !== null) {
        const seg = longTextSegments.find(s => s.id == editingVectorSegId);
        if (seg) {
            seg.emo_vector = null;
            seg.emo_alpha = 0.65;
            if(typeof renderLongTextSegments === 'function') renderLongTextSegments();
        }
    } else {
        activeEmoVector = null;
        activeEmoAlpha = 1.0;
        const display = document.getElementById('vectorEmotionDisplay');
        if(display) display.style.display = 'none';
        const btn = document.getElementById('vectorEmoBtn');
        if(btn) {
            btn.className = "btn-outline-primary btn-sm";
            btn.innerText = "🎛️ 设置情绪向量";
        }
    }
    closeVectorEmotionModal();
}
function saveVectorEmotion() {
    // 🌟 修复 1：使用正确的 ID (vec_emo_0 到 vec_emo_7) 循环获取 8 个滑块的值
    let vector = [];
    for (let i = 0; i < 8; i++) {
        const el = document.getElementById(`vec_emo_${i}`);
        vector.push(el ? parseFloat(el.value) : 0);
    }

    // 🌟 修复 2：使用正确的 ID (vec_emo_alpha) 获取 Alpha 权重的值
    const alphaEl = document.getElementById('vec_emo_alpha');
    const alpha = alphaEl ? parseFloat(alphaEl.value) : 0.65;

    if (editingVectorSegId === 'single') {
        activeEmoVector = vector;
        activeEmoAlpha = alpha;

        // 🌟 更新单句配音的按钮 UI 状态
        const btn = document.getElementById('vectorEmoBtn');
        const clearBtn = document.getElementById('clearVectorEmoBtn');
        if(btn) {
            btn.className = 'btn-outline-danger btn-sm'; // 变成醒目的颜色
            btn.innerHTML = '🎛️ 情绪向量已设置';
        }
        if(clearBtn) {
            clearBtn.style.display = 'block'; // 显示出取消按钮
        }

    } else {
        const seg = longTextSegments.find(s => s.id == editingVectorSegId);
        if (seg) {
            seg.emo_vector = vector;
            seg.emo_alpha = alpha;
            // 重新渲染后，长文本卡片也会自动展示取消按钮
            if(typeof renderLongTextSegments === 'function') renderLongTextSegments();
        }
    }

    // 正常关闭弹窗
    closeVectorEmotionModal();
}

// ==========================================
// 🌟 弹窗内部专属情绪筛选器
// ==========================================
let currentModalEmotionFilter = 'all';

function renderModalEmotionFilters(items) {
    const modalCategories = ['喜', '怒', '哀', '惧', '惊', '厌', '平'];
    const counts = { 'all': items.length };
    modalCategories.forEach(e => counts[e] = 0);

    // 统计数量
    items.forEach(item => {
        let pEmo = '平';
        if (item.emotion) {
            if (typeof item.emotion === 'string') { pEmo = '平'; }
            else { pEmo = item.emotion.primary || '平'; }
        }
        if (counts[pEmo] !== undefined) counts[pEmo]++;
    });

    const bar = document.getElementById('modalEmotionFilterBar');
    if (!bar) return;

    let html = `<div class="emo-filter-tab ${currentModalEmotionFilter === 'all' ? 'active' : ''}" data-filter="all" onclick="setModalEmotionFilter('all')">全部 <span class="emo-filter-count">${counts['all']}</span></div>`;

    modalCategories.forEach(emo => {
        const count = counts[emo];
        const isDisabled = count === 0;
        const isActive = currentModalEmotionFilter === emo;
        const classes = `emo-filter-tab ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;

        html += `<div class="${classes}" data-filter="${emo}" ${isDisabled ? '' : `onclick="setModalEmotionFilter('${emo}')"`}>${emo} <span class="emo-filter-count">${count}</span></div>`;
    });

    bar.innerHTML = html;
}

function setModalEmotionFilter(emo) {
    currentModalEmotionFilter = emo;
    // 更新选中状态的 UI 样式
    document.querySelectorAll('#modalEmotionFilterBar .emo-filter-tab').forEach(tab => {
        if (tab.dataset.filter === emo) tab.classList.add('active');
        else tab.classList.remove('active');
    });
    // 触发双重过滤
    filterLibrary();
}

/**
 * 🌟 核心新增：将当前调节的情绪向量应用到长文本的所有片段
 */
function applyVectorToAll() {
    if (!confirm("确定要将当前情绪配置应用到【所有】长文本片段吗？\n这会覆盖掉其他片段已有的向量设置。")) return;

    // 1. 获取当前弹窗中的向量值
    let vector = [];
    for (let i = 0; i < 8; i++) {
        const el = document.getElementById(`vec_emo_${i}`);
        vector.push(el ? parseFloat(el.value) : 0);
    }
    const alphaEl = document.getElementById('vec_emo_alpha');
    const alpha = alphaEl ? parseFloat(alphaEl.value) : 0.65;

    // 2. 遍历并修改所有长文本片段的数据
    if (typeof longTextSegments !== 'undefined' && longTextSegments.length > 0) {
        longTextSegments.forEach(seg => {
            seg.emo_vector = [...vector]; // 深拷贝数组，防止数据联动污染
            seg.emo_alpha = alpha;
        });

        // 3. 重新渲染长文本列表 UI 以更新显示状态
        if (typeof renderLongTextSegments === 'function') {
            renderLongTextSegments();
        }
        closeVectorEmotionModal();
    } else {
        alert("未发现可应用的文本片段。");
    }
}

/**
 * 🌟 核心新增：将选中的参考音频一键应用到所有长文本片段
 */
function applyReferenceToAll(itemId, charId) {
    const item = globalLibraryCache.find(i => i.id == itemId);
    if (!item) return;

    if (!confirm("确定要将此参考音频应用到【所有】长文本片段吗？\n这会覆盖掉所有片段当前选中的参考音。")) return;

    const cand = {
        text: item.text,
        reason: "人工批量应用",
        ref_audio_url: `/characters/${charId}/${item.filename.replace(/\\/g, '/')}`,
        filename: item.filename,
        emotion: item.emotion
    };

    if (typeof longTextSegments !== 'undefined' && longTextSegments.length > 0) {
        // 1. 遍历所有片段，统一指派参考音
        longTextSegments.forEach(seg => {
            seg.candidates = [cand];
        });

        // 2. 重新渲染列表 UI
        if (typeof renderLongTextSegments === 'function') {
            renderLongTextSegments();
        }

        // 3. 关闭弹窗并提示
        closeLibraryModal();
    }
}

// ==========================================
// ✏️ 修改角色名称的弹窗逻辑
// ==========================================
function closeEditCharNameModal() {
    document.getElementById('editCharNameModal').style.display = 'none';
}

async function saveEditCharName() {
    const charId = document.getElementById('editCharTargetId').value;
    const newName = document.getElementById('editCharNameInput').value.trim();

    if (!newName) return alert("角色名称不能为空！");

    try {
        // 调用后端 API 进行更名
        await apiUpdateCharacterName(charId, newName);

        closeEditCharNameModal();
        // 🌟 调用你原有的加载函数，无感刷新页面
        if (typeof loadCharacters === 'function') {
            loadCharacters();
        }
        alert("✅ 角色名称修改成功！");
    } catch (e) {
        alert("❌ 修改失败：" + e.message);
    }
}