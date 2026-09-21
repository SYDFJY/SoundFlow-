// 封面预加载 composable
// 切歌瞬间保持旧封面,新图 onload 就绪后才切换,消除封面露底/露位闪烁
// 用法:const displayCover = useCoverPreload(coverUrlRef)(computed ref)
import { ref, watch } from 'vue'

export function useCoverPreload(coverUrlRef) {
  const shownCover = ref(coverUrlRef.value || null)
  watch(coverUrlRef, (url) => {
    if (!url) { shownCover.value = null; return }
    const img = new Image()
    // 快速切歌时可能有多个 Image 在途,仅当目标仍是当前歌曲时才落地,避免旧图覆盖新封面
    img.onload = () => { if (url === coverUrlRef.value) shownCover.value = url }
    img.onerror = () => { if (url === coverUrlRef.value) shownCover.value = url } // 失败也切换(交由 onCoverError 兜底修复)
    img.src = url
  })
  return shownCover
}
