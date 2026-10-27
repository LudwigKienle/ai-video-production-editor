# MCP-Abdeckung: Create, Edit, Review, Deliver

Stand 27.10.2026. Server „ai-video-studio“. Branch `feat/mcp-coverage` (Basis main `c29dd0e`) plus die Module der parallelen Sessions.

**Legende**
- ✅ vorhanden: lesbar und steuerbar per MCP
- ◐ teilweise: Abweichung steht in der Spalte „Hinweis“
- ✗ fehlt
- **$**: kostet Provider-Credits (Tool-Beschreibung beginnt mit „[KOSTET CREDITS]“)
- **⌫**: löscht oder überschreibt Daten (Tool-Beschreibung beginnt mit „[LÖSCHT]“)

„Vorher“ meint main `c29dd0e`. Dort waren alle hier gelisteten Seiten nur über `navigateWorkspace` öffenbar.

## So funktioniert es

- Jede Seite hat ein Modul `src/mcp/modules/<bereich>Tools.ts` mit Test. App.tsx lädt alle Module per `import.meta.glob` und veröffentlicht sie zusammen mit den alten Tools.
- **Projektdaten** wie Review, Avatare, Design-Canvas, Welten oder Analyse lesen und schreiben die Tools direkt über `ctx.getState().extras` und `ctx.actions.setExtra`. Die Schlüssel stehen in `src/mcp/projectExtras.ts`. Dafür muss die Seite nicht offen sein.
- **Seitenzustand** wie Generierungs-Einstellungen, Referenzlisten oder Jobs: Die Seite meldet ihn per `useLivePage(ns, spec)` (`src/mcp/livePage.ts`) als Live-Commands `<ns>.get/.set/.action`. `createLivePageModule` (`src/mcp/livePageTools.ts`) macht daraus die Tools `<präfix>get_state`, `<präfix>set` und ein Tool je Button. Die Tools öffnen die Seite bei Bedarf und rufen denselben Handler wie der Button.
- **Gemeinsame Logik statt Kopie:** Für Review, Requests, Avatar-Generierung, Welt-Historie und Quick-Scan-Frames rufen Seite und Tool jetzt dieselbe Funktion auf: `services/reviewLogic.ts`, `services/avatarGeneration.ts`, `services/worldHistory.ts`, `utils/videoFrameSampling.ts`.

## Navigation (`workspace_`)

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Seite öffnen | ✅ | ✅ | `navigateWorkspace` (alt), `workspace_open` (prüft Modus und Rolle, nennt den Grund) |
| Seitenliste mit Gruppen, Verfügbarkeit und Tool-Präfixen | ✗ | ✅ | `workspace_list` |
| Tool-Index mit Kosten- und Lösch-Kennzeichen | ✗ | ✅ | `workspace_list_tools` |
| Oberflächen-Modus (Simple/Standard/Pro) | ✗ | ✅ | `workspace_set_ui_mode` (Nodes, World, Avatar usw. brauchen Standard oder Pro) |

## Create

### Images (IMAGE_GEN): `image_gen_`

