# Technology Stack

## Core Technologies
- **Language**: [TypeScript](https://www.typescriptlang.org/) - Ensuring type safety and maintainable code for a complex desktop application.
- **Frontend Framework**: [React (v18)](https://react.dev/) - Utilizing a component-based architecture for a highly interactive and stateful UI.
- **Desktop Runtime**: [Electron (v30)](https://www.electronjs.org/) - Providing a cross-platform desktop experience with access to local system resources.
- **Build & Development Tooling**: [Vite](https://vitejs.dev/) - High-performance build tool for fast development and optimized production bundles.
- **Testing**: [Vitest](https://vitest.dev/) - Blazing fast unit test framework powered by Vite.

## AI & Media Services
- **LLM & Vision**: [Google Generative AI (@google/genai)](https://ai.google.dev/) - Powering the AI Scriptwriter, Director Review, and contextual understanding features.
- **Image & Video Generation**: [Replicate](https://replicate.com/) - Integrated for high-fidelity storyboard and video generation using various open-source models.
- **Voice & Audio**: [ElevenLabs](https://elevenlabs.io/) - Providing high-quality AI voice synthesis for scripts and narration.

## UI & Styling
- **Utility-First CSS**: [Tailwind CSS](https://tailwindcss.com/) - Rapidly building custom, cinematic UIs with high consistency.
- **Markdown Rendering**: [react-markdown](https://github.com/remarkjs/react-markdown) - Displaying AI-generated scripts and critiques with full formatting support.

## Project Structure (Inferred)
- **Monolith with Service Layer**: The project follows a centralized architecture where UI components interact with specialized services (`services/`) for AI, project management, and PDF parsing.
- **Workspace-Based Navigation**: The UI is structured into functional "Workspaces" (Script, Photo, Edit, Grading, etc.) to mirror a professional production pipeline.
- **Local-First Persistence**: Leverages machine local storage for secure storage of API keys and project metadata.
