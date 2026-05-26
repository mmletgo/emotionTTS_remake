let currentDetailCharId = '';
let currentSplitItem = null;
let currentSplitTime = 0.0;

// 🌟 全局严格勾选顺序计数器，用来保证你的合并顺序绝对不会错乱
let globalCheckCounter = 0;

// 🌟 新增：情绪筛选状态
let currentEmotionFilter = 'all';
const EMO_CATEGORIES = ['喜', '怒', '哀', '惧', '惊', '厌', '平'];


function showList() { hideAllConfigSections(); document.getElementById('charListSection').style.display = 'block'; loadCharacters(); }
function showAddForm() {
    hideAllConfigSections();
    document.getElementById('addCharSection').style.display = 'block';
    document.getElementById('charName').value = '';
    document.getElementById('charAvatar').value = '';
    document.getElementById('charAudio').value = '';
    document.getElementById('charSilenceLen').value = '0.8';
    document.getElementById('progressWrapper').style.display = 'none';
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('buildStatus').innerText = '';
    document.getElementById('buildBtn').disabled = false;
}
function hideAllConfigSections() { document.getElementById('charListSection').style.display = 'none'; document.getElementById('addCharSection').style.display = 'none'; document.getElementById('charDetailsSection').style.display = 'none'; }

function refreshLibraryList() {
    const listContainer = document.getElementById('charListContainer');
    if (listContainer) {
        listContainer.innerHTML = globalCharacters.map(c => `
            <div class="library-char-card" data-name="${c.name}">
                <input type="file" id="upload_avatar_${c.id}" accept="image/*" style="display:none" onchange="uploadAvatar('${c.id}')">

                <button class="card-corner-btn top-left" onclick="document.getElementById('upload_avatar_${c.id}').click()" title="更换头像">换头像</button>
                <button class="card-corner-btn top-right" id="export_btn_${c.id}" onclick="exportChar('${c.id}', '${c.name}')" title="打包导出该角色">导出</button>

                <div class="avatar-wrapper">${renderAvatarHTML(c, 'avatar-xl')} <button class="play-overlay-btn" onclick="playPreview('${c.preview_audio}', event, this)" ${!c.preview_audio ? 'disabled' : ''} title="试听音色">▶</button></div>

                <div style="display: flex; align-items: center; justify-content: center; gap: 6px; height: 24px;">
                    <div class="name" title="${c.name}" style="margin: 0; line-height: 1;">${c.name}</div>
                    <div title="修改名称" onclick="prepareEditCharName(event, '${c.id}', '${c.name}')"
                          style="cursor: pointer; opacity: 0.4; transition: 0.2s; display: flex; align-items: center; color: #3498db;"
                          onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.4">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </div>
                </div>

                <div class="count">素材数量: ${c.count} 条</div>

                <div class="actions">
                    <button class="btn-outline-primary btn-sm" onclick="showDetails('${c.id}')">素材库</button>
                    <button class="btn-outline-danger btn-sm" onclick="deleteChar('${c.id}', '${c.name}')">删除</button>
                </div>
            </div>`).join('');
    }
}

// 🌟 新增：打开修改名称弹窗前的准备工作
function prepareEditCharName(event, charId, oldName) {
    event.stopPropagation(); // 阻止触发卡片上的其他点击事件
    document.getElementById('editCharTargetId').value = charId;
    document.getElementById('editCharNameInput').value = oldName;
    document.getElementById('editCharNameModal').style.display = 'flex';
}

async function exportChar(charId, charName) {
    const btn = document.getElementById(`export_btn_${charId}`);
    if (!btn) return;

    const origText = btn.innerText;
    btn.innerText = "⏳ 导出中...";
    btn.disabled = true;

    try {
        const res = await fetch(`/api/characters/${charId}/export`, { headers: tunnelHeaders });
        if (!res.ok) throw new Error("导出失败");

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `角色包_${charName}.zip`;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        btn.innerText = "✅ 成功";
    } catch (e) {
        alert("导出失败：" + e.message);
        btn.innerText = "❌ 失败";
    } finally {
        setTimeout(() => {
            if (btn) {
                btn.innerText = origText;
                btn.disabled = false;
            }
        }, 2000);
    }
}

