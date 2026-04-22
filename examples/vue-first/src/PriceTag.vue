<script setup lang="ts">
import type { PriceTagProps } from "./PriceTag.props.js";

defineProps<PriceTagProps>();
</script>

<template>
  <span :data-currency="currency">{{ currency }} {{ amount }}</span>
</template>
