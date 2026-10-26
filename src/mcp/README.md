# MCP tool modules ("ai-video-studio")

Every new feature is reachable from the local MCP server. A feature adds one
module file; App.tsx publishes all modules automatically.

```
src/mcp/
  toolModules.ts      types, registerStudioToolModule, collectStudioTools, arg helpers
  liveCommands.ts     registerLiveCommand / invokeLiveCommand for UI-local state
  mcpHarness.ts       test harness: real registerStudioTools bridge + fake window.electron
  modules/<area>Tools.ts       one module per area (fx, timeline, export, color, …)
  modules/<area>Tools.test.ts  at least one test that calls the tools over the bridge
```

## Writing a module

```ts
import { registerStudioToolModule, findClip, str } from '../toolModules.ts';

registerStudioToolModule({
  id: 'export',
  label: 'Export',
  tools: [
    {
      name: 'export_queue_add',            // snake_case, area prefix
      description: 'Add a render job …',    // what it does, units, ids to pass
      writes: true,                         // changes project data
      parameters: { type: 'object', properties: { preset: { type: 'string' } }, required: ['preset'] },
      handler: async (args, ctx) => ({ jobId: '…' }),
    },
  ],
});
```

- Read state with `ctx.getState()` (clips, tracks, media, playhead, selection,
  `extras` for markers/soundMix/comps …) and change it only through `ctx.actions`.
- State that lives inside a page component: register live commands while the
  page is mounted (`useEffect(() => registerLiveCommands({ 'export.queue.add': … }), [])`)
  and call `invokeLiveCommand('export.queue.add', args, { openWorkspace: () => ctx.actions.setActiveWorkspace('EXPORT'), workspace: 'EXPORT' })`
  from the tool handler.
- Return plain JSON. Throwing is fine: the tool replies `{ ok: false, message }`.
- Test: `createTestContext()` + `createMcpHarness(ctx)` from `mcpHarness.ts`, then
  `await mcp.call('export_queue_add', { … })`. Imports in tests use `.ts` extensions.
