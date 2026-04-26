<script setup lang="ts">
export type BadgeProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 12
   */
  label: string;
  tone?: "info" | "warn";
};

defineProps<BadgeProps>();
</script>

<template>
  <span :data-tone="tone ?? 'info'">{{ label }}</span>
</template>
