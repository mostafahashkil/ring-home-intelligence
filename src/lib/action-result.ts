export type ActionResult = { ok: boolean; message: string; data?: unknown };

export const ok = (message: string, data?: unknown): ActionResult => ({ ok: true, message, data });
export const fail = (message: string): ActionResult => ({ ok: false, message });
