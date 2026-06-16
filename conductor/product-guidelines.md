# Product Guidelines

## Visual Identity & Aesthetic
- **Cinematic Dark Mode**: The primary interface MUST be a high-contrast dark mode to reduce eye strain and allow visual content (images/videos) to stand out. Use deep grays and blacks (#121212, #1E1E1E) for backgrounds.
- **Accent Palette**: Use professional accent colors—Amber (#FFBF00) for "Director" or "Action" items, and Electric Blue (#007AFF) for AI status and processing indicators.
- **Glassmorphism & Depth**: Employ subtle transparency and background blurs for modals and overlays (e.g., `backdrop-filter: blur(8px)`) to give a modern, "AI-augmented" feel.
- **Typography**: Prioritize highly legible sans-serif fonts (e.g., Inter, SF Pro) for UI elements, and a distinct monospace font for script metadata and technical details.

## Tone & Voice
- **Professional & Empowering**: The application should speak like a senior technical director—authoritative, precise, but always focused on augmenting the user's creativity rather than replacing it.
- **Transparent AI Communication**: Use clear, non-mysterious language when the AI is working. Instead of "Thinking...", use "Analyzing script structure..." or "Synthesizing storyboard beats...".
- **Constructive Feedback**: In the "Director Review" phase, the AI's tone should be critical but constructive, using phrases like "Consider adjusting..." or "To improve pacing, try...".

## UI/UX Principles
- **Information Density with Focus**: Maintain high information density suitable for professional work, but use collapsible sidebars (Inspector, Media Bin, AI Assistant) to allow the user to focus on the current task.
- **Guided AI Workflows**: While providing granular control, offer "Wizards" or "Guided Paths" for complex AI operations like batch image generation or script breakdown.
- **AI-First Interactions**: Ensure the AI Assistant is always accessible via a global shortcut or floating button, supporting both text and voice-like interactions.
- **Immediate Visual Feedback**: Every AI-generated asset should have a clear, immediate preview and a visible "Generation Status" (Queued, Processing, Complete, Error).

## Interaction Design
- **Keyboard-Centric**: Provide robust keyboard shortcuts for all primary actions (Play/Pause, Toggle Sidebar, Open AI Assistant) to support professional "power user" workflows.
- **Drag-and-Drop Ubiquity**: Support dragging and dropping assets between the Media Bin, Timeline, and AI prompts for intuitive resource management.
