// State
let currentUser = null;
let currentPage = 1;
let currentImage = null;
let csrfToken = null;

// Multi-select state
let isSelectMode = false;
let selectedImages = new Map(); // id -> {filename, original_name}
let loadedImages = []; // Cache loaded image data for selection

// Batch upload state
let batchModalActive = false;

// DOM Cache
const dom = {
    sidebar: document.getElementById('sidebar'),
    hero: document.getElementById('heroSection'),
    dashboard: document.getElementById('dashboardSection'),
    galleryGrid: document.getElementById('imageGrid'),
    toastContainer: document.getElementById('toastContainer'),
    topBar: document.getElementById('topBar'),
    contentScroll: document.getElementById('contentScroll'),
    // Views
    viewGallery: document.getElementById('viewGallery'),
    viewUpload: document.getElementById('viewUpload'),
    viewSettings: document.getElementById('viewSettings'),
    viewAdmin: document.getElementById('viewAdmin')
};

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await fetchCsrfToken();
    checkAuth();
    setupEventListeners();
    setupScrollListener();
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

// --- Sidebar Toggle ---
function toggleSidebar() {
    dom.sidebar.classList.toggle('collapsed');
}

// --- Scroll Listener for Top Bar glassmorphism ---
function setupScrollListener() {
    const scrollEl = dom.contentScroll;
    if (!scrollEl) return;
    scrollEl.addEventListener('scroll', () => {
        if (scrollEl.scrollTop > 20) {
            dom.topBar.classList.add('scrolled');
        } else {
            dom.topBar.classList.remove('scrolled');
        }
    });
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

        // Show top bar controls
        document.getElementById('sidebarToggle').style.display = '';
        document.getElementById('searchWrapper').style.display = '';
        document.getElementById('topBarRight').style.display = '';

        // Sidebar Info
        document.getElementById('sidebarUsername').innerText = currentUser.username;
        document.getElementById('sidebarRole').innerText = currentUser.role;
        document.getElementById('sidebarAvatar').innerText = currentUser.username[0].toUpperCase();
        document.getElementById('topBarAvatar').innerText = currentUser.username[0].toUpperCase();

        // Admin Link
        if (currentUser.role === 'admin') {
            document.getElementById('adminLink').innerHTML = `
                <div class="nav-item" data-view="admin" onclick="switchView('admin')">
                    <i data-lucide="shield-check"></i>
                    <span class="sidebar-label">系统管理</span>
                </div>
            `;
        }

        // Load sidebar storage stats
        loadSidebarStorage();

    } else {
        dom.hero.classList.remove('hidden');
        dom.dashboard.classList.add('hidden');
        dom.sidebar.classList.add('hidden');
        container.classList.remove('has-sidebar');

        // Hide top bar controls
        document.getElementById('sidebarToggle').style.display = 'none';
        document.getElementById('searchWrapper').style.display = 'none';
        document.getElementById('topBarRight').style.display = 'none';
    }

    refreshIcons();
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
    dom.viewSettings.classList.add('hidden');
    if (dom.viewAdmin) dom.viewAdmin.classList.add('hidden');

    // Update Nav Active State via data-view attribute
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Scroll to top
    if (dom.contentScroll) dom.contentScroll.scrollTop = 0;

    if (viewName === 'gallery') {
        dom.viewGallery.classList.remove('hidden');
        if (resetFilter) {
            filterUserId = null;
            filterUsername = null;
            currentPage = 1;
        }
        loadImages(currentPage);
    } else if (viewName === 'upload') {
        dom.viewUpload.classList.remove('hidden');
        loadMaxQuality();
    } else if (viewName === 'settings') {
        dom.viewSettings.classList.remove('hidden');
        loadSettingsData();
    } else if (viewName === 'admin') {
        if (dom.viewAdmin) {
            dom.viewAdmin.classList.remove('hidden');
            loadAdminView();
        }
    }
}

// --- Images ---
let currentSort = 'time_desc';
let currentViewMode = 'grid';
let filterUserId = null;
let filterUsername = null;
let currentFolderId = null;

let lastLoadImagesTimestamp = 0;

