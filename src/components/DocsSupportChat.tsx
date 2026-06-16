import React, { useMemo, useState } from 'react';
import { DOCS_KNOWLEDGE_BASE, QUICK_QUESTIONS, DocsChunk } from '../docs/docSupportData';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: string[];
};

const STORAGE_KEY = 'docs_support_gemini_api_key';
const GEMINI_MODEL = (import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.1-flash-preview').trim();
const ENV_GEMINI_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();

const tokenize = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);

const rankRelevantChunks = (query: string, limit = 5): DocsChunk[] => {
  const tokens = tokenize(query);
  const tokenSet = new Set(tokens);

  const scored = DOCS_KNOWLEDGE_BASE.map((chunk) => {
    const chunkText = `${chunk.title} ${chunk.section} ${chunk.tags.join(' ')} ${chunk.content}`.toLowerCase();
    const overlap = tokens.reduce((sum, token) => (chunkText.includes(token) ? sum + 1 : sum), 0);
    const tagBoost = chunk.tags.reduce((sum, tag) => (tokenSet.has(tag.toLowerCase()) ? sum + 2 : sum), 0);
    const exactPhraseBoost = query.length > 6 && chunkText.includes(query.toLowerCase()) ? 3 : 0;
    return { chunk, score: overlap + tagBoost + exactPhraseBoost };
  })
    .sort((a, b) => b.score - a.score)
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) {
    return DOCS_KNOWLEDGE_BASE.slice(0, Math.min(limit, DOCS_KNOWLEDGE_BASE.length));
  }

  return scored.slice(0, limit).map((entry) => entry.chunk);
};

const buildPrompt = (question: string, chunks: DocsChunk[], history: ChatMessage[]) => {
  const context = chunks
    .map((chunk) => `## ${chunk.title} (${chunk.section})\n${chunk.content}`)
    .join('\n\n');

  const recentHistory = history
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');

  return `You are AI Video Production Editor Docs Support Assistant.

Rules:
- Answer only based on provided context and question.
- If information is missing, say what is missing and suggest next check steps.
- Be concise, practical, and action-oriented.
- Prefer numbered steps for troubleshooting.
- Do not invent unavailable product features.
- Explain actions with exact UI names (phase, tab, or button) whenever possible.
- Focus on customer-facing usage only, not technical internals.
- Do not mention source code, files, backend architecture, or implementation details.
- Reply in the same language as the user question.

Software context and documentation context:
${context}

Recent chat history:
${recentHistory || 'No prior messages.'}

User question:
${question}

Return a direct support answer.`;
};

const callGemini = async (apiKey: string, prompt: string): Promise<string> => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 700,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Gemini request failed (${response.status}).`;
    throw new Error(message);
  }

  const answer =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || '')
      .join('\n')
      .trim() || '';

  if (!answer) {
    throw new Error('Gemini returned an empty response.');
  }

  return answer;
};

const buildFallbackAnswer = (question: string, chunks: DocsChunk[]): string => {
  const contextList = chunks
    .map((chunk) => `- ${chunk.title}: ${chunk.content}`)
    .join('\n');

  return [
    'No Gemini API key detected (environment or browser override). Here are the most relevant documentation notes based on your question:',
    '',
    contextList,
    '',
    `Question received: "${question}"`,
    'Set VITE_GEMINI_API_KEY or add a key above to get a full conversational answer with reasoning and step-by-step guidance.',
  ].join('\n');
};

const DocsSupportChat: React.FC = () => {
  const [manualApiKey, setManualApiKey] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(STORAGE_KEY) || '';
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi, I can answer AI Video Production Editor documentation and workflow questions. Ask about setup, model choice, troubleshooting, tutorials, or feature usage.',
    },
  ]);

  const apiKey = manualApiKey.trim() || ENV_GEMINI_KEY;
  const hasKey = apiKey.length > 0;

  const sourceSummary = useMemo(() => {
    const unique = new Set<string>();
    messages.forEach((message) => {
      message.sources?.forEach((source) => unique.add(source));
    });
    return Array.from(unique);
  }, [messages]);

  const persistKey = (value: string) => {
    setManualApiKey(value);
    if (typeof window !== 'undefined') {
      if (value.trim()) {
        window.localStorage.setItem(STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  };

  const askQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;

    setError(null);
    const relevantChunks = rankRelevantChunks(trimmed);
    const sourceTitles = relevantChunks.map((chunk) => `${chunk.section}: ${chunk.title}`);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const assistantText = hasKey
        ? await callGemini(apiKey.trim(), buildPrompt(trimmed, relevantChunks, [...messages, userMessage]))
        : buildFallbackAnswer(trimmed, relevantChunks);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: assistantText,
        sources: sourceTitles,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to get support response.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="section reveal" id="docs-assistant">
      <div className="section-header">
        <h2>Docs Support Chat</h2>
        <p>Notebook-style support chat with software and documentation context.</p>
      </div>

      <div className="docs-chat-wrap">
        <div className="docs-chat-settings">
          <label htmlFor="docs-gemini-key" className="docs-chat-label">Gemini API Key (optional override)</label>
          <input
            id="docs-gemini-key"
            type="password"
            value={manualApiKey}
            onChange={(event) => persistKey(event.target.value)}
            placeholder={ENV_GEMINI_KEY ? 'Override default key (optional)' : 'AIza...'}
            className="docs-chat-input"
            autoComplete="off"
          />
          <p className="docs-chat-meta">
            {ENV_GEMINI_KEY
              ? 'Default key loaded from environment. You can override it for this browser via localStorage.'
              : 'No environment key detected. Add a key below to enable full chat responses.'}
          </p>

          <div className="docs-chat-quick">
            {QUICK_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                className="docs-chat-chip"
                onClick={() => askQuestion(question)}
                disabled={isLoading}
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        <div className="docs-chat-panel" aria-live="polite">
          <div className="docs-chat-messages">
            {messages.map((message) => (
              <article key={message.id} className={`docs-chat-message docs-chat-message--${message.role}`}>
                <div className="docs-chat-role">{message.role === 'user' ? 'You' : 'Docs Support'}</div>
                <p>{message.content}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="docs-chat-sources">Sources: {message.sources.join(' | ')}</div>
                )}
              </article>
            ))}

            {isLoading && <div className="docs-chat-loading">Thinking with documentation context...</div>}
          </div>

          <form
            className="docs-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              askQuestion(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about setup, workflows, errors, or feature usage..."
              className="docs-chat-textarea"
              rows={3}
            />
            <button type="submit" className="btn btn-primary" disabled={isLoading || input.trim().length === 0}>
              Ask Docs Support
            </button>
          </form>

          {error && <div className="docs-chat-error">{error}</div>}

          {sourceSummary.length > 0 && (
            <div className="docs-chat-footnote">
              Context used in this chat: {sourceSummary.join(' | ')}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default DocsSupportChat;
