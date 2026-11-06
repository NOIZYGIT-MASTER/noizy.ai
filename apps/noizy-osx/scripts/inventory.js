import { createSdk } from "../src/sdk.js";

const sdk = createSdk();
const inventory = await sdk.discover();
const probes = [];
for (const tool of inventory.tools) {
  if (tool.available) probes.push(await sdk.probe({ toolId: tool.toolId }));
}
process.stdout.write(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      hostPlatform: process.platform,
      node: process.version,
      inventory,
      probes,
      scope:
        "This host only; no model operations, device access or installation.",
    },
    null,
    2,
  ) + "\n",
);
