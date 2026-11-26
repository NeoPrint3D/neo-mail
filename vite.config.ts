// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
  optimizeDeps: {
    // Discover route-only dependencies before the first browser request so a
    // cold dev start doesn't rebuild React midway through hydration.
    include: [
      "react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "react-router",
      "@cloudflare/kumo", "@phosphor-icons/react", "@tanstack/react-query", "dompurify", "zustand",
      "@tiptap/extension-color", "@tiptap/extension-highlight", "@tiptap/extension-image", "@tiptap/extension-link",
      "@tiptap/extension-text-align", "@tiptap/extension-text-style", "@tiptap/extension-underline", "@tiptap/react", "@tiptap/starter-kit",
    ],
  },
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