async function handleImportCharZip(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
        alert("格式错误！请上传之前导出的 ZIP 格式角色包。");
        event.target.value = '';
        return;
    }

    const fd = new FormData();
    fd.append("file", file);

    const btn = document.getElementById('importCharBtn');
    if (btn) {
        btn.innerText = "⏳ 正在解析并导入...";
        btn.disabled = true;
    }

    try {
        const customHeaders = { ...tunnelHeaders };
        delete customHeaders['Content-Type'];

        const res = await fetch('/api/characters/import', {
            method: 'POST',
            headers: customHeaders,
            body: fd
        });
        const data = await res.json();

        if (res.ok) {
            alert("✅ 角色导入成功！");
            loadCharacters();
        } else {
            alert("❌ 导入失败: " + (data.detail || "未知错误"));
        }
    } catch (e) {
        alert("❌ 网络错误或服务器响应超时");
    } finally {
        if (btn) {
            btn.innerText = "📥 导入角色包(ZIP)";
            btn.disabled = false;
        }
        event.target.value = '';
    }
}

function filterMainCharList() {
    const kw = document.getElementById('mainCharSearch').value.toLowerCase().trim();
    document.querySelectorAll('.library-char-card').forEach(item => { item.style.display = item.getAttribute('data-name').toLowerCase().includes(kw) ? 'flex' : 'none'; });
}

async function uploadAvatar(charId) {
    const fileInput = document.getElementById(`upload_avatar_${charId}`); if (!fileInput.files[0]) return;
    const fd = new FormData(); fd.append("avatar", fileInput.files[0]);
    const customHeaders = { ...tunnelHeaders }; delete customHeaders['Content-Type'];
    try { await fetch(`/api/characters/${charId}/avatar`, { method: 'POST', headers: customHeaders, body: fd }); loadCharacters(); } catch(e) { alert("上传失败"); }
}

async function buildCharacter() {
    const name = document.getElementById('charName').value; const files = document.getElementById('charAudio').files;
    const avatar = document.getElementById('charAvatar').files[0]; const silenceLen = document.getElementById('charSilenceLen').value;
    if (!name || files.length === 0) return alert("请填写名字并上传音频");
    const fd = new FormData(); fd.append('char_name', name); fd.append('min_silence_len', silenceLen); if (avatar) fd.append('avatar', avatar);
    for(let i = 0; i < files.length; i++) { fd.append('files', files[i]); }
    document.getElementById('buildBtn').disabled = true; document.getElementById('progressWrapper').style.display = 'block';
    const customHeaders = { ...tunnelHeaders }; delete customHeaders['Content-Type'];
    try {
        const res = await fetch('/api/characters', { method: 'POST', headers: customHeaders, body: fd });
        const data = await res.json();
        pollInterval = setInterval(async () => {
            const r = await fetch(`/api/progress/${data.char_id}`, { headers: tunnelHeaders }); const p = await r.json();
            document.getElementById('progressBar').style.width = p.progress + '%'; document.getElementById('buildStatus').innerText = p.msg;
            if (p.status === 'success' || p.status === 'error') { clearInterval(pollInterval); document.getElementById('buildBtn').disabled = false; if (p.status === 'success') showList(); }
        }, 2000);
    } catch (e) { alert("任务提交失败: " + e.message); document.getElementById('buildBtn').disabled = false; }
}

async function deleteChar(id, name) {
    if (!confirm(`确定删除角色【${name}】吗？`)) return;
    try { await fetch(`/api/characters/${id}`, { method: 'DELETE', headers: tunnelHeaders }); loadCharacters(); } catch (e) { alert("删除失败"); }
}

// 🌟 修复：无论如何点击都保证有一个绝对唯一的自增序列
function updateCheckOrder(el) {
    if (el.checked) el.dataset.checkTime = ++globalCheckCounter;
    else delete el.dataset.checkTime;
}

