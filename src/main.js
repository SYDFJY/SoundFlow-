import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAppStore } from './stores/appStore'
import './styles/global.css'
import './styles/controls.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// 全局错误兜底:此前未捕获异常与未处理的 Promise 拒绝完全静默,出问题只能靠猜。
// console.error 会被主进程的 console-message 监听写入 electron-log,便于事后排查。
window.addEventListener('error', (e) => {
  console.error('[全局错误]', e.message, `${e.filename || ''}:${e.lineno || 0}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  console.error('[未处理的Promise拒绝]', (r && (r.stack || r.message)) || String(r))
})

// 挂载前同步应用主题变量(首帧即主题色,消除启动瞬间不符主题的界面;
// App.vue setup 的 loadSettings 幂等保留,此处保证更早生效)
try { useAppStore(pinia).loadSettings() } catch (_) {}
app.mount('#app')
// 预热全部路由视图 chunk:侧边栏点击即时渲染,消除首次进入现加载的"慢半拍"
const _VIEWS = [
  'HomeView', 'FavoritesView', 'PlaylistView', 'ArtistView', 'AlbumView',
  'HistoryView', 'StatsView', 'RecommendView', 'FolderView', 'SettingsView', 'PlayerView', 'MiniView'
]
_VIEWS.forEach(n => import(`@/views/${n}.vue`).catch(() => {}))
