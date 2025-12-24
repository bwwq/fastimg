// State
let currentUser = null;
let currentPage = 1;
let currentImage = null;
let csrfToken = null;

// DOM Cache
const dom = {
    sidebar: document.getElementById('sidebar'),
    hero: document.getElementById('heroSection'),
    dashboard: document.getElementById('dashboardSection'),
    galleryGrid: document.getElementById('imageGrid'),
    toastContainer: document.getElementById('toastContainer'),
    // Views
    viewGallery: document.getElementById('viewGallery'),
    viewUpload: document.getElementById('viewUpload')
};

// Init
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await fetchCsrfToken();
    checkAuth();
    setupEventListeners();
});

// --- CSRF Token ---
async function fetchCsrfToken() {
    try {
        const res = await fetch('/api/csrf-token');
        const data = await res.json();
        csrfToken = data.csrf_token;
    } catch (e) {
        console.error('Failed to fetch CSRF token');
    }
}

// Global fetch interceptor for CSRF
const originalFetch = window.fetch;
window.fetch = function (url, options = {}) {
    if (csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            options.headers.set('X-CSRFToken', csrfToken);
        } else {
            options.headers['X-CSRFToken'] = csrfToken;
        }
    }
    return originalFetch(url, options);
};

// --- Theme Logic ---
function initTheme() {
    const saved = localStorage.getItem('theme') || 'slate';
    setTheme(saved);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // Update active state in menu
    document.querySelectorAll('.theme-option').forEach(el => {
        el.classList.toggle('active', el.innerText.trim().toLowerCase() === theme);
    });

    // Hide menu after selection
    document.getElementById('themeMenu').classList.add('hidden');

    // Refresh icons just in case color changed
    if (window.feather) feather.replace();
}

function toggleThemeMenu() {
    document.getElementById('themeMenu').classList.toggle('hidden');
}

// --- Auth ---
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            currentUser = await res.json();
            updateUI(true);
            loadImages(1);
        } else {
            updateUI(false);
        }
    } catch (e) {
        updateUI(false);
    }
}

function updateUI(isLoggedIn) {
    const container = document.querySelector('.app-container');

    if (isLoggedIn) {
        dom.hero.classList.add('hidden');
        dom.dashboard.classList.remove('hidden');
        dom.sidebar.classList.remove('hidden');
        container.classList.add('has-sidebar');

        // Sidebar Info
        document.getElementById('sidebarUsername').innerText = currentUser.username;
        document.getElementById('sidebarRole').innerText = currentUser.role;
        document.getElementById('sidebarAvatar').innerText = currentUser.username[0].toUpperCase();

        // Admin Link
        if (currentUser.role === 'admin') {
            document.getElementById('adminLink').innerHTML = `
                <div class="nav-item" onclick="showAdminModal()">
                    <i data-feather="settings"></i> 系统设置
                </div>
            `;
        }

    } else {
        dom.hero.classList.remove('hidden');
        dom.dashboard.classList.add('hidden');
        dom.sidebar.classList.add('hidden');
        container.classList.remove('has-sidebar');
    }

    if (window.feather) feather.replace();
}

async function login(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (res.ok) {
        closeModal('loginModal');
        checkAuth();
        showToast('登录成功');
    } else {
        showToast((await res.json()).error || '登录失败', 'error');
    }
}

async function register(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (res.ok) {
        closeModal('registerModal');
        showToast('注册成功，请登录');
        showModal('loginModal');
    } else {
        showToast((await res.json()).error || '注册失败', 'error');
    }
}

async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
}

// --- Navigation ---
function switchView(viewName, resetFilter = false) {
    // Hide all views
    dom.viewGallery.classList.add('hidden');
    dom.viewUpload.classList.add('hidden');

    // Update Nav Active State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (viewName === 'gallery') {
        dom.viewGallery.classList.remove('hidden');
        document.querySelector('.nav-item:nth-child(1)').classList.add('active');

        if (resetFilter) {
            filterUserId = null;
            filterUsername = null;
            currentPage = 1;
        }
        loadImages(currentPage);
    } else if (viewName === 'upload') {
        dom.viewUpload.classList.remove('hidden');
        document.querySelector('.nav-item:nth-child(2)').classList.add('active');
        loadMaxQuality(); // Refresh quality limit when viewing upload
    }
}

// --- Images ---
let currentSort = 'time_desc';
let currentViewMode = 'grid';
let filterUserId = null;
let filterUsername = null;

let lastLoadImagesTimestamp = 0;

