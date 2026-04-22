<script setup lang="ts">
export type ExplosiveButtonProps = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 16
   */
  label: string;
  mode: "safe" | "explode";
};

const props = defineProps<ExplosiveButtonProps>();

if (props.mode === "explode") {
  throw new Error(`explode:${props.label}`);
}
</script>

<template>
  <button :data-mode="mode">{{ label }}</button>
</template>