| Funktion (Tab › Bedienelement) | Vorher | Nachher | Tool / Hinweis |
|---|---|---|---|
| Alle Einstellungen lesen (Prompt, Modell, Format, Größe, Presets, Kamera/Objektiv, LoRA, Relight, ComfyUI …), Kosten-Schätzung, Jobs, Ergebnisse, Verlauf, Kataloge | ✗ | ✅ | `image_gen_get_state` |
| Einstellungen setzen (über 60 Felder, validiert: Modell-, Format- und Größen-Enums) | ✗ | ✅ | `image_gen_set` |
| Generate › Create Image (52 Modelle + Auto, @Charakter-Tags, Referenzen) **$** | ✗ | ✅ | `image_gen_generate` (gibt die neuen Medien zurück) |
| Smart Model Router › Apply Route / Ziel-Chips | ✗ | ✅ | `image_gen_apply_smart_route` |
| Referenzbilder hinzufügen / entfernen / leeren ⌫ | ✗ | ✅ | `image_gen_add_reference`, `_remove_reference`, `_clear_references` |
| Moodboard hinzufügen / entfernen / leeren ⌫ | ✗ | ✅ | `image_gen_add_moodboard_image`, `_remove_moodboard_image`, `_clear_moodboard` |
| Library-Asset als Referenz, Moodboard-Bild oder Relight-/Photoreal-Quelle | ✗ | ✅ | `image_gen_use_library_asset` |
| Relight **$** | ✗ | ✅ | `image_gen_relight` |
| Photoreal-Check **$** | ✗ | ✅ | `image_gen_photoreal_check` |
| Director: Shots planen **$** / Shot übernehmen | ✗ | ✅ | `image_gen_director_plan`, `_director_apply_shot` |
| LoRA-Training starten **$** / Status | ✗ | ✅ | `image_gen_start_lora_training`, `_refresh_lora_training` |
| Verlauf: Einstellungen oder Prompt wiederverwenden | ✗ | ✅ | `image_gen_reuse_history`, `_reuse_prompt` |
| Jobs: erledigte Jobs leeren | ✗ | ✅ | `image_gen_clear_completed_jobs` |
| „Animate in Video Gen“ | ✗ | ✅ | `image_gen_animate_in_video_gen` |
| ComfyUI: Connect, Start, Stop ⌫, Status, Health, Logs laden/leeren ⌫ | ✗ | ✅ | `image_gen_comfy_*` |
| ComfyUI: Presets speichern/anwenden/löschen ⌫, Favoriten, Chain-Template, Schritte, Workflow-Export | ✗ | ✅ | `image_gen_comfy_*` (Workflow-JSON über `settings.comfyWorkflowJson`) |
| Download / Kopieren / Vorschau-Lightbox | – | ◐ | Ergebnis-URLs stehen in `get_state`; Download macht das Agent-Tool selbst |

### Video (VIDEO_GEN): `video_gen_`

| Funktion | Vorher | Nachher | Tool / Hinweis |
|---|---|---|---|
| Einstellungen lesen/setzen (Modell, Format, Dauer, Elements, LTX, P-Video, Seedance, PixVerse, Kling …) | ✗ | ✅ | `video_gen_get_state`, `video_gen_set` |
| Generate video (41 Modelle + Auto) **$** | ✗ | ✅ | `video_gen_generate` |
| Start-, End- und Motion-Frame aus URL, Datei oder Media-Bin | ✗ | ✅ | `video_gen_set_frame` |
| Audiospur | ✗ | ✅ | `video_gen_set_audio` |
| Storyboard- und Element-Referenzen hinzufügen/entfernen | ✗ | ✅ | `video_gen_add/remove_storyboard_reference`, `_add/remove_element_reference` |
| Burst Frame: Analyse **$** / Übernehmen | ✗ | ✅ | `video_gen_burst_analyze`, `video_gen_burst_apply` (Prompt ohne Seite: `burst_frame_build_prompt`) |
| Readiness-Checkliste, Kosten-Schätzung | ✗ | ✅ | in `video_gen_get_state` |

### Design (DESIGN): `design_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Canvas lesen (Format, Ebenen, Auswahl) | ✗ | ✅ | `design_get` |
| Format-Preset, Hintergrund, Name | ✗ | ✅ | `design_set_canvas` |
| Text, Rechteck/Kreis, Bild aus Projekt | ✗ | ✅ | `design_add_layer` |
| Inspector: Position, Größe, Rotation, Deckkraft, Text, Farben, Radius, sichtbar, gesperrt | ✗ | ✅ | `design_update_layer` |
| Ebene wählen / duplizieren / nach vorn oder hinten | ✗ | ✅ | `design_select_layer`, `_duplicate_layer`, `_arrange_layer` |
| Ebene löschen ⌫ | ✗ | ✅ | `design_delete_layer` |
| Template (Title, Thumbnail, Lower Third) ⌫ ersetzt den Canvas | ✗ | ✅ | `design_apply_template` |
| Export PNG (Media-Bin, optional Timeline) | ✗ | ✅ | `design_export_png` |
| Generate Layer (Imagen) **$** | ✗ | ✅ | `design_generate_layer` |

