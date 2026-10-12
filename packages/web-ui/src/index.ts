/**
 * `@ssh-tunnel/web-ui` — shadcn-svelte component library for the tunnel
 * console. Host-free: no `node:*`, no DOM globals at import time. Hosts
 * (web app, Tauri shell, DSH panel, VS Code webview) import components and
 * the shared stylesheet; versions stay in the root catalog.
 */
export { Button, buttonVariants, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/ui/button/index.js";
export { Input } from "./components/ui/input/index.js";
export { Badge, badgeVariants, type BadgeVariant } from "./components/ui/badge/index.js";
export { Card } from "./components/ui/card/index.js";
export { cn, type WithElementRef, type WithoutChild, type WithoutChildren, type WithoutChildrenOrChild } from "./lib/utils.js";
