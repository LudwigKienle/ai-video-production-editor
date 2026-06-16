import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage } from '../types';
import { runChat, analyzeImage } from '../services/geminiService';
import { MagicWandIcon, UploadIcon } from './icons';
import { fileToBase64 } from '../utils/helpers';
import { FunctionDeclaration } from '@google/genai';

interface AIAssistantProps {
  apiKeyReady: boolean;
  tools: FunctionDeclaration[];
  toolExecutor: { [key: string]: Function };
  context?: string;
  onUserTurnStart?: (message: string) => void;
}

type AssistantMode = 'chat' | 'search' | 'maps' | 'thinking';
type AssistantAction = {
  id: string;
  label: string;
  tool?: string;
  args?: Record<string, any>;
  prompt?: string;
};
type WalkthroughStep = {
  id: string;
  title: string;
  description: string;
  action?: AssistantAction;
};

const STORAGE_KEYS = {
  coach: 'assistant_coach_enabled_v1',
  step: 'assistant_walkthrough_step_v1',
  tip: 'assistant_tip_index_v1',
  intro: 'assistant_intro_v1',
  messages: 'assistant_messages_v2',
  memory: 'assistant_behavior_memory_v1',
};

const API_SETUP_GUIDE = [
  'Gemini: https://aistudio.google.com/app/apikey',
  'Replicate: https://replicate.com/account/api-tokens',
  'FAL: https://fal.ai/dashboard/api-keys',
  'xAI: https://console.x.ai/',
  'ElevenLabs: https://elevenlabs.io/app/settings/api-keys',
  'World Labs: https://platform.worldlabs.ai/',
  'Sonauto: https://sonauto.ai/developers',
].join('\n');

const ASSISTANT_SYSTEM_INSTRUCTION = `You are the AI Studio Assistant for AI Video Production Editor.
You are available in every workspace and should act like a practical production copilot.
When the user asks for an action, execute available tools directly whenever possible.
Only use studioAgent tools when the user explicitly asks for the agent or says to run something via the agent.
When the user explicitly asks to control the app through the assistant via the agent, prefer the studioAgent tools for workspace, phase, clip, research, and image actions.
If a studioAgent tool reports that approval is required, tell the user clearly and wait.
If approval is pending and the user confirms, call approveStudioAgentAction.
Treat clear confirmations like "retry", "run it", "go ahead", "do it", or "use the agent" as approval for the currently pending studioAgent action. Do not force the user to repeat a specific magic phrase.
If approval is pending and the user cancels or says stop, call rejectStudioAgentAction.
Project Hub > Script is the script panel for the project.
For end-to-end production requests, prefer studioAgentRunProjectWorkflow first. If a run queue already exists and is incomplete, prefer studioAgentResumeTaskQueue instead of restarting the workflow.
If you are not using the bundled workflow tool, prefer this order when appropriate: studioAgentWriteProjectScript -> studioAgentImproveProjectScript -> studioAgentGenerateProjectConcepts -> studioAgentRunDirectorPass -> studioAgentApplyDirectorTreatment -> studioAgentGenerateStoryboardImages -> studioAgentGenerateStoryboardVideos.
If the user asks you to set up a whole project from one prompt, execute the full project workflow step by step instead of just describing it.
When the user asks for Moodboard internet research, use the researchMoodboardFrames tool.
When the user asks for API setup, call getApiSetupStatus first, then explain missing keys and offer openApiProviderWebsite.
Keep replies concise, concrete, and production-focused unless the user asks for details.`;

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'project',
    title: 'Create or open a project',
    description: 'Use Project Hub to set title, script, collaborators, and sync.',
    action: { id: 'open-project', label: 'Open Project Hub', tool: 'navigateWorkspace', args: { workspace: 'PROJECT' } },
  },
  {
    id: 'import',
    title: 'Import footage and audio',
    description: 'Bring assets into the project and keep them organized.',
    action: { id: 'open-import', label: 'Open Import', tool: 'navigateWorkspace', args: { workspace: 'IMPORT' } },
  },
  {
    id: 'image-gen',
    title: 'Generate look development',
    description: 'Use Image Gen and Moodboard to lock style before video generation.',
    action: { id: 'open-image-gen', label: 'Open Image Gen', tool: 'navigateWorkspace', args: { workspace: 'IMAGE_GEN' } },
  },
  {
    id: 'moodboard',
    title: 'Build moodboard references',
    description: 'Collect references, categorize them, and keep visual direction consistent.',
    action: { id: 'open-moodboard', label: 'Open Moodboard', tool: 'navigateWorkspace', args: { workspace: 'MOODBOARD' } },
  },
  {
    id: 'review',
    title: 'Review and iterate',
    description: 'Collect feedback, lock shots, and adjust decisions.',
    action: { id: 'open-review', label: 'Open Review', tool: 'navigateWorkspace', args: { workspace: 'REVIEW' } },
  },
];

