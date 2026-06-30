<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useDataStore } from './stores/data'
onLaunch(() => {
  // 后端 A（云函数）需要云开发初始化；部署前把 env 换成你的云开发环境 ID。
  // 用后端 B（公司反代）时无需此步，可删。
  // @ts-ignore wx 由微信小程序运行时提供
  if (typeof wx !== 'undefined' && wx.cloud) {
    // @ts-ignore
    wx.cloud.init({ env: 'your-cloud-env-id' })
  }
  useDataStore().hydrate()
})
</script>
<template><slot /></template>