async function loadImages(page) {
    const timestamp = Date.now();
    lastLoadImagesTimestamp = timestamp;

    currentPage = page;
    const sort = currentSort.split('_');
    const sortBy = sort[0]; // time, size, name
    const sortOrder = sort[1]; // asc, desc

    let url = `/api/images?page=${page}&sort=${sortBy}&order=${sortOrder}`;
    if (filterUserId) {
        url += `&user_id=${filterUserId}`;
        // Show indicator that we are filtering
        const header = document.querySelector('.gallery-header h2');
        if (header && !header.originalText) header.originalText = header.innerText;
        if (header) header.innerText = `${filterUsername || '用户'} 的图片`;
    } else {
        const header = document.querySelector('.gallery-header h2');
        if (header && header.originalText) header.innerText = header.originalText;
    }

    // Indicate loading but keep content
    dom.galleryGrid.style.opacity = '0.5';
    dom.galleryGrid.style.pointerEvents = 'none'; // Prevent clicks while loading

    try {
        const res = await fetch(url);
        // Race condition check: if a newer request started, ignore this one
        if (timestamp !== lastLoadImagesTimestamp) return;

        const data = await res.json();

        dom.galleryGrid.innerHTML = '';
        dom.galleryGrid.style.opacity = '1';
        dom.galleryGrid.style.pointerEvents = 'auto';

        if (data.images.length === 0) {
            dom.galleryGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;margin-top:2rem;opacity:0.7">暂无图片，去上传一张吧</p>';
        }

        data.images.forEach((img, index) => {
            const div = document.createElement('div');
            div.className = 'img-card fade-in';
            div.style.animationDelay = `${index * 0.05}s`;

            const sizeStr = img.size > 1024 * 1024
                ? (img.size / (1024 * 1024)).toFixed(1) + ' MB'
                : (img.size / 1024).toFixed(1) + ' KB';

            div.innerHTML = `
            <img src="/i/${img.filename}" loading="lazy" alt="${img.original_name}">
            <div class="img-overlay">
                <div class="img-name">${img.original_name}</div>
                <div class="img-meta">
                    <span>${sizeStr}</span>
                    <span>${img.width}×${img.height}</span>
                </div>
            </div>
        `;
            div.onclick = () => showDetail(img);
            dom.galleryGrid.appendChild(div);
        });

        // Update Stats
        document.getElementById('statTotal').innerText = `${data.total} 张图片`;

        // Pagination Controls
        const pag = document.getElementById('pagination');
        if (data.pages > 1) {
            pag.classList.remove('hidden');
            document.getElementById('pageIndicator').innerText = `${data.current_page} / ${data.pages}`;
        } else {
            pag.classList.add('hidden');
        }

        // Refresh icons
        if (window.feather) feather.replace();
    } catch (e) {
        if (timestamp !== lastLoadImagesTimestamp) return;
        dom.galleryGrid.style.opacity = '1';
        dom.galleryGrid.style.pointerEvents = 'auto';
        console.error(e);
    }
}

function changeSortOrder() {
    currentSort = document.getElementById('sortSelect').value;
    loadImages(1); // Reset to first page when sorting changes
}

function setViewMode(mode) {
    currentViewMode = mode;

    // Update button states
    document.getElementById('viewGrid').classList.toggle('active', mode === 'grid');
    document.getElementById('viewList').classList.toggle('active', mode === 'list');

    // Update grid class
    if (mode === 'list') {
        dom.galleryGrid.classList.add('list-view');
    } else {
        dom.galleryGrid.classList.remove('list-view');
    }
}

function prevPage() {
    if (currentPage > 1) loadImages(currentPage - 1);
}
function nextPage() {
    // logic needed to check max page, or API handles it
    loadImages(currentPage + 1);
}

// --- Upload ---
let uploadQueue = [];
let isUploading = false;
let maxQualityLimit = 100;