const COACH_TIPS = [
  'Tip: Use Space to play/pause, C to cut, T to trim, Del to delete.',
  'Tip: Build moodboard references before batch-generating storyboard shots.',
  'Tip: Keep 4-12 references per category and remove off-style images.',
  'Tip: Use Moodboard research with a clear query like "cinematic dusk rain lighting".',
  'Tip: If generation drifts, tighten prompt + reference set before retrying.',
];

const QUICK_ACTIONS: AssistantAction[] = [
  { id: 'open-project', label: '🎬 My Project', tool: 'navigateWorkspace', args: { workspace: 'PROJECT' } },
  { id: 'open-image-gen', label: '🖼️ Make Image', tool: 'navigateWorkspace', args: { workspace: 'IMAGE_GEN' } },
  { id: 'open-video-gen', label: '🎥 Make Video', tool: 'navigateWorkspace', args: { workspace: 'VIDEO_GEN' } },
  { id: 'open-moodboard', label: '🗂️ Moodboard', tool: 'navigateWorkspace', args: { workspace: 'MOODBOARD' } },
  { id: 'open-settings', label: '⚙️ Settings', tool: 'openSettings' },
  { id: 'setup-check', label: '✅ Check Setup', tool: 'runSetupCheck' },
  { id: 'open-gemini-keys', label: '🔑 Get Gemini Key', tool: 'openApiProviderWebsite', args: { provider: 'gemini' } },
  { id: 'open-fal-keys', label: '🔑 FAL Key', tool: 'openApiProviderWebsite', args: { provider: 'fal' } },
  { id: 'open-replicate-keys', label: '🔑 Replicate Key', tool: 'openApiProviderWebsite', args: { provider: 'replicate' } },
  { id: 'open-sonauto-keys', label: '🔑 Sonauto Key', tool: 'openApiProviderWebsite', args: { provider: 'sonauto' } },
  { id: 'research-lighting', label: '🌅 Get Lighting Ideas', tool: 'researchMoodboardFrames', args: { query: 'cinematic lighting references', categoryId: 'lighting', maxResults: 8 } },
];

const QUICK_PROMPTS: AssistantAction[] = [
  { id: 'prompt-walkthrough', label: '🗺️ How do I start?', prompt: 'I\'m new here. Give me a simple step-by-step guide to make my first video.' },
  { id: 'prompt-next', label: '➡️ What\'s next?', prompt: 'Based on where I am, what is the best next step I should take?' },
  { id: 'prompt-moodboard', label: '💡 Give me inspiration', prompt: 'Give me 6 creative ideas and visual mood references for my project.' },
  { id: 'prompt-api', label: '🔑 Help me set up AI keys', prompt: 'Check my API setup status and guide me through connecting the tools I need.' },
  { id: 'prompt-assistant-memory', label: '🧠 Personalize the assistant', prompt: 'Ask me a few questions about my project style, then remember my preferences.' },
];

const buildMessage = (
  role: ChatMessage['role'],
  text: string,
  extras?: Partial<ChatMessage>
): ChatMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  role,
  text,
  createdAt: new Date().toISOString(),
  ...extras,
});

const getToolCallName = (toolCall: any): string | undefined => {
  if (!toolCall || typeof toolCall !== 'object') return undefined;
  if (toolCall.functionCall && typeof toolCall.functionCall === 'object') {
    return typeof toolCall.functionCall.name === 'string' ? toolCall.functionCall.name : undefined;
  }
  return typeof toolCall.name === 'string' ? toolCall.name : undefined;
};

