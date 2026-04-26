<script lang="ts">
  export let label: string = "";
  export let mode: "safe" | "explode" = "safe";

  if (String(mode) === "explode") {
    throw new Error(`explode:${label}`);
  }
</script>

<button data-mode={mode}>{label}</button>