// Load max quality limit from admin config
async function loadMaxQuality() {
    try {
        const res = await fetch('/api/public/config');
        if (res.ok) {
            const data = await res.json();
            if (data.compress_quality) {
                maxQualityLimit = parseInt(data.compress_quality) || 100;
                const slider = document.getElementById('uploadQuality');
                const hint = document.getElementById('maxQualityHint');
                const checkbox = document.getElementById('originalModeCheck');
                const container = document.getElementById('originalModeContainer');

                // Show/Hide Original Mode based on admin limit
                if (maxQualityLimit >= 100) {
                    container.style.display = 'flex';
                } else {
                    container.style.display = 'none';
                    if (checkbox) checkbox.checked = false;
                }

                // Load previous settings
                const savedQuality = localStorage.getItem('uploadQuality');
                const savedOriginal = localStorage.getItem('originalMode') === 'true';
                const savedStrict = localStorage.getItem('strictMode') === 'true';
                const strictCheck = document.getElementById('strictModeCheck');

                if (slider) {
                    slider.max = maxQualityLimit;
                    const wrapper = document.getElementById('qualitySliderWrapper');

                    if (savedStrict && maxQualityLimit >= 100) {
                        // Restore strict mode
                        strictCheck.checked = true;
                        checkbox.checked = true;
                        checkbox.disabled = true;
                        wrapper.style.display = 'none';
                        slider.value = 100;
                    } else if (savedOriginal && maxQualityLimit >= 100) {
                        checkbox.checked = true;
                        wrapper.style.display = 'none';
                        slider.value = 100;
                    } else if (savedQuality) {
                        wrapper.style.display = 'block';
                        slider.value = Math.min(parseInt(savedQuality), maxQualityLimit);
                        document.getElementById('qualityValue').innerText = slider.value + '%';
                    }
                }
                if (hint) hint.innerText = maxQualityLimit;
            }
        }
    } catch (e) {
        // Ignore, use default
    }
}

function toggleOriginalMode() {
    const checkbox = document.getElementById('originalModeCheck');
    const wrapper = document.getElementById('qualitySliderWrapper');
    const slider = document.getElementById('uploadQuality');

    const isOriginal = checkbox.checked;
    localStorage.setItem('originalMode', isOriginal);

    if (isOriginal) {
        wrapper.style.display = 'none';
        slider.value = 100;
    } else {
        wrapper.style.display = 'block';
        const saved = localStorage.getItem('uploadQuality') || 80;
        slider.value = Math.min(parseInt(saved), maxQualityLimit);
        document.getElementById('qualityValue').innerText = slider.value + '%';
    }
}

function toggleStrictMode() {
    const strictCheck = document.getElementById('strictModeCheck');
    const originalCheck = document.getElementById('originalModeCheck');
    const wrapper = document.getElementById('qualitySliderWrapper');

    const isStrict = strictCheck.checked;
    localStorage.setItem('strictMode', isStrict);

    if (isStrict) {
        // Strict mode: also enables original mode implicitly
        wrapper.style.display = 'none';
        originalCheck.checked = true;
        originalCheck.disabled = true; // Can't uncheck original if strict is on
        localStorage.setItem('originalMode', true);
    } else {
        originalCheck.disabled = false;
        // If original is still checked, keep slider hidden
        if (!originalCheck.checked) {
            wrapper.style.display = 'block';
        }
    }
}

async function uploadFiles(files) {
    if (!files || files.length === 0) return;

    // Determine quality and passthrough
    let quality = 80;
    const isOriginal = document.getElementById('originalModeCheck')?.checked;
    const isStrict = document.getElementById('strictModeCheck')?.checked;
    const passthrough = isStrict; // Only strict mode triggers passthrough

    if (isOriginal || isStrict) {
        quality = 100;
    } else {
        quality = Math.min(
            parseInt(document.getElementById('uploadQuality')?.value || 80),
            maxQualityLimit
        );
    }

    // Add to queue
    const queueContainer = document.getElementById('uploadQueue');
    const queueList = document.getElementById('queueList');
    queueContainer.classList.remove('hidden');

    for (const file of files) {
        const id = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        uploadQueue.push({ id, file, quality, passthrough, status: 'pending' });

        // Add UI element
        const el = document.createElement('div');
        el.id = id;
        el.className = 'card';
        el.style.cssText = 'padding: 0.75rem 1rem; display: flex; align-items: center; gap: 1rem';
        el.innerHTML = `
            <div style="flex:1; min-width:0">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem">
                    <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%">${file.name}</div>
                    <div class="upload-status" style="font-size:0.85rem; color:var(--text-secondary)">等待中</div>
                </div>
                <div class="progress-bar-bg" style="height:4px; border-radius:2px">
                    <div class="progress-bar-fill" style="width:0%"></div>
                </div>
            </div>
        `;
        queueList.appendChild(el);
    }

    processQueue();
}

