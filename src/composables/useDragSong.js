import { ref } from 'vue'

// 全局歌曲拖拽状态(JS 拖拽实现,跨组件:列表内排序 / 拖到侧边栏歌单)
export const dragSongPath = ref(null)

export function setDragSong(path) {
  dragSongPath.value = path || null
}

export function clearDragSong() {
  dragSongPath.value = null
}
