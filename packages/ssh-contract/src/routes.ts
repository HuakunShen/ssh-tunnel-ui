/**
 * HTTP route table for the tunnel daemon. Paths + methods are declared once
 * here so server, typed client, and API docs cannot disagree.
 */
export const TUNNEL_ROUTES = {
  health: { method: "GET", path: "/api/health" },
  listProfiles: { method: "GET", path: "/api/profiles" },
  createProfile: { method: "POST", path: "/api/profiles" },
  getProfile: { method: "GET", path: "/api/profiles/:id" },
  updateProfile: { method: "PUT", path: "/api/profiles/:id" },
  deleteProfile: { method: "DELETE", path: "/api/profiles/:id" },
  previewProfile: { method: "GET", path: "/api/profiles/:id/preview" },
  listStates: { method: "GET", path: "/api/states" },
  getState: { method: "GET", path: "/api/states/:id" },
  startTunnel: { method: "POST", path: "/api/states/:id/start" },
  stopTunnel: { method: "POST", path: "/api/states/:id/stop" },
  stopAll: { method: "POST", path: "/api/states/stop-all" },
  probeTunnel: { method: "POST", path: "/api/states/:id/probe" },
  listHosts: { method: "GET", path: "/api/ssh-hosts" },
} as const;

export type TunnelRouteName = keyof typeof TUNNEL_ROUTES;

export function profilePath(id: string): string {
  return `/api/profiles/${encodeURIComponent(id)}`;
}

export function previewPath(id: string): string {
  return `/api/profiles/${encodeURIComponent(id)}/preview`;
}

export function statePath(id: string): string {
  return `/api/states/${encodeURIComponent(id)}`;
}

export function startPath(id: string): string {
  return `/api/states/${encodeURIComponent(id)}/start`;
}

export function stopPath(id: string): string {
  return `/api/states/${encodeURIComponent(id)}/stop`;
}

export function probePath(id: string): string {
  return `/api/states/${encodeURIComponent(id)}/probe`;
}
