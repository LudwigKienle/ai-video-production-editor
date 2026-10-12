# MiniMax H3 through vgenv

The **MiniMax H3 (vgenv)** option in Create Videos is an independent desktop provider. It does not use the MiniMax H3 entry in the FAL catalog, hosted credits, or Auto routing.

Open a local project folder, select the vgenv option, and enter a vgenv Project API key. The key stays in Electron main-process memory for this app session. It is cleared when the app quits. The web build disables this option because it has no trusted key transport.

This first adapter supports text prompts and optional first/last image frames, 480p or 768p, 4–15 seconds, and the aspect ratios listed in the model selector. A last frame requires a first frame. **Raw** sends the prompt as written; **Enhance** asks vgenv to optimize it. vgenv supplies the final job price and currency, which may be CNY or USD.

The app saves job IDs in `.vgenv-jobs.json` inside the project folder. Completed videos are downloaded to `media/videos` and added to the project index. A failed download can be retried using **Resume / retry download** without creating a second paid job. Enter the key again after restarting the desktop app to resume an unfinished job. Cancellation is only displayed as confirmed after the remote API reports `cancelled`; a running job may continue.

API contract: [vgenv OpenAPI](https://api.vgenv.com/docs-json), [MiniMax H3 documentation](https://vgenv.com/en/minimax-h3-api).
