<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useDataStore } from './stores/data'
onLaunch(() => { useDataStore().hydrate() })
</script>
<template><slot /></template>
