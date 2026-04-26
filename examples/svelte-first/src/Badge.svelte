<script lang="ts">
  /** @fuzz.minLength 1 */
  /** @fuzz.maxLength 12 */
  export let label: string;
  export let tone: "info" | "warn" = "info";
</script>

<span data-tone={tone}>{label}</span>
