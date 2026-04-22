<script lang="ts">
  import type { PriceTagProps } from "./PriceTag.props.js";

  export let currency: PriceTagProps["currency"];
  export let amount: PriceTagProps["amount"];
</script>

<span data-currency={currency}>{currency} {amount}</span>
