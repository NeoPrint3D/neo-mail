// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Mailbox } from "~/types";
import { queryKeys } from "./keys";

export function useConfig() {
	return useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig, staleTime: 300_000 });
}

export function useMailboxes() {
	return useQuery<Mailbox[]>({
		queryKey: queryKeys.mailboxes.all,
		queryFn: () => api.listMailboxes() as Promise<Mailbox[]>,
	});
}

export function useMailbox(mailboxId: string | undefined) {
	return useQuery<Mailbox>({
		queryKey: mailboxId
			? queryKeys.mailboxes.detail(mailboxId)
			: ["mailboxes", "_disabled"],
		queryFn: () => api.getMailbox(mailboxId!) as Promise<Mailbox>,
		enabled: !!mailboxId,
	});
}

export function useCreateMailbox() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: api.createMailbox,
		onSuccess: (mailbox) => {
			qc.setQueryData(queryKeys.mailboxes.detail(mailbox.id), mailbox);
			qc.setQueryData<Mailbox[]>(queryKeys.mailboxes.all, (current) =>
				current ? [...current.filter((box) => box.id !== mailbox.id), mailbox] : current);
			void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
			void qc.invalidateQueries({ queryKey: ["workspace-mail"] });
		},
	});
}

export function useUpdateMailbox() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			settings,
		}: { mailboxId: string; settings: unknown }) =>
			api.updateMailbox(mailboxId, settings),
		onSuccess: (mailbox, { mailboxId }) => {
			qc.setQueryData(queryKeys.mailboxes.detail(mailboxId), mailbox);
			void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
			void qc.invalidateQueries({ queryKey: ["workspace-mail"] });
		},
	});
}

export function useDeleteMailbox() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (mailboxId: string) => api.deleteMailbox(mailboxId),
		onSuccess: (_data, mailboxId) => {
			qc.removeQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId), exact: true });
			qc.removeQueries({ queryKey: ["emails", mailboxId] });
			qc.removeQueries({ queryKey: ["folders", mailboxId] });
			void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
			void qc.invalidateQueries({ queryKey: ["workspace-mail"] });
		},
	});
}
