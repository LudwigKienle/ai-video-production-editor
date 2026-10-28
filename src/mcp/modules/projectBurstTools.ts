/**
 * MCP tools: Burst Frame on storyboard shots (Project Space → Storyboard →
 * "Burst Frame"). A shot with a burst prompt is filmed with it verbatim
 * (20 static setups, hard cuts, 5 s, audio off) by project_generate_shot_videos.
 * The shot list lives in the Project Space, so these tools use its live
 * commands and open the page when needed.
 */
import { invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

export const PROJECT_BURST_LIVE = { get: 'project.burst.get', set: 'project.burst.set', dialog: 'project.burst.dialog' } as const;

const openProject = (ctx: StudioToolContext) => ({ openWorkspace: () => ctx.actions.setActiveWorkspace('PROJECT'), workspace: 'PROJECT' as const });
const live = async (name: string, args: Record<string, unknown>, ctx: StudioToolContext) => {
    const value = await invokeLiveCommand(name, args, openProject(ctx));
    return (value && typeof value === 'object' ? value : { value }) as Record<string, unknown>;
};

const SUBJECTS = ['person', 'object', 'animal', 'landscape', 'architecture'];

export const PROJECT_BURST_TOOL_MODULE: StudioToolModule = {
    id: 'project-burst',
    label: 'Project Space · Burst Frame',
    tools: [
        {
            name: 'project_burst_frame_list',
            description: 'List storyboard shots with their Burst Frame state: whether the shot has a frame, the concept references of its scene (the default selection), and if a burst is set (source, references, aspect, length, prompt check). Optional shot number.',
            parameters: { type: 'object', properties: { shot: { type: 'integer', description: 'Only this shot number.' } } },
            handler: (args, ctx) => live(PROJECT_BURST_LIVE.get, typeof args.shot === 'number' ? { shot: args.shot } : {}, ctx),
        },
        {
            name: 'project_burst_frame_set',
            description: 'Set the Burst Frame of a storyboard shot. Pass a finished prompt (e.g. from burst_frame_build_prompt), or continuity + style (+ subjectKind, lighting, 20 custom shots, compact) to build it. references = concept reference names/ids (default: the references that occur in the shot\'s scene). source "references" builds the moment from the references alone (no start frame; film with Seedance 2.5 Omni, MiniMax H3 Reference or PixVerse C1 Reference). Filming uses the prompt verbatim: 5 s, 20 hard cuts, audio off. Film with project_generate_shot_videos (spends credits).',
            writes: true,
            parameters: {
                type: 'object',
                properties: {
                    shot: { type: 'integer', description: 'Shot number (see project_list_shots).' },
                    prompt: { type: 'string', description: 'Finished burst prompt; overrides the build fields.' },
                    continuity: { type: 'string', description: 'What stays exactly the same: subject, pose, wardrobe, props, set layout.' },
                    style: { type: 'string', description: 'Light, palette, texture, lens.' },
                    subjectKind: { type: 'string', enum: SUBJECTS },
                    lighting: { type: 'string', enum: ['continuous', 'time-of-day'] },
                    shots: { type: 'array', items: { type: 'string' }, description: '20 shot descriptions without numbering (optional).' },
                    compact: { type: 'boolean', description: 'Shorter wording for models with tight prompt limits.' },
                    aspectRatio: { type: 'string', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
                    references: { type: 'array', items: { type: 'string' }, description: 'Concept reference names or ids sent with the burst; [] for none; omit for the scene default.' },
                    source: { type: 'string', enum: ['start-frame', 'references'], description: 'start-frame (default) or references (no start frame).' },
                    showDialog: { type: 'boolean', description: 'Also open the Burst Frame dialog for this shot.' },
                },
                required: ['shot'],
            },
            handler: (args, ctx) => {
                const shot = numArg(args, 'shot');
                const hasPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0;
                if (!hasPrompt && !(typeof args.continuity === 'string' && args.continuity.trim())) {
                    throw new Error('Pass prompt, or continuity (and style) to build the burst prompt.');
                }
                if (args.subjectKind !== undefined && !SUBJECTS.includes(String(args.subjectKind))) throw new Error(`Unknown subjectKind ${String(args.subjectKind)}.`);
                if (Array.isArray(args.shots) && args.shots.length !== 20) throw new Error('shots must list exactly 20 setups (or leave it out for the default library).');
                if (args.source !== undefined && args.source !== 'start-frame' && args.source !== 'references') throw new Error('source must be start-frame or references.');
                return live(PROJECT_BURST_LIVE.set, { ...args, shot }, ctx);
            },
        },
        {
            name: 'project_burst_frame_clear',
            description: 'Remove the Burst Frame from a storyboard shot; Filming goes back to the normal motion prompt.',
            writes: true,
            parameters: { type: 'object', properties: { shot: { type: 'integer' } }, required: ['shot'] },
            handler: (args, ctx) => live(PROJECT_BURST_LIVE.set, { shot: numArg(args, 'shot'), clear: true }, ctx),
        },
        {
            name: 'project_burst_frame_open',
            description: 'Show the Burst Frame dialog of the Storyboard for a shot (UI only).',
            parameters: { type: 'object', properties: { shot: { type: 'integer' } } },
            handler: async (args, ctx) => {
                ctx.actions.setActiveWorkspace('PROJECT');
                return live(PROJECT_BURST_LIVE.dialog, typeof args.shot === 'number' ? { shot: args.shot } : {}, ctx);
            },
        },
    ],
};

registerStudioToolModule(PROJECT_BURST_TOOL_MODULE);