async function processQueue() {
    if (isUploading) return;

    const pending = uploadQueue.find(u => u.status === 'pending');
    if (!pending) return;

    isUploading = true;
    pending.status = 'uploading';

    const el = document.getElementById(pending.id);
    const statusEl = el?.querySelector('.upload-status');
    const progressEl = el?.querySelector('.progress-bar-fill');

    if (statusEl) statusEl.textContent = '准备上传...';

    const formData = new FormData();
    formData.append('file', pending.file);
    formData.append('quality', pending.quality);
    if (pending.passthrough) {
        formData.append('passthrough', 'true');
    }

    // Use XHR for progress events
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && progressEl) {
            const percent = (e.loaded / e.total) * 100;
            progressEl.style.width = `${percent}%`;
            // 99% doesn't mean server processing done
            if (percent < 100) {
                if (statusEl) statusEl.textContent = `上传中 ${Math.round(percent)}%`;
            } else {
                if (statusEl) statusEl.textContent = '服务器处理中...';
            }
        }
    };

    xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            const img = JSON.parse(xhr.responseText);
            pending.status = 'done';
            if (statusEl) {
                statusEl.textContent = '完成';
                statusEl.style.color = 'var(--success)';
            }
            if (progressEl) progressEl.style.width = '100%';

            // If only one file, show detail
            if (uploadQueue.length === 1) {
                showDetail(img);
            }
        } else {
            let err = { error: 'Unknown error' };
            try { err = JSON.parse(xhr.responseText); } catch (e) { }

            pending.status = 'error';
            if (statusEl) {
                statusEl.textContent = err.error || '失败';
                statusEl.style.color = 'var(--danger)';
            }
            if (progressEl) progressEl.style.backgroundColor = 'var(--danger)';
        }

        isUploading = false;
        checkNext();
    };

    xhr.onerror = () => {
        pending.status = 'error';
        if (statusEl) {
            statusEl.textContent = '网络中断';
            statusEl.style.color = 'var(--danger)';
        }
        isUploading = false;
        checkNext();
    };

    xhr.open('POST', '/api/upload');
    if (csrfToken) {
        xhr.setRequestHeader('X-CSRFToken', csrfToken);
    }
    xhr.send(formData);
}

function checkNext() {
    // Process next in queue (extracted helper)

    // Process next in queue
    const remaining = uploadQueue.filter(u => u.status === 'pending').length;
    if (remaining > 0) {
        processQueue();
    } else {
        // All done
        const doneCount = uploadQueue.filter(u => u.status === 'done').length;
        const errorCount = uploadQueue.filter(u => u.status === 'error').length;
        if (doneCount > 0) {
            showToast(`上传完成: ${doneCount} 成功${errorCount > 0 ? ', ' + errorCount + ' 失败' : ''}`);
            loadImages(1); // Refresh gallery
        } else if (errorCount > 0) {
            showToast(`上传失败: ${errorCount} 个文件`, 'error');
        }
        // Clear queue after a delay
        setTimeout(() => {
            uploadQueue = [];
            document.getElementById('queueList').innerHTML = '';
            document.getElementById('uploadQueue').classList.add('hidden');
        }, 3000);
    }
}

function setupEventListeners() {
    document.getElementById('loginForm').onsubmit = login;
    document.getElementById('registerForm').onsubmit = register;

    // DnD
    const zone = document.getElementById('dropZone');
    const input = document.getElementById('fileInput');

    // Quality Slider
    const slider = document.getElementById('uploadQuality');
    if (slider) {
        slider.oninput = (e) => {
            document.getElementById('qualityValue').innerText = e.target.value + '%';
        };
        slider.onchange = (e) => {
            localStorage.setItem('uploadQuality', e.target.value);
        };
    }

    zone.onclick = () => input.click();
    input.onchange = (e) => uploadFiles(e.target.files);

    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        uploadFiles(e.dataTransfer.files);
    };

    document.onpaste = (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const files = [];
        for (let item of items) {
            if (item.kind === 'file') files.push(item.getAsFile());
        }
        if (files.length > 0) uploadFiles(files);
    };

    // Load max quality on init
    loadMaxQuality();
}

// --- Detail Modal ---
function showDetail(img) {
    currentImage = img;
    document.getElementById('detailImg').src = `/i/${img.filename}`;
    document.getElementById('detailTitle').innerText = img.original_name;
    document.getElementById('detailSize').innerText = (img.size / 1024).toFixed(1) + ' KB';
    document.getElementById('detailDims').innerText = `${img.width} x ${img.height}`;
    document.getElementById('detailViews').innerText = `${img.views || 0} Views`;

    const url = `${window.location.origin}/i/${img.filename}`;
    document.getElementById('linkDirect').value = url;
    document.getElementById('linkMarkdown').value = `![${img.original_name}](${url})`;

    showModal('detailModal');
}

