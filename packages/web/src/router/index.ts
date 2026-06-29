import { createRouter, createWebHistory } from 'vue-router'
import Overview from '../pages/Overview.vue'
import ImportPage from '../pages/ImportPage.vue'
import FriendsPage from '../pages/FriendsPage.vue'
import ReportPage from '../pages/ReportPage.vue'
import FriendDetail from '../pages/FriendDetail.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview },
    { path: '/import', name: 'import', component: ImportPage },
    { path: '/friends', name: 'friends', component: FriendsPage },
    { path: '/friends/:id', name: 'friend-detail', component: FriendDetail },
    { path: '/report', name: 'report', component: ReportPage },
  ],
})
