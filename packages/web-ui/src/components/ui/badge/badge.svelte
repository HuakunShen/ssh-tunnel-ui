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
    },
    defaultVariants: { variant: "default" },
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
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    variant?: BadgeVariant;
  } = $props();
</script>

{#if href !== undefined}
  <a bind:this={ref} data-slot="badge" class={cn(badgeVariants({ variant }), className)} {href} {...restProps}>
    {@render children?.()}
  </a>
{:else}
  {@const spanProps = restProps as unknown as Record<string, unknown>}
  <span bind:this={ref} data-slot="badge" class={cn(badgeVariants({ variant }), className)} {...spanProps}>
    {@render children?.()}
  </span>
{/if}
