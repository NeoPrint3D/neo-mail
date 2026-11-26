export async function currentPushSubscription() {
	if (!("serviceWorker" in navigator)) return null;
	const registration = await navigator.serviceWorker.getRegistration();
	return await registration?.pushManager?.getSubscription() ?? null;
}

export async function pushDeviceId(endpoint: string) {
	const bytes = new TextEncoder().encode(endpoint);
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
}

export function iosDevice() {
	return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function installedApp() {
	return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function applicationServerKey(value: string) {
	return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

export function pushDeviceLabel() {
	const agent = navigator.userAgent;
	if (iosDevice()) return /iPhone|iPod/.test(agent) ? "iPhone" : "iPad";
	const platform = /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "Mac" : "Desktop";
	const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
	return `${browser} on ${platform}`;
}
