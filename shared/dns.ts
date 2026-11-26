export interface DomainConfig {
	domain: string;
	mxHost: string;
	mxPriority: number;
	spf: string;
	dmarc: string;
	dkim: { selector: string; type: "TXT" | "CNAME"; value: string }[];
	sts: "off" | "testing" | "enforce";
	tlsReports: string;
}

export interface DnsRecord {
	purpose: string;
	name: string;
	type: "MX" | "TXT" | "CNAME";
	value: string;
	priority?: number;
}

export interface DnsCheck extends DnsRecord {
	status: "ready" | "missing" | "conflict" | "unavailable";
	found: string[];
}

export interface DomainResult {
	config: DomainConfig;
	records: DnsRecord[];
	policy: string | null;
	policyUrl: string | null;
}
