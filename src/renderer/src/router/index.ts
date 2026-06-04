import { createRouter, createWebHashHistory } from 'vue-router'
import AppShell from '@/components/AppShell.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: AppShell
    }
  ]
})

export default router