function toggleSelectAll() {
    const isChecked = document.getElementById('selectAllCheckbox').checked;
    document.querySelectorAll('.item-checkbox').forEach((cb) => {
        // 🌟 只勾选当前界面中未被隐藏的行
        const tr = cb.closest('tr');
        if (tr && tr.style.display !== 'none') {
            cb.checked = isChecked;
            if (isChecked) {
                if (!cb.dataset.checkTime) cb.dataset.checkTime = ++globalCheckCounter;
            }
            else {
                delete cb.dataset.checkTime;
            }
        }
    });
}

async function mergeSelectedItems() {
    const checkboxes = Array.from(document.querySelectorAll('.item-checkbox:checked'));
    checkboxes.sort((a, b) => (parseInt(a.dataset.checkTime) || 0) - (parseInt(b.dataset.checkTime) || 0));
    const selectedIds = checkboxes.map(cb => parseInt(cb.value));

    if (selectedIds.length < 2) return alert("请至少勾选两条需要合并的素材！");
    if (!confirm(`确定将这 ${selectedIds.length} 条合并吗？`)) return;

    const btn = document.getElementById('mergeSelectedBtn');
    let originalText = "合并选中的片段";
    if (btn) {
        originalText = btn.innerText;
        btn.innerText = "⏳ 缝合中...";
        btn.disabled = true;
    }

    try {
        const res = await fetch(`/api/characters/${currentDetailCharId}/items/merge`, {
            method: 'POST',
            headers: tunnelHeaders,
            body: JSON.stringify({ item_ids: selectedIds })
        });
        if (!res.ok) throw new Error("合并失败");

        // 🌟 核心修复：先判断是否存在全选框，存在再去修改它的 checked 属性
        const selectAllCb = document.getElementById('selectAllCheckbox');
        if (selectAllCb) {
            selectAllCb.checked = false;
        }

        // 刷新列表显示最新合并结果
        showDetails(currentDetailCharId, true);
    } catch (e) {
        alert("❌ " + e.message);
    } finally {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }
}

/**
 * 🌟 新增功能：一键清空当前界面的所有情绪标记
 * 方便用户在素材发生大变动后重新进行 AI 批量打标
 */
function clearAllEmotions() {
    // 获取当前界面可见的所有行（考虑到可能有筛选）
    const rows = document.querySelectorAll('#detailsTableBody tr');
    const visibleRows = Array.from(rows).filter(r => r.style.display !== 'none');

    if (visibleRows.length === 0) return;

    if (!confirm(`确定要清空当前显示的 ${visibleRows.length} 条素材的情绪标记吗？\n（注意：清空后需点击“保存更改”才会同步到后台）`)) {
        return;
    }

    visibleRows.forEach(row => {
        const itemId = row.id.split('_')[1];
        if (!itemId) return;

        // 重置主情绪为“平”
        const pSelect = document.querySelector(`.emo-primary[data-id="${itemId}"]`);
        if (pSelect) pSelect.value = '平';

        // 重置强度为“Medium”
        const iSelect = document.querySelector(`.emo-intensity[data-id="${itemId}"]`);
        if (iSelect) iSelect.value = 'Medium';

        // 清空复合情绪描述
        const cInput = document.querySelector(`.emo-complex[data-id="${itemId}"]`);
        if (cInput) cInput.value = '';
    });

    alert("✅ 界面显示已清空！请记得点击旁边的【保存更改】按钮以持久化到服务器。");
}


