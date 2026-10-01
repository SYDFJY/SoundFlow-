/**
 * 语义图标名 → @lucide/vue 组件 的唯一映射表。
 *
 * 为什么要有这一层:业务代码之前直接写死内联 SVG 或 emoji,想换一套视觉要改上百处,
 * 而且同一个概念在不同文件里用的是不同图形(文件夹在 Sidebar 是手写 SVG、在 FolderView
 * 是另一份手写 SVG、在别处是 📁)。这里把「概念」和「图形」分开:
 *   - 业务只说概念:<Icon name="folder" />;
 *   - 图形集中在这里,换库/换风格只改这张表;
 *   - 命名用语义而不是图形(folder 不叫 folderIcon2),避免出现两个都叫 folder 的图标。
 */
import {
  // 目录 / 文件
  Folder, FolderOpen, FolderPlus, FolderTree, FolderSearch, FileText, FileMusic,
  LocateFixed, Crosshair,
  // 导航 / 界面
  Home, Heart, Users, Disc3, ListMusic, BarChart3, Sparkles, Settings, Search,
  // 操作
  Plus, X, Check, Trash2, Save, RefreshCw, ExternalLink, Pencil, Download, Upload,
  // 状态 / 提示
  Info, TriangleAlert, CircleHelp, Loader, LoaderCircle,
  // 排版 / 摘要
  ArrowUp, ArrowDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ArrowLeftRight,
  Clock, Calendar, History, Globe, Keyboard, Music, Music2, ListOrdered, Repeat, Shuffle,
  Volume2, VolumeX, Play, Pause, SkipBack, SkipForward, Gauge, AudioLines, Mic2, Wand2,
  // 播放模式 / 面板 / 窗口形态
  List, Repeat1, SlidersVertical, PictureInPicture2, RotateCcw, RotateCw, Timer, Trash,
  // 专辑/歌单/歌手详情里用到的补充
  ListPlus, HeartPlus, Music4, ChevronsUpDown, EllipsisVertical,
  Minus, Square, Copy, Columns2,
  Image as ImageIcon, Languages, Palette, Sun, Moon, Monitor, Pin, Maximize2, Minimize2
} from '@lucide/vue'

export const ICONS = {
  // ---- 目录(用户点名要优化的部分:此前是两份手写 SVG + 📁/📝/🔤 emoji)----
  folder: Folder,
  folderOpen: FolderOpen,
  folderPlus: FolderPlus,
  folderTree: FolderTree,
  folderSearch: FolderSearch,

  // ---- 文件类型 ----
  lyrics: FileText,      // 歌词文件
  font: FileText,        // 字体文件(同图形,靠上下文/语义色区分)
  song: FileMusic,

  // ---- 导航(与 Sidebar 既有图标保持一致)----
  home: Home,
  favorite: Heart,
  artist: Users,
  album: Disc3,
  playlist: ListMusic,
  stats: BarChart3,
  recommend: Sparkles,
  settings: Settings,
  search: Search,
  // 定位当前播放(列表虚拟化下靠算滚动位置,不是 scrollIntoView)
  locate: LocateFixed,
  locateCross: Crosshair,
  more: EllipsisVertical,
  duplicate: Copy,

  // ---- 操作 ----
  add: Plus,
  close: X,
  check: Check,
  remove: Trash2,
  save: Save,
  refresh: RefreshCw,
  opendir: ExternalLink,
  edit: Pencil,
  download: Download,
  upload: Upload,
  darkMode: Moon,
  lightMode: Sun,

  // ---- 状态 / 提示 ----
  info: Info,
  warning: TriangleAlert,
  help: CircleHelp,
  loading: Loader,
  loadingCircle: LoaderCircle,

  // ---- 排序 / 方向 ----
  sortAsc: ArrowUp,
  sortDesc: ArrowDown,
  expand: ChevronUp,
  collapse: ChevronDown,
  back: ChevronLeft,
  forward: ChevronRight,
  swap: ArrowLeftRight,

  // ---- 播放模式(四个模式各有专属图形,不能用同一个"循环"图标糊过去)----
  modeList: List,
  modeRepeat: Repeat,
  modeRepeatOne: Repeat1,
  modeShuffle: Shuffle,

  // ---- 面板 / 形态 ----
  equalizer: SlidersVertical,
  miniPlayer: PictureInPicture2,
  // 两态岛(迷你窗展开/收起):岛在紧凑条下方展开,所以"向下"是展开;
  // 与排序用的 expand/collapse 语义分开命名,避免两处混用后各自改不动
  islandExpand: ChevronDown,
  islandCollapse: ChevronUp,
  timer: Timer,
  rewind: RotateCcw,
  fastForward: RotateCw,
  multiSelect: ChevronsUpDown,
  splitView: Columns2,
  // 窗口控制(最小化/最大化/还原),与系统窗口按钮的通用约定一致
  winMinimize: Minus,
  winMaximize: Square,
  winRestore: Copy,

  // ---- 音乐语义 ----
  time: Clock,
  date: Calendar,
  history: History,
  globe: Globe,
  keyboard: Keyboard,
  music: Music,
  musicAlt: Music2,
  queue: ListOrdered,
  loop: Repeat,
  shuffle: Shuffle,
  volume: Volume2,
  mute: VolumeX,
  play: Play,
  pause: Pause,
  prev: SkipBack,
  next: SkipForward,
  rate: Gauge,
  spectrum: AudioLines,
  pitch: Mic2,
  effect: Wand2,
  cover: ImageIcon,
  translate: Languages,
  color: Palette,
  pin: Pin,
  fullscreen: Maximize2,
  restore: Minimize2,
  window: Monitor
}

/** 供测试与文档使用:所有可用语义名 */
export const ICON_NAMES = Object.keys(ICONS)
