<script lang="ts">
  let {
    label,
    count = 0,
  }: {
    /** @fuzz.minLength 1 */
    label: string;
    /** @fuzz.min 0 */
    /** @fuzz.max 9 */
    count?: number;
  } = $props();
</script>

<span data-count={count}>{label}:{count}</span>
