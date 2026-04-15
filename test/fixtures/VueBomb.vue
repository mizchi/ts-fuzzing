<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string;
    mode?: "safe" | "explode";
  }>(),
  {
    mode: "safe",
  },
);

if (props.mode === "explode") {
  throw new Error("vue explode");
}
</script>

<template>
  <button>{{ label }}</button>
</template>
