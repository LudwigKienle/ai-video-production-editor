/**
 * Guard for tools that spend provider credits: they take `confirm: true`
 * and refuse without it (same pattern as upscaleTools).
 */
import type { JsonSchema, StudioTool, StudioToolModule } from './toolModules.ts';

export const CONFIRM_PROP: Record<'confirm', JsonSchema> = {
  confirm: { type: 'boolean', description: 'Must be true (spends provider credits).' },
};

export function requireConfirm(args: Record<string, unknown>, what: string): void {
  if (args.confirm !== true) {
    throw new Error(`${what} spends provider credits. Check the settings/cost first, then call again with confirm: true.`);
  }
}

/**
 * Adds the confirm parameter, the check and a description note to every tool
 * of a module that has `cost: 'paid'` (tools that already declare `confirm`
 * are left alone).
 */
export function guardPaidTools(module: StudioToolModule): StudioToolModule {
  return {
    ...module,
    tools: module.tools.map((tool) => {
      if (tool.cost !== 'paid' || tool.parameters.properties?.confirm) return tool;
      return {
        ...tool,
        description: `${tool.description} Spends credits: requires confirm: true.`,
        parameters: { ...tool.parameters, properties: { ...(tool.parameters.properties ?? {}), ...CONFIRM_PROP } },
        handler: (args, ctx) => {
          requireConfirm(args, tool.name);
          const { confirm: _confirm, ...rest } = args;
          return tool.handler(rest, ctx);
        },
      } satisfies StudioTool;
    }),
  };
}