async function deleteCurrentImg() {
    if (!confirm('确定删除?')) return;
    const res = await fetch(`/api/images/${currentImage.id}`, { method: 'DELETE' });
    if (res.ok) {
        closeModal('detailModal');
        loadImages(currentPage);
        showToast('已删除');
    }
}

// --- Admin ---
// --- Admin ---
// --- Admin Config Metadata ---
const CONFIG_META = {
    // 基础设置
    'system_notice': { group: 'basic', label: '系统公告', desc: '显示在首页的欢迎信息', type: 'text' },
    'ENABLE_INVITE_CODE': { group: 'basic', label: '开启邀请码注册', desc: '开启后用户必须使用邀请码注册', type: 'switch' },

    // 上传控制
    'MAX_UPLOAD_SIZE': { group: 'upload', label: '单文件上传限制', desc: '单位: MB。默认 5MB', type: 'number', unit: 'MB' },
    'user_quota': { group: 'upload', label: '用户总容量配额', desc: '单位: MB。每个用户的最大存储空间', type: 'number', unit: 'MB' },
    'ALLOWED_EXTS': { group: 'upload', label: '允许的文件后缀', desc: '用逗号分隔 (留空则使用默认: jpg,png,gif,webp)', type: 'text' },

    // 图片处理
    'compress_quality': { group: 'process', label: '压缩质量限制', desc: '上传时自动压缩的目标质量 (10-100)', type: 'range', min: 10, max: 100 },
    'ENABLE_WEBP_CONVERT': { group: 'process', label: '自动转 WebP', desc: '自动将上传的 JPG/PNG 转换为 WebP 以节省空间', type: 'switch' },
    'WATERMARK_TEXT': { group: 'process', label: '水印文字', desc: '留空则不添加水印', type: 'text' },
    'WATERMARK_OPACITY': { group: 'process', label: '水印透明度', desc: '0 (透明) - 255 (不透明)', type: 'range', min: 0, max: 255 },
    'WATERMARK_SIZE': { group: 'process', label: '水印字体基准', desc: '基准像素值，会自动按比例缩放', type: 'number' },
};

const CONFIG_GROUPS = {
    'basic': '基础设置',
    'upload': '上传控制',
    'process': '图片处理'
};

async function showAdminModal() {
    await loadAdminConfig();
    showModal('adminModal');
}

async function loadAdminConfig() {
    const res = await fetch('/api/admin/config');
    const data = await res.json();

    const form = document.getElementById('adminConfigForm');

    // Group configs by their group
    const groups = {};
    for (const [key, meta] of Object.entries(CONFIG_META)) {
        if (!groups[meta.group]) groups[meta.group] = [];
        groups[meta.group].push({ key, meta, value: data[key] });
    }

    let html = '';
    for (const [groupKey, items] of Object.entries(groups)) {
        const groupName = CONFIG_GROUPS[groupKey] || groupKey;
        html += `<div style="margin-bottom:1.5rem">
            <div style="font-weight:600; margin-bottom:0.75rem; color:var(--text-primary); border-bottom:1px solid var(--border); padding-bottom:0.5rem">${groupName}</div>`;

        for (const item of items) {
            let value = item.value;
            if (value === undefined || value === null || value === 'undefined' || value === 'None') {
                if (item.key === 'ALLOWED_EXTS') value = 'jpg,jpeg,png,gif,webp';
                else value = '';
            }

            // Unit conversion
            if (item.meta.unit === 'MB' && value !== '') {
                value = (parseFloat(value) / (1024 * 1024)).toFixed(2);
            }

            let inputHtml = '';
            if (item.meta.type === 'switch') {
                inputHtml = `
                    <label class="switch">
                        <input type="checkbox" name="${item.key}" value="true" ${value === 'true' ? 'checked' : ''} onchange="this.value = this.checked ? 'true' : 'false'">
                        <span class="slider"></span>
                    </label>
                `;
            } else if (item.meta.type === 'range') {
                inputHtml = `
                    <div style="display:flex; align-items:center; gap:1rem">
                        <input type="range" name="${item.key}" value="${value || item.meta.min}" min="${item.meta.min}" max="${item.meta.max}" 
                               oninput="this.nextElementSibling.innerText = this.value" style="flex:1">
                        <span style="width:30px; text-align:right">${value || item.meta.min}</span>
                    </div>
                `;
            } else {
                inputHtml = `<input type="${item.meta.type}" name="${item.key}" value="${value}" class="input-control" ${item.meta.unit === 'MB' ? 'step="0.1"' : ''}>`;
            }

            html += `
                <div class="form-group" style="margin-bottom:0.75rem">
                    <label style="display:flex; justify-content:space-between; font-size:0.9rem">
                        ${item.meta.label} 
                        <span style="font-weight:normal; opacity:0.6; font-size:0.8em">${item.meta.desc}</span>
                    </label>
                    ${inputHtml}
                </div>
            `;
        }
        html += '</div>';
    }

    form.innerHTML = html;
}