### Nodes (NODES): `nodes_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Gespeicherten Graph lesen (ohne Seite) | ✗ | ✅ | `nodes_get_graph` |
| Live-Zustand: Knoten, Kanten, Validierung, Lauf-Status, Ergebnisse, Kataloge (19 Typen mit Ports, 9 Blueprints, Modelle) | ✗ | ✅ | `nodes_get_state` |
| Ausführungs- und Sicherheitsmodus, Paletten-Suche/-Gruppe, Library-Suche | ✗ | ✅ | `nodes_set` |
| Knoten hinzufügen / bearbeiten / wählen / duplizieren | ✗ | ✅ | `nodes_add_node`, `_update_node`, `_select_node`, `_duplicate_node` |
| Knoten löschen ⌫ / Verbindung lösen ⌫ | ✗ | ✅ | `nodes_delete_node`, `nodes_disconnect` |
| Verbinden (Ports werden geprüft) | ✗ | ✅ | `nodes_connect` |
| Blueprint einfügen / Auto space | ✗ | ✅ | `nodes_insert_template`, `nodes_auto_layout` |
| Library-Asset in Image-In-Knoten | ✗ | ✅ | `nodes_use_library_asset` |
| Run graph **$** | ✗ | ✅ | `nodes_run` |
| Pan/Zoom, MiniMap | – | ◐ | reine Ansicht; der Viewport wird mit dem Graph gespeichert |

### World (WORLD_GEN): `world_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Welt-Historie, Modelle | ✗ | ✅ | `world_list`, `world_get` |
| Generate World (Text, Bild inkl. 360°, Video) **$** | ◐ (`studioAgentBuildEnvironment3d`, nur Project-Hub-Weg) | ✅ | `world_generate` |
| Assets speichern (Mesh, Panorama, Thumbnail, Splats; „Save All“) | ✗ | ✅ | `world_save_assets` |
| Mesh an Set Design | ✗ | ✅ | `world_send_mesh_to_set_design` |
| Viewer öffnen | ✗ | ◐ | `world_get` liefert `viewUrl` |

### Avatar (AVATAR): `avatar_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Avatare, Modi, Defaults lesen | ✗ | ✅ | `avatar_list` |
| Avatar anlegen / umbenennen / löschen ⌫ | ✗ | ✅ | `avatar_create`, `avatar_rename`, `avatar_delete` |
| ElevenLabs-Stimmen | ✗ | ✅ | `avatar_list_voices` |
| Generate Voiceover **$** (landet jetzt auch im Media-Bin) | ✗ | ✅ | `avatar_generate_voiceover` |
| Generate in 6 Modi (OmniHuman, Aurora, Wan Replace, Wan I2V, Kling 2.6, Kling Motion) mit allen Einstellungen **$** | ✗ | ✅ | `avatar_generate_video` (prüft die Eingaben, bevor etwas kostet) |

### Weitere Create-Seiten (andere Sessions)

| Seite | Modul / Präfix | Session | Stand |
|---|---|---|---|
| Import (IMPORT) | `media_` (12 Tools) | Editor, Paket M | ✅ Modul vorhanden |
| Set Design (SET_DESIGN) | `setdesign_` (6 Tools + Commands) | Blender | ◐ siehe Lückenliste H |
| Scene Map (SCENE_MAP) | `scene_map_` (23 Tools) | Shot Designer | ✅ Modul vorhanden |
| Sound (SOUND) | `sound_` (5 Tools + Commands) | Sound | ◐ siehe Lückenliste G |

