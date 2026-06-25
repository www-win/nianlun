<script setup lang="ts">
// 顶栏:品牌 + 主导航 + 隐私标识 + CTA
</script>

<template>
  <header class="topbar">
    <div class="wrap topbar-in">
      <router-link class="brand" to="/" aria-label="年轮 首页">
        <svg class="rings" width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
          <circle cx="13" cy="13" r="11.5" stroke="var(--accent)" stroke-width="1.4"/>
          <circle cx="13" cy="13" r="7.5" stroke="var(--accent)" stroke-width="1.4" opacity="0.6"/>
          <circle cx="13" cy="13" r="3.4" fill="var(--accent)"/>
        </svg>
        年轮 <small>聊天记忆 · 年度报告</small>
      </router-link>
      <nav class="nav" aria-label="主导航">
        <router-link to="/" active-class="is-active">概览</router-link>
        <router-link to="/import" active-class="is-active">导入数据</router-link>
        <router-link to="/friends" active-class="is-active">好友信息</router-link>
        <router-link to="/report" active-class="is-active">年度报告</router-link>
      </nav>
      <div class="topbar-end">
        <span class="privacy-badge">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 2.5 3.8v3.4c0 3 2.3 5.8 5.5 6.8 3.2-1 5.5-3.8 5.5-6.8V3.8L8 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          本地处理
        </span>
        <router-link class="btn btn-primary btn-sm" to="/import">开始整理</router-link>
      </div>
    </div>
  </header>
</template>
