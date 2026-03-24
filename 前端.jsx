import React, { useState } from 'react';
import {
    Image as ImageIcon,
    UploadCloud,
    Settings,
    ShieldCheck,
    Search,
    Link2,
    Trash2,
    MoreHorizontal,
    CheckCircle2,
    HardDrive,
    Users,
    Activity,
    ChevronRight,
    Plus,
    PanelLeft,
    LayoutGrid,
    SquareDashedBottomCode,
    Zap,
    Camera,
    Command
} from 'lucide-react';

export default function App() {
    const [activeTab, setActiveTab] = useState('gallery');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    const navItems = [
        { id: 'gallery', label: '我的相册', icon: ImageIcon },
        { id: 'upload', label: '云端上传', icon: UploadCloud },
        { id: 'settings', label: '偏好设置', icon: Settings },
        { id: 'admin', label: '系统管理', icon: ShieldCheck, adminOnly: true },
    ];

    return (
        <>
            {/* 注入全局极简滚动条样式，抹除浏览器默认的粗糙感 */}
            <style>{`
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

            <div className="flex h-screen bg-black text-white/90 font-sans antialiased selection:bg-blue-500/30 selection:text-white overflow-hidden">

                {/* --- 侧边栏 (Sidebar) --- */}
                <aside
                    className={`${isSidebarOpen ? 'w-64' : 'w-20'
                        } flex-shrink-0 bg-transparent border-r border-white/[0.08] flex flex-col z-20 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] relative`}
                >
                    {/* 背景模糊层 - 加入 saturate-150 增强 Apple 的 Vibrant 毛玻璃质感 */}
                    <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-3xl saturate-150 -z-10"></div>

                    {/* Logo 区域 */}
                    <div className="h-20 flex items-center px-5 pt-4">
                        <div className={`flex items-center gap-3.5 ${!isSidebarOpen && 'justify-center w-full'} transition-all duration-300`}>
                            <div className="w-9 h-9 bg-gradient-to-br from-gray-800 to-black border border-white/[0.12] rounded-[14px] flex items-center justify-center flex-shrink-0 shadow-lg shadow-black/50 relative overflow-hidden group cursor-pointer">
                                <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                                <Zap size={18} className="text-white/90 z-10" />
                            </div>
                            {isSidebarOpen && (
                                <span className="font-semibold text-lg tracking-tight whitespace-nowrap overflow-hidden transition-opacity duration-300">
                                    CloudX <span className="text-white/40">Pro</span>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 导航菜单 */}
                    <div className="px-3 py-6 flex-1 flex flex-col gap-1">
                        {isSidebarOpen && (
                            <p className="px-3 text-[11px] font-semibold text-white/30 mb-2 uppercase tracking-widest transition-opacity duration-300">
                                主要视口
                            </p>
                        )}
                        <nav className="space-y-1 relative">
                            {navItems.map((item) => {
                                const Icon = item.icon;
                                const isActive = activeTab === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => setActiveTab(item.id)}
                                        title={!isSidebarOpen ? item.label : undefined}
                                        className={`w-full flex items-center ${isSidebarOpen ? 'px-3 justify-start' : 'justify-center'} h-11 rounded-xl transition-all duration-300 ease-out group relative overflow-hidden ${isActive
                                                ? 'bg-white/[0.08] text-white font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                                                : 'text-white/50 hover:bg-white/[0.04] hover:text-white/90'
                                            }`}
                                    >
                                        {/* Apple风格的活动指示器 */}
                                        {isActive && isSidebarOpen && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-full shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                                        )}

                                        <Icon size={18} strokeWidth={isActive ? 2.2 : 2} className={`${isActive ? 'text-white' : 'text-white/50 group-hover:text-white/80'} flex-shrink-0 transition-all duration-300`} />

                                        {isSidebarOpen && (
                                            <span className="ml-3.5 whitespace-nowrap tracking-wide text-sm">{item.label}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>

                    {/* Pro 存储空间指示器 */}
                    <div className="p-4 pb-6">
                        <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.08] to-transparent border border-white/[0.08] p-4 transition-all duration-500 ${!isSidebarOpen && 'opacity-0 translate-y-4 pointer-events-none absolute bottom-4'}`}>
                            {/* 微妙的发光背景 */}
                            <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-500/20 blur-2xl rounded-full pointer-events-none"></div>

                            <div className="flex justify-between items-center mb-4 relative z-10">
                                <span className="text-sm font-semibold tracking-tight text-white/90 flex items-center gap-1.5">
                                    <Command size={14} className="text-white/50" />
                                    Pro 计划
                                </span>
                                <span className="text-[10px] text-black bg-white/90 px-2 py-0.5 rounded-full font-bold tracking-wider uppercase">Active</span>
                            </div>
                            <div className="w-full bg-black/50 rounded-full h-1.5 mb-3 overflow-hidden border border-white/5 backdrop-blur-md relative z-10">
                                <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-1.5 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{ width: '68%' }}></div>
                            </div>
                            <div className="flex justify-between items-center relative z-10 tabular-nums">
                                <p className="text-[11px] text-white/50 font-medium">136GB 已用</p>
                                <p className="text-[11px] text-white/50 font-medium">200GB</p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* --- 主内容区 (Main Content) --- */}
                <main className="flex-1 flex flex-col min-w-0 bg-black relative">

                    {/* 顶部导航 (Top Bar) - 苹果风毛玻璃效果，加入 saturate-150 */}
                    <header className={`h-16 flex items-center justify-between px-6 z-30 absolute top-0 w-full transition-all duration-500 ${scrolled ? 'bg-black/40 backdrop-blur-2xl saturate-150 border-b border-white/[0.08]' : 'bg-transparent border-b border-transparent'
                        }`}>
                        <div className="flex items-center gap-6 w-full max-w-xl">
                            <button
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-300 active:scale-95 flex-shrink-0"
                                title="切换侧边栏"
                            >
                                <PanelLeft size={20} />
                            </button>

                            <div className="w-full relative group">
                                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-white/80 transition-colors duration-300" />
                                <input
                                    type="text"
                                    placeholder="搜索图片、地点或标签..."
                                    className="w-full pl-10 pr-4 py-2 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] focus:bg-white/[0.12] focus:border-white/[0.2] focus:ring-4 focus:ring-white/[0.05] rounded-full text-sm text-white placeholder-white/40 transition-all duration-300 outline-none backdrop-blur-md"
                                />
                            </div>
                        </div>

                        {/* 右侧操作区 - 补充迷你头像保持界面平衡 */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                            {/* 增加 flex-shrink-0 防止顶部小头像被压缩 */}
                            <button className="w-8 h-8 flex-shrink-0 rounded-full bg-white/[0.05] border border-white/[0.1] overflow-hidden hover:border-white/30 transition-all duration-300 active:scale-90">
                                <img
                                    src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80"
                                    alt="User Profile"
                                    className="w-full h-full object-cover"
                                />
                            </button>
                        </div>
                    </header>

                    {/* 页面内容容器 - 使用更优雅的 React 原生 onScroll 事件替代 DOM 监听 */}
                    <div
                        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 20)}
                        className="flex-1 overflow-y-auto pt-16 px-6 lg:px-12 pb-12 scroll-smooth"
                    >
                        {/* 关键优化：加入 key={activeTab} 让每次切换都有优雅的进入动画 */}
                        <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] mt-8">
                            {activeTab === 'gallery' && <GalleryPage />}
                            {activeTab === 'upload' && <UploadPage isUploading={isUploading} setIsUploading={setIsUploading} />}
                            {activeTab === 'settings' && <SettingsPage />}
                            {activeTab === 'admin' && <AdminPage />}
                        </div>
                    </div>
                </main>
            </div>
        </>
    );
}