## Edit (andere Sessions)

| Seite | Modul / Präfix | Session | Stand |
|---|---|---|---|
| Timeline (EDIT) | `timeline_` (20), `effect_controls_`/`keyframe_` (8), `fx_`/`ofx_` (8) | Editor, Pakete E1/E2 | ✅ für Timeline, Effekteinstellungen, FX. ✗ für alte App-Panels, siehe Lückenliste A |
| Photo (PHOTO) | `photo_` (21) | Editor, Paket P | ◐ siehe C |
| Upscale (UPSCALE) | `upscale_` (10) | Editor, Paket U | ◐ siehe D |
| Composite (COMPOSITING) | `fusion_`/`nuke_` (14), `ae_` (12) | Editor, Pakete F1/F2 | ◐ siehe B |
| Trim (TRIM) | `cut_` (13) | Editor, Paket T | ✅ Modul vorhanden |
| Color (POST) | `color_` (18) | Editor, Paket C | ◐ siehe E |

## Review

### Analysis (ANALYSIS): `analysis_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Quelle, Skript-Kontext, Ergebnis, Zielgruppe, Modelle lesen | ✗ | ✅ | `analysis_get` |
| Video laden (Datei, URL, Media-Bin) / Skript-Kontext | ✗ | ✅ | `analysis_set_source` |
| Video entfernen ⌫ (leert das Ergebnis) | ✗ | ✅ | `analysis_clear_video` |
| Analyse-Modelle (Quick, Deep, Audio) | ✗ | ✅ | `analysis_set_models` |
| Quick Scan: 4–12 Frames an Szenenwechseln, Fokusbereich, optional Auto-Upgrade **$** | ✗ | ✅ | `analysis_run_quick` (Auto-Upgrade per MCP standardmäßig aus) |
| Deep Analysis **$** | ◐ (nur über Editor-Agent-Panel) | ✅ | `analysis_run_deep` |
| Audio-Analyse **$** | ✗ | ✅ | `analysis_run_audio` |
| Zielgruppe / Audience Fit **$** | ◐ (`project_update_story` schreibt nur die Zielgruppe) | ✅ | `analysis_set_target_audience`, `analysis_run_audience_fit` |
| Szene anklicken (Video springt hin) | – | ◐ | reine Wiedergabe; Zeitstempel stehen im Ergebnis |

### Director (REVIEW): `review_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Alles lesen: Bewertungen, Change Requests mit betroffenen Shots, Tasks, Markups, fehlende Assets, Namensvorlage, Vorschläge | ✗ | ✅ | `review_get` |
| Score/Notiz für Konzept, Shot, Video | ✗ | ✅ | `review_set_feedback` |
| Change Request anlegen (öffnet Tasks) | ✗ | ✅ | `review_add_change_request` |
| Change Request entfernen ⌫ (mit Tasks) | ✗ | ✅ | `review_remove_change_request` |
| Annotate (Markup speichern) / entfernen ⌫ / lesen | ✗ | ✅ | `review_set_annotation`, `review_remove_annotation`, `review_get_annotation_image` |
| Namensvorlage setzen (leer ⌫ entfernt sie) / Vorschau | ✗ | ✅ | `review_set_naming_template`, `review_preview_naming` |
| Filter-Chips, Lightbox | – | ◐ | reine Ansicht; `review_get` liefert alles ungefiltert |

### Requests (REQUESTS): `requests_`

| Funktion | Vorher | Nachher | Tool |
|---|---|---|---|
| Requests mit live gematchten Shots, Tasks, fehlenden Assets | ✗ | ✅ | `requests_list` |
| Task-Status | ✗ | ✅ | `requests_set_task_status` |
| Export JSON / PDF (druckbares HTML) | ✗ | ✅ | `requests_export` (gibt den Inhalt zurück, kein Download) |

