// CUSTOM(background-local-image): id -> data URL for saved local images, filled by the controller.
const cache = new Map<string, string>();
export const getCachedFile = (id: string) => cache.get(id);
export const setCachedFile = (id: string, dataUrl: string) => { cache.set(id, dataUrl); };
