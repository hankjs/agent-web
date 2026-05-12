import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../views/Login.vue"),
    },
    {
      path: "/",
      name: "sessions",
      component: () => import("../views/SessionList.vue"),
    },
    {
      path: "/chat/:sessionId",
      name: "chat",
      component: () => import("../views/Chat.vue"),
      props: true,
    },
    {
      path: "/specs",
      name: "specs",
      component: () => import("../views/Specs.vue"),
    },
    {
      path: "/changes",
      name: "changes",
      component: () => import("../views/Changes.vue"),
    },
    {
      path: "/changes/:changeId",
      name: "change-detail",
      component: () => import("../views/ChangeDetail.vue"),
      props: true,
    },
    {
      path: "/settings/agents",
      name: "agent-settings",
      component: () => import("../views/LocalAgentSettings.vue"),
    },
  ],
});

router.beforeEach((to) => {
  const token = localStorage.getItem("hank_client_token");
  if (!token && to.name !== "login") return { name: "login" };
  if (token && to.name === "login") return { name: "sessions" };
});

export default router;
