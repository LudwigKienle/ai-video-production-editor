import React from 'react';
import { fetchProjectById, fetchTeams, Project, Team } from '../services/dataService';

type ProjectDetailProps = {
  projectId: string;
};

export const ProjectDetail: React.FC<ProjectDetailProps> = ({ projectId }) => {
  const [project, setProject] = React.useState<Project | null>(null);
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [origin, setOrigin] = React.useState(window.location.origin);

  React.useEffect(() => {
    fetchProjectById(projectId).then(setProject);
    fetchTeams().then(setTeams);
  }, [projectId]);

  if (!project) {
    return <div className="panel">Loading project...</div>;
  }

  const team = teams.find(item => item.id === project.team_id);
  const params = new URLSearchParams({
    allowedOrigins: origin,
    phases: 'script,storyboard',
    initialPhase: 'script',
    features: 'storyboard-generation,script-analysis',
    team: project.team_id,
    project: project.id,
  });
  const embedUrl = `/embed.html?${params.toString()}`;

  return (
    <div className="panel">
      <h2>{project.name}</h2>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Status: {project.status} · Team: {team?.name || '—'}
      </p>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Launch Embed</h2>
        <div className="field">
          <label>Host Origin</label>
          <input value={origin} onChange={(event) => setOrigin(event.target.value)} />
        </div>
        <div className="button-row">
          <a className="button primary" href={embedUrl}>
            Open Storyboard
          </a>
          <span className="status">{embedUrl}</span>
        </div>
      </div>
    </div>
  );
};
