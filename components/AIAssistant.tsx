import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { runChat, analyzeImage } from '../services/geminiService';
import { MagicWandIcon, UploadIcon } from './icons';
import { fileToBase64 } from '../utils/helpers';
import { FunctionDeclaration } from '@google/genai';

interface AIAssistantProps {
  apiKeyReady: boolean;
  tools: FunctionDeclaration[];
  toolExecutor: { [key: string]: Function };
}

type AssistantMode = 'chat' | 'search' | 'maps' | 'thinking';

const AIAssistant: React.FC<AIAssistantProps> = ({ apiKeyReady, tools, toolExecutor }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<AssistantMode>('chat');
  const [isLoading, setIsLoading] = useState(false);
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !image) return;
    if (!apiKeyReady) {
        alert("Please select an API key first.");
        return;
    }

    const userMessageText = input.trim();
    const newHistory: ChatMessage[] = [...messages, { role: 'user', text: userMessageText }];
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
        if (image) {
            const base64 = await fileToBase64(image.file);
            const responseText = await analyzeImage(userMessageText || 'Analyze this image.', { base64, mimeType: image.file.type });
            setMessages(prev => [...prev, { role: 'model', text: responseText }]);
            setImage(null);
        } else {
            // Function calling loop
            let currentHistory = newHistory;
            while (true) {
                const response = await runChat(currentHistory, mode, tools);
                const functionCalls = response.functionCalls;

                if (!functionCalls || functionCalls.length === 0) {
                    setMessages([...currentHistory, { role: 'model', text: response.text }]);
                    break;
                }

                // Add model's function call message to history
                currentHistory.push({ role: 'model', text: '', toolCalls: functionCalls });

                const toolResponses = [];
                for (const call of functionCalls) {
                    const tool = toolExecutor[call.name];
                    if (tool) {
                        const result = await tool(call.args);
                        toolResponses.push({
                            id: call.id,
                            name: call.name,
                            response: { result: JSON.stringify(result) }
                        });
                    }
                }

                // Add tool's response message to history
                currentHistory.push({ role: 'tool', text: '', toolResponses });
            }
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        setMessages(prev => [...prev, { role: 'model', text: `Error: ${errorMessage}` }]);
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
    <div className="w-full h-full flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <MagicWandIcon className="w-6 h-6 text-indigo-400" />
            <h2 className="text-xl font-bold">AI Assistant</h2>
          </div>
        </header>

        <div className="flex-grow p-4 overflow-y-auto">
          {messages.map((msg, index) => {
            if (msg.role === 'tool') return null; // Don't display tool responses directly
            const text = msg.role === 'model' && msg.toolCalls ? `Performing action: ${msg.toolCalls[0].name}...` : msg.text;

            return (
                <div key={index} className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block p-3 rounded-lg ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-700'}`}>
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
                  </div>
                </div>
            );
          })}
          {isLoading && <div className="text-center text-gray-400">Assistant is thinking...</div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-center gap-2 mb-2">
            {(['chat', 'search', 'maps', 'thinking'] as AssistantMode[]).map(m => (
                <button type="button" key={m} onClick={() => setMode(m)} className={`px-3 py-1 text-xs rounded-full ${mode === m ? 'bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
            ))}
          </div>
          {image && (
            <div className="relative w-24 h-24 mb-2">
                <img src={image.url} alt="upload preview" className="w-full h-full object-cover rounded"/>
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
              placeholder="e.g., Apply a blur effect to clip 2..."
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