## Deliver (andere Session)

| Seite | Modul / Präfix | Session | Stand |
|---|---|---|---|
| Export (EXPORT) | `export_` (10) | Editor, Paket X | ◐ siehe F |

## Restlücken A–F: geschlossen (27.10., Branch `feat/mcp-coverage-ai`, Basis Editor-HEAD `8463055`)

Mit der Editor-Session abgestimmt: Sie übernimmt den Einbau. Die Live-Commands liegen in eigenen Hook-Dateien, in der Seite steht nur ein Hook-Aufruf. Kostenpflichtige Tools tragen `cost: 'paid'` und verlangen den Parameter `confirm: true`.

| Bereich | Funktion | Vorher | Nachher | Tool(s) |
|---|---|---|---|---|
| A Edit | CSS-Effekte, Effekt-Stacks, Native Effekte (Volltonfarbe, Text-Overlay, Chroma Key) | ✗ | ✅ | `edit_apply_css_effect`, `edit_apply_effect_stack`, `edit_apply_native_effect` |
| A Edit | Übergänge (alle 10) | ◐ (`cut_transition_add`: nur Blende) | ✅ | `edit_apply_transition` |
| A Edit | Titel: hinzufügen, Preset, Treatment, Motion, Auto-Kontrast | ◐ (`addTextOverlayToClip`) | ✅ | `edit_title_add/_apply_preset/_treatment/_motion/_auto_contrast` |
| A Edit | Untertitel: generieren **$**, Text, Teilen, Zusammenführen ⌫ | ✗ | ✅ | `edit_subtitles_generate`, `edit_subtitle_set_text/_split/_merge` |
| A Edit | Gespeicherte Panel-Layouts | ✗ | ✅ | `edit_layout_apply/_save/_delete` ⌫ |
| A Edit | Lücke füllen („Match gap“), Lückenliste | ✗ | ✅ | `edit_gap_match`, Lücken in `edit_get_state` |
| A Edit | Editor-Agent: Plan **$**, Vorschau, Anwenden, Undo, Review **$** | ✗ | ✅ | `edit_agent_plan/_preview/_apply/_undo/_review` |
| A Edit | KI-Effekte (17 Panel-Einträge) | ✗ | ✅ | Bild-Edit am Clip, Clarity und TTS über `edit_ai_edit_clip_image`, `edit_ai_upscale_clip_image`, `edit_ai_tts` **$**. Die übrigen Modelle laufen über `image_gen_`/`video_gen_`/`avatar_` mit identischen Services; die Zuordnung liefert `edit_ai_effects`. Drei Einträge (Nano Banana 2 gen/edit, Video aus Bild) haben in der App keine Funktion |
| A Edit | Music Assistant: Brief, Musik, Stimme **$** | ✗ | ✅ | `edit_music_brief/_generate/_voice` |
| A Edit | AutoCut: Analyse **$**, lokale Erkennung, Auswahl, Anwenden | ✗ | ✅ | `edit_autocut_*` (8), Panel öffnen mit `edit_open_panel` (nur Pro-Layouts) |
| A Edit | Lookbook | ◐ | ◐ | nur lesend über `project_list_references`; die Panel-Aktionen sind in der App leer |
| A Edit | Smart Fill (Veo) | – | – | in der Edit-Seite nicht erreichbar (Button wird nicht übergeben) |
| B Composite | Werkzeug wählen, Eingaben (Media-Bin, URL/Pfad, Timeline-Clip) | ✗ | ✅ | `compositing_ai_open_tool`, `compositing_ai_set_input` |
| B Composite | Merge, CorridorKey vorbereiten/ausführen | ✗ | ✅ | `compositing_ai_composite`, `_corridorkey_prepare`, `_corridorkey_run` |
| B Composite | OpenPose, Wan Animate Replace, Luma Reframe, Kling Bridge **$** | ✗ | ✅ | `compositing_ai_openpose/_animate_replace/_reframe/_kling_bridge` |
| B Composite | Ergebnis an Timeline | ✗ | ✅ | `compositing_ai_add_result_to_timeline` |
| B Composite | Relight: Quelle, Guide, Presets, Depth/Normal (lokal), Export | ✗ | ✅ | `compositing_relight_*` (10) |
| B Composite | Node Studio: Effekte, Parameter, AI-Nodes, Still rendern | ✗ | ✅ | `compositing_nodes_*` (8) |
| C Photo | Generative Füllung mit Modell und Auflösung, Reparatur **$** | ◐ (`photo_generative_fill`, feste 2K) | ✅ | `photo_ai_inpaint` |
| C Photo | Arbeitsfläche erweitern (ohne KI), Erweitern+Füllen **$** | ◐ | ✅ | `photo_ai_expand_canvas`, `photo_ai_expand_and_fill` |
| C Photo | Neural Looks (Gemini **$**; Dunst/Haut lokal), Referenz | ✗ | ✅ | `photo_ai_neural_look`, `photo_ai_set_neural_reference` |
| C Photo | Bildgröße, PNG-Export | ✗ | ✅ | `photo_ai_resize_image`, `photo_ai_export_png` |
| D Upscale | Color Science (LTX ACES, Runway Ruby inkl. EXR/ProRes HDR) | ◐ (Engine ja, Format nein) | ✅ | `upscale_ai_set_color_science` (Lauf: `upscale_queue_add`) |
| D Upscale | Ausgabeordner, Eingabe per URL/Pfad/Library, FPS | ✗ | ✅ | `upscale_ai_set_output_folder`, `_add_input_url`, `_add_library_asset`, `_set_input_fps` |
| D Upscale | Eingabe/Job entfernen ⌫, Erledigte leeren ⌫, Job anzeigen, in den Bin, Ordner | ✗ | ✅ | `upscale_ai_remove_input`, `_job_remove`, `_clear_finished_jobs`, `_job_show`, `_job_add_to_bin`, `_job_open_folder` |
| E Color | Clip-Look: Film-LUTs, Look-Presets, Regler, Reset ⌫ | ✗ | ✅ | `color_ai_look_get/_set/_preset/_reset` |
| E Color | .cube importieren, Plugin-LUT, LUT entfernen ⌫ | ✗ | ✅ | `color_ai_lut_import/_plugin/_remove` |
| E Color | .cube exportieren (Grade-Nodes, 33³) | ✗ (in der UI entfallen) | ✅ | `color_ai_export_cube` |
| E Color | AI-Colorist: Analyse, Referenz-Match, Look-Beschreibung **$** | ✗ | ✅ | `color_ai_analyze`, `_match_reference`, `_prompt_grade` |
| E Color | Smart-Audio-Analyzer **$** | ✗ | ✅ | `color_ai_audio_cues` |
| F Export | Gültige Werte (Stil-Transfer, OCIO, Farbprofil, GPU, Formate) | ✗ | ✅ | `export_ai_options` |
| F Export | Austauschdateien als Text bzw. in `exports/` | ◐ (nur Browser-Download) | ✅ | `export_ai_interchange` |
| F Export | Ordner öffnen, Job zurücksetzen, „Exportieren“, DaVinci-Ansicht, Preflight, Vorschau-Position | ✗ | ✅ | `export_ai_open_folder/_queue_retry/_export_now/_davinci_view/_preflight/_preview_seek` |