// 🌟 新增：动态渲染情绪筛选标签
function renderEmotionFilters(items) {
    const counts = { 'all': items.length };
    EMO_CATEGORIES.forEach(e => counts[e] = 0);

    // 统计各情绪数量
    items.forEach(item => {
        let pEmo = '平';
        if (item.emotion) {
            if (typeof item.emotion === 'string') { pEmo = '平'; }
            else { pEmo = item.emotion.primary || '平'; }
        }
        if (counts[pEmo] !== undefined) counts[pEmo]++;
    });

    const bar = document.getElementById('emotionFilterBar');
    if (!bar) return;

    // 渲染【全部】标签
    let html = `<div class="emo-filter-tab ${currentEmotionFilter === 'all' ? 'active' : ''}" data-filter="all" onclick="setEmotionFilter('all')">全部 <span class="emo-filter-count">${counts['all']}</span></div>`;

    // 渲染【7个情绪】标签
    EMO_CATEGORIES.forEach(emo => {
        const count = counts[emo];
        const isDisabled = count === 0;
        const isActive = currentEmotionFilter === emo;
        const classes = `emo-filter-tab ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;

        html += `<div class="${classes}" data-filter="${emo}" ${isDisabled ? '' : `onclick="setEmotionFilter('${emo}')"`}>${emo} <span class="emo-filter-count">${count}</span></div>`;
    });

    bar.innerHTML = html;
}

// 🌟 新增：点击标签执行筛选隐藏/显示逻辑
function setEmotionFilter(emo) {
    currentEmotionFilter = emo;

    // 1. 更新 UI 标签的选中高亮状态
    document.querySelectorAll('#emotionFilterBar .emo-filter-tab').forEach(tab => {
        if (tab.dataset.filter === emo) tab.classList.add('active');
        else tab.classList.remove('active');
    });

    // 2. 遍历隐藏或显示表格里的数据行
    const rows = document.querySelectorAll('#detailsTableBody tr');
    rows.forEach(row => {
        if (!row.id || !row.id.startsWith('row_')) return;

        const checkbox = row.querySelector('.item-checkbox');

        if (emo === 'all' || row.dataset.emo === emo) {
            row.style.display = ''; // 匹配则显示
        } else {
            row.style.display = 'none'; // 不匹配则隐藏
            // 为了防止后台合并出错，隐藏时主动取消勾选
            if (checkbox && checkbox.checked) {
                checkbox.checked = false;
                delete checkbox.dataset.checkTime;
            }
        }
    });

    // 取消全选框的状态
    const selectAllCb = document.getElementById('selectAllCheckbox');
    if(selectAllCb) selectAllCb.checked = false;
}

async function showDetails(charId, keepScroll = false) {
    if (!keepScroll) hideAllConfigSections(); currentDetailCharId = charId;
    const detailsSection = document.getElementById('charDetailsSection'); const tbody = document.getElementById('detailsTableBody'); const scrollContainer = document.querySelector('.details-table-container');
    let savedScroll = 0; if (keepScroll && scrollContainer) { savedScroll = scrollContainer.scrollTop; } else { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">正在读取...</td></tr>'; }
    detailsSection.style.display = 'block';
    try {
        const res = await fetch(`/api/characters/${charId}/details`, { headers: tunnelHeaders }); const data = await res.json();

        // 🌟 正确的位置：把数据挂载到全局，供清理碎音按钮使用
        window.currentDetailItems = data.items;

        document.getElementById('detailsCharName').innerText = data.char_name; document.getElementById('detailsCharCount').innerText = `共 ${data.items.length} 个片段`;

        // 🌟 新增：动态渲染角色头像
        const charObj = globalCharacters.find(c => c.id == charId);
        const avatarContainer = document.getElementById('detailsCharAvatar');
        if (avatarContainer) {
            avatarContainer.innerHTML = charObj ? renderAvatarHTML(charObj) : '<div class="default-avatar">?</div>';
        }

        tbody.innerHTML = data.items.map(item => {
            let pEmo = '平', cEmo = '', iEmo = 'Medium';
            if (item.emotion) { if (typeof item.emotion === 'string') { cEmo = item.emotion; } else { pEmo = item.emotion.primary || '平'; cEmo = item.emotion.complex || ''; iEmo = item.emotion.intensity || 'Medium'; } }
            const primaryOptions = EMO_PRIMARIES.map(p => `<option value="${p}" ${pEmo === p ? 'selected' : ''}>${p}</option>`).join('');
            const intensityOptions = EMO_INTENSITIES.map(i => `<option value="${i}" ${iEmo === i ? 'selected' : ''}>${i}</option>`).join('');

            return `<tr id="row_${item.id}" data-emo="${pEmo}">
                <td style="text-align: center; vertical-align: middle;">
                    <input type="checkbox" class="item-checkbox" value="${item.id}" onchange="updateCheckOrder(this)">
                </td>

                <td>
                    <textarea class="text-input" id="text_${item.id}">${item.text}</textarea>
                </td>
                <td>
                    <div class="emo-box">
                        <div class="emo-row">
                            <select class="emo-select emo-primary" data-id="${item.id}">${primaryOptions}</select>
                            <select class="emo-select emo-intensity" data-id="${item.id}">${intensityOptions}</select>
                        </div>
                        <input type="text" class="emo-input emo-complex" data-id="${item.id}" value="${cEmo}" placeholder="复合情绪描述...">
                    </div>
                </td>
                <td class="td-audio">
                    <audio src="/characters/${charId}/${item.filename.replace(/\\/g, '/')}?t=${Date.now()}" preload="none" controls style="height: 35px; width: 100%;"></audio>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; flex-direction: row; gap: 12px; justify-content: center;">
                            <button class="btn-outline-primary btn-sm" onclick="openManualSplitModal(${item.id}, '${item.filename.replace(/\\/g, '/')}')">精切</button>
                            <button class="btn-outline-danger btn-sm" onclick="deleteItem(${item.id})">删除</button>
                        </div>
                    </div>
                </td>

                <td style="text-align: center; vertical-align: middle;">
                    <label style="cursor: pointer; font-size: 30px; user-select: none; line-height: 1;" title="设为优先匹配">
                        <input type="checkbox" class="api-safe-cb" data-id="${item.id}" ${item.is_api_safe ? 'checked' : ''} style="display: none;" onchange="const s = this.nextElementSibling; if(this.checked){ s.innerText='♥'; s.style.color='#e74c3c'; }else{ s.innerText='♡'; s.style.color='#bdc3c7'; }">
                        <span style="display: inline-block; transition: 0.2s; color: ${item.is_api_safe ? '#e74c3c' : '#bdc3c7'};">${item.is_api_safe ? '♥' : '♡'}</span>
                    </label>
                </td>
            </tr>`;
        }).join('');

        // 🌟 关键修改：渲染情绪标签筛选栏，并默认重置为 'all'
        if (!keepScroll) {
            currentEmotionFilter = 'all';
        }
        renderEmotionFilters(data.items);
        setEmotionFilter(currentEmotionFilter);

        if (keepScroll && scrollContainer) scrollContainer.scrollTop = savedScroll;
    } catch (e) { tbody.innerHTML = '<tr><td colspan="5">加载失败</td></tr>'; }
}

async function saveAllChanges() {
    const textInputs = document.querySelectorAll('#detailsTableBody .text-input');
    const updates = {};

    textInputs.forEach(input => {
        if (!input.id || !input.id.startsWith('text_')) return;
        const itemId = parseInt(input.id.split('_')[1]);
        const pEmo = document.querySelector(`.emo-primary[data-id="${itemId}"]`).value;
        const iEmo = document.querySelector(`.emo-intensity[data-id="${itemId}"]`).value;
        const cEmo = document.querySelector(`.emo-complex[data-id="${itemId}"]`).value;

        // 🌟 获取对应 ID 的【🌟 优先匹配】勾选框状态
        const isApiSafeCb = document.querySelector(`.api-safe-cb[data-id="${itemId}"]`);
        const isApiSafe = isApiSafeCb ? isApiSafeCb.checked : false;

        // 🌟 将 is_api_safe 加入到更新包中，一起发给后端
        updates[itemId] = {
            text: input.value,
            emotion: { primary: pEmo, complex: cEmo, intensity: iEmo },
            is_api_safe: isApiSafe
        };
    });

    const btn = document.getElementById('saveAllBtn');
    const originalText = btn.innerText;
    btn.innerText = "⏳ 保存中...";
    btn.disabled = true;

    try {
        const res = await fetch(`/api/characters/${currentDetailCharId}/items`, {
            method: 'PUT',
            headers: tunnelHeaders,
            body: JSON.stringify({ updates: updates })
        });
        if (!res.ok) throw new Error("保存失败");

        btn.innerText = "✅ 成功";
        showDetails(currentDetailCharId, true);
        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
        }, 1500);
    } catch (e) {
        alert("批量保存失败！");
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function deleteItem(itemId) {
    if (!confirm("⚠️ 确定要删除这条素材吗？")) return;
    try {
        const res = await fetch(`/api/characters/${currentDetailCharId}/items/${itemId}`, { method: 'DELETE', headers: tunnelHeaders });
        if (res.ok) { document.getElementById(`row_${itemId}`).remove(); const countSpan = document.getElementById('detailsCharCount'); countSpan.innerText = `共 ${parseInt(countSpan.innerText.replace(/[^0-9]/g, '')) - 1} 个片段`; }
        else { alert("删除失败！"); }
    } catch (e) {}
}

async function batchAnalyzeEmotions() {
    const rows = document.querySelectorAll('tbody tr'); const statusText = document.getElementById('batchAnalyzeStatus'); let tasks = [];
    rows.forEach(row => { const itemId = row.id.split('_')[1]; if (!itemId) return; const complexVal = document.querySelector(`.emo-complex[data-id="${itemId}"]`).value.trim(); if (complexVal === '') tasks.push(itemId); });
    if (tasks.length === 0) { statusText.style.color = "#2ecc71"; statusText.innerText = "已打标，无需分析！"; setTimeout(() => statusText.innerText = "", 3000); return; }
    statusText.style.color = "#e67e22"; let processedCount = 0;
    for (let itemId of tasks) {
        processedCount++; const textContent = document.getElementById(`text_${itemId}`).value; const cInput = document.querySelector(`.emo-complex[data-id="${itemId}"]`);
        cInput.placeholder = "🤖 脑补中..."; statusText.innerText = `🚀 正在狂奔：${processedCount} / ${tasks.length}`;
        try {
            const res = await fetch('/api/analyze_emotion', { method: 'POST', headers: tunnelHeaders, body: JSON.stringify({ text: textContent }) });
            const data = await res.json();


            if (res.ok) {
                const eData = data.emotion;
                document.querySelector(`.emo-primary[data-id="${itemId}"]`).value = eData.primary || '平'; document.querySelector(`.emo-intensity[data-id="${itemId}"]`).value = eData.intensity || 'Medium'; cInput.value = eData.complex || '';
                const itemUpdates = {}; itemUpdates[itemId] = { text: textContent, emotion: eData };
                await fetch(`/api/characters/${currentDetailCharId}/items`, { method: 'PUT', headers: tunnelHeaders, body: JSON.stringify({ updates: itemUpdates }) });
            } else {
                cInput.placeholder = "分析失败";
                alert(`❌ [ID ${itemId} 分析失败]: ` + (data.detail || "未知报错"));
            }
        } catch (e) {
            cInput.placeholder = "报错";
            alert(`❌ 网络或系统异常: ` + e.message);
            break;
        }
    }
    statusText.style.color = "#2ecc71"; statusText.innerText = "✅ 自动打标完毕！"; setTimeout(() => statusText.innerText = "", 4000);
}

function toggleManualAddForm() {
    const form = document.getElementById('manualAddForm'); form.style.display = form.style.display === 'none' ? 'block' : 'none';
    document.getElementById('appendProgressWrapper').style.display = 'none'; document.getElementById('appendProgressBar').style.width = '0%'; document.getElementById('appendStatus').innerText = '';
}

async function submitAppendItem() {
    const files = document.getElementById('appendAudioFile').files; const silenceLen = document.getElementById('appendSilenceLen').value;
    if (files.length === 0) return alert("❌ 请上传音频文件！");
    const fd = new FormData(); fd.append('min_silence_len', silenceLen);
    for(let i = 0; i < files.length; i++) { fd.append('files', files[i]); }
    const customHeaders = { ...tunnelHeaders }; delete customHeaders['Content-Type'];
    const btn = document.getElementById('appendBtn'); btn.disabled = true; document.getElementById('appendProgressWrapper').style.display = 'block';
    try {
        const res = await fetch(`/api/characters/${currentDetailCharId}/append`, { method: 'POST', headers: customHeaders, body: fd });
        const data = await res.json(); if (!res.ok) throw new Error(data.detail || "报错");
        pollInterval = setInterval(async () => {
            const r = await fetch(`/api/progress/${currentDetailCharId}_append`, { headers: tunnelHeaders }); const p = await r.json();
            document.getElementById('appendProgressBar').style.width = p.progress + '%'; document.getElementById('appendStatus').innerText = p.msg;
            if (p.status === 'success' || p.status === 'error') {
                clearInterval(pollInterval); btn.disabled = false;
                if (p.status === 'success') { document.getElementById('appendAudioFile').value = ''; setTimeout(() => { toggleManualAddForm(); showDetails(currentDetailCharId, true); }, 1000); }
            }
        }, 2000);
    } catch (e) { alert("追加失败: " + e.message); btn.disabled = false; }
}

function openManualSplitModal(itemId, filename) {
    currentSplitItem = itemId; currentSplitTime = 0.0;
    document.getElementById('splitAudio').src = `/characters/${currentDetailCharId}/${filename}?t=${Date.now()}`;
    document.getElementById('splitTimeDisplay').innerText = "0.00"; document.getElementById('manualSplitModal').style.display = 'flex';
}
function closeManualSplitModal() { document.getElementById('splitAudio').pause(); document.getElementById('manualSplitModal').style.display = 'none'; }
document.getElementById('splitAudio').addEventListener('timeupdate', function(e) { currentSplitTime = this.currentTime; document.getElementById('splitTimeDisplay').innerText = currentSplitTime.toFixed(2); });

async function confirmManualSplit() {
    if (currentSplitTime <= 0.5) return alert("下刀点太靠前了！");
    const btn = document.getElementById('confirmSplitBtn'); const originalText = btn.innerText; btn.disabled = true; btn.innerText = "⏳ 物理切割中...";
    try {
        const res = await fetch(`/api/characters/${currentDetailCharId}/items/${currentSplitItem}/manual_split`, { method: 'POST', headers: tunnelHeaders, body: JSON.stringify({ split_time: currentSplitTime }) });
        if (res.ok) { closeManualSplitModal(); showDetails(currentDetailCharId, true); } else { alert("切分失败"); }
    } catch(e) {} finally { btn.disabled = false; btn.innerText = originalText; }
}

/**
 * 🤫 隐藏功能：一键扫描并批量删除极短碎音
 * 触发条件：双击角色卡片上的“共 XX 个片段”文本
 */
async function autoCleanShortItems() {
    if (!window.currentDetailItems || window.currentDetailItems.length === 0) return;

    // 1. 定义“碎音”标准：时长不足 1.8 秒，或者文本长度小于等于 2 个字
    const shortItems = window.currentDetailItems.filter(item => {
        if (item.duration !== undefined && item.duration > 0) {
            return item.duration <= 3.5;
        }
        return item.text.trim().length <= 15;
    });

    if (shortItems.length === 0) {
        alert("🕵️ 扫描完毕：当前素材库非常健康，未发现需要清理的极短碎音！");
        return;
    }

    // 2. 二次确认
    if (!confirm(`🤫 隐藏功能触发成功！\n\n系统扫描到 ${shortItems.length} 条可能是无效语气词的极短碎音素材。\n你要一键将它们全部【永久删除】吗？`)) {
        return;
    }

    const countSpan = document.getElementById('detailsCharCount');
    const origText = countSpan.innerText;

    try {
        let deletedCount = 0;
        // 3. 采用安全的串行删除，防止并发过高冲垮服务器或把 JSON 写坏
        for (let item of shortItems) {
            countSpan.innerText = `⏳ 正在抹杀碎音 (${deletedCount}/${shortItems.length})...`;
            countSpan.style.color = "#e74c3c";

            await fetch(`/api/characters/${currentDetailCharId}/items/${item.id}`, {
                method: 'DELETE',
                headers: tunnelHeaders
            });
            deletedCount++;
        }
        alert(`✅ 清理行动完成！成功删除了 ${deletedCount} 条碎音素材！`);
    } catch (e) {
        alert("❌ 清理过程中发生网络中断：" + e.message);
    } finally {
        countSpan.style.color = "#7f8c8d";
        // 4. 清理完毕后重新拉取最新列表
        showDetails(currentDetailCharId, true);
    }
}