<script lang="ts">
  let {
    label,
    mode = "safe",
  }: {
    /** @fuzz.minLength 1 */
    label: string;
    mode?: "safe" | "explode";
  } = $props();
</script>

<button data-mode={mode}>{label}</button>