### G Sound und H Set Design (Prüfung, gemeldet an die Editor-Session)

- **G Sound:** 61 Tools decken Mixer, Busse, Clips, Edit, Automation, ADR und Studio ab. **Es fehlen:** Voice-, Music- und SFX-Generierung, Demucs-Stems, Mastering-Pipeline, Library-Tab und Spur sperren.
- **H Set Design:** 24 Tools und 26 Commands decken Objekte, Licht, Kamera-Objekte, Ansicht und Capture→Shot ab. **Es fehlen:**
  - Kamerapfad und Keyframes, Kamera aus Shot
  - KI-Blockout, World Labs im Set Design, Sketchfab, AI-Director-Copilot
  - HDRI, Render- und Material-Packs, Blender-Skript, Library-Liste
- Vorschlag: Die beiden Sessions schließen diese Lücken selbst. Andernfalls übernehme ich sie nach dem gleichen Muster.

## Zählung

Gezählt sind die Zeilen der Tabellen oben (Navigation, Images, Video, Design, Nodes, World, Avatar, Analysis, Director, Requests). Eine Zeile fasst zusammengehörige Bedienelemente zusammen, zum Beispiel alle ComfyUI-Presets.

| | Vorher (main c29dd0e) | Nachher |
|---|---|---|
| Funktionsgruppen in Images, Video, Design, Nodes, World, Avatar, Analysis, Director, Requests, Navigation | 76 | 76 |
| ✅ voll per MCP | 1 (Seite öffnen) | 71 |
| ◐ teilweise | 3 (World, Deep-Analyse, Zielgruppe nur über Umwege) | 5 (nur Ansicht: Download, Pan/Zoom, Lightbox/Filter, Szene anspringen, Viewer) |
| ✗ fehlt | 68 | 0 |
| – reine Ansicht ohne Tool | 4 | – |
| MCP-Tools für diese Seiten | 2 (`navigateWorkspace`, `studioAgentNavigateWorkspace`) | 109 neue in 10 Modulen, davon 86 schreibend, 16 kostenpflichtig, 14 löschend |

