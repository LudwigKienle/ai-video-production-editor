import {
  StudioAgentCapability,
  StudioAgentCapabilityId,
  StudioAgentSnapshot,
} from '../types';
import {
  buildCreativeDNAGuidance,
  summarizeCreativeDNA,
} from './creativeDnaService';

export const STUDIO_AGENT_CAPABILITIES: StudioAgentCapability[] = [
  {
    id: 'write_project_script',
    title: 'Write Project Script',
    scope: 'project',
    risk: 'medium',
    policy: 'safe_auto',
    description:
      'Turn a user idea into a script draft and write it into the project script panel.',
    inputs: [
      {
        key: 'prompt',
        type: 'string',
        required: true,
        description: 'Creative brief, premise, or production idea for the script.',
      },
      {
        key: 'length',
        type: 'string',
        required: false,
        description: 'Optional script format such as teaser, trailer, short, feature, commercial, micro-drama, or reelshort.',
      },
      {
        key: 'mode',
        type: 'string',
        required: false,
        description: 'Optional writing mode such as fast or slow.',
      },
    ],
    expectedOutcome: 'The project script field contains a fresh draft aligned to the brief.',
  },
  {
    id: 'improve_project_script',
    title: 'Improve Project Script',
    scope: 'project',
    risk: 'medium',
    policy: 'safe_auto',
    description:
      'Refine the current project script with assistant instructions and Script Doctor quality passes.',
    inputs: [
      {
        key: 'instruction',
        type: 'string',
        required: false,
        description: 'Optional rewrite direction from the user.',
      },
      {
        key: 'targetScore',
        type: 'number',
        required: false,
        description: 'Optional minimum script quality score to target.',
      },
      {
        key: 'maxPasses',
        type: 'number',
        required: false,
        description: 'Optional maximum number of Script Doctor passes.',
      },
    ],
    expectedOutcome: 'The current script is improved and stored back into the project script panel.',
  },
  {
    id: 'navigate_workspace',
    title: 'Navigate Workspace',
    scope: 'global',
    risk: 'low',
    policy: 'safe_auto',
    description:
      'Switch between the main workspaces without relying on blind UI clicking.',
    inputs: [
      {
        key: 'workspace',
        type: 'workspace',
        required: true,
        description: 'Target workspace to open.',
      },
    ],
    expectedOutcome: 'The requested workspace is active and ready for the next action.',
  },
  {
    id: 'set_project_phase',
    title: 'Set Project Phase',
    scope: 'project',
    risk: 'low',
    policy: 'safe_auto',
    description:
      'Move the Project Hub to a specific phase such as script, concept, storyboard, filming, review, or marketing.',
    inputs: [
      {
        key: 'phase',
        type: 'string',
        required: true,
        description: 'Phase identifier inside Project Hub.',
      },
    ],
    expectedOutcome: 'The requested production phase is selected.',
  },
  {
    id: 'select_timeline_clip',
    title: 'Select Timeline Clip',
    scope: 'edit',
    risk: 'low',
    policy: 'safe_auto',
    description: 'Focus a specific clip before trim, move, review, or text actions.',
    inputs: [
      {
        key: 'clipId',
        type: 'string',
        required: true,
        description: 'Timeline clip identifier.',
      },
    ],
    expectedOutcome: 'The target clip is selected in the editor.',
  },
  {
    id: 'generate_edit_plan',
    title: 'Generate Edit Plan',
    scope: 'edit',
    risk: 'medium',
    policy: 'safe_auto',
    description:
      'Ask the internal edit agent for a structured edit plan from the current timeline and objective.',
    inputs: [
      {
        key: 'objective',
        type: 'string',
        required: true,
        description: 'Editing goal or optimization target.',
      },
    ],
    expectedOutcome: 'A previewable edit plan is available for review.',
  },
  {
    id: 'apply_edit_plan',
    title: 'Apply Edit Plan',
    scope: 'edit',
    risk: 'high',
    policy: 'approval_required',
    description:
      'Apply selected edit-plan operations to the live timeline as one grouped change.',
    requiresHumanReview: true,
    inputs: [
      {
        key: 'operationIds',
        type: 'string[]',
        required: true,
        description: 'One or more planned operation identifiers to apply.',
      },
    ],
    expectedOutcome: 'The selected operations are applied and can be undone as a batch.',
  },
  {
    id: 'run_edit_review',
    title: 'Run Edit Review',
    scope: 'review',
    risk: 'medium',
    policy: 'safe_auto',
    description:
      'Render a draft review pass and ask the edit agent to refine pacing and continuity.',
    inputs: [
      {
        key: 'objective',
        type: 'string',
        required: true,
        description: 'What the review pass should optimize.',
      },
    ],
    expectedOutcome: 'Review findings and a follow-up edit plan are available.',
  },
  {
    id: 'run_director_pass',
    title: 'Run Director Pass',
    scope: 'project',
    risk: 'medium',
    policy: 'safe_auto',
    description:
      'Analyze the script in Director mode and produce a shot treatment.',
    inputs: [],
    expectedOutcome: 'A director treatment exists and can be applied to storyboard.',
  },
  {
    id: 'apply_director_treatment',
    title: 'Apply Director Treatment',
    scope: 'project',
    risk: 'high',
    policy: 'approval_required',
    description:
      'Replace the current storyboard shots with the latest director treatment.',
    requiresHumanReview: true,
    inputs: [],
    expectedOutcome: 'Storyboard shots are refreshed from the director treatment.',
  },
  {
    id: 'generate_project_concepts',
    title: 'Generate Project Concepts',
    scope: 'project',
    risk: 'high',
    policy: 'safe_auto',
    description:
      'Create or refresh concept references from the script, then generate concept images for them.',
    inputs: [
      {
        key: 'limit',
        type: 'number',
        required: false,
        description: 'Optional maximum number of concept references to generate in this run.',
      },
    ],
    expectedOutcome: 'Concept references exist and the concept phase has fresh generated images.',
  },
  {
    id: 'generate_shot_image',
    title: 'Generate Shot Image',
    scope: 'storyboard',
    risk: 'medium',
    policy: 'approval_required',
    description:
      'Generate or regenerate a storyboard image for one shot using the current model and references.',
    inputs: [
      {
        key: 'shotNumber',
        type: 'number',
        required: true,
        description: 'Storyboard shot number.',
      },
    ],
    expectedOutcome: 'The shot has a fresh image result or a new image version.',
  },
  {
    id: 'generate_storyboard_images',
    title: 'Generate Storyboard Images',
    scope: 'storyboard',
    risk: 'high',
    policy: 'approval_required',
    description:
      'Batch-generate storyboard frames for pending shots in the current project.',
    requiresHumanReview: true,
    inputs: [
      {
        key: 'limit',
        type: 'number',
        required: false,
        description: 'Optional maximum number of storyboard shots to render in this run.',
      },
    ],
    expectedOutcome: 'Pending storyboard shots receive newly generated image frames.',
  },
  {
    id: 'generate_shot_video',
    title: 'Generate Shot Video',
    scope: 'storyboard',
    risk: 'high',
    policy: 'approval_required',
    description:
      'Film one storyboard shot into a video clip with the active video model.',
    requiresHumanReview: true,
    inputs: [
      {
        key: 'shotNumber',
        type: 'number',
        required: true,
        description: 'Storyboard shot number.',
      },
    ],
    expectedOutcome: 'The shot has a generated video or a new video version.',
  },
  {
    id: 'generate_storyboard_videos',
    title: 'Generate Storyboard Videos',
    scope: 'storyboard',
    risk: 'high',
    policy: 'approval_required',
    description:
      'Batch-film storyboard shots into video clips using the active filming model.',
    requiresHumanReview: true,
    inputs: [
      {
        key: 'limit',
        type: 'number',
        required: false,
        description: 'Optional maximum number of shots to film in this run.',
      },
    ],
    expectedOutcome: 'Ready storyboard shots receive generated video clips.',
  },
  {
    id: 'export_storyboard_pdf',
    title: 'Export Storyboard PDF',
    scope: 'export',
    risk: 'medium',
    policy: 'approval_required',
    description: 'Export the current storyboard to PDF from the desktop app.',
    inputs: [],
    expectedOutcome: 'A storyboard PDF is saved to disk.',
  },
  {
    id: 'export_timeline_video',
    title: 'Export Timeline Video',
    scope: 'export',
    risk: 'high',
    policy: 'approval_required',
    description:
      'Run the project export flow for the current edit in the desktop app.',
    requiresHumanReview: true,
    inputs: [],
    expectedOutcome: 'A rendered timeline export is saved to the project exports folder.',
  },
  {
    id: 'research_web',
    title: 'Research The Web',
    scope: 'research',
    risk: 'low',
    policy: 'safe_auto',
    description:
      'Use Brave Search in read-only mode to gather current references, citations, and visual inspiration.',
    inputs: [
      {
        key: 'query',
        type: 'string',
        required: true,
        description: 'Research query for web, news, or image search.',
      },
      {
        key: 'kind',
        type: 'string',
        required: false,
        description: 'Optional result kind: web, news, or image.',
      },
    ],
    expectedOutcome: 'Normalized research hits are available with source attribution.',
  },
  {
    id: 'analyze_image_asset',
    title: 'Analyze Image Asset',
    scope: 'look',
    risk: 'low',
    policy: 'safe_auto',
    description:
      'Critique one image for composition, lighting, continuity, and production readiness.',
    inputs: [
      {
        key: 'imageUrl',
        type: 'string',
        required: true,
        description: 'Image asset URL or data URL.',
      },
      {
        key: 'objective',
        type: 'string',
        required: false,
        description: 'Optional analysis focus or critique objective.',
      },
    ],
    expectedOutcome: 'A structured critique or look analysis is available.',
  },
  {
    id: 'edit_image_asset',
    title: 'Edit Image Asset',
    scope: 'look',
    risk: 'medium',
    policy: 'approval_required',
    description:
      'Run a controlled image-edit pass with prompt and optional reference guidance.',
    requiresHumanReview: true,
    inputs: [
      {
        key: 'imageUrl',
        type: 'string',
        required: true,
        description: 'Image asset URL or data URL.',
      },
      {
        key: 'prompt',
        type: 'string',
        required: true,
        description: 'Desired edit instruction.',
      },
      {
        key: 'referenceImageUrl',
        type: 'string',
        required: false,
        description: 'Optional style or content reference image.',
      },
    ],
    expectedOutcome: 'A new edited image version is generated.',
  },
  {
    id: 'relight_image_asset',
    title: 'Relight Image Asset',
    scope: 'look',
    risk: 'medium',
    policy: 'approval_required',
    description:
      'Apply a relight pass to an existing image while preserving identity and framing.',
    requiresHumanReview: true,
    inputs: [
      {
        key: 'imageUrl',
        type: 'string',
        required: true,
        description: 'Image asset URL or data URL.',
      },
      {
        key: 'prompt',
        type: 'string',
        required: true,
        description: 'Relight direction or mood instruction.',
      },
    ],
    expectedOutcome: 'A relit version of the source image is generated.',
  },
];

