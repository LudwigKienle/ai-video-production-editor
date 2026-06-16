# Product Spec: Review, Zielgruppen, Naming (Local-first + Cloud-ready)

## Ziele
- Local-first Review-Workflow fuer Kunden (Director), spaeter Cloud-Sync.
- Varianten fuer First Frame/Animation vergleichen und freigeben.
- Custom Naming fuer lokale Assets mit Regeln und Vorschau.

## Datenmodell (Local)
Empfehlung: SQLite lokal, spaeter Sync-Schicht fuer Cloud.

```sql
users(id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at TEXT)
projects(id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, created_at TEXT)

project_members(
  project_id TEXT, user_id TEXT, role TEXT,
  PRIMARY KEY(project_id, user_id)
)

review_sets(id TEXT PRIMARY KEY, project_id TEXT, name TEXT, status TEXT, created_at TEXT)
variants(
  id TEXT PRIMARY KEY, review_set_id TEXT,
  type TEXT, -- first_frame|animation|audio
  version INTEGER, label TEXT, path TEXT, duration_ms INTEGER,
  created_by TEXT, created_at TEXT
)

decisions(
  id TEXT PRIMARY KEY, variant_id TEXT,
  status TEXT, -- approved|rejected|changes_requested
  decided_by TEXT, decided_at TEXT, note TEXT
)

comments(
  id TEXT PRIMARY KEY, variant_id TEXT,
  author_id TEXT, body TEXT,
  timecode_ms INTEGER, frame_index INTEGER,
  created_at TEXT
)

tasks(
  id TEXT PRIMARY KEY, project_id TEXT, variant_id TEXT,
  title TEXT, status TEXT, assigned_to TEXT, created_at TEXT
)

assets(
  id TEXT PRIMARY KEY, project_id TEXT,
  type TEXT, path TEXT, alias TEXT,
  created_at TEXT
)

naming_templates(
  id TEXT PRIMARY KEY, scope TEXT, -- global|project
  project_id TEXT, template TEXT, is_default INTEGER
)

review_packages(
  id TEXT PRIMARY KEY, review_set_id TEXT,
  export_path TEXT, imported_at TEXT
)
```

## Review-Package Format (Export/Import)
Ziel: Offline-Review exportieren/importieren, Cloud-ready.

```json
{
  "schema_version": "1.0",
  "exported_at": "2026-01-15T08:12:00Z",
  "app": { "name": "AI Video Production Editor", "version": "1.0.0" },
  "project": { "id": "proj_123", "name": "Kunde A Spot" },
  "review_set": { "id": "rs_456", "name": "Round 1", "status": "review" },
  "variants": [
    {
      "id": "var_1",
      "type": "first_frame",
      "version": 3,
      "label": "Hero Frame",
      "asset_path": "assets/frames/hero_v3.png",
      "duration_ms": 0,
      "created_by": "user_1",
      "created_at": "2026-01-14T10:10:00Z"
    }
  ],
  "comments": [
    {
      "id": "c_1",
      "variant_id": "var_1",
      "author": { "id": "user_director", "name": "Director Kunde" },
      "body": "Bitte Schrift groesser",
      "timecode_ms": 3500,
      "frame_index": 88,
      "created_at": "2026-01-15T08:30:00Z"
    }
  ],
  "decisions": [
    {
      "id": "d_1",
      "variant_id": "var_1",
      "status": "approved",
      "decided_by": "user_director",
      "decided_at": "2026-01-15T08:40:00Z",
      "note": "Passt"
    }
  ],
  "tasks": [
    {
      "id": "t_1",
      "variant_id": "var_1",
      "title": "Schriftgroesse anpassen",
      "status": "open",
      "assigned_to": "user_2",
      "created_at": "2026-01-15T08:31:00Z"
    }
  ],
  "assets": [
    {
      "id": "a_1",
      "type": "image",
      "path": "assets/frames/hero_v3.png",
      "alias": "Hero Frame"
    }
  ],
  "naming_templates": [
    {
      "scope": "project",
      "template": "{project}_{scene}_{shot}_{type}_{user}_{date:YYYYMMDD}_v{version}"
    }
  ]
}
```

## UI-Flows (Text-Wireframes)
### Review Workspace
- Tabs: `First Frame` | `Animation`
- Varianten-Grid: Thumbnail, Label, Version, Status
- Preview + Kommentar-Panel
- Actions: `Compare`, `Approve`, `Request changes`, `Export Review Package`

### Compare View
- A/B Split + Sync-Scrub + Diff-Toggle
- Kommentar-Marker in Timeline
- Actions: `Approve A`, `Approve B`, `Set as final`

### Director-Feedback
- Click auf Frame/Timeline -> Kommentar
- `Request changes` erzeugt Task + Statuswechsel im ReviewSet
- Audit-Log: wer, wann, was entschieden hat

### Naming-Convention UI
- Global Template + Projekt-Override
- Live-Preview + Konflikt-Warnung
- Toggle: `Auto-rename on import`

## Naming-Logik
- Tokens: `{project}`, `{scene}`, `{shot}`, `{type}`, `{user}`, `{date:YYYYMMDD}`, `{version}`
- Sanitizer: Leerzeichen -> `_`, verbotene Zeichen entfernen
- Konflikte: `_v{version}` hochzaehlen
- Alias im UI bleibt frei waehbar

## Roadmap
### V1 (Local-first)
- ReviewSet + Varianten + Kommentare + Decisions
- Compare View + Timecode-Kommentare
- Naming-Templates + Auto-Rename
- Review Package Export/Import (ZIP)

### V2 (Cloud)
- Auth + Team-Invite
- Sync ReviewSet/Comments/Decisions
- Konflikte: last write wins + History

### V3 (Segment-Optimierung)
- Segment-Onboarding (Teens/Berufstaetige/Rentner)
- Segment-Templates + Defaults
- KPI-Tracking (Time-to-Export, Review Iterations, Retention)
