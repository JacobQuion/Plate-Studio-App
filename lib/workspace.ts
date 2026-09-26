import { newProject, setAdDishes, type AdProject, type LibraryDish, type Scene } from "@/lib/ad-plan";
import type { RestaurantLocation } from "@/lib/locations";

export interface Workspace {
  version: 1;
  project: AdProject;
  library: LibraryDish[];
  locations: RestaurantLocation[];
  activeLocationId: string | null;
  dishHistory: { dish: LibraryDish; removedAt: number; scene?: Scene }[];
  locationHistory: { location: RestaurantLocation; removedAt: number; dishIds: string[] }[];
}

export const emptyWorkspace = (): Workspace => ({ version: 1, project: newProject(), library: [], locations: [], activeLocationId: null, dishHistory: [], locationHistory: [] });

export function archiveDish(w: Workspace, id: string, now = Date.now()): Workspace {
  const dish = w.library.find((d) => d.id === id);
  if (!dish) return w;
  return { ...w, library: w.library.filter((d) => d.id !== id), project: setAdDishes(w.project, w.project.scenes.flatMap((s) => s.dishId && s.dishId !== id ? [s.dishId] : [])), dishHistory: [{ dish, scene: w.project.scenes.find((s) => s.dishId === id), removedAt: now }, ...w.dishHistory.filter((h) => h.dish.id !== id)] };
}

export function restoreDish(w: Workspace, id: string): Workspace {
  const saved = w.dishHistory.find((h) => h.dish.id === id);
  if (!saved) return w;
  const project = setAdDishes(w.project, [...w.project.scenes.flatMap((s) => s.dishId ? [s.dishId] : []), id]);
  if (saved.scene) project.scenes = project.scenes.map((s) => s.dishId === id ? saved.scene! : s);
  return { ...w, library: [...w.library.filter((d) => d.id !== id), saved.dish], dishHistory: w.dishHistory.filter((h) => h.dish.id !== id), project };
}

export function activateLocation(w: Workspace, location: RestaurantLocation): Workspace {
  return { ...w, locations: [location, ...w.locations.filter((l) => l.id !== location.id)], activeLocationId: location.id, locationHistory: w.locationHistory.filter((h) => h.location.id !== location.id), project: { ...w.project, restaurant: location.name, website: location.website ?? "" } };
}

export function archiveLocation(w: Workspace, id: string, now = Date.now()): Workspace {
  const location = w.locations.find((l) => l.id === id);
  if (!location) return w;
  const dishIds = w.library.filter((d) => d.locationId === id).map((d) => d.id);
  const next = dishIds.reduce((state, dishId) => archiveDish(state, dishId, now), w);
  return { ...next, locations: next.locations.filter((l) => l.id !== id), activeLocationId: next.activeLocationId === id ? null : next.activeLocationId, project: next.activeLocationId === id ? { ...next.project, restaurant: "", website: "" } : next.project, locationHistory: [{ location, removedAt: now, dishIds }, ...next.locationHistory.filter((h) => h.location.id !== id)] };
}

export function restoreLocation(w: Workspace, id: string): Workspace {
  const saved = w.locationHistory.find((h) => h.location.id === id);
  if (!saved) return w;
  return activateLocation(saved.dishIds.reduce((state, dishId) => restoreDish(state, dishId), w), saved.location);
}
