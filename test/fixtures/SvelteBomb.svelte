<script lang="ts">
  export let label: string;
  export let mode: "safe" | "explode" = "safe";
</script>

<button data-mode={mode}>{label}</button>
