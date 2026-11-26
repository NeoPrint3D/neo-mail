export type RoutingMatchType = "exact" | "catch_all";
export type RoutingAction = "forward" | "mailbox" | "reject";

export interface RoutingRule {
	id: string;
	domain: string;
	matchType: RoutingMatchType;
	address: string;
	action: RoutingAction;
	forwardTo: string[];
	deliverTo: string | null;
	rejectReason: string;
	enabled: boolean;
	note: string;
	createdAt: string;
	updatedAt: string;
}

export interface RoutingRuleInput {
	domain: string;
	matchType: RoutingMatchType;
	localPart?: string;
	action: RoutingAction;
	forwardTo?: string[];
	deliverTo?: string | null;
	rejectReason?: string;
	enabled?: boolean;
	note?: string;
}

export interface InboxForwardingRule {
	mailboxId: string;
	domain: string;
	enabled: boolean;
	forwardTo: string[];
	keepCopy: boolean;
}

export interface CloudflareRoutingSyncResult {
	ruleId: string;
	address: string;
	state: "created" | "updated" | "skipped" | "error";
	detail?: string;
}
