export type DocsChunk = {
  id: string;
  title: string;
  section: string;
  tags: string[];
  content: string;
};

export const DOCS_KNOWLEDGE_BASE: DocsChunk[] = [
  {
    id: 'getting-started-phase-map',
    title: 'Project Workspace Phase Map',
    section: 'Setup',
    tags: ['phases', 'workflow', 'project workspace', 'library', 'script', 'director', 'concept', 'storyboard', 'filming', 'review', 'marketing'],
    content:
      'The main production flow is: Library -> Script -> Director -> Concept -> Storyboard -> Filming -> Review -> Marketing. For most projects, complete each phase in order and move to the next phase button only after validating outputs in the current phase.',
  },
  {
    id: 'setup-api-keys',
    title: 'API Keys and Generation Access',
    section: 'Setup',
    tags: ['api key', 'settings', 'generation', 'providers', 'troubleshooting'],
    content:
      'If image or video generation buttons do not run, open Settings and verify your provider API keys first. In the UI, missing key states appear as helper notices such as "Add API keys in Settings" or "Connect your API keys to generate video."',
  },
  {
    id: 'setup-first-project-routine',
    title: 'First Project Routine',
    section: 'Setup',
    tags: ['onboarding', 'new project', 'first steps', 'checklist'],
    content:
      'Recommended first session: fill Story Bible basics (title + logline), prepare script text, run Analyze Script to extract references, generate concept images, then build storyboard shots and only then start filming videos.',
  },
  {
    id: 'ui-guide-script-to-render',
    title: 'UI Guide: Script to Filming to Render',
    section: 'Setup',
    tags: ['ui guide', 'screenshots', 'script to filming', 'render', 'export', 'gpt image', 'nano banana', 'seedance', 'kling', 'happy horse', 'image generation', 'workflow'],
    content:
      'For an end-to-end project, use the studio in this order: 1) Project Hub to create/open the project and confirm provider keys. 2) Script phase to write or import the script and analyze it for characters, environments, props, and shot opportunities. 3) Concept, Moodboard, and Image Gen to lock references and run genre/look passes with models such as GPT Image, Nano Banana, Seedream, Qwen, Flux, or Imagen. 4) Storyboard to create approved start frames and shot prompts. 5) Video Gen or Filming to render motion clips; choose Seedance 2.0 for FAL image/reference-to-video control, Kling 3.0 / v3 Pro for high-quality FAL T2V/I2V shots with advanced controls, Happy Horse 1.0 Text-to-Video for prompt-only FAL generation, or Happy Horse 1.0 Image-to-Video when a storyboard frame should anchor the first frame. 6) Edit to assemble, trim, add sound and titles. 7) Review/Requests to mark fixes. 8) Export to choose platform preset, codec, bitrate, filename, and render.',
  },
  {
    id: 'script-phase-editor-and-ai-writer',
    title: 'Script Phase: Editor and AI Writer',
    section: 'Project Workspace',
    tags: ['script', 'editor', 'ai writer', 'import script', 'generate script', 'mckee mode'],
    content:
      'In Script phase use Editor for manual writing and AI Writer for prompt-based drafting with selectable length (Teaser, Commercial, Trailer, Short, Feature). You can also import .pdf or .txt scripts, then refine selected lines via Rewrite.',
  },
  {
    id: 'script-phase-analysis-tools',
    title: 'Script Phase: Analysis Tools',
    section: 'Project Workspace',
    tags: ['analyze script', 'script doctor', 'whats next', 'plot suggestions', 'quality score'],
    content:
      'Use Analyze Script to extract characters, locations, and props for Concept phase. Use Script Doctor for quality diagnostics (pacing, consistency, plot holes) and apply improvements from the report when needed.',
  },
  {
    id: 'project-collaboration-tools',
    title: 'Project Collaboration and Chat',
    section: 'Project Workspace',
    tags: ['collaboration', 'chat', 'mentions', 'attachments', 'meeting links', 'storage links'],
    content:
      'Project phase includes collaborator roles, meeting links, storage links, and project/shot chat threads. Team members can mention people with @, attach files, and keep shot-specific discussion inside each shot thread.',
  },
  {
    id: 'project-sync-usage',
    title: 'Project Sync Basics',
    section: 'Project Workspace',
    tags: ['sync', 'dropbox', 'google drive', 'one drive', 'folder', 'lock'],
    content:
      'When sync is configured, choose the provider and root folder so project paths stay inside the sync root. The UI shows lock and incoming update status to avoid overwrite conflicts during team editing.',
  },
  {
    id: 'project-realtime-collaboration-direction',
    title: 'Realtime Collaboration Direction',
    section: 'Project Workspace',
    tags: ['realtime', 'presence', 'supabase', 'yjs', 'collaboration roadmap', 'multi-user'],
    content:
      'The next collaboration layer should separate live session sync from file backup. Use Supabase Realtime for presence, activity signals, and lightweight locks, then move shared edit state such as storyboard, timeline, and review notes to a CRDT layer like Yjs instead of relying on project.json polling alone.',
  },
  {
    id: 'studio-agent-action-layer',
    title: 'Studio Agent Action Layer',
    section: 'Automation',
    tags: ['agent', 'automation', 'internal actions', 'playwright', 'nut.js', 'verify loop'],
    content:
      'A reliable Studio Agent should call typed internal app actions before attempting blind UI clicking. Preferred order: internal capability API first, then DOM or Electron-level automation, and only then native mouse/keyboard fallback. Every agent run should follow observe, plan, act, verify using first-class app state.',
  },
  {
    id: 'director-phase-autodirect',
    title: 'Director Phase: Auto-Direct to Shot List',
    section: 'Project Workspace',
    tags: ['director', 'auto-direct scene', 'shot list', 'directors notes', 'create storyboard'],
    content:
      'In Director phase click Auto-Direct Scene to turn script intent into a shot list with mood, visual theme, pacing, and shot rationales. If the proposal is good, use Create Storyboard to push shots directly into the Storyboard phase.',
  },
  {
    id: 'concept-phase-core-flow',
    title: 'Concept Phase: Character, Environment, Prop Assets',
    section: 'Project Workspace',
    tags: ['concept', 'casting', 'character', 'environment', 'prop', 'reference image'],
    content:
      'Concept phase is where you lock visual identity before shot generation. For each reference card, use Auto-Prompt/Generate Details, regenerate visual references, upload your own assets, or import from library to keep continuity.',
  },
  {
    id: 'concept-character-sheet-workflow',
    title: 'Character Sheets, Outfits, and Angles',
    section: 'Project Workspace',
    tags: ['character sheet', 'outfits', 'angles', 'multi-angle', 'consistency'],
    content:
      'Open a character sheet to manage bio, look, wardrobe, angle presets, and versions. Generate outfit variations and character angles early so storyboard and filming can reuse stable references instead of drifting between shots.',
  },
  {
    id: 'storyboard-phase-basics',
    title: 'Storyboard Phase: Build and Refine Shots',
    section: 'Project Workspace',
    tags: ['storyboard', 'generate from script', 'generate all shots', 'shot prompt', 'camera', 'lens'],
    content:
      'In Storyboard phase, start with Generate from Script, then refine shot prompts, camera/lens presets, and persona filters. Use Generate All Shots for batch rendering and inspect each shot card before moving to Filming.',
  },
  {
    id: 'storyboard-extra-shots-and-context',
    title: 'Storyboard: Extra Shots and Context References',
    section: 'Project Workspace',
    tags: ['extra shot', 'context references', 'add reference', 'continuity'],
    content:
      'Use Add Extra Shot to insert missing beats between existing shots. Attach context references (name, purpose, tag, optional image) per shot to guide generation toward consistent wardrobe, lighting, props, and environments.',
  },
  {
    id: 'storyboard-voiceover-flow',
    title: 'Storyboard: Voiceover per Shot',
    section: 'Project Workspace',
    tags: ['voiceover', 'elevenlabs', 'voice character', 'voice changer', 'audio'],
    content:
      'Each shot supports voiceover text, voice assignment, and voice generation. If multiple cast matches appear, select the correct voice character manually; for Aurora filming, voiceover audio is required before clip generation.',
  },
  {
    id: 'storyboard-openpose-control',
    title: 'Storyboard: OpenPose for Composition Lock',
    section: 'Project Workspace',
    tags: ['openpose', 'pose map', 'composition', 'pose source', 'framing'],
    content:
      'Use OpenPose controls when character position must stay precise. Upload a pose source image, generate or upload a pose map, then run shot generation so framing and body posture stay closer to target composition.',
  },
  {
    id: 'filming-phase-overview',
    title: 'Filming Phase: Principal Photography',
    section: 'Project Workspace',
    tags: ['filming', 'principal photography', 'film all remaining', 're-film', 'video models'],
    content:
      'Filming phase turns storyboard frames into clips. Pick a video model, verify required inputs per shot, use Film Shot or Film All Remaining, and then re-film only weak shots instead of redoing everything.',
  },
  {
    id: 'filming-model-input-rules',
    title: 'Filming Input Rules by Model Type',
    section: 'Project Workspace',
    tags: ['start frame', 'end frame', 'motion reference', 'aurora', 'requirements'],
    content:
      'Text-only models can run without frames, while most image-to-video models need a start frame. Kling motion-control requires a motion reference video, and Creatify Aurora requires voiceover/audio before filming.',
  },
  {
    id: 'filming-shot-controls',
    title: 'Filming Shot Controls',
    section: 'Project Workspace',
    tags: ['motion prompt', 'camera movement preset', 'start frame', 'end frame', 'status'],
    content:
      'Per shot you can edit motion prompt, apply camera movement presets, replace start/end frames, and tune motion-control options. Status indicators show Ready to Film, Missing required inputs, Filming in progress, or Filming Complete.',
  },
  {
    id: 'review-phase-exports',
    title: 'Review Phase and Exports',
    section: 'Project Workspace',
    tags: ['review', 'analyze project', 'export timeline', 'xml premiere', 'xml resolve'],
    content:
      'Use Review phase to run AI quality checks and continuity feedback before delivery. Export options include timeline export plus XML for Premiere and Resolve when enough filmed shots are available.',
  },
  {
    id: 'marketing-phase-assets',
    title: 'Marketing Assets from Project Context',
    section: 'Project Workspace',
    tags: ['marketing', 'poster', 'thumbnail', 'promo', 'extra assets', 'campaign'],
    content:
      'Marketing phase generates posters, thumbnails, and promo creatives linked to your project context. Choose the marketing image model and output size, then generate assets that reuse story references and shot context.',
  },
  {
    id: 'image-workspace-tabs-overview',
    title: 'Image Workspace Tabs',
    section: 'Image Workspace',
    tags: ['image generation', 'generate tab', 'moodboard', 'relight', 'photoreal check', 'director mode'],
    content:
      'Image workspace has five tabs: Generate, Moodboard, Relight, Photoreal Check, and Director Mode. Use Generate for new images, Moodboard for style consistency, Relight for lighting changes, and Photoreal Check for realism diagnostics.',
  },
  {
    id: 'image-generate-core-controls',
    title: 'Image Generate: Core Controls',
    section: 'Image Workspace',
    tags: ['model', 'aspect ratio', 'image size', 'style', 'camera', 'lens', 'negative prompt'],
    content:
      'Generate tab lets you select model, aspect ratio, size, custom style, camera/lens presets, and negative prompt. Keep prompt intent clear and specific, then use Generate Image; review Final prompt preview to confirm composition before running.',
  },
  {
    id: 'image-references-and-moodboard',
    title: 'Image References and Moodboard Behavior',
    section: 'Image Workspace',
    tags: ['reference images', 'moodboard', 'limits', 'context references', 'consistency'],
    content:
      'Reference image support varies by model and has limits shown in the UI. If no context references are added, supported models can fall back to moodboard guidance; use this to keep style continuity across multiple shots.',
  },
  {
    id: 'image-character-tag-workflow',
    title: 'Image Character Tag Workflow',
    section: 'Image Workspace',
    tags: ['character tags', '@tag', 'character references', 'prompt assist'],
    content:
      'In Generate tab, character cards insert @tags into the prompt and can auto-add character references. Use this when you need the same person identity across scenes without manually rebuilding the character description every time.',
  },
  {
    id: 'image-director-mode-workflow',
    title: 'Image Director Mode (ViMax)',
    section: 'Image Workspace',
    tags: ['director mode', 'viMax', 'auto-direct scene', 'apply to generator', 'shot list'],
    content:
      'Director Mode in Image workspace analyzes a script/scene description and returns an AI shot list with camera and lighting hints. Use Apply to Generator on a shot to transfer that prompt setup into the Generate tab quickly.',
  },
  {
    id: 'image-moodboard-workflow',
    title: 'Moodboard Usage Pattern',
    section: 'Image Workspace',
    tags: ['moodboard', 'upload images', 'style references', 'clear', 'consistency'],
    content:
      'Use Moodboard for style references only, not for precise object matching. Keep 4-12 high-quality references with similar visual direction, remove off-style images, and regenerate outputs after moodboard cleanup.',
  },
  {
    id: 'image-relight-workflow',
    title: 'Relight Workflow',
    section: 'Image Workspace',
    tags: ['relight', 'light direction', 'intensity', 'softness', 'environment', 'source image'],
    content:
      'Relight works from an existing source image and changes lighting while preserving scene structure. Choose model, preset, direction, color, intensity, softness, and environment notes, then run Relight Image and compare against the source.',
  },
  {
    id: 'image-photoreal-check-workflow',
    title: 'Photoreal Check Workflow',
    section: 'Image Workspace',
    tags: ['photoreal check', 'realism', 'analysis', 'fixes', 'quality'],
    content:
      'Photoreal Check analyzes one image and returns realism feedback plus fix ideas. Use it before final exports to identify artifacts, then adjust prompt/negative prompt and regenerate with more concrete texture and lighting constraints.',
  },
  {
    id: 'image-history-and-reuse',
    title: 'Image History and Reuse',
    section: 'Image Workspace',
    tags: ['history', 'reuse settings', 'reuse prompt', 'copy prompt', 'latest results'],
    content:
      'Latest results and History allow one-click Reuse Settings/Reuse Prompt for fast iteration. This is the fastest way to branch versions while keeping model, aspect ratio, style choices, and prompt structure aligned.',
  },
  {
    id: 'image-to-video-handoff',
    title: 'Image to Video Handoff',
    section: 'Image Workspace',
    tags: ['animate in video gen', 'handoff', 'start frame', 'video generation'],
    content:
      'From image results you can use Animate in Video Gen to hand off visuals into video workflow. Prefer this path when a generated image already has the composition you want as a video start frame.',
  },
  {
    id: 'video-workspace-core-controls',
    title: 'Video Workspace: Core Controls',
    section: 'Video Workspace',
    tags: ['video generation', 'model', 'aspect ratio', 'prompt', 'generate video'],
    content:
      'Video workspace centers on model selection, aspect ratio, prompt, and optional frame guides. Start simple with a short motion-oriented prompt, generate once, then iterate by changing one variable at a time.',
  },
  {
    id: 'video-model-requirements',
    title: 'Video Model Requirements and Flags',
    section: 'Video Workspace',
    tags: ['requires image', 'supports image', 'motion reference', 'audio track', 'model limits'],
    content:
      'Each model has different requirements: some require start images, some accept optional frames, and some ignore frame guides entirely. Aurora needs audio; motion-control modes require both a start image and motion reference video.',
  },
  {
    id: 'video-frame-guides',
    title: 'Start Frame and End Frame Usage',
    section: 'Video Workspace',
    tags: ['start frame', 'end frame', 'composition', 'transition', 'frame guides'],
    content:
      'Use a start frame to lock composition and a supported end frame to guide where motion should land. If output drifts too much, tighten prompt language and replace the start frame with a cleaner reference image.',
  },
  {
    id: 'video-motion-control',
    title: 'Motion Control Workflow',
    section: 'Video Workspace',
    tags: ['motion control', 'reference video', 'kling motion', 'orientation', 'mode'],
    content:
      'For motion-control generation, upload a motion reference clip and tune mode/orientation options. This is best when you need movement style transfer from a reference performance rather than random camera motion.',
  },
  {
    id: 'video-veo-elements',
    title: 'Veo Elements Prompting',
    section: 'Video Workspace',
    tags: ['veo elements', 'elements', 'veo 3.1', 'prompt augmentation'],
    content:
      'When using Veo 3.1 models, add Elements like "rain", "fog", or "neon signs" to enrich scene detail. Keep element count moderate and aligned with your prompt to avoid chaotic outputs.',
  },
  {
    id: 'video-library-reuse',
    title: 'Video Library Reuse Controls',
    section: 'Video Workspace',
    tags: ['library assets', 'use as start', 'use as end', 'use as motion ref', 'download'],
    content:
      'Library assets can be reused directly as Start Frame, End Frame, or Motion Reference from the side panel. This is useful for keeping shots visually connected across projects and avoiding repeated uploads.',
  },
  {
    id: 'video-status-debug',
    title: 'Video Status and Quick Debug',
    section: 'Video Workspace',
    tags: ['status', 'ready', 'missing input', 'generation failed', 'debug'],
    content:
      'If generation does not start, read status text first: it usually points to missing prompt, missing key, or missing required media. Fix the missing requirement shown in status, then rerun without changing unrelated settings.',
  },
  {
    id: 'import-workspace-basics',
    title: 'Import Workspace Basics',
    section: 'Import Workspace',
    tags: ['import media', 'media bin', 'upload', 'add to timeline', 'edit panel'],
    content:
      'Use Import Media to upload source video and image files into Media Bin, then add selected assets to timeline editing. If you are unsure where to start, import your core footage first before opening Edit workspace.',
  },
  {
    id: 'asset-library-cross-project',
    title: 'Asset Library Across Projects',
    section: 'Asset Library',
    tags: ['asset library', 'search', 'filter', 'shots', 'current project', 'recent projects', 'edit image', 'edit video'],
    content:
      'Asset Library lets you search and filter images, videos, audio, references, and shot assets from the current and recent projects. Use kind filters and search terms to find reusable assets quickly, then use Edit Image/Edit Video or download when needed.',
  },
  {
    id: 'edit-workspace-tab-usage',
    title: 'Edit Workspace Tabs and Layout',
    section: 'Edit Workspace',
    tags: ['edit workspace', 'lookbook', 'media', 'effects', 'transitions', 'music', 'auto cut', 'inspector'],
    content:
      'Edit workspace uses a three-panel layout: left library tabs, center preview/timeline, right inspector. Left tabs are Lookbook, Media, Effects, Transitions, Music, and Auto Cut; use these tabs to add sources, apply looks, cut faster, and refine clip-level settings.',
  },
  {
    id: 'edit-workspace-timeline-operations',
    title: 'Timeline Operations in Edit',
    section: 'Edit Workspace',
    tags: ['timeline', 'drag media', 'snapping', 'tracks', 'split', 'trim', 'shortcuts', 'preview ratio'],
    content:
      'In timeline, drag media to tracks, keep snapping enabled for clean alignment, and adjust clips from inspector controls. Useful shortcuts shown in UI are Space (play/pause), C (cut), T (trim), and Del (delete). You can also set preview canvas ratio/size before judging framing.',
  },
  {
    id: 'trim-workspace-controls',
    title: 'Trim Workspace Flow',
    section: 'Trim Workspace',
    tags: ['trim clip', 'new duration', 'source duration', 'apply and return', 'edit workspace'],
    content:
      'Trim workspace is for precise clip-length changes after selecting a clip in Edit. Check Source Duration, set New Duration, preview the clip, then use Apply and Return to push timing updates back into the timeline.',
  },
  {
    id: 'post-workspace-color-flow',
    title: 'Post Workspace: Color Grading',
    section: 'Post Workspace',
    tags: ['post production', 'color grading', 'look presets', 'film emulation', 'lut', 'ai colorist', 'match reference'],
    content:
      'Post workspace Color Grading tab combines manual controls with AI Colorist suggestions. Start from a Look Preset, fine-tune brightness/contrast/saturation/hue, apply film emulation or import a .cube LUT, and use Match Reference or prompt-based grading for target looks.',
  },
  {
    id: 'post-workspace-audio-cues',
    title: 'Post Workspace: Audio Analyzer and Cues',
    section: 'Post Workspace',
    tags: ['audio analyzer', 'analyze timeline', 'analyze upload', 'generate audio cues', 'music prompt', 'voiceover prompt', 'sfx'],
    content:
      'Use Audio Analyzer and Mix to generate timecoded cue suggestions from timeline or uploaded edit. The output includes music, voiceover, and SFX prompt ideas with reasoning so you can place and refine sound decisions faster.',
  },
  {
    id: 'sound-workspace-suite',
    title: 'Sound Workspace End-to-End',
    section: 'Sound Workspace',
    tags: ['sound design', 'generate voice', 'generate music', 'generate sfx', 'separate stems', 'library audio', 'latest audio'],
    content:
      'Sound Design workspace covers voiceover, music, SFX, and stem separation in one place. Use Generate Voice for narration, Generate Music/SFX for creative layers, Separate Stems for remix workflows, and track output quality in Latest Audio before final edit.',
  },
  {
    id: 'compositing-workspace-workflow',
    title: 'Compositing Workspace Workflow',
    section: 'Compositing Workspace',
    tags: ['video compositing', 'reframe tools', 'luma reframe', 'openpose extract', 'animate replace', 'layer composite', 'blend mode', 'opacity'],
    content:
      'Compositing workspace has four practical flows: OpenPose Extract for pose maps, Reframe Tools with Luma Ray 2 for alternate aspect ratios, Animate Replace for motion+character swaps, and Layer Composite for background/overlay blending. Use blend mode plus opacity controls to build quick composites before final polish.',
  },
  {
    id: 'analysis-workspace-modes',
    title: 'Analysis Workspace: Quick vs Deep',
    section: 'Analysis Workspace',
    tags: ['neurocinematics analysis', 'quick scan', 'deep analysis', 'focus time range', 'audio quick pass', 'target audience fit'],
    content:
      'Analysis workspace supports Quick Scan for fast direction and Deep Analysis for full-pass diagnostics. Optional Focus Time Range helps isolate a section, while Audio Quick Pass and Analyze Audience Fit add sound and audience-specific feedback on top of video review.',
  },
  {
    id: 'review-workspace-director-page',
    title: 'Review Workspace Director Flow',
    section: 'Review Workspace',
    tags: ['director page', 'concept review', 'storyboard review', 'video review', 'annotate', 'change requests', 'naming convention'],
    content:
      'Review workspace is the director control layer: score concept quality, review each shot, review generated videos, annotate frames, and define change requests. Use the naming convention template preview to enforce consistent delivery naming for artists.',
  },
  {
    id: 'requests-workspace-tracking',
    title: 'Requests Workspace Tracking',
    section: 'Requests Workspace',
    tags: ['artist requests', 'shot tasks', 'status', 'open', 'in progress', 'done', 'export json', 'export pdf'],
    content:
      'Requests workspace turns review change requests into trackable shot tasks with status updates. Use it to monitor open/in-progress/done work and export request packages as JSON or PDF for external review or handoff.',
  },
  {
    id: 'export-workspace-render-flow',
    title: 'Export Workspace Render Flow',
    section: 'Export Workspace',
    tags: ['export project', 'export preset', 'custom size', 'fps', 'bitrate', 'start render', 'download video'],
    content:
      'Export workspace is where timeline delivery is finalized. Pick an export preset (or custom width/height/fps/bitrate), set filename, run Start Render, then download the output after progress reaches completion.',
  },
  {
    id: 'avatar-workspace-production',
    title: 'Avatar Workspace Production',
    section: 'Avatar Workspace',
    tags: ['avatar library', 'create avatar', 'ai avatar studio', 'voiceover text', 'upload audio', 'model selection', 'generate'],
    content:
      'Avatar workspace has two steps: create/select an avatar in Avatar Library, then generate in AI Avatar Studio. Match model requirements (for example audio-driven vs motion-driven modes), add prompt/audio as needed, and generate output into Media Bin for editing.',
  },
  {
    id: 'upscale-workspace-operations',
    title: 'Upscale Workspace Operations',
    section: 'Upscale Workspace',
    tags: ['upscale', 'model', 'run upscaler', 'latest results', 'library assets', 'use as input'],
    content:
      'Upscale workspace improves image or video quality using selectable upscaler models. Choose model first, provide input from upload/URL/library, run upscaler, then validate results in Latest Results before swapping into your timeline.',
  },
  {
    id: 'photo-workspace-editor-flow',
    title: 'Photo Workspace Editing Flow',
    section: 'Photo Workspace',
    tags: ['photo studio', 'brush', 'lasso', 'clone', 'text layers', 'inpaint', 'heal selection', 'expand fill', 'save to media bin'],
    content:
      'Photo Studio supports layered image editing with Brush/Lasso/Clone/Text tools, mask-based inpaint/heal, canvas expansion, crop, and adjustments. After finishing edits, use Save to Media Bin so the new still can be reused in Image, Video, or Edit workflows.',
  },
  {
    id: 'set-design-workspace-core',
    title: 'Set Design Workspace Core Flow',
    section: 'Set Design Workspace',
    tags: ['set design', 'ai director', 'import assets', 'rodin', 'world labs', 'storyboard camera', 'capture snapshot', 'lights', 'scene assets'],
    content:
      'Set Design is your 3D staging workspace: import assets, add primitives, position/rotate/scale scene objects, tune lights, and align camera with storyboard shots. Use Capture Snapshot to create visual references and AI Director for quick scene-change instructions.',
  },
  {
    id: 'world-generation-workspace-management',
    title: 'World Generation Workspace Management',
    section: 'World Generation Workspace',
    tags: ['world generation', 'text image video mode', 'world history', 'selected world', 'save assets', 'add mesh to set design', 'viewer'],
    content:
      'World Generation creates 3D worlds from text/image/video mode and keeps them in World History for recall. From Selected World, open viewer, save assets (mesh/panorama/thumbnail), and send mesh directly to Set Design for scene building.',
  },
  {
    id: 'scene-map-workspace-planning',
    title: 'Scene Map Workspace Planning',
    section: 'Scene Map Workspace',
    tags: ['scene map', 'new scene', 'elements', 'drag and drop', 'properties', 'linked shots', 'grid', 'snap', 'zoom'],
    content:
      'Scene Map is a visual planning board: create scene tabs, drag elements onto canvas, and edit position/size/rotation/color in Properties. Link map elements to shot numbers so spatial planning and shot execution stay synchronized.',
  },
  {
    id: 'node-workspace-pipeline-builder',
    title: 'Node Workspace Pipeline Builder',
    section: 'Node Workspace',
    tags: ['node graph', 'pipeline', 'run', 'node palette', 'validation', 'library assets', 'image in', 'latest output'],
    content:
      'Node Graph workspace is for modular pipelines. Drag nodes from palette, connect outputs to inputs, resolve validation warnings, then run valid pipelines. To feed project assets, select an Image In node and attach library media from the side panel.',
  },
  {
    id: 'moodboard-workspace-organization',
    title: 'Moodboard Workspace Organization',
    section: 'Moodboard Workspace',
    tags: ['moodboard', 'categories', 'upload images', 'move to category', 'delete selected', 'drag and drop'],
    content:
      'Moodboard workspace keeps references organized by category. Upload images, create custom categories, move selected items in bulk, and remove off-style references quickly so downstream generation keeps a consistent visual direction.',
  },
  {
    id: 'notebook-workspace-research-chat',
    title: 'Notebook Workspace Research Chat',
    section: 'NotebookLM Workspace',
    tags: ['notebooklm research', 'connect to notebooklm', 'select notebook', 'ask question', 'resource preview', 'mcp resources', 'mcp tools'],
    content:
      'NotebookLM workspace supports research-style Q&A over selected notebooks. Connect first, pick notebook, ask questions in chat, and use resource/tool panels to inspect context and verify what source material is available for answers.',
  },
  {
    id: 'script-workspace-routing-note',
    title: 'Script Workspace Routing Note',
    section: 'Script Workspace',
    tags: ['script workspace', 'project tab', 'integrated workflow'],
    content:
      'Script Workspace currently routes users to the Project tab for full script and production flow. For active writing, analysis, and phase transitions, use Script phase inside Project workspace.',
  },
  {
    id: 'cross-workspace-handoff',
    title: 'Cross-Workspace Handoff Patterns',
    section: 'Best Practice',
    tags: ['handoff', 'workspace transitions', 'import to edit', 'review to requests', 'image to video', 'world to set design'],
    content:
      'Recommended handoffs: Import -> Edit for timeline assembly, Image -> Video for start-frame animation, Review -> Requests for tracked fixes, and World Generation -> Set Design for 3D staging. Use these handoffs to keep work structured and reduce rework.',
  },
  {
    id: 'troubleshooting-missing-inputs',
    title: 'Troubleshooting Missing Inputs',
    section: 'Troubleshooting',
    tags: ['missing required inputs', 'start frame', 'audio', 'motion reference', 'requirements'],
    content:
      'When UI shows "Missing required inputs," check model-specific requirements before anything else. Typical fixes are adding start frame, adding motion reference video, or generating/attaching shot voiceover for audio-required models.',
  },
  {
    id: 'troubleshooting-quality-drift',
    title: 'Troubleshooting Quality Drift',
    section: 'Troubleshooting',
    tags: ['quality drift', 'consistency', 'character drift', 'style drift', 'continuity'],
    content:
      'To reduce drift, lock references early (characters, environments, props), reuse prior prompts/settings, and keep persona/camera/lens consistent across connected shots. Avoid switching models mid-sequence unless testing alternates.',
  },
  {
    id: 'troubleshooting-speed-cost',
    title: 'Speed and Cost Optimization',
    section: 'Troubleshooting',
    tags: ['speed', 'cost', 'faster models', 'draft quality', 'final quality'],
    content:
      'Use faster models and smaller output sizes for draft iterations, then switch to higher-quality settings only for approved shots. This keeps turnaround high while controlling generation cost and rerender time.',
  },
  {
    id: 'best-practice-end-to-end',
    title: 'Best Practice End-to-End Pipeline',
    section: 'Best Practice',
    tags: ['best practice', 'pipeline', 'end-to-end', 'production process'],
    content:
      'Best overall flow: define script intent, extract concept references, lock visual identity, generate storyboard images, film only ready shots, run review analysis, then export timeline and produce marketing variants from approved material.',
  },
  {
    id: 'providers-and-api-keys-map',
    title: 'Provider and API Key Map',
    section: 'Setup',
    tags: ['api keys', 'providers', 'gemini', 'replicate', 'fal', 'ltx', 'gpt image', 'nano banana', 'seedance', 'happy horse', 'xai', 'world labs', 'sketchfab', 'comfyui'],
    content:
      'Provider setup in Settings should map to workspace actions: Gemini key for Gemini 2.5 Flash, Nano Banana, Gemini 2.5 Pro, Gemini 3 Pro Image Preview, Imagen 4, and Veo 3.1 generation; Replicate key for Flux, Seedream, Qwen, Z-Image, GPT Image 1.5, Wan, Kling 2.6, LTX 2 Fast, and resolution upscalers; LTX key for Upscale > Color Science Upscale (SDR video to ACES HDR EXR frames); FAL key for GPT Image 2 routes, Nano Banana 2 routes, Seedance 2.0, Kling 3.0 / v3 Pro, Happy Horse 1.0, Kling O3, Qwen multi-angle, Grok image-to-video, and Creatify Aurora; xAI key for Grok image and Grok video; World Labs key for Marble world generation; Sketchfab token for 3D model download URLs; ComfyUI local URL for local image generation. If one model fails, verify that specific provider key first.',
  },
  {
    id: 'image-model-catalog-customer',
    title: 'Image Model Catalog for Customers',
    section: 'Image Workspace',
    tags: ['image models', 'gemini', 'imagen', 'grok image', 'flux', 'seedream', 'qwen', 'gpt image', 'z-image', 'nano banana', 'comfyui'],
    content:
      'Integrated image model families include: Gemini 2.5 Flash Image and Nano Banana (fast ideation), Nano Banana 2 via FAL for fast photoreal generation/editing, Gemini 3 Pro Image Preview (higher prompt adherence), Imagen 4 (high fidelity rendering), GPT Image 2 via FAL for high-end text rendering and prompt adherence, GPT Image 1.5, Grok 2 Image, Runway Gen-4 Image Turbo, Flux 1.1 Pro, Flux Schnell, Flux 2 Pro, Flux 2 Klein 9B Base, Flux 2 Turbo, Flux Fill (edit/inpaint), Z-Image, Z-Image Turbo, Z-Image Turbo Img2Img, Z-Image Turbo Inpaint, Seedream 4.5, Qwen Image 2512, Qwen Image Edit 2511, Qwen multi-angle edit, plus ComfyUI local pipelines. For customers, recommend: use Nano Banana or fast Flux/Z-Image for drafts, GPT Image/Gemini/Imagen/Seedream/Flux Pro for finals, and edit-specific models for controlled revisions.',
  },
  {
    id: 'video-model-catalog-customer',
    title: 'Video Model Catalog and Input Rules',
    section: 'Video Workspace',
    tags: ['video models', 'veo', 'kling', 'wan', 'seedance', 'happy horse', 'grok imagine', 'ltx', 'aurora', 'requirements'],
    content:
      'Integrated video model families include: Veo 3.1 Fast, Veo 3.1 High Quality, Seedance 1.5 Pro, Seedance 2.0 image-to-video (FAL), Seedance 2.0 reference/omni-to-video (FAL), Kling 3.0 / v3 Pro image-to-video and text-to-video (FAL), Happy Horse 1.0 text-to-video and image-to-video (FAL), Grok Imagine Video (text), Grok Imagine Video image-to-video (FAL), Wan 2.2 I2V Fast, Wan 2.2 Animate Replace, Kling 2.6, Kling 2.5 Turbo Pro, Kling 2.6 Motion Control, Kling O3 Pro image-to-video (FAL), Creatify Aurora (FAL), LTX 2 Fast, and OmniHuman avatar video. Input rules customers should follow: text-to-video can run without frames, image-to-video needs a start image, reference-to-video needs references, motion-control needs both a start image and motion reference video, Aurora requires voiceover audio, and some models optionally support end frame guidance.',
  },
  {
    id: 'video-model-happy-horse-fal',
    title: 'Happy Horse 1.0 on FAL',
    section: 'Video Workspace',
    tags: ['happy horse', 'happyhorse', 'fal', 'text to video', 'image to video', 'native audio', '1080p'],
    content:
      'Happy Horse 1.0 is available in Video Workspace through FAL as Text-to-Video and Image-to-Video. Text-to-Video uses prompt, aspect ratio, resolution, duration, seed, and safety checker. Supported aspect ratios are 16:9, 9:16, 1:1, 4:3, and 3:4; supported resolution tiers are 720p and 1080p; supported durations are 3 to 15 seconds. Image-to-Video uses an uploaded start frame as the first frame and can add a guiding prompt. Recommend Happy Horse when users want native audio-video generation from one model; remind them that Image-to-Video needs a clean start image of at least 300px with a practical aspect ratio.',
  },
  {
    id: 'model-routing-gpt-nano-seedance-happy-horse',
    title: 'Launch Model Routing: GPT Image, Nano Banana, Seedance 2.0, Kling 3.0, Happy Horse',
    section: 'Best Practice',
    tags: ['model routing', 'gpt image', 'nano banana', 'seedance 2.0', 'kling 3.0', 'kling v3', 'happy horse', 'fal', 'workflow'],
    content:
      'Use the launch model set as a practical workflow, not as one replacement model: GPT Image is best for polished prompt-adherent stills, text-aware visuals, and high-quality reference frames; Nano Banana is best for fast ideation, photoreal draft frames, contextual edits, and quick reference variations; Seedance 2.0 on FAL is best when the user has a storyboard/start frame or several references and wants controlled image-to-video or reference-to-video motion; Kling 3.0 / v3 Pro on FAL is best for high-quality text-to-video or image-to-video shots with advanced prompt, audio, element, and end-frame controls; Happy Horse 1.0 on FAL is best when the user wants native audio-video generation from text or from one anchored start image. Recommended flow: draft the look with Nano Banana, refine hero stills with GPT Image, approve storyboard frames, generate controlled motion with Seedance 2.0 or Kling 3.0 / v3 Pro, and use Happy Horse for prompt-only or audio-video passes where that model is a better fit.',
  },
  {
    id: 'advanced-model-catalog-edit-audio-3d',
    title: 'Advanced Model Catalog for Edit, Audio, and 3D',
    section: 'Cross Workspace',
    tags: ['upscale', 'post', 'audio', '3d', 'controlnet', 'openpose', 'demucs', 'rodin', 'world builder', 'sketchfab'],
    content:
      'Additional integrated model/tool stack used across workspaces includes: OpenPose, ControlNet base, ControlNet Scribble, ControlNet Normal, DPT depth, MiDaS depth, Real-ESRGAN, Crystal Upscaler, Clarity Upscaler, Crystal Video Upscaler, Topaz Image Upscale, Topaz Video Upscale, RIFE frame interpolation, GFPGAN, RestoreFormer, rembg background removal, Demucs stem separation, Minimax Speech 02 HD, Google Lyria 2, Rodin image-to-3D, World Labs Marble 0.1-mini, World Labs Marble 0.1-plus, and Sketchfab searchable downloadable models with GLB/GLTF download resolution. Customer guidance: use these as problem-solvers for quality fixes, stems, asset prep, and world/set creation after core shot generation.',
  },
  {
    id: 'workspace-model-selection-cheat-sheet',
    title: 'Model Selection Cheat Sheet by Outcome',
    section: 'Best Practice',
    tags: ['model selection', 'which model', 'customer guidance', 'quality', 'speed', 'cost'],
    content:
      'Quick model selection for customers: 1) Need fastest draft images -> Nano Banana, Gemini 2.5 Flash Image, Flux Schnell, or Z-Image Turbo. 2) Need premium still quality or text-aware images -> GPT Image 2, Imagen 4, Gemini 3 Pro Image, Flux 1.1 Pro, Seedream 4.5. 3) Need prompt-based edit with reference image -> GPT Image 2 Edit, Nano Banana 2 Edit, Qwen edit models, Flux Fill, GPT Image 1.5, or Z-Image Img2Img. 4) Need cinematic video from text -> Veo 3.1, Kling 3.0 / v3 Pro text-to-video, or Happy Horse 1.0 Text-to-Video. 5) Need controlled movement from a specific frame -> Seedance 2.0 I2V, Kling 3.0 / v3 Pro I2V, Happy Horse I2V, Wan I2V, Kling image-to-video, or Grok Imagine I2V. 6) Need multiple references or an optional video reference -> Seedance 2.0 Omni/reference-to-video or Kling O3 reference mode. 7) Need motion style transfer -> Kling Motion Control with motion reference clip. 8) Need avatar or talking figure -> OmniHuman or Aurora flow with audio. 9) Need 3D world/set ideation -> World Labs Marble + Set Design + Sketchfab asset import.',
  },
  {
    id: 'support-playbook-top-questions',
    title: 'Support Playbook: 10 Customer Questions and Answer Patterns',
    section: 'Support Playbook',
    tags: ['support playbook', 'faq', 'customer questions', 'answer templates', 'troubleshooting'],
    content:
      'Support answer patterns for common questions: Q1 "How do I start a project?" -> Use phases in order: Script, Director, Concept, Storyboard, Filming, Review, Marketing. Q2 "Why can I not generate?" -> Check provider key in Settings, then check required model inputs in status panel. Q3 "How do I keep the same character?" -> Reuse character sheets, reference cards, and prior prompts with stable tags. Q4 "Which model should I pick?" -> Ask for priority (speed vs quality vs edit control) and map to model cheat sheet. Q5 "Filming says missing input" -> Verify start frame, motion reference, and voiceover requirement depending on selected model. Q6 "How do I fix quality drift?" -> Lock references, avoid model hopping mid-sequence, iterate one parameter at a time. Q7 "How do I move from review to fixes?" -> Create requests from review notes, track statuses in Requests workspace, then re-film only affected shots. Q8 "How do I export professionally?" -> Choose export preset first, then set fps, bitrate, naming, and render. Q9 "How do I use 3D assets?" -> Search/import Sketchfab, create worlds in World Generation, send meshes into Set Design. Q10 "How do I reduce cost?" -> Draft on fast models/resolutions, finalize only approved shots on premium models.',
  },
  {
    id: 'customer-support-answer-style',
    title: 'Support Style for Customer Answers',
    section: 'Best Practice',
    tags: ['support style', 'step by step', 'customer', 'ui guidance'],
    content:
      'Support answers should be concrete and action-first: mention exact phase/tab/button names, give numbered steps, and include quick fallback checks. Avoid technical implementation details and focus on what the customer can do in the product UI.',
  },
  {
    id: 'support-video-learning-path',
    title: 'Official Video Learning Path',
    section: 'Support Playbook',
    tags: ['youtube', 'tutorials', 'videos', 'walkthrough', 'onboarding', 'support'],
    content:
      'Official YouTube channel: https://www.youtube.com/@AIVideoProductionEditor. Use the videos as a support ladder: short overview "The Ai Video Production Editor" for first impression, full Mac walkthrough "AI Video Production Editor: The Future of Filmmaking on Mac" for API keys to export, "AI Video Production v1.5 Launch" for AI Director, Node Graph, Sound tab, and 3D set design, and "I Tested the New AI Editor v2.5" for the current release, Scene Wall, and newer workflow scale.',
  },
  {
    id: 'support-escalation-map',
    title: 'Support Escalation Map',
    section: 'Support Playbook',
    tags: ['support', 'github issues', 'security', 'bug report', 'feature request'],
    content:
      'Support routing: send tutorial and workflow questions to the docs page and YouTube channel first; send reproducible product bugs and provider API changes to GitHub Issues with steps, logs, model name, and provider; send credentials, local file exposure, billing, BYOK proxy, or hosted API vulnerabilities through the private security reporting path instead of public issues.',
  },
];

