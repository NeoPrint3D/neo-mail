export interface PushDevice {
	id: string;
	label: string;
	createdAt: string;
}

export interface PushSettings {
	publicKey: string | null;
	devices: PushDevice[];
}
