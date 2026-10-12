<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "../../../lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!--
  macOS-native card: 10px radius, hairline border, soft drop shadow, subtle
  top highlight. Hover ring is opt-in via class (cards that are buttons).
-->
<div
  bind:this={ref}
  data-slot="card"
  class={cn(
    "macos:rounded-[10px] macos:shadow-[0_1px_4px_rgb(0_0_0/0.28),inset_0_1px_0_rgb(255_255_255/0.06)] rounded-2xl border border-white/10 bg-card text-card-foreground shadow-[0_8px_30px_rgb(0_0_0/0.25)] backdrop-blur transition-colors",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
