// ==========================================
// api.js - 后端接口通信模块
// ==========================================
// 依赖说明: tunnelHeaders 在 core.js 中定义

async function apiSplitText(text, minLen, maxLen) {
    const res = await fetch('/api/split_text', {
        method: 'POST',
        headers: tunnelHeaders,
        body: JSON.stringify({ text, min_len: minLen, max_len: maxLen })
    });
    if (!res.ok) throw new Error("后端切分引擎无响应");
    return await res.json();
}

async function apiMatchEmotion(payload) {
    const res = await fetch('/api/match', {
        method: 'POST',
        headers: tunnelHeaders,
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "接口报错");
    return data;
}

async function apiSynthesize(payload, signal = null) {
    const fetchOpts = {
        method: 'POST',
        headers: tunnelHeaders,
        body: JSON.stringify(payload)
    };
    if (signal) fetchOpts.signal = signal;
    const res = await fetch('/api/synthesize', fetchOpts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "服务端请求异常");
    return data;
}

async function apiMergeAudio(audioUrls) {
    const res = await fetch('/api/outputs/merge', {
        method: 'POST',
        headers: tunnelHeaders,
        body: JSON.stringify({ audio_urls: audioUrls })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);
    return data;
}

async function apiFetchCharacterDetails(charId) {
    const res = await fetch(`/api/characters/${charId}/details`, { headers: tunnelHeaders });
    return await res.json();
}

// 🌟 新增：发送修改角色名称的请求
async function apiUpdateCharacterName(charId, newName) {
    const resp = await fetch(`/api/characters/${charId}/rename`, {
        method: 'POST',
        headers: {
            ...tunnelHeaders,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ new_name: newName })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || "更名请求失败");
    return data;
}