import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// crypto.randomUUID only exists in secure contexts, so it is missing over plain
// HTTP on a network address. crypto.getRandomValues is always available.
export function randomId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// navigator.clipboard is also limited to secure contexts.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("copy-failed");
}

// A loopback LiveKit URL from the backend means this machine's dev server. From
// another device on the network it has to point at the host serving this page.
export function reachableUrl(url: string): string {
  const target = new URL(url);
  const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!isLoopback(target.hostname) || isLoopback(window.location.hostname)) return url;
  target.hostname = window.location.hostname;
  return target.href;
}