**Restlücken A–F:** 33 Funktionsgruppen. Vorher waren davon 0 voll und 7 teilweise abgedeckt. Nachher sind 31 voll abgedeckt, Lookbook bleibt teilweise (nur lesend) und Smart Fill ist in der App nicht erreichbar. Dafür gibt es 112 neue Tools in 9 Modulen, davon 95 schreibend, 22 kostenpflichtig (alle mit `confirm`) und 8 löschend.

**Gesamt neu:** 221 MCP-Tools (109 + 112).

## Tests

- **Unit/MCP-Tests:** Je Modul ein Test über `createMcpHarness`, also über die echte Brücke `registerStudioTools`. Kostenpflichtige Provider sind dabei durch Fakes ersetzt (`createServiceLoader().override`). Abgedeckt sind Veröffentlichung, Schema, Kosten- und Lösch-Kennzeichen, Lesen und Schreiben, Fehlerfälle (fehlende Eingaben kosten nichts) sowie das Öffnen von Seiten.
- **End-to-End in der echten React-App:** Dev-Server des Worktrees, Test-Brücke an `window.electron.studioTools`, also dieselbe Schnittstelle, die der MCP-Server per IPC nutzt.
  - 177 Tools veröffentlicht: 68 alte und 109 neue.
  - Review, Requests, Design, Bilder, Video, Nodes, Avatar, World und Analysis gegen den echten Zustand aufgerufen.
  - In der Oberfläche sichtbar geprüft: Requests-Seite mit MCP-Request und -Status, Design-Canvas mit MCP-Ebenen.
  - Ohne API-Keys melden alle kostenpflichtigen Tools den Fehler der Seite. Es wird nichts abgerechnet.
- Dabei gefunden und behoben:
  - Tool-Aufrufe lasen den Zustand vor dem letzten Render. Jetzt wartet jeder Modul-Aufruf einen Frame ab.
  - Design-Template plus Ebene überschrieben sich gegenseitig. Design nutzt jetzt das Live-Page-Protokoll mit Commit-Warten.
  - Gesperrte Seiten im Einsteiger-Modus werden jetzt klar gemeldet.
