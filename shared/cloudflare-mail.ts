export interface ForwardingDestination { email: string; verified: boolean }

export interface CloudflareMailStatus {
	routingEnabled: boolean;
	workerConnected: boolean;
	blockingMx: string[];
	overrides: string[];
	catchAllConflict: boolean;
	sendingStatus: string | null;
	sendingSupported: boolean;
}
