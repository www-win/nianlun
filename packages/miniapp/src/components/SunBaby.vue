<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 96 })
</script>

<template>
  <view class="sun" :style="{ width: size + 'rpx', height: size + 'rpx' }">
    <view class="rays"></view>
    <view class="disc">
      <view class="cheek cl"></view>
      <view class="cheek cr"></view>
      <view class="eye el"></view>
      <view class="eye er"></view>
      <view class="smile"></view>
    </view>
  </view>
</template>

<style scoped>
.sun { position: relative; }
.rays {
  position: absolute; inset: -18%;
  border-radius: 50%;
  background: radial-gradient(circle, #ffd23f 60%, rgba(255,210,63,0) 61%);
  filter: blur(1rpx);
}
.disc {
  position: absolute; inset: 8%;
  border-radius: 50%; background: #ffcf33;
  box-shadow: inset 0 -6rpx 12rpx rgba(230,160,0,0.3);
}
.cheek { position: absolute; top: 55%; width: 18%; height: 12%; border-radius: 50%; background: #ff9db0; opacity: 0.8; }
.cl { left: 14%; } .cr { right: 14%; }
.eye { position: absolute; top: 38%; width: 10%; height: 16%; border-radius: 50%; background: #6b4a00; }
.el { left: 32%; } .er { right: 32%; }
.smile {
  position: absolute; left: 50%; top: 52%; transform: translateX(-50%);
  width: 34%; height: 20%; border: 4rpx solid #6b4a00; border-top: none;
  border-radius: 0 0 40rpx 40rpx;
}
</style>