window.openFolder = function(id) {
    currentFolderId = id;
    loadImages(1);
};

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
        if (currentFolderId) {
            url += `&folder_id=${currentFolderId}`;
        }

        const res = await fetch(url);
        if (timestamp !== lastLoadImagesTimestamp) return;

        const data = await res.json();

        dom.galleryGrid.innerHTML = '';
        dom.galleryGrid.style.opacity = '1';
        dom.galleryGrid.style.pointerEvents = 'auto';

        // Render Breadcrumbs
        const breadcrumbsEl = document.getElementById('breadcrumbs');
        if (breadcrumbsEl && data.breadcrumbs) {
            breadcrumbsEl.innerHTML = data.breadcrumbs.map((b, idx) => `
                <div class="crumb ${idx === data.breadcrumbs.length - 1 ? 'active' : ''}" onclick="window.openFolder(${b.id || 'null'})">
                    ${idx === 0 ? '<i data-lucide="home" style="width: 14px; height: 14px; flex-shrink: 0;"></i> ' : ''}${escapeHtml(b.name)}
                </div>
                ${idx < data.breadcrumbs.length - 1 ? '<div class="separator"><i data-lucide="chevron-right" style="width: 12px; height: 12px;"></i></div>' : ''}
            `).join('');
            if (window.lucide) lucide.createIcons();
        }

        if (data.images.length === 0 && (!data.folders || data.folders.length === 0)) {
            dom.galleryGrid.innerHTML = '<p style="grid-column:1/-1;text-align:center;margin-top:2rem;opacity:0.7">暂无内容，去上传点什么吧</p>';
        }

        // Render Folders
        if (data.folders && data.folders.length > 0) {
            data.folders.forEach(f => {
                const div = document.createElement('div');
                div.className = 'folder-card';
                div.onclick = (e) => {
                    if (e.target.closest('.folder-menu-btn, .folder-menu')) return;
                    window.openFolder(f.id);
                };
                const safeName = escapeHtml(f.name);
                div.innerHTML = `
                    <div class="folder-icon"><i data-lucide="folder" style="width: 20px; height: 20px;"></i></div>
                    <div class="folder-info">
                        <div class="folder-name" title="${safeName}">${safeName}</div>
                    </div>
                    <div class="folder-menu-wrapper">
                        <button class="folder-menu-btn" title="更多操作">
                            <i data-lucide="more-vertical" style="width:16px;height:16px"></i>
                        </button>
                        <div class="folder-menu">
                            <div class="folder-menu-item" data-action="copy">
                                <i data-lucide="copy" style="width:14px;height:14px"></i>
                                复制全部链接
                            </div>
                            <div class="folder-menu-item" data-action="open">
                                <i data-lucide="folder-open" style="width:14px;height:14px"></i>
                                打开文件夹
                            </div>
                        </div>
                    </div>
                `;
                // Attach events programmatically (no escaping issues)
                div.querySelector('.folder-menu-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleFolderMenu(e.currentTarget);
                });
                div.querySelector('[data-action="copy"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyFolderLinks(f.id, f.name);
                });
                div.querySelector('[data-action="open"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.openFolder(f.id);
                });
                dom.galleryGrid.appendChild(div);
            });
        }

        const pathStr = data.breadcrumbs ? data.breadcrumbs.map(b => b.name).filter(n => n !== '首页').join('/') : '';
        const prefix = pathStr ? pathStr + '/' : '';
        window.currentFolderPath = prefix; // Save globally for new uploads
        
        data.images.forEach(img => img._virtualName = prefix + img.original_name);

        loadedImages = data.images; // Cache for multi-select

        data.images.forEach((img, index) => {
            const div = document.createElement('div');
            div.className = 'img-card';
            div.dataset.imgId = img.id;

            const sizeStr = img.size > 1024 * 1024
                ? (img.size / (1024 * 1024)).toFixed(1) + ' MB'
                : (img.size / 1024).toFixed(1) + ' KB';

            const isSelected = selectedImages.has(img.id);

            const safeName = escapeHtml(img.original_name);
            const safeVirtualName = escapeHtml(img._virtualName);

            div.innerHTML = `
            ${isSelectMode ? `<div class="img-select-check ${isSelected ? 'checked' : ''}" data-id="${img.id}"><i data-lucide="check"></i></div>` : ''}
            <img src="/i/${img.filename}" loading="lazy" decoding="async" alt="${safeName}" style="transform:translateZ(0)" onload="this.parentNode.classList.add('loaded')">
            <div class="img-overlay">
                <div class="overlay-top">
                    <button class="overlay-btn" onclick="event.stopPropagation();showDetail(loadedImages.find(i=>i.id===${img.id}))" title="详情">
                        <i data-lucide="more-horizontal" style="width:18px;height:18px"></i>
                    </button>
                </div>
                <div class="overlay-bottom">
                    <div style="min-width:0;flex:1">
                        <div class="img-name">${safeName}</div>
                        <div class="img-meta">
                            <span>${sizeStr}</span>
                            <span>${img.width}×${img.height}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:0.5rem;flex-shrink:0">
                        <button class="overlay-btn" onclick="event.stopPropagation();copyImageLink('${img.filename}', '${safeVirtualName}')" title="拷贝链接">
                            <i data-lucide="link-2" style="width:16px;height:16px"></i>
                        </button>
                        <button class="overlay-btn overlay-btn-danger" onclick="event.stopPropagation();quickDelete(${img.id})" title="删除">
                            <i data-lucide="trash-2" style="width:16px;height:16px"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
            if (isSelectMode) {
                if (isSelected) div.classList.add('selected');
                div.onclick = () => toggleImageSelect(img);
            } else {
                div.onclick = () => showDetail(img);
            }
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
        refreshIcons();
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
        dom.galleryGrid.classList.add('list-mode');
    } else {
        dom.galleryGrid.classList.remove('list-mode');
    }
}

function prevPage() {
    if (currentPage > 1) loadImages(currentPage - 1);
}
function nextPage() {
    const totalPages = parseInt(document.getElementById('pageIndicator')?.textContent?.split('/')[1]) || 1;
    if (currentPage < totalPages) loadImages(currentPage + 1);
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
                // Save max size for validation (MB to Bytes)
                window.maxUploadSizeBytes = (parseFloat(data.max_upload_size) || 5) * 1024 * 1024;

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
    const passthrough = isStrict;

    if (isOriginal || isStrict) {
        quality = 100;
    } else {
        quality = Math.min(
            parseInt(document.getElementById('uploadQuality')?.value || 80),
            maxQualityLimit
        );
    }

    // Pre-filter: skip oversized files, collect valid ones
    const validFiles = [];
    for (const file of files) {
        if (window.maxUploadSizeBytes && file.size > window.maxUploadSizeBytes) {
            showToast(`文件 ${file.name} 超过大小限制 (${(window.maxUploadSizeBytes / 1024 / 1024).toFixed(0)}MB)`, 'error');
            continue;
        }
        validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    // Decide whether to show batch modal (for 2+ valid files)
    const useBatchModal = validFiles.length >= 2;
    if (useBatchModal) {
        openBatchModal(validFiles.length);
    }

    // Add to queue
    const queueContainer = document.getElementById('uploadQueue');
    const queueList = document.getElementById('queueList');
    if (!useBatchModal) {
        queueContainer.classList.remove('hidden');
    }

    for (const file of validFiles) {
        const id = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        uploadQueue.push({ id, file, quality, passthrough, status: 'pending' });
        const safeName = escapeHtml(file.name);

        if (useBatchModal) {
            const el = document.createElement('div');
            el.id = id;
            el.className = 'batch-file-item';
            el.innerHTML = `
                <div style="flex:1; min-width:0">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem">
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%">${safeName}</div>
                        <div class="upload-status" style="font-size:0.85rem; color:var(--text-secondary)">等待中</div>
                    </div>
                    <div class="progress-bar-bg" style="height:4px; border-radius:2px">
                        <div class="progress-bar-fill" style="width:0%"></div>
                    </div>
                </div>
            `;
            document.getElementById('batchFileList').appendChild(el);
        } else {
            const el = document.createElement('div');
            el.id = id;
            el.className = 'card';
            el.style.cssText = 'padding: 0.75rem 1rem; display: flex; align-items: center; gap: 1rem';
            el.innerHTML = `
                <div style="flex:1; min-width:0">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem">
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%">${safeName}</div>
                        <div class="upload-status" style="font-size:0.85rem; color:var(--text-secondary)">等待中</div>
                    </div>
                    <div class="progress-bar-bg" style="height:4px; border-radius:2px">
                        <div class="progress-bar-fill" style="width:0%"></div>
                    </div>
                </div>
            `;
            queueList.appendChild(el);
        }
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
    
    // Add current folder_id so uploads go directly into current viewed folder
    if (currentFolderId) {
        formData.append('folder_id', currentFolderId);
    }

    // Add path if it's a folder upload
    if (pending.file.webkitRelativePath) {
        const parts = pending.file.webkitRelativePath.split('/');
        if (parts.length > 1) {
            parts.pop(); // remove filename
            formData.append('path', parts.join('/'));
        }
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
            pending.result = img; // Save result for batch copy
            if (statusEl) {
                statusEl.textContent = '完成';
                statusEl.style.color = 'var(--success)';
            }
            if (progressEl) progressEl.style.width = '100%';

            // If only one file and no batch modal, show detail
            if (uploadQueue.length === 1 && !batchModalActive) {
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
    const total = uploadQueue.length;
    const doneCount = uploadQueue.filter(u => u.status === 'done').length;
    const errorCount = uploadQueue.filter(u => u.status === 'error').length;
    const remaining = uploadQueue.filter(u => u.status === 'pending').length;

    // Update batch modal progress
    if (batchModalActive) {
        const completed = doneCount + errorCount;
        document.getElementById('batchProgressCount').textContent = `${completed}/${total}`;
        document.getElementById('batchProgressBar').style.width = `${(completed / total) * 100}%`;
        document.getElementById('batchProgressText').textContent = remaining > 0 ? '上传中...' : '上传完成';
    }

    if (remaining > 0) {
        processQueue();
    } else {
        // All done
        if (doneCount > 0) {
            loadImages(1); // Refresh gallery
        }

        if (batchModalActive) {
            // Generate result text in batch modal
            const lines = uploadQueue
                .filter(u => u.status === 'done' && u.result)
                .map(u => `${u.result.original_name} ${window.location.origin}/i/${u.result.filename}`);
            
            const resultArea = document.getElementById('batchResultArea');
            const resultText = document.getElementById('batchResultText');
            resultText.value = lines.join('\n');
            resultArea.classList.remove('hidden');

            document.getElementById('batchProgressText').textContent =
                `上传完成: ${doneCount} 成功${errorCount > 0 ? ', ' + errorCount + ' 失败' : ''}`;
            document.getElementById('batchModalCloseBtn').style.display = '';

            refreshIcons();
        } else {
            if (doneCount > 0) {
                showToast(`上传完成: ${doneCount} 成功${errorCount > 0 ? ', ' + errorCount + ' 失败' : ''}`);
            } else if (errorCount > 0) {
                showToast(`上传失败: ${errorCount} 个文件`, 'error');
            }
            // Clear inline queue after a delay
            setTimeout(() => {
                uploadQueue = [];
                document.getElementById('queueList').innerHTML = '';
                document.getElementById('uploadQueue').classList.add('hidden');
            }, 3000);
        }
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

    zone.onclick = (e) => {
        // Don't trigger file picker if clicking on the button or input inside the zone
        if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
        input.click();
    };
    input.onchange = (e) => {
        uploadFiles(e.target.files);
        e.target.value = ''; // Reset so same file can be re-selected
    };

    // Folder input
    const folderInput = document.getElementById('folderInput');
    if (folderInput) {
        folderInput.onchange = (e) => {
            const allFiles = Array.from(e.target.files);
            const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            const imageFiles = allFiles.filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                return imageExts.includes(ext);
            });
            if (imageFiles.length === 0) {
                showToast('文件夹中没有找到支持的图片文件', 'error');
                return;
            }
            uploadFiles(imageFiles);
            folderInput.value = ''; // Reset
        };
    }

    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = async (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        
        let files = [];
        if (e.dataTransfer.items) {
            const items = Array.from(e.dataTransfer.items);
            
            const traverseFileTree = async (item, path) => {
                if (item.isFile) {
                    return new Promise((resolve) => {
                        item.file((file) => {
                            // If path is not empty, we attach the relative directory path
                            if (path) {
                                Object.defineProperty(file, 'webkitRelativePath', {
                                    value: path + file.name,
                                    writable: false
                                });
                            }
                            const ext = file.name.split('.').pop().toLowerCase();
                            if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                                files.push(file);
                            }
                            resolve();
                        });
                    });
                } else if (item.isDirectory) {
                    const dirReader = item.createReader();
                    return new Promise((resolve) => {
                        // Read all entries in the directory (needs loop for > 100 entries but usually fastimg use case is small)
                        dirReader.readEntries(async (entries) => {
                            const entryPromises = entries.map(ent => traverseFileTree(ent, path + item.name + "/"));
                            await Promise.all(entryPromises);
                            resolve();
                        });
                    });
                }
            };
            
            const promises = items.map(item => {
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry) {
                        return traverseFileTree(entry, "");
                    } else {
                        const f = item.getAsFile();
                        if (f) {
                            const ext = f.name.split('.').pop().toLowerCase();
                            if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) files.push(f);
                        }
                        return Promise.resolve();
                    }
                }
                return Promise.resolve();
            });
            await Promise.all(promises);
            
        } else {
            files = Array.from(e.dataTransfer.files).filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
            });
        }
        
        if (files.length > 0) {
            uploadFiles(files);
        } else {
            showToast('未找到支持的图片文件', 'error');
        }
    };

    document.onpaste = (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const files = [];
        for (let item of items) {
            if (item.kind === 'file') files.push(item.getAsFile());
        }
        if (files.length > 0) uploadFiles(files);
    };

    // --- Gallery Drop Zone (drag files onto gallery to upload into current folder) ---
    setupGalleryDropZone();

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

    // 访问限流
    'rate_limit_global': { group: 'ratelimit', label: '全局每日请求上限', desc: '同一 IP 每天最大请求数，0 = 不限', type: 'number', unit: '' },
    'rate_limit_per_image': { group: 'ratelimit', label: '单图片每日访问上限', desc: '单张图片每天最大被访问次数，0 = 不限', type: 'number', unit: '' },
};

const CONFIG_GROUPS = {
    'basic': '基础设置',
    'upload': '上传控制',
    'process': '图片处理',
    'ratelimit': '访问限流'
};

async function showAdminModal() {
    await loadAdminConfig();
    showModal('adminConfigModal');
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

            // Backend stores values in MB, just display as-is
            if (item.meta.unit === 'MB' && value !== '') {
                value = parseFloat(value).toFixed(1);
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

            const safeUsername = escapeHtml(u.username);
            html += `
                <div class="user-card">
                    <div class="user-avatar">${safeUsername[0].toUpperCase()}</div>
                    <div class="user-card-info">
                        <div class="user-card-name">
                            ${safeUsername}
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
                            <i data-lucide="image"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="changeUserPassword(${u.id})" title="修改密码">
                            <i data-lucide="key"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="setUserQuota(${u.id}, ${u.quota_bytes || 'null'})" title="设置配额">
                            <i data-lucide="hard-drive"></i>
                        </button>
                        <select onchange="updateUserRole(${u.id}, this.value)" style="padding:0.25rem; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary)">
                            <option value="user" ${u.role === 'user' ? 'selected' : ''}>用户</option>
                            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
                        </select>
                        <button class="btn btn-secondary btn-sm" onclick="toggleUserActive(${u.id}, ${u.is_active})" style="padding:0.25rem 0.5rem; font-size:0.8rem">
                            ${u.is_active ? '禁用' : '启用'}
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${u.username}')" style="padding:0.25rem 0.5rem; font-size:0.8rem">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                    ` : ''}
                </div>
            `;
        });

        container.innerHTML = html;
        refreshIcons();
    } catch (e) {
        container.innerHTML = '<div style="text-align:center; color:var(--danger)">加载失败</div>';
    }
}

// Admin Helpers
function viewUserFiles(userId, username) {
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
            loadAdminView();
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
            loadAdminView();
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
            loadAdminView();
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
                        <td style="font-family:monospace; font-size:1.1em">${escapeHtml(c.code)}</td>
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

        // Store MB values as-is (backend reads them as MB)
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
function openUserSettings() {
    switchView('settings');
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
    const text = document.getElementById(id).value;
    navigator.clipboard.writeText(text).then(() => {
        showToast('复制成功');
    }).catch(() => {
        document.getElementById(id).select();
        document.execCommand('copy');
        showToast('复制成功');
    });
}
function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    dom.toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Overlay click close
window.onclick = (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        // Don't close batch modal by clicking overlay during upload
        if (e.target.id === 'batchUploadModal' && batchModalActive) return;
        e.target.classList.remove('active');
    }
}

// --- Batch Upload Modal ---
function openBatchModal(totalCount) {
    batchModalActive = true;
    document.getElementById('batchFileList').innerHTML = '';
    document.getElementById('batchResultArea').classList.add('hidden');
    document.getElementById('batchResultText').value = '';
    document.getElementById('batchProgressCount').textContent = `0/${totalCount}`;
    document.getElementById('batchProgressBar').style.width = '0%';
    document.getElementById('batchProgressText').textContent = '准备上传...';
    document.getElementById('batchModalCloseBtn').style.display = 'none'; // Hide close during upload
    showModal('batchUploadModal');
}

function closeBatchModal() {
    closeModal('batchUploadModal');
    batchModalActive = false;
    // Clear queue
    uploadQueue = [];
    document.getElementById('batchFileList').innerHTML = '';
    document.getElementById('queueList').innerHTML = '';
    document.getElementById('uploadQueue').classList.add('hidden');
}

function copyBatchResult() {
    const textarea = document.getElementById('batchResultText');
    textarea.select();
    textarea.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(textarea.value).then(() => {
        showToast('已复制到剪贴板');
    }).catch(() => {
        document.execCommand('copy');
        showToast('已复制到剪贴板');
    });
}

// --- Multi-Select Mode ---
function toggleSelectMode() {
    isSelectMode = !isSelectMode;
    const btn = document.getElementById('btnSelectMode');
    const bar = document.getElementById('selectActionBar');

    if (isSelectMode) {
        btn.classList.add('active');
        bar.classList.remove('hidden');
    } else {
        btn.classList.remove('active');
        bar.classList.add('hidden');
        selectedImages.clear();
    }
    // Re-render gallery to show/hide checkboxes
    loadImages(currentPage);
}

function toggleImageSelect(img) {
    if (selectedImages.has(img.id)) {
        selectedImages.delete(img.id);
    } else {
        selectedImages.set(img.id, { filename: img.filename, original_name: img.original_name });
    }
    updateSelectUI();
    loadImages(currentPage);
}

function updateSelectUI() {
    document.getElementById('selectCount').textContent = `已选 ${selectedImages.size} 张`;
}

function clearSelection() {
    selectedImages.clear();
    updateSelectUI();
    loadImages(currentPage);
}

// --- Drag-to-Select (Rubber Band) ---
(function initDragSelect() {
    let isDragging = false;
    let startX = 0, startY = 0;
    let lassoEl = null;
    const DRAG_THRESHOLD = 8;
    let dragStarted = false;

    function setup() {
        lassoEl = document.createElement('div');
        lassoEl.id = 'dragSelectLasso';
        lassoEl.style.cssText = 'position:fixed;border:2px solid rgba(59,130,246,0.7);background:rgba(59,130,246,0.1);border-radius:4px;pointer-events:none;z-index:9999;display:none;';
        document.body.appendChild(lassoEl);

        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseDown(e) {
        const grid = document.getElementById('galleryGrid');
        if (!grid || !grid.contains(e.target)) return;
        if (e.target.closest('button, a, input, select, .img-select-check')) return;
        if (e.button !== 0) return;

        isDragging = true;
        dragStarted = false;
        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault();
    }

    function onMouseMove(e) {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!dragStarted) {
            if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                dragStarted = true;
                lassoEl.style.display = 'block';
            } else {
                return;
            }
        }

        e.preventDefault();

        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        const w = Math.abs(dx);
        const h = Math.abs(dy);

        lassoEl.style.left = x + 'px';
        lassoEl.style.top = y + 'px';
        lassoEl.style.width = w + 'px';
        lassoEl.style.height = h + 'px';

        // Highlight intersecting cards
        const cards = document.querySelectorAll('#galleryGrid .img-card');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const hit = !(rect.right < x || rect.left > x + w || rect.bottom < y || rect.top > y + h);
            card.classList.toggle('lasso-hover', hit);
        });
    }

    function onMouseUp(e) {
        if (!isDragging) return;

        if (dragStarted) {
            lassoEl.style.display = 'none';

            // Collect selected image IDs from lasso-hover cards
            const hitCards = document.querySelectorAll('#galleryGrid .img-card.lasso-hover');
            const newIds = [];
            hitCards.forEach(card => {
                card.classList.remove('lasso-hover');
                const imgId = parseInt(card.dataset.imgId);
                if (imgId && loadedImages) {
                    const img = loadedImages.find(i => i.id === imgId);
                    if (img && !selectedImages.has(img.id)) {
                        selectedImages.set(img.id, { filename: img.filename, original_name: img.original_name });
                        newIds.push(img.id);
                    }
                }
            });

            // Enter select mode if not already, then re-render
            if (newIds.length > 0) {
                if (!isSelectMode) {
                    isSelectMode = true;
                    const btn = document.getElementById('btnSelectMode');
                    const bar = document.getElementById('selectActionBar');
                    if (btn) btn.classList.add('active');
                    if (bar) bar.classList.remove('hidden');
                }
                updateSelectUI();
                loadImages(currentPage);
            }
        }

        isDragging = false;
        dragStarted = false;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }
})();

function copySelectedLinks() {
    if (selectedImages.size === 0) {
        showToast('请先选择至少一张图片', 'error');
        return;
    }
    const lines = [];
    selectedImages.forEach((info) => {
        const title = info._virtualName || info.original_name;
        lines.push(`![${title}](${window.location.origin}/i/${info.filename})`);
    });
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast(`已复制 ${selectedImages.size} 张图片的链接`);
    }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(`已复制 ${selectedImages.size} 张图片的链接`);
    });
}

// --- Icon Refresh (Lucide) ---
function refreshIcons() {
    if (window.lucide) lucide.createIcons();
}

// --- Sidebar Storage Stats ---
async function loadSidebarStorage() {
    try {
        const res = await fetch('/api/auth/stats');
        if (!res.ok) return;
        const data = await res.json();

        const usedMB = (data.used_bytes / 1024 / 1024).toFixed(1);
        let quotaText = '500 MB';
        let percent = 0;

        if (data.quota_bytes === 0) {
            quotaText = '无限';
        } else if (data.quota_bytes) {
            quotaText = `${(data.quota_bytes / 1024 / 1024).toFixed(0)} MB`;
            percent = Math.min((data.used_bytes / data.quota_bytes) * 100, 100);
        }

        document.getElementById('sidebarStorageUsed').textContent = `${usedMB} MB 已用`;
        document.getElementById('sidebarStorageTotal').textContent = quotaText;
        document.getElementById('sidebarStorageBar').style.width = `${percent}%`;
        document.getElementById('storageCard').style.display = '';
    } catch (e) {
        // Ignore
    }
}

// --- Quick Gallery Actions ---
function copyImageLink(filename, displayName = null) {
    const url = `${window.location.origin}/i/${filename}`;
    const text = displayName ? `![${displayName}](${url})` : url;
    navigator.clipboard.writeText(text).then(() => {
        showToast('链接已复制');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}

async function quickDelete(imgId) {
    if (!confirm('确定删除此图片?')) return;
    const res = await fetch(`/api/images/${imgId}`, { method: 'DELETE' });
    if (res.ok) {
        showToast('已删除');
        loadImages(currentPage);
    } else {
        showToast('删除失败', 'error');
    }
}

// --- Settings Page Data ---
async function loadSettingsData() {
    if (!currentUser) return;

    // Profile
    const el = (id) => document.getElementById(id);
    el('settingsUsername').textContent = currentUser.username;
    el('settingsAvatar').textContent = currentUser.username[0].toUpperCase();
    el('settingsRoleBadge').textContent = currentUser.role;
    el('settingsRoleBadge').className = `badge ${currentUser.role === 'admin' ? 'badge-admin' : 'badge-user'}`;

    // Storage
    try {
        const res = await fetch('/api/auth/stats');
        if (!res.ok) return;
        const data = await res.json();

        const usedMB = (data.used_bytes / 1024 / 1024).toFixed(1);
        let quotaText = '500 MB';
        let percent = 0;

        if (data.quota_bytes === 0) {
            quotaText = '无限';
        } else if (data.quota_bytes) {
            quotaText = `${(data.quota_bytes / 1024 / 1024).toFixed(0)} MB`;
            percent = Math.min((data.used_bytes / data.quota_bytes) * 100, 100);
        }

        el('settingsStorageUsed').textContent = `${usedMB} MB`;
        el('settingsStorageQuota').textContent = quotaText;
        el('settingsStorageBar').style.width = `${percent}%`;
        el('settingsImageCount').textContent = data.image_count || 0;
    } catch (e) {}
}

async function updatePasswordFromSettings() {
    const oldPass = document.getElementById('settingsOldPass').value;
    const newPass = document.getElementById('settingsNewPass').value;
    if (!oldPass || !newPass) {
        showToast('请填写当前密码和新密码', 'error');
        return;
    }
    const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPass, new_password: newPass })
    });
    if (res.ok) {
        showToast('密码已更新');
        document.getElementById('settingsOldPass').value = '';
        document.getElementById('settingsNewPass').value = '';
    } else {
        showToast((await res.json()).error || '更新失败', 'error');
    }
}

async function loadAdminView() {
    const tbody = document.getElementById('adminUsersTbody');
    const statsContainer = document.getElementById('adminStatsCards');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem">加载中...</td></tr>';

    // Load invites section in parallel
    loadInlineInvites();
    loadBackupPanel();

    try {
        const res = await fetch('/api/admin/users');
        if (!res.ok) throw new Error();
        const users = await res.json();

        // --- Stats Cards ---
        const totalUsers = users.length;
        let totalBytes = 0;
        let totalImages = 0;
        users.forEach(u => {
            totalBytes += u.used_bytes || 0;
            totalImages += u.image_count || 0;
        });

        const totalDisplay = totalBytes > 1024 * 1024 * 1024
            ? (totalBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
            : (totalBytes / 1024 / 1024).toFixed(1) + ' MB';

        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="card" style="padding:1.5rem;position:relative;overflow:hidden">
                    <div style="position:absolute;top:0;right:0;width:80px;height:80px;background:rgba(59,130,246,0.05);border-radius:50%;filter:blur(20px)"></div>
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1.5rem">
                        <div style="width:40px;height:40px;border-radius:12px;background:black;border:1px solid var(--border);display:flex;align-items:center;justify-content:center">
                            <i data-lucide="users" style="width:18px;height:18px;color:#60a5fa"></i>
                        </div>
                    </div>
                    <h3 style="font-size:2rem;font-weight:700;letter-spacing:-0.04em;margin-bottom:0.25rem" class="tabular-nums">${totalUsers}</h3>
                    <p style="font-size:0.7rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0">注册用户</p>
                </div>
                <div class="card" style="padding:1.5rem;position:relative;overflow:hidden">
                    <div style="position:absolute;top:0;right:0;width:80px;height:80px;background:rgba(168,85,247,0.05);border-radius:50%;filter:blur(20px)"></div>
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1.5rem">
                        <div style="width:40px;height:40px;border-radius:12px;background:black;border:1px solid var(--border);display:flex;align-items:center;justify-content:center">
                            <i data-lucide="hard-drive" style="width:18px;height:18px;color:#c084fc"></i>
                        </div>
                    </div>
                    <h3 style="font-size:2rem;font-weight:700;letter-spacing:-0.04em;margin-bottom:0.25rem" class="tabular-nums">${totalDisplay}</h3>
                    <p style="font-size:0.7rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0">总存储量</p>
                </div>
                <div class="card" style="padding:1.5rem;position:relative;overflow:hidden">
                    <div style="position:absolute;top:0;right:0;width:80px;height:80px;background:rgba(52,211,153,0.05);border-radius:50%;filter:blur(20px)"></div>
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1.5rem">
                        <div style="width:40px;height:40px;border-radius:12px;background:black;border:1px solid var(--border);display:flex;align-items:center;justify-content:center">
                            <i data-lucide="image" style="width:18px;height:18px;color:#34d399"></i>
                        </div>
                    </div>
                    <h3 style="font-size:2rem;font-weight:700;letter-spacing:-0.04em;margin-bottom:0.25rem" class="tabular-nums">${totalImages}</h3>
                    <p style="font-size:0.7rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0">总图片数</p>
                </div>
            `;
        }

        // --- Users Table ---
        if (tbody) {
            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem">暂无用户</td></tr>';
            } else {
                let html = '';
                users.forEach(u => {
                    const usedMB = (u.used_bytes / 1024 / 1024).toFixed(1);
                    const isMe = currentUser && u.id === currentUser.id;
                    const roleBadge = u.role === 'admin'
                        ? '<span class="badge badge-admin">Admin</span>'
                        : '<span class="badge badge-user">User</span>';

                    html += `
                        <tr style="cursor:pointer" class="fade-in" onclick="${!isMe ? `viewUserFiles(${u.id}, '${escapeHtml(u.username)}')` : ''}">
                            <td style="padding:1rem 1.5rem">
                                <div style="display:flex;align-items:center;gap:0.75rem">
                                    <div class="user-avatar" style="width:36px;height:36px;font-size:0.8rem;flex-shrink:0">${u.username[0].toUpperCase()}</div>
                                    <div>
                                        <div style="font-weight:600;font-size:0.9rem;letter-spacing:-0.01em">${escapeHtml(u.username)} ${isMe ? '<span style="font-size:0.75rem;color:var(--text-muted)">(你)</span>' : ''}</div>
                                        <div style="font-size:0.75rem;color:var(--text-muted)">${u.image_count} 张图片</div>
                                    </div>
                                </div>
                            </td>
                            <td style="padding:1rem 1.5rem">${roleBadge}</td>
                            <td style="padding:1rem 1.5rem;font-weight:600;font-variant-numeric:tabular-nums">${usedMB} MB</td>
                            <td style="padding:1rem 1.5rem;color:var(--text-muted);font-variant-numeric:tabular-nums">${new Date(u.created_at).toLocaleDateString()}</td>
                            <td style="padding:1rem 1.5rem;text-align:right">
                                ${!isMe ? `
                                    <div style="display:flex;gap:0.25rem;justify-content:flex-end">
                                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();viewUserFiles(${u.id}, '${escapeHtml(u.username)}')" title="查看文件">
                                            <i data-lucide="image" style="width:14px;height:14px"></i>
                                        </button>
                                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();changeUserPassword(${u.id})" title="修改密码">
                                            <i data-lucide="key" style="width:14px;height:14px"></i>
                                        </button>
                                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();setUserQuota(${u.id}, ${u.quota_bytes || 'null'})" title="设置配额">
                                            <i data-lucide="hard-drive" style="width:14px;height:14px"></i>
                                        </button>
                                        <select onchange="event.stopPropagation();updateUserRole(${u.id}, this.value)" style="padding:0.25rem 0.5rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-tertiary);color:var(--text-primary);font-size:0.8rem">
                                            <option value="user" ${u.role === 'user' ? 'selected' : ''}>用户</option>
                                            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
                                        </select>
                                        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteUser(${u.id}, '${escapeHtml(u.username)}')" style="padding:0.25rem 0.5rem">
                                            <i data-lucide="trash-2" style="width:14px;height:14px"></i>
                                        </button>
                                    </div>
                                ` : ''}
                            </td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            }
        }

        refreshIcons();
    } catch (e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger)">加载失败</td></tr>';
    }
}

async function loadBackupPanel(options = {}) {
    const panel = document.getElementById('backupPanel');
    const badge = document.getElementById('backupStatusBadge');
    if (!panel) return;
    const quiet = !!options.quiet;
    if (!quiet) {
        panel.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">加载备份状态...</div>';
    }

    try {
        const [cfgRes, runsRes] = await Promise.all([
            fetch('/api/admin/backups/config'),
            fetch('/api/admin/backups/runs')
        ]);
        const cfgData = await cfgRes.json();
        const runsData = await runsRes.json();
        if (!cfgRes.ok) throw new Error(cfgData.error || '备份配置加载失败');
        if (!runsRes.ok) throw new Error(runsData.error || '备份运行记录加载失败');

        const runs = runsData.runs || [];
        const activeRun = runs.find(isBackupRunActive);
        let remoteData = {
            files: backupPanelState?.remoteFiles || [],
            remote_error: backupPanelState?.remoteError || ''
        };
        if (cfgData.config.remote_path && !activeRun) {
            try {
                const remoteRes = await fetch(`/api/admin/backups/remote?limit=${getBackupListLimit()}`);
                remoteData = await remoteRes.json();
                if (!remoteRes.ok) remoteData.remote_error = remoteData.error || '远端列表加载失败';
            } catch (e) {
                remoteData.remote_error = '远端列表加载失败';
            }
        }

        if (cfgData.config.remote_path && activeRun && !remoteData.files.length) {
            remoteData.remote_error = '任务运行中，完成后会刷新远端列表';
        }

        renderBackupPanel(cfgData.config, cfgData.provider || {}, cfgData.tools || {}, runs, remoteData.files || [], runsData.maintenance, remoteData.remote_error);
        scheduleBackupPolling(runs);
    } catch (e) {
        panel.innerHTML = `<div style="color:var(--danger);padding:1rem">${escapeHtml(e.message || '加载失败')}</div>`;
        if (badge) {
            badge.textContent = '异常';
            badge.className = 'badge badge-inactive';
        }
    }
}

let backupProviderMode = null;
let backupPanelState = null;
let backupPollTimer = null;
let backupListLimit = (() => {
    const saved = parseInt(localStorage.getItem('backupListLimit') || '10', 10);
    return Number.isFinite(saved) ? Math.max(1, Math.min(saved, 100)) : 10;
})();

function isBackupRunActive(run) {
    return run && ['queued', 'running'].includes(run.status);
}

function scheduleBackupPolling(runs = []) {
    if (backupPollTimer) {
        clearTimeout(backupPollTimer);
        backupPollTimer = null;
    }
    if (runs.some(isBackupRunActive)) {
        backupPollTimer = setTimeout(() => loadBackupPanel({ quiet: true }), 2000);
    }
}

function getBackupListLimit() {
    const input = document.getElementById('backupListLimit');
    const raw = input ? input.value : backupListLimit;
    const value = parseInt(raw || '10', 10);
    return Number.isFinite(value) ? Math.max(1, Math.min(value, 100)) : 10;
}

function setBackupListLimit(value) {
    backupListLimit = Math.max(1, Math.min(parseInt(value || '10', 10) || 10, 100));
    localStorage.setItem('backupListLimit', String(backupListLimit));
}

function refreshBackupList() {
    setBackupListLimit(getBackupListLimit());
    loadBackupPanel();
}

function restoreSelectedBackup() {
    const select = document.getElementById('backupRestoreSelect');
    const name = select?.value || '';
    if (!name) {
        showToast('请先选择一份备份', 'error');
        return;
    }
    restoreBackup(name);
}

function renderBackupPanel(config, provider, tools, runs, remoteFiles, maintenance, remoteError) {
    backupPanelState = { config, provider, tools, runs, remoteFiles, maintenance, remoteError };
    if (!backupProviderMode) {
        backupProviderMode = provider.mode || (config.remote_path ? 'custom' : 'webdav');
    }

    const panel = document.getElementById('backupPanel');
    const badge = document.getElementById('backupStatusBadge');
    const configured = config.has_identity && config.remote_path;
    const activeRun = runs.find(isBackupRunActive);
    if (badge) {
        if (activeRun) {
            const verb = activeRun.trigger === 'restore' ? '恢复中' : '备份中';
            badge.textContent = `${verb} ${backupProgressPercent(activeRun)}%`;
        } else {
            badge.textContent = configured ? (config.enabled ? '自动备份中' : '已配置') : '未完成配置';
        }
        badge.className = `badge ${configured ? 'badge-admin' : 'badge-user'}`;
    }

    const toolRows = ['age', 'age-keygen', 'zstd', 'rclone', 'rclone_config'].map(name => {
        const ok = !!tools[name];
        const label = name === 'rclone_config' ? 'rclone config' : name;
        return `<span class="tag" style="border-color:${ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}; color:${ok ? 'var(--success)' : 'var(--danger)'}">${label}: ${ok ? 'OK' : '缺失'}</span>`;
    }).join('');

    const latestRuns = runs.slice(0, 8).map(run => `
        <tr>
            <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(run.backup_name || '-')}</td>
            <td>${backupStatusLabel(run.status)}</td>
            <td>${renderRunProgressMini(run)}</td>
            <td>${escapeHtml(run.trigger || '-')}</td>
            <td class="tabular-nums">${run.size_bytes ? formatBackupBytes(run.size_bytes) : '-'}</td>
            <td style="color:var(--text-muted)">${formatBackupDate(run.started_at)}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${run.error ? 'var(--danger)' : 'var(--text-muted)'}" title="${escapeHtml(run.error || run.log || '')}">${escapeHtml(run.error || run.log || '')}</td>
        </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted)">暂无运行记录</td></tr>';

    const backupFiles = remoteFiles.filter(f => f.is_backup);
    const restoreOptions = backupFiles.map(file => `
        <option value="${escapeAttr(file.name)}">${escapeHtml(file.name)} · ${file.size ? formatBackupBytes(file.size) : '未知大小'} · ${formatBackupDate(file.mod_time)}</option>
    `).join('');
    const remoteRows = backupFiles.map(file => `
        <tr>
            <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(file.name)}</td>
            <td class="tabular-nums">${file.size ? formatBackupBytes(file.size) : '-'}</td>
            <td style="color:var(--text-muted)">${formatBackupDate(file.mod_time)}</td>
            <td style="text-align:right">
                <button class="btn btn-danger btn-sm" onclick="restoreBackup('${escapeAttr(file.name)}')" ${activeRun ? 'disabled' : ''}>
                    <i data-lucide="rotate-ccw" style="width:14px;height:14px"></i> 恢复
                </button>
            </td>
        </tr>
    `).join('') || `<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--text-muted)">${remoteError ? escapeHtml(remoteError) : '暂无远端备份包'}</td></tr>`;

    panel.innerHTML = `
        ${maintenance ? `<div style="padding:0.85rem 1rem;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:1rem;color:var(--warning)">维护中：${escapeHtml(maintenance.reason || maintenance.mode || '')}</div>` : ''}
        ${renderActiveBackupProgress(activeRun)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;margin-bottom:1rem">
            <section style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem">
                <div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-bottom:1rem">
                    <div>
                        <h4 style="font-size:0.95rem;margin:0 0 0.25rem 0">1. 云端连接</h4>
                        <div style="font-size:0.78rem;color:var(--text-muted)">当前目标：${escapeHtml(config.remote_path || '未设置')}</div>
                    </div>
                </div>
                <div class="view-toggle" style="width:max-content;margin-bottom:1rem">
                    <button class="${backupProviderMode === 'webdav' ? 'active' : ''}" onclick="setBackupProviderMode('webdav')" title="WebDAV">
                        <i data-lucide="folder-sync" style="width:15px;height:15px"></i>
                    </button>
                    <button class="${backupProviderMode === 's3' ? 'active' : ''}" onclick="setBackupProviderMode('s3')" title="S3 / R2 / MinIO">
                        <i data-lucide="database" style="width:15px;height:15px"></i>
                    </button>
                    <button class="${backupProviderMode === 'custom' ? 'active' : ''}" onclick="setBackupProviderMode('custom')" title="自定义 rclone">
                        <i data-lucide="terminal" style="width:15px;height:15px"></i>
                    </button>
                </div>
                <div id="backupProviderForm">${renderBackupProviderForm(provider, config)}</div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                    <button class="btn btn-primary" onclick="saveBackupProvider()">
                        <i data-lucide="save" style="width:16px;height:16px"></i> 保存连接
                    </button>
                    <button class="btn btn-secondary" onclick="testBackupRemote()">
                        <i data-lucide="plug" style="width:16px;height:16px"></i> 测试远端
                    </button>
                    <button class="btn btn-secondary" onclick="loadBackupPanel()">
                        <i data-lucide="refresh-cw" style="width:16px;height:16px"></i> 刷新
                    </button>
                </div>
                <div class="tags" style="margin-top:0.85rem">${toolRows}</div>
            </section>
            <section style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:1rem">
                <h4 style="font-size:0.95rem;margin:0 0 1rem 0">2. 备份与恢复</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;margin-bottom:0.85rem">
                    <div class="form-group" style="margin-bottom:0">
                        <label>备份时间</label>
                        <input id="backupScheduleTime" type="time" class="input-control" value="${escapeAttr(config.schedule_time || '03:30')}">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>保留份数</label>
                        <input id="backupRetention" type="number" min="1" max="365" class="input-control" value="${config.retention_count || 7}">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>时区</label>
                        <input id="backupTimezone" class="input-control" value="${escapeAttr(config.timezone || 'Asia/Shanghai')}">
                    </div>
                </div>
                <label class="checkbox-label" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.85rem">
                    <input id="backupEnabled" type="checkbox" ${config.enabled ? 'checked' : ''}>
                    启用定时备份
                </label>
                <div style="margin-bottom:0.85rem">
                    <label style="display:block;font-size:0.85rem;margin-bottom:0.4rem;color:var(--text-secondary)">备份密码</label>
                    <div style="display:flex;gap:0.5rem">
                        <input id="backupPassword" type="password" class="input-control" placeholder="${config.has_identity ? '输入以验证或导出恢复包' : '首次配置，至少 10 位'}">
                        <button class="btn btn-primary" onclick="setupBackupPassword()">
                            <i data-lucide="key-round" style="width:16px;height:16px"></i>
                        </button>
                    </div>
                    <p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.45rem">密码不会上传明文；私钥会用它加密。丢失密码后无法恢复旧备份。</p>
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                    <button class="btn btn-secondary" onclick="saveBackupConfig()">
                        <i data-lucide="save" style="width:16px;height:16px"></i> 保存策略
                    </button>
                    <button class="btn btn-primary" onclick="runBackupNow()" ${configured && !activeRun ? '' : 'disabled'}>
                        <i data-lucide="cloud-upload" style="width:16px;height:16px"></i> ${activeRun ? '任务运行中' : '立即备份'}
                    </button>
                    <button class="btn btn-secondary" onclick="exportRecoveryKit()" ${config.has_identity ? '' : 'disabled'}>
                        <i data-lucide="download" style="width:16px;height:16px"></i> 导出恢复包
                    </button>
                </div>
            </section>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem">
            <div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
                <div style="padding:0.75rem 1rem;background:rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap">
                    <div>
                        <div style="font-weight:600;font-size:0.85rem">最近备份列表</div>
                        <div style="font-size:0.75rem;color:var(--text-muted)">从远端查询最近 N 份密文包，可选择一份回档</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap">
                        <span style="font-size:0.78rem;color:var(--text-muted)">最近</span>
                        <input id="backupListLimit" type="number" min="1" max="100" class="input-control" style="width:76px;height:34px;padding:0 0.55rem" value="${backupListLimit}">
                        <span style="font-size:0.78rem;color:var(--text-muted)">份</span>
                        <button class="btn btn-secondary btn-sm" onclick="refreshBackupList()" ${activeRun ? 'disabled' : ''}>
                            <i data-lucide="search" style="width:14px;height:14px"></i> 查询
                        </button>
                    </div>
                </div>
                <div style="padding:0.75rem 1rem;border-bottom:1px solid var(--border);display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
                    <select id="backupRestoreSelect" class="input-control" style="min-width:min(100%,360px);flex:1" ${backupFiles.length ? '' : 'disabled'}>
                        ${restoreOptions || '<option value="">暂无可回档备份</option>'}
                    </select>
                    <button class="btn btn-danger btn-sm" onclick="restoreSelectedBackup()" ${backupFiles.length && !activeRun ? '' : 'disabled'}>
                        <i data-lucide="rotate-ccw" style="width:14px;height:14px"></i> 回档选中
                    </button>
                </div>
                <div style="overflow:auto;max-height:260px">
                    <table class="data-table">
                        <thead><tr><th>名称</th><th>大小</th><th>时间</th><th style="text-align:right">操作</th></tr></thead>
                        <tbody>${remoteRows}</tbody>
                    </table>
                </div>
            </div>
            <div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
                <div style="padding:0.75rem 1rem;background:rgba(0,0,0,0.25);font-weight:600;font-size:0.85rem">运行记录</div>
                <div style="overflow:auto;max-height:260px">
                    <table class="data-table">
                        <thead><tr><th>备份</th><th>状态</th><th>进度</th><th>触发</th><th>大小</th><th>开始</th><th>消息</th></tr></thead>
                        <tbody>${latestRuns}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    refreshIcons();
}

function setBackupProviderMode(mode) {
    backupProviderMode = mode;
    if (backupPanelState) {
        renderBackupPanel(
            backupPanelState.config,
            backupPanelState.provider,
            backupPanelState.tools,
            backupPanelState.runs,
            backupPanelState.remoteFiles,
            backupPanelState.maintenance,
            backupPanelState.remoteError
        );
    }
}

function renderBackupProviderForm(provider, config) {
    if (backupProviderMode === 'webdav') {
        return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.85rem">
                <div class="form-group" style="grid-column:1/-1;margin-bottom:0">
                    <label>WebDAV 地址</label>
                    <input id="backupWebdavUrl" class="input-control" placeholder="https://data.example.com/dav" value="${escapeAttr(provider.url || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>用户名</label>
                    <input id="backupWebdavUser" class="input-control" autocomplete="off" value="${escapeAttr(provider.username || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>密码</label>
                    <input id="backupWebdavPass" type="password" class="input-control" autocomplete="new-password" placeholder="${provider.username ? '留空则不修改' : ''}">
                </div>
                <div class="form-group" style="grid-column:1/-1;margin-bottom:0">
                    <label>远端目录</label>
                    <input id="backupWebdavDir" class="input-control" value="${escapeAttr(provider.directory || 'fastimg-backups')}">
                </div>
            </div>
        `;
    }

    if (backupProviderMode === 's3') {
        return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.85rem">
                <div class="form-group" style="margin-bottom:0">
                    <label>API 地址</label>
                    <input id="backupS3Endpoint" class="input-control" placeholder="https://s3.example.com" value="${escapeAttr(provider.endpoint || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>存储桶</label>
                    <input id="backupS3Bucket" class="input-control" value="${escapeAttr(provider.bucket || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>Access Key</label>
                    <input id="backupS3AccessKey" class="input-control" autocomplete="off" value="${escapeAttr(provider.access_key_id || '')}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>Secret Key</label>
                    <input id="backupS3SecretKey" type="password" class="input-control" autocomplete="new-password" placeholder="${provider.access_key_id ? '留空则不修改' : ''}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>区域</label>
                    <input id="backupS3Region" class="input-control" value="${escapeAttr(provider.region || 'us-east-1')}">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label>目录</label>
                    <input id="backupS3Dir" class="input-control" value="${escapeAttr(provider.directory || 'fastimg-backups')}">
                </div>
                <label class="checkbox-label" style="grid-column:1/-1;display:flex;align-items:center;gap:0.5rem;margin-top:0.2rem">
                    <input id="backupS3ForcePathStyle" type="checkbox" ${(provider.force_path_style || 'true') === 'true' ? 'checked' : ''}>
                    路径样式访问
                </label>
            </div>
        `;
    }

    return `
        <div class="form-group" style="margin-bottom:0.85rem">
            <label>rclone 路径</label>
            <input id="backupCustomRemotePath" class="input-control" placeholder="remote:path" value="${escapeAttr(config.remote_path || '')}">
        </div>
    `;
}

function backupProgressPercent(run) {
    if (!run) return 0;
    if (run.status === 'success') return 100;
    const value = Number(run.progress_percent || 0);
    return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function backupStageLabel(stage, trigger) {
    const backupLabels = {
        queued: '排队中',
        preparing: '准备中',
        snapshot: '创建快照',
        manifest: '生成清单',
        encrypting: '压缩加密',
        uploading_identity: '上传恢复身份',
        creating_remote_dir: '准备远端目录',
        uploading_backup: '上传密文包',
        retention: '清理旧备份',
        done: '完成',
        failed: '失败'
    };
    const restoreLabels = {
        queued: '排队中',
        preparing_restore: '准备恢复',
        downloading_identity: '下载身份',
        downloading_backup: '下载备份',
        decrypting: '解密',
        decompressing: '解压',
        validating: '校验',
        restoring: '恢复数据',
        done: '完成',
        failed: '失败'
    };
    const labels = trigger === 'restore' ? restoreLabels : backupLabels;
    return labels[stage] || stage || '处理中';
}

function renderRunProgressMini(run) {
    const percent = backupProgressPercent(run);
    const stage = backupStageLabel(run.progress_stage, run.trigger);
    const muted = run.status === 'success' || run.status === 'failed' ? 'var(--text-muted)' : 'var(--text-secondary)';
    return `
        <div style="min-width:92px">
            <div style="font-size:0.78rem;color:${muted};margin-bottom:0.25rem">${escapeHtml(stage)} · ${percent}%</div>
            <div class="progress-bar-bg" style="height:4px">
                <div class="progress-bar-fill" style="width:${percent}%;background:${run.status === 'failed' ? 'var(--danger)' : ''}"></div>
            </div>
        </div>
    `;
}

function renderActiveBackupProgress(run) {
    if (!run) return '';
    const percent = backupProgressPercent(run);
    const stage = backupStageLabel(run.progress_stage, run.trigger);
    const title = run.trigger === 'restore' ? '恢复任务正在后台执行' : '备份任务正在后台执行';
    const detail = run.progress_message || stage;
    const bytes = run.bytes_total
        ? `${formatBackupBytes(run.bytes_done || 0)} / ${formatBackupBytes(run.bytes_total)}`
        : '等待可统计的传输数据';
    return `
        <section style="border:1px solid rgba(34,211,238,0.35);background:linear-gradient(135deg,rgba(34,211,238,0.08),rgba(255,255,255,0.035));border-radius:var(--radius-sm);padding:1rem;margin-bottom:1rem;box-shadow:0 0 28px rgba(34,211,238,0.08)">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:0.8rem">
                <div>
                    <div style="font-weight:700;margin-bottom:0.25rem">${title}</div>
                    <div style="font-size:0.82rem;color:var(--text-muted)">任务 #${run.id} · ${escapeHtml(stage)} · 刷新页面后会自动接回进度</div>
                </div>
                <div style="font-size:1.3rem;font-weight:800;color:var(--text-primary)" class="tabular-nums">${percent}%</div>
            </div>
            <div class="progress-bar-bg" style="height:10px;margin-bottom:0.65rem">
                <div class="progress-bar-fill" style="width:${percent}%;background:linear-gradient(90deg,#22d3ee,#a7f3d0)"></div>
            </div>
            <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;font-size:0.82rem;color:var(--text-secondary)">
                <span>${escapeHtml(detail)}</span>
                <span class="tabular-nums">${escapeHtml(bytes)}</span>
            </div>
        </section>
    `;
}

function backupStatusLabel(status) {
    const color = status === 'success' ? 'var(--success)' : (status === 'failed' ? 'var(--danger)' : 'var(--warning)');
    return `<span style="color:${color};font-weight:600">${escapeHtml(status || '-')}</span>`;
}

function formatBackupBytes(bytes) {
    const n = Number(bytes || 0);
    if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}

function formatBackupDate(value) {
    if (!value) return '-';
    try { return new Date(value).toLocaleString(); } catch (e) { return '-'; }
}

function escapeAttr(str) {
    return escapeHtml(String(str ?? '')).replace(/"/g, '&quot;');
}

async function saveBackupProvider() {
    let payload = { provider: backupProviderMode || 'webdav' };

    if (payload.provider === 'webdav') {
        payload = {
            provider: 'webdav',
            url: document.getElementById('backupWebdavUrl')?.value || '',
            username: document.getElementById('backupWebdavUser')?.value || '',
            password: document.getElementById('backupWebdavPass')?.value || '',
            directory: document.getElementById('backupWebdavDir')?.value || 'fastimg-backups'
        };
    } else if (payload.provider === 's3') {
        payload = {
            provider: 's3',
            endpoint: document.getElementById('backupS3Endpoint')?.value || '',
            bucket: document.getElementById('backupS3Bucket')?.value || '',
            access_key_id: document.getElementById('backupS3AccessKey')?.value || '',
            secret_access_key: document.getElementById('backupS3SecretKey')?.value || '',
            region: document.getElementById('backupS3Region')?.value || 'us-east-1',
            directory: document.getElementById('backupS3Dir')?.value || 'fastimg-backups',
            force_path_style: document.getElementById('backupS3ForcePathStyle')?.checked ? 'true' : 'false'
        };
    } else {
        payload = {
            provider: 'custom',
            remote_path: document.getElementById('backupCustomRemotePath')?.value || ''
        };
    }

    const res = await fetch('/api/admin/backups/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
        showToast('云端连接已保存');
        backupProviderMode = data.provider?.mode || backupProviderMode;
        loadBackupPanel();
    } else {
        showToast(data.error || '连接保存失败', 'error');
    }
}

async function saveBackupConfig() {
    const payload = {
        enabled: document.getElementById('backupEnabled')?.checked || false,
        schedule_time: document.getElementById('backupScheduleTime')?.value || '03:30',
        timezone: document.getElementById('backupTimezone')?.value || 'Asia/Shanghai',
        retention_count: parseInt(document.getElementById('backupRetention')?.value || '7', 10)
    };
    const res = await fetch('/api/admin/backups/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
        showToast('备份配置已保存');
        loadBackupPanel();
    } else {
        showToast(data.error || '保存失败', 'error');
    }
}

async function setupBackupPassword() {
    const password = document.getElementById('backupPassword')?.value || '';
    if (password.length < 10) {
        showToast('备份密码至少需要 10 位', 'error');
        return;
    }
    const res = await fetch('/api/admin/backups/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (res.ok) {
        document.getElementById('backupPassword').value = '';
        showToast('备份加密密钥已就绪');
        loadBackupPanel();
    } else {
        showToast(data.error || '密码配置失败', 'error');
    }
}

async function testBackupRemote() {
    const res = await fetch('/api/admin/backups/test-remote', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
        showToast('远端连接正常');
        loadBackupPanel();
    } else {
        showToast(data.error || '远端连接失败', 'error');
    }
}

async function runBackupNow() {
    if (!confirm('立即创建加密备份并上传到远端?')) return;
    const res = await fetch('/api/admin/backups/run', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
        showToast('备份任务已加入队列');
        loadBackupPanel({ quiet: true });
    } else {
        showToast(data.error || '备份启动失败', 'error');
    }
}

async function restoreBackup(name) {
    const confirmWord = prompt(`恢复会进入维护模式并替换当前 data/uploads。\n请输入 RESTORE 确认恢复：${name}`);
    if (confirmWord !== 'RESTORE') return;
    const password = prompt('请输入备份密码用于解密恢复：');
    if (!password) return;
    const res = await fetch('/api/admin/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_name: name, password })
    });
    const data = await res.json();
    if (res.ok) {
        showToast('恢复任务已启动，完成后应用可能会重启');
        loadBackupPanel({ quiet: true });
    } else {
        showToast(data.error || '恢复启动失败', 'error');
    }
}

async function exportRecoveryKit() {
    let password = document.getElementById('backupPassword')?.value || '';
    if (!password) password = prompt('请输入备份密码以导出恢复包：') || '';
    if (!password) return;

    const res = await fetch('/api/admin/backups/export-recovery-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch (e) {}
        showToast(data.error || '恢复包导出失败', 'error');
        return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fastimg-recovery-kit.enc';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('恢复包已导出');
}


function switchAdminSection(section) {
    const inviteEl = document.getElementById('adminInlineInvite');
    if (!inviteEl) return;

    if (section === 'invite') {
        inviteEl.classList.toggle('hidden');
        if (!inviteEl.classList.contains('hidden')) {
            loadInlineInvites();
        }
    }
}

async function loadInlineInvites() {
    const container = document.getElementById('inlineInviteContent');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">加载中...</div>';

    try {
        const res = await fetch('/api/admin/invites');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const codes = await res.json();

        let html = `
            <div style="margin-bottom:1rem; display:flex; gap:1rem; align-items:flex-end; flex-wrap:wrap">
                <div style="display:flex; flex-direction:column; gap:0.25rem">
                    <label style="font-size:0.85rem; color:var(--text-secondary)">生成数量</label>
                    <input type="number" id="inlineInviteCount" value="1" class="input-control" style="width:80px">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.25rem">
                    <label style="font-size:0.85rem; color:var(--text-secondary)">最大使用次数</label>
                    <input type="number" id="inlineInviteLimit" value="1" class="input-control" style="width:80px">
                </div>
                <div style="display:flex; flex-direction:column; gap:0.25rem">
                    <label style="font-size:0.85rem; color:var(--text-secondary)">有效期(天)</label>
                    <input type="number" id="inlineInviteDays" value="7" class="input-control" style="width:80px">
                </div>
                <button class="btn btn-primary" type="button" onclick="generateInlineInvite()">生成</button>
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

                let dateStr = '-';
                if (c.expires_at) {
                    dateStr = new Date(c.expires_at).toLocaleDateString();
                }

                html += `
                    <tr>
                        <td style="font-family:monospace; font-size:1.1em">${escapeHtml(c.code)}</td>
                        <td>
                            <div style="display:flex; align-items:center; gap:0.5rem">
                                <span style="color:${statusColor}">${statusText}</span>
                                <span style="font-size:0.85em; opacity:0.7">(${c.current_uses}/${c.max_uses})</span>
                            </div>
                        </td>
                        <td style="font-size:0.9em">${dateStr}</td>
                        <td>
                            <button class="btn btn-danger btn-sm" type="button" style="padding:0.25rem 0.5rem; font-size:0.8rem" onclick="deleteInlineInvite('${c.id}')">删除</button>
                        </td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (e) {
        console.error('loadInlineInvites error:', e);
        container.innerHTML = '<div style="text-align:center;color:var(--danger);padding:1rem">加载失败，请重试</div>';
    }
}

async function generateInlineInvite() {
    const count = document.getElementById('inlineInviteCount')?.value || 1;
    const limit = document.getElementById('inlineInviteLimit')?.value || 1;
    const days = document.getElementById('inlineInviteDays')?.value || 7;

    const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: parseInt(count), limit: parseInt(limit), days: parseInt(days) })
    });
    if (res.ok) {
        showToast('邀请码已生成');
        loadInlineInvites();
    } else {
        showToast('生成失败', 'error');
    }
}

async function deleteInlineInvite(id) {
    const res = await fetch(`/api/admin/invites?id=${id}`, {
        method: 'DELETE'
    });
    if (res.ok) {
        showToast('已删除');
        loadInlineInvites();
    }
}

// --- Gallery Drop Zone ---
function setupGalleryDropZone() {
    const galleryView = document.getElementById('viewGallery');
    if (!galleryView) return;

    // Create overlay element
    const overlay = document.createElement('div');
    overlay.id = 'galleryDropOverlay';
    overlay.className = 'gallery-drop-overlay';
    overlay.innerHTML = `
        <div class="gallery-drop-content">
            <i data-lucide="upload-cloud" style="width:48px;height:48px;stroke-width:1.5"></i>
            <div class="gallery-drop-title">释放以上传到当前文件夹</div>
            <div class="gallery-drop-hint">沿用上传页面的压缩配置</div>
        </div>
    `;
    galleryView.style.position = 'relative';
    galleryView.appendChild(overlay);

    let dragCounter = 0;

    galleryView.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (!e.dataTransfer.types.includes('Files')) return;
        dragCounter++;
        overlay.classList.add('active');
        if (window.lucide) lucide.createIcons({ nodes: overlay.querySelectorAll('[data-lucide]') });
    });

    galleryView.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) {
            e.dataTransfer.dropEffect = 'copy';
        }
    });

    galleryView.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            overlay.classList.remove('active');
        }
    });

    galleryView.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove('active');

        if (!currentUser) {
            showToast('请先登录', 'error');
            return;
        }

        let files = [];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

        if (e.dataTransfer.items) {
            const items = Array.from(e.dataTransfer.items);

            const traverseFileTree = async (item, path) => {
                if (item.isFile) {
                    return new Promise((resolve) => {
                        item.file((file) => {
                            if (path) {
                                Object.defineProperty(file, 'webkitRelativePath', {
                                    value: path + file.name, writable: false
                                });
                            }
                            const ext = file.name.split('.').pop().toLowerCase();
                            if (imageExts.includes(ext)) files.push(file);
                            resolve();
                        });
                    });
                } else if (item.isDirectory) {
                    const dirReader = item.createReader();
                    return new Promise((resolve) => {
                        dirReader.readEntries(async (entries) => {
                            await Promise.all(entries.map(ent => traverseFileTree(ent, path + item.name + '/')));
                            resolve();
                        });
                    });
                }
            };

            await Promise.all(items.map(item => {
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry) return traverseFileTree(entry, '');
                    const f = item.getAsFile();
                    if (f) {
                        const ext = f.name.split('.').pop().toLowerCase();
                        if (imageExts.includes(ext)) files.push(f);
                    }
                }
                return Promise.resolve();
            }));
        } else {
            files = Array.from(e.dataTransfer.files).filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                return imageExts.includes(ext);
            });
        }

        if (files.length > 0) {
            galleryUploadFiles(files);
        } else {
            showToast('未找到支持的图片文件', 'error');
        }
    });
}

/**
 * Upload files using the upload page's saved settings (from localStorage).
 * This allows gallery drag-drop to respect the user's quality/passthrough preferences.
 */
function galleryUploadFiles(files) {
    if (!files || files.length === 0) return;

    // Read settings from localStorage (same source as upload page)
    const savedOriginal = localStorage.getItem('originalMode') === 'true';
    const savedStrict = localStorage.getItem('strictMode') === 'true';
    const savedQuality = parseInt(localStorage.getItem('uploadQuality') || '80');

    const passthrough = savedStrict;
    let quality = 80;
    if (savedOriginal || savedStrict) {
        quality = 100;
    } else {
        quality = Math.min(savedQuality, maxQualityLimit);
    }

    // Pre-filter oversized files
    const validFiles = [];
    for (const file of files) {
        if (window.maxUploadSizeBytes && file.size > window.maxUploadSizeBytes) {
            showToast(`文件 ${file.name} 超过大小限制 (${(window.maxUploadSizeBytes / 1024 / 1024).toFixed(0)}MB)`, 'error');
            continue;
        }
        validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    // Use batch modal for 2+ files
    const useBatchModal = validFiles.length >= 2;
    if (useBatchModal) openBatchModal(validFiles.length);

    const queueContainer = document.getElementById('uploadQueue');
    const queueList = document.getElementById('queueList');
    if (!useBatchModal) queueContainer.classList.remove('hidden');

    for (const file of validFiles) {
        const id = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        uploadQueue.push({ id, file, quality, passthrough, status: 'pending' });
        const safeName = escapeHtml(file.name);

        if (useBatchModal) {
            const el = document.createElement('div');
            el.id = id;
            el.className = 'batch-file-item';
            el.innerHTML = `
                <div style="flex:1; min-width:0">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem">
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%">${safeName}</div>
                        <div class="upload-status" style="font-size:0.85rem; color:var(--text-secondary)">等待中</div>
                    </div>
                    <div class="progress-bar-bg" style="height:4px; border-radius:2px">
                        <div class="progress-bar-fill" style="width:0%"></div>
                    </div>
                </div>
            `;
            document.getElementById('batchFileList').appendChild(el);
        } else {
            const el = document.createElement('div');
            el.id = id;
            el.className = 'card';
            el.style.cssText = 'padding: 0.75rem 1rem; display: flex; align-items: center; gap: 1rem';
            el.innerHTML = `
                <div style="flex:1; min-width:0">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem">
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%">${safeName}</div>
                        <div class="upload-status" style="font-size:0.85rem; color:var(--text-secondary)">等待中</div>
                    </div>
                    <div class="progress-bar-bg" style="height:4px; border-radius:2px">
                        <div class="progress-bar-fill" style="width:0%"></div>
                    </div>
                </div>
            `;
            queueList.appendChild(el);
        }
    }

    processQueue();
}

// --- Folder Context Menu ---
function toggleFolderMenu(btn) {
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    // Close all other menus first
    closeFolderMenus();
    if (!wasOpen) {
        menu.classList.add('open');
        if (window.lucide) lucide.createIcons({ nodes: menu.querySelectorAll('[data-lucide]') });
    }
}

function closeFolderMenus() {
    document.querySelectorAll('.folder-menu.open').forEach(m => m.classList.remove('open'));
}

// Close folder menus on any outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.folder-menu-wrapper')) {
        closeFolderMenus();
    }
});

/**
 * Copy all image links in a specific folder (across all pages).
 * @param {number} folderId - The folder ID to copy links from
 * @param {string} folderName - Display name of the folder
 */
async function copyFolderLinks(folderId, folderName) {
    closeFolderMenus();

    let allImages = [];
    let page = 1;
    let totalPages = 1;

    showToast(`正在收集「${folderName}」的链接...`);

    try {
        while (page <= totalPages) {
            let url = `/api/images?page=${page}&sort=name&order=asc&folder_id=${folderId}`;
            if (filterUserId) url += `&user_id=${filterUserId}`;

            const res = await fetch(url);
            if (!res.ok) throw new Error('请求失败');
            const data = await res.json();

            totalPages = data.pages;

            // Build path prefix from breadcrumbs
            const pathStr = data.breadcrumbs
                ? data.breadcrumbs.map(b => b.name).filter(n => n !== '首页').join('/')
                : '';
            const prefix = pathStr ? pathStr + '/' : '';

            data.images.forEach(img => {
                const displayName = prefix + img.original_name;
                allImages.push(`![${displayName}](${window.location.origin}/i/${img.filename})`);
            });

            page++;
        }

        if (allImages.length === 0) {
            showToast(`「${folderName}」中没有图片`, 'error');
            return;
        }

        const text = allImages.join('\n');
        await navigator.clipboard.writeText(text);
        showToast(`已复制「${folderName}」中 ${allImages.length} 张图片的 Markdown 链接`);
    } catch (e) {
        console.error('copyFolderLinks error:', e);
        showToast('复制失败', 'error');
    }
}
