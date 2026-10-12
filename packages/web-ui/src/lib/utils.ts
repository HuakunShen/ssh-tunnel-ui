/**
 * `@ssh-tunnel/web-ui` class-name helper (shadcn-svelte shape).
 *
 * `cn()` merges Tailwind classes with conflict resolution; the `Without*`
 * helpers strip `children`/`child` props when wrapping bits-ui primitives.
 * Verbatim from the space-lens web-ui package — same contract, same import.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};
