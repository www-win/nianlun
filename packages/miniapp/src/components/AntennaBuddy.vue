<script setup lang="ts">
withDefaults(defineProps<{
  color?: string
  antenna?: 'triangle' | 'rod' | 'curl' | 'ring'
  scale?: number
}>(), { color: '#43c463', antenna: 'rod', scale: 1 })
</script>

<template>
  <view class="buddy" :style="{ transform: 'scale(' + scale + ')' }">
    <view class="antenna" :class="'a-' + antenna">
      <view class="stalk"></view>
      <view class="tip"></view>
    </view>
    <view class="body" :style="{ background: color }">
      <view class="face">
        <view class="eye"></view>
        <view class="eye"></view>
      </view>
      <view class="mouth"></view>
      <view class="screen"></view>
    </view>
  </view>
</template>

<style scoped>
.buddy {
  position: relative; width: 120rpx; height: 156rpx;
  transform-origin: bottom center;
}
/* 头顶天线 */
.antenna { position: absolute; left: 50%; top: 0; transform: translateX(-50%); }
.antenna .stalk { width: 6rpx; height: 40rpx; margin: 0 auto; background: #6b6b6b; border-radius: 4rpx; }
.antenna .tip { margin: -4rpx auto 0; }
/* rod：顶端小圆球 */
.a-rod .tip { width: 18rpx; height: 18rpx; border-radius: 50%; background: #6b6b6b; }
/* triangle：顶端三角 */
.a-triangle .tip {
  width: 0; height: 0; margin-top: -2rpx;
  border-left: 14rpx solid transparent; border-right: 14rpx solid transparent;
  border-bottom: 24rpx solid #6b6b6b;
}
/* ring：顶端圆环 */
.a-ring .tip { width: 30rpx; height: 30rpx; border-radius: 50%; border: 6rpx solid #6b6b6b; background: transparent; }
/* curl：顶端卷卷（半环） */
.a-curl .stalk { height: 30rpx; }
.a-curl .tip {
  width: 30rpx; height: 22rpx; margin-top: -2rpx;
  border: 6rpx solid #6b6b6b; border-bottom: none;
  border-radius: 30rpx 30rpx 0 0; background: transparent;
}
/* 身体 */
.body {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 110rpx; height: 116rpx;
  border-radius: 55rpx 55rpx 48rpx 48rpx;
  box-shadow: inset 0 -8rpx 16rpx rgba(0,0,0,0.08), 0 6rpx 14rpx rgba(0,0,0,0.12);
}
.face { position: absolute; left: 0; right: 0; top: 30rpx; display: flex; justify-content: center; gap: 20rpx; }
.eye { width: 16rpx; height: 20rpx; border-radius: 50%; background: #2b2b2b; }
.mouth {
  position: absolute; left: 50%; top: 58rpx; transform: translateX(-50%);
  width: 26rpx; height: 14rpx; border: 4rpx solid #2b2b2b; border-top: none;
  border-radius: 0 0 26rpx 26rpx;
}
/* 肚子小屏幕 */
.screen {
  position: absolute; left: 50%; bottom: 14rpx; transform: translateX(-50%);
  width: 46rpx; height: 34rpx; border-radius: 10rpx;
  background: rgba(255,255,255,0.5); border: 3rpx solid rgba(255,255,255,0.75);
}
</style>
