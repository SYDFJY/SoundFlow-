import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'Home', component: () => import('@/views/HomeView.vue') },
  { path: '/favorites', name: 'Favorites', component: () => import('@/views/FavoritesView.vue') },
  { path: '/playlist/:id', name: 'Playlist', component: () => import('@/views/PlaylistView.vue') },
  { path: '/artist', name: 'Artist', component: () => import('@/views/ArtistView.vue') },
  { path: '/album', name: 'Album', component: () => import('@/views/AlbumView.vue') },
  { path: '/history', name: 'History', component: () => import('@/views/HistoryView.vue') },
  { path: '/folder', name: 'Folder', component: () => import('@/views/FolderView.vue') },
  { path: '/settings', name: 'Settings', component: () => import('@/views/SettingsView.vue') },
  { path: '/player', name: 'Player', component: () => import('@/views/PlayerView.vue') },
  { path: '/mini', name: 'Mini', component: () => import('@/views/MiniView.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
