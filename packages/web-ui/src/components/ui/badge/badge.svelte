<script lang="ts" module>
  import { type VariantProps, tv } from "tailwind-variants";

  export const badgeVariants = tv({
    base: "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap transition-colors [&>svg]:size-3 [&>svg]:pointer-events-none",
    variants: {
      variant: {
        default: "bg-primary/12 text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        success: "bg-signal-running/12 text-signal-running",
        warning: "bg-signal-degraded/12 text-signal-degraded",
        danger: "bg-signal-failed/12 text-signal-failed",
        muted: "bg-muted text-muted-foreground",
        outline: "border-border text-foreground",
      },
      glow: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { variant: "success", glow: true, class: "shadow-[0_0_10px_1px_rgb(52_211_153/0.45)]" },
      { variant: "warning", glow: true, class: "shadow-[0_0_10px_1px_rgb(251_191_36/0.45)]" },
      { variant: "danger", glow: true, class: "shadow-[0_0_10px_1px_rgb(248_113_113/0.45)]" },
    ],
    defaultVariants: { variant: "default", glow: false },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { cn, type WithElementRef } from "../../../lib/utils.js";

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = "default",
    glow = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    variant?: BadgeVariant;
    glow?: boolean;
  } = $props();
</script>

{#if href !== undefined}
  <a bind:this={ref} data-slot="badge" class={cn(badgeVariants({ variant, glow }), className)} {href} {...restProps}>
    {@render children?.()}
  </a>
{:else}
  {@const spanProps = restProps as unknown as Record<string, unknown>}
  <span bind:this={ref} data-slot="badge" class={cn(badgeVariants({ variant, glow }), className)} {...spanProps}>
    {@render children?.()}
  </span>
{/if}
