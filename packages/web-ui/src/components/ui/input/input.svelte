<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "../../../lib/utils.js";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: WithElementRef<HTMLInputAttributes> = $props();
</script>

<!--
  macOS-native text field: compact height, 5px radius, subtle inner shadow,
  cyan ring on focus. Falls back to the generic radius elsewhere.
-->
<input
  bind:this={ref}
  data-slot="input"
  class={cn(
    "macos:h-7 macos:rounded-[5px] macos:text-[13px] macos:shadow-inner macos:focus-visible:ring-primary/50 h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 font-mono text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  bind:value
  {...restProps}
/>