// --- Admin Tab Switching ---
function switchAdminTab(tabName) {
    // Hide all tabs
    document.getElementById('adminTab-config').classList.add('hidden');
    document.getElementById('adminTab-users').classList.add('hidden');
    document.getElementById('adminTab-invite').classList.add('hidden');

    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Show selected tab
    document.getElementById(`adminTab-${tabName}`).classList.remove('hidden');

    // Load data if needed
    if (tabName === 'users') loadUsers();
    if (tabName === 'invite') loadInvites();
}

// --- User Management ---
async function loadUsers() {
    const container = document.getElementById('usersList');
    container.innerHTML = '<div style="text-align:center; padding:2rem">加载中...</div>';

    try {
        const res = await fetch('/api/admin/users');
        if (!res.ok) throw new Error('Failed');
        const users = await res.json();

        if (users.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:2rem">暂无用户</div>';
            return;
        }

        let html = '';
        users.forEach(u => {
            const usedMB = (u.used_bytes / 1024 / 1024).toFixed(2);
            const roleClass = u.role === 'admin' ? 'badge-admin' : 'badge-user';
            const activeClass = u.is_active ? '' : 'badge-inactive';
            const isMe = currentUser && currentUser.id === u.id;
            let quotaDisplay;
            if (u.role === 'admin' || u.quota_bytes === 0) {
                quotaDisplay = '无限';
            } else if (u.quota_bytes) {
                quotaDisplay = `${(u.quota_bytes / 1024 / 1024).toFixed(0)} MB`;
            } else {
                quotaDisplay = '默认';
            }

            html += `
                <div class="user-card">
                    <div class="user-avatar">${u.username[0].toUpperCase()}</div>
                    <div class="user-card-info">
                        <div class="user-card-name">
                            ${u.username}
                            <span class="badge ${roleClass}">${u.role}</span>
                            ${!u.is_active ? '<span class="badge badge-inactive">已禁用</span>' : ''}
                            ${isMe ? '<span style="font-size:0.75rem; color:var(--text-muted)">(你)</span>' : ''}
                        </div>
                        <div class="user-card-meta">
                            ${u.image_count} 张 · ${usedMB} MB / ${quotaDisplay} · ${new Date(u.created_at).toLocaleDateString()}
                        </div>
                    </div>
                    ${!isMe ? `
                    <div class="user-card-actions">
                        <button class="btn btn-secondary btn-sm" onclick="viewUserFiles(${u.id}, '${u.username}')" title="查看文件">
                            <i data-feather="image"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="changeUserPassword(${u.id})" title="修改密码">
                            <i data-feather="key"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="setUserQuota(${u.id}, ${u.quota_bytes || 'null'})" title="设置配额">
                            <i data-feather="hard-drive"></i>
                        </button>
                        <select onchange="updateUserRole(${u.id}, this.value)" style="padding:0.25rem; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary)">
                            <option value="user" ${u.role === 'user' ? 'selected' : ''}>用户</option>
                            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
                        </select>
                        <button class="btn btn-secondary btn-sm" onclick="toggleUserActive(${u.id}, ${u.is_active})" style="padding:0.25rem 0.5rem; font-size:0.8rem">
                            ${u.is_active ? '禁用' : '启用'}
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${u.username}')" style="padding:0.25rem 0.5rem; font-size:0.8rem">
                            <i data-feather="trash-2"></i>
                        </button>
                    </div>
                    ` : ''}
                </div>
            `;
        });

        container.innerHTML = html;
        if (window.feather) feather.replace();
    } catch (e) {
        container.innerHTML = '<div style="text-align:center; color:var(--danger)">加载失败</div>';
    }
}

// Admin Helpers
function viewUserFiles(userId, username) {
    closeModal('adminModal');
    filterUserId = userId;
    filterUsername = username;
    switchView('gallery');
    loadImages(1);
}

