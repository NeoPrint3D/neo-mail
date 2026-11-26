export const mcpServerName = "neomail";
export const mcpIssuablePermissions = ["read", "send", "admin"] as const;
export type McpIssuablePermission = (typeof mcpIssuablePermissions)[number];
export const mcpPermissions = [...mcpIssuablePermissions, "manage"] as const; // Keep accepting previously issued tokens.
export type McpPermission = (typeof mcpPermissions)[number];

export interface McpScope {
	/** null means workspace-wide, including future non-disposable mailboxes */
	mailboxes: string[] | null;
	permission: McpPermission;
}

export interface McpToken extends McpScope {
	id: string;
	name: string;
	created: string;
}
