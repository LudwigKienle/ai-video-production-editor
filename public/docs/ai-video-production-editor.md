# AI Video Production Editor: Documentation & User Guide

## 1. Introduction
**Cinematic AI Studio**

The **AI Video Production Editor** (also referred to as **Cinematic AI Studio**) is a native professional application designed to bridge the gap between traditional filmmaking and generative AI. Unlike browser-based tools that fragment the creative process, this application provides a unified, "Studio-Workspace" environment where filmmakers, content creators, and storytellers can manage the entire production lifecycle—from initial concept to final export—within a single interface.

Built on a robust **React** and **Electron** architecture, the software integrates state-of-the-art AI models (Gemini, Veo, Kling, Flux) directly into a non-linear editorial workflow, enabling users to direct AI agents rather than just prompting them.

---

## 2. Getting Started

### System Setup
The application follows a **"Bring Your Own Key" (BYOK)** architecture, ensuring you pay wholesale prices directly to AI providers without platform markups.

### API Configuration
To unlock the full potential of the studio, configure the following keys in the **Settings** panel:

*   **Google Gemini API**: Required for the **Reasoning Engine**, Scriptwriting, Story Bible analysis, and "Neurocinematics" features. The paid tier is recommended for accessing advanced video generation models like **Veo**.
*   **Replicate API**: Powers the heavy lifting for visual generation, including **Flux** (Image Gen), **Kling**, **Luma**, and **WanI2V** (Video Gen), as well as **ControlNet** for storyboarding.
*   **ElevenLabs API**: Essential for generating Hollywood-grade AI voiceovers and character dialogue.
*   **Sketchfab (Optional)**: Enables the importation of 3D assets for the Set Design workspace.

---

## 3. Core Workflow: The 5 Phases

The studio organizes the chaotic generative process into a structured **5-Phase Production Workflow**, mirroring a real Hollywood pipeline.

### Phase 1: Concept
*   **Project Hub**: Define your **Story Bible** (Premise, Characters, Style). This is the source of truth for all AI agents.
*   **Script Workspace**: Write your screenplay in standard format. The AI analyzes your scene headings and dialogue to prepare shot lists.
*   **Moodboard**: Gather visual references. The AI uses these to maintain visual consistency across generations.
*   **Neurocinematics**: An advanced analysis tool that evaluates your script/shots for psychological impact, using principles like Mirror Neurons and Event Segmentation Theory to predict audience engagement.

### Phase 2: Assets consistent
*   **Asset Library**: Your central repository for generated images, videos, and audio.
*   **Avatars**: Define consistent characters. Upload reference photos to train specific character LoRAs or use "Face ID" consistency.
*   **World Gen**: Create 360° HDRI environments for lighting and backgrounds.
*   **Set Design**: A 3D workspace where you can place simple shapes (cubes, spheres) to block out a scene's composition before generating it.

### Phase 3: Generation
*   **Video Gen**: The powerhouse workspace. Select a shot from your storyboard and send it to **Veo**, **Kling**, **Luma**, or **Runway** (via Replicate).
*   **Image Gen**: Create high-fidelity keyframes using **Flux Pro** or **Imagen**.
*   **Upscale**: Enhance 720p generations to 4K using AI upscaling.

### Phase 4: Production
*   **Editor**: A full non-linear timeline. Drag and drop your generated clips, trim them, and arrange the narrative.
*   **Auto Cut**: An intelligent agent that watches your raw generations and automatically assembles a "Rough Cut" based on the script's pacing.
*   **Sound**: Add AI-generated music tracks and sound effects (SFX) to match the mood.
*   **Compositing**: Layer diverse elements, apply filters, and color grade your footage.

### Phase 5: Delivery
*   **Review**: A screening room for watching the final cut.
*   **Export**: Render your project to MP4/ProRes for distribution.

---

## 4. Key Features Deep Dive

### Neurocinematics Engine
One of the studio's most unique features. Usage:
1.  Open the **Neurocinematics** workspace.
2.  Select a scene or a generated clip.
3.  Click **Analyze**.
4.  The AI assumes the role of a cognitive film analyst, providing feedback on:
    *   **Embodiment**: Does the shot trigger mirror neurons?
    *   **Visual Hierarchy**: Is the viewer's eye guided correctly?
    *   **Pacing**: Does the edit match human cognitive segmentation events?

### Storyboard: Wireframe-to-Image
Stop fighting with text prompts.
1.  Go to **Set Design**.
2.  Place a "Cube" for a building and a "Sphere" for a character.
3.  Set the camera angle.
4.  Click **Generate Storyboard**.
5.  ControlNet uses your crude 3D block-out to generate a perfectly composed cinematic shot.

### Project Hub & Sync
*   **Cloud Sync**: The app saves projects as portable JSON bundles. Sync these folders via Dropbox/Google Drive to collaborate.
*   **Live Tasks**: The Project Hub automatically converts your script into a checklist of "Shots to Generate," showing you exactly how much coverage you have left to complete.

---

## 5. Technical Overview

### Architecture
The **AI Video Production Editor** is a sophisticated hybrid application built for performance and extensibility.

*   **Frontend**: Built with **React** and **Vite**, offering a lightning-fast, reactive user interface with "Industrial Design" aesthetics (dark mode, modular panels).
*   **Backend / Runtime**: Runs on **Electron**, providing native system access for file management and hardware acceleration.
*   **Node-Based Workflow**: The application utilizes a node-graph architecture (similar to ComfyUI) for its generation pipeline. This allows advanced users to chain diverse AI models—for example, piping the output of an **OpenPose** node into a **Flux** image generator, and then into a **Kling** video generator—creating complex, repeatable workflows.

---

## Support
If you need help, contact:
- Email: luikienle@gmail.com
- Phone: +49 152 36760377
