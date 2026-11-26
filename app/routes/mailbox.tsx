// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Outlet } from "react-router";
import WorkspaceFrame from "~/components/WorkspaceFrame";

export default function MailboxRoute() {
	return <WorkspaceFrame><Outlet /></WorkspaceFrame>;
}