async function changeUserPassword(userId) {
    const p = prompt("请输入新密码 (至少6位):");
    if (p === null) return;
    if (p.length < 6) {
        showToast("密码太短", "error");
        return;
    }
    try {
        const res = await fetch(`/api/admin/users/${userId}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: p })
        });
        if (res.ok) showToast("密码已修改");
        else {
            const d = await res.json();
            showToast(d.error || "失败", "error");
        }
    } catch (e) {
        showToast("网络错误", "error");
    }
}

async function setUserQuota(userId, currentQuotaBytes) {
    const currentMB = currentQuotaBytes ? Math.round(currentQuotaBytes / 1024 / 1024) : '';
    const input = prompt(`设置用户存储配额 (MB)：\n留空表示使用全局默认，0 表示无限制`, currentMB);
    if (input === null) return; // Cancelled

    const quotaMB = input.trim() === '' ? null : parseInt(input);

    try {
        const res = await fetch(`/api/admin/users/${userId}/quota`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quota_mb: quotaMB })
        });
        if (res.ok) {
            showToast('配额已更新');
            loadUsers();
        } else {
            const d = await res.json();
            showToast(d.error || '失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

async function updateUserRole(userId, newRole) {
    try {
        const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        if (res.ok) {
            showToast('角色已更新');
        } else {
            showToast('更新失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

async function toggleUserActive(userId, currentActive) {
    try {
        const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !currentActive })
        });
        if (res.ok) {
            showToast(currentActive ? '用户已禁用' : '用户已启用');
            loadUsers();
        } else {
            showToast('操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

async function deleteUser(userId, username) {
    if (!confirm(`确定删除用户 "${username}"？\n\n该用户的所有图片也将被删除，此操作无法撤回！`)) return;

    try {
        const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('用户已删除');
            loadUsers();
        } else {
            const data = await res.json();
            showToast(data.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

async function loadInvites() {
    const container = document.getElementById('tab-invite');
    container.innerHTML = '<div style="text-align:center">Loading...</div>';

    try {
        const res = await fetch('/api/admin/invites');
        if (!res.ok) throw new Error('Failed to load');
        const codes = await res.json();

        // Sort logic handled by backend usually, but ensuring order

        let html = `
            <div style="margin-bottom:1rem; display:flex; gap:1rem; align-items:flex-end; flex-wrap:wrap">
                <div style="display:flex; flex-direction:column; gap:0.25rem">
                    <label style="font-size:0.85rem; color:var(--text-secondary)">生成数量</label>
                    <input type="number" id="inviteCount" value="1" class="input-control" style="width:80px">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.25rem">
                    <label style="font-size:0.85rem; color:var(--text-secondary)">最大使用次数</label>
                    <input type="number" id="inviteLimit" value="1" class="input-control" style="width:80px">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.25rem">
                    <label style="font-size:0.85rem; color:var(--text-secondary)">有效期(天)</label>
                    <input type="number" id="inviteDays" value="7" class="input-control" style="width:80px">
                </div>
                <button class="btn btn-primary" type="button" onclick="createInvite()">生成</button>
            </div>
    
            <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm)">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>邀请码</th>
                        <th>使用情况</th>
                        <th>过期时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (codes.length === 0) {
            html += '<tr><td colspan="4" style="text-align:center; padding:2rem">暂无邀请码</td></tr>';
        } else {
            codes.forEach(c => {
                const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                const isValid = c.valid;
                const statusColor = isValid ? 'var(--success)' : 'var(--text-muted)';
                const statusText = isValid ? '有效' : (isExpired ? '已过期' : '已耗尽');

                // Format Date
                let dateStr = '-';
                if (c.expires_at) {
                    const d = new Date(c.expires_at);
                    dateStr = d.toLocaleDateString();
                }

                html += `
                    <tr>
                        <td style="font-family:monospace; font-size:1.1em">${c.code}</td>
                        <td>
                            <div style="display:flex; align-items:center; gap:0.5rem">
                                <span style="color:${statusColor}">${statusText}</span>
                                <span style="font-size:0.85em; opacity:0.7">(${c.current_uses}/${c.max_uses})</span>
                            </div>
                        </td>
                        <td style="font-size:0.9em">${dateStr}</td>
                        <td>
                            <button class="btn btn-danger btn-sm" type="button" style="padding:0.25rem 0.5rem; font-size:0.8rem" onclick="deleteInvite('${c.id}')">删除</button>
                        </td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="text-align:center;color:var(--danger)">加载失败，请重试</div>';
    }
}

async function createInvite() {
    const count = document.getElementById('inviteCount').value;
    const days = document.getElementById('inviteDays').value;
    const limit = document.getElementById('inviteLimit').value;

    try {
        const res = await fetch('/api/admin/invites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, days, limit })
        });
        if (res.ok) {
            showToast(`已生成 ${count} 个邀请码`);
            await loadInvites();
        } else {
            showToast('生成失败', 'error');
        }
    } catch (e) {
        showToast('生成失败', 'error');
    }
}

async function deleteInvite(id) {
    if (!confirm('确定删除?')) return;
    await fetch(`/api/admin/invites?id=${id}`, { method: 'DELETE' });
    loadInvites();
    showToast('已删除');
}

async function saveConfig() {
    const form = document.getElementById('adminConfigForm');
    const data = {};

    // Gather inputs from all tabs (except keys not in CONFIG_META)
    const inputs = form.querySelectorAll('input, select');
    inputs.forEach(input => {
        const name = input.name;
        if (!CONFIG_META[name]) return; // Skip non-config inputs if any

        let val = input.value;
        if (input.type === 'checkbox') val = input.checked ? 'true' : 'false';

        // Convert MB back
        if (CONFIG_META[name].unit === 'MB') {
            val = Math.floor(parseFloat(val) * 1024 * 1024);
        }

        data[name] = val;
    });

    await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    showToast('配置已保存');
    // Keep modal open so user can continue editing
}

// --- Register Update ---
async function openRegisterModal() {
    // Check if invite enabled
    // We can verify this via simple public config API or just try to fetch full public config
    // For MVP, lets try fetching a public status endpoint or just fetch admin config if we could (but we can't if unauth)
    // Actually, register endpoint will fail if code required.
    // Better UX: Client knows if code is needed.
    // Adding a small public config endpoint would be ideal, but for now we can just show the field.
    // Let's just always show the Invite Code field but make it optional in UI text unless we know better.
    // Or, we added 'ENABLE_INVITE_CODE' to SystemConfig. 
    // Let's add the input to HTML dynamically.

    const form = document.getElementById('registerForm');
    if (!document.getElementById('inviteCodeInput')) {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.id = 'inviteCodeInput';
        div.innerHTML = `
            <label>邀请码 (如系统开启)</label>
            <input type="text" name="invite_code" class="input-control" placeholder="非必须，除非开启邀请注册">
        `;
        form.insertBefore(div, form.lastElementChild);
    }
    showModal('registerModal');
}

// --- User Settings ---
async function openUserSettings() {
    showModal('userModal');
    loadUserStats();
}

async function loadUserStats() {
    try {
        const res = await fetch('/api/auth/stats');
        if (!res.ok) return;
        const data = await res.json();

        const usedMB = (data.used_bytes / 1024 / 1024).toFixed(2);

        // Handle quota display (0 means unlimited)
        let quotaText = '默认';
        let percent = 0;

        if (data.quota_bytes === 0) {
            quotaText = '无限';
            percent = 0; // Don't show progress bar for unlimited
        } else if (data.quota_bytes) {
            const qMB = (data.quota_bytes / 1024 / 1024).toFixed(0);
            quotaText = `${qMB} MB`;
            percent = Math.min((data.used_bytes / data.quota_bytes) * 100, 100);
        } else if (data.quota_mb) {
            // Fallback for old API just in case
            quotaText = `${data.quota_mb} MB`;
            percent = Math.min((usedMB / data.quota_mb) * 100, 100);
        }

        document.getElementById('storageUsed').innerText = `${usedMB} MB`;
        document.getElementById('storageQuota').innerText = quotaText;
        document.getElementById('storageBar').style.width = `${percent}%`;
        document.getElementById('imageCount').innerText = data.image_count;

        if (percent > 90) {
            document.getElementById('storageBar').style.backgroundColor = 'var(--danger)';
        } else {
            document.getElementById('storageBar').style.backgroundColor = 'var(--accent)';
        }
    } catch (e) {
        console.error(e);
    }
}

async function updatePassword() {
    const oldPass = document.getElementById('oldPass').value;
    const newPass = document.getElementById('newPass').value;

    if (!oldPass || !newPass) {
        showToast('请填写所有密码字段', 'error');
        return;
    }

    try {
        const res = await fetch('/api/auth/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPass, new_password: newPass })
        });
        const data = await res.json();

        if (res.ok) {
            showToast('密码修改成功');
            document.getElementById('oldPass').value = '';
            document.getElementById('newPass').value = '';
            closeModal('userModal');
        } else {
            showToast(data.error || '修改失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

// --- Utils ---
function showModal(id) {
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    el.classList.add('active');
}
function closeModal(id) {
    const el = document.getElementById(id);
    el.classList.remove('active');
    el.classList.add('hidden');
}
function copyLink(id) {
    document.getElementById(id).select();
    document.execCommand('copy');
    showToast('复制成功');
}
function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${msg}</span>`;
    dom.toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// Overlay click close
window.onclick = (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
}
