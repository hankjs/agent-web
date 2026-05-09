import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/', component: () => import('./views/Dashboard.vue') },
    { path: '/sessions', component: () => import('./views/Sessions.vue') },
    { path: '/sessions/:id', component: () => import('./views/SessionDetail.vue') },
    { path: '/prompts', component: () => import('./views/PromptLab.vue') },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
