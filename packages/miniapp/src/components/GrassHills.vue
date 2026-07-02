<script setup lang="ts">
withDefaults(defineProps<{ height?: number }>(), { height: 120 })
</script>

<template>
  <view class="hills" :style="{ height: height + 'rpx' }">
    <view class="hill h1"></view>
    <view class="hill h2"></view>
    <view class="hill h3"></view>
  </view>
</template>

<style scoped>
.hills { position: relative; width: 100%; overflow: hidden; }
.hill { position: absolute; bottom: -40rpx; border-radius: 50%; }
.h1 { left: -10%; width: 55%; height: 200rpx; background: #7fd694; }
.h2 { right: -8%; width: 50%; height: 220rpx; background: #5fc47a; }
.h3 { left: 28%; width: 48%; height: 180rpx; background: #43c463; }
</style>