const extractFunctionCallParts = (response: any): any[] => {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  return parts
    .filter((part: any) => part?.functionCall && typeof part.functionCall === 'object')
    .map((part: any) => ({
      functionCall: {
        id: typeof part.functionCall.id === 'string' ? part.functionCall.id : undefined,
        name: typeof part.functionCall.name === 'string' ? part.functionCall.name : undefined,
        args: part.functionCall.args && typeof part.functionCall.args === 'object' ? part.functionCall.args : {},
      },
      thought: part.thought === true ? true : undefined,
      thoughtSignature: typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined,
    }))
    .filter((part: any) => typeof part.functionCall.name === 'string' && part.functionCall.name.length > 0);
};

const extractGrounding = (response: any): ChatMessage['grounding'] => {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return undefined;
  const links = chunks
    .map((chunk: any) => {
      const uri = chunk?.web?.uri;
      if (!uri) return null;
      return { uri, title: chunk?.web?.title || uri };
    })
    .filter((entry: any) => Boolean(entry));
  return links.length > 0 ? links : undefined;
};

const AIAssistant: React.FC<AIAssistantProps> = ({ apiKeyReady, tools, toolExecutor, context, onUserTurnStart }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<AssistantMode>('chat');
  const [isLoading, setIsLoading] = useState(false);
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [coachEnabled, setCoachEnabled] = useState(true);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [behaviorMemory, setBehaviorMemory] = useState('');
  const [memoryDraft, setMemoryDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const feedbackStats = useMemo(() => {
    const rated = messages.filter((msg) => msg.role === 'model' && (msg.rating === 'up' || msg.rating === 'down'));
    const up = rated.filter((msg) => msg.rating === 'up').length;
    const down = rated.filter((msg) => msg.rating === 'down').length;
    const longDown = rated.filter((msg) => msg.rating === 'down' && (msg.text || '').length > 240).length;
    return { up, down, longDown };
  }, [messages]);

  const feedbackHints = useMemo(() => {
    const hints: string[] = [];
    if (feedbackStats.down > feedbackStats.up) {
      hints.push('Recent user feedback indicates answers should be more direct and execution-focused.');
    }
    if (feedbackStats.longDown >= 2) {
      hints.push('Prefer shorter answers by default unless the user explicitly asks for detail.');
    }
    return hints.join(' ');
  }, [feedbackStats]);

  const systemInstruction = useMemo(() => {
    const parts = [ASSISTANT_SYSTEM_INSTRUCTION];
    parts.push(`Official API key pages:\n${API_SETUP_GUIDE}`);
    if (context) {
      parts.push(`Current context:\n${context}`);
    }
    if (behaviorMemory.trim()) {
      parts.push(`User behavior preferences:\n${behaviorMemory.trim()}`);
    }
    if (feedbackHints) {
      parts.push(`Feedback adaptation:\n${feedbackHints}`);
    }
    return parts.join('\n\n');
  }, [behaviorMemory, context, feedbackHints]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedCoach = window.localStorage.getItem(STORAGE_KEYS.coach);
    if (storedCoach !== null) {
      setCoachEnabled(storedCoach === 'true');
    }

    const storedStep = window.localStorage.getItem(STORAGE_KEYS.step);
    if (storedStep) {
      const parsed = Number(storedStep);
      if (Number.isFinite(parsed)) {
        setWalkthroughStep(Math.min(Math.max(parsed, 0), WALKTHROUGH_STEPS.length - 1));
      }
    }

    const storedTip = window.localStorage.getItem(STORAGE_KEYS.tip);
    if (storedTip) {
      const parsed = Number(storedTip);
      if (Number.isFinite(parsed)) {
        setTipIndex(parsed % COACH_TIPS.length);
      }
    }

    const storedMemory = window.localStorage.getItem(STORAGE_KEYS.memory);
    if (storedMemory) {
      setBehaviorMemory(storedMemory);
      setMemoryDraft(storedMemory);
    }

    const storedMessagesRaw = window.localStorage.getItem(STORAGE_KEYS.messages);
    if (storedMessagesRaw) {
      try {
        const parsed = JSON.parse(storedMessagesRaw);
        if (Array.isArray(parsed)) {
          const safe = parsed
            .filter((entry: any) => entry && (entry.role === 'user' || entry.role === 'model' || entry.role === 'tool'))
            .map((entry: any) => ({
              id: typeof entry.id === 'string' ? entry.id : undefined,
              role: entry.role,
              text: typeof entry.text === 'string' ? entry.text : '',
              toolCalls: entry.toolCalls,
              toolResponses: entry.toolResponses,
              grounding: Array.isArray(entry.grounding) ? entry.grounding : undefined,
              rating: entry.rating === 'up' || entry.rating === 'down' ? entry.rating : undefined,
              createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
            })) as ChatMessage[];
          if (safe.length > 0) {
            setMessages(safe);
          }
        }
      } catch {
        setMessages([]);
      }
    }

    const hasIntro = window.localStorage.getItem(STORAGE_KEYS.intro);
    if (!hasIntro) {
      setMessages((prev) => prev.length > 0
        ? prev
        : [buildMessage('model', '👋 Hi! I\'m your AI assistant. I can help you create images, generate videos, edit your timeline, and answer any questions. What would you like to make today?')]);
      window.localStorage.setItem(STORAGE_KEYS.intro, 'true');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.step, String(walkthroughStep));
  }, [walkthroughStep]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.coach, String(coachEnabled));
  }, [coachEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.tip, String(tipIndex));
  }, [tipIndex]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.memory, behaviorMemory);
  }, [behaviorMemory]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const trimmed = messages.slice(-80);
    window.localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(trimmed));
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const appendAssistantMessage = (text: string, extras?: Partial<ChatMessage>) => {
    setMessages((prev) => [...prev, buildMessage('model', text, extras)]);
  };

  const runQuickAction = async (action: AssistantAction) => {
    if (action.prompt) {
      setInput(action.prompt);
      return;
    }
    if (!action.tool) {
      appendAssistantMessage('Action not available.');
      return;
    }
    const tool = toolExecutor[action.tool];
    if (!tool) {
      appendAssistantMessage('That action is not available in this view.');
      return;
    }
    try {
      const result = await tool(action.args || {});
      if (result?.message) {
        const links = Array.isArray(result.links)
          ? result.links
            .map((entry: any) => {
              const uri = typeof entry?.uri === 'string' ? entry.uri : null;
              if (!uri) return null;
              return {
                uri,
                title: typeof entry?.title === 'string' ? entry.title : uri,
              };
            })
            .filter(Boolean) as Array<{ uri: string; title: string }>
          : undefined;
        appendAssistantMessage(result.message, links && links.length > 0 ? { grounding: links } : undefined);
      } else if (result?.reason) {
        appendAssistantMessage(result.reason);
      } else {
        appendAssistantMessage('Done.');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Action failed.';
      appendAssistantMessage(errorMessage);
    }
  };

  const handleWalkthroughBack = () => {
    setWalkthroughStep((prev) => Math.max(prev - 1, 0));
  };

  const handleWalkthroughNext = () => {
    setWalkthroughStep((prev) => Math.min(prev + 1, WALKTHROUGH_STEPS.length - 1));
  };

  const handleWalkthroughReset = () => {
    setWalkthroughStep(0);
  };

  const cycleTip = () => {
    setTipIndex((prev) => (prev + 1) % COACH_TIPS.length);
  };

  const handleSaveMemory = () => {
    const next = memoryDraft.trim();
    setBehaviorMemory(next);
    appendAssistantMessage(next ? 'Saved behavior preferences. I will adapt future responses.' : 'Cleared behavior preferences.');
  };

  const handleRateMessage = (messageId: string | undefined, rating: 'up' | 'down') => {
    if (!messageId) return;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? { ...message, rating }
          : message
      )
    );
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !image) return;

    const userMessageText = input.trim();
    const rememberPrefix = '/remember ';
    if (userMessageText.toLowerCase().startsWith(rememberPrefix)) {
      const remembered = userMessageText.slice(rememberPrefix.length).trim();
      if (!remembered) {
        appendAssistantMessage('Nothing to remember. Use: /remember <preference>');
      } else {
        const combined = [behaviorMemory.trim(), remembered].filter(Boolean).join('\n');
        setBehaviorMemory(combined);
        setMemoryDraft(combined);
        appendAssistantMessage('Preference stored. I will follow it in this and future chats.');
      }
      setInput('');
      return;
    }
    if (userMessageText.toLowerCase() === '/clear-memory') {
      setBehaviorMemory('');
      setMemoryDraft('');
      setInput('');
      appendAssistantMessage('Behavior memory cleared.');
      return;
    }
    if (userMessageText.toLowerCase() === '/clear-chat') {
      setMessages([]);
      setInput('');
      return;
    }

    if (!apiKeyReady) {
      alert('Please select an API key first.');
      return;
    }

    const newHistory: ChatMessage[] = [...messages, buildMessage('user', userMessageText)];
    onUserTurnStart?.(userMessageText);
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
      if (image) {
        const base64 = await fileToBase64(image.file);
        const responseText = await analyzeImage(userMessageText || 'Analyze this image.', { base64, mimeType: image.file.type });
        setMessages((prev) => [...prev, buildMessage('model', responseText)]);
        setImage(null);
      } else {
        let currentHistory = [...newHistory];
        while (true) {
          const response = await runChat(currentHistory, mode, tools, systemInstruction);
          const functionCalls = response.functionCalls;

          if (!functionCalls || functionCalls.length === 0) {
            setMessages([...currentHistory, buildMessage('model', response.text, { grounding: extractGrounding(response) })]);
            break;
          }

          const functionCallParts = extractFunctionCallParts(response);
          currentHistory.push(buildMessage('model', '', { toolCalls: functionCallParts.length > 0 ? functionCallParts : functionCalls }));

          const toolResponses = [];
          for (const call of functionCalls) {
            const tool = toolExecutor[call.name];
            if (tool) {
              const result = await tool(call.args);
              toolResponses.push({
                id: call.id,
                name: call.name,
                response: { result },
              });
            } else {
              toolResponses.push({
                id: call.id,
                name: call.name,
                response: { result: { success: false, message: `Tool ${call.name} unavailable.` } },
              });
            }
          }

          currentHistory.push(buildMessage('tool', '', { toolResponses }));
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      setMessages((prev) => [...prev, buildMessage('model', `Error: ${errorMessage}`)]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage({ file, url: URL.createObjectURL(file) });
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <header className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MagicWandIcon className="w-6 h-6 text-indigo-400" />
          <h2 className="text-xl font-bold">AI Assistant</h2>
        </div>
        <button
          type="button"
          onClick={() => setMessages([])}
          className="text-[11px] text-gray-400 hover:text-gray-200"
        >
          Clear Chat
        </button>
      </header>

      {coachEnabled ? (
        <div className="p-4 border-b border-gray-700 bg-gray-900/40 max-h-[42vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Quick Start Guide</h3>
              <p className="text-[10px] text-gray-400">Your AI assistant — ask anything or use the quick actions below.</p>
            </div>
            <button
              type="button"
              onClick={() => setCoachEnabled(false)}
              className="text-[10px] text-gray-400 hover:text-gray-200"
            >
              Hide Guide
            </button>
          </div>
          <div className="mt-3 text-[11px] text-gray-300 bg-gray-900 border border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Tip</span>
              <button
                type="button"
                onClick={cycleTip}
                className="text-[10px] text-indigo-300 hover:text-indigo-200"
              >
                New tip
              </button>
            </div>
            <p>{COACH_TIPS[tipIndex]}</p>
          </div>
          <div className="mt-3 bg-gray-900 border border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Walkthrough</span>
              <span className="text-[10px] text-gray-500">
                {walkthroughStep + 1}/{WALKTHROUGH_STEPS.length}
              </span>
            </div>
            <div className="mt-2 text-sm text-white">{WALKTHROUGH_STEPS[walkthroughStep].title}</div>
            <p className="text-[11px] text-gray-400 mt-1">{WALKTHROUGH_STEPS[walkthroughStep].description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleWalkthroughBack}
                className="text-[11px] bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded"
                disabled={walkthroughStep === 0}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleWalkthroughNext}
                className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded"
                disabled={walkthroughStep >= WALKTHROUGH_STEPS.length - 1}
              >
                Next
              </button>
              {WALKTHROUGH_STEPS[walkthroughStep].action && (
                <button
                  type="button"
                  onClick={() => runQuickAction(WALKTHROUGH_STEPS[walkthroughStep].action!)}
                  className="text-[11px] bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded"
                >
                  {WALKTHROUGH_STEPS[walkthroughStep].action!.label}
                </button>
              )}
              <button
                type="button"
                onClick={handleWalkthroughReset}
                className="text-[11px] text-gray-400 hover:text-gray-200"
              >
                Restart
              </button>
            </div>
          </div>
          <div className="mt-3 bg-gray-900 border border-gray-700 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Assistant Memory</div>
            <p className="text-[10px] text-gray-400 mb-2">Tell the assistant how to behave. Supports chat commands: <code>/remember ...</code> and <code>/clear-memory</code>.</p>
            <textarea
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-md p-2 text-[11px] text-gray-200 resize-none"
              rows={3}
              placeholder="Example: Keep answers short. Always propose executable steps first."
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleSaveMemory}
                className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded"
              >
                Save Memory
              </button>
              <div className="text-[10px] text-gray-500">
                Feedback: {feedbackStats.up} helpful / {feedbackStats.down} needs work
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Go to</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => runQuickAction(action)}
                  className="text-[11px] bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded"
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-3 mb-2">Ask AI</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => runQuickAction(action)}
                  className="text-[11px] bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 border-b border-gray-700 bg-gray-900/40 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">Guide is hidden.</span>
          <button
            type="button"
            onClick={() => setCoachEnabled(true)}
            className="text-[11px] text-indigo-300 hover:text-indigo-200"
          >
            Enable
          </button>
        </div>
      )}

      <div className="flex-grow min-h-0 p-4 overflow-y-auto">
        {messages.map((msg, index) => {
          if (msg.role === 'tool') return null;
          const text = msg.role === 'model' && msg.toolCalls
            ? `Performing action: ${getToolCallName(msg.toolCalls[0]) || 'tool'}...`
            : msg.text;
          const isModelReply = msg.role === 'model' && !msg.toolCalls;
          return (
            <div key={msg.id || index} className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
              <div className={`inline-block p-3 rounded-lg max-w-[92%] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-700'}`}>
                <p className="whitespace-pre-wrap">{text}</p>
                {msg.grounding && msg.grounding.length > 0 && (
                  <div className="mt-2 border-t border-gray-600 pt-2">
                    <p className="text-xs text-gray-400 mb-1">Sources:</p>
                    {msg.grounding.map((g, i) => (
                      <a href={g.uri} target="_blank" rel="noopener noreferrer" key={i} className="text-xs text-indigo-300 block hover:underline truncate">
                        {g.title || g.uri}
                      </a>
                    ))}
                  </div>
                )}
                {isModelReply && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRateMessage(msg.id, 'up')}
                      className={`text-[10px] px-2 py-0.5 rounded border ${msg.rating === 'up' ? 'bg-green-700 border-green-600 text-white' : 'border-gray-500 text-gray-300 hover:border-gray-300'}`}
                    >
                      Helpful
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRateMessage(msg.id, 'down')}
                      className={`text-[10px] px-2 py-0.5 rounded border ${msg.rating === 'down' ? 'bg-red-700 border-red-600 text-white' : 'border-gray-500 text-gray-300 hover:border-gray-300'}`}
                    >
                      Improve
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {isLoading && <div className="text-center text-gray-400">Assistant is thinking...</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-700 flex-shrink-0">
        <div className="flex items-center justify-center gap-2 mb-2">
          {(['chat', 'search', 'thinking'] as AssistantMode[]).map((m) => (
            <button type="button" key={m} onClick={() => setMode(m)} className={`px-3 py-1 text-xs rounded-full ${mode === m ? 'bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {m === 'chat' ? '💬 Chat' : m === 'search' ? '🔍 Search' : m === 'thinking' ? '🧠 Deep Think' : m}
            </button>
          ))}
        </div>
        {image && (
          <div className="relative w-24 h-24 mb-2">
            <img src={image.url} alt="upload preview" className="w-full h-full object-cover rounded" />
            <button type="button" onClick={() => setImage(null)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs">&times;</button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
          <button type="button" onClick={handleUploadClick} className="p-2 bg-gray-700 rounded-lg hover:bg-gray-600">
            <UploadIcon className="w-5 h-5" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask anything — e.g. 'Make me a cinematic image of a sunset'"
            className="flex-grow bg-gray-900 border border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 resize-none"
            rows={2}
          />
          <button onClick={() => handleSubmit()} disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-600 self-stretch">
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;
