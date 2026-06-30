<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useDataStore } from './src/stores/data'
onLaunch(() => { useDataStore().hydrate() })
</script>
<template><slot /></template>
