# Modifications to Agentic Inbox

NeoPrint3D modified Cloudflare's [Agentic Inbox](https://github.com/cloudflare/agentic-inbox/tree/48039bb6785af34e592c2966f87cde2b255c4c80) to create **NeoMail**. This notice supplements the in-file change notices, including for JSON tooling metadata and images that do not carry source comments.

- Replaced the built-in AI and Cloudflare Access integration with owner sessions and separately scoped MCP tokens.
- Refactored mail storage and delivery into shared code for Workers and standalone Node.js/SMTP. The mailbox schema, migrations, access checks and message helpers moved from `workers/` to `server/` and were changed.
- Reworked the original `app/` mail and compose components and added a responsive inbox, mailbox directory, multi-domain and alias routing, forwarding, disposable inboxes, and Trash recovery.
- Changed build configuration, package metadata and the lockfile, and added a standalone deployment and a reusable Worker configuration. Modified configuration includes `.gitignore`, `.dev.vars.example`, `package.json`, `react-router.config.ts`, `tsconfig.json`, `tsconfig.app.json` (formerly `tsconfig.cloudflare.json`), `vite.config.ts`, and `wrangler.jsonc`.
- Replaced the original favicon and `demo_app.png` with new NeoMail artwork and a screenshot of a fictional local mailbox; added PWA icons, themes, Web Push, and signed outbound arrival webhooks.
- Replaced the upstream README with NeoMail documentation. The project credits are preserved in [NOTICE](NOTICE); the original [LICENSE](LICENSE) remains unchanged.