// ==========================================
// 页面组件：相册 (Gallery)
// ==========================================
function GalleryPage() {
    const [viewMode, setViewMode] = useState('waterfall');

    const mockImages = [
        { src: "https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[3/4]" },
        { src: "https://images.unsplash.com/photo-1707343843437-caacff5cfa74?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[16/9]" },
        { src: "https://images.unsplash.com/photo-1682687982501-1e58f8142222?auto=format&fit=crop&w=800&q=80", ratio: "aspect-square" },
        { src: "https://images.unsplash.com/photo-1707306984355-4388b7afec88?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[2/3]" },
        { src: "https://images.unsplash.com/photo-1682687218147-9806132dc697?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[4/3]" },
        { src: "https://images.unsplash.com/photo-1707305318131-01b38fccae06?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[3/4]" },
        { src: "https://images.unsplash.com/photo-1682695796954-bad0d0f59ff1?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[16/9]" },
        { src: "https://images.unsplash.com/photo-1706820546252-870081d636ac?auto=format&fit=crop&w=800&q=80", ratio: "aspect-[3/5]" },
    ];

    return (
        <div className="max-w-[1600px] mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-6">
                <div>
                    <h1 className="text-4xl font-bold tracking-tighter mb-2 text-white">所有媒体</h1>
                    <p className="text-sm text-white/50 font-medium tabular-nums">1,284 项内容 • 上传于云端</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* 视图切换 */}
                    <div className="flex items-center bg-white/[0.04] p-1 rounded-xl border border-white/[0.08] backdrop-blur-xl saturate-150">
                        <button
                            onClick={() => setViewMode('waterfall')}
                            className={`p-2 rounded-lg transition-all duration-300 ${viewMode === 'waterfall' ? 'bg-white/10 shadow-sm text-white' : 'text-white/40 hover:text-white/80'}`}
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-lg transition-all duration-300 ${viewMode === 'list' ? 'bg-white/10 shadow-sm text-white' : 'text-white/40 hover:text-white/80'}`}
                        >
                            <SquareDashedBottomCode size={18} className="rotate-90" />
                        </button>
                    </div>

                    <div className="w-px h-6 bg-white/[0.1]"></div>

                    <button className="px-5 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white rounded-xl text-sm font-semibold transition-all duration-300 active:scale-95 backdrop-blur-xl saturate-150">
                        选择
                    </button>
                    <button className="px-5 py-2.5 bg-white text-black hover:bg-gray-200 rounded-xl text-sm font-semibold transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.2)] flex items-center gap-2 active:scale-95">
                        <Plus size={16} strokeWidth={2.5} /> 添加
                    </button>
                </div>
            </div>

            <div className={`
        ${viewMode === 'waterfall'
                    ? "columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4"
                    : "flex flex-col gap-6 max-w-4xl mx-auto"
                }
      `}>
                {mockImages.map((img, idx) => (
                    <div
                        key={idx}
                        className={`
              group relative overflow-hidden bg-white/[0.02] border border-white/[0.05] cursor-pointer hover:border-white/[0.15] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]
              ${viewMode === 'waterfall' ? `break-inside-avoid rounded-2xl ${img.ratio}` : 'w-full aspect-[21/9] rounded-3xl'}
            `}
                        style={{ transform: "translateZ(0)" }} // GPU 加速渲染防闪烁
                    >
                        {/* 加载占位背景 */}
                        <div className="absolute inset-0 bg-white/[0.02] animate-pulse"></div>

                        <img
                            src={img.src}
                            alt={`Gallery item ${idx}`}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
                            loading="lazy"
                            decoding="async" // 优化性能，异步解码图片不阻塞主线程
                        />

                        {/* 微妙的内阴影，增加立体感 */}
                        <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] rounded-2xl md:rounded-3xl pointer-events-none"></div>

                        {/* Apple 风格的悬浮操作层 - 增加 saturate 让色彩透出更通透 */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-400 flex flex-col justify-between p-4 backdrop-blur-[2px] saturate-150">
                            <div className="flex justify-end transform -translate-y-2 group-hover:translate-y-0 transition-transform duration-400">
                                <button className="p-2 bg-black/40 hover:bg-black/70 backdrop-blur-xl rounded-full text-white/90 transition-all border border-white/10 active:scale-90">
                                    <MoreHorizontal size={18} />
                                </button>
                            </div>

                            <div className="flex justify-between items-end transform translate-y-4 group-hover:translate-y-0 transition-transform duration-400 ease-[cubic-bezier(0.23,1,0.32,1)]">
                                <div className="text-white drop-shadow-lg">
                                    <p className="font-semibold text-sm tracking-tight mb-0.5">IMG_{800 + idx}.HEIC</p>
                                    <p className="text-[11px] text-white/60 font-medium tabular-nums">2.4 MB • HDR</p>
                                </div>
                                <div className="flex gap-2">
                                    <button className="p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-2xl border border-white/20 rounded-full text-white shadow-xl transform active:scale-90 transition-all" title="拷贝链接">
                                        <Link2 size={16} />
                                    </button>
                                    <button className="p-2.5 bg-red-500/20 hover:bg-red-500/40 backdrop-blur-2xl border border-red-500/30 rounded-full text-red-100 shadow-xl transform active:scale-90 transition-all" title="删除">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ==========================================
// 页面组件：云端上传 (Upload)
// ==========================================
function UploadPage() {
    return (
        <div className="max-w-4xl mx-auto mt-8">
            <div className="mb-12 text-center">
                <h1 className="text-4xl font-bold tracking-tighter mb-4 text-white">上传至云端</h1>
                <p className="text-sm text-white/50 font-medium">支持 HEIC, RAW, JPG, PNG 格式。Pro 用户专享无损原片存储。</p>
            </div>

            <div className="relative group cursor-pointer">
                {/* 悬浮发光效果 */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-blue-500/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>

                <div className="border border-dashed border-white/[0.15] group-hover:border-white/40 group-hover:bg-white/[0.02] rounded-[2rem] p-24 flex flex-col items-center justify-center bg-transparent transition-all duration-500 relative z-10 backdrop-blur-sm">
                    <div className="w-20 h-20 bg-gradient-to-b from-white/[0.08] to-white/[0.02] border border-white/[0.08] rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-2xl">
                        <UploadCloud className="text-white/60 group-hover:text-white w-8 h-8 transition-colors duration-500" strokeWidth={1.5} />
                    </div>
                    <h3 className="text-xl font-semibold mb-2 text-white tracking-tight">将文件拖放至此</h3>
                    <p className="text-sm text-white/40 mb-8 max-w-md font-medium">
                        或使用下方按钮浏览设备文件
                    </p>
                    <button className="px-8 py-3 bg-white hover:bg-gray-200 text-black rounded-full font-bold transition-all duration-300 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_30px_rgba(255,255,255,0.25)]">
                        浏览文件
                    </button>
                </div>
            </div>

            <div className="mt-20">
                <h4 className="text-[11px] font-bold text-white/30 mb-5 uppercase tracking-widest pl-2">最近传输</h4>
                <div className="space-y-3">
                    {[1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-5 p-4 bg-white/[0.02] border border-white/[0.05] rounded-2xl hover:bg-white/[0.04] transition-all duration-300">
                            <div className="w-14 h-14 bg-black border border-white/[0.1] rounded-xl overflow-hidden flex-shrink-0 relative">
                                <img src={`https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?auto=format&fit=crop&w=150&q=80`} alt="preview" className="w-full h-full object-cover" decoding="async" />
                                <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] rounded-xl pointer-events-none"></div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate mb-1 tracking-tight">DSC_00{80 + i}.RAW</p>
                                <p className="text-[11px] text-white/40 font-medium tabular-nums">42.8 MB • 1 分钟前</p>
                            </div>
                            <div className="hidden md:block w-48 px-4">
                                <div className="h-1.5 w-full bg-black border border-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }}></div>
                                </div>
                            </div>
                            <div className="text-blue-400 pr-2">
                                <CheckCircle2 size={22} strokeWidth={2} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ==========================================
// 页面组件：偏好设置 (Settings)
// ==========================================
function SettingsPage() {
    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-12">
                <h1 className="text-4xl font-bold tracking-tighter mb-3 text-white">偏好设置</h1>
                <p className="text-sm text-white/50 font-medium">管理您的 Apple ID 账户与底层处理规则。</p>
            </div>

            <div className="space-y-8">
                <section className="bg-white/[0.02] rounded-[2rem] border border-white/[0.05] overflow-hidden backdrop-blur-xl saturate-150">
                    <div className="p-8 border-b border-white/[0.05] flex items-center gap-6">
                        {/* 增加 flex-shrink-0 防止大头像被挤扁 */}
                        <div className="relative group cursor-pointer flex-shrink-0">
                            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-white/10 group-hover:border-white/30 transition-colors">
                                <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80" alt="Avatar" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                            </div>
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-full flex items-center justify-center">
                                <Camera size={24} className="text-white" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-2xl font-bold text-white tracking-tight mb-1">Tim Cook</h3>
                            <p className="text-sm text-white/50 font-medium mb-3">tim@apple.com</p>
                            <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide">
                                Pro 订阅会员
                            </span>
                        </div>
                    </div>

                    <div className="p-8 bg-black/20">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <label className="block text-[11px] font-bold text-white/40 mb-2 uppercase tracking-widest">显示名称</label>
                                <input type="text" defaultValue="Tim Cook" className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-xl focus:bg-white/[0.05] focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-white font-medium" />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-white/40 mb-2 uppercase tracking-widest">联系邮箱</label>
                                <input type="email" defaultValue="tim@apple.com" className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-xl focus:bg-white/[0.05] focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-white font-medium" />
                            </div>
                        </div>
                    </div>
                </section>

                <section className="bg-white/[0.02] rounded-[2rem] border border-white/[0.05] p-8 backdrop-blur-xl saturate-150">
                    <h2 className="text-lg font-bold mb-8 flex items-center gap-3 text-white tracking-tight">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-gray-700 to-gray-900 border border-white/[0.1] text-white flex items-center justify-center shadow-md">
                            <Settings size={16} />
                        </div>
                        处理引擎
                    </h2>

                    <div className="space-y-6">
                        <div className="flex items-start justify-between py-2 group">
                            <div className="pr-8">
                                <h4 className="font-semibold text-white tracking-tight text-base">智能 HEIC/WebP 转换</h4>
                                <p className="text-sm text-white/40 mt-1.5 leading-relaxed font-medium">使用 Apple 神经引擎在云端自动转换为下一代格式，画质无损的前提下最高可缩减 50% 存储占用。</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-1">
                                <input type="checkbox" className="sr-only peer" defaultChecked />
                                {/* 苹果风格 Switch */}
                                <div className="w-12 h-7 bg-white/[0.1] border border-white/[0.05] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white/10 after:border after:rounded-full after:h-6 after:w-6 after:transition-all after:shadow-md peer-checked:bg-green-500 peer-checked:border-green-500 transition-colors duration-300"></div>
                            </label>
                        </div>

                        <div className="w-full h-px bg-white/[0.05]"></div>

                        <div className="flex items-start justify-between py-2 group">
                            <div className="pr-8">
                                <h4 className="font-semibold text-white tracking-tight text-base">保留原始 EXIF 数据</h4>
                                <p className="text-sm text-white/40 mt-1.5 leading-relaxed font-medium">完整保留焦距、光圈、快门速度及 GPS 坐标等拍摄元数据。</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-1">
                                <input type="checkbox" className="sr-only peer" />
                                <div className="w-12 h-7 bg-white/[0.1] border border-white/[0.05] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white/10 after:border after:rounded-full after:h-6 after:w-6 after:transition-all after:shadow-md peer-checked:bg-green-500 peer-checked:border-green-500 transition-colors duration-300"></div>
                            </label>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

// ==========================================
// 页面组件：系统管理 (Admin)
// ==========================================
function AdminPage() {
    const stats = [
        { label: '注册用户', value: '12,482', trend: '↗ +12.5%', isUp: true, icon: Users, color: 'text-blue-400' },
        { label: '总存储量', value: '48.2 TB', trend: '↗ +4.2%', isUp: true, icon: HardDrive, color: 'text-purple-400' },
        { label: 'API 调用 (今日)', value: '2.4M', trend: '↘ -1.8%', isUp: false, icon: Activity, color: 'text-emerald-400' },
    ];

    return (
        <div className="max-w-6xl mx-auto pb-8">
            {/* 头部区域：增加流畅的左滑入动画 */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-6">
                <div className="animate-in fade-in slide-in-from-left-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                    <h1 className="text-4xl font-bold tracking-tighter mb-2 text-white">系统状态</h1>
                    <p className="text-sm text-white/50 font-medium">实时监控全局资源与高频用户活动。</p>
                </div>
                <div className="flex gap-3 animate-in fade-in slide-in-from-right-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                    <button className="px-5 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white rounded-xl text-sm font-semibold transition-all duration-300 active:scale-95 backdrop-blur-xl saturate-150">
                        角色管理
                    </button>
                    <button className="px-5 py-2.5 bg-white text-black hover:bg-gray-200 rounded-xl text-sm font-semibold transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.2)] active:scale-95">
                        导出报告
                    </button>
                </div>
            </div>

            {/* 数据卡片：级联延迟动画 (Cascade Animation) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
                {stats.map((stat, idx) => {
                    const Icon = stat.icon;
                    return (
                        <div
                            key={idx}
                            style={{ animationFillMode: 'both', animationDelay: `${idx * 100}ms` }}
                            className="animate-in fade-in slide-in-from-bottom-8 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] bg-gradient-to-b from-white/[0.04] to-transparent rounded-3xl p-6 border border-white/[0.05] flex flex-col justify-between hover:bg-white/[0.06] transition-all duration-300 relative overflow-hidden group shadow-lg shadow-black/20"
                        >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/[0.02] rounded-full blur-3xl group-hover:bg-white/[0.04] transition-colors"></div>

                            <div className="flex justify-between items-start mb-6">
                                {/* 增加 flex-shrink-0 保护状态图标 */}
                                <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-black border border-white/[0.1] flex items-center justify-center shadow-md">
                                    <Icon size={18} className={stat.color} />
                                </div>
                                {/* 新增趋势徽章 */}
                                <span className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold tracking-wide ${stat.isUp ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                    }`}>
                                    {stat.trend}
                                </span>
                            </div>

                            <div>
                                <h3 className="text-3xl font-bold text-white tracking-tighter mb-1 tabular-nums">{stat.value}</h3>
                                <p className="text-[11px] text-white/40 font-bold uppercase tracking-widest">{stat.label}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 高密数据表格区 */}
            <div
                style={{ animationFillMode: 'both', animationDelay: '300ms' }}
                className="animate-in fade-in slide-in-from-bottom-8 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] bg-white/[0.02] rounded-3xl border border-white/[0.05] overflow-hidden backdrop-blur-xl saturate-150 shadow-2xl shadow-black/50"
            >
                <div className="px-6 py-4 border-b border-white/[0.05] bg-black/40 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <h3 className="font-bold text-base text-white tracking-tight flex items-center gap-2">
                        活跃用户概览
                        <span className="flex h-2 w-2 relative ml-1">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                    </h3>

                    {/* macOS 风格分段选择器 */}
                    <div className="flex bg-white/[0.03] p-1 rounded-lg border border-white/[0.05]">
                        {['全部视图', 'Pro 节点', '免费层'].map((tab, i) => (
                            <button key={tab} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-300 ${i === 0 ? 'bg-white/[0.08] text-white shadow-sm border border-white/[0.05]' : 'text-white/40 hover:text-white/80 border border-transparent'
                                }`}>
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/[0.05]">
                                <th className="px-6 py-4 text-[11px] font-bold text-white/30 uppercase tracking-widest w-1/3">账户档案</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-white/30 uppercase tracking-widest">订阅层级</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-white/30 uppercase tracking-widest">资源占用</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-white/30 uppercase tracking-widest">最近活动</th>
                                <th className="px-6 py-4 text-[11px] font-bold text-white/30 uppercase tracking-widest text-right">管理</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.02]">
                            {[
                                { name: 'Craig Federighi', email: 'craig@apple.com', plan: 'Pro', usage: '184 GB', date: '刚刚', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=100&q=80', active: true },
                                { name: 'Jony Ive', email: 'jony@design.com', plan: 'Enterprise', usage: '2.4 TB', date: '1 小时前', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&q=80', active: false },
                                { name: 'Jane Doe', email: 'jane@example.com', plan: 'Free', usage: '2.1 GB', date: '12 小时前', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=100&q=80', active: false },
                            ].map((user, idx) => (
                                <tr
                                    key={idx}
                                    style={{ animationFillMode: 'both', animationDelay: `${400 + (idx * 100)}ms` }}
                                    className="animate-in fade-in slide-in-from-bottom-4 duration-500 hover:bg-white/[0.03] transition-all group cursor-pointer active:scale-[0.99]"
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-4">
                                            {/* 增加 flex-shrink-0 防止表格内的用户头像被压缩 */}
                                            <div className="relative flex-shrink-0">
                                                <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full object-cover border border-white/[0.1] group-hover:border-white/30 transition-colors duration-300" />
                                                {user.active && (
                                                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-black rounded-full"></div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-white text-sm tracking-tight mb-0.5 group-hover:text-blue-400 transition-colors">{user.name}</div>
                                                <div className="text-xs text-white/40 font-medium">{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase border ${user.plan === 'Pro' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                user.plan === 'Enterprise' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-white/5 text-white/50 border-white/10'
                                            }`}>
                                            {user.plan}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm font-semibold text-white/90 tabular-nums">{user.usage}</td>
                                    <td className="px-6 py-4 text-sm text-white/40 font-medium tabular-nums">{user.date}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="p-2 text-white/30 hover:text-white hover:bg-white/10 rounded-full transition-all duration-300 transform group-hover:translate-x-1">
                                            <ChevronRight size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}