export const getStudioAgentCapability = (
  capabilityId: StudioAgentCapabilityId,
) => STUDIO_AGENT_CAPABILITIES.find((entry) => entry.id === capabilityId) || null;

export const buildStudioAgentSystemPrompt = (
  snapshot: StudioAgentSnapshot,
) => {
  const collabSummary = snapshot.collaboration
    ? `${snapshot.collaboration.collaboratorCount} collaborators`
      + `${typeof snapshot.collaboration.activePresenceCount === 'number'
        ? `, ${snapshot.collaboration.activePresenceCount} active now`
        : ''}`
      + `${snapshot.collaboration.syncProvider
        ? `, sync via ${snapshot.collaboration.syncProvider}`
        : ''}`
    : 'No collaboration context';

  const generationSummary = snapshot.generation
    ? `image model: ${snapshot.generation.imageModel || 'n/a'}, video model: ${snapshot.generation.videoModel || 'n/a'}`
    : 'No generation model context';
  const creativeDnaSummary = snapshot.creativeDNA
    ? summarizeCreativeDNA(snapshot.creativeDNA)
    : 'No Creative DNA set';

  const capabilityLines = STUDIO_AGENT_CAPABILITIES.map(
    (capability) =>
      `- ${capability.id}: ${capability.description} Policy: ${capability.policy || (capability.requiresHumanReview ? 'approval_required' : 'safe_auto')}. Expected outcome: ${capability.expectedOutcome}`,
  ).join('\n');

  return [
    'You are the Studio Agent inside AI Video Production Editor.',
    'Use a strict observe -> plan -> act -> verify loop.',
    'Prefer internal capabilities over brittle UI clicking.',
    'Before every high-risk action, confirm that the state still matches the plan.',
    'If verification fails, stop, report the mismatch, and propose the next corrective action.',
    'Treat approval_required actions as blocked until a human approves them.',
    '',
    `Project: ${snapshot.projectName || 'Untitled project'}`,
    `Workspace: ${snapshot.activeWorkspace || 'unknown'}`,
    `Project phase: ${snapshot.activeProjectPhase || 'unknown'}`,
    `Timeline clips: ${snapshot.timelineClipCount}`,
    `Storyboard shots: ${snapshot.storyboardShotCount || 0}`,
    `Collaboration: ${collabSummary}`,
    `Generation: ${generationSummary}`,
    `Creative DNA: ${creativeDnaSummary}`,
    snapshot.creativeDNA ? buildCreativeDNAGuidance(snapshot.creativeDNA) : '',
    '',
    'Available capabilities:',
    capabilityLines,
  ].join('\n');
};

export const summarizeStudioAgentSnapshot = (snapshot: StudioAgentSnapshot) => {
  const parts = [
    snapshot.projectName || 'Untitled project',
    snapshot.activeWorkspace ? `workspace ${snapshot.activeWorkspace}` : null,
    snapshot.activeProjectPhase ? `phase ${snapshot.activeProjectPhase}` : null,
    `${snapshot.timelineClipCount} timeline clips`,
    typeof snapshot.storyboardShotCount === 'number'
      ? `${snapshot.storyboardShotCount} storyboard shots`
      : null,
    snapshot.creativeDNA ? snapshot.creativeDNA.directorMode : null,
    snapshot.collaboration
      ? `${snapshot.collaboration.collaboratorCount} collaborators`
      : null,
  ].filter(Boolean);
  return parts.join(' | ');
};
