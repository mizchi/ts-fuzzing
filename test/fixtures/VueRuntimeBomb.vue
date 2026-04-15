<script setup lang="ts">
import type { PropType } from "vue";

const props = defineProps({
  /** @fuzz.minLength 1 */
  label: {
    required: true,
    type: String,
  },
  mode: {
    default: "safe",
    type: String as PropType<"safe" | "explode">,
  },
});

if (props.mode === "explode") {
  throw new Error("vue runtime explode");
}
</script>

<template>
  <button>{{ label }}</button>
</template>