export const QUICK_QUESTIONS: string[] = [
  'How should I run a project from Script to Marketing step by step?',
  'Where is the UI screenshot guide for going from script to filming and render?',
  'Which official YouTube tutorial should I watch first?',
  'How do I use GPT Image, Nano Banana, Seedance 2.0, Kling 3.0, and Happy Horse together?',
  'Which model should I choose for speed, quality, or controlled edits?',
  'What are all image and video model options in this software and when should I use each?',
  'How do provider API keys map to Gemini, Replicate, FAL, xAI, World Labs, and Sketchfab features?',
  'How do I use Storyboard and Filming without missing required inputs?',
  'How do I keep character and style consistency across shots?',
  'How do I use Image Workspace tabs (Generate, Moodboard, Relight, Photoreal)?',
  'How do I create marketing assets from my finished project?',
  'How do I use Edit workspace tabs (Lookbook, Media, Effects, Transitions, Music, Auto Cut)?',
  'How do I do color grading and audio cue planning in Post workspace?',
  'How do I use Review and Requests together to track shot fixes?',
  'How do I use Sound workspace for voice, music, SFX, and stem separation?',
  'How do I export final video with the right preset and settings?',
  'How do I use Set Design, World Generation, and Scene Map together?',
  'How do I build and debug pipelines in Node Graph?',
];
