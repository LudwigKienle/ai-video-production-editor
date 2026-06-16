# Spec: Core Workspace Integration & System Stabilization

## Objective
Establish a stable, fully integrated foundation for the AI Video Production Editor. This involves securing the authentication flow, connecting core workspaces to their respective AI services, and ensuring consistent error handling across the application.

## Functional Requirements
- **Secure Key Management**: Implement a robust "Bring Your Own Key" (BYOK) system using local storage.
- **Service Integration**:
    - Connect the **Script Workspace** to the `geminiService` for narrative-driven script generation.
    - Connect the **Photo Workspace** to the `replicateService` for storyboard image generation.
- **Narrative Principles**: Enable selection of McKee and Campbell principles within the scripting workflow.
- **Error Handling**: Implement user-friendly error messages and recovery states for all AI service calls.

## Technical Constraints
- **Local Privacy**: All API keys must remain on the user's machine (Local Storage).
- **Service Layer**: Use existing service modules in `services/`.
- **Framework**: Adhere to the established React + Electron architecture.

## Success Criteria
- Users can securely save and validate their Gemini API keys.
- Scripts can be generated based on selected narrative principles.
- Storyboard images can be generated from script beats using Replicate.
- Automated tests verify at least 80% coverage for new integration logic.
