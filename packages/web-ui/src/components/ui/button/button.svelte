<script lang="ts" module>
  import { cn, type WithElementRef } from "../../../lib/utils.js";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { type VariantProps, tv } from "tailwind-variants";

  export const buttonVariants = tv({
    base: "macos:rounded-[5px] macos:text-[13px] macos:h-7 macos:px-3 macos:shadow-sm windows:rounded-[4px] windows:h-8 linux:rounded-lg linux:h-9 linux:font-semibold group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent px-4 py-2 text-sm font-medium whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px",
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85 macos:shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/75",
        outline: "macos:bg-white/5 macos:shadow-sm border-border bg-card hover:bg-accent hover:text-accent-foreground shadow-xs",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive/12 text-destructive hover:bg-destructive/22",
      },
      size: {
        default: "h-9",
        sm: "h-8 px-3 text-[13px]",
        xs: "h-7 px-2.5 text-xs",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
    };
</script>

<script lang="ts">
  let {
    class: className,
    variant = "default",
    size = "default",
    ref = $bindable(null),
    href = undefined,
    type = "button",
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href !== undefined}
  <a bind:this={ref} data-slot="button" class={cn(buttonVariants({ variant, size }), className)} {href} {...restProps}>
